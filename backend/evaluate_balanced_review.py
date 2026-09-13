"""Frozen, interleaved old/new development comparison; one call per evaluation."""
import argparse
import asyncio
from contextvars import ContextVar
from dataclasses import replace
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import time
from types import SimpleNamespace

from app.domain.ai import lean_review, object_review, resume_score, runtime_budget
from app.domain.ai.llm_transport import _resolve_ai_route


def read(path):return json.loads(Path(path).read_text(encoding='utf-8'))
def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def write(path,data):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    with path.open('x',encoding='utf-8') as f:json.dump(data,f,ensure_ascii=False,indent=2)


async def run(args):
    if not args.live:raise ValueError('Explicit --live required for provider testing')
    manifest=read(args.manifest)
    for sample in manifest['samples']:
        if sha(sample['path'])!=sample['inputHash']:raise ValueError('Frozen input changed')
    root=Path(args.output);root.mkdir(parents=True,exist_ok=False)
    route=_resolve_ai_route(model='gemini-3.5-flash-lite')
    if route.model!='gemini-3.5-flash-lite' or route.provider!='gemini':raise ValueError('Exact Gemini route required')
    variants={'lean':lean_review,'balanced':object_review}
    chosen=list(variants) if args.variant=='paired' else [args.variant]
    files=[Path(m.__file__) for m in (lean_review,object_review,resume_score)]
    files += [Path(object_review.__file__).with_name(n) for n in ('review_objects.py','review_questions.py','evidence_rubric.py','evidence_rubric_v2.py','review_actions.py','selection_actions.py','provider_review_schema.py','review_response_schema.py','evidence_anchors_v2.json','llm_transport.py')]
    frozen={str(p):sha(p) for p in files}
    as_of=datetime.now(timezone.utc).date().isoformat()
    write(root/'run-manifest.json',dict(model=route.model,provider=route.provider,thinking='medium',timeoutSeconds=115,concurrency=1,
        repetitions=args.repeat,variants=chosen,assessmentAsOf=as_of,inputs=manifest['samples'],codeHashes=frozen,harnessHash=sha(__file__),
        prompts={k:dict(version=variants[k].PROMPT_VERSION,hash=hashlib.sha256(variants[k].prompt().encode()).hexdigest()) for k in chosen},
        scope='development comparison; no independent HR acceptance',startedAt=datetime.now(timezone.utc).isoformat()))
    current_output=ContextVar('balanced_output',default=None)
    original=resume_score._call_llm
    async def capture(messages,**kwargs):
        target=current_output.get()
        write(target/'request.json',dict(messages=messages,model=kwargs.get('model'),thinking=kwargs.get('gemini_thinking_level'),schema=kwargs.get('gemini_response_json_schema')))
        response=await original(messages,**kwargs)
        write(target/'raw.json',response)
        return response
    records=[];timeouts={k:0 for k in chosen};stopped=set()
    resume_score._call_llm=capture
    try:
        for repetition in range(1,args.repeat+1):
            for index,sample in enumerate(manifest['samples']):
                order=chosen if (repetition+index)%2 else list(reversed(chosen))
                for variant in order:
                    if any(sha(p)!=digest for p,digest in frozen.items()):raise ValueError('Scoring code changed during frozen run')
                    target=root/variant/f"{sample['id']}-{repetition}"
                    record=dict(sampleId=sample['id'],variant=variant,repetition=repetition,inputHash=sample['inputHash'])
                    if variant in stopped:
                        record.update(status='not_run',errorType='StoppedAfterTwoConsecutiveTimeouts',elapsedSeconds=0,usage=[])
                    else:
                        data=read(sample['path']);usage=[];start=time.perf_counter();current_output.set(target)
                        write(target/'started.json',dict(record,startedAt=datetime.now(timezone.utc).isoformat()))
                        module=variants[variant]
                        def context(snapshot,jd):
                            result=module.assessment_context(snapshot,jd);result['assessmentAsOf']=as_of;return result
                        rubric=SimpleNamespace(**dict(vars(module),assessment_context=context))
                        try:
                            result=await runtime_budget.run_with_total_timeout(resume_score._generate_evidence_score(
                                data.get('jd',''),json.dumps(data['snapshot'],ensure_ascii=False),rubric=rubric,usage_callback=usage.append,
                                model=route.model,thinking_level='medium'),budget=replace(runtime_budget.get_ai_runtime_budget(),stream_total_timeout_seconds=115))
                            report=result['resumeEvaluation'];record.update(status='success',report=report,
                                blockedSuggestions=sum(bool(s.get('executionBlockReason')) for s in report['suggestions']),
                                unavailableSuggestions=report.get('unavailableSuggestionCount',0))
                            timeouts[variant]=0
                        except Exception as exc:
                            record.update(status='error',errorType=type(exc).__name__,causeType=type(exc.__cause__).__name__ if exc.__cause__ else None)
                            timeouts[variant]=timeouts[variant]+1 if isinstance(exc,runtime_budget.AiRuntimeTimeoutError) else 0
                            if timeouts[variant]>=2:stopped.add(variant)
                        record.update(elapsedSeconds=round(time.perf_counter()-start,3),usage=usage)
                    write(target/'result.json',record);records.append(record)
                    print(json.dumps({k:record[k] for k in ('variant','sampleId','repetition','status','elapsedSeconds')}|{'blocked':record.get('blockedSuggestions')},ensure_ascii=False),flush=True)
    finally:resume_score._call_llm=original
    write(root/'summary.json',dict(expectedCalls=len(chosen)*args.repeat*len(manifest['samples']),records=[{k:v for k,v in r.items() if k not in ('report','usage')} for r in records],productionEligible=False))


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('manifest');p.add_argument('--output',required=True)
    p.add_argument('--variant',choices=('lean','balanced','paired'),default='paired');p.add_argument('--repeat',type=int,default=3);p.add_argument('--live',action='store_true')
    args=p.parse_args()
    if args.repeat<1:raise ValueError('Positive repetitions required')
    asyncio.run(run(args))
