"""v4 contract tests; synthetic fixtures do not certify HR quality."""
import asyncio
import json
import unittest
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from test_evidence_resume_score import snapshot, raw_report
from app.domain.ai import evidence_rubric as v3, evidence_rubric_v2 as v4, resume_score
from app.domain.ai.public_errors import ResumeEvaluationIntegrityError
from app.domain.resume_optimization import simple_planner as planner, context_service as cs
from app.domain.resume_optimization.normalizers import OptimizationPlanNormalizationError
from app.domain.resume_optimization.schemas import OptimizationAnswer


def raw_v4(data=None,jd=''):
    data=data or snapshot();raw=raw_report(data,jd)
    for d in raw['dimensions']:
        for c in d['criteria']:
            c.update(anchorId=f"{c['criterionId']}:L{c['level']}",unmetConditions=[dict(conditionId=f"{c['criterionId']}:L4",reason='局部证据尚待补充')],gapExplanation='')
    row=raw['suggestions'][0]
    row.update(diagnosticId='diag-1',primaryCriterionId='contribution_1',handling='ask_user',severity='medium',
               recommendationKind='fix',skillAction=None,evidenceSpanIds=[],strategyType='existing_edit',selectedItems=[],candidateText=None,candidateSourceRef=None,
               strategySteps=['先确认实际负责的核查对象与范围','在对应经历中据实说明个人承担的环节'],
               factGaps=[dict(kind='task_scope',question='实际承担的核查对象与范围是什么？',reason='明确个人责任范围',sourceRefs=row['sourceRefs'][:])])
    inventory=v4.review_inventory(data['resume'],v4.source_catalog(data['resume'],jd))
    raw['reviewChecks']=[dict(checkId=c['checkId'],status='findings' if c['checkId']=='positioning' else 'clear',
                              reason='已根据当前内容检查',sourceRefs=c['scopeRefs'][:],diagnosticIds=['diag-1'] if c['checkId']=='positioning' else []) for c in inventory]
    sources=v4.source_catalog(data['resume'],jd);spans=v4.review_actions.fragments(sources)
    paths={s['sourceId']:s['path'] for s in sources}
    raw['expressionPlan']=[];raw['metricReview']=[]
    for i,e in enumerate(data['resume']['experiences']):
        ids=[s['spanId'] for s in spans if paths[s['sourceRef']].startswith(f'resume.experiences[{i}].star.')][:1]
        part=dict(status='retain' if ids else 'not_applicable',reason='已有具体场景与行动，保留理解所需的内容',spanIds=ids)
        raw['expressionPlan'].append(dict(moduleId=e['id'],retain=deepcopy(part),compress=deepcopy(part),lead=deepcopy(part),readingOrder=['problem_result','personal_actions','validation'],diagnosticIds=[]))
        raw['metricReview'].append(dict(moduleId=e['id'],aspects=[dict(aspect=a,status='stated' if ids else 'not_applicable',reason='依当前经历的结果信息判断',spanIds=ids,diagnosticIds=[]) for a in v4.review_actions.METRIC_ASPECTS]))
    return raw


def report_v4(data=None,jd=''):
    data=data or snapshot();sources=v4.source_catalog(data['resume'],jd)
    return v4.normalize(raw_v4(data,jd),sources=sources,modules=v4.modules_for(data['resume']),context=v4.assessment_context(data,jd),
        metadata=dict(promptVersion=v4.PROMPT_VERSION,rubricVersion=v4.SCORING_VERSION,guideVersion=v4.GUIDE_VERSION,
                      responseSchemaVersion=v4.RESPONSE_SCHEMA_VERSION,
                      inputHash=v4.binding(data,jd),model='test-double',provider='fixture',transport='mock',reasoning={'geminiThinkingLevel':'low'}),
        jd_match=88 if jd else None,inventory=v4.review_inventory(data['resume'],sources))


class ReviewV4Tests(unittest.IsolatedAsyncioTestCase):
    def test_all_18_criteria_have_distinct_five_level_anchors(self):
        expected={f'{d}_{i+1}' for d,_,_,_ in v4.DIMENSIONS for i in range(3)}
        self.assertEqual(set(v4.ANCHORS),expected)
        for anchor in v4.ANCHORS.values():
            self.assertEqual(len(set(anchor['levels'])),5)
            self.assertTrue(anchor['positive']);self.assertTrue(anchor['counter'])

    def test_reading_body_ignores_field_distribution_and_preserves_text_and_dates(self):
        a=snapshot();b=deepcopy(a)
        a['resume']['experiences'][0]['star']=dict(s='问题背景',t='负责对象',a='具体行动',r='交付结果')
        b['resume']['experiences'][0]['star']=dict(s='',t='',a='问题背景\n负责对象\n具体行动\n交付结果',r='')
        views=[v4.reading_view(x['resume'],v4.source_catalog(x['resume'])) for x in (a,b)]
        self.assertEqual(views[0]['experiences'][0]['body'],views[1]['experiences'][0]['body'])
        self.assertEqual(len(views[1]['experiences'][0]['blocks']),1)
        a['resume']['experiences'][0]['start_date']='2025-06'
        view=v4.reading_view(a['resume'],v4.source_catalog(a['resume']))
        self.assertEqual(view['experiences'][0]['dates']['presentation'],'single_date_or_open_end')
        self.assertEqual(view['educations'][0]['end_date'],'2027-06')

    def test_inventory_covers_modules_and_missing_skills_without_inventing_content(self):
        data=snapshot();items=v4.review_inventory(data['resume'],v4.source_catalog(data['resume']))
        ids={i['checkId'] for i in items}
        self.assertTrue({'positioning','education_1','academic_evidence','skills_evidence','awards_credentials',
                         'experience_1_contribution','experience_1_outcomes','experience_1_selection','expression','time_consistency','reading_order'}<=ids)
        self.assertTrue(all(i['scopeRefs'] for i in items))
        r=report_v4();self.assertEqual(v4.normalize(r),r)
        self.assertEqual(next(c for c in r['reviewCoverage'] if c['area']=='positioning')['status'],'findings')
        r['reviewChecks'][1]['sourceRefs'].append(r['sources'][0]['sourceId'])
        self.assertEqual(len(v4.normalize(r)['reviewChecks'][1]['sourceRefs']),2)
        self.assertEqual(r['overallScore'],75)
        self.assertEqual(r['suggestions'][0]['factGaps'][0]['gapId'],'diag-1-gap-1')

    async def test_v4_dispatch_single_call_and_scoring_only_model_overrides(self):
        from test_object_review import raw_object
        data=snapshot();call=AsyncMock(return_value={'content':json.dumps(raw_object(data))})
        with patch.object(v3,'enabled',return_value=True),patch.object(v4,'enabled',return_value=True),patch.object(resume_score,'_call_llm',call):
            out=await resume_score.generate_score('',json.dumps(data))
        self.assertEqual(out['resumeEvaluation']['evaluationVersion'],v4.VERSION)
        call.assert_awaited_once()
        payload=json.loads(call.call_args.args[0][1]['content'])
        self.assertNotIn('resume',payload)
        self.assertIn('objects',payload);self.assertNotIn('reviewInventory',payload)
        self.assertIn('openai_response_json_schema',call.call_args.kwargs)
        self.assertEqual(call.call_args.kwargs['model'],'gpt-5.6-luna')
        self.assertEqual(call.call_args.kwargs['lane'],'resume_review')
        self.assertNotIn('sources',payload)
        self.assertEqual(call.call_args.kwargs['gemini_thinking_level'],'medium')
        with patch.object(resume_score,'_call_llm',AsyncMock(return_value={'content':json.dumps(raw_object(data))})) as model_call:
            await resume_score.generate_review_score('',json.dumps(data),model='gemini-test-model',thinking_level='high')
        self.assertEqual(model_call.call_args.kwargs['model'],'gemini-test-model')
        self.assertIn('gemini_response_json_schema',model_call.call_args.kwargs)
        self.assertEqual(model_call.call_args.kwargs['gemini_thinking_level'],'high')
        with patch.object(resume_score,'_call_llm',AsyncMock(return_value={'content':json.dumps(raw_report(data))})) as legacy_call:
            await resume_score.generate_evidence_score('',json.dumps(data))
        self.assertEqual(legacy_call.call_args.kwargs['gemini_thinking_level'],'low')

    async def test_missing_direction_notice_is_server_owned_and_not_a_score_penalty(self):
        from test_object_review import raw_object
        data=snapshot();data['target_role']='';raw=raw_object(data);raw['contextNotice']='模型随意提示'
        with patch.object(resume_score,'_call_llm',AsyncMock(return_value={'content':json.dumps(raw)})):
            r=(await resume_score.generate_review_score('',json.dumps(data)))['resumeEvaluation']
        self.assertEqual(r['contextNotice'],v4.NO_TARGET_NOTICE)
        self.assertEqual(r['overallScore'],75)

    async def test_selected_skill_boundaries_reach_model_without_hidden_candidate_skills(self):
        from test_object_review import raw_object
        data=snapshot()
        data['resume']['skills']=[
            dict(id='basic',name='具备Python/C++基础开发经验',category='编程'),
            dict(id='aware',name='了解LangGraph/LangChain与ReAct等编排范式',category='Agent编排'),
        ]
        data['match_candidates']={'skills':[dict(id='hidden',name='PyTorch',category='隐藏技能')]}
        call=AsyncMock(return_value={'content':json.dumps(raw_object(data))})
        with patch.object(resume_score,'_call_llm',call):
            await resume_score.generate_review_score('',json.dumps(data),model='gemini-3.5-flash-lite',thinking_level='medium')
        call.assert_awaited_once()
        payload=json.loads(call.call_args.args[0][1]['content'])
        skills=[o for o in payload['objects'] if o['kind']=='skill']
        self.assertEqual([o['label'] for o in skills],[s['name'] for s in data['resume']['skills']])
        self.assertEqual(skills[0]['fields']['K1.category'],'编程')
        self.assertNotIn('reviewInventory',payload)
        self.assertNotIn('PyTorch',json.dumps(payload,ensure_ascii=False))
        from app.domain.ai.llm_transport import _build_gemini_generate_body
        body=_build_gemini_generate_body(call.call_args.args[0],model='gemini-3.5-flash-lite',
            gemini_thinking_level='medium',response_json_schema=call.call_args.kwargs['gemini_response_json_schema'])
        wire_payload=json.loads(body['contents'][0]['parts'][0]['text'])
        self.assertEqual(wire_payload,payload)

    def test_bad_coverage_anchor_or_fact_links_fail_closed(self):
        for mutate in [lambda r:r['reviewChecks'].pop(),lambda r:r['reviewChecks'][0].update(diagnosticIds=[]),
                       lambda r:r['reviewChecks'][1].update(sourceRefs=[r['sources'][0]['sourceId']]),
                       lambda r:r['dimensions'][0]['criteria'][0].update(anchorId='outcomes_1:L3'),
                       lambda r:r['dimensions'][0]['criteria'][0].update(unmetConditions=[]),
                       lambda r:r['suggestions'][0].update(handling='organize'),
                       lambda r:r['metadata'].pop('readingVersion'),
                       lambda r:r['suggestions'][0].update(primaryCriterionId='unknown')]:
            r=report_v4();mutate(r)
            with self.assertRaises(ValueError):v4.normalize(r)
        r=report_v4();r['suggestions'][0]['severity']='high'
        with self.assertRaises(ValueError):v4.normalize(r)
        r['dimensions'][1]['criteria'][0]['gapExplanation']='缺口为局部范围说明，已有主要任务信息支持本档'
        self.assertEqual(v4.normalize(r)['overallScore'],75)

    async def test_invalid_response_and_unsupported_profile_do_not_retry(self):
        call=AsyncMock(return_value={'content':'{}'})
        with patch.object(resume_score,'_call_llm',call),self.assertRaises(ResumeEvaluationIntegrityError):
            await resume_score.generate_review_score('',json.dumps(snapshot()))
        call.assert_awaited_once()
        with patch.object(resume_score,'_call_llm',AsyncMock()) as call,self.assertRaises(ResumeEvaluationIntegrityError):
            await resume_score.generate_review_score('',json.dumps(snapshot()),thinking_level='unsupported')
        call.assert_not_called()

    async def test_v4_fact_questions_use_existing_neutral_questions(self):
        r=report_v4();r['selectedSuggestionIds']=['suggestion-1']
        context=SimpleNamespace(evaluation=r,current_resume={'personal_summary':'原文'},selected_source_experiences={},target_role='财务')
        row=dict(targetId='target-1',actionKind='ask_user',generalValue=None,rationale='需补事实',questions=[{'gapId':'diag-1-gap-1'}])
        with patch.object(planner,'_call_llm',AsyncMock(return_value={'content':json.dumps({'changes':[row]})})) as call:
            plan=await planner.plan(context)
        call.assert_awaited_once()
        self.assertEqual(plan.questions[0].text,r['suggestions'][0]['factGaps'][0]['question'])
        self.assertNotIn('零差错',plan.questions[0].text)
        row['questions']=[{'text':'是否做到零差错？','reason':'补成绩'}]
        with patch.object(planner,'_call_llm',AsyncMock(return_value={'content':json.dumps({'changes':[row]})})),self.assertRaises(OptimizationPlanNormalizationError):
            await planner.plan(context)
        call=AsyncMock(return_value={'content':json.dumps({'changes':[dict(changeId='target-1',generalValue='依据用户已补事实整理',rationale='整理')]})})
        with patch.object(planner,'_call_llm',call):
            answer=OptimizationAnswer(question_id=plan.questions[0].question_id,state='answered',value='核查一家子公司的差旅报销')
            rewritten=await planner.rewrite(context,plan,[answer])
        call.assert_awaited_once();self.assertEqual(len(rewritten),1)

    async def test_v4_context_uses_server_inventory_and_current_version(self):
        import test_resume_optimization_context as f
        data=f._frontend_snapshot_from_analysis_text(f._analysis_text())
        from test_object_review import report_object
        resume=f._resume();r=report_object(data,jd='Product manager JD')
        resume.config['jdAnalysis']['result']['resumeEvaluation']=r
        signature=f._frontend_evaluation_signature(data,result=resume.config['jdAnalysis']['result'])
        resume.config['jdAnalysis']['evaluationSignature']=signature
        fixture=f._ContextFixture(self,resume=resume,use_guidance_receipt_stub=False)
        with patch.object(cs,'build_legacy_frozen_optimization_context',cs.build_frozen_optimization_context),patch.object(v4,'enabled',return_value=True):
            frozen,_,_=await fixture.build(request=f._request(evaluation_signature=signature,selected_suggestion_ids=['suggestion-1']))
        self.assertEqual(frozen.evaluation['evaluationVersion'],v4.VERSION)

    async def test_v4_stored_apply_and_revert_keep_scoped_writes(self):
        import test_evidence_resume_score as existing
        case=existing.EvidenceScoreTests('test_v3_apply_read_revert_without_any_extra_model_call')
        with patch.object(existing,'normalized',side_effect=lambda:report_v4()):
            await case.test_v3_apply_read_revert_without_any_extra_model_call()


if __name__=='__main__':unittest.main()
