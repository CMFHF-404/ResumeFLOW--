"""Additional diagnostic attempts, separate from the pre-registered benchmark.
Run: python qa_resume_blind_diagnostics.py NEW_RUN_TAG
Observes unchanged planner/answer responses to locate contract failures.
"""
import asyncio, json, time, sys
import qa_resume_blind_benchmark as bench
from qa_resume_probe_runs import frozen_probe, run_case

async def main():
    if len(sys.argv) != 2 or not sys.argv[1].isalnum():
        raise SystemExit('Usage: python qa_resume_blind_diagnostics.py NEW_RUN_TAG')
    from app.database import AsyncSessionFactory,engine
    from app.domain.billing.billing_service import ai_billing_context
    from app.domain.resume_optimization import planner_service
    original=planner_service._call_llm
    async def diagnose(sample, e):
        bench.require_local_database()
        current = []
        async def observe(*args, **kwargs):
            result = await original(*args, **kwargs)
            record = {"request_label": kwargs.get("request_label"), "response": result}
            current.append(record)
            bench.save(f'response-{len(current)}.json', record)
            return result
        planner_service._call_llm = observe
        start = time.monotonic()
        try:
            try:
                async with AsyncSessionFactory() as session:
                    async with ai_billing_context(session,"qa-blind-20260906",entrypoint="resume_blind_diagnostic",metadata={"sample":sample["id"]}):
                        result={"ok":True,"value":await bench.optimize(sample,e)}
            except Exception as exc:
                causes=[]; cause=exc
                while cause is not None:
                    # Only local contract exceptions get a message. Never persist provider bodies.
                    local=cause.__class__.__module__.startswith("app.domain.resume_optimization")
                    causes.append({"type":type(cause).__name__,"message":str(cause)[:2000] if local else "message omitted"})
                    cause=cause.__cause__
                result={"ok":False,"causes":causes}
            result.update(seconds=round(time.monotonic()-start,2),observed_responses=list(current))
            print(sample["id"],result["ok"],result.get("causes",[]),flush=True)
            return result
        finally:
            planner_service._call_llm = original

    source = bench.OUT
    try:
        fixture = json.loads((source / 'fixtures.json').read_text(encoding='utf-8'))
        if fixture.get('jd') != bench.JD or fixture.get('target_role') != bench.ROLE:
            raise SystemExit('Fixture JD or target role changed; use a NEW run tag')
        samples = fixture['samples']
        evaluations = {s['id']: json.loads((source / f"baseline-{s['id']}-1.json").read_text(
            encoding='utf-8'))['value']['resumeEvaluation'] for s in samples}
        cases = ['diagnostic-' + s['id'] for s in samples]
        with frozen_probe(source.with_name(source.name + '-diagnostics-' + sys.argv[1]), __file__, {
            'fixtures.json': fixture,
            'replay-inputs.json': evaluations,
            'protocol.json': {'source_run': source.name, 'cases': cases,
                              'scope': 'observe archived baseline planner/answer replay; no score comparison',
                              'resume_policy': 'retain successes and failures; retry interrupted cases in separate attempts'},
        }, cases):
            for sample in samples:
                await run_case('diagnostic-' + sample['id'],
                               lambda s=sample: diagnose(s, evaluations[s['id']]))
    finally:
        planner_service._call_llm=original
        await engine.dispose()

if __name__=="__main__": asyncio.run(main())
