import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {build} from 'esbuild';
import {normalizeResumeScore} from '../utils/resumeScore.mjs';
const fixture=()=>JSON.parse(readFileSync(new URL('./fixtures/resume-evidence-v3.json',import.meta.url),'utf8'));

test('JD context is retained separately and cannot replace resume evidence',()=>{
  const r=fixture();r.assessmentContext.mode='jd';
  r.sources.push({sourceId:'jd-context',path:'jd',text:'合成岗位要求',kind:'text'});
  const criterion=r.dimensions[0].criteria[0];criterion.jdSourceRefs=['jd-context'];
  r.suggestions[0].jdSourceRefs=['jd-context'];r.strengths[0].jdSourceRefs=['jd-context'];
  assert.deepEqual(normalizeResumeScore(r).dimensions[0].criteria[0].jdSourceRefs,['jd-context']);
  assert.equal(normalizeResumeScore(r).overallScore,r.overallScore);
  criterion.sourceRefs=['jd-context'];assert.equal(normalizeResumeScore(r),undefined);
});

test('v3 preserves service weighted total, levels, evidence and independent JD score',()=>{
  const raw=fixture(), r=normalizeResumeScore(raw);
  assert.ok(r);assert.equal(r.overallScore,63);
  assert.equal(Math.round(r.dimensions.reduce((s,d)=>s+d.score,0)/6),67);
  assert.equal(r.jdMatch,null);assert.equal(r.dimensions[1].dimension,'个人贡献');
  assert.equal(r.dimensions[5].dimension,'成果证据');assert.deepEqual(r.sources,raw.sources);
  assert.deepEqual(normalizeResumeScore(JSON.parse(JSON.stringify(r))),r);
});

test('v3 rejects malformed criteria, invented citations, manual write targets and invalid context',()=>{
  for(const change of [r=>r.dimensions.pop(),r=>r.dimensions[0].criteria[0].level=5,
    r=>r.dimensions[0].criteria[0].level=true,r=>r.reviewCoverage.pop(),r=>r.suggestions[0].sourceRefs=['missing'],
    r=>r.suggestions[0].action='delete',r=>r.suggestions[0].moduleType='read_only',
    r=>r.assessmentContext.inputCapabilities.pageImages=true,r=>r.metadata.rubricVersion='old',r=>r.scoreCalculation.finalScore=12]){
    const raw=fixture();change(raw);assert.equal(normalizeResumeScore(raw),undefined);
  }
});

test('career stage changes evaluation signature without changing JD-match candidates',async()=>{
  const {outputFiles}=await build({entryPoints:['hooks/jdAnalysisSignatureUtils.ts'],bundle:true,format:'esm',platform:'node',write:false});
  const u=await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
  const a=u.buildAnalyzePayload([],[],[],{careerStage:'graduate'}),b=u.buildAnalyzePayload([],[],[],{careerStage:'junior'});
  assert.equal(a.career_stage,'graduate');assert.notEqual(u.canonicalStringify(a),u.canonicalStringify(b));
  assert.deepEqual(a.match_candidates,b.match_candidates);
  assert.equal('career_stage' in u.buildAnalyzePayload([],[],[],{}),false,'legacy unspecified signatures keep their shape');
});

test('feature gate retains legacy operation until activation, then requires v3',async()=>{
  for(const enabled of [false,true]){
    const {outputFiles}=await build({entryPoints:['utils/resumeScore.mjs'],bundle:true,format:'esm',platform:'node',write:false,
      define:{'import.meta.env':JSON.stringify({VITE_ENABLE_EVIDENCE_RESUME_SCORE:String(enabled)})}});
    const u=await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
    assert.equal(u.isCurrentScoreVersion({evaluationVersion:'resume_score_v2',scoringVersion:'single_pass_v1'}),!enabled);
    assert.equal(u.isCurrentScoreVersion(fixture()),enabled);
  }
});

test('career stage participates in committed saves and restores without leaking across resumes',async()=>{
  // Real config applier with setter spies, bundled to keep the Node test independent of TS loaders.
  const {outputFiles}=await build({entryPoints:['hooks/useResumeDataAppliers.ts'],bundle:true,format:'esm',platform:'node',write:false});
  const u=await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
  let stage='graduate';const noop=()=>{};
  const apply=u.createApplyResumeConfig(noop,noop,noop,noop,noop,noop,noop,noop,noop,()=>[],()=> 'local',()=>({summary:''}),v=>stage=v);
  apply({careerStage:'junior'});assert.equal(stage,'junior');apply({});assert.equal(stage,'unspecified');
  apply({careerStage:'unexpected'});assert.equal(stage,'unspecified');
});
