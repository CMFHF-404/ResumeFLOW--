import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import test from 'node:test';
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
        buildContext.onResolve({ filter: /useAuthOwnerOperationGuard$/ }, () => ({ path: 'owner', namespace: 'stub' }));
        buildContext.onLoad({ filter: /^owner$/, namespace: 'stub' }, () => ({
          loader: 'js',
          contents: 'export const useAuthOwnerOperationGuard = () => ({});',
        }));
        buildContext.onResolve({ filter: /resumeOptimizationService$/ }, () => ({ path: 'service', namespace: 'stub' }));
        buildContext.onLoad({ filter: /^service$/, namespace: 'stub' }, () => ({
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

const changes = [
  { changeId: 'allowed-a', safetyStatus: 'allowed', actionKind: 'rewrite_now', targetedValue: 'A' },
  { changeId: 'allowed-b', safetyStatus: 'allowed', actionKind: 'ask_user', targetedValue: 'B' },
  { changeId: 'blocked', safetyStatus: 'blocked', actionKind: 'rewrite_now', targetedValue: 'X' },
  { changeId: 'null-target', safetyStatus: 'allowed', actionKind: 'rewrite_now', targetedValue: null },
];

test('apply attempt synchronously freezes only selectable IDs', async () => {
  const { freezeResumeOptimizationApplyAttempt } = await importFlow();
  const attempt = freezeResumeOptimizationApplyAttempt({
    id: 'run-a',
    sourceResumeUpdatedAt: '2026-09-01T00:00:00Z',
    plan: { changes },
    result: null,
  }, ['allowed-b', 'blocked', 'allowed-a', 'allowed-b', 'null-target']);
  assert.deepEqual(attempt, {
    runId: 'run-a',
    acceptedChangeIds: ['allowed-b', 'allowed-a'],
    sourceResumeUpdatedAt: '2026-09-01T00:00:00Z',
    previewReadyConfirmations: 0,
  });
  assert.equal(freezeResumeOptimizationApplyAttempt({
    id: 'run-a',
    sourceResumeUpdatedAt: '2026-09-01T00:00:00Z',
    plan: { changes },
    result: null,
  }, ['blocked']), null);
});

test('source orders one apply, reload, one evaluation receipt, v3 commit, then finalize', () => {
  const hook = read('views/ResumeEditor/hooks/useResumeOptimizationFlow.ts');
  const applyBlock = hook.slice(hook.indexOf('const applyAcceptedChanges'), hook.indexOf('const retryRescore'));
  const postScoreBlock = hook.slice(hook.indexOf('const runPostApplyEvaluation'), hook.indexOf('const applyAcceptedChanges'));

  const publishAttempt = applyBlock.indexOf('applyAttemptRef.current =');
  const beginOperation = applyBlock.indexOf('await beginHandledOperation');
  const saveBarrier = applyBlock.indexOf('commitLatestResumeConfigIfNeeded');
  const apply = applyBlock.indexOf('resumeOptimizationService.apply');
  const reload = applyBlock.indexOf('reloadResumeContext');
  assert.ok(publishAttempt >= 0 && publishAttempt < beginOperation);
  assert.ok(beginOperation < saveBarrier && saveBarrier < apply && apply < reload);
  assert.match(applyBlock, /acceptedChangeIds: attempt\.acceptedChangeIds/);
  assert.match(applyBlock, /expectedResumeUpdatedAt: committedSourceUpdatedAt/);

  const generate = postScoreBlock.indexOf('latestGenerateEvaluationRef.current');
  const checkpointEvaluation = postScoreBlock.indexOf("phase: 'evaluation_ready'", generate);
  const receipt = postScoreBlock.indexOf('waitForPersistedEvaluationReceipt', checkpointEvaluation);
  const flush = postScoreBlock.indexOf('latestFlushResumeConfigRef.current', receipt);
  const selfOwnedV3 = postScoreBlock.indexOf('markSelfOwnedResumeTimestamp', flush);
  const checkpointReport = postScoreBlock.indexOf("phase: 'report_committed'", selfOwnedV3);
  const finalize = postScoreBlock.indexOf('resumeOptimizationService.finalize', checkpointReport);
  assert.ok(generate >= 0 && generate < checkpointEvaluation);
  assert.ok(checkpointEvaluation < receipt && receipt < flush && flush < selfOwnedV3);
  assert.ok(selfOwnedV3 < checkpointReport && checkpointReport < finalize);
  assert.doesNotMatch(postScoreBlock, /resumeOptimizationService\.revert/);
});

test('checkpoint retries skip completed phases, GET before uncertain finalize, and never replay apply', () => {
  const hook = read('views/ResumeEditor/hooks/useResumeOptimizationFlow.ts');
  const postScoreBlock = hook.slice(hook.indexOf('const runPostApplyEvaluation'), hook.indexOf('const applyAcceptedChanges'));
  const retryBlock = hook.slice(hook.indexOf('const retryRescore'), hook.indexOf('const revertRun'));

  assert.match(hook, /postApplyCheckpointRef = useRef/);
  assert.match(postScoreBlock, /checkpoint\.phase === 'needs_evaluation'/);
  assert.match(postScoreBlock, /checkpoint\.phase === 'evaluation_ready'/);
  assert.match(postScoreBlock, /checkpoint\.phase === 'report_committed'/);
  assert.ok(retryBlock.indexOf('resumeOptimizationService.get') < retryBlock.indexOf('runPostApplyEvaluation'));
  assert.match(retryBlock, /authoritativeRun\.status === 'completed'/);
  assert.doesNotMatch(retryBlock, /resumeOptimizationService\.apply/);
  assert.doesNotMatch(postScoreBlock, /resumeOptimizationService\.apply/);
  const pendingReset = postScoreBlock.indexOf('EVALUATION_PENDING_ERROR_CODE');
  const pendingCheckpoint = postScoreBlock.indexOf("phase: 'needs_evaluation'", pendingReset);
  const authoritativeGet = postScoreBlock.indexOf('resumeOptimizationService.get', pendingReset);
  assert.ok(pendingReset >= 0 && pendingReset < pendingCheckpoint && pendingCheckpoint < authoritativeGet);
});

test('save conflicts fail closed and revert uses the latest-snapshot barrier before mutation', () => {
  const hook = read('views/ResumeEditor/hooks/useResumeOptimizationFlow.ts');
  const revertBlock = hook.slice(hook.indexOf('const revertRun'), hook.indexOf('const cancelRun'));
  const errorHandler = hook.slice(hook.indexOf('const handleOperationError'), hook.indexOf('const beginHandledOperation'));
  const source = read('hooks/useResumeData.ts');

  assert.match(hook, /isResumeVersionConflictLike/);
  assert.match(hook, /resume_optimization_evaluation_pending/);
  assert.match(hook, /hasResumeVersionConflict[\s\S]*invalidateGeneration\(false, true\)/);
  assert.match(errorHandler, /applyAttemptRef\.current = null/);
  assert.match(errorHandler, /clearPostApplyCheckpoint\(\)/);
  assert.ok(revertBlock.indexOf('commitLatestResumeConfigIfNeeded') < revertBlock.indexOf('resumeOptimizationService.revert'));
  assert.ok(revertBlock.indexOf('resumeOptimizationService.revert') < revertBlock.indexOf('reloadResumeContext'));
  assert.match(revertBlock, /setUiState\('closed'\)/);
  assert.match(source, /commitLatestResumeConfigIfNeeded/);
  assert.match(source, /latestEffectiveConfigSnapshotRef\.current/);
  assert.match(source, /pendingResumeSaveDrainRef\.current\(\)/);
});

test('uncertain apply retries only the authoritative GET and never blindly replays apply', () => {
  const hook = read('views/ResumeEditor/hooks/useResumeOptimizationFlow.ts');
  const recoverStart = hook.indexOf('const recoverUncertainApplyAttempt');
  const applyStart = hook.indexOf('const applyAcceptedChanges');
  const retryStart = hook.indexOf('const retryRescore');

  assert.ok(recoverStart >= 0 && recoverStart < applyStart);
  const recoverBlock = hook.slice(recoverStart, applyStart);
  const applyBlock = hook.slice(applyStart, retryStart);
  const backoff = recoverBlock.indexOf('await waitForResumeOptimizationApplyConfirmationBackoff');
  const authoritativeRead = recoverBlock.indexOf('resumeOptimizationService.get(attempt.runId');
  assert.ok(backoff >= 0 && backoff < authoritativeRead);
  const backoffHelper = hook.slice(
    hook.indexOf('const waitForResumeOptimizationApplyConfirmationBackoff'),
    hook.indexOf('const rawHttpStatus'),
  );
  assert.match(backoffHelper, /\}, 500\);/);
  assert.match(backoffHelper, /signal\.addEventListener\('abort'/);
  assert.match(recoverBlock, /resumeOptimizationService\.get\(attempt\.runId/);
  assert.doesNotMatch(recoverBlock, /resumeOptimizationService\.apply/);
  assert.match(recoverBlock, /authoritativeRun\.status === 'preview_ready'[\s\S]*applyAttemptRef\.current = null/);
  assert.match(recoverBlock, /previewReadyConfirmations[\s\S]*< 2/);
  const previewBranch = recoverBlock.slice(
    recoverBlock.indexOf("authoritativeRun.status === 'preview_ready'"),
    recoverBlock.indexOf("authoritativeRun.status === 'completed'"),
  );
  assert.ok(
    previewBranch.indexOf('previewReadyConfirmations < 2')
      < previewBranch.indexOf('applyAttemptRef.current = null'),
  );
  assert.match(
    recoverBlock,
    /authoritativeRun\.status === 'preview_ready'[\s\S]*setUiState\('preview'\)[\s\S]*if \(originalCause !== undefined\)/,
  );
  assert.match(recoverBlock, /authoritativeRun\.status === 'applied'/);
  assert.match(recoverBlock, /authoritativeRun\.appliedResumeUpdatedAt/);
  assert.doesNotMatch(recoverBlock, /canonicalizeResumeOptimizationFlowTimestamp\(\s*authoritativeRun\.appliedAt/);
  assert.match(recoverBlock, /authoritativeRun\.status === 'completed'/);
  assert.match(recoverBlock, /catch \(cause\)[\s\S]*applyAttemptRef\.current === attempt/);

  const recoverPending = applyBlock.indexOf('const pendingAttempt = applyAttemptRef.current');
  const recover = applyBlock.indexOf('recoverUncertainApplyAttempt', recoverPending);
  const freeze = applyBlock.indexOf('freezeResumeOptimizationApplyAttempt');
  assert.ok(recoverPending >= 0 && recoverPending < recover && recover < freeze);
});

test('applied reload cannot resolve the source waiter from the pre-reload evaluation signature', () => {
  const hook = read('views/ResumeEditor/hooks/useResumeOptimizationFlow.ts');
  const waiterBlock = hook.slice(
    hook.indexOf('const waitForCommittedSource'),
    hook.indexOf('const waitForPersistedEvaluationReceipt'),
  );
  const layoutBlock = hook.slice(
    hook.indexOf('useLayoutEffect(() => {'),
    hook.indexOf('useLayoutEffect(() => {', hook.indexOf('useLayoutEffect(() => {') + 1),
  );
  assert.match(waiterBlock, /latest\.evaluationSignature !== previousEvaluationSignature/);
  assert.match(layoutBlock, /evaluationSignature !== waiter\.previousEvaluationSignature/);
  const settleBlock = hook.slice(
    hook.indexOf('const settleCommittedSourceAfterReload'),
    hook.indexOf('const waitForPersistedEvaluationReceipt'),
  );
  assert.match(waiterBlock, /minimumInputRevision/);
  assert.match(settleBlock, /latestInputsRevisionRef\.current >= waiter\.minimumInputRevision/);

  for (const [start, end] of [
    ['const applyAcceptedChanges', 'const retryRescore'],
    ['const retryRescore', 'const revertRun'],
  ]) {
    const block = hook.slice(hook.indexOf(start), hook.indexOf(end));
    const reload = block.indexOf('reloadResumeContext');
    const settle = block.indexOf('settleCommittedSourceAfterReload', reload);
    const awaitCommit = block.indexOf('await sourceCommitPromise', settle);
    assert.ok(reload >= 0 && reload < settle && settle < awaitCommit, `${start} must settle S2 after reload`);
  }
});

test('post-apply checkpoint survives a hook remount and restores the exact evaluation receipt', async () => {
  const {
    clearResumeOptimizationPostApplyCheckpoint,
    doesResumeOptimizationEvaluationReceiptMatch,
    readResumeOptimizationPostApplyCheckpoint,
    saveResumeOptimizationPostApplyCheckpoint,
  } = await importFlow();
  const evaluationReceipt = { overallScore: 88, dimensions: [] };
  const checkpoint = {
    runId: 'run-a',
    phase: 'evaluation_ready',
    sourceEvaluationSignature: 'S2',
    evaluationReceipt,
  };

  saveResumeOptimizationPostApplyCheckpoint('owner-a', 'resume-a', checkpoint);
  assert.deepEqual(
    readResumeOptimizationPostApplyCheckpoint('owner-a', 'resume-a', 'run-a'),
    checkpoint,
  );
  assert.equal(
    readResumeOptimizationPostApplyCheckpoint('owner-a', 'resume-b', 'run-a'),
    null,
  );
  const deserializedReceipt = JSON.parse(JSON.stringify(evaluationReceipt));
  assert.notEqual(deserializedReceipt, evaluationReceipt);
  assert.equal(
    doesResumeOptimizationEvaluationReceiptMatch('S2', deserializedReceipt, 'S2', evaluationReceipt),
    true,
  );
  assert.equal(
    doesResumeOptimizationEvaluationReceiptMatch(
      'S2',
      { ...deserializedReceipt, overallScore: 89 },
      'S2',
      evaluationReceipt,
    ),
    false,
  );
  clearResumeOptimizationPostApplyCheckpoint('owner-a', 'resume-a');
  assert.equal(
    readResumeOptimizationPostApplyCheckpoint('owner-a', 'resume-a', 'run-a'),
    null,
  );

  const hook = read('views/ResumeEditor/hooks/useResumeOptimizationFlow.ts');
  const applyRunBlock = hook.slice(
    hook.indexOf('const applyRunToState'),
    hook.indexOf('const markSelfOwnedResumeTimestamp'),
  );
  assert.match(applyRunBlock, /readResumeOptimizationPostApplyCheckpoint/);
  assert.match(applyRunBlock, /persistedEvaluationSignature[\s\S]*evaluationSignature/);
  assert.match(
    applyRunBlock,
    /!resumeOptimizationFlowTimestampsEqual\([\s\S]*nextRun\.sourceResumeUpdatedAt[\s\S]*evaluationSignature !== nextRun\.sourceEvaluationSignature/,
  );
  assert.match(applyRunBlock, /phase: 'evaluation_ready'[\s\S]*evaluationReceipt: persistedEvaluation/);
  assert.match(hook, /saveResumeOptimizationPostApplyCheckpoint/);
  assert.match(hook, /clearResumeOptimizationPostApplyCheckpoint/);
  assert.match(hook, /canonicalStringify/);
  assert.doesNotMatch(hook, /persistedEvaluation === evaluationWaiter\.evaluationReceipt/);
});

test('an applied run without a checkpoint reloads the explicit applied version before evaluation', () => {
  const hook = read('views/ResumeEditor/hooks/useResumeOptimizationFlow.ts');
  const retryBlock = hook.slice(hook.indexOf('const retryRescore'), hook.indexOf('const revertRun'));
  const missingCheckpoint = retryBlock.indexOf('!checkpoint || checkpoint.runId !== authoritativeRun.id');
  const explicitToken = retryBlock.indexOf('authoritativeRun.appliedResumeUpdatedAt', missingCheckpoint);
  const needsReload = retryBlock.indexOf("phase: 'needs_reload'", explicitToken);
  const reload = retryBlock.indexOf('reloadResumeContext', needsReload);
  const needsEvaluation = retryBlock.indexOf("phase: 'needs_evaluation'", reload);

  assert.ok(missingCheckpoint >= 0 && missingCheckpoint < explicitToken);
  assert.ok(explicitToken < needsReload && needsReload < reload && reload < needsEvaluation);
});
