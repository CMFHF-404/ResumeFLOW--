"""Retired numeric entrypoints must fail before billing, seeding or model calls."""
import runpy
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import qa_resume_blind_benchmark as benchmark


class NumericContractGuardTests(unittest.IsolatedAsyncioTestCase):
    async def test_shared_run_and_evaluate_reject_before_side_effects(self):
        with (patch.object(benchmark, 'validate_frozen_run', return_value={'samples': []}),
              patch.object(benchmark, 'save') as save,
              patch('app.database.AsyncSessionFactory') as database,
              patch('app.domain.ai.resume_evaluation_service.analyze_resume_evaluation',
                    AsyncMock()) as provider):
            for operation in (lambda: benchmark.run('qa-blind-20260906'),
                              lambda: benchmark.evaluate({})):
                with self.assertRaisesRegex(SystemExit, 'qa_guidance_audit.py'):
                    await operation()
            save.assert_not_called()
            database.assert_not_called()
            provider.assert_not_awaited()


class NumericCliGuardTests(unittest.TestCase):
    def test_old_clis_reject_before_reading_or_creating_runs(self):
        scripts = (
            'qa_resume_blind_wave.py', 'qa_resume_blind_holdout.py',
            'qa_resume_blind_final.py', 'qa_resume_summary_feedback_probe.py',
            'qa_resume_blind_direct.py', 'qa_resume_score_pilot.py',
            'qa_resume_decode_probe.py',
        )
        for script in scripts:
            with (self.subTest(script=script),
                  patch('sys.argv', [script, 'guardtest']),
                  patch.object(benchmark, 'OUT', benchmark.OUT),
                  patch.object(benchmark, 'IDS', benchmark.IDS.copy()),
                  patch.object(Path, 'read_text', side_effect=AssertionError('fixture read before gate')),
                  patch.object(benchmark, 'prepare_frozen_wave_output') as prepare,
                  patch.object(benchmark, 'call_record', AsyncMock()) as provider):
                with self.assertRaisesRegex(SystemExit, 'qa_guidance_audit.py'):
                    runpy.run_path(str(Path(benchmark.__file__).with_name(script)), run_name='__main__')
                prepare.assert_not_called()
                provider.assert_not_awaited()
