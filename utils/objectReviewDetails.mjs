const blocks={
  source_unavailable:'这条方案的原文依据无法确认，已禁止自动执行，请手动核查。',
  operation_unavailable:'这条方案没有匹配的可执行操作，已禁止自动执行，请手动核查。',
  parameters_invalid:'这条方案缺少完整有效的操作参数或必要事实确认，已禁止自动执行，请手动核查。',
  duplicate_diagnostic:'这条方案标识重复，已禁止自动执行，请手动核查。',
  fact_already_provided:'当前简历已提供求职方向，本项无需重复确认，已保留原文。',
};
const unique=a=>Array.isArray(a)&&a.every(x=>typeof x==='string')&&new Set(a).size===a.length;
export function validObjectReview(report){
  if(report.metadata?.factQuestionVersion!==undefined&&report.metadata.factQuestionVersion!=='contextual_fact_questions_v1')return false;
  if(!Array.isArray(report.objectCatalog)||!unique(report.objectCatalog.map(o=>o?.objectId)))return false;
  const sources=new Map(report.sources.map(s=>[s.sourceId,s]));
  const objects=new Map(report.objectCatalog.map(o=>[o.objectId,o]));
  if(!report.objectCatalog.every(o=>['kind','moduleId','label','sourceRef'].every(k=>typeof o[k]==='string')&&sources.has(o.sourceRef)&&sources.get(o.sourceRef).path!=='jd'))return false;
  if(!unique(report.focusObjectIds)||report.focusObjectIds.some(id=>objects.get(id)?.kind!=='experience'))return false;
  if(!Number.isInteger(report.unavailableSuggestionCount)||report.unavailableSuggestionCount<0)return false;
  let count=report.unavailableSuggestionCount;
  for(const row of report.suggestions){
    const object=objects.get(row.objectId);
    if(!object)return false;
    if(row.executionBlockReason!==undefined){
      const block=row.executionBlockReason;
      if(!block||blocks[block.code]!==block.message||row.editable!==false||row.operationId!==null||row.needsFacts!==false
        ||row.action!=='verify'||row.handling!=='manual_review'||row.moduleType!=='read_only'||row.moduleId!==object.moduleId
        ||row.label!==object.label||row.problem!=='该对象的修改方案暂不可执行'||row.direction!==block.message||row.impact!==''
        ||!Array.isArray(row.strategySteps)||row.strategySteps.length||JSON.stringify(row.sourceRefs)!==JSON.stringify([object.sourceRef])
        ||(row.operations?.length??0)||(row.factGaps?.length??0))return false;
      count++;
    }else if(typeof row.operationId!=='string'||!row.operationId)return false;
  }
  return report.reportStatus===(count?'partial':'complete');
}
