import json
import runpy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, AsyncMock
from types import SimpleNamespace

import qa_resume_blind_benchmark as b


class PilotTests(unittest.TestCase):
    def test_single_sample_option_limits_requests_and_freezes_selection(self):
        with tempfile.TemporaryDirectory() as temp:
            base=Path(temp)/'blind'
            source=base.with_name(base.name+'-v4accept20260907e');source.mkdir()
            (source/'fixtures.json').write_text(json.dumps({'samples':[
                {'id':'R7K2','resume':{}},{'id':'N6D2','resume':{}}]}),encoding='utf-8')
            with (patch.object(b,'OUT',base), patch.object(b,'qa_runtime_fingerprint',return_value={'external_notifications_enabled':False}),
                  patch.object(b,'qa_algorithm_hashes',return_value={'code':'test'}),
                  patch.object(b,'call_record',AsyncMock(return_value={'ok':True})) as call,
                  patch('app.database.engine',SimpleNamespace(dispose=AsyncMock())),
                  patch('sys.argv',['qa_resume_score_pilot.py','single','--sample','R7K2'])):
                runpy.run_path(str(Path(__file__).with_name('qa_resume_score_pilot.py')),run_name='__main__')
            self.assertEqual(call.await_count,1)
            output=base.with_name(base.name+'-single')
            protocol=json.loads((output/'protocol.json').read_text(encoding='utf-8'))
            self.assertEqual(protocol['score_requests'],1)
            finished=json.loads((output/'finished.json').read_text(encoding='utf-8'))
            self.assertEqual(finished['results'],[{'id':'R7K2','ok':True}])

    def test_fatal_provider_response_stops_remaining_paid_requests(self):
        with tempfile.TemporaryDirectory() as temp:
            base=Path(temp)/'blind'
            source=base.with_name(base.name+'-v4accept20260907e');source.mkdir()
            (source/'fixtures.json').write_text(json.dumps({'samples':[
                {'id':'R7K2','resume':{}},{'id':'N6D2','resume':{}}]}),encoding='utf-8')
            with (patch.object(b,'OUT',base), patch.object(b,'qa_runtime_fingerprint',return_value={'external_notifications_enabled':False}),
                  patch.object(b,'qa_algorithm_hashes',return_value={'code':'test'}),
                  patch.object(b,'call_record',AsyncMock(return_value={'ok':False,'provider_status':403})) as call,
                  patch('app.database.engine',SimpleNamespace(dispose=AsyncMock())),patch('sys.argv',['qa_resume_score_pilot.py','test'])):
                runpy.run_path(str(Path(__file__).with_name('qa_resume_score_pilot.py')),run_name='__main__')
            self.assertEqual(call.await_count,1)
            finished=json.loads((base.with_name(base.name+'-test')/'finished.json').read_text(encoding='utf-8'))
            self.assertEqual(finished['results'][1]['blocked'],'provider_authorization_or_configuration')


def setUpModule():
    # Exercise historical cache/account contracts with a mocked numeric service.
    # Current CLI rejection is covered without this mock in test_qa_numeric_contract_guard.
    gate = patch("qa_resume_blind_benchmark.reject_retired_numeric_run")
    gate.start()
    unittest.addModuleCleanup(gate.stop)
