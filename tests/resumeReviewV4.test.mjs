import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {build} from 'esbuild';
import {normalizeResumeScore} from '../utils/resumeScore.mjs';
const fixture=()=>JSON.parse(readFileSync(new URL('./fixtures/resume-evidence-v4.json',import.meta.url),'utf8'));

test('v4 report retains anchors, module coverage, fact questions and service score',()=>{
  const r=fixture(),n=normalizeResumeScore(r);
  assert.ok(n);assert.equal(n.overallScore,75);assert.equal(n.evaluationVersion,'resume_score_v4');
  assert.equal(n.dimensions[0].criteria[0].anchorId,'logic_1:L3');
  assert.ok(n.reviewChecks.length>8);assert.equal(n.suggestions[0].handling,'ask_user');
  assert.equal(n.suggestions[0].factGaps[0].question,'你实际承担的任务、对象和范围是什么？');
  assert.equal(n.suggestions[0].recommendationKind,'fix');
  assert.equal(n.suggestions[0].strategySteps.length,2);
  assert.deepEqual(normalizeResumeScore(JSON.parse(JSON.stringify(n))),n);
});

test('v4 rejects incomplete checks, invalid anchors, unlinked issues and inconsistent fact handling',()=>{
  for(const mutate of [r=>r.reviewChecks.pop(),r=>r.reviewChecks[0].diagnosticIds=[],r=>r.reviewChecks[0].reason='',
    r=>r.reviewChecks[1].sourceRefs=[r.sources[0].sourceId],r=>r.dimensions[0].criteria[0].anchorId='logic_1:L4',
    r=>r.dimensions[0].criteria[0].unmetConditions=[],r=>r.suggestions[0].handling='organize',
    r=>r.suggestions[0].needsFacts=false,r=>r.suggestions[0].primaryCriterionId='outcomes_1',
    r=>r.suggestions[0].severity='high',r=>r.suggestions[0].strategySteps=[],r=>r.suggestions[0].recommendationKind='enhance',
    r=>r.suggestions[0].factGaps[0].kind='unknown']){
    const r=fixture();mutate(r);assert.equal(normalizeResumeScore(r),undefined);
  }
});

test('metric citations accept own title facts without allowing cross-experience or ID evidence',()=>{
  const r=fixture();
  const title=r.sources.find(s=>s.path==='resume.experiences[0].title');
  const span=r.evidenceSpans.find(s=>s.sourceRef===title.sourceId);
  r.metricReview[0].aspects[0].spanIds=[span.spanId];assert.ok(normalizeResumeScore(r));
  const original=r.sources.find(s=>s.path==='resume.experiences[0].id');
  const idSpan=r.evidenceSpans.find(s=>s.sourceRef===original.sourceId);
  const bad=structuredClone(r);bad.metricReview[0].aspects[0].spanIds=[idSpan.spanId];assert.equal(normalizeResumeScore(bad),undefined);
  const foreign=structuredClone(r);foreign.sources.push({...title,sourceId:'other-title',path:'resume.experiences[1].title'});
  foreign.evidenceSpans.push({...span,spanId:'other-title-span',sourceRef:'other-title'});foreign.metricReview[0].aspects[0].spanIds=['other-title-span'];assert.equal(normalizeResumeScore(foreign),undefined);
  r.expressionPlan[0].retain.spanIds=[span.spanId];assert.ok(normalizeResumeScore(r));
  r.expressionPlan[0].compress.spanIds=[span.spanId];assert.equal(normalizeResumeScore(r),undefined);
});

test('v4 activation requires both evidence and v4 flags; historical reports stay readable',async()=>{
  const v3=JSON.parse(readFileSync(new URL('./fixtures/resume-evidence-v3.json',import.meta.url),'utf8'));
  for(const [evidence,v4] of [[false,false],[false,true],[true,false],[true,true]]){
    const {outputFiles}=await build({entryPoints:['utils/resumeScore.mjs'],bundle:true,write:false,format:'esm',platform:'node',
      define:{'import.meta.env':JSON.stringify({VITE_ENABLE_EVIDENCE_RESUME_SCORE:String(evidence),VITE_ENABLE_RESUME_REVIEW_V4:String(v4)})}});
    const u=await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
    assert.equal(u.isCurrentScoreVersion(fixture()),false);
    const current=JSON.parse(readFileSync(new URL('./fixtures/resume-evidence-v4-balanced.json',import.meta.url),'utf8'));
    assert.equal(u.isCurrentScoreVersion(current),evidence&&v4);
    assert.equal(u.isCurrentScoreVersion(v3),evidence&&!v4);
    assert.ok(u.normalizeResumeScore(v3));assert.ok(u.normalizeResumeScore(fixture()));
    const historical=fixture();delete historical.metadata.responseSchemaVersion;
    assert.ok(u.normalizeResumeScore(historical));assert.equal(u.isCurrentScoreVersion(historical),false);
  }
});
