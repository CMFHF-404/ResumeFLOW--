import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {normalizeResumeScore,scoreModuleKey} from '../utils/resumeScore.mjs';

const fixture=(partial=false)=>JSON.parse(readFileSync(`tests/fixtures/resume-evidence-v4-balanced${partial?'-partial':''}.json`,'utf8'));

test('balanced report retains 18 grades and six explanations without invented criterion evidence',()=>{
  const r=fixture();assert.deepEqual(normalizeResumeScore(r),r);
  assert.equal(r.dimensions.flatMap(d=>d.criteria).length,18);
  assert.ok(r.dimensions.every(d=>d.comment&&d.sourceRefs.length));
  assert.ok(r.dimensions.every(d=>d.criteria.every(c=>!('reason' in c)&&!('sourceRefs' in c))));
  assert.equal(r.overallScore,75);
});

test('partial report keeps valid actions and rejects attempts to enable blocked actions',()=>{
  const r=fixture(true);assert.deepEqual(normalizeResumeScore(r),r);
  assert.equal(r.reportStatus,'partial');assert.equal(r.unavailableSuggestionCount,1);
  assert.equal(r.suggestions[0].editable,true);assert.equal(r.suggestions[1].editable,false);
  assert.equal(scoreModuleKey(r.suggestions[1]),'experience_star:exp1');
  assert.ok(!JSON.stringify(r).includes('UNVERIFIED CLAIM'));
  for(const mutate of [x=>x.suggestions[1].editable=true,x=>x.suggestions[1].operationId='experience_restructure',
    x=>x.suggestions[1].direction='UNVERIFIED CLAIM',x=>x.reportStatus='complete',x=>x.focusObjectIds=['UNKNOWN']]){
    const bad=fixture(true);mutate(bad);assert.equal(normalizeResumeScore(bad),undefined);
  }
});

test('broken scoring references, malformed source catalog or grades reject the report',()=>{
  for(const mutate of [r=>r.sources=null,r=>r.dimensions[0].sourceRefs=['UNKNOWN'],
    r=>r.dimensions[0].criteria[0].level=5,r=>r.dimensions[0].criteria[0].reason='invented per-item rationale']){
    const r=fixture();mutate(r);assert.equal(normalizeResumeScore(r),undefined);
  }
});

test('old evidence protocols retain their original reading semantics',()=>{
  for(const file of ['resume-evidence-v3','resume-evidence-v4-schema2','resume-evidence-v4-schema3','resume-evidence-v4','resume-evidence-v4-lean']){
    const r=JSON.parse(readFileSync(`tests/fixtures/${file}.json`,'utf8'));
    assert.ok(normalizeResumeScore(r));
  }
});

test('known-role reminders stay non-executable and contextual question versions are checked',()=>{
  const report=fixture(true);
  report.metadata.factQuestionVersion='contextual_fact_questions_v1';
  const blocked=report.suggestions[1];
  const message='当前简历已提供求职方向，本项无需重复确认，已保留原文。';
  blocked.executionBlockReason={code:'fact_already_provided',message};
  blocked.direction=message;
  assert.deepEqual(normalizeResumeScore(report),report);
  blocked.editable=true;
  assert.equal(normalizeResumeScore(report),undefined);
  blocked.editable=false;
  report.metadata.factQuestionVersion='unknown_version';
  assert.equal(normalizeResumeScore(report),undefined);
});
