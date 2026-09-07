"""One or two fixed production scoring requests before a larger paid benchmark."""
import os
os.environ['FEISHU_WEBHOOK_URL']=''
import asyncio
import argparse
import json
from datetime import datetime, timezone
import qa_resume_blind_benchmark as b
b.reject_retired_numeric_run()
from app.database import engine

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('tag')
parser.add_argument('--sample',choices=['R7K2','N6D2'])
args=parser.parse_args()
tag=args.tag
if not tag.isalnum():raise SystemExit('Unique alphanumeric pilot tag required')
source=b.OUT.with_name(b.OUT.name+'-v4accept20260907e')
samples=[s for s in json.loads((source/'fixtures.json').read_text(encoding='utf-8'))['samples']
         if s['id'] in ({args.sample} if args.sample else {'R7K2','N6D2'})]
if len(samples)!=(1 if args.sample else 2):raise SystemExit('Pilot fixture coverage mismatch')
b.OUT=b.OUT.with_name(b.OUT.name+'-'+tag)
assert not b.qa_runtime_fingerprint()['external_notifications_enabled']
b.prepare_frozen_wave_output(b.qa_algorithm_hashes(__file__), {
    'fixtures.json':{'samples':samples,'jd':b.JD},
    'protocol.json':{'purpose':'limited diagnostic pilot, not full blind acceptance',
                    'score_requests':len(samples),'max_provider_attempts_per_score':5,
                    'no_external_retry':True,'external_notifications':False}})

async def main():
    results=[]
    for sample in samples:
        name='score-'+sample['id'];path=b.OUT/(name+'.json')
        result=json.loads(path.read_text(encoding='utf-8')) if path.exists() else await b.call_record(
            name,lambda s=sample:b.evaluate(s['resume']),'qa-blind-20260906')
        results.append({'id':sample['id'],'ok':result['ok']})
        if result.get('provider_status') in {400,401,403,404}:
            results.extend({'id':s['id'],'ok':False,'blocked':'provider_authorization_or_configuration'}
                           for s in samples[len(results):])
            break
    b.save('finished.json',{'finished_at':datetime.now(timezone.utc).isoformat(),'results':results})
    await engine.dispose()

asyncio.run(main())
