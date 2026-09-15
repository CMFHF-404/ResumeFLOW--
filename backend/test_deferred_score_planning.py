import json
import unittest
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from test_object_review import raw_object, report_object, snapshot
from app.domain.ai import object_review as rubric
from app.domain.resume_optimization import simple_planner as planner, context_service
from app.domain.resume_optimization.schemas import OptimizationAnswer
from app.domain.resume_optimization.normalizers import OptimizationPlanNormalizationError


def deferred_context(operation='personal_summary', object_id='S', data=None):
    data=data or snapshot();raw=raw_object(data)
    row=raw['suggestions'][0]
    row.update(objectId=object_id,operationId=operation,problem='信息重点不清晰',direction='突出与岗位相关的个人工作和成果')
    sources=rubric.source_catalog(data['resume']);modules=rubric.modules_for(data['resume'])
    schema=rubric.generation_response_schema(sources,[],modules)
    raw['suggestions']=[{k:v for k,v in row.items() if k in schema['properties']['suggestions']['items']['properties']}]
    for dim in raw['dimensions']:dim.pop('sourceRefs');dim.pop('jdSourceRefs')
    meta=report_object(data)['metadata']|dict(evidenceOutputVersion=rubric.EVIDENCE_OUTPUT_VERSION,suggestionDetailVersion=rubric.SUGGESTION_DETAIL_VERSION)
    report=rubric.normalize(raw,sources=sources,modules=modules,context=rubric.assessment_context(data,''),metadata=meta)
    report['selectedSuggestionIds']=['suggestion-1']
    return SimpleNamespace(evaluation=report,current_resume=context_service._allowlist_current_resume(data['resume'],target_role=data['target_role']),
                           target_role=data['target_role'],selected_source_experiences={})


class DeferredScorePlanningTests(unittest.IsolatedAsyncioTestCase):
    def test_report_has_no_steps_or_fact_verdict_and_roundtrips(self):
        context=deferred_context();report=context.evaluation
        row=report['suggestions'][0]
        self.assertTrue(row['editable']);self.assertTrue(row['planningDeferred'])
        for key in ('strategySteps','factGaps','executionRequirements'):self.assertEqual(row[key],[])
        self.assertFalse(row['needsFacts']);self.assertEqual(row['impact'],'')
        restored=rubric.normalize(report)
        self.assertEqual(restored['suggestions'],report['suggestions'])
        invalid=deepcopy(report);invalid['suggestions'][0]['operationId']='foreign_operation'
        self.assertFalse(rubric.normalize(invalid)['suggestions'][0]['editable'])

    async def test_optimizer_can_ask_new_questions_then_rewrite_only_answered_target(self):
        context=deferred_context()
        response=dict(changes=[dict(targetId='target-1',actionKind='ask_user',generalValue=None,targetedValue=None,
            rationale='先确认实际负责范围',questions=[dict(text='这项工作中你负责哪些部分？',reason='确定个人贡献范围',
                choices=[dict(label='负责需求调研',value='不可隐藏加入结果'),dict(label='负责原型设计')])])])
        with patch.object(planner,'call_json',AsyncMock(return_value=response)) as call:
            plan=await planner.plan(context)
        call.assert_awaited_once()
        payload=json.loads(call.call_args.args[0][1]['content'])
        self.assertEqual(set(payload['targets'][0]['suggestions'][0]),{'suggestionId','problem','direction'})
        self.assertEqual(len(plan.questions),1)
        self.assertEqual(plan.questions[0].text,'这项工作中你负责哪些部分？')
        self.assertEqual([(c.label,c.value) for c in plan.questions[0].choices],
                         [('负责需求调研','负责需求调研'),('负责原型设计','负责原型设计')])
        with patch.object(planner,'call_json',AsyncMock()) as skipped:
            self.assertEqual(await planner.rewrite(context,plan,[]),[])
        skipped.assert_not_awaited()
        answers=[OptimizationAnswer(question_id=plan.questions[0].question_id,state='answered',value='负责需求调研和原型设计')]
        with patch.object(planner,'call_json',AsyncMock(return_value=dict(changes=[dict(changeId='target-1',
            generalValue='负责需求调研和原型设计。',targetedValue='负责需求调研和原型设计。',rationale='依据本轮回答整理')]))) as rewrite:
            changes=await planner.rewrite(context,plan,answers)
        rewrite.assert_awaited_once();self.assertEqual(len(changes),1)
        self.assertEqual(changes[0].module_type,'personal_summary')

    def test_optional_choices_are_bounded_deduplicated_and_never_hidden_values(self):
        self.assertEqual(planner.question_choices(None),[])
        result=planner.question_choices([None,{},dict(label=''),dict(label='x'*81),
            dict(label=' 问卷 ',value='虚构成果'),dict(label='问卷'),dict(label='访谈'),dict(label='两者'),dict(label='未开展'),dict(label='更多')])
        self.assertEqual(result,[dict(label=x,value=x) for x in ['问卷','访谈','两者','未开展']])

    async def test_optimizer_can_rewrite_existing_facts_or_leave_unchanged(self):
        for action in ('rewrite_now','leave_unchanged'):
            value='据已有内容整理的摘要' if action=='rewrite_now' else None
            with self.subTest(action=action),patch.object(planner,'call_json',AsyncMock(return_value=dict(changes=[
                dict(targetId='target-1',actionKind=action,generalValue=value,targetedValue=value,rationale='保留事实边界',questions=[])]))):
                plan=await planner.plan(deferred_context())
                self.assertEqual(plan.changes[0].action_kind,action);self.assertEqual(plan.questions,[])

    async def test_question_limits_and_target_scope_still_apply(self):
        from app.config import load_settings
        questions=[dict(text=f'确认事项{i}',reason='需要事实') for i in range(load_settings().resume_optimization_max_questions+1)]
        for target,items in [('target-1',questions),('foreign',questions[:1])]:
            with patch.object(planner,'call_json',AsyncMock(return_value=dict(changes=[dict(targetId=target,
                actionKind='ask_user',generalValue=None,targetedValue=None,rationale='需确认',questions=items)]))):
                with self.assertRaises(OptimizationPlanNormalizationError):await planner.plan(deferred_context())

    async def test_old_report_keeps_bound_question_contract(self):
        context=deferred_context();context.evaluation=report_object()
        context.evaluation['selectedSuggestionIds']=['suggestion-1']
        response=dict(changes=[dict(targetId='target-1',actionKind='ask_user',generalValue=None,targetedValue=None,
            rationale='需要确认',questions=[dict(text='未绑定的追问',reason='原因')])])
        with patch.object(planner,'call_json',AsyncMock(return_value=response)):
            with self.assertRaises(OptimizationPlanNormalizationError):await planner.plan(context)

    async def test_skill_confirmation_is_deferred_to_optimizer(self):
        data=snapshot();data['resume']['skills']=[dict(id='skill-1',name='Python基础',category='工具')]
        context=deferred_context('skill_text','K1',data)
        row=context.evaluation['suggestions'][0]
        self.assertEqual(row['factGaps'],[]);self.assertTrue(row['planningDeferred'])
        self.assertEqual(rubric.normalize(context.evaluation)['suggestions'],context.evaluation['suggestions'])
        with patch.object(planner,'call_json',AsyncMock()) as call:
            plan=await planner.plan(context)
        call.assert_not_awaited()
        self.assertEqual(plan.questions[0].answer_type,'skill_confirmation')
        self.assertEqual(plan.changes[0].action_kind,'ask_user')

    def test_deferred_sorting_preserves_action_through_persistence(self):
        data=snapshot();data['resume']['skills']=[dict(id='skill-1',name='Python基础',category='工具')]
        for operation,object_id in [('section_order','SECTIONS'),('skills_order','SKILLS')]:
            with self.subTest(operation=operation):
                report=deferred_context(operation,object_id,data).evaluation
                row=report['suggestions'][0]
                self.assertTrue(row['editable']);self.assertFalse(row['needsFacts'])
                self.assertEqual(row['action'],'move_forward')
                self.assertEqual(rubric.normalize(report)['suggestions'],report['suggestions'])


if __name__=='__main__':unittest.main()

