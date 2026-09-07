import copy
import unittest
from unittest.mock import AsyncMock, patch
import httpx

from app.domain.ai import resume_evaluation_service as service
from app.domain.ai.resume_evaluation_consensus import evaluation_dispersion
from test_resume_evaluation_consensus import report
from test_resume_evaluation import make_evaluation


class V3ConsensusTests(unittest.IsolatedAsyncioTestCase):
    async def test_disagreement_uses_remaining_attempts_not_more_than_five(self):
        values = [report([60]*6, str(i)) for i in range(5)]
        values[1] = report([90]*6, 'outlier')
        model = AsyncMock(side_effect=values)
        with patch.object(service, '_analyze_resume_evaluation_once', model):
            result = await service._analyze_resume_evaluation_consensus_v3('JD', 'resume')
        self.assertEqual(model.await_count, 5)
        self.assertEqual(result['resumeEvaluation']['dimensions'][0]['score'], 60)

    async def test_raw_connect_failure_does_not_discard_valid_reports(self):
        model = AsyncMock(side_effect=[report([70]*6, 'one'), httpx.ConnectError('secret URL'), report([71]*6, 'two'), report([70]*6, 'three')])
        with patch.object(service, '_analyze_resume_evaluation_once', model):
            result = await service._analyze_resume_evaluation_consensus_v3('JD', 'resume')
        self.assertEqual(model.await_count, 4)
        self.assertIsNotNone(result)

    def test_single_result_never_proves_stability(self):
        self.assertEqual(evaluation_dispersion([report([70]*6, 'one')])['status'], 'insufficient_samples')

    def test_new_generation_cannot_omit_binding_and_diagnostics_do_not_leak_text(self):
        with self.assertRaises(ValueError):
            service._materialize_generation_deductions({'resumeEvaluation': make_evaluation()}, require_bindings=True)
        category, field = service._validation_diagnostic(ValueError('unknown evidence secret-token https://private.test'))
        self.assertEqual(category, 'reference')
        self.assertEqual(field, 'resumeEvaluation')

    async def test_cancellation_is_propagated_without_another_attempt(self):
        import asyncio
        model = AsyncMock(side_effect=asyncio.CancelledError())
        with patch.object(service, '_analyze_resume_evaluation_once', model):
            with self.assertRaises(asyncio.CancelledError):
                await service._analyze_resume_evaluation_consensus_v3('JD', 'resume')
        self.assertEqual(model.await_count, 1)

    def test_deductions_are_computed_from_explicit_subscore_bindings(self):
        raw = make_evaluation()
        for d in raw['dimensions']:
            for sub in d['subscores']:
                sub['score'] = sub['maxScore']
                sub['deductionIssueId'] = ''
        raw['issues'] = [{'issueId': 'defect', 'primaryDimension': '专业表达', 'evidenceIds': ['E1'], 'pointsNotEarned': 99}]
        sub = next(d for d in raw['dimensions'] if d['dimension']=='专业表达')['subscores'][0]
        sub['score'] = 15
        sub['deductionIssueId'] = 'defect'
        result = service._materialize_generation_deductions({'resumeEvaluation': raw})
        self.assertEqual(result['resumeEvaluation']['issues'][0]['pointsNotEarned'], 5)
        self.assertNotIn('deductionIssueId', result['resumeEvaluation']['dimensions'][0]['subscores'][0])
        self.assertEqual(raw['issues'][0]['pointsNotEarned'], 99)
        sub['deductionIssueId'] = 'missing'
        with self.assertRaises(ValueError):
            service._materialize_generation_deductions({'resumeEvaluation': raw})
