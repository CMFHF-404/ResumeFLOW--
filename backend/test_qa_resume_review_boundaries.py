import copy
import json
import tempfile
import unittest
from contextlib import asynccontextmanager
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import qa_resume_blind_benchmark as benchmark
import qa_resume_blind_direct as direct
from app.domain.ai.resume_evaluation import SCORING_VERSION


def snapshot(folder):
    return {p.name: p.read_bytes() for p in folder.iterdir()}


class DatabaseBoundaryTests(unittest.IsolatedAsyncioTestCase):
    async def test_local_target_still_runs_operation_and_records_result(self):
        @asynccontextmanager
        async def context(*args, **kwargs):
            yield None

        for host in ('localhost', '127.0.0.1'):
            operation = AsyncMock(return_value={'result': 'ok'})
            with (patch('app.config.load_settings', return_value=SimpleNamespace(
                      database_url=f'postgresql+asyncpg://{host}/resumeflow')),
                  patch('app.database.AsyncSessionFactory', context),
                  patch('app.domain.billing.billing_service.ai_billing_context', context),
                  patch.object(benchmark, 'save') as save):
                result = await benchmark.call_record('case', operation, 'qa-blind-20260906')
            operation.assert_awaited_once()
            self.assertTrue(result['ok'])
            save.assert_called_once_with('case.json', result)

    async def test_call_record_rejects_other_database_before_session_or_provider(self):
        for url in ('postgresql+asyncpg://host/resumeflow',
                    'postgresql+asyncpg://localhost/production',
                    'postgresql+asyncpg://localhost/resumeflow?host=remote.example',
                    'postgresql+asyncpg://localhost/resumeflow?database=production',
                    'postgresql+asyncpg://localhost/resumeflow?h%6fst=remote.example',
                    'postgresql+asyncpg://localhost/resumeflow?host=localhost&host=remote.example',
                    'postgresql+asyncpg://localhost/resumeflow?dsn=postgresql%3A%2F%2Fremote.example%2Fproduction'):
            with self.subTest(url=url):
                factory = Mock()
                operation = AsyncMock()
                with (patch('app.config.load_settings', return_value=SimpleNamespace(database_url=url)),
                      patch('app.database.AsyncSessionFactory', factory),
                      patch.object(benchmark, 'save') as save):
                    with self.assertRaisesRegex(RuntimeError, 'Only local resumeflow'):
                        await benchmark.call_record('case', operation, 'qa-blind-20260906')
                factory.assert_not_called()
                operation.assert_not_awaited()
                save.assert_not_called()


class DirectBoundaryTests(unittest.IsolatedAsyncioTestCase):
    async def test_direct_uses_first_successful_current_baseline_and_retains_failed_plan(self):
        sample = {'id': 'S1', 'resume': {'before': True}, 'sources': {}}
        first = {'scoringVersion': SCORING_VERSION, 'overallScore': 20}
        later = {'scoringVersion': SCORING_VERSION, 'overallScore': 90}
        with tempfile.TemporaryDirectory() as directory, patch.object(benchmark, 'OUT', Path(directory)):
            benchmark.save('baseline-S1-1.json', {'ok': False})
            benchmark.save('baseline-S1-2.json', {'ok': True, 'value': {'resumeEvaluation': first}})
            benchmark.save('baseline-S1-3.json', {'ok': True, 'value': {'resumeEvaluation': later}})
            benchmark.save('direct-S1-1.json', {'ok': False})
            calls = []

            async def record(name, operation, user_id):
                calls.append(name)
                result = {'ok': True, 'value': await operation()}
                benchmark.save(name + '.json', result)
                return result

            plan = AsyncMock(return_value={'accepted': ['change'], 'resume': {'after': True}})
            evaluate = AsyncMock(return_value={'resumeEvaluation': first})
            with (patch.object(benchmark, 'call_record', side_effect=record),
                  patch.object(direct, 'direct', plan),
                  patch.object(benchmark, 'evaluate', evaluate),
                  patch.object(benchmark, 'blind_judge', AsyncMock(return_value={}))):
                await direct.run_samples([sample])
            plan.assert_awaited_once_with(sample, first)
            self.assertEqual(evaluate.await_count, 3)
            self.assertTrue(all(call.args == ({'after': True},) for call in evaluate.await_args_list))
            self.assertEqual(calls, ['direct-S1-2', 'direct-post-S1-1',
                                     'direct-post-S1-2', 'direct-post-S1-3', 'direct-blind-judge'])
            benchmark.save('baseline-S1-2.json', {'ok': True, 'value': {
                'resumeEvaluation': {'scoringVersion': 'old'}}})
            with patch.object(benchmark, 'call_record', AsyncMock()) as provider:
                with self.assertRaisesRegex(SystemExit, 'NEW run tag'):
                    await direct.run_samples([sample])
                provider.assert_not_awaited()

    async def test_direct_freezes_new_baselines_and_resumes_only_missing_results(self):
        with tempfile.TemporaryDirectory() as directory:
            original = Path(directory) / 'benchmark'
            original.mkdir()
            fixture = {'jd': benchmark.JD, 'target_role': benchmark.ROLE,
                       'samples': [{'id': 'S1', 'resume': {}, 'sources': {}}]}
            (original / 'fixtures.json').write_text(json.dumps(fixture), encoding='utf-8')
            (original / 'baseline-S1-1.json').write_text('{"historical":true}', encoding='utf-8')
            original_bytes = snapshot(original)
            calls = []

            async def record(name, operation, user_id):
                calls.append(name)
                if name.startswith('baseline-'):
                    result = {'ok': True, 'value': {'resumeEvaluation': {'scoringVersion': SCORING_VERSION}}}
                else:
                    result = {'ok': False, 'error_type': 'RetainedFailure'}
                benchmark.save(name + '.json', result)
                return result

            with (patch.object(benchmark, 'OUT', original),
                  patch.object(benchmark, 'qa_runtime_fingerprint', return_value={'model': 'fixed'}),
                  patch.object(benchmark, 'call_record', side_effect=record),
                  patch('app.database.engine', SimpleNamespace(dispose=AsyncMock())),
                  patch('sys.argv', ['qa_resume_blind_direct.py', 'review'])):
                await direct.main()
                output = original.with_name('benchmark-direct-review')
                self.assertTrue((output / 'run-manifest.json').exists())
                self.assertEqual(calls[:3], ['baseline-S1-1', 'baseline-S1-2', 'baseline-S1-3'])
                before = snapshot(output)
                calls.clear()
                await direct.main()
                self.assertEqual(calls, [])
                self.assertEqual(snapshot(output), before)
                (output / 'direct-S1-2.json').unlink()
                await direct.main()
                self.assertEqual(calls, ['direct-S1-2'])
                calls.clear()
                for changed in ('model', 'code', 'input', 'protocol', 'missing'):
                    with self.subTest(changed=changed):
                        saved = snapshot(output)
                        hashes = benchmark.qa_algorithm_hashes(direct.__file__)
                        if changed == 'code':
                            hashes['qa_resume_blind_direct.py'] = 'changed'
                        if changed == 'input':
                            altered = copy.deepcopy(fixture)
                            altered['samples'][0]['resume'] = {'personal_summary': 'changed'}
                            (original / 'fixtures.json').write_text(json.dumps(altered), encoding='utf-8')
                        if changed == 'protocol':
                            (output / 'protocol.json').write_text('{}', encoding='utf-8')
                        if changed == 'missing':
                            (output / 'run-manifest.json').unlink()
                        before_rejection = snapshot(output)
                        with (patch.object(benchmark, 'qa_algorithm_hashes', return_value=hashes),
                              patch.object(benchmark, 'qa_runtime_fingerprint', return_value={
                                  'model': 'changed' if changed == 'model' else 'fixed'})):
                            with self.assertRaisesRegex(SystemExit, 'NEW run tag'):
                                await direct.main()
                        self.assertEqual(snapshot(output), before_rejection)
                        self.assertEqual(calls, [])
                        for name, content in saved.items():
                            (output / name).write_bytes(content)
                        (original / 'fixtures.json').write_bytes(original_bytes['fixtures.json'])
                self.assertEqual(snapshot(original), original_bytes)
