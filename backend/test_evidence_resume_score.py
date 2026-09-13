"""Engineering fixtures, never HR-quality ground truth."""
import asyncio
import json
import os
import unittest
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

os.environ.setdefault('DATABASE_URL', 'postgresql+asyncpg://user:password@localhost:5432/resumeflow')
os.environ.setdefault('LOGTO_ISSUER', 'https://example.logto.app/oidc')
os.environ.setdefault('LOGTO_APP_ID', 'resume-spa-app-id')
from app.domain.ai import evidence_rubric as rubric, resume_score
from app.domain.ai.public_errors import ResumeEvaluationIntegrityError
from app.domain.resume_optimization import simple_planner as planner, context_service as cs, apply_service
from app.domain.resume_optimization.normalizers import OptimizationPlanNormalizationError


def snapshot():
    return dict(evaluation_scope='full_resume', target_role='银行财务', career_stage='graduate',
                resume=dict(personal_summary='完成费用核查并交付对账清单', profile={},
                            experiences=[dict(id='exp1', title='费用审核实习', org='企业财务部', star=dict(s='',t='',a='核查费用',r='对账清单获采纳'))],
                            educations=[dict(school='大学', end_date='2027-06')], certifications=[], skills=[], section_order=['work']))


def raw_report(data=None, jd=''):
    data = data or snapshot()
    source = rubric.source_catalog(data['resume'], jd)[0]['sourceId']
    return dict(summary='贡献和交付已有基础，补清核查范围。', focusRationale='财务相关实习为主线', contextNotice='',
        dimensions=[dict(dimensionId=d, comment='按当前材料判断', criteria=[dict(criterionId=f'{d}_{i+1}',level=3,reason=label,sourceRefs=[source]) for i,label in enumerate(labels)]) for d,_,_,labels in rubric.DIMENSIONS],
        reviewCoverage=[dict(area=a,status='clear',reason='已检查') for a in rubric.REVIEW_AREAS],
        strengths=[dict(text='交付已采纳',reason='已有定性结果应保留',sourceRefs=[source])],
        suggestions=[dict(targetId='target_1',dimensionId='contribution',severity='high',evidenceState='not_demonstrated',
                          sourceRefs=[source],problem='核查范围尚未交代',impact='读者难以判断个人责任',action='ask',direction='请说明核查对象及承担的环节',needsFacts=True)], requirements=[])


def normalized(data=None, jd=''):
    data = data or snapshot()
    return rubric.normalize(raw_report(data,jd),sources=rubric.source_catalog(data['resume'],jd),modules=rubric.modules_for(data['resume']),
        context=rubric.assessment_context(data,jd),metadata=dict(promptVersion=rubric.PROMPT_VERSION,rubricVersion=rubric.SCORING_VERSION,
        guideVersion=rubric.GUIDE_VERSION,inputHash=rubric.binding(data,jd),model='test-double',provider='fixture',transport='mock',reasoning={}),jd_match=88 if jd else None)


class EvidenceScoreTests(unittest.IsolatedAsyncioTestCase):
    def test_mixed_resume_and_jd_citations_are_separated_without_changing_scores(self):
        report=normalized(jd='合成 JD：要求说明个人贡献')
        jd_id=next(s['sourceId'] for s in report['sources'] if s['path']=='jd')
        expected=report['overallScore']
        items=[report['dimensions'][0]['criteria'][1],report['suggestions'][0],report['strengths'][0]]
        for item in items:item['sourceRefs'].append(jd_id)
        out=rubric.normalize(report)
        for item in [out['dimensions'][0]['criteria'][1],out['suggestions'][0],out['strengths'][0]]:
            self.assertNotIn(jd_id,item['sourceRefs'])
            self.assertEqual(item['jdSourceRefs'],[jd_id])
            self.assertTrue(item['sourceRefs'])
        self.assertEqual(out['overallScore'],expected)
        self.assertEqual(out['jdMatch'],88)
        self.assertEqual(rubric.normalize(out),out)

    def test_jd_only_unknown_and_wrong_document_citations_remain_invalid(self):
        for change in ('jd_only','unknown','wrong_explicit_jd','no_jd_mode'):
            report=normalized(jd='合成 JD')
            jd_id=next(s['sourceId'] for s in report['sources'] if s['path']=='jd')
            item=report['dimensions'][0]['criteria'][0]
            if change=='jd_only':item['sourceRefs']=[jd_id]
            if change=='unknown':item['sourceRefs'].append('unknown')
            if change=='wrong_explicit_jd':item['jdSourceRefs']=item['sourceRefs'][:]
            if change=='no_jd_mode':
                report['assessmentContext']['mode']='general';item['sourceRefs'].append(jd_id)
            with self.assertRaises(ValueError):rubric.normalize(report)

    def test_weighted_sum_uses_unrounded_dimensions_and_no_caps(self):
        r=normalized()
        for d in r['dimensions']:
            for c in d['criteria']: c['level']=4
        r['dimensions'][0]['criteria'][0]['level']=3
        r['overallScore']=1
        out=rubric.normalize(r)
        self.assertEqual(out['overallScore'],99)
        self.assertEqual(out['dimensions'][0]['score'],92)
        self.assertEqual(out['scoreCalculation']['rawTotal'],98.75)
        # Core evidence is weighted heavily but never receives an extra cap.
        for d in r['dimensions']:
            for c in d['criteria']: c['level']=0 if d['dimensionId'] in ('contribution','outcomes') else 4
        self.assertEqual(rubric.normalize(r)['overallScore'],50)
        self.assertEqual(rubric.normalize(normalized()),normalized())

    def test_bad_shapes_refs_and_coverage_fail_without_content_policing(self):
        for mutate in [lambda r:r['dimensions'].pop(), lambda r:r['reviewCoverage'].pop(),
                       lambda r:r['dimensions'][0]['criteria'][0].update(level=True),
                       lambda r:r['dimensions'][0]['criteria'][0].update(level=5),
                       lambda r:r['suggestions'][0].update(sourceRefs=['invented']),
                       lambda r:r['suggestions'][0].update(action='execute'),
                       lambda r:r['strengths'][0].update(sourceRefs=[])]:
            r=normalized(); mutate(r)
            with self.assertRaises((ValueError,KeyError)):rubric.normalize(r)
        r=normalized();r['suggestions'][0]['direction']='300% / 工具 XYZ'
        self.assertEqual(rubric.normalize(r)['suggestions'][0]['direction'],'300% / 工具 XYZ')

    def test_actions_do_not_expand_write_scope(self):
        data=snapshot();modules=rubric.modules_for(data['resume']);raw=raw_report(data)
        for kind,action,editable in [('personal_summary','compress',True),('personal_summary','delete',False),('personal_summary','retain',False),
                                     ('experience_star','move_forward',False),('section_order','move_forward',True),('skills_order','compress',False),('read_only','rewrite',False)]:
            raw['suggestions'][0].update(targetId=next(t['targetId'] for t in modules if t['moduleType']==kind),action=action,needsFacts=False)
            result=rubric.normalize(raw,sources=rubric.source_catalog(data['resume']),modules=modules,context=rubric.assessment_context(data,''),metadata=normalized()['metadata'])
            self.assertEqual(result['suggestions'][0]['editable'],editable,(kind,action))

    async def test_actual_model_input_modes_and_no_hidden_material(self):
        for role,jd,mode in [('', '', 'general'),('银行财务','','role_reference'),('银行财务','软件工程师 JD','jd')]:
            data=snapshot();data['target_role']=role;data['experience_atoms']=[{'secret':'隐藏材料'}]
            call=AsyncMock(return_value={'content':json.dumps(raw_report(data,jd),ensure_ascii=False)})
            with patch.object(resume_score,'_call_llm',call),patch.object(rubric,'enabled',return_value=True):
                result=await resume_score.generate_score(jd,json.dumps(data),88 if jd else None)
            call.assert_awaited_once()
            payload=json.loads(call.call_args.args[0][1]['content'])
            self.assertEqual(payload['assessmentContext']['targetRole'],role)
            self.assertEqual(payload['assessmentContext']['mode'],mode)
            self.assertEqual(payload['assessmentContext']['careerStage'],'graduate')
            self.assertNotIn('隐藏材料',json.dumps(payload,ensure_ascii=False))
            self.assertEqual(result['resumeEvaluation']['overallScore'],75)
            self.assertEqual(result['resumeEvaluation']['jdMatch'],88 if jd else None)
            self.assertFalse(call.call_args.kwargs['gemini_stream'])
            self.assertIn('2027-06',json.dumps(payload))
            self.assertNotIn('score":80',call.call_args.args[0][0]['content'])

    async def test_bad_output_and_cancellation_never_retry(self):
        for output in ('broken','{}','[]'):
            call=AsyncMock(return_value={'content':output})
            with patch.object(resume_score,'_call_llm',call),self.assertRaises(ResumeEvaluationIntegrityError):
                await resume_score.generate_evidence_score('',json.dumps(snapshot()))
            call.assert_awaited_once()
        call=AsyncMock(side_effect=asyncio.CancelledError())
        with patch.object(resume_score,'_call_llm',call),self.assertRaises(asyncio.CancelledError):
            await resume_score.generate_evidence_score('',json.dumps(snapshot()))
        call.assert_awaited_once()
        call=AsyncMock()
        with patch.object(resume_score,'_call_llm',call),self.assertRaises(ResumeEvaluationIntegrityError):
            await resume_score.generate_evidence_score('','{"raw_text":"extraction failed"}')
        call.assert_not_called()

    async def test_diagnostics_identify_phase_without_logging_resume_or_response(self):
        data=snapshot();raw=raw_report(data)
        private_marker='private-person@example.invalid'
        raw['suggestions'][0]['sourceRefs']=[private_marker]
        with patch.object(resume_score,'_call_llm',AsyncMock(return_value={'content':json.dumps(raw)})),self.assertLogs(resume_score.logger,level='WARNING') as logs:
            with self.assertRaises(ResumeEvaluationIntegrityError):
                await resume_score.generate_evidence_score('',json.dumps(data))
        self.assertIn('stage=rubric_validation',' '.join(logs.output))
        self.assertNotIn(private_marker,' '.join(logs.output))

    async def test_v3_freeze_binds_career_stage_jd_and_sources(self):
        import test_resume_optimization_context as f
        data=f._frontend_snapshot_from_analysis_text(f._analysis_text());data['career_stage']='graduate'
        for mutation in ('none','stage','source','jd'):
            resume=f._resume(config_overrides={'careerStage':'graduate'})
            report=normalized(data,'Product manager JD')
            if mutation=='stage':resume.config['careerStage']='junior'
            if mutation=='source':report['sources'][0]['text']='伪造引文'
            if mutation=='jd':report=normalized(data,'Different JD')
            resume.config['jdAnalysis']['result']['resumeEvaluation']=report
            signature=f._frontend_evaluation_signature(data,result=resume.config['jdAnalysis']['result'])
            resume.config['jdAnalysis']['evaluationSignature']=signature
            fixture=f._ContextFixture(self,resume=resume,use_guidance_receipt_stub=False)
            request=f._request(evaluation_signature=signature,selected_suggestion_ids=['suggestion-1'])
            with patch.object(cs,'build_legacy_frozen_optimization_context',cs.build_frozen_optimization_context),patch.object(rubric,'enabled',return_value=True):
                if mutation=='none':
                    frozen,_,_=await fixture.build(request=request)
                    self.assertEqual(frozen.evaluation['scoringVersion'],rubric.SCORING_VERSION)
                else:
                    with self.assertRaises((cs.OptimizationContextStaleError,cs.OptimizationSelectionInvalidError)):
                        await fixture.build(request=request)

    async def test_fact_gap_requires_question_and_skip_spends_no_call(self):
        ctx=SimpleNamespace(evaluation=normalized(),current_resume={'personal_summary':'原文'},selected_source_experiences={},target_role='财务')
        ctx.evaluation['selectedSuggestionIds']=['suggestion-1']
        call=AsyncMock(return_value={'content':json.dumps({'changes':[dict(targetId='target-1',actionKind='rewrite_now',generalValue='新事实',rationale='改写',questions=[],_answered=True)]})})
        with patch.object(planner,'_call_llm',call),self.assertRaises(OptimizationPlanNormalizationError):await planner.plan(ctx)
        call.assert_awaited_once()
        with patch.object(planner,'_call_llm',AsyncMock()) as call:
            self.assertEqual(await planner.rewrite(ctx,SimpleNamespace(questions=[]),[]),[])
            call.assert_not_called()
        ctx.evaluation['selectedSuggestionIds']=[]
        with patch.object(planner,'_call_llm',AsyncMock()) as call,self.assertRaises(OptimizationPlanNormalizationError):
            await planner.plan(ctx)
        call.assert_not_called()

    def test_stage_change_invalidates_quality_report_but_not_jd_match(self):
        from app.domain.resume.resume_service import _invalidate_resume_analysis_for_config_change
        previous=dict(careerStage='graduate',jdAnalysis={'result':{'resumeEvaluation':normalized(),'matchPercentage':88}})
        following=deepcopy(previous);following['careerStage']='junior'
        result=_invalidate_resume_analysis_for_config_change(previous,following)
        self.assertTrue(result['jdAnalysis']['evaluationIsOutdated'])
        self.assertEqual(result['jdAnalysis']['result']['matchPercentage'],88)

    async def test_v3_apply_read_revert_without_any_extra_model_call(self):
        from test_resume_optimization_apply import _run, _change, _resume, _link, _request, _transaction_session, USER_ID, RUN_ID
        from test_resume_optimization_finalize import _finalize_session, _revert_request
        from app.domain.resume_optimization.run_service import hash_canonical_json
        from app.domain.resume_optimization.router import _run_to_read
        run=_run([_change('target-1',module_type='personal_summary',field_path='personal_summary',before_value='原摘要')])
        report=normalized();report['selectedSuggestionIds']=['suggestion-1']
        run.policy_version='json_structure_v1'
        run.before_snapshot['evaluation']=report
        run.source_snapshot_hash=hash_canonical_json(run.before_snapshot)
        for p in (run.plan_json,run.result_json):
            p['changes'][0]['safety_status']='not_reviewed';p['changes'][0]['source_refs']=[]
        resume=_resume();resume.config['jdAnalysis']['result']['resumeEvaluation']=report
        link=_link()
        with patch.object(planner,'_call_llm',side_effect=AssertionError('apply/revert cannot call AI')):
            applied=await apply_service.apply_resume_optimization(session=_transaction_session(run,resume,link),user_id=USER_ID,run_id=str(RUN_ID),payload=_request('target-1'))
            self.assertEqual(applied.run.status,'applied')
            self.assertEqual(_run_to_read(applied.run).status,'applied')
            reverted=await apply_service.revert_resume_optimization(session=_finalize_session(run,resume,link),user_id=USER_ID,run_id=str(RUN_ID),payload=_revert_request(resume.updated_at))
        self.assertEqual(reverted.run.status,'reverted')
        self.assertEqual(resume.config['personalSummary'],'原摘要')


if __name__=='__main__':unittest.main()
