from copy import deepcopy
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch

from jsonschema import Draft202012Validator
from test_object_review import raw_object, report_object, snapshot
from app.domain.ai import object_review, evidence_rubric_v2 as history
from app.domain.ai.provider_review_schema import compact
from app.domain.resume_optimization import simple_planner


def metric_fixture(kind='engineering_measurement', reason='需要确认效率提升30%的统计周期和比较基准'):
    data = snapshot()
    data['resume']['experiences'][0]['star']['r'] = '整理流程后工作效率提升30%，交付对账清单。'
    raw = raw_object(data)
    raw['suggestions'][0].update(
        objectId='E1', operationId='star.r', sourceRefs=['E1'],
        factGaps=[dict(kind=kind, reason=reason, sourceRefs=['E1'])])
    return data, raw


class ReviewQuestionAlignmentTests(unittest.IsolatedAsyncioTestCase):
    def test_fact_execution_steps_never_offer_model_supplied_ideal_answers(self):
        data,raw=metric_fixture('method_used','需要确认本人实际使用的方法')
        row=raw['suggestions'][0]
        row.update(direction='补充透视汇总或DID',strategySteps=['确认是否使用SQL并取得90%提升'])
        report=report_object(data,raw);suggestion=report['suggestions'][0]
        self.assertEqual(suggestion['strategySteps'],[g['question'] for g in suggestion['factGaps']])
        shown=suggestion['direction']+' '.join(suggestion['strategySteps'])
        for unconfirmed in ['透视汇总','DID','SQL','90%']:self.assertNotIn(unconfirmed,shown)
        self.assertEqual(suggestion['handling'],'ask_user')
        self.assertEqual(object_review.normalize(report),report)
        # Stored reports are not silently reworded when read or applied.
        historical=deepcopy(report)
        historical['suggestions'][0].update(direction='历史确认策略',strategySteps=['历史步骤'])
        self.assertEqual(object_review.normalize(historical),historical)

    def test_business_measurement_names_object_and_grounded_metric(self):
        data, raw = metric_fixture()
        report = report_object(data, raw)
        question = report['suggestions'][0]['factGaps'][0]['question']
        self.assertIn('费用审核实习', question)
        self.assertIn('企业财务部', question)
        self.assertIn('30%', question)
        self.assertIn('比较基准', question)
        self.assertNotIn('运行、性能或资源', question)
        self.assertEqual(report['overallScore'], 75)
        self.assertEqual(object_review.normalize(report), report)

    def test_financial_verification_does_not_force_experiment_samples(self):
        data, raw = metric_fixture('validation_setup', '需要确认报销审核的复核或验收方式')
        question = report_object(data, raw)['suggestions'][0]['factGaps'][0]['question']
        self.assertIn('费用审核实习', question)
        self.assertIn('复核', question)
        self.assertIn('验收', question)
        self.assertNotIn('评测使用了哪些样本', question)

    def test_question_does_not_copy_unconfirmed_metric_or_foreign_object(self):
        data, raw = metric_fixture(reason='需要确认效率提升90%，建议使用DID')
        other = deepcopy(data['resume']['experiences'][0])
        other.update(id='exp2', title='其他项目', star=dict(s='', t='', a='', r='转化率90%'))
        data['resume']['experiences'].append(other)
        question = report_object(data, raw)['suggestions'][0]['factGaps'][0]['question']
        self.assertNotIn('90%', question)
        self.assertNotIn('DID', question)

    def test_old_persisted_question_keeps_its_original_template(self):
        data, raw = metric_fixture()
        legacy = report_object(data, raw)
        legacy['metadata'].pop('factQuestionVersion', None)
        legacy['suggestions'][0]['factGaps'][0]['question'] = history.FACT_QUESTIONS['engineering_measurement']
        self.assertEqual(object_review.normalize(legacy), legacy)

    def test_known_role_is_not_asked_again_and_does_not_authorize_rewrite(self):
        data = snapshot()
        raw = raw_object(data)
        raw['suggestions'][0]['factGaps'] = [dict(kind='target_role', reason='需要确认方向', sourceRefs=['S'])]
        report = report_object(data, raw)
        row = report['suggestions'][0]
        self.assertFalse(row['editable'])
        self.assertEqual(row['executionBlockReason']['code'], 'fact_already_provided')
        self.assertEqual(row.get('factGaps', []), [])
        self.assertEqual(object_review.normalize(report), report)
        report['selectedSuggestionIds'] = [row['suggestionId']]
        with self.assertRaises(ValueError):
            simple_planner.targets(SimpleNamespace(evaluation=report, current_resume={}))

    def test_known_role_only_removes_redundant_gap_without_losing_real_gap(self):
        data = snapshot()
        raw = raw_object(data)
        raw['suggestions'][0]['factGaps'].append(dict(kind='target_role', reason='方向', sourceRefs=['S']))
        report = report_object(data, raw)
        self.assertEqual([g['kind'] for g in report['suggestions'][0]['factGaps']], ['task_scope'])
        self.assertTrue(report['suggestions'][0]['needsFacts'])
        data['target_role'] = ''
        report = report_object(data, raw)
        self.assertIn('target_role', [g['kind'] for g in report['suggestions'][0]['factGaps']])

    def test_summary_checked_scope_is_derived_without_accepting_unknown_evidence(self):
        data = snapshot()
        raw = raw_object(data)
        raw['suggestions'][0].update(sourceRefs=['E1'], factGaps=[dict(kind='task_scope', reason='确认总结的个人范围', sourceRefs=['E1'])])
        report = report_object(data, raw)
        self.assertTrue(report['suggestions'][0]['editable'])
        raw['suggestions'][0]['sourceRefs'] = ['UNKNOWN']
        self.assertFalse(report_object(data, raw)['suggestions'][0]['editable'])
        raw['suggestions'][0].update(objectId='E1', operationId='star.r', sourceRefs=['S'])
        self.assertFalse(report_object(data, raw)['suggestions'][0]['editable'])

    async def test_final_planning_question_uses_scoped_template_with_one_call(self):
        data, raw = metric_fixture()
        report = report_object(data, raw)
        report['selectedSuggestionIds'] = ['suggestion-1']
        gap = report['suggestions'][0]['factGaps'][0]
        current = deepcopy(data['resume'])
        current['experiences'] = {e['id']: e for e in current['experiences']}
        context = SimpleNamespace(evaluation=report, current_resume=current, selected_source_experiences={}, target_role=data['target_role'])
        call = AsyncMock(return_value={'changes': [dict(targetId='target-1', actionKind='ask_user', generalValue=None,
            rationale='需要口径', questions=[{'gapId': gap['gapId']}])]})
        with patch.object(simple_planner, 'call_json', call):
            plan = await simple_planner.plan(context)
        call.assert_awaited_once()
        self.assertEqual(plan.questions[0].text, gap['question'])
        self.assertIn('30%', plan.questions[0].text)

    def test_optional_selection_for_text_but_explicit_choice_for_courses_and_order(self):
        data = snapshot()
        data['resume']['educations'][0].update(id='edu1', courses='统计学、体育')
        data['resume']['certifications'] = [dict(id='cert1', name='CET-4'), dict(id='cert2', name='CET-6')]
        schema = object_review.response_schema(object_review.source_catalog(data['resume']), [], object_review.modules_for(data['resume']))
        validator = Draft202012Validator(schema)
        raw = raw_object(data)
        raw['suggestions'][0].pop('selectedItems')
        self.assertTrue(validator.is_valid(raw))
        self.assertTrue(Draft202012Validator(compact(schema)).is_valid(raw))
        self.assertEqual(report_object(data, raw)['suggestions'][0]['selectedItems'], [])
        for oid, operation in [('ED1', 'education_courses'), ('CERTS', 'certification_order')]:
            row = raw['suggestions'][0]
            row.update(objectId=oid, operationId=operation, sourceRefs=[oid], handling='organize', factGaps=[])
            row.pop('selectedItems', None)
            self.assertFalse(validator.is_valid(raw))
            self.assertFalse(report_object(data, raw)['suggestions'][0]['editable'])
        row.update(objectId='ED1', operationId='education_courses', sourceRefs=['ED1'], selectedItems=[])
        self.assertTrue(validator.is_valid(raw))
        self.assertTrue(report_object(data, raw)['suggestions'][0]['editable'])
        row.update(objectId='CERTS', operationId='certification_order', sourceRefs=['CERTS'], selectedItems=['C1'])
        self.assertFalse(report_object(data, raw)['suggestions'][0]['editable'])
        row['selectedItems'] = ['C2', 'C1']
        self.assertTrue(report_object(data, raw)['suggestions'][0]['editable'])


if __name__ == '__main__':
    unittest.main()
