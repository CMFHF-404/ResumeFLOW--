import {validObjectReview} from './objectReviewDetails.mjs';
import {validSelectionActions} from './selectionActionDetails.mjs';
import {validReviewActionDetails} from './reviewActionDetails.mjs';
export const EVIDENCE_SCORE_VERSION = 'resume_score_v3';
export const EVIDENCE_SCORING_VERSION = 'evidence_rubric_v1';
export const REVIEW_SCORE_VERSION = 'resume_score_v4';
export const REVIEW_SCORING_VERSION = 'evidence_rubric_v2';
export const REVIEW_RESPONSE_SCHEMA_VERSION = 'review_json_schema_v6';
const FACT_GAP_KINDS=['skill_confirmation','target_role','task_scope','method_used','skill_proficiency','metric_definition','validation_setup','delivery_feedback','engineering_measurement','artifact_reference','award_details','research_focus','other'];
export const EVIDENCE_DIMENSIONS = [
  ['logic', '逻辑清晰', 15], ['contribution', '个人贡献', 25], ['readability', '内容可读', 10],
  ['completeness', '内容完整', 15], ['professionalism', '专业表达', 10], ['outcomes', '成果证据', 25],
];
export const REVIEW_AREAS = {positioning:'求职定位', capability:'能力证据', contribution:'个人贡献', outcomes:'成果交付',
  selection:'信息取舍', consistency:'时间与事实一致性', expression:'专业表达', reading_order:'文本阅读顺序'};
export const CAREER_STAGES = {unspecified:'未指定', graduate:'应届/实习', junior:'初级社招'};
export const EVIDENCE_ACTIONS = {retain:'保留', move_forward:'前置', compress:'压缩', delete:'删除建议', rewrite:'改写', ask:'追问', verify:'手动核查'};
const obj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const str = v => typeof v === 'string';
const score = v => Number.isInteger(v) && v >= 0 && v <= 100;
const unique = v => Array.isArray(v) && v.every(str) && new Set(v).size === v.length;
export const normalizeCareerStage = v => Object.hasOwn(CAREER_STAGES, v) ? v : 'unspecified';

export function normalizeEvidenceResumeScore(v) {
  if(v?.evaluationVersion===REVIEW_SCORE_VERSION)return normalizeReviewScore(v);
  if (!obj(v) || v.evaluationVersion !== EVIDENCE_SCORE_VERSION || v.scoringVersion !== EVIDENCE_SCORING_VERSION
    || v.evaluationScope !== 'full_resume' || !['summary','overallLevel','focusRationale','contextNotice'].every(k=>str(v[k])) || !score(v.overallScore)) return undefined;
  if (v.jdMatch !== null && !score(v.jdMatch)) return undefined;
  const c=v.assessmentContext, m=v.metadata, calc=v.scoreCalculation;
  const objectReview=m?.responseSchemaVersion==='review_json_schema_v6';
  if (!obj(c) || !str(c.targetRole) || !str(c.assessmentAsOf) || !Object.hasOwn(CAREER_STAGES,c.careerStage)
    || !['general','role_reference','jd'].includes(c.mode) || c.inputCapabilities?.structuredText !== true
    || c.inputCapabilities?.pageImages !== false || c.inputCapabilities?.layoutMeasurements !== false
    || !obj(m) || !['promptVersion','rubricVersion','guideVersion','inputHash','model','provider','transport'].every(k=>str(m[k]))
    || m.rubricVersion !== EVIDENCE_SCORING_VERSION || !obj(m.reasoning)
    || !obj(calc) || calc.finalScore !== v.overallScore || !Number.isFinite(calc.rawTotal) || calc.rawTotal<0 || calc.rawTotal>100
    || calc.roundingRule !== 'round_half_up' || calc.calibrationStatus !== 'pending_human_validation') return undefined;
  if (!Array.isArray(v.sources) || !v.sources.every(s=>obj(s)&&['sourceId','path','text'].every(k=>str(s[k]))&&['text','scope'].includes(s.kind))
    || !unique(v.sources.map(s=>s.sourceId))) return undefined;
  const sources=new Map(v.sources.map(s=>[s.sourceId,s]));
  const refs=(r, required=true, jd=false)=>unique(r)&&(!required||r.length>0)&&r.every(id=>sources.has(id)&&(sources.get(id).path==='jd')===jd);
  const jdRefs=r=>refs(r??[],false,true)&&(c.mode==='jd'||!(r??[]).length);
  if (!Array.isArray(v.dimensions) || v.dimensions.length!==6 || !unique(v.dimensions.map(d=>d?.dimensionId))) return undefined;
  for (const [id,name,weight] of EVIDENCE_DIMENSIONS) {
    const d=v.dimensions.find(d=>d.dimensionId===id);
    if (!d||d.dimension!==name||d.weight!==weight||!score(d.score)||!str(d.comment)||!Array.isArray(d.criteria)||d.criteria.length!==3
      ||!unique(d.criteria.map(x=>x?.criterionId))) return undefined;
    if(objectReview&&(!refs(d.sourceRefs)||!jdRefs(d.jdSourceRefs)))return undefined;
    for(let i=1;i<=3;i++) {
      const x=d.criteria.find(x=>x.criterionId===`${id}_${i}`);
      if(!x||!str(x.label)||!Number.isInteger(x.level)||x.level<0||x.level>4||(!objectReview&&(!str(x.reason)||!refs(x.sourceRefs)||!jdRefs(x.jdSourceRefs)))||(objectReview&&('reason' in x||'sourceRefs' in x)))return undefined;
    }
  }
  if (!Array.isArray(calc.dimensions)||calc.dimensions.length!==6||!unique(calc.dimensions.map(d=>d?.dimensionId))
    ||!calc.dimensions.every(d=>EVIDENCE_DIMENSIONS.some(([id,,w])=>d.dimensionId===id&&d.weight===w)
      &&Number.isInteger(d.levelSum)&&d.levelSum>=0&&d.levelSum<=12&&Number.isFinite(d.rawScore)&&d.rawScore>=0&&d.rawScore<=100))return undefined;
  if(!Array.isArray(v.reviewCoverage)||(['review_json_schema_v5',REVIEW_RESPONSE_SCHEMA_VERSION].includes(m.responseSchemaVersion)?v.reviewCoverage.length!==0:v.reviewCoverage.length!==8)||!unique(v.reviewCoverage.map(r=>r?.area))
    ||!v.reviewCoverage.every(r=>Object.hasOwn(REVIEW_AREAS,r.area)&&['findings','clear','not_applicable'].includes(r.status)&&str(r.reason)))return undefined;
  if(!Array.isArray(v.strengths)||!v.strengths.every(s=>obj(s)&&str(s.text)&&str(s.reason)&&refs(s.sourceRefs)&&jdRefs(s.jdSourceRefs)))return undefined;
  if(!Array.isArray(v.requirements)||(c.mode!=='jd'&&v.requirements.length)||!v.requirements.every(r=>obj(r)&&str(r.requirement)&&str(r.reason)
    &&['demonstrated','weak','not_demonstrated','unknown'].includes(r.status)&&refs(r.jdSourceRefs,true,true)&&refs(r.sourceRefs,false)))return undefined;
  if(!Array.isArray(v.suggestions)||!unique(v.suggestions.map(s=>s?.suggestionId)))return undefined;
  for(const s of v.suggestions) {
    if(!['suggestionId','targetId','moduleType','moduleId','fieldPath','label','problem','impact','direction'].every(k=>str(s[k]))
      ||!EVIDENCE_DIMENSIONS.some(([id,name])=>s.dimensionId===id&&s.dimension===name)||!['high','medium','low'].includes(s.severity)
      ||!['stated','not_demonstrated','conflicting','role_reference'].includes(s.evidenceState)||!Object.hasOwn(EVIDENCE_ACTIONS,s.action)
      ||typeof s.needsFacts!=='boolean'||typeof s.editable!=='boolean'||!refs(s.sourceRefs)||!jdRefs(s.jdSourceRefs))return undefined;
    if(s.editable&&(!['personal_summary','experience_star','skills_order','section_order','skill_text','education_courses','education_notes','certification_order','certification_hide','experience_order','experience_hide','experience_restructure','skill_create'].includes(s.moduleType)
      ||['retain','delete','verify'].includes(s.action)||(s.action==='move_forward'&&!['skills_order','section_order'].includes(s.moduleType))
      ||(['skills_order','section_order'].includes(s.moduleType)&&(s.action!=='move_forward'||s.needsFacts))))return undefined;
  }
  // The service owns the algorithm. Never replace its total with an average of rounded display scores.
  return {...v,dimensions:EVIDENCE_DIMENSIONS.map(([id])=>v.dimensions.find(d=>d.dimensionId===id))};
}

function normalizeReviewScore(v) {
  if(v.scoringVersion!==REVIEW_SCORING_VERSION || v.metadata?.rubricVersion!==REVIEW_SCORING_VERSION
    ||v.metadata?.readingVersion!==(v.metadata?.responseSchemaVersion===REVIEW_RESPONSE_SCHEMA_VERSION?'object_reading_v1':'visible_reading_v1'))return undefined;
  if(v.metadata.responseSchemaVersion!==undefined&&!['review_json_schema_v1','review_json_schema_v2','review_json_schema_v3','review_json_schema_v4','review_json_schema_v5',REVIEW_RESPONSE_SCHEMA_VERSION].includes(v.metadata.responseSchemaVersion))return undefined;
  const balanced=v.metadata.responseSchemaVersion===REVIEW_RESPONSE_SCHEMA_VERSION;
  const lean=['review_json_schema_v5',REVIEW_RESPONSE_SCHEMA_VERSION].includes(v.metadata.responseSchemaVersion);
  if(balanced&&(!Array.isArray(v.suggestions)||!unique(v.suggestions.map(s=>s?.suggestionId))))return undefined;
  const active=balanced?v.suggestions.filter(s=>s.executionBlockReason===undefined):v.suggestions;
  const base=normalizeEvidenceResumeScore({...v,suggestions:active,evaluationVersion:EVIDENCE_SCORE_VERSION,scoringVersion:EVIDENCE_SCORING_VERSION,
    metadata:{...v.metadata,rubricVersion:EVIDENCE_SCORING_VERSION}});
  if(!base)return undefined;
  if(balanced&&!validObjectReview(v))return undefined;
  const sources=new Map(v.sources.map(s=>[s.sourceId,s]));
  const refs=r=>unique(r)&&r.length>0&&r.every(x=>sources.has(x)&&sources.get(x).path!=='jd');
  const criteria=new Map(v.dimensions.flatMap(d=>d.criteria.map(c=>[c.criterionId,c])));
  const diagnoses=new Map();
  for(const s of active) {
    if(['review_json_schema_v4','review_json_schema_v5',REVIEW_RESPONSE_SCHEMA_VERSION].includes(v.metadata.responseSchemaVersion)&&(!['fix','enhance'].includes(s.recommendationKind)||(!lean&&s.recommendationKind==='enhance'&&s.severity!=='low')))return undefined;
    if(v.metadata.responseSchemaVersion||s.strategySteps!==undefined){
      if((balanced&&!s.strategySteps?.length&&(!str(s.direction)||!s.direction.trim()))||!Array.isArray(s.strategySteps)||(!balanced&&s.strategySteps.length<1)||(!lean&&s.strategySteps.length>4)||!s.strategySteps.every(step=>str(step)&&step.trim()))return undefined;
    }
    if(!str(s.diagnosticId)||!s.diagnosticId||diagnoses.has(s.diagnosticId)||!criteria.has(s.primaryCriterionId)
      ||!s.primaryCriterionId.startsWith(`${s.dimensionId}_`)||!['organize','ask_user','manual_review'].includes(s.handling)
      ||!Array.isArray(s.factGaps)||!unique(s.factGaps.map(g=>g?.gapId)))return undefined;
    if(s.needsFacts!==(s.factGaps.length>0)||(s.handling==='organize'&&s.factGaps.length)||(s.handling==='ask_user'&&!s.factGaps.length)
      ||(s.handling==='manual_review'&&s.editable)||(s.action==='ask'&&s.handling!=='ask_user')||(s.action==='verify'&&s.handling!=='manual_review'))return undefined;
    if(!s.factGaps.every(g=>str(g.question)&&g.question.trim()&&str(g.reason)&&g.reason.trim()&&refs(g.sourceRefs)))return undefined;
    if(['review_json_schema_v4','review_json_schema_v5',REVIEW_RESPONSE_SCHEMA_VERSION].includes(v.metadata.responseSchemaVersion)&&s.factGaps.some(g=>!FACT_GAP_KINDS.includes(g.kind)))return undefined;
    diagnoses.set(s.diagnosticId,s);
  }
  if(lean){
    if(v.assessmentContext.mode==='general'&&v.contextNotice!=='尚未提供求职方向，本次为通用内容评估')return undefined;
    if(!validSelectionActions({...v,suggestions:active}))return undefined;
    for(const s of active){
      if(s.moduleType==='skill_text'&&(!['regroup','clarify_existing','add_tool','change_proficiency'].includes(s.skillAction)||s.handling!=='ask_user'||!s.needsFacts||s.fieldPath!=='skill.text'||!s.factGaps.some(g=>g.kind==='skill_confirmation')))return undefined;
      if(s.moduleType==='skill_create'&&!s.factGaps.some(g=>g.kind==='skill_confirmation'))return undefined;
    }
    return {...v,dimensions:base.dimensions};
  }
  for(const [id,c] of criteria) {
    if(c.anchorId!==`${id}:L${c.level}`||!str(c.anchorText)||!str(c.gapExplanation)||!Array.isArray(c.unmetConditions)
      ||!unique(c.unmetConditions.map(u=>u?.conditionId))||!unique(c.diagnosticIds))return undefined;
    const allowed=Array.from({length:4-c.level},(_,i)=>`${id}:L${c.level+i+1}`);
    if((c.level<4&&!c.unmetConditions.length)||!c.unmetConditions.every(u=>allowed.includes(u.conditionId)&&str(u.label)&&str(u.reason)&&u.reason.trim()))return undefined;
    const linked=[...diagnoses.values()].filter(s=>s.primaryCriterionId===id);
    if(c.diagnosticIds.length!==linked.length||linked.some(s=>!c.diagnosticIds.includes(s.diagnosticId)))return undefined;
    if(c.level>=3&&linked.some(s=>s.severity==='high')&&!c.gapExplanation.trim())return undefined;
  }
  if(!Array.isArray(v.reviewInventory)||!v.reviewInventory.length||!unique(v.reviewInventory.map(c=>c?.checkId)))return undefined;
  const inventory=new Map(v.reviewInventory.map(c=>[c.checkId,c]));
  if(!v.reviewInventory.every(c=>Object.hasOwn(REVIEW_AREAS,c.topic)&&str(c.label)&&refs(c.scopeRefs)))return undefined;
  if(!Array.isArray(v.reviewChecks)||v.reviewChecks.length!==inventory.size||!unique(v.reviewChecks.map(c=>c?.checkId)))return undefined;
  const referenced=new Set();
  for(const c of v.reviewChecks) {
    const item=inventory.get(c.checkId);
    if(!item||c.topic!==item.topic||c.label!==item.label||JSON.stringify(c.scopeRefs)!==JSON.stringify(item.scopeRefs)
      ||!['findings','clear','not_applicable'].includes(c.status)||!str(c.reason)||!c.reason.trim()||!refs(c.sourceRefs)||!unique(c.diagnosticIds))return undefined;
    if((c.status==='findings')!==(c.diagnosticIds.length>0)||c.diagnosticIds.some(id=>!diagnoses.has(id)))return undefined;
    const scopes=item.scopeRefs.map(id=>sources.get(id).path);
    if(!c.sourceRefs.some(id=>scopes.some(p=>sources.get(id).path===p||sources.get(id).path.startsWith(`${p}.`)||sources.get(id).path.startsWith(`${p}[`))))return undefined;
    c.diagnosticIds.forEach(id=>referenced.add(id));
  }
  if(referenced.size!==diagnoses.size)return undefined;
  if(v.assessmentContext.mode==='general'&&v.contextNotice!=='尚未提供求职方向，本次为通用内容评估')return undefined;
  if(['review_json_schema_v3','review_json_schema_v4'].includes(v.metadata.responseSchemaVersion)&&!validReviewActionDetails(v))return undefined;
  if(v.metadata.responseSchemaVersion==='review_json_schema_v4'&&!validSelectionActions(v))return undefined;
  return {...v,dimensions:base.dimensions};
}
