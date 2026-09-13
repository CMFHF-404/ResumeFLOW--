export function validReviewActionDetails(v) {
  const unique=a=>Array.isArray(a)&&a.every(x=>typeof x==='string')&&new Set(a).size===a.length;
  const sources=new Map(v.sources.map(s=>[s.sourceId,s]));
  if(!Array.isArray(v.evidenceSpans)||!unique(v.evidenceSpans.map(s=>s?.spanId)))return false;
  for(const s of v.evidenceSpans){const src=sources.get(s.sourceRef);if(!src||src.path==='jd'||!Number.isInteger(s.start)||!Number.isInteger(s.end)||s.start<0||s.end<=s.start||s.end>Array.from(src.text).length||Array.from(src.text).slice(s.start,s.end).join('')!==s.text)return false;}
  const spans=new Map(v.evidenceSpans.map(s=>[s.spanId,s]));
  const roots=new Map(v.sources.filter(s=>s.path.startsWith('resume.experiences[')&&s.path.endsWith('.id')).map(s=>[s.text,s.path.slice(0,-3)]));
  const diagnoses=new Map(v.suggestions.map(s=>[s.diagnosticId,s]));
  const links=a=>unique(a)&&a.every(x=>diagnoses.has(x));
  const refs=(a,id,metric=false)=>unique(a)&&a.every(x=>{
    if(!spans.has(x))return false;
    const path=sources.get(spans.get(x).sourceRef).path,root=roots.get(id);
    return path.startsWith(root+'.star.')||(metric&&['title','org','start_date','end_date'].some(field=>path===root+'.'+field));
  });
  for(const s of v.suggestions){
    if(!unique(s.evidenceSpanIds)||s.evidenceSpanIds.some(x=>!spans.has(x)))return false;
    if(s.moduleType==='skill_text'&&(!['regroup','clarify_existing','add_tool','change_proficiency'].includes(s.skillAction)||s.handling!=='ask_user'||!s.needsFacts||s.fieldPath!=='skill.text'))return false;
  }
  for(const key of ['expressionPlan','metricReview']){
    if(!Array.isArray(v[key])||v[key].length!==roots.size||!unique(v[key].map(x=>x?.moduleId))||v[key].some(x=>!roots.has(x.moduleId)))return false;
    for(const row of v[key]){
      if(key==='expressionPlan'){
        if(!links(row.diagnosticIds)||!unique(row.readingOrder)||!row.readingOrder.length||row.readingOrder.some(x=>!['problem_result','personal_actions','validation'].includes(x)))return false;
        for(const field of ['retain','compress','lead']){const p=row[field];if(!p||!['retain','adjust','not_applicable'].includes(p.status)||typeof p.reason!=='string'||!p.reason.trim()||!refs(p.spanIds,row.moduleId,field==='retain'&&p.status==='retain')||((p.status==='adjust'||field==='retain'&&p.status==='retain')&&!p.spanIds.length)||(p.status==='adjust'&&!row.diagnosticIds.length))return false;}
      }else{
        if(!Array.isArray(row.aspects)||row.aspects.length!==5||!unique(row.aspects.map(a=>a?.aspect)))return false;
        for(const a of row.aspects)if(!['meaning','scope','comparison','validation','conclusion'].includes(a.aspect)||!['stated','explain','confirm','not_applicable'].includes(a.status)||typeof a.reason!=='string'||!a.reason.trim()||!refs(a.spanIds,row.moduleId,true)||!links(a.diagnosticIds)||(a.status!=='not_applicable'&&!a.spanIds.length)||(['explain','confirm'].includes(a.status)&&!a.diagnosticIds.length)||(a.status==='confirm'&&!a.diagnosticIds.some(x=>diagnoses.get(x).needsFacts)))return false;
      }
    }
  }
  return true;
}
