import unittest
from unittest.mock import AsyncMock, patch

from app.domain.ai import prompts, resume_evaluation_audit as audit
from test_resume_evaluation import make_evaluation
from test_resume_evaluation_audit import verdicts


class SharedRubricTests(unittest.IsolatedAsyncioTestCase):
    async def test_generation_and_audit_share_score_and_calibration_contract(self):
        from app.domain.ai.resume_evaluation_rubric import SHARED_RUBRIC
        self.assertIn(SHARED_RUBRIC, prompts.RESUME_EVALUATION)
        with patch.object(audit, '_call_llm', AsyncMock(return_value=verdicts(1))) as model:
            await audit.audit_reports([{'resumeEvaluation': make_evaluation()}], {})
        self.assertIn(SHARED_RUBRIC, model.call_args.args[0][0]['content'])
        self.assertNotIn('or professional-expression issue', prompts.RESUME_EVALUATION)

    def test_shared_rubric_change_invalidates_audit_receipt(self):
        from app.domain.ai.resume_evaluation_rubric import SHARED_RUBRIC
        report = {'resumeEvaluation': make_evaluation()}
        before = audit.audit_binding(report, {})
        with patch.object(audit, 'SHARED_RUBRIC', SHARED_RUBRIC + ' amended'):
            self.assertNotEqual(before, audit.audit_binding(report, {}))

    def test_extended_gold_fixtures_are_valid_and_cover_both_sides(self):
        from pathlib import Path
        from qa_resume_v4_rubric_cases import make_cases
        from qa_resume_blind_benchmark import JD, ROLE
        source = Path(__file__).resolve().parents[1] / 'docs/qa/2026-09-06-resume-blind-v3accept20260907a'
        data, cases = make_cases(source, JD, ROLE)
        self.assertEqual(len(cases), 9)
        correct_complete = next(c['report']['resumeEvaluation'] for c in cases if c['id'] == 'D1A4')
        complete = next(d for d in correct_complete['dimensions'] if d['dimension'] == '内容完整')
        reasons = [i['description'] for i in correct_complete['issues'] if i['issueId'] in complete['issues']]
        self.assertTrue(any('电话' in x for x in reasons))
        self.assertTrue(any('项目或证书' in x for x in reasons))
        correct_quant = next(c['report']['resumeEvaluation'] for c in cases if c['id'] == 'Q1A4')
        quant = next(d for d in correct_quant['dimensions'] if d['dimension'] == '成果量化')
        self.assertEqual({s['name']:s['score'] for s in quant['subscores']},
            {'结果指标':0,'基线与前后对比':0,'覆盖规模':0,'时间窗口':0,'过程数量':10,'数据可信度':10})
        for dimension in ('专业表达', '内容完整', '内容可读', '成果量化'):
            self.assertEqual({c['expected'] for c in cases if c['target_dimension'] == dimension}, {'符合', '不符合'})
