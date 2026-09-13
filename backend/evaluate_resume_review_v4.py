"""Frozen v4 development/profile experiment. Never declares HR quality without labels."""
import argparse
import asyncio
import hashlib
import json
import statistics
import time
from contextvars import ContextVar
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path


def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def read(path):return json.loads(Path(path).read_text(encoding='utf-8-sig'))
def write_new(path,value):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    with path.open('x',encoding='utf-8') as f:json.dump(value,f,ensure_ascii=False,indent=2)


def freeze(input_dir,output,include_equivalent=False):
    root=Path(input_dir).resolve(); samples=[]
    for path in sorted(root.glob('input-*.json')):
        if 'control' in path.stem:continue
        data=read(path);identity=data['id']
        if not isinstance(data.get('snapshot',{}).get('resume'),dict):raise ValueError('structured snapshot required')
        samples.append(dict(id=identity,path=str(path),inputHash=sha(path),kind='primary'))
    if not samples or len({s['id'] for s in samples})!=len(samples):raise ValueError('unique sample IDs required')
    if include_equivalent:
        # Use the first sample, keeping every sentence and its order unchanged.
        data=read(samples[0]['path'])
        for item in data['snapshot']['resume'].get('experiences',[]):
            body='\n'.join(item['star'][k] for k in 'star' if isinstance(item['star'].get(k),str) and item['star'][k].strip())
            item['star']=dict(s='',t='',a=body,r='')
        identity=samples[0]['id']+'-equivalent';data['id']=identity
        target=Path(output).parent/f'{identity}.json';write_new(target,data)
        samples.append(dict(id=identity,path=str(target.resolve()),inputHash=sha(target),kind='equivalent',pairedWith=samples[0]['id']))
    write_new(output,dict(version=1,split='development_only',createdAt=datetime.now(timezone.utc).isoformat(),samples=samples))


async def run(args):
    if not args.live:raise ValueError('Use --live for authorized provider experiments')
    from app.domain.ai import object_review as rubric, resume_score
    from app.domain.ai.llm_transport import _resolve_ai_route, LANE_RESUME_REVIEW
    from app.config import load_settings
    manifest=read(args.manifest);root=Path(args.output)
    sources={s['id']:read(s['path']) for s in manifest['samples']}
    if any(sha(s['path'])!=s['inputHash'] for s in manifest['samples']):raise ValueError('Frozen input changed')
    requested_model=args.model if args.model is not None else load_settings().resume_score_model or None
    route=_resolve_ai_route(model=requested_model,lane=LANE_RESUME_REVIEW)
    if args.model and route.model!=args.model:raise ValueError('Requested experiment model differs from resolved route; configure an isolated matching route before testing')
    fingerprint=dict(promptVersion=rubric.PROMPT_VERSION,scoringVersion=rubric.SCORING_VERSION,guideVersion=rubric.GUIDE_VERSION,
        promptHash=hashlib.sha256(rubric.prompt().encode()).hexdigest(),moduleHash=sha(rubric.__file__),anchorsHash=sha(Path(rubric.__file__).with_name('evidence_anchors_v2.json')),
        model=route.model,provider=route.provider,profiles=args.profiles,repetitions=args.repeat,manifestHash=sha(args.manifest),
        samples=manifest['samples'],startedAt=datetime.now(timezone.utc).isoformat(),
        harnessHash=sha(__file__),consecutiveTimeoutLimit=2,concurrency=getattr(args,'concurrency',2))
    schema_path=Path(rubric.__file__).with_name('review_response_schema.py')
    if schema_path.exists():fingerprint['schemaGeneratorHash']=sha(schema_path)
    dependencies=[Path(rubric.__file__).with_name(name) for name in ('review_actions.py','selection_actions.py','provider_review_schema.py','review_objects.py','review_questions.py','lean_review.py','evidence_rubric_v2.py','resume_score.py','evidence_rubric.py','llm_transport.py')]
    dependencies += [Path(rubric.__file__).parents[2]/name for name in ('config.py','ai_model_capabilities.py')]
    fingerprint['dependencyHashes']={str(p):sha(p) for p in dependencies if p.exists()}
    write_new(root/'run-manifest.json',fingerprint)
    semaphore=asyncio.Semaphore(getattr(args,'concurrency',2))
    output_path=ContextVar('review_output_path',default=None)
    original_call=resume_score._call_llm
    async def capture_call(*pos,**kw):
        response=await original_call(*pos,**kw)
        path=output_path.get()
        if path:write_new(path,response)
        return response
    timeout_streaks=defaultdict(int)
    blocked_profiles=set()
    async def one(sample,profile,rep):
        async with semaphore:
            if hashlib.sha256(rubric.prompt().encode()).hexdigest()!=fingerprint['promptHash'] or sha(rubric.__file__)!=fingerprint['moduleHash']:raise ValueError('Prompt changed during frozen run')
            if fingerprint.get('schemaGeneratorHash') and sha(schema_path)!=fingerprint['schemaGeneratorHash']:raise ValueError('Response schema changed during frozen run')
            if any(sha(p)!=h for p,h in fingerprint['dependencyHashes'].items()):raise ValueError('Scoring dependency changed during frozen run')
            start=time.perf_counter();usage=[]
            record=dict(sampleId=sample['id'],kind=sample['kind'],pairedWith=sample.get('pairedWith'),profile=profile,repetition=rep,
                        inputHash=sample['inputHash'],startedAt=datetime.now(timezone.utc).isoformat())
            if profile in blocked_profiles:
                record.update(status='not_run',errorType='ProfileStoppedAfterRepeatedTimeout',elapsedSeconds=0,usage=[])
                write_new(root/f"{profile}-{sample['id']}-{rep}.json",record)
                return
            write_new(root/'started'/f"{profile}-{sample['id']}-{rep}.json",record)
            output_path.set(root/'raw'/f"{profile}-{sample['id']}-{rep}.json")
            try:
                data=sources[sample['id']]
                result=await resume_score.generate_review_score(data.get('jd',''),json.dumps(data['snapshot'],ensure_ascii=False),
                    model=args.model,thinking_level=profile,usage_callback=usage.append)
                record.update(status='success',report=result['resumeEvaluation'])
                timeout_streaks[profile]=0
            except Exception as exc:
                record.update(status='error',errorType=type(exc).__name__,causeType=type(exc.__cause__).__name__ if exc.__cause__ else None)
                timeout_streaks[profile] = timeout_streaks[profile]+1 if record['causeType']=='AiRuntimeTimeoutError' or record['errorType'] in ('TimeoutError','AiRuntimeTimeoutError') else 0
                if timeout_streaks[profile]>=2:blocked_profiles.add(profile)
            record.update(elapsedSeconds=round(time.perf_counter()-start,3),usage=usage)
            write_new(root/f"{profile}-{sample['id']}-{rep}.json",record)
            print(json.dumps({k:record[k] for k in ('profile','sampleId','repetition','status','elapsedSeconds')}|{'score':record.get('report',{}).get('overallScore')},ensure_ascii=False),flush=True)
    resume_score._call_llm=capture_call
    try:
        await asyncio.gather(*(one(s,profile,rep) for profile in args.profiles for rep in range(1,args.repeat+1) for s in manifest['samples']))
    finally:
        resume_score._call_llm=original_call


def summarize(directory,labels_path=None):
    root=Path(directory);manifest=read(root/'run-manifest.json')
    records=[read(p) for p in sorted(root.glob('*.json')) if p.name!='run-manifest.json' and 'profile' in read(p)]
    identities=[(r['profile'],r['sampleId'],r['repetition']) for r in records]
    expected_ids={(profile,s['id'],rep) for profile in manifest['profiles'] for s in manifest['samples'] for rep in range(1,manifest['repetitions']+1)}
    if len(set(identities))!=len(identities) or not set(identities)<=expected_ids:
        raise ValueError('Duplicate or unexpected experiment member')
    labels=read(labels_path) if labels_path else None
    if labels and labels.get('runManifestHash')!=sha(root/'run-manifest.json'):raise ValueError('Labels must bind exact frozen run')
    groups=defaultdict(list)
    for r in records:groups[r['profile']].append(r)
    summaries=[]
    for profile in manifest['profiles']:
        group=groups[profile];good=[r for r in group if r['status']=='success'];primary=[r for r in group if r['kind']=='primary']
        per_sample={s['id']:[r['report']['overallScore'] for r in good if r['sampleId']==s['id']] for s in manifest['samples']}
        ranges={k:max(v)-min(v) if len(v)==manifest['repetitions'] else None for k,v in per_sample.items()}
        attempted=[r for r in group if r['status'] in ('success','error')]
        times=sorted(r['elapsedSeconds'] for r in attempted)
        p95=times[max(0,__import__('math').ceil(len(times)*.95)-1)] if times else None
        equivalent=[]
        for r in good:
            if r['kind']=='equivalent':
                paired=next((x for x in good if x['sampleId']==r['pairedWith'] and x['repetition']==r['repetition']),None)
                if paired:equivalent.append(abs(r['report']['overallScore']-paired['report']['overallScore']))
        major=[]
        for s in [x for x in manifest['samples'] if x['kind']=='primary']:
            runs=[r for r in good if r['sampleId']==s['id']]
            if len(runs)!=manifest['repetitions']:continue
            sets=[{(x['moduleType'],x['moduleId'],x['primaryCriterionId']) for x in r['report']['suggestions'] if x['severity'] in ('high','medium') and x['action']!='retain'} for r in runs]
            for i in range(len(sets)):
                for j in range(i+1,len(sets)):
                    union=sets[i]|sets[j];major.append(len(sets[i]&sets[j])/len(union) if union else 1)
        expected=len(manifest['samples'])*manifest['repetitions']
        known_usage=[sum(u.get('total_tokens',0) for u in r['usage'] if u.get('status')=='success') for r in attempted if any(u.get('status')=='success' for u in r['usage'])]
        runtime_ok=(len(group)==len(good)==expected)
        primary_good=[r for r in good if r['kind']=='primary']
        recommendations={s['id']:[sum(x['action']!='retain' for x in r['report']['suggestions']) for r in primary_good if r['sampleId']==s['id']] for s in manifest['samples'] if s['kind']=='primary'}
        covered_modules={s['id']:[len({(x['moduleType'],x['moduleId']) for x in r['report']['suggestions'] if x['action']!='retain'}) for r in primary_good if r['sampleId']==s['id']] for s in manifest['samples'] if s['kind']=='primary'}
        strategies=Counter(x['action'] for r in primary_good for x in r['report']['suggestions'] if x['action']!='retain')
        recommendation_kinds=Counter(x.get('recommendationKind','unspecified') for r in primary_good for x in r['report']['suggestions'] if x['action']!='retain')
        record=dict(profile=profile,calls=len(attempted),expectedCalls=expected,notRun=sum(r['status']=='not_run' for r in group),missingMembers=expected-len(group),successful=len(good),scores=per_sample,ranges=ranges,p95Seconds=p95,
                    meanSeconds=statistics.mean(times) if times else None,equivalenceDeltas=equivalent,majorDiagnosticJaccard=statistics.mean(major) if major else None,
                    totalTokens=sum(known_usage) if known_usage else None,usageAvailableCalls=len(known_usage),
                    recommendationCounts=recommendations,coveredModuleCounts=covered_modules,strategyCounts=dict(strategies),
                    recommendationKindCounts=dict(recommendation_kinds),
                    scoreMetricsAreObservational=True,
                    qualityStatus='needs_reviewed_labels' if runtime_ok else 'runtime_failed',eligible=False)
        if labels:
            review=labels.get('profiles',{}).get(profile)
            if review:
                # Counts are human/assistant-reviewed evidence, never model self-assessment.
                required=('completeCheckpoints','checkpointCount','falsePositives','reviewedDiagnostics','actionableDiagnostics','severeErrors')
                if any(type(review.get(k)) is not int or review[k]<0 for k in required):raise ValueError('Invalid reviewed counts')
                if review['completeCheckpoints']>review['checkpointCount'] or review['falsePositives']>review['reviewedDiagnostics'] or review['actionableDiagnostics']>review['reviewedDiagnostics']:raise ValueError('Impossible reviewed counts')
                passed=(len(group)==len(good)==expected and review['checkpointCount']==27 and review['completeCheckpoints']>=22
                    and review['reviewedDiagnostics']>0 and review['falsePositives']/review['reviewedDiagnostics']<=.1 and review['severeErrors']==0
                    and review['actionableDiagnostics']/review['reviewedDiagnostics']>=.9)
                record.update(reviewedCounts=review,eligible=passed,qualityStatus='development_thresholds_met' if passed else 'development_thresholds_not_met')
        summaries.append(record)
    candidates=[x for x in summaries if x['eligible']]
    return dict(profiles=summaries,developmentCandidate=min(candidates,key=lambda x:x['p95Seconds'])['profile'] if candidates else None,
                productionEligible=False,productionReason='Independent 32-base, two-HR holdout acceptance remains required.')


def main():
    parser=argparse.ArgumentParser(description=__doc__);sub=parser.add_subparsers(dest='command',required=True)
    p=sub.add_parser('freeze');p.add_argument('input_dir');p.add_argument('--output',required=True);p.add_argument('--equivalent',action='store_true')
    p=sub.add_parser('run');p.add_argument('manifest');p.add_argument('--output',required=True);p.add_argument('--live',action='store_true');p.add_argument('--profiles',nargs='+',choices=('low','medium','high'),default=['medium']);p.add_argument('--repeat',type=int,default=3);p.add_argument('--model')
    p.add_argument('--concurrency',type=int,choices=(1,2),default=1)
    p=sub.add_parser('summarize');p.add_argument('directory');p.add_argument('--labels')
    args=parser.parse_args()
    if args.command=='freeze':freeze(args.input_dir,args.output,args.equivalent)
    elif args.command=='run':
        if args.repeat<1 or len(set(args.profiles))!=len(args.profiles):raise ValueError('Positive repeats and unique profiles required')
        asyncio.run(run(args))
    else:print(json.dumps(summarize(args.directory,args.labels),ensure_ascii=False,indent=2))


if __name__=='__main__':main()
