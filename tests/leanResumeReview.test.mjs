import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {build} from 'esbuild';
import {normalizeResumeScore} from '../utils/resumeScore.mjs';

const fixture=()=>JSON.parse(readFileSync(new URL('./fixtures/resume-evidence-v4-lean.json',import.meta.url),'utf8'));

test('lean report remains readable without internal receipts or anchor cross checks',()=>{
  const report=fixture();
  assert.deepEqual(normalizeResumeScore(report),report);
  assert.equal(report.reviewCoverage.length,0);
  assert.equal(report.overallScore,75);
  assert.equal(report.suggestions[0].editable,true);
  for(const key of ['reviewChecks','reviewInventory','expressionPlan','metricReview'])assert.equal(report[key],undefined);
});

test('lean input still rejects unsafe facts, operations and invalid grades',()=>{
  for(const mutate of [r=>r.suggestions[0].handling='organize',r=>r.suggestions[0].factGaps[0].sourceRefs=['unknown'],
    r=>r.suggestions[0].operations[0].moduleId='foreign',r=>r.dimensions[0].criteria[0].level=5]){
    const report=fixture();mutate(report);assert.equal(normalizeResumeScore(report),undefined);
  }
});

test('only the enabled lean protocol can start a new optimization; old reports stay readable',async()=>{
  const {outputFiles}=await build({entryPoints:['utils/resumeScore.mjs'],bundle:true,write:false,format:'esm',platform:'node',
    define:{'import.meta.env':JSON.stringify({VITE_ENABLE_EVIDENCE_RESUME_SCORE:'true',VITE_ENABLE_RESUME_REVIEW_V4:'true'})}});
  const u=await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
  assert.equal(u.isCurrentScoreVersion(fixture()),false);
  assert.equal(u.isCurrentScoreVersion(JSON.parse(readFileSync('tests/fixtures/resume-evidence-v4-balanced.json','utf8'))),true);
  for(const file of ['resume-evidence-v3','resume-evidence-v4','resume-evidence-v4-schema2','resume-evidence-v4-schema3']){
    const old=JSON.parse(readFileSync(new URL(`./fixtures/${file}.json`,import.meta.url),'utf8'));
    assert.ok(u.normalizeResumeScore(old));assert.equal(u.isCurrentScoreVersion(old),false);
  }
});

const {outputFiles}=await build({entryPoints:['services/resumeReportDeadline.ts'],bundle:true,write:false,format:'esm',platform:'node',
  define:{'import.meta.env':'{}'}});
const {withResumeReportDeadline,RESUME_REPORT_TIMEOUT_MS}=await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);

test('120-second boundary aborts stalled work without accepting its late result or retrying',async()=>{
  assert.equal(RESUME_REPORT_TIMEOUT_MS,120000);
  let resolveLate,signal,calls=0;
  const pending=withResumeReportDeadline(s=>{calls++;signal=s;return new Promise(resolve=>{resolveLate=resolve;});},undefined,15);
  await assert.rejects(pending,e=>e.code==='ai_runtime_timeout'&&e.name!=='AbortError');
  assert.equal(signal.aborted,true);assert.equal(calls,1);
  resolveLate({overallScore:100});
  await assert.rejects(pending,e=>e.code==='ai_runtime_timeout');
});

test('a report arriving after 60 seconds but before 120 seconds still succeeds',async(t)=>{
  t.mock.timers.enable({apis:['setTimeout']});
  let complete,signal;
  try {
    const result=withResumeReportDeadline(s=>{signal=s;return new Promise(resolve=>{complete=resolve;});});
    t.mock.timers.tick(90_000);
    assert.equal(signal.aborted,false);
    complete('report');assert.equal(await result,'report');
    t.mock.timers.tick(30_000);assert.equal(signal.aborted,false);
  } finally {t.mock.timers.reset();}
});

test('success clears deadline, while user cancellation retains its distinct AbortError',async()=>{
  let signal;
  assert.equal(await withResumeReportDeadline(s=>{signal=s;return Promise.resolve('report');},undefined,10),'report');
  await new Promise(r=>setTimeout(r,20));assert.equal(signal.aborted,false);
  const controller=new AbortController();controller.abort();let calls=0;
  await assert.rejects(withResumeReportDeadline(()=>{calls++;return Promise.resolve('late');},controller.signal),{name:'AbortError'});
  assert.equal(calls,0);
  const during=new AbortController();
  const pending=withResumeReportDeadline(()=>new Promise(()=>{}),during.signal,100);
  during.abort();await assert.rejects(pending,{name:'AbortError'});
});
