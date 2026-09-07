import json
import random
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import runpy

import qa_resume_blind_benchmark as b
from app.domain.ai.resume_evaluation_audit import audit_binding


class GateTests(unittest.TestCase):
    def test_green_summary_cannot_override_failed_judgments_or_changed_provenance(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp) / 'gate'
            data = {'resume': 'synthetic'}
            cases = [{'id': str(i), 'report': {'resumeEvaluation': {'case': i}}, 'expected': '符合' if i == 0 else '不符合'} for i in range(3)]
            protocol = {'rounds': 2, 'seeds': [123, 456], 'target_dimension': '专业表达'}
            runtime = {'external_notifications_enabled': False}
            with patch.object(b, 'OUT', folder), patch.object(b, 'qa_runtime_fingerprint', return_value=runtime):
                b.prepare_frozen_wave_output({'code': 'digest'}, {'fixtures.json': {'input': data, 'cases': cases}, 'protocol.json': protocol})
                b.save('gate-result.json', {'passed': True})
                for index, seed in enumerate(protocol['seeds'], 1):
                    ordered = list(cases); random.Random(seed).shuffle(ordered)
                    b.save(f'audit-gate-{index}.json', {'ok': True, 'value': [
                        {'input_hash': audit_binding(c['report'], data),
                         'dimensions': [{'dimension': '专业表达', 'verdict': c['expected']}]} for c in ordered]})
                b.require_passed_rubric_gate(folder, {'code': 'digest'})
                with self.assertRaises(SystemExit):
                    b.require_passed_rubric_gate(folder, {'code': 'changed'})
                value = json.loads((folder/'audit-gate-2.json').read_text(encoding='utf-8'))
                value['value'][0]['dimensions'][0]['verdict'] = '不确定'
                b.save('audit-gate-2.json', value)
                with self.assertRaises(SystemExit):
                    b.require_passed_rubric_gate(folder, {'code': 'digest'})

    def test_v4_entry_cannot_omit_gate_flag(self):
        with patch('sys.argv', ['qa_resume_blind_final.py', 'ungated']):
            with self.assertRaisesRegex(SystemExit, 'requires'):
                runpy.run_path(str(Path(__file__).with_name('qa_resume_blind_final.py')), run_name='__main__')


def setUpModule():
    # Exercise historical cache/account contracts with a mocked numeric service.
    # Current CLI rejection is covered without this mock in test_qa_numeric_contract_guard.
    gate = patch("qa_resume_blind_benchmark.reject_retired_numeric_run")
    gate.start()
    unittest.addModuleCleanup(gate.stop)
