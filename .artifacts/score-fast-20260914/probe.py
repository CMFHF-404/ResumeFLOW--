import asyncio,time,json,sys
from pathlib import Path
import httpx
sys.path.insert(0,str(Path('backend').resolve()))
from app.domain.ai.llm_transport import _resolve_ai_route,LANE_RESUME_REVIEW
from app.config import load_settings
async def main():
 r=_resolve_ai_route(lane=LANE_RESUME_REVIEW,model=load_settings().resume_score_model);t=time.perf_counter();result={'requestedServiceTier':'fast'}
 try:
  async with httpx.AsyncClient(timeout=60) as c:
   z=await c.post(r.base_url.rstrip('/')+'/chat/completions',headers={'Authorization':'Bearer '+r.api_key},json={'model':r.model,'messages':[{'role':'user','content':'Reply with OK.'}],'reasoning_effort':'low','max_completion_tokens':64,'service_tier':'fast'})
   result.update(httpStatus=z.status_code)
   d=z.json();result.update(returnedServiceTier=d.get('service_tier'),usage=d.get('usage'),hasChoices=bool(d.get('choices')))
   if z.status_code!=200:result['error']=d.get('error')
 except Exception as e:result['errorType']=type(e).__name__
 result['elapsedSeconds']=round(time.perf_counter()-t,3)
 Path('.artifacts/score-fast-20260914/probe.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
 print(json.dumps(result,ensure_ascii=False))
asyncio.run(main())
