import json
import unittest
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import AsyncMock,patch
from test_resume_review_v4 import snapshot,raw_v4,report_v4
from app.domain.ai import evidence_rubric_v2 as rubric
from app.domain.resume_optimization import simple_planner as planner,skill_text,apply_service
from app.domain.resume_optimization.schemas import OptimizationAnswer,OptimizationPlan
from app.domain.resume_optimization.normalizers import OptimizationPlanNormalizationError


def skill_report(skill_id="skill-a"):
    data=snapshot();data['resume']['skills']=[dict(id=skill_id,name='Python基础；了解veRL',category='技术')]
    raw=raw_v4(data);raw['suggestions'][0].update(targetId='skill_'+skill_id,skillAction='add_tool',handling='organize',factGaps=[],
        problem='直接补入PyTorch并改成熟练',direction='熟练掌握PyTorch',strategySteps=['写入PyTorch'])
    sources=rubric.source_catalog(data['resume'])
    r=rubric.normalize(raw,sources=sources,modules=rubric.modules_for(data['resume']),context=rubric.assessment_context(data,''),metadata=report_v4(data)['metadata'],inventory=rubric.review_inventory(data['resume'],sources))
    r['selectedSuggestionIds']=['suggestion-1']
    return data,r


class ReviewActionTests(unittest.IsolatedAsyncioTestCase):
    def test_no_change_decision_needs_no_quote_but_edits_still_require_evidence(self):
        r=report_v4();r['expressionPlan'][0]['compress']['spanIds']=[];r['expressionPlan'][0]['lead']['spanIds']=[]
        self.assertEqual(rubric.normalize(r)['overallScore'],r['overallScore'])
        r['expressionPlan'][0]['compress']['status']='adjust'
        with self.assertRaises(ValueError):rubric.normalize(r)
    def test_metric_may_use_own_title_award_but_not_another_experience_or_metadata(self):
        data=snapshot();data['resume']['experiences'][0]['title']='建模竞赛一等奖'
        data['resume']['experiences'].append(dict(data['resume']['experiences'][0],id='exp2',title='其他竞赛二等奖'))
        r=report_v4(data);paths={s['sourceId']:s['path'] for s in r['sources']}
        own=next(s['spanId'] for s in r['evidenceSpans'] if paths[s['sourceRef']]=='resume.experiences[0].title')
        other=next(s['spanId'] for s in r['evidenceSpans'] if paths[s['sourceRef']]=='resume.experiences[1].title')
        identity=next(s['spanId'] for s in r['evidenceSpans'] if paths[s['sourceRef']]=='resume.experiences[0].id')
        r['metricReview'][0]['aspects'][0]['spanIds']=[own]
        self.assertEqual(rubric.normalize(r)['metricReview'][0]['aspects'][0]['spanIds'],[own])
        for bad_id in (other,identity):
            bad=deepcopy(r);bad['metricReview'][0]['aspects'][0]['spanIds']=[bad_id]
            with self.assertRaises(ValueError):rubric.normalize(bad)
        r['expressionPlan'][0]['retain']['spanIds']=[own]
        self.assertEqual(rubric.normalize(r)['expressionPlan'][0]['retain']['spanIds'],[own])
        r['expressionPlan'][0]['compress']['spanIds']=[own]
        with self.assertRaises(ValueError):rubric.normalize(r)

    def test_skill_action_is_server_owned_and_requires_confirmation(self):
        data,r=skill_report();s=r['suggestions'][0]
        self.assertTrue(s['editable']);self.assertTrue(s['needsFacts']);self.assertEqual(s['handling'],'ask_user')
        self.assertNotIn('PyTorch',json.dumps(s,ensure_ascii=False));self.assertEqual(s['factGaps'][0]['kind'],'skill_confirmation')
        self.assertEqual(rubric.normalize(r)['suggestions'],r['suggestions'])

    def test_details_reject_cross_module_spans_missing_aspects_and_unlinked_gaps(self):
        r=report_v4()
        for mutate in [lambda x:x['metricReview'][0]['aspects'].pop(),
                       lambda x:x['metricReview'][0]['aspects'][0].update(status='confirm'),
                       lambda x:x['expressionPlan'][0]['compress'].update(status='adjust'),
                       lambda x:x['expressionPlan'][0]['retain'].update(spanIds=['unknown'])]:
            bad=deepcopy(r);mutate(bad)
            with self.assertRaises(ValueError):rubric.normalize(bad)
        data=snapshot();data['resume']['experiences'].append(dict(data['resume']['experiences'][0],id='exp2'))
        sources=rubric.source_catalog(data['resume']);raw=raw_v4(data)
        raw['expressionPlan'][1]['retain']['spanIds']=raw['expressionPlan'][0]['retain']['spanIds']
        with self.assertRaises(ValueError):rubric.normalize(raw,sources=sources,modules=rubric.modules_for(data['resume']),context=rubric.assessment_context(data,''),metadata=report_v4(data)['metadata'],inventory=rubric.review_inventory(data['resume'],sources))

    async def test_confirmed_skill_is_composed_without_a_model_call_and_skips_preserve_original(self):
        data,r=skill_report();context=SimpleNamespace(evaluation=r,current_resume=data['resume'],selected_source_experiences={},target_role='')
        with patch.object(planner,'_call_llm',AsyncMock()) as call:
            plan=await planner.plan(context);q=plan.questions[0]
            self.assertEqual(q.answer_type,'skill_confirmation');self.assertEqual(q.skill_original['name'],'Python基础；了解veRL')
            for state in ('unknown','skipped','no_data','not_my_work'):
                self.assertEqual(await planner.rewrite(context,plan,[OptimizationAnswer(question_id=q.question_id,state=state)]),[])
            answer=OptimizationAnswer(question_id=q.question_id,state='answered',value=json.dumps(dict(fragments=['Python基础','veRL用于课程实验'],category='项目工具',confirmed=True)))
            changes=await planner.rewrite(context,plan,[answer]);call.assert_not_called()
        self.assertEqual(changes[0].targeted_value,dict(name='Python基础；veRL用于课程实验',category='项目工具'))
        final=plan.model_copy(update={'changes':changes})
        run=SimpleNamespace(before_snapshot={'evaluation':r,'current_resume':data['resume']},policy_version='json_structure_v2',answers_json={'answers':[answer.model_dump(mode='json')]})
        planner.validate_stored_plan(run,final)
        final.changes[0].targeted_value['name']='熟练PyTorch'
        with self.assertRaises(OptimizationPlanNormalizationError):planner.validate_stored_plan(run,final)

    async def test_partial_fact_answers_do_not_unlock_the_target(self):
        r=report_v4();r['selectedSuggestionIds']=['suggestion-1']
        context=SimpleNamespace(evaluation=r,current_resume={'personal_summary':'原文'},selected_source_experiences={},target_role='')
        g=deepcopy(r['suggestions'][0]['factGaps'][0]);g['gapId']='other';r['suggestions'][0]['factGaps'].append(g)
        response={'changes':[dict(targetId='target-1',actionKind='ask_user',generalValue=None,questions=[dict(gapId=x['gapId']) for x in r['suggestions'][0]['factGaps']])]}
        with patch.object(planner,'_call_llm',AsyncMock(return_value={'content':json.dumps(response)})):
            plan=await planner.plan(context)
        answers=[OptimizationAnswer(question_id=plan.questions[0].question_id,state='answered',value='已确认一项'),OptimizationAnswer(question_id=plan.questions[1].question_id,state='unknown')]
        with patch.object(planner,'_call_llm',AsyncMock()) as call:
            self.assertEqual(await planner.rewrite(context,plan,answers),[]);call.assert_not_called()

    async def test_cross_field_reordering_requires_all_fields_selected(self):
        data=snapshot();r=report_v4();r['selectedSuggestionIds']=['suggestion-1']
        r['suggestions'][0].update(moduleType='experience_star',moduleId='exp1',fieldPath='star.a',needsFacts=False,factGaps=[])
        span_ids=[s['spanId'] for s in r['evidenceSpans'] if any(src['sourceId']==s['sourceRef'] and src['path'].endswith(('.star.a','.star.r')) for src in r['sources'])]
        r['expressionPlan'][0]['compress'].update(status='adjust',spanIds=span_ids)
        r['expressionPlan'][0]['diagnosticIds']=['diag-1']
        context=SimpleNamespace(evaluation=r,current_resume={'experiences':{'exp1':data['resume']['experiences'][0]}},selected_source_experiences={},target_role='')
        with patch.object(planner,'_call_llm',AsyncMock()) as call:
            result=await planner.plan(context);call.assert_not_called()
        self.assertEqual(result.changes[0].action_kind,'leave_unchanged');self.assertIsNone(result.changes[0].targeted_value)

    async def test_skill_apply_patch_changes_only_resume_override_and_checks_receipt(self):
        from test_resume_optimization_apply import _run,_base_config,_link,LINK_ID
        from app.domain.resume_optimization.run_service import hash_canonical_json
        data,r=skill_report();context=SimpleNamespace(evaluation=r,current_resume=data['resume'],selected_source_experiences={},target_role='')
        plan=await planner.plan(context);answer=OptimizationAnswer(question_id=plan.questions[0].question_id,state='answered',value=json.dumps(dict(fragments=['Python基础'],category='开发',confirmed=True)))
        changes=await planner.rewrite(context,plan,[answer]);final=plan.model_copy(update={'changes':changes})
        run=_run([]);run.policy_version='json_structure_v2';run.before_snapshot['evaluation']=r
        run.before_snapshot['current_resume']['skills']=data['resume']['skills'];run.answers_json={'answers':[answer.model_dump(mode='json')]}
        run.plan_json=plan.storage_dump();run.result_json=final.storage_dump();run.source_snapshot_hash=hash_canonical_json(run.before_snapshot)
        config=_base_config();config['selection']['skillIds']=['skill-a'];original=deepcopy(config)
        patch_result=apply_service.build_apply_patch(run=run,accepted_change_ids={'target-1'},current_resume_config=config,current_link_overrides={str(LINK_ID):_link().overrides_json})
        self.assertEqual(config,original);self.assertEqual(patch_result.next_resume_config['skillOverrides']['skill-a'],changes[0].targeted_value)
        without=deepcopy(patch_result.next_resume_config);without.pop('skillOverrides');self.assertEqual(without,original)
        config['selection']['skillIds']=[]
        with self.assertRaises(apply_service.OptimizationApplyStaleError):apply_service.build_apply_patch(run=run,accepted_change_ids={'target-1'},current_resume_config=config,current_link_overrides={str(LINK_ID):_link().overrides_json})

    async def test_skill_transaction_applies_and_reverts_without_touching_bank(self):
        from test_resume_optimization_apply import _run,_resume,_link,_transaction_session,_request,USER_ID,RUN_ID
        from test_resume_optimization_finalize import _finalize_session,_revert_request
        from app.domain.resume_optimization.run_service import hash_canonical_json
        identity='88888888-8888-8888-8888-888888888888'
        data,r=skill_report(identity);context=SimpleNamespace(evaluation=r,current_resume=data['resume'],selected_source_experiences={},target_role='')
        plan=await planner.plan(context);answer=OptimizationAnswer(question_id=plan.questions[0].question_id,state='answered',value=json.dumps(dict(fragments=['Python基础'],category='开发',confirmed=True)))
        changes=await planner.rewrite(context,plan,[answer]);final=plan.model_copy(update={'changes':changes})
        for existing in (None,dict(name='Python基础；了解veRL',category='技术')):
            run=_run([]);run.policy_version='json_structure_v2';run.before_snapshot['evaluation']=r
            run.before_snapshot['current_resume']['skills']=data['resume']['skills'];run.answers_json={'answers':[answer.model_dump(mode='json')]}
            run.plan_json=plan.storage_dump();run.result_json=final.storage_dump();run.source_snapshot_hash=hash_canonical_json(run.before_snapshot)
            resume=_resume();resume.config['selection']['skillIds']=[identity];resume.config['jdAnalysis']['result']['resumeEvaluation']=r
            if existing:resume.config['skillOverrides']={identity:existing}
            original=deepcopy(resume.config.get('skillOverrides'));link=_link();session=_transaction_session(run,resume,link)
            base_execute=session.execute
            bank=SimpleNamespace(id=identity);skill=SimpleNamespace(name='Python基础；了解veRL',category='技术')
            async def execute(statement):
                if 'user_skills' in str(statement).lower():return SimpleNamespace(first=lambda:(bank,skill))
                return await base_execute(statement)
            session.execute=execute
            with patch.object(planner,'_call_llm',side_effect=AssertionError('no AI during apply/revert')):
                result=await apply_service.apply_resume_optimization(session=session,user_id=USER_ID,run_id=str(RUN_ID),payload=_request('target-1'))
                self.assertEqual(result.resume.config['skillOverrides'][identity]['name'],'Python基础')
                result=await apply_service.revert_resume_optimization(session=_finalize_session(run,resume,link),user_id=USER_ID,run_id=str(RUN_ID),payload=_revert_request(resume.updated_at))
            self.assertEqual(result.resume.config.get('skillOverrides'),original)
            self.assertEqual(skill.name,'Python基础；了解veRL')


if __name__=='__main__':unittest.main()
