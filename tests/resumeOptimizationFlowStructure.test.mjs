import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const importFlow = async () => {
  const result = await build({
    entryPoints: ['views/ResumeEditor/hooks/useResumeOptimizationFlow.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    plugins: [{
      name: 'resume-optimization-flow-stubs',
      setup(buildContext) {
        buildContext.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'stub' }));
        buildContext.onLoad({ filter: /^react$/, namespace: 'stub' }, () => ({
          loader: 'js',
          contents: `
            export const useCallback = (value) => value;
            export const useEffect = () => undefined;
            export const useLayoutEffect = () => undefined;
            export const useMemo = (factory) => factory();
            export const useRef = (current) => ({ current });
            export const useState = (initial) => [initial, () => undefined];
          `,
        }));
        buildContext.onResolve({ filter: /useAuthOwnerOperationGuard$/ }, () => ({
          path: 'owner-guard',
          namespace: 'stub',
        }));
        buildContext.onLoad({ filter: /^owner-guard$/, namespace: 'stub' }, () => ({
          loader: 'js',
          contents: 'export const useAuthOwnerOperationGuard = () => ({});',
        }));
        buildContext.onResolve({ filter: /resumeOptimizationService$/ }, () => ({
          path: 'optimization-service',
          namespace: 'stub',
        }));
        buildContext.onLoad({ filter: /^optimization-service$/, namespace: 'stub' }, () => ({
          loader: 'js',
          contents: `
            export const createResumeOptimizationIdempotencyKey = () => 'key';
            export const isResumeOptimizationServiceError = () => false;
            export const resumeOptimizationService = {};
          `,
        }));
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}#${Math.random()}`);
};

const change = (changeId, safetyStatus, defaultSelected) => ({
  changeId,
  safetyStatus,
  defaultSelected,
});

test('pure flow guards map terminal hydration, allowed selection, and busy gates', async () => {
  const {
    buildResumeOptimizationInitialAcceptedIds,
    resolveResumeOptimizationRunUiState,
    resolveResumeOptimizationStartAvailability,
  } = await importFlow();

  for (const status of ['completed', 'cancelled', 'reverted']) {
    assert.equal(resolveResumeOptimizationRunUiState(status, true), 'closed');
  }
  assert.equal(resolveResumeOptimizationRunUiState('preview_ready', true), 'preview');
  assert.equal(resolveResumeOptimizationRunUiState('completed', false), 'completed');

  const run = {
    acceptedChangeIds: [],
    plan: { changes: [] },
    result: {
      changes: [
        change('allowed-default', 'allowed', true),
        change('allowed-off', 'allowed', false),
        change('blocked-default', 'blocked', true),
      ],
    },
  };
  assert.deepEqual(buildResumeOptimizationInitialAcceptedIds(run), ['allowed-default']);
  run.acceptedChangeIds = ['allowed-off', 'blocked-default'];
  assert.deepEqual(buildResumeOptimizationInitialAcceptedIds(run), ['allowed-off']);

  const ready = {
    enabled: true,
    authUserKey: 'owner-a',
    resumeId: 'resume-a',
    sourceResumeUpdatedAt: 'v1',
    evaluationSignature: 'S1',
    persistedEvaluationSignature: 'S1',
    evaluation: { overallScore: 60 },
    isEvaluationOutdated: false,
    hasResumeVersionConflict: false,
    isEvaluationRunning: false,
    isPolishing: false,
    isAutoAssembling: false,
    isFlowBusy: false,
  };
  assert.deepEqual(resolveResumeOptimizationStartAvailability(ready), {
    canStart: true,
    disabledReason: null,
  });
  assert.equal(resolveResumeOptimizationStartAvailability({ ...ready, enabled: false }).canStart, false);
  assert.equal(resolveResumeOptimizationStartAvailability({
    ...ready,
    persistedEvaluationSignature: 'S0',
  }).canStart, false);
  assert.equal(resolveResumeOptimizationStartAvailability({
    ...ready,
    isEvaluationOutdated: true,
  }).canStart, false);
  assert.equal(resolveResumeOptimizationStartAvailability({ ...ready, isPolishing: true }).canStart, false);
  assert.equal(resolveResumeOptimizationStartAvailability({ ...ready, hasResumeVersionConflict: true }).canStart, false);
});

test('hook owns cross-render guards, hydration, complete action API, and safe close semantics', () => {
  const hook = read('views/ResumeEditor/hooks/useResumeOptimizationFlow.ts');

  assert.match(hook, /useAuthOwnerOperationGuard\(authUserKey\)/);
  assert.match(hook, /useRef<AbortController \| null>\(null\)/);
  assert.match(hook, /generationRef = useRef\(0\)/);
  assert.match(hook, /activeRunIdRef = useRef<string \| null>\(null\)/);
  assert.match(hook, /resumeOptimizationService\.getLatest\(/);
  assert.match(hook, /enabled[\s\S]*getLatest/);
  assert.match(hook, /TERMINAL_RESUME_OPTIMIZATION_STATUSES/);
  assert.match(hook, /\[authUserKey, resumeId, evaluationSignature, canonicalSourceResumeUpdatedAt/);
  const hydrationBlock = hook.slice(
    hook.indexOf('useEffect(() => {', hook.indexOf('const beginHandledOperation')),
    hook.indexOf('const isFlowBusy'),
  );
  assert.match(hydrationBlock, /controllerRef\.current === controller/);
  assert.match(hydrationBlock, /controllerRef\.current = null/);
  const beginBlock = hook.slice(hook.indexOf('const beginOperation'), hook.indexOf('const assertCurrent'));
  assert.match(beginBlock, /catch/);
  assert.match(beginBlock, /controllerRef\.current = null/);

  for (const field of [
    'uiState', 'run', 'progressText', 'error', 'answerDrafts', 'acceptedChangeIds',
    'canStart', 'disabledReason', 'startOptimization', 'setAnswer', 'submitAnswers',
    'toggleChange', 'applyAcceptedChanges', 'retryRescore', 'revertRun', 'cancelRun',
    'closeWorkspace', 'reopenLatestRun',
  ]) {
    assert.match(hook, new RegExp(`\\b${field}\\b`));
  }

  const closeBlock = hook.slice(
    hook.indexOf('const closeWorkspace'),
    hook.indexOf('const reopenLatestRun'),
  );
  assert.match(closeBlock, /preview_ready/);
  assert.match(closeBlock, /confirmCancelActiveRun/);
  assert.match(closeBlock, /cancelRun/);
  assert.ok(closeBlock.indexOf('preview_ready') < closeBlock.indexOf('cancelRun'));
});

test('enabled gates hydration and every public action without conditional hook calls', () => {
  const hook = read('views/ResumeEditor/hooks/useResumeOptimizationFlow.ts');
  assert.match(hook, /latestToastRef = useRef\(toast\)/);
  for (const [action, next] of [
    ['setAnswer', 'submitAnswers'],
    ['submitAnswers', 'toggleChange'],
    ['toggleChange', 'runPostApplyEvaluation'],
    ['applyAcceptedChanges', 'retryRescore'],
    ['retryRescore', 'revertRun'],
    ['revertRun', 'cancelRun'],
    ['cancelRun', 'closeWorkspace'],
    ['reopenLatestRun', 'return {'],
  ]) {
    const block = hook.slice(hook.indexOf(`const ${action}`), hook.indexOf(`const ${next}`));
    assert.match(block, /!enabled/);
  }
  assert.doesNotMatch(hook, /if \([^)]*enabled[^)]*\)\s*\{?\s*useResumeOptimizationFlow/);
});

test('apply and retry chain uses self-owned committed tokens and never replays apply', () => {
  const hook = read('views/ResumeEditor/hooks/useResumeOptimizationFlow.ts');
  const startBlock = hook.slice(
    hook.indexOf('const startOptimization'),
    hook.indexOf('const setAnswer'),
  );
  const applyBlock = hook.slice(
    hook.indexOf('const applyAcceptedChanges'),
    hook.indexOf('const retryRescore'),
  );
  const rescoreBlock = hook.slice(
    hook.indexOf('const runPostApplyEvaluation'),
    hook.indexOf('const applyAcceptedChanges'),
  );

  assert.ok(startBlock.indexOf('flushResumeConfig') < startBlock.indexOf('resumeOptimizationService.start'));
  assert.ok(startBlock.indexOf('flushResumeConfig') < startBlock.indexOf('assertCurrent'));
  assert.ok(startBlock.indexOf('assertCurrent') < startBlock.indexOf('resumeOptimizationService.start'));
  assert.match(applyBlock, /expectedResumeUpdatedAt: currentRun\.sourceResumeUpdatedAt/);
  assert.doesNotMatch(applyBlock, /flushResumeConfig/);
  assert.ok(applyBlock.indexOf('resumeOptimizationService.apply') < applyBlock.indexOf('reloadResumeContext'));
  assert.match(applyBlock, /markSelfOwnedResumeTimestamp/);
  assert.match(applyBlock, /waitForCommittedSource/);
  assert.match(rescoreBlock, /latestGenerateEvaluationRef\.current\(\)/);
  assert.match(rescoreBlock, /waitForPersistedEvaluation/);
  const reportFlushIndex = rescoreBlock.indexOf('latestFlushResumeConfigRef.current');
  const preFinalizeGuardIndex = rescoreBlock.indexOf('assertCurrent', reportFlushIndex);
  assert.ok(rescoreBlock.indexOf('waitForPersistedEvaluation') < reportFlushIndex);
  assert.ok(reportFlushIndex < preFinalizeGuardIndex);
  assert.ok(preFinalizeGuardIndex < rescoreBlock.indexOf('resumeOptimizationService.finalize'));
  assert.doesNotMatch(rescoreBlock, /resumeOptimizationService\.apply/);
  assert.match(hook, /resume_optimization_context_stale|resume_optimization_content_conflict/);
});

test('ResumeEditor wires the flow without adding Task15 UI or flags', () => {
  const editor = read('views/ResumeEditor/index.tsx');

  assert.match(editor, /useResumeOptimizationFlow/);
  assert.match(editor, /enabled: true/);
  assert.match(editor, /resumeId/);
  assert.match(editor, /sourceResumeUpdatedAt: resumeDetail\?\.resume\.updated_at/);
  assert.match(editor, /evaluationSignature/);
  assert.match(editor, /evaluation: analysisResult\?\.resumeEvaluation \?\? null/);
  assert.match(editor, /persistedEvaluationSignature: persistedJDAnalysisSnapshot\?\.evaluationSignature \?\? null/);
  assert.match(editor, /isEvaluationOutdated/);
  assert.match(editor, /reloadResumeContext/);
  assert.match(editor, /generateEvaluation/);
  assert.match(editor, /flushResumeConfig/);
  assert.match(editor, /isAutoAssembling/);
  assert.doesNotMatch(editor, /VITE_ENABLE_RESUME_OPTIMIZATION/);
});

test('stale actions and delayed cancel or revert commits fail closed across resume switches', async () => {
  const { isResumeOptimizationRunContextCurrent } = await importFlow();
  const sourceRun = {
    sourceResumeUpdatedAt: '2026-09-01T01:00:00.000Z',
    sourceEvaluationSignature: 'signature-a',
  };
  assert.equal(isResumeOptimizationRunContextCurrent(
    sourceRun,
    '2026-09-01T01:00:00.000Z',
    'signature-a',
  ), true);
  assert.equal(isResumeOptimizationRunContextCurrent(
    sourceRun,
    '2026-09-01T01:00:01.000Z',
    'signature-a',
  ), false);
  assert.equal(isResumeOptimizationRunContextCurrent(
    sourceRun,
    '2026-09-01T01:00:00.000Z',
    'signature-b',
  ), false);

  const hook = read('views/ResumeEditor/hooks/useResumeOptimizationFlow.ts');
  for (const [action, next] of [
    ['submitAnswers', 'toggleChange'],
    ['toggleChange', 'runPostApplyEvaluation'],
    ['applyAcceptedChanges', 'retryRescore'],
  ]) {
    const block = hook.slice(hook.indexOf(`const ${action}`), hook.indexOf(`const ${next}`));
    assert.match(block, /isResumeOptimizationRunContextCurrent/);
  }

  const cancelBlock = hook.slice(hook.indexOf('const cancelRun'), hook.indexOf('const closeWorkspace'));
  assert.match(cancelBlock, /beginHandledOperation/);
  assert.match(cancelBlock, /signal: controller\.signal/);
  assert.ok(cancelBlock.indexOf('assertCurrent') < cancelBlock.indexOf('applyRunToState'));

  const revertBlock = hook.slice(hook.indexOf('const revertRun'), hook.indexOf('const cancelRun'));
  const reloadIndex = revertBlock.indexOf('reloadResumeContext');
  assert.ok(reloadIndex >= 0);
  assert.match(revertBlock, /markSelfOwnedResumeAndEvaluationTimestamp\(reverted\.resumeUpdatedAt\)/);
  assert.ok(reloadIndex < revertBlock.indexOf('assertCurrent', reloadIndex));
  assert.ok(revertBlock.indexOf('assertCurrent', reloadIndex) < revertBlock.indexOf('applyRunToState'));
});

test('post-score barrier observes the exact config snapshot consumed by the save flusher', () => {
  const editor = read('views/ResumeEditor/index.tsx');
  const flowCall = editor.slice(
    editor.indexOf('const resumeOptimizationFlow = useResumeOptimizationFlow'),
    editor.indexOf('void resumeOptimizationFlow'),
  );
  assert.match(
    flowCall,
    /persistedEvaluationSignature: persistedJDAnalysisSnapshot\?\.evaluationSignature \?\? null/,
  );
  assert.match(
    flowCall,
    /persistedEvaluation: persistedJDAnalysisSnapshot\?\.result\.resumeEvaluation \?\? null/,
  );
  assert.doesNotMatch(flowCall, /persistedEvaluationSignature: persistedJDAnalysis\?/);
});

test('flow timestamp canonicalization preserves microseconds and compares equivalent wire forms', async () => {
  const {
    canonicalizeResumeOptimizationFlowTimestamp,
    resumeOptimizationFlowTimestampsEqual,
  } = await importFlow();

  assert.equal(
    canonicalizeResumeOptimizationFlowTimestamp('2026-09-01T01:02:03.123456+00:00'),
    '2026-09-01T01:02:03.123456Z',
  );
  assert.equal(
    canonicalizeResumeOptimizationFlowTimestamp('2026-09-01T09:02:03.123456+08:00'),
    '2026-09-01T01:02:03.123456Z',
  );
  assert.equal(
    resumeOptimizationFlowTimestampsEqual(
      '2026-09-01T01:02:03',
      '2026-09-01T01:02:03.000Z',
    ),
    true,
  );
  assert.equal(
    resumeOptimizationFlowTimestampsEqual(
      '2026-09-01T01:02:03+00:00',
      '2026-09-01T01:02:03.000Z',
    ),
    true,
  );
  assert.equal(
    resumeOptimizationFlowTimestampsEqual(
      '2026-09-01T01:02:03.000001Z',
      '2026-09-01T01:02:03.000002Z',
    ),
    false,
  );
});

test('flush ownership is asserted before self-owned tokens or attempts are published', () => {
  const hook = read('views/ResumeEditor/hooks/useResumeOptimizationFlow.ts');
  const startBlock = hook.slice(
    hook.indexOf('const startOptimization'),
    hook.indexOf('const setAnswer'),
  );
  const startFlush = startBlock.indexOf('latestFlushResumeConfigRef.current');
  const startAssert = startBlock.indexOf('assertCurrent', startFlush);
  const startMark = startBlock.indexOf('markSelfOwnedResumeTimestamp', startFlush);
  const startAttemptWrite = startBlock.indexOf('startAttemptRef.current = attempt', startFlush);
  assert.ok(startFlush < startAssert && startAssert < startMark && startMark < startAttemptWrite);

  const rescoreBlock = hook.slice(
    hook.indexOf('const runPostApplyEvaluation'),
    hook.indexOf('const applyAcceptedChanges'),
  );
  const rescoreFlush = rescoreBlock.indexOf('latestFlushResumeConfigRef.current');
  const rescoreAssert = rescoreBlock.indexOf('assertCurrent', rescoreFlush);
  const rescoreMark = rescoreBlock.indexOf('markSelfOwnedResumeTimestamp', rescoreFlush);
  assert.ok(rescoreFlush < rescoreAssert && rescoreAssert < rescoreMark);
});

test('every async operation catch drops late non-abort errors before state or toast handling', () => {
  const hook = read('views/ResumeEditor/hooks/useResumeOptimizationFlow.ts');
  const blocks = [
    hook.slice(
      hook.indexOf('useEffect(() => {', hook.indexOf('const beginHandledOperation')),
      hook.indexOf('const isFlowBusy'),
    ),
    hook.slice(hook.indexOf('const startOptimization'), hook.indexOf('const setAnswer')),
    hook.slice(hook.indexOf('const submitAnswers'), hook.indexOf('const toggleChange')),
    hook.slice(hook.indexOf('const applyAcceptedChanges'), hook.indexOf('const retryRescore')),
    hook.slice(hook.indexOf('const retryRescore'), hook.indexOf('const revertRun')),
    hook.slice(hook.indexOf('const revertRun'), hook.indexOf('const cancelRun')),
    hook.slice(hook.indexOf('const cancelRun'), hook.indexOf('const closeWorkspace')),
    hook.slice(hook.indexOf('const reopenLatestRun'), hook.indexOf('return {', hook.indexOf('const reopenLatestRun'))),
  ];
  assert.equal(blocks.length, 8);
  for (const block of blocks) {
    const catchIndex = block.indexOf('catch (cause)');
    const currentGuardIndex = block.indexOf('shouldHandleOperationError', catchIndex);
    const handlerIndex = block.indexOf('handleOperationError', catchIndex);
    assert.ok(catchIndex >= 0, 'operation must expose its catch');
    assert.ok(
      currentGuardIndex > catchIndex && currentGuardIndex < handlerIndex,
      'late error guard must precede state/toast handling',
    );
  }
  for (const action of ['submitAnswers', 'applyAcceptedChanges', 'retryRescore', 'revertRun', 'cancelRun']) {
    const start = hook.indexOf(`const ${action}`);
    const next = hook.indexOf('\n  const ', start + 8);
    const block = hook.slice(start, next < 0 ? undefined : next);
    assert.match(block, /shouldHandleOperationError\(cause, generation, operation, currentRun\.id\)/);
  }
});
