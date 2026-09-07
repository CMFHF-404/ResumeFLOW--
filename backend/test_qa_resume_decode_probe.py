import asyncio
import json
import runpy
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import qa_resume_blind_benchmark as benchmark
from app.domain.ai import llm_transport as transport


class DecodeProbeTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.original = Path(self.directory.name) / 'benchmark'
        self.source = self.original.with_name('benchmark-wave4')
        self.source.mkdir()
        self.input = self.source / 'optimization-R2M9-1.json'
        self.input.write_text(json.dumps({'value': {'resume': {'experiences': []}}}))
        self.output = self.original.with_name('benchmark-decode-review')
        self.calls = []
        self.cancel = None

    def snapshot(self):
        return {p.name: p.read_bytes() for p in self.output.iterdir()}

    def run_probe(self, *, model='fixed', hashes=None):
        async def record(name, operation, user_id):
            self.calls.append(name)
            self.assertEqual(transport._build_gemini_request_body()['generationConfig']['temperature'], 0)
            if name == self.cancel:
                raise asyncio.CancelledError()
            result = {'ok': name != 'evaluation-1', 'error_type': 'RetainedFailure', 'value': {}}
            benchmark.save(name + '.json', result)
            return result

        with (patch.object(benchmark, 'OUT', self.original),
              patch.object(benchmark, 'qa_runtime_fingerprint', return_value={'model': model}),
              patch.object(benchmark, 'qa_algorithm_hashes', return_value=hashes or {'probe': 'fixed'}),
              patch.object(benchmark, 'call_record', side_effect=record),
              patch.object(transport, '_build_gemini_request_body', return_value={'generationConfig': {}}),
              patch('app.database.engine', SimpleNamespace(dispose=AsyncMock())),
              patch('sys.argv', ['qa_resume_decode_probe.py', 'review'])):
            saved_builder = transport._build_gemini_request_body
            saved_writer = benchmark.save
            try:
                runpy.run_path(str(Path(__file__).with_name('qa_resume_decode_probe.py')), run_name='__main__')
            finally:
                self.assertIs(transport._build_gemini_request_body, saved_builder)
                self.assertIs(benchmark.save, saved_writer)
                self.assertEqual(benchmark.OUT, self.original)

    def test_repeated_run_preserves_successes_failures_and_manifest(self):
        self.run_probe()
        self.assertTrue((self.output / 'run-manifest.json').exists())
        original = self.snapshot()
        self.calls.clear()
        self.run_probe()
        self.assertEqual(self.calls, [])
        self.assertEqual(self.snapshot(), original)

    def test_cancelled_run_resumes_only_missing_samples(self):
        self.cancel = 'evaluation-2'
        with self.assertRaises(asyncio.CancelledError):
            self.run_probe()
        first = (self.output / 'evaluation-1.json').read_bytes()
        self.cancel = None
        self.calls.clear()
        self.run_probe()
        self.assertEqual(self.calls, ['evaluation-2', 'evaluation-3'])
        self.assertEqual((self.output / 'evaluation-1.json').read_bytes(), first)

    def test_changed_or_damaged_run_is_rejected_before_calls_or_writes(self):
        self.run_probe()
        for change in ('model', 'code', 'input', 'protocol', 'manifest', 'result'):
            with self.subTest(change=change):
                baseline = self.snapshot()
                source = self.input.read_bytes()
                if change == 'input':
                    self.input.write_text(json.dumps({'value': {'resume': {'changed': True}}}))
                if change in ('protocol', 'manifest', 'result'):
                    name = {'protocol': 'protocol.json', 'manifest': 'run-manifest.json',
                            'result': 'evaluation-2.json'}[change]
                    (self.output / name).write_text('broken')
                before = self.snapshot()
                self.calls.clear()
                with self.assertRaisesRegex(SystemExit, 'NEW run tag'):
                    self.run_probe(model='changed' if change == 'model' else 'fixed',
                                   hashes={'probe': 'changed'} if change == 'code' else None)
                self.assertEqual(self.calls, [])
                self.assertEqual(self.snapshot(), before)
                for name, data in baseline.items():
                    (self.output / name).write_bytes(data)
                self.input.write_bytes(source)

    def test_exclusive_writer_cannot_replace_existing_evidence(self):
        module = runpy.run_path(str(Path(__file__).with_name('qa_resume_decode_probe.py')))
        self.output.mkdir()
        with patch.object(benchmark, 'OUT', self.output):
            module['save_exclusive']('evaluation-1.json', {'ok': False})
            before = self.snapshot()
            with self.assertRaises(FileExistsError):
                module['save_exclusive']('evaluation-1.json', {'ok': True})
            self.assertEqual(self.snapshot(), before)

    def test_unfrozen_existing_directory_is_preserved(self):
        self.output.mkdir()
        (self.output / 'evaluation-1.json').write_text('{"historical":true}')
        before = self.snapshot()
        with self.assertRaisesRegex(SystemExit, 'NEW run tag'):
            self.run_probe()
        self.assertEqual(self.calls, [])
        self.assertEqual(self.snapshot(), before)

    def test_cli_requires_explicit_safe_tag_before_accessing_inputs(self):
        script = str(Path(__file__).with_name('qa_resume_decode_probe.py'))
        for args in ([], ['../old'], ['one', 'two']):
            with self.subTest(args=args), patch('sys.argv', [script, *args]):
                with self.assertRaisesRegex(SystemExit, 'NEW_RUN_TAG'):
                    runpy.run_path(script, run_name='__main__')


def setUpModule():
    # Exercise historical cache/account contracts with a mocked numeric service.
    # Current CLI rejection is covered without this mock in test_qa_numeric_contract_guard.
    gate = patch("qa_resume_blind_benchmark.reject_retired_numeric_run")
    gate.start()
    unittest.addModuleCleanup(gate.stop)
