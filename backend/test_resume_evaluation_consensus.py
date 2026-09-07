import copy
import unittest
import asyncio
from unittest.mock import AsyncMock, patch
from app.domain.ai.resume_evaluation_consensus import select_central_evaluation


def report(scores, identity):
    return {"resumeEvaluation":{"dimensions":[{"score":s} for s in scores],"evidence":[identity],"issues":[identity]}}


class ConsensusTests(unittest.TestCase):
    def test_dimension_medoid_rejects_compensating_outlier_despite_same_total(self):
        values=[report([60,60,60,60,20,100],"outlier"),report([60,60,60,60,60,60],"center"),report([60,60,60,60,61,59],"near")]
        original=copy.deepcopy(values)
        chosen=select_central_evaluation(values)
        self.assertIs(chosen,values[1])
        self.assertEqual(chosen["resumeEvaluation"]["evidence"],["center"])
        self.assertEqual(values,original)

    def test_tie_is_conservative_and_does_not_blend_issue_graphs(self):
        low=report([70]*6,"low");high=report([80]*6,"high")
        for values in ([high,low],[low,high]):self.assertIs(select_central_evaluation(values),low)

    def test_empty_is_rejected(self):
        with self.assertRaises(ValueError):select_central_evaluation([])


class ConsensusServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_generation_stamps_server_scoring_version_without_relabeling_history(self):
        import json
        from app.domain.ai import resume_evaluation_service as service
        from app.domain.ai.resume_evaluation import SCORING_VERSION, normalize_resume_evaluation
        from test_resume_evaluation import make_evaluation, TEST_FACT_METADATA
        raw = make_evaluation()
        historical = normalize_resume_evaluation(raw, jd_available=True, fact_metadata=TEST_FACT_METADATA)
        self.assertNotIn("scoringVersion", historical)
        raw["scoringVersion"] = "model_claimed_version"
        payload = json.dumps({"evaluation_scope": "full_resume", "resume": {}, "fact_metadata": TEST_FACT_METADATA})
        with patch.object(service, "_call_llm", AsyncMock(return_value={"resumeEvaluation": raw})):
            generated = await service._analyze_resume_evaluation_once("JD", payload, _repair=False)
        self.assertEqual(generated["resumeEvaluation"]["scoringVersion"], SCORING_VERSION)
        self.assertEqual(generated["resumeEvaluation"]["overallScore"], historical["overallScore"])

    async def test_transport_connect_timeout_is_an_invalid_sample_not_total_failure(self):
        from app.domain.ai import resume_evaluation_service as service
        from app.domain.ai.runtime_budget import AiRuntimeTimeoutError
        low=report([70]*6,"low");high=report([71]*6,"high")
        operation=AsyncMock(side_effect=[AiRuntimeTimeoutError("connect timeout"),low,high,low])
        with patch.object(service,"_analyze_resume_evaluation_once",operation):
            self.assertIs(await service._analyze_resume_evaluation_consensus("JD","resume"),low)
        self.assertEqual(operation.await_count,4)

    async def test_repair_timeout_does_not_discard_two_valid_reports(self):
        from app.domain.ai import resume_evaluation_service as service
        from fastapi import HTTPException
        low=report([70]*6,"low");high=report([71]*6,"high")
        with patch.object(service,"_analyze_resume_evaluation_once",AsyncMock(side_effect=[low,HTTPException(status_code=504),high,HTTPException(status_code=504),HTTPException(status_code=504)])):
            self.assertIs(await service._analyze_resume_evaluation_consensus("JD","resume"),low)

    async def test_three_independent_generations_select_one_whole_report(self):
        from app.domain.ai import resume_evaluation_service as service
        samples=[report([80]*6,"high"),report([60]*6,"low"),report([70]*6,"center")]
        transport=AsyncMock(side_effect=samples)
        with patch.object(service,"_analyze_resume_evaluation_once",transport):
            chosen=await service._analyze_resume_evaluation_consensus("JD","resume")
        self.assertIs(chosen,samples[2])
        self.assertEqual(transport.await_count,3)

    async def test_requires_two_valid_samples_and_never_uses_invalid_scores(self):
        from app.domain.ai import resume_evaluation_service as service
        from app.domain.ai.public_errors import ResumeEvaluationIntegrityError
        error=ResumeEvaluationIntegrityError("invalid evidence")
        with patch.object(service,"_analyze_resume_evaluation_once",AsyncMock(side_effect=[error,report([70]*6,"valid"),error,error,error])):
            with self.assertRaises(ResumeEvaluationIntegrityError):
                await service._analyze_resume_evaluation_consensus("JD","resume")

    async def test_cancellation_does_not_start_another_generation(self):
        from app.domain.ai import resume_evaluation_service as service
        operation=AsyncMock(side_effect=asyncio.CancelledError())
        with patch.object(service,"_analyze_resume_evaluation_once",operation):
            with self.assertRaises(asyncio.CancelledError):
                await service._analyze_resume_evaluation_consensus("JD","resume")
        self.assertEqual(operation.await_count,1)
