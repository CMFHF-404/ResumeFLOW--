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

test('completed result renders only audited guidance status changes and compact metrics', async () => {
  const { ResumeOptimizationResult, cleanup } = await importResult();
  try {
    const html = renderToStaticMarkup(React.createElement(ResumeOptimizationResult, {
      run: run('completed', postEvaluation),
      busy: false,
      error: null,
      onRetry: () => undefined,
      onRevert: () => undefined,
    }));

    for (const copy of [
      '优化前状态', '有明显改进空间', '优化后状态', '基本到位',
      '已接受修改', '2', '安全阻断', '1', '事实缺口', '经历库机会',
      ...dimensions,
    ]) assert.match(html, new RegExp(copy));
    assert.match(html, /撤销本次应用/);
    assert.doesNotMatch(html, /重试复评|总分|分数差|预测分|expectedScoreGain|expected_score_gain|61|76|\+15/);
  } finally {
    cleanup();
  }
});

test('applied result exposes retry without inventing a final score', async () => {
  const { ResumeOptimizationResult, cleanup } = await importResult();
  try {
    const html = renderToStaticMarkup(React.createElement(ResumeOptimizationResult, {
      run: run('applied', null),
      busy: false,
      error: '模型暂不可用',
      onRetry: () => undefined,
      onRevert: () => undefined,
    }));

    assert.match(html, /内容已应用，审核尚未完成/);
    assert.match(html, /重试审核/);
    assert.match(html, /撤销本次应用/);
    assert.match(html, /后续手工编辑/);
    assert.doesNotMatch(html, /优化后总分|评分|预测分|expectedScoreGain|expected_score_gain/);
  } finally {
    cleanup();
  }
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
