import asyncio,json,time,hashlib,sys
from pathlib import Path
from dataclasses import replace
from datetime import datetime,timezone
import httpx
sys.path.insert(0,str(Path('backend').resolve()))
from app.domain.ai import resume_score,object_review,runtime_budget,llm_transport,resume_evaluation_service
from app.config import load_settings
root=Path('.artifacts/score-fast-20260914')
def save(name,data): (root/name).write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8')
payload=json.loads((root/'input.json').read_text(encoding='utf-8'))
settings=load_settings();usage=[];timing={};calls=0
original_budget=runtime_budget.get_ai_runtime_budget
runtime_budget.get_ai_runtime_budget=lambda:replace(original_budget(),stream_total_timeout_seconds=float('inf'))
async def unlimited(operation,**kwargs): return await operation
runtime_budget.run_with_total_timeout=unlimited
resume_evaluation_service._TOTAL_TIMEOUT_SECONDS=None
llm_transport._build_ai_timeout=lambda:httpx.Timeout(None)
llm_transport._build_gemini_timeout=lambda:httpx.Timeout(None)
original_prepare=llm_transport._prepare_chat_completion_payload
def fast_prepare(payload):
 result=original_prepare(payload)
 result['service_tier']='fast'
 if 'messages' in result: save('wire-request.json',result)
 return result
llm_transport._prepare_chat_completion_payload=fast_prepare
original_decode=llm_transport._decode_provider_json_body
def capture_envelope(body):
 data=original_decode(body)
 save('provider-envelope.json',data)
 timing['returnedServiceTier']=data.get('service_tier')
 return data
llm_transport._decode_provider_json_body=capture_envelope
original_call=resume_score._call_llm
async def captured(messages,**kwargs):
 global calls
 calls+=1
 save('request.json',{'messages':messages,**{k:v for k,v in kwargs.items() if k!='usage_callback'}})
 timing['providerStartSeconds']=round(time.perf_counter()-started,3)
 kwargs['usage_callback']=usage.append
 raw=await original_call(messages,**kwargs)
 timing['providerEndSeconds']=round(time.perf_counter()-started,3)
 save('raw-response.json',raw)
 return raw
resume_score._call_llm=captured
files=['backend/app/domain/ai/'+x+'.py' for x in ['resume_score','object_review','provider_review_schema','llm_transport','evidence_rubric','lean_review']]
hashes={p:hashlib.sha256(Path(p).read_bytes()).hexdigest() for p in files}
manifest=dict(startedAt=datetime.now(timezone.utc).isoformat(),model=settings.resume_score_model,thinking=settings.resume_score_thinking_level,promptVersion=object_review.PROMPT_VERSION,evidenceOutputVersion=object_review.EVIDENCE_OUTPUT_VERSION,timeoutSeconds=None,requestedServiceTier='fast',inputSha256=hashlib.sha256((root/'input.json').read_bytes()).hexdigest(),codeHashes=hashes)
save('manifest.json',manifest)
started=time.perf_counter()
async def main():
 result=dict(status='running')
 print(json.dumps(manifest|{'codeHashes':'saved'},ensure_ascii=False),flush=True)
 try:
  report=await resume_evaluation_service.analyze_resume_evaluation(payload['text'],payload['resume_text'],payload.get('jd_match_percentage'))
  save('report.json',report);r=report['resumeEvaluation']
  result.update(status='success',score=r['overallScore'],dimensions=len(r['dimensions']),suggestions=len(r['suggestions']),blockedSuggestions=sum(bool(s.get('executionBlockReason')) for s in r['suggestions']),reportStatus=r.get('reportStatus'))
 except Exception as e:
  result.update(status='failed',errorType=type(e).__name__)
  if isinstance(e,httpx.HTTPStatusError):result['httpStatus']=e.response.status_code
 finally:
  result.update(elapsedSeconds=round(time.perf_counter()-started,3),calls=calls,timing=timing,usage=usage,codeUnchanged=all(hashlib.sha256(Path(p).read_bytes()).hexdigest()==h for p,h in hashes.items()))
  save('result.json',result);print(json.dumps(result,ensure_ascii=False),flush=True)
asyncio.run(main())
