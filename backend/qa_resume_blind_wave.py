"""Run a new immutable live benchmark wave on the original blinded corpus."""
import asyncio, json, sys
import qa_resume_blind_benchmark as b

if len(sys.argv)!=2 or not sys.argv[1].isalnum():
    raise SystemExit('Usage: python qa_resume_blind_wave.py wave1')
original=b.OUT
b.OUT=original.with_name(original.name+'-'+sys.argv[1])
artifacts = {
    name: json.loads((original / name).read_text(encoding='utf-8'))
    for name in ['fixtures.json', 'protocol.json', *[f'key-{x}.json' for x in b.IDS]]
}
b.prepare_frozen_wave_output(b.qa_algorithm_hashes(__file__), artifacts)
original_optimize=b.optimize
async def traced(sample,evaluation):
    try:return await original_optimize(sample,evaluation)
    except Exception as exc:
        causes=[];cause=exc
        while cause is not None:
            local=cause.__class__.__module__.startswith('app.domain.resume_optimization')
            causes.append({'type':type(cause).__name__,'message':str(cause) if local else 'omitted'})
            cause=cause.__cause__
        existing=list(b.OUT.glob('cause-'+sample['id']+'-*.json'))
        b.save(f"cause-{sample['id']}-{len(existing)+1}.json",causes)
        print('CAUSE',sample['id'],causes,flush=True)
        raise
b.optimize=traced
# Record validation failures before any repair, without altering responses.
from app.domain.ai import resume_evaluation_service as ev
normalizer=ev._normalize_response
def observed_normalizer(*args,**kwargs):
    try:return normalizer(*args,**kwargs)
    except ValueError as exc:
        index=len(list(b.OUT.glob('evaluation-invalid-*.json')))+1
        b.save(f'evaluation-invalid-{index}.json',{'reason':str(exc),'response':args[0]})
        raise
ev._normalize_response=observed_normalizer
asyncio.run(b.run('qa-blind-20260906'))
