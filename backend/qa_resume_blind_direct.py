"""Protocol extension: adopt supported immediate edits without answering questions."""
import asyncio,copy,hashlib,json,sys
from pathlib import Path
import qa_resume_blind_benchmark as b

async def direct(sample,evaluation):
    from app.domain.ai.resume_evaluation_service import _build_legacy_fact_metadata
    from app.domain.resume_optimization.context_service import FrozenOptimizationContext
    from app.domain.resume_optimization.planner_service import plan_resume_optimization
    from app.domain.resume_optimization.semantic_review import review_plan_semantics
    from app.domain.resume_optimization.safety import verify_plan_changes
    r=copy.deepcopy(sample['resume']); current=copy.deepcopy(r)
    current['experiences']={e['id']:e for e in r['experiences']}
    ctx=FrozenOptimizationContext(resume_id=b.uid(sample['id']),resume_updated_at='2026-09-06T00:00:00+00:00',evaluation_signature=hashlib.sha256(json.dumps(r).encode()).hexdigest(),jd_signature=hashlib.sha256(b.JD.encode()).hexdigest(),target_role=b.ROLE,evaluation=evaluation,current_resume=current,selected_source_experiences=sample['sources'],selected_master_experience_ids=list(current['experiences']),selected_experience_links={},bank_suggestion_candidates=[],fact_metadata=_build_legacy_fact_metadata(r))
    plan=await plan_resume_optimization(ctx)
    plan=await review_plan_semantics(plan=plan,source_documents=ctx.source_documents)
    changes,safety=verify_plan_changes(plan=plan,source_documents=ctx.source_documents)
    accepted=[]
    for c in changes:
        if c.action_kind.value!='rewrite_now' or c.safety_status!='allowed':continue
        value=c.general_value
        if c.module_type.value=='experience_star':
            e=next(e for e in r['experiences'] if e['id']==c.module_id)
            key=c.field_path.split('.')[1]; assert e['star'][key]==c.before_value; e['star'][key]=value
        elif c.module_type.value=='personal_summary':r['personal_summary']=value
        elif c.module_type.value=='section_order':r['section_order']=value
        elif c.module_type.value=='skills_order':
            skills={s['id']:s for s in r['skills']};r['skills']=[skills[x] for x in value]
        else:continue
        if value!=c.before_value:accepted.append(c.change_id)
    return {'changes':[c.model_dump(mode='json') for c in changes],'questions':[q.model_dump(mode='json') for q in plan.questions],'safety':safety.model_dump(mode='json'),'accepted':accepted,'resume':r}

async def main():
    b.reject_retired_numeric_run()
    from app.database import engine
    if len(sys.argv) != 2 or not sys.argv[1].isalnum():
        raise SystemExit('Usage: python qa_resume_blind_direct.py NEW_RUN_TAG')
    original = b.OUT
    fixture = json.loads((original / 'fixtures.json').read_text(encoding='utf-8'))
    if fixture.get('jd') != b.JD or fixture.get('target_role') != b.ROLE:
        raise SystemExit('Fixture JD or target role differs from the active benchmark')
    b.OUT = original.with_name(original.name + '-direct-' + sys.argv[1])
    try:
        b.prepare_frozen_wave_output(b.qa_algorithm_hashes(__file__), {
            'fixtures.json': fixture,
            'protocol.json': {
                'baseline_repeats': 3, 'attempts_per_sample': 2, 'post_repeats': 3,
                'selection': 'first successful numbered current baseline; first successful direct plan containing actual allowed edits',
                'questions': 'left unanswered; never convert them to invented facts',
                'statistics': 'independent extension; never replaces historical outcomes',
            },
        })
        await run_samples(fixture['samples'])
    finally:
        b.OUT = original
        await engine.dispose()


async def run_samples(samples):
    b.reject_retired_numeric_run()
    from app.domain.ai.resume_evaluation import SCORING_VERSION
    async def cached(name,fn):
        p=b.OUT/(name+'.json')
        if p.exists():return json.loads(p.read_text(encoding='utf-8'))
        return await b.call_record(name,fn,'qa-blind-20260906')
    for s in samples:
        baselines = []
        for index in (1, 2, 3):
            result = await cached(f"baseline-{s['id']}-{index}", lambda s=s: b.evaluate(s['resume']))
            if result['ok']:
                evaluation = result['value']['resumeEvaluation']
                if evaluation.get('scoringVersion') != SCORING_VERSION:
                    raise SystemExit('Evaluation scoring version changed; use a NEW run tag')
                baselines.append(evaluation)
        if not baselines:
            continue
        e = baselines[0]
        selected=False
        for i in (1,2):
            v=await cached(f"direct-{s['id']}-{i}",lambda s=s,e=e:direct(s,e))
            if v['ok'] and v['value']['accepted'] and not selected:
                selected=True
                for j in (1,2,3):
                    await cached(f"direct-post-{s['id']}-{j}",lambda r=v['value']['resume']:b.evaluate(r))
    docs=[];key={}
    for s in samples:
        variants=[('original',s['resume'])]
        for i in (1,2):
            p=b.OUT/f"direct-{s['id']}-{i}.json"
            if p.exists():
                v=json.loads(p.read_text(encoding='utf-8'))
                if v['ok'] and v['value']['accepted']:variants.append((str(i),v['value']['resume']))
        for phase,resume in variants:
            code=hashlib.sha256((s['id']+phase+'directblind').encode()).hexdigest()[:8]
            key[code]={'sample':s['id'],'phase':phase};docs.append({'id':code,'resume':resume,'sources':s['sources']})
    import random
    random.Random(5239).shuffle(docs)
    b.save('direct-blind-input.json',docs);b.save('direct-blind-key.json',key)
    await cached('direct-blind-judge',lambda:b.blind_judge(docs))

if __name__=='__main__':asyncio.run(main())
