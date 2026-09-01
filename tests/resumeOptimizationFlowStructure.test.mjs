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

const change = (
  changeId,
  safetyStatus,
  defaultSelected,
  actionKind = 'rewrite_now',
  targetedValue = '安全目标值',
) => ({
  changeId,
  safetyStatus,
  defaultSelected,
  actionKind,
  targetedValue,
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

test('ResumeEditor wires the flow through the exact Task15 feature flag', () => {
  const editor = read('views/ResumeEditor/index.tsx');

  assert.match(editor, /useResumeOptimizationFlow/);
  assert.match(editor, /enabled: RESUME_OPTIMIZATION_ENABLED/);
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
  assert.match(
    editor,
    /VITE_ENABLE_RESUME_OPTIMIZATION === 'true'/,
  );
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
    editor.indexOf('const isResumeOptimizationBusy ='),
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

test('flow stores safe progress nodes and never trusts server progress titles', async () => {
  const { resolveResumeOptimizationProgressTitle } = await importFlow();
  assert.deepEqual([
    ['freeze_snapshot', '冻结当前简历版本'],
    ['prepare_context', '整理六维问题与经历信息'],
    ['plan_changes', '生成优化方案'],
    ['verify_changes', '检查事实边界'],
    ['persist_run', '保存优化方案'],
    ['rewrite_answers', '根据补充信息更新方案'],
  ].map(([node, expected]) => resolveResumeOptimizationProgressTitle(node) === expected), Array(6).fill(true));

  const hook = read('views/ResumeEditor/hooks/useResumeOptimizationFlow.ts');
  assert.match(hook, /const \[progressNode, setProgressNode\] = useState/);
  assert.match(hook, /setProgressNode\(event\.node\)/);
  assert.match(hook, /resolveResumeOptimizationProgressTitle\(event\.node\)/);
  assert.doesNotMatch(hook, /setProgressText\(event\.title\)/);
  const returned = hook.slice(hook.lastIndexOf('return {'));
  assert.match(returned, /progressNode/);
});

test('answer recovery keeps authoritative persisted answers and freezes ambiguous retries', async () => {
  const {
    buildResumeOptimizationAnswerDrafts,
    buildResumeOptimizationAnswerPayload,
  } = await importFlow();
  const run = {
    id: 'run-a',
    answers: [{ questionId: 'q1', state: 'answered', value: '服务端事实' }],
    plan: { questions: [{ questionId: 'q1' }, { questionId: 'q2' }] },
    result: null,
  };
  const currentDrafts = {
    q1: { state: 'answered', value: '本地旧值' },
    q2: { state: 'answered', value: '本地未提交事实' },
    ghost: { state: 'answered', value: '不再属于当前问题' },
  };

  assert.deepEqual(buildResumeOptimizationAnswerDrafts(run, 'run-a', currentDrafts), {
    q1: { state: 'answered', value: '服务端事实' },
    q2: { state: 'answered', value: '本地未提交事实' },
  });
  assert.deepEqual(buildResumeOptimizationAnswerDrafts(run, 'run-b', currentDrafts), {
    q1: { state: 'answered', value: '服务端事实' },
    q2: { state: 'answered', value: '' },
  });
  assert.deepEqual(buildResumeOptimizationAnswerPayload(run, currentDrafts), [
    { questionId: 'q1', state: 'answered', value: '服务端事实' },
    { questionId: 'q2', state: 'answered', value: '本地未提交事实' },
  ]);
  assert.equal(buildResumeOptimizationAnswerPayload(run, {
    q1: currentDrafts.q1,
    q2: { state: 'answered', value: '   ' },
  }), null);
  assert.equal(buildResumeOptimizationAnswerPayload(run, { q1: currentDrafts.q1 }), null);

  const hook = read('views/ResumeEditor/hooks/useResumeOptimizationFlow.ts');
  assert.match(hook, /frozenAnswerSubmissionRef = useRef/);
  assert.match(hook, /isAnswerSubmissionFrozen/);
  assert.match(hook, /persistedAnswerIds/);
  assert.doesNotMatch(hook, /currentRun\.answers\.length > 0/);
  assert.doesNotMatch(hook, /\?\.state \?\? 'skipped'/);
  assert.doesNotMatch(hook, /error\.code\.startsWith\('resume_optimization_'\)/);
  assert.match(hook, /resume_optimization_context_stale/);
  assert.match(hook, /resume_optimization_content_conflict/);
  const submitBlock = hook.slice(hook.indexOf('const submitAnswers'), hook.indexOf('const toggleChange'));
  assert.match(submitBlock, /frozenAnswerSubmissionRef\.current/);
  const publishAttempt = submitBlock.indexOf('frozenAnswerSubmissionRef.current =');
  const beginOperation = submitBlock.indexOf('await beginHandledOperation');
  const refreshRun = submitBlock.indexOf('resumeOptimizationService.get');
  const answerRun = submitBlock.indexOf('resumeOptimizationService.answer');
  assert.ok(publishAttempt >= 0 && publishAttempt < beginOperation);
  assert.ok(refreshRun > beginOperation && refreshRun < answerRun);
});

test('selectable changes match backend apply rules and same-run reopen preserves local choices', async () => {
  const {
    buildResumeOptimizationInitialAcceptedIds,
    filterResumeOptimizationSelectableChangeIds,
    isResumeOptimizationChangeSelectable,
  } = await importFlow();
  const changes = [
    change('rewrite', 'allowed', true, 'rewrite_now', 'target'),
    change('question', 'allowed', true, 'ask_user', 'target'),
    change('missing-target', 'allowed', true, 'rewrite_now', null),
    change('wrong-action', 'allowed', true, 'leave_unchanged', 'target'),
    change('blocked', 'blocked', true, 'rewrite_now', 'target'),
  ];
  assert.deepEqual(changes.map(isResumeOptimizationChangeSelectable), [true, true, false, false, false]);
  assert.deepEqual(buildResumeOptimizationInitialAcceptedIds({
    acceptedChangeIds: [],
    plan: { changes },
    result: null,
  }), ['rewrite', 'question']);
  assert.deepEqual(filterResumeOptimizationSelectableChangeIds(changes, [
    'question', 'missing-target', 'rewrite', 'question', 'unknown',
  ]), ['question', 'rewrite']);

  const hook = read('views/ResumeEditor/hooks/useResumeOptimizationFlow.ts');
  const toggleBlock = hook.slice(hook.indexOf('const toggleChange'), hook.indexOf('const runPostApplyEvaluation'));
  assert.match(toggleBlock, /isResumeOptimizationChangeSelectable\(change\)/);
  assert.match(hook, /applyRunToState\(latestRunRef\.current, false, true\)/);
  assert.match(hook, /preserveLocalSelections/);
});

test('answer retry survives close and slow auth close cannot continue in background', () => {
  const hook = read('views/ResumeEditor/hooks/useResumeOptimizationFlow.ts');
  const applyBlock = hook.slice(hook.indexOf('const applyRunToState'), hook.indexOf('const waitForSourceSnapshot'));
  assert.match(applyBlock, /hasFrozenAnswerRetry/);
  assert.match(applyBlock, /hasFrozenAnswerRetry[\s\S]*\? 'error'/);

  const submitBlock = hook.slice(hook.indexOf('const submitAnswers'), hook.indexOf('const toggleChange'));
  const publishAnswering = submitBlock.indexOf("setUiState('answering')");
  const beginOperation = submitBlock.indexOf("await beginHandledOperation('提交补充信息失败。')");
  assert.ok(publishAnswering >= 0 && publishAnswering < beginOperation);

  const closeBlock = hook.slice(hook.indexOf('const closeWorkspace'), hook.indexOf('const reopenLatestRun'));
  assert.match(closeBlock, /frozenAnswerSubmissionRef\.current\?\.runId/);
  assert.match(closeBlock, /controllerRef\.current/);
  assert.match(closeBlock, /cancelRun\(\)/);
});

test('reopening an externally stale cached run remains fail closed', () => {
  const hook = read('views/ResumeEditor/hooks/useResumeOptimizationFlow.ts');
  const reopenBlock = hook.slice(hook.indexOf('const reopenLatestRun'), hook.indexOf('return {', hook.indexOf('const reopenLatestRun')));
  const contextCheck = reopenBlock.indexOf('isResumeOptimizationRunContextCurrent');
  const applyCached = reopenBlock.indexOf('applyRunToState(latestRunRef.current');
  assert.ok(contextCheck >= 0 && contextCheck < applyCached);
  assert.match(reopenBlock, /setUiState\('stale'\)/);
  assert.match(reopenBlock, /status === 'awaiting_answers'[\s\S]*status === 'preview_ready'/);
});

test('preview selections survive a same-owner top-level navigation remount', async () => {
  const {
    clearResumeOptimizationSelectionSnapshot,
    readResumeOptimizationSelectionSnapshot,
    saveResumeOptimizationSelectionSnapshot,
  } = await importFlow();

  clearResumeOptimizationSelectionSnapshot('owner-a', 'resume-a');
  saveResumeOptimizationSelectionSnapshot('owner-a', 'resume-a', 'run-a', []);
  assert.deepEqual(
    readResumeOptimizationSelectionSnapshot('owner-a', 'resume-a', 'run-a'),
    [],
  );
  assert.equal(readResumeOptimizationSelectionSnapshot('owner-a', 'resume-a', 'run-b'), null);
  assert.equal(readResumeOptimizationSelectionSnapshot('owner-b', 'resume-a', 'run-a'), null);

  saveResumeOptimizationSelectionSnapshot('owner-a', 'resume-a', 'run-a', ['change-b', 'change-a']);
  const restored = readResumeOptimizationSelectionSnapshot('owner-a', 'resume-a', 'run-a');
  assert.deepEqual(restored, ['change-b', 'change-a']);
  restored.push('mutated-by-caller');
  assert.deepEqual(
    readResumeOptimizationSelectionSnapshot('owner-a', 'resume-a', 'run-a'),
    ['change-b', 'change-a'],
  );

  const hook = read('views/ResumeEditor/hooks/useResumeOptimizationFlow.ts');
  const applyBlock = hook.slice(hook.indexOf('const applyRunToState'), hook.indexOf('const waitForSourceSnapshot'));
  assert.match(applyBlock, /readResumeOptimizationSelectionSnapshot/);
  assert.match(applyBlock, /filterResumeOptimizationSelectableChangeIds/);
  const toggleBlock = hook.slice(hook.indexOf('const toggleChange'), hook.indexOf('const runPostApplyEvaluation'));
  assert.match(toggleBlock, /saveResumeOptimizationSelectionSnapshot/);
});
