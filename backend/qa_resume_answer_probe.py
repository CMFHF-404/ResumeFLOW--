"""Live answer probe: python qa_resume_answer_probe.py NEW_RUN_TAG [CASE]."""
import asyncio,copy,json,hashlib,sys
import qa_resume_blind_benchmark as b
from qa_resume_probe_runs import frozen_probe, run_case
from app.domain.ai.resume_evaluation_service import _build_legacy_fact_metadata
from app.domain.resume_optimization.context_service import FrozenOptimizationContext
from app.domain.resume_optimization.schemas import OptimizationPlan,OptimizationAnswer
from app.domain.resume_optimization.planner_service import rewrite_answered_modules
from app.domain.resume_optimization.semantic_review import review_plan_semantics
from app.domain.resume_optimization.safety import verify_plan_changes
from app.domain.resume_optimization import planner_service

facts={'star.s':'企业客户反馈权限配置难以理解，团队决定整理配置指引。','star.t':'我负责整理需求和编写验收清单，配合研发交付。','star.a':'访谈5名管理员，整理反馈，编写配置指引并配合完成验收。','star.r':'配置指引已交付并通过验收，尚未测量效率变化。','personal_summary':'有产品相关工作经历，负责需求整理与验收配合，未测量业绩指标。'}
async def probe(kind, initial, ctx):
    plan=OptimizationPlan.model_validate(initial)
    answers=[OptimizationAnswer(question_id=q.question_id,state='answered',value='没有额外可确认的数据。' if kind=='no_extra_text' else facts.get(q.field_path,'没有额外可确认的数据。')) for q in plan.questions]
    b.save(kind+'-input.json',{'plan':initial,'answers':[a.model_dump(mode='json') for a in answers]})
    original_call=planner_service._call_llm
    response_index = 0
    async def observed(*args,**kwargs):
        nonlocal response_index
        raw=await original_call(*args,**kwargs)
        response_index += 1
        b.save(f'{kind}-response-{response_index}.json',raw)
        return raw
    planner_service._call_llm=observed
    try:
        changed=await rewrite_answered_modules(context=ctx,existing_plan=plan,answers=answers)
    except Exception as exc:
        causes=[];error=exc
        while error:
            detail={'type':type(error).__name__,'message':str(error) if type(error).__module__.startswith('app.domain.resume_optimization') else 'omitted'}
            if hasattr(error,'errors'):detail['fields']=[{'loc':x['loc'],'type':x['type'],'msg':x['msg']} for x in error.errors()]
            causes.append(detail);error=error.__cause__
        b.save(kind+'-cause.json',causes);raise
    finally:
        planner_service._call_llm=original_call
    byid={c.change_id:c for c in changed};plan.changes=[byid.get(c.change_id,c) for c in plan.changes]
    docs=ctx.source_documents;docs['userAnswers']={a.question_id:{'state':a.state.value,'value':a.value} for a in answers}
    plan=await review_plan_semantics(plan=plan,source_documents=docs)
    checked,safety=verify_plan_changes(plan=plan,source_documents=docs)
    return {'changes':[c.model_dump(mode='json') for c in checked],'safety':safety.model_dump(mode='json')}
async def main():
    all_cases = ('no_extra_text', 'provided_facts')
    if (len(sys.argv) not in (2, 3) or not sys.argv[1].isalnum()
            or (len(sys.argv) == 3 and sys.argv[2] not in all_cases)):
        raise SystemExit('Usage: python qa_resume_answer_probe.py NEW_RUN_TAG [CASE]')
    from app.database import engine
    original = b.OUT
    wave = original.with_name(original.name + '-wave4')
    cases = [sys.argv[2]] if len(sys.argv) == 3 else all_cases
    try:
        fixture = json.loads((wave / 'fixtures.json').read_text(encoding='utf-8'))
        sample = next(s for s in fixture['samples'] if s['id'] == 'R7K2')
        evaluation = json.loads((wave / 'baseline-R7K2-1.json').read_text(encoding='utf-8'))['value']['resumeEvaluation']
        initial = json.loads((wave / 'optimization-R7K2-1.json').read_text(encoding='utf-8'))['value']['initial_plan']
        r = sample['resume']
        current = copy.deepcopy(r)
        current['experiences'] = {e['id']: e for e in r['experiences']}
        ctx = FrozenOptimizationContext(resume_id=b.uid(sample['id']),resume_updated_at='2026-09-06T00:00:00+00:00',evaluation_signature=hashlib.sha256(json.dumps(r).encode()).hexdigest(),jd_signature=hashlib.sha256(b.JD.encode()).hexdigest(),target_role=b.ROLE,evaluation=evaluation,current_resume=current,selected_source_experiences=sample['sources'],selected_master_experience_ids=list(current['experiences']),selected_experience_links={},bank_suggestion_candidates=[],fact_metadata=_build_legacy_fact_metadata(r))
        with frozen_probe(original.with_name(original.name + '-answers-' + sys.argv[1]), __file__, {
            'fixtures.json': {'jd': b.JD, 'target_role': b.ROLE, 'samples': [sample]},
            'replay-inputs.json': {'evaluation': evaluation, 'plan': initial, 'answers': facts},
            'protocol.json': {'cases': list(all_cases), 'source_run': wave.name,
                              'scope': 'answer replay only; archived evaluation is not a score comparison baseline',
                              'resume_policy': 'retain successes and failures; retry interrupted cases in separate attempts'},
        }, all_cases):
            for kind in cases:
                await run_case(kind, lambda k=kind: b.call_record(
                    k, lambda: probe(k, initial, ctx), 'qa-blind-20260906'))
    finally:
        await engine.dispose()


if __name__ == '__main__':
    asyncio.run(main())
