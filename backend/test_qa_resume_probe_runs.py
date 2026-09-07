import asyncio
import json
import tempfile
import unittest
from contextlib import ExitStack, asynccontextmanager
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import qa_resume_answer_probe as answers
import qa_resume_blind_diagnostics as diagnostics
import qa_resume_blind_benchmark as b
from qa_resume_probe_runs import frozen_probe, save_exclusive
from app.domain.resume_optimization import planner_service


def snapshot(folder):
    return {str(p.relative_to(folder)): p.read_bytes() for p in folder.rglob('*') if p.is_file()}


@asynccontextmanager
async def session(*args, **kwargs):
    yield None


class ProbeEntrypointTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name) / 'benchmark'
        self.samples = [{'id': identity, 'resume': {'experiences': []}, 'sources': {}}
                        for identity in ('R7K2', 'S2')]
        for folder in (self.base, self.base.with_name('benchmark-wave4')):
            folder.mkdir()
            (folder / 'fixtures.json').write_text(json.dumps({
                'jd': b.JD, 'target_role': b.ROLE, 'samples': self.samples}), encoding='utf-8')
            for sample in self.samples:
                (folder / f"baseline-{sample['id']}-1.json").write_text(json.dumps({
                    'value': {'resumeEvaluation': {}}}))
            (folder / 'optimization-R7K2-1.json').write_text(json.dumps({
                'value': {'initial_plan': {'changes': [], 'questions': []}}}))
        self.calls = []
        self.cancel = None

    def output(self, module):
        return self.base.with_name('benchmark-' + ('answers' if module is answers else 'diagnostics') + '-review')

    def invoke(self, module, *, model='fixed', code='fixed'):
        async def record(name, operation, user_id):
            self.calls.append(name)
            b.save('response.json', {'attempt': len(self.calls)})
            if name == self.cancel:
                raise asyncio.CancelledError()
            result = {'ok': name != 'no_extra_text', 'value': {}, 'error_type': 'RetainedFailure'}
            b.save(name + '.json', result)
            return result

        async def optimize(sample, evaluation):
            name = 'diagnostic-' + sample['id']
            self.calls.append(name)
            await planner_service._call_llm(request_label='test')
            if name == self.cancel:
                raise asyncio.CancelledError()
            if sample['id'] == 'R7K2':
                raise ValueError('retained failure')
            return {'accepted': []}

        with ExitStack() as stack:
            for target, attr, value in (
                (b, 'OUT', self.base), (b, 'qa_runtime_fingerprint', lambda: {'model': model}),
                (b, 'qa_algorithm_hashes', lambda _: {'entry': code}),
                (b, 'call_record', record), (b, 'optimize', optimize),
                (b, 'require_local_database', lambda: None),
                (planner_service, '_call_llm', AsyncMock(return_value={'response': True})),
            ):
                stack.enter_context(patch.object(target, attr, value))
            stack.enter_context(patch('sys.argv', [module.__file__, 'review']))
            stack.enter_context(patch('app.database.engine', SimpleNamespace(dispose=AsyncMock())))
            stack.enter_context(patch('app.database.AsyncSessionFactory', session))
            stack.enter_context(patch('app.domain.billing.billing_service.ai_billing_context', session))
            original_save, original_call = b.save, planner_service._call_llm
            try:
                asyncio.run(module.main())
            finally:
                self.assertEqual(b.OUT, self.base)
                self.assertIs(b.save, original_save)
                self.assertIs(planner_service._call_llm, original_call)

    def test_both_entrypoints_preserve_success_failure_and_source_bytes(self):
        for module in (answers, diagnostics):
            with self.subTest(module=module.__name__):
                source_before = snapshot(self.base)
                self.invoke(module)
                before = snapshot(self.output(module))
                self.calls.clear()
                self.invoke(module)
                self.assertEqual(self.calls, [])
                self.assertEqual(snapshot(self.output(module)), before)
                self.assertEqual(snapshot(self.base), source_before)
                results = [json.loads(p.read_text()) for p in self.output(module).glob('*.json')
                           if p.name.startswith(('no_extra', 'provided', 'diagnostic-'))]
                self.assertEqual(sorted(r['ok'] for r in results), [False, True])

    def test_interruption_keeps_observed_bytes_and_uses_new_attempt_on_resume(self):
        for module, cancelled in ((answers, 'provided_facts'), (diagnostics, 'diagnostic-S2')):
            with self.subTest(module=module.__name__):
                self.cancel = cancelled
                with self.assertRaises(asyncio.CancelledError):
                    self.invoke(module)
                before = snapshot(self.output(module))
                self.assertTrue(any(name.endswith('interrupted.json') for name in before))
                self.cancel = None
                self.calls.clear()
                self.invoke(module)
                self.assertEqual(self.calls, [cancelled])
                after = snapshot(self.output(module))
                self.assertTrue(all(after[name] == content for name, content in before.items()))
                self.assertEqual(len(list(self.output(module).glob('attempt-*'))), 3)

    def test_both_entrypoints_reject_changed_and_damaged_runs_without_calls(self):
        for module in (answers, diagnostics):
            self.invoke(module)
            folder = self.output(module)
            source = self.base.with_name('benchmark-wave4') if module is answers else self.base
            for change in ('model', 'code', 'input', 'protocol', 'manifest', 'result'):
                with self.subTest(module=module.__name__, change=change):
                    before = snapshot(folder)
                    baseline = source / 'baseline-R7K2-1.json'
                    original = baseline.read_bytes()
                    if change == 'input':
                        baseline.write_text('{"value":{"resumeEvaluation":{"changed":true}}}')
                    if change in ('protocol', 'manifest', 'result'):
                        name = {'protocol': 'protocol.json', 'manifest': 'run-manifest.json',
                                'result': 'provided_facts.json' if module is answers else 'diagnostic-S2.json'}[change]
                        (folder / name).write_text('broken')
                    damaged = snapshot(folder)
                    self.calls.clear()
                    with self.assertRaisesRegex(SystemExit, 'NEW run tag'):
                        self.invoke(module, model='changed' if change == 'model' else 'fixed',
                                    code='changed' if change == 'code' else 'fixed')
                    self.assertEqual(self.calls, [])
                    self.assertEqual(snapshot(folder), damaged)
                    for name, content in before.items():
                        (folder / name).write_bytes(content)
                    baseline.write_bytes(original)

    def test_cli_rejects_missing_or_unsafe_tag_before_reading_inputs(self):
        for module in (answers, diagnostics):
            for args in ([], ['../old'], ['one', 'invalid-case', 'extra']):
                with patch('sys.argv', [module.__file__, *args]):
                    with self.assertRaisesRegex(SystemExit, 'NEW_RUN_TAG'):
                        asyncio.run(module.main())

    def test_exclusive_writer_and_active_run_reject_overwrite(self):
        output = self.base.with_name('exclusive')
        with patch.object(b, 'qa_runtime_fingerprint', return_value={}):
            with frozen_probe(output, __file__, {}, ['case']):
                save_exclusive('case.json', {'ok': True, 'value': {}})
                before = snapshot(output)
                with self.assertRaises(FileExistsError):
                    save_exclusive('case.json', {'ok': False})
                with self.assertRaisesRegex(SystemExit, 'already active'):
                    with frozen_probe(output, __file__, {}, ['case']):
                        self.fail('a concurrent writer was allowed')
                self.assertEqual(snapshot(output), before)

    def test_answer_probe_keeps_every_model_response_in_the_attempt(self):
        async def rewrite(**kwargs):
            await planner_service._call_llm()
            await planner_service._call_llm()
            return []

        async def review(**kwargs):
            return kwargs['plan']

        output = self.base.with_name('answer-responses')
        initial = {'changes': [], 'questions': []}
        ctx = SimpleNamespace(source_documents={})
        with (patch.object(b, 'qa_runtime_fingerprint', return_value={}),
              patch.object(answers, 'rewrite_answered_modules', side_effect=rewrite),
              patch.object(answers, 'review_plan_semantics', side_effect=review),
              patch.object(planner_service, '_call_llm', AsyncMock(side_effect=[{'first': True}, {'second': True}]))):
            original_call = planner_service._call_llm
            with frozen_probe(output, answers.__file__, {}, []):
                asyncio.run(answers.probe('provided_facts', initial, ctx))
            self.assertIs(planner_service._call_llm, original_call)
        self.assertEqual(json.loads((output / 'provided_facts-response-1.json').read_text()), {'first': True})
        self.assertEqual(json.loads((output / 'provided_facts-response-2.json').read_text()), {'second': True})

    def test_unfrozen_output_directories_are_preserved(self):
        for module in (answers, diagnostics):
            output = self.output(module)
            output.mkdir()
            (output / 'old-result.json').write_text('{"historical":true}')
            before = snapshot(output)
            self.calls.clear()
            with self.assertRaisesRegex(SystemExit, 'NEW run tag'):
                self.invoke(module)
            self.assertEqual(self.calls, [])
            self.assertEqual(snapshot(output), before)
