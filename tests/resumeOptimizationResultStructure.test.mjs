import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'esbuild';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const rootDir = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));

const importResult = async () => {
  const tempDir = mkdtempSync(join(rootDir, 'tests/.tmp-resume-optimization-result-'));
  const outputPath = join(tempDir, 'ResumeOptimizationResult.mjs');
  try {
    await build({
      entryPoints: [join(rootDir, 'views/ResumeEditor/components/ResumeOptimization/ResumeOptimizationResult.tsx')],
      bundle: true,
      format: 'esm',
      platform: 'node',
      outfile: outputPath,
      external: ['react', 'react/jsx-runtime', 'lucide-react'],
      logLevel: 'silent',
    });
    const module = await import(`${pathToFileURL(outputPath).href}?${Math.random()}`);
    return { ...module, cleanup: () => rmSync(tempDir, { recursive: true, force: true }) };
  } catch (error) {
    rmSync(tempDir, { recursive: true, force: true });
    throw error;
  }
};

const dimensions = ['逻辑清晰', 'STAR应用', '内容可读', '内容完整', '专业表达', '成果量化'];

const plan = {
  changes: [],
  questions: [],
  bankSuggestions: [{ suggestionId: 'bank-1' }],
  safetySummary: {
    allowedChangeIds: ['change-a', 'change-b'],
    blockedChangeIds: ['change-blocked'],
    pendingChangeIds: [],
    findings: [],
  },
};

const run = (status, postEvaluation) => ({
  id: 'run-a',
  status,
  sourceBeforeScore: 61,
  acceptedChangeIds: ['change-a', 'change-b'],
  plan,
  result: plan,
  postEvaluation,
});

const postEvaluation = {
  version: 'guidance_optimization_post_v1',
  overallBandBefore: 'needs_attention',
  overallBandAfter: 'adequate',
  dimensionStatusChanges: dimensions.map((dimension) => ({
    dimension,
    beforeStatus: 'needs_attention',
    afterStatus: 'adequate',
  })),
  issueSummary: { resolved: 4, remaining: 2 },
  unresolvedFactGapCount: 2,
  acceptedChangeCount: 2,
  blockedChangeCount: 1,
  bankSuggestionCount: 1,
};

test('applied and completed results show centered confirmation without metrics or actions', async () => {
  const {ResumeOptimizationResult,cleanup}=await importResult();
  try { for(const status of ['applied','completed']) for(const policyVersion of ['json_structure_v1','json_structure_v3']) {
    const html=renderToStaticMarkup(React.createElement(ResumeOptimizationResult,{
      run:{...run(status,status==='completed'?postEvaluation:null),policyVersion},busy:false,error:null,onRetry:()=>{throw Error('unexpected retry')},onRevert:()=>{throw Error('unexpected revert')}
    }));
    assert.match(html,/内容已更新！/);
    assert.match(html,/text-center/);
    assert.match(html,/justify-center/);
    assert.doesNotMatch(html,/<button|已接受修改|已解决问题|事实缺口|安全阻断|经历库机会|审核|VERIFIED RESULT/);
  }}finally{cleanup();}
});

test('unapplied and reverted states do not claim content was updated', async () => {
  const {ResumeOptimizationResult,cleanup}=await importResult();
  try{for(const status of ['failed','reverted']){
    const html=renderToStaticMarkup(React.createElement(ResumeOptimizationResult,{run:run(status,null),busy:false,error:'应用失败',onRetry:()=>{},onRevert:()=>{}}));
    assert.doesNotMatch(html,/内容已更新！/);
    assert.match(html,status==='reverted'?/已撤销本次优化/:/应用失败/);
  }}finally{cleanup();}
});

test('status comparison uses audited bands without numeric quality fields', () => {
  const score = read('views/ResumeEditor/components/ResumeOptimization/ResumeOptimizationScoreDelta.tsx');
  assert.match(score, /emerald/);
  assert.match(score, /slate/);
  assert.match(score, /amber/);
  assert.match(score, /overallBandBefore|overallBandAfter|dimensionStatusChanges/);
  assert.doesNotMatch(score, /\bbeforeScore\b|\bafterScore\b|\bscoreDelta\b|expectedScoreGain|predicted/i);
});

test('workspace confirms accepted count, disables zero apply, and wires result actions', () => {
  const workspace = read('views/ResumeEditor/components/ResumeOptimization/ResumeOptimizationWorkspace.tsx');
  assert.match(workspace, /将把 \{acceptedChangeIds\.length\} 项修改应用到当前简历。不会改动总经历库，也不会更换已选内容。/);
  assert.match(workspace, /disabled=\{acceptedChangeIds\.length === 0/);
  assert.match(workspace, /applyAcceptedChanges/);
  assert.match(workspace, /ResumeOptimizationResult/);
  assert.match(workspace, /busy=\{uiState === 'applying' \|\| uiState === 'rescoring' \|\| uiState === 'stale'\}/);
  assert.match(workspace, /retryRescore/);
  assert.match(workspace, /revertRun/);
});


test('revert uses an in-page modal and sidebar focus cannot scroll the clipped outer shell', () => {
  const result = read('views/ResumeEditor/components/ResumeOptimization/ResumeOptimizationResult.tsx');
  const dialog = read('views/ResumeEditor/components/ResumeOptimization/ResumeOptimizationRevertButton.tsx');
  const editor = read('views/ResumeEditor/index.tsx');
  assert.doesNotMatch(result + dialog, /window.confirm/);
  assert.match(dialog, /<dialog[\s\S]*aria-labelledby=\{titleId\} aria-describedby=\{descriptionId\}/);
  assert.match(dialog, /showModal\(\)/);
  assert.match(dialog, /取消/);
  assert.match(dialog, /确认撤销/);
  assert.match(dialog, /autoFocus/);
  assert.match(dialog, /onKeyDown=\{event => event.stopPropagation\(\)\}/);
  assert.match(editor, /relative h-full min-h-0 w-full overflow-clip bg-white/);
  assert.match(editor, /focusTarget\?\.focus\(\{ preventScroll: true \}\)/);
});
