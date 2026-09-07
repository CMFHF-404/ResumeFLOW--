import json
import runpy
from pathlib import Path
import tempfile
import unittest
from unittest.mock import AsyncMock, patch

import qa_resume_blind_benchmark as benchmark


class WaveStateTests(unittest.TestCase):
    def test_wave_freezes_inputs_protocol_code_and_runtime_before_reusing_results(self):
        from app.domain.ai import resume_evaluation_service as evaluation_service

        for changed in ('same', 'input', 'protocol', 'code', 'runtime'):
            with self.subTest(changed=changed), tempfile.TemporaryDirectory() as directory:
                original = Path(directory) / 'benchmark'
                original.mkdir()
                for name, value in (('fixtures.json', {'samples': []}),
                                    ('protocol.json', {'repeats': 3}), ('key-RTEST.json', {})):
                    (original / name).write_text(json.dumps(value), encoding='utf-8')
                output = original.with_name('benchmark-review')
                operation = AsyncMock()

                def load(code='original', runtime='original'):
                    with (patch.object(benchmark, 'OUT', original),
                          patch.object(benchmark, 'IDS', ['RTEST']),
                          patch.object(benchmark, 'run', operation),
                          patch.object(benchmark, 'optimize', benchmark.optimize),
                          patch.object(evaluation_service, '_normalize_response', evaluation_service._normalize_response),
                          patch.object(benchmark, 'qa_algorithm_hashes', return_value={'harness.py': code}),
                          patch.object(benchmark, 'qa_runtime_fingerprint', return_value={'model': runtime}),
                          patch('sys.argv', ['qa_resume_blind_wave.py', 'review'])):
                        runpy.run_path(str(Path(__file__).with_name('qa_resume_blind_wave.py')), run_name='__main__')

                load()
                (output / 'baseline-RTEST-1.json').write_text('{"ok":true,"old_score":10}', encoding='utf-8')
                before = {p.name: p.read_bytes() for p in output.iterdir()}
                operation.reset_mock()
                if changed in ('input', 'protocol'):
                    filename = 'fixtures.json' if changed == 'input' else 'protocol.json'
                    (original / filename).write_text('{"changed":true}', encoding='utf-8')
                if changed == 'same':
                    load()
                    operation.assert_awaited_once_with('qa-blind-20260906')
                else:
                    with self.assertRaisesRegex(SystemExit, 'NEW run tag'):
                        load(code='changed' if changed == 'code' else 'original',
                             runtime='changed' if changed == 'runtime' else 'original')
                    operation.assert_not_called()
                self.assertEqual({p.name: p.read_bytes() for p in output.iterdir()}, before)

    def test_holdout_rejects_changed_inputs_code_protocol_and_runtime_without_writes(self):
        for changed in ('input', 'code', 'protocol', 'runtime'):
            with self.subTest(changed=changed), tempfile.TemporaryDirectory() as directory:
                original = Path(directory) / 'benchmark'
                original.mkdir()
                fixture = {'samples': [{}, {}, {'resume': {
                    'profile': {'name': 'Original'}, 'experiences': [{}],
                }}]}
                (original / 'fixtures.json').write_text(json.dumps(fixture), encoding='utf-8')
                output = original.with_name('benchmark-holdoutreview')
                operation = AsyncMock()

                def load(code='original', runtime='original'):
                    with (patch.object(benchmark, 'OUT', original),
                          patch.object(benchmark, 'IDS', benchmark.IDS.copy()),
                          patch.object(benchmark, 'run', operation),
                          patch.object(benchmark, 'qa_algorithm_hashes', return_value={'harness.py': code}),
                          patch.object(benchmark, 'qa_runtime_fingerprint', return_value={'model': runtime}),
                          patch('sys.argv', ['qa_resume_blind_holdout.py', 'review'])):
                        runpy.run_path(str(Path(__file__).with_name('qa_resume_blind_holdout.py')), run_name='__main__')

                load()
                (output / 'baseline-H4Q1-1.json').write_text('{"ok":true}', encoding='utf-8')
                if changed == 'input':
                    fixture['samples'][2]['resume']['profile']['name'] = 'Changed'
                    (original / 'fixtures.json').write_text(json.dumps(fixture), encoding='utf-8')
                if changed == 'protocol':
                    (output / 'protocol.json').write_text('{"repeats":99}', encoding='utf-8')
                before = {p.name: p.read_bytes() for p in output.iterdir()}
                operation.reset_mock()
                with self.assertRaisesRegex(SystemExit, 'NEW run tag'):
                    load(code='changed' if changed == 'code' else 'original',
                         runtime='changed' if changed == 'runtime' else 'original')
                operation.assert_not_called()
                self.assertEqual({p.name: p.read_bytes() for p in output.iterdir()}, before)

    def test_holdout_entrypoint_allows_new_and_matching_wave_without_replacing_manifest(self):
        with tempfile.TemporaryDirectory() as directory:
            original = Path(directory) / "benchmark"
            original.mkdir()
            (original / "fixtures.json").write_text(json.dumps({
                "samples": [{}, {}, {"resume": {"experiences": [{}]}}],
            }), encoding="utf-8")
            output = Path(directory) / "benchmark-holdoutnew"
            for attempt in range(2):
                operation = AsyncMock()
                with (patch.object(benchmark, "OUT", original),
                      patch.object(benchmark, "IDS", benchmark.IDS.copy()),
                      patch.object(benchmark, "run", operation),
                      patch("sys.argv", ["qa_resume_blind_holdout.py", "new"])):
                    runpy.run_path(str(Path(__file__).with_name("qa_resume_blind_holdout.py")), run_name="__main__")
                operation.assert_awaited_once_with("qa-blind-20260906")
                if attempt == 0:
                    manifest = (output / "algorithm-hashes.json").read_bytes()
                    (output / "baseline-case.json").write_text('{"ok":true}', encoding="utf-8")
                else:
                    self.assertEqual((output / "algorithm-hashes.json").read_bytes(), manifest)
                    self.assertEqual((output / "baseline-case.json").read_text(encoding="utf-8"), '{"ok":true}')

    def test_holdout_entrypoint_rejects_changed_algorithm_before_any_writes_or_calls(self):
        with tempfile.TemporaryDirectory() as directory:
            original = Path(directory) / "benchmark"
            original.mkdir()
            (original / "fixtures.json").write_text(json.dumps({
                "samples": [{}, {}, {"resume": {"experiences": [{}]}}],
            }), encoding="utf-8")
            output = Path(directory) / "benchmark-holdout4"
            output.mkdir()
            (output / "algorithm-hashes.json").write_text('{"old.py":"old"}', encoding="utf-8")
            (output / "baseline-case.json").write_text('{"ok":true}', encoding="utf-8")
            before = {p.name: p.read_bytes() for p in output.iterdir()}
            operation = AsyncMock()
            with (patch.object(benchmark, "OUT", original),
                  patch.object(benchmark, "IDS", benchmark.IDS.copy()),
                  patch.object(benchmark, "run", operation),
                  patch("sys.argv", ["qa_resume_blind_holdout.py", "4"])):
                with self.assertRaisesRegex(SystemExit, "NEW run tag"):
                    runpy.run_path(str(Path(__file__).with_name("qa_resume_blind_holdout.py")), run_name="__main__")
            operation.assert_not_called()
            self.assertEqual({p.name: p.read_bytes() for p in output.iterdir()}, before)

    def test_matching_algorithm_preserves_manifest_and_cached_results(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "wave"
            hashes = {"ai/service.py": "original"}
            with patch.object(benchmark, "OUT", output):
                benchmark.prepare_wave_output(hashes)
                result = output / "baseline-case-1.json"
                result.write_text('{"ok": true}', encoding="utf-8")
                before = {p.name: p.read_bytes() for p in output.iterdir()}
                benchmark.prepare_wave_output(hashes)
                self.assertEqual({p.name: p.read_bytes() for p in output.iterdir()}, before)

    def test_changed_algorithm_fails_before_overwriting_any_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            (output / "algorithm-hashes.json").write_text(json.dumps({"ai/service.py": "old"}), encoding="utf-8")
            (output / "baseline-case-1.json").write_text('{"ok": true}', encoding="utf-8")
            before = {p.name: p.read_bytes() for p in output.iterdir()}
            with patch.object(benchmark, "OUT", output):
                with self.assertRaisesRegex(SystemExit, "NEW run tag"):
                    benchmark.prepare_wave_output({"ai/service.py": "new"})
            self.assertEqual({p.name: p.read_bytes() for p in output.iterdir()}, before)

    def test_unattributed_or_corrupt_existing_wave_is_rejected(self):
        for manifest in (None, "invalid JSON", "[]"):
            with self.subTest(manifest=manifest), tempfile.TemporaryDirectory() as directory:
                output = Path(directory)
                (output / "baseline-case-1.json").write_text('{"ok": true}', encoding="utf-8")
                if manifest is not None:
                    (output / "algorithm-hashes.json").write_text(manifest, encoding="utf-8")
                before = {p.name: p.read_bytes() for p in output.iterdir()}
                with patch.object(benchmark, "OUT", output), self.assertRaises(SystemExit):
                    benchmark.prepare_wave_output({"ai/service.py": "new"})
                self.assertEqual({p.name: p.read_bytes() for p in output.iterdir()}, before)


def setUpModule():
    # Exercise historical cache/account contracts with a mocked numeric service.
    # Current CLI rejection is covered without this mock in test_qa_numeric_contract_guard.
    gate = patch("qa_resume_blind_benchmark.reject_retired_numeric_run")
    gate.start()
    unittest.addModuleCleanup(gate.stop)
