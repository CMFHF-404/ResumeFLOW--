import asyncio
import json
import runpy
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import app.database
import app.domain.billing.entitlement_service
import qa_resume_blind_benchmark as benchmark
from test_qa_resume_seed_users import MemorySession, session_factory


def snapshot(folder):
    return {p.name: p.read_bytes() for p in folder.iterdir()}


class RunEntrypointTests(unittest.IsolatedAsyncioTestCase):
    async def test_run_rejects_unfrozen_or_changed_evidence_before_any_side_effect(self):
        for changed in ('missing', 'model', 'code', 'input', 'protocol', 'corrupt'):
            with self.subTest(changed=changed), tempfile.TemporaryDirectory() as directory:
                output = Path(directory)
                runtime = {'model': 'original'}
                with (patch.object(benchmark, 'OUT', output),
                      patch.object(benchmark, 'qa_runtime_fingerprint', return_value=runtime)):
                    if changed == 'missing':
                        benchmark.save('fixtures.json', {'samples': []})
                    else:
                        benchmark.prepare()
                    benchmark.save('baseline-R7K2-1.json', {'ok': True, 'old_score': 10})
                    benchmark.save('environment.json', {'model': 'old evidence'})
                    if changed in ('input', 'protocol', 'corrupt'):
                        name = {'input': 'fixtures.json', 'protocol': 'protocol.json',
                                'corrupt': 'run-manifest.json'}[changed]
                        benchmark.save(name, {'changed': True})
                    before = snapshot(output)
                    factory = session_factory(MemorySession())
                    grant = AsyncMock(side_effect=AssertionError('grant must not run'))
                    provider = AsyncMock(side_effect=AssertionError('provider must not run'))
                    hashes = benchmark.qa_algorithm_hashes(benchmark.__file__)
                    if changed == 'code':
                        hashes['qa_resume_blind_benchmark.py'] = 'changed'
                    with (patch('app.database.AsyncSessionFactory', factory),
                          patch('app.domain.billing.entitlement_service.grant_entitlement', grant),
                          patch.object(benchmark, 'call_record', provider),
                          patch.object(benchmark, 'qa_algorithm_hashes', return_value=hashes),
                          patch.object(benchmark, 'qa_runtime_fingerprint', return_value=(
                              {'model': 'changed'} if changed == 'model' else runtime))):
                        with self.assertRaisesRegex(SystemExit, 'NEW run tag'):
                            await benchmark.run('qa-blind-20260906')
                    factory.assert_not_called()
                    grant.assert_not_awaited()
                    provider.assert_not_awaited()
                    self.assertEqual(snapshot(output), before)

    async def test_matching_run_reuses_cached_failure_and_resumes_only_missing_calls(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(benchmark, 'OUT', Path(directory)):
            benchmark.prepare()
            immutable = snapshot(Path(directory))
            for sample in benchmark.IDS:
                for index in (1, 2, 3):
                    if sample == 'R7K2' and index == 3:
                        continue
                    benchmark.save(f'baseline-{sample}-{index}.json', {'ok': False, 'original_failure': True})
            baseline_bytes = (Path(directory) / 'baseline-R7K2-1.json').read_bytes()
            session = MemorySession()
            session.get = AsyncMock(return_value=SimpleNamespace(id='qa-blind-20260906'))
            calls = []

            async def record(name, operation, user_id):
                calls.append(name)
                # No model: a failed missing baseline keeps optimization ineligible.
                result = {'ok': False}
                benchmark.save(name + '.json', result)
                return result

            with (patch('app.database.AsyncSessionFactory', session_factory(session)),
                  patch('app.database.engine', SimpleNamespace(dispose=AsyncMock())),
                  patch.object(benchmark, 'seed_samples', AsyncMock(return_value=[])),
                  patch.object(benchmark, 'call_record', side_effect=record),
                  patch('app.domain.billing.entitlement_service.grant_entitlement',
                        AsyncMock(return_value=SimpleNamespace(wallet=SimpleNamespace(
                            unlimited_tokens_expires_at=datetime.now(timezone.utc)))))):
                await benchmark.run('qa-blind-20260906')
                self.assertEqual(calls, ['baseline-R7K2-3', 'blind-judge'])
                calls.clear()
                await benchmark.run('qa-blind-20260906')
                self.assertEqual(calls, [])
            self.assertEqual((Path(directory) / 'baseline-R7K2-1.json').read_bytes(), baseline_bytes)
            for name, content in immutable.items():
                self.assertEqual((Path(directory) / name).read_bytes(), content)


class PrepareEntrypointTests(unittest.TestCase):
    def test_cli_run_tag_selects_a_separate_directory(self):
        def inspect_run(coro):
            try:
                self.assertEqual(coro.cr_frame.f_globals['OUT'].name,
                                 '2026-09-06-resume-blind-reviewtest')
                self.assertEqual(coro.cr_frame.f_locals['user_id'], 'test-user')
            finally:
                coro.close()  # The CLI parser is exercised; the live run never starts.

        with (patch('sys.argv', ['qa_resume_blind_benchmark.py', 'run',
                                '--run-tag', 'reviewtest', '--user-id', 'test-user']),
              patch.object(asyncio, 'run', side_effect=inspect_run) as runner):
            runpy.run_path(benchmark.__file__, run_name='__main__')
        runner.assert_called_once()

    def test_wave_and_holdout_contracts_pass_shared_run_validation(self):
        from app.domain.ai import resume_evaluation_service as evaluation_service

        with tempfile.TemporaryDirectory() as directory:
            original = Path(directory) / 'benchmark'
            with patch.object(benchmark, 'OUT', original):
                benchmark.prepare()
            for script, tag in (('qa_resume_blind_wave.py', 'review'),
                                ('qa_resume_blind_holdout.py', 'review')):
                with self.subTest(script=script):
                    operation = AsyncMock(side_effect=lambda user: benchmark.validate_frozen_run())
                    with (patch.object(benchmark, 'OUT', original),
                          patch.object(benchmark, 'IDS', benchmark.IDS.copy()),
                          patch.object(benchmark, 'optimize', benchmark.optimize),
                          patch.object(evaluation_service, '_normalize_response', evaluation_service._normalize_response),
                          patch.object(benchmark, 'run', operation),
                          patch('sys.argv', [script, tag])):
                        runpy.run_path(str(Path(benchmark.__file__).with_name(script)), run_name='__main__')
                    operation.assert_awaited_once_with('qa-blind-20260906')

    def test_prepare_is_frozen_and_repeatable_without_overwriting_existing_evidence(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(benchmark, 'OUT', Path(directory)):
            benchmark.prepare()
            self.assertTrue((Path(directory) / 'run-manifest.json').exists())
            before = snapshot(Path(directory))
            benchmark.prepare()
            self.assertEqual(snapshot(Path(directory)), before)

    def test_prepare_rejects_historical_directory_without_replacing_any_files(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(benchmark, 'OUT', Path(directory)):
            benchmark.save('baseline-R7K2-1.json', {'original': True})
            before = snapshot(Path(directory))
            with self.assertRaisesRegex(SystemExit, 'NEW run tag'):
                benchmark.prepare()
            self.assertEqual(snapshot(Path(directory)), before)


def setUpModule():
    # Exercise historical cache/account contracts with a mocked numeric service.
    # Current CLI rejection is covered without this mock in test_qa_numeric_contract_guard.
    gate = patch("qa_resume_blind_benchmark.reject_retired_numeric_run")
    gate.start()
    unittest.addModuleCleanup(gate.stop)
