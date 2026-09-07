"""Frozen paired replay of the eight failed v4 task-patch requests."""
import os
os.environ['FEISHU_WEBHOOK_URL'] = ''
import asyncio
import json
import sys
from datetime import datetime, timezone
import qa_resume_blind_benchmark as b
from app.database import engine

tag = sys.argv[1] if len(sys.argv) == 2 else ''
if not tag.isalnum():
    raise SystemExit('Unique alphanumeric replay tag required')
source = b.OUT.with_name(b.OUT.name + '-v4accept20260907b')
read = lambda name: json.loads((source / name).read_text(encoding='utf-8'))
samples = [s for s in read('fixtures.json')['samples'] if s['id'] in {'R7K2','R2M9','R3V6','N6D2'}]
baselines = {}
for sample in samples:
    baselines[sample['id']] = next(read(f"baseline-{sample['id']}-{i}.json")['value']['resumeEvaluation']
        for i in (1,2,3) if read(f"baseline-{sample['id']}-{i}.json")['ok'])
b.OUT = b.OUT.with_name(b.OUT.name + '-' + tag)
assert not b.qa_runtime_fingerprint()['external_notifications_enabled']
b.prepare_frozen_wave_output(b.qa_algorithm_hashes(__file__), {
    'fixtures.json': {'samples':samples,'baselines':baselines},
    'protocol.json': {'purpose':'paired regression replay; not new baseline or full blind acceptance',
                     'repeats':2,'no_data':True,'selection':'frozen first successful numbered baseline',
                     'external_notifications':False}})

async def main():
    results = []
    for sample in samples:
        for index in (1,2):
            name = f"optimization-{sample['id']}-{index}"
            path = b.OUT / (name + '.json')
            result = (json.loads(path.read_text(encoding='utf-8')) if path.exists() else
                await b.call_record(name, lambda s=sample: b.optimize(s,baselines[s['id']]), 'qa-blind-20260906'))
            results.append({'sample':sample['id'],'repeat':index,'ok':result['ok']})
    b.save('finished.json', {'finished_at':datetime.now(timezone.utc).isoformat(),'results':results})
    await engine.dispose()

asyncio.run(main())
