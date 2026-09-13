"""Explicit offline calibration workflow; imports providers only for the `run --live` command.

Scaffolds contain NO fabricated resumes or HR labels. Human annotation is required.
"""
import argparse
import asyncio
import hashlib
import json
import math
import statistics
import time
from collections import Counter, defaultdict
from pathlib import Path

LEGACY_ROLES = ('product', 'technology', 'finance', 'operations')
ROLES = (*LEGACY_ROLES, 'data_analysis', 'industry_research')
ROLE_BASE_COUNTS = {role: 4 if role in LEGACY_ROLES else 8 for role in ROLES}
STAGES = ('graduate', 'junior')
VARIANTS = ('A', 'B', 'C', 'D')


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))


def write_new(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('x', encoding='utf-8') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)


def scaffold(directory):
    base = Path(directory)
    entries = []
    for role in ROLES:
        for stage in STAGES:
            per_stage = ROLE_BASE_COUNTS[role] // 2
            for index in range(per_stage):
                identity = f'{role}-{stage}-{index+1}'
                entries.append(dict(baseId=identity, role=role, careerStage=stage, split='dev' if index < per_stage // 2 else 'holdout',
                                    authorConfirmed=False, variants={v: f'inputs/{identity}-{v}.json' for v in VARIANTS}))
    write_new(base / 'manifest.json', dict(version=2, samples=entries))
    write_new(base / 'input.example.json', dict(snapshot={'evaluation_scope':'full_resume','target_role':'','career_stage':'graduate','resume':{}},jd=''))
    write_new(base / 'adjudication.example.json', dict(manifestHash='', resultHash='', reviewers=['',''], resolved=False, judgments=[dict(
        runId='base-id:A:1', expectedHigh=0, truePositiveHigh=0, falsePositiveHigh=0,
        importantDiagnostics=0, correctSources=0, shouldKeep=0, incorrectlyChanged=0, severeErrors=0,
        reviewedDiagnostics=0, actionableDiagnostics=0)],
        gradients=[dict(baseId='base-id', expectedOrder=['A','C','D'])]))
    return {'manifest':str(base/'manifest.json'), 'baseResumes':32, 'status':'awaiting_author_confirmed_inputs_and_independent_HR_labels'}


def validate_manifest(path):
    manifest = read(path)
    if manifest.get('version') not in (1,2):
        raise ValueError('Unsupported manifest version')
    samples = manifest['samples']
    if len(samples) != 32 or len({s['baseId'] for s in samples}) != 32:
        raise ValueError('Exactly 32 unique base resumes are required')
    counts = Counter((s['role'],s['careerStage'],s['split']) for s in samples)
    expected = Counter({(r,c,s):2 for r in LEGACY_ROLES for c in STAGES for s in ('dev','holdout')}) if manifest.get('version') == 1 else Counter({(r,c,s):ROLE_BASE_COUNTS[r]//4 for r in ROLES for c in STAGES for s in ('dev','holdout')})
    if counts != expected:
        raise ValueError('Role/stage groups must match the versioned balanced dev/holdout allocation')
    hashes = set()
    content_hashes = {}
    result = []
    for sample in samples:
        if not sample.get('authorConfirmed') or set(sample['variants']) != set(VARIANTS):
            raise ValueError(f"{sample['baseId']}: all variants and author confirmation required")
        for variant, relative in sample['variants'].items():
            input_path = (Path(path).parent / relative).resolve()
            if str(input_path) in hashes:
                raise ValueError('An input file cannot be reused across variants or splits')
            hashes.add(str(input_path))
            data = read(input_path)
            snap = data.get('snapshot', {})
            if not isinstance(snap.get('resume'), dict) or not snap['resume'] or snap.get('career_stage') != sample['careerStage'] or not isinstance(data.get('jd'),str):
                raise ValueError(f'{input_path}: structured snapshot, stage and JD text required')
            digest = hashlib.sha256(json.dumps(data,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
            previous_base = content_hashes.get(digest)
            if previous_base and previous_base != sample['baseId']:
                raise ValueError('Identical inputs cannot appear in different base groups')
            content_hashes[digest] = sample['baseId']
            result.append(dict(baseId=sample['baseId'], split=sample['split'], variant=variant, input=data, inputHash=digest))
    return result


def file_hash(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


async def run(args):
    if not args.live:
        raise ValueError('Provider execution requires --live and author-confirmed inputs')
    inputs = validate_manifest(args.manifest)
    # Never initialize a database or application server for a model comparison.
    from app.domain.ai.resume_score import generate_evidence_score, generate_legacy_score, generate_review_score
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    generate = generate_legacy_score if args.baseline else generate_review_score if args.version == 'v4' else generate_evidence_score
    if (args.baseline or args.version != 'v4') and (args.model is not None or args.thinking_level is not None):
        raise ValueError('Scoring model/profile overrides require v4')
    manifest_hash = file_hash(args.manifest)
    with output.open('x', encoding='utf-8') as stream:
        for entry in inputs:
            if entry['split'] != args.split:
                continue
            for repetition in range(1, 4):
                run_id = f"{entry['baseId']}:{entry['variant']}:{repetition}"
                usage = []
                started = time.perf_counter()
                record = dict(runId=run_id, baseId=entry['baseId'], variant=entry['variant'], repetition=repetition,
                              split=entry['split'], inputHash=entry['inputHash'], manifestHash=manifest_hash, baseline=args.baseline)
                try:
                    data = entry['input']
                    overrides = dict(model=args.model,thinking_level=args.thinking_level) if not args.baseline and args.version == 'v4' else {}
                    result = await generate(data['jd'],json.dumps(data['snapshot'],ensure_ascii=False),usage_callback=usage.append,**overrides)
                    record.update(status='success', report=result['resumeEvaluation'])
                except Exception as exc:
                    # Do not persist provider bodies or credentials in public error text.
                    record.update(status='error',errorType=type(exc).__name__)
                record.update(elapsedSeconds=time.perf_counter()-started,usage=usage)
                stream.write(json.dumps(record,ensure_ascii=False)+'\n');stream.flush()
                print(f"{run_id}: {record['status']}",flush=True)
    return {'output':str(output),'split':args.split,'baseline':args.baseline}


def ratio(numerator, denominator):
    return numerator/denominator if denominator else None


def percentile(values, p):
    return sorted(values)[max(0,math.ceil(len(values)*p)-1)] if values else None


def summarize(results_path, annotation_path=None):
    records = [json.loads(line) for line in Path(results_path).read_text(encoding='utf-8').splitlines() if line.strip()]
    if not records or len({r['runId'] for r in records}) != len(records):
        raise ValueError('Require nonempty, unique run records')
    successful = [r for r in records if r['status']=='success']
    groups = defaultdict(list)
    for r in successful:groups[(r['baseId'],r['variant'])].append(r['report']['overallScore'])
    repeat_groups = [scores for scores in groups.values() if len(scores)==3]
    bases = {r['baseId'] for r in records}
    expected_ids = {f'{b}:{v}:{i}' for b in bases for v in VARIANTS for i in (1,2,3)}
    complete = len(bases)==16 and {r['runId'] for r in records}==expected_ids and all(r['split']=='holdout' and not r['baseline'] for r in records)
    manifest_hashes = {r['manifestHash'] for r in records}
    complete = complete and len(manifest_hashes)==1 and len(successful)==len(records)
    versions = {json.dumps({k:r['report'].get('metadata',{}).get(k) for k in
                           ('promptVersion','rubricVersion','guideVersion','model','provider','reasoning')},sort_keys=True)
                for r in successful}
    complete = complete and len(versions)==1
    polish = [max(b-a for a,b in zip(groups[(base,'A')],groups[(base,'B')])) for base in bases
              if len(groups[(base,'A')])==len(groups[(base,'B')])==3]
    result = dict(status='engineering_results_only', successRate=ratio(len(successful),len(records)),
                  p50Seconds=percentile([r['elapsedSeconds'] for r in records],.5),p95Seconds=percentile([r['elapsedSeconds'] for r in records],.95),
                  stableFraction=ratio(sum(max(s)-min(s)<=5 for s in repeat_groups),len(repeat_groups)),
                  polishWithinFiveFraction=ratio(sum(s<=5 for s in polish),len(polish)),
                  totalRuns=len(records), completeHoldout=complete)
    totals = []
    for r in records:
        values=[u.get('total_tokens') for u in r.get('usage',[]) if isinstance(u.get('total_tokens'),(int,float))]
        if values:totals.append(sum(values))
    result['meanTotalTokens'] = statistics.mean(totals) if totals else None
    result['usageCoverage'] = ratio(len(totals),len(records))
    if not annotation_path:return result
    annotations=read(annotation_path)
    reviewers=annotations.get('reviewers',[])
    if len(reviewers)!=2 or len(set(reviewers))!=2 or not all(isinstance(r,str) and r.strip() for r in reviewers) or not annotations.get('resolved'):
        raise ValueError('Two distinct reviewers and resolved adjudication required')
    if annotations.get('resultHash')!=file_hash(results_path) or manifest_hashes!={annotations.get('manifestHash')}:
        raise ValueError('Human labels must bind to the exact result and manifest files')
    judgments=annotations['judgments']
    if len(judgments)!=len(successful) or {j['runId'] for j in judgments}!={r['runId'] for r in successful}:
        raise ValueError('Every successful run needs a human judgment')
    keys=('expectedHigh','truePositiveHigh','falsePositiveHigh','importantDiagnostics','correctSources','shouldKeep','incorrectlyChanged','severeErrors')
    for j in judgments:
        if any(type(j.get(k)) is not int or j[k]<0 for k in keys):raise ValueError('Annotation counts must be nonnegative integers')
        if j['truePositiveHigh']>j['expectedHigh'] or j['correctSources']>j['importantDiagnostics'] or j['incorrectlyChanged']>j['shouldKeep']:raise ValueError('Impossible annotation counts')
        if 'reviewedDiagnostics' in j or 'actionableDiagnostics' in j:
            if any(type(j.get(k)) is not int or j[k]<0 for k in ('reviewedDiagnostics','actionableDiagnostics')) or j['actionableDiagnostics']>j['reviewedDiagnostics']:
                raise ValueError('Invalid actionability annotation counts')
    counts={k:sum(j[k] for j in judgments) for k in keys}
    result.update(highRecall=ratio(counts['truePositiveHigh'],counts['expectedHigh']),
                  highPrecision=ratio(counts['truePositiveHigh'],counts['truePositiveHigh']+counts['falsePositiveHigh']),
                  sourceAccuracy=ratio(counts['correctSources'],counts['importantDiagnostics']),
                  keepErrorRate=ratio(counts['incorrectlyChanged'],counts['shouldKeep']),severeErrors=counts['severeErrors'])
    gradients=annotations.get('gradients',[])
    if gradients and (len(gradients)!=len(bases) or {g['baseId'] for g in gradients}!=bases):raise ValueError('Provided gradient judgments must cover all base groups')
    ordered=0
    for g in gradients:
        order=g['expectedOrder']
        if order!=['A','C','D']:raise ValueError('A/C/D gradient must be author-confirmed and human-validated')
        values=[statistics.median(groups[(g['baseId'],v)]) if len(groups[(g['baseId'],v)])==3 else None for v in order]
        ordered+=int(all(v is not None for v in values) and values[0]<values[1]<values[2])
    result['gradientAccuracy']=ratio(ordered,len(gradients))
    actionability_complete=all('reviewedDiagnostics' in j and 'actionableDiagnostics' in j for j in judgments)
    result['adviceActionability']=ratio(sum(j['actionableDiagnostics'] for j in judgments),sum(j['reviewedDiagnostics'] for j in judgments)) if actionability_complete else None
    result['qualityPolicyVersion']='advice_first_v1'
    result['scoreMetricsAreObservational']=True
    thresholds={'highRecall':.9,'highPrecision':.9,'sourceAccuracy':.95,'adviceActionability':.9}
    passed=complete and all(result[k] is not None and result[k]>=v for k,v in thresholds.items()) and result['keepErrorRate'] is not None and result['keepErrorRate']<=.05 and result['severeErrors']==0
    result['status']='quality_thresholds_met' if passed else 'quality_thresholds_not_met'
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    sub=parser.add_subparsers(dest='command',required=True)
    p=sub.add_parser('scaffold');p.add_argument('directory')
    p=sub.add_parser('validate');p.add_argument('manifest')
    p=sub.add_parser('run');p.add_argument('manifest');p.add_argument('--live',action='store_true');p.add_argument('--split',choices=('dev','holdout'),default='dev');p.add_argument('--baseline',action='store_true');p.add_argument('--output',required=True)
    p.add_argument('--version',choices=('v3','v4'),default='v4');p.add_argument('--thinking-level',choices=('low','medium','high'));p.add_argument('--model')
    p=sub.add_parser('summarize');p.add_argument('results');p.add_argument('--annotations')
    args=parser.parse_args()
    if args.command=='scaffold':result=scaffold(args.directory)
    elif args.command=='validate':result={'inputs':len(validate_manifest(args.manifest))}
    elif args.command=='run':result=asyncio.run(run(args))
    else:result=summarize(args.results,args.annotations)
    print(json.dumps(result,ensure_ascii=False,indent=2))


if __name__=='__main__':main()
