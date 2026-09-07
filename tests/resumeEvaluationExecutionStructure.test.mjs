import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

let hookImportSequence = 0;

const importResumeEvaluationHook = async () => {
  const result = await build({
    entryPoints: ['hooks/useResumeEvaluation.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    plugins: [{
      name: 'resume-evaluation-hook-stubs',
      setup(buildContext) {
        const stub = (filter, path) => buildContext.onResolve({ filter }, () => ({
          path,
          namespace: 'stub',
        }));
        stub(/^react$/, 'react-stub');
        stub(/useAuthOwnerOperationGuard$/, 'owner-guard-stub');
        stub(/services\/apiClient$/, 'api-client-stub');
        stub(/services\/aiService$/, 'ai-service-stub');
        stub(/jdAnalysisSignatureUtils$/, 'signature-stub');
        stub(/utils\/aiThought$/, 'thought-stub');
        stub(/constants\/jdAnalysis$/, 'constants-stub');
        stub(/jdAnalysisThinkingText$/, 'thinking-text-stub');

        buildContext.onLoad({ filter: /^react-stub$/, namespace: 'stub' }, () => ({
          loader: 'js',
          contents: `
            export const useCallback = (...args) => globalThis.__resumeEvaluationHooks.useCallback(...args);
            export const useEffect = (...args) => globalThis.__resumeEvaluationHooks.useEffect(...args);
            export const useLayoutEffect = (...args) => globalThis.__resumeEvaluationHooks.useLayoutEffect(...args);
            export const useRef = (...args) => globalThis.__resumeEvaluationHooks.useRef(...args);
            export const useState = (...args) => globalThis.__resumeEvaluationHooks.useState(...args);
          `,
        }));
        buildContext.onLoad({ filter: /^owner-guard-stub$/, namespace: 'stub' }, () => ({
          loader: 'js',
          contents: 'export const useAuthOwnerOperationGuard = () => globalThis.__resumeEvaluationOwnerGuard;',
        }));
        buildContext.onLoad({ filter: /^api-client-stub$/, namespace: 'stub' }, () => ({
          loader: 'js',
          contents: 'export const isAuthContextChangedError = () => false;',
        }));
        buildContext.onLoad({ filter: /^ai-service-stub$/, namespace: 'stub' }, () => ({
          loader: 'js',
          contents: 'export const aiService = { evaluateResume: (...args) => globalThis.__evaluateResume(...args) };',
        }));
        buildContext.onLoad({ filter: /^signature-stub$/, namespace: 'stub' }, () => ({
          loader: 'js',
          contents: 'export const canonicalStringify = JSON.stringify;',
        }));
        buildContext.onLoad({ filter: /^thought-stub$/, namespace: 'stub' }, () => ({
          loader: 'js',
          contents: 'export const resolveThoughtDisplayEvent = () => null;',
        }));
        buildContext.onLoad({ filter: /^constants-stub$/, namespace: 'stub' }, () => ({
          loader: 'js',
          contents: 'export const JD_ANALYSIS_PROGRESS_NODE_TITLES = {};',
        }));
        buildContext.onLoad({ filter: /^thinking-text-stub$/, namespace: 'stub' }, () => ({
          loader: 'js',
          contents: 'export const appendJDThinkingText = (_current, next) => next;',
        }));
      },
    }],
  });
  hookImportSequence += 1;
  return import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}#${hookImportSequence}`
  );
};

const importJDAnalysisSignatureUtils = async () => {
  const result = await build({
    entryPoints: ['hooks/jdAnalysisSignatureUtils.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`
  );
};

const createHookRuntime = () => {
  const slots = [];
  const pendingPassiveEffects = [];
  let cursor = 0;
  const depsChanged = (before, after) => (
    !before
    || before.length !== after.length
    || before.some((value, index) => !Object.is(value, after[index]))
  );
  const useMemoizedValue = (factory, deps = []) => {
    const index = cursor++;
    if (!slots[index] || depsChanged(slots[index].deps, deps)) {
      slots[index] = { deps, value: factory() };
    }
    return slots[index].value;
  };
  const runEffect = (effect, deps = []) => {
    const index = cursor++;
    const previous = slots[index];
    if (!previous || depsChanged(previous.deps, deps)) {
      slots[index] = { deps, cleanup: effect() };
    }
  };
  const schedulePassiveEffect = (effect, deps = []) => {
    const index = cursor++;
    const previous = slots[index];
    if (!previous || depsChanged(previous.deps, deps)) {
      slots[index] = { deps, cleanup: previous?.cleanup };
      pendingPassiveEffects.push(() => {
        slots[index].cleanup = effect();
      });
    }
  };
  return {
    flushPassiveEffects() {
      pendingPassiveEffects.splice(0).forEach((effect) => effect());
    },
    render(component) {
      cursor = 0;
      return component();
    },
    useCallback(callback, deps = []) {
      return useMemoizedValue(() => callback, deps);
    },
    useEffect: schedulePassiveEffect,
    useLayoutEffect: runEffect,
    useRef(initialValue) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { current: initialValue };
      return slots[index];
    },
    useState(initialValue) {
      const index = cursor++;
      if (!slots[index]) {
        slots[index] = {
          value: typeof initialValue === 'function' ? initialValue() : initialValue,
        };
      }
      return [slots[index].value, (nextValue) => {
        slots[index].value = typeof nextValue === 'function'
          ? nextValue(slots[index].value)
          : nextValue;
      }];
    },
  };
};

const runEvaluationFailureScenario = async ({
  invalidateWhileRunning,
  switchOwnerBeforeRequest = false,
}) => {
  const runtime = createHookRuntime();
  globalThis.__resumeEvaluationHooks = runtime;
  globalThis.__resumeEvaluationOwnerGuard = {
    beginOperation: async () => ({ expectedAuthCacheKey: 'owner-a' }),
    assertOperationCurrent: async () => undefined,
    isOperationCurrent: () => true,
  };
  let rejectEvaluation;
  globalThis.__evaluateResume = () => new Promise((_resolve, reject) => {
    rejectEvaluation = reject;
  });

  try {
    const { useResumeEvaluation } = await importResumeEvaluationHook();
    const baseOptions = {
      authUserKey: 'owner-a',
      resumeId: 'resume-a',
      jdText: 'JD',
      jdAvailable: true,
      jdMatchPercentage: 88,
      hasMissingJdContext: false,
      hasPendingJdFileSelection: () => false,
      isJdAnalysisInputCurrent: true,
      jdAnalysisResult: {
        matchPercentage: 88,
        resumeEvaluation: { evaluationVersion: 'resume_flow_v1' },
      },
      snapshot: { profile: { name: 'Candidate' } },
      evaluationSignature: 'signature-a',
      persistEvaluation: () => true,
    };
    const render = (isEvaluationOutdated, authUserKey = 'owner-a') => runtime.render(() => useResumeEvaluation({
      ...baseOptions,
      authUserKey,
      isEvaluationOutdated,
    }));

    const initial = render(false);
    runtime.flushPassiveEffects();
    const activeOwner = switchOwnerBeforeRequest ? 'owner-b' : 'owner-a';
    const requestView = switchOwnerBeforeRequest ? render(false, activeOwner) : initial;
    runtime.flushPassiveEffects();
    const outcomePromise = requestView.generateEvaluation();
    await Promise.resolve();
    assert.equal(typeof rejectEvaluation, 'function');
    if (invalidateWhileRunning) render(true, activeOwner);
    rejectEvaluation(new Error('provider unavailable'));
    assert.deepEqual(await outcomePromise, { status: 'error' });
    return render(invalidateWhileRunning, activeOwner).evaluationError;
  } finally {
    delete globalThis.__resumeEvaluationHooks;
    delete globalThis.__resumeEvaluationOwnerGuard;
    delete globalThis.__evaluateResume;
  }
};

const runEvaluationJDResultRaceScenario = async () => {
  const runtime = createHookRuntime();
  globalThis.__resumeEvaluationHooks = runtime;
  globalThis.__resumeEvaluationOwnerGuard = {
    beginOperation: async () => ({ expectedAuthCacheKey: 'owner-a' }),
    assertOperationCurrent: async () => undefined,
    isOperationCurrent: () => true,
  };
  let resolveEvaluation;
  globalThis.__evaluateResume = () => new Promise((resolve) => {
    resolveEvaluation = resolve;
  });
  const persistCalls = [];

  try {
    const { useResumeEvaluation } = await importResumeEvaluationHook();
    const baseOptions = {
      authUserKey: 'owner-a',
      resumeId: 'resume-a',
      jdText: 'JD',
      jdAvailable: true,
      jdMatchPercentage: 88,
      hasMissingJdContext: false,
      hasPendingJdFileSelection: () => false,
      isJdAnalysisInputCurrent: true,
      isEvaluationOutdated: true,
      snapshot: { profile: { name: 'Candidate' } },
      evaluationSignature: 'same-input-signature',
      persistEvaluation: (...args) => {
        persistCalls.push(args);
        return true;
      },
    };
    const render = (jdAnalysisResult) => runtime.render(() => useResumeEvaluation({
      ...baseOptions,
      jdAnalysisResult,
    }));

    const initial = render({
      matchPercentage: 88,
      summary: 'JD result A',
      jobKeywords: ['typescript'],
    });
    runtime.flushPassiveEffects();
    const outcomePromise = initial.generateEvaluation();
    await Promise.resolve();
    assert.equal(typeof resolveEvaluation, 'function');

    // The score and input signature are deliberately unchanged. This render is
    // not followed by passive effects, exercising the render-to-effect race.
    render({
      matchPercentage: 88,
      summary: 'JD result B',
      jobKeywords: ['typescript', 'react'],
    });
    resolveEvaluation({
      evaluationVersion: 'resume_flow_v1',
      jdMatch: 88,
    });

    return {
      outcome: await outcomePromise,
      persistCalls,
    };
  } finally {
    delete globalThis.__resumeEvaluationHooks;
    delete globalThis.__resumeEvaluationOwnerGuard;
    delete globalThis.__evaluateResume;
  }
};

const runReturnedJDMatchScenario = async ({
  jdText,
  jdAnalysisResult,
  evaluationJDMatch,
  isJdAnalysisInputCurrent = true,
}) => {
  const runtime = createHookRuntime();
  globalThis.__resumeEvaluationHooks = runtime;
  globalThis.__resumeEvaluationOwnerGuard = {
    beginOperation: async () => ({ expectedAuthCacheKey: 'owner-a' }),
    assertOperationCurrent: async () => undefined,
    isOperationCurrent: () => true,
  };
  let evaluationCalls = 0;
  globalThis.__evaluateResume = async () => {
    evaluationCalls += 1;
    return {
      evaluationVersion: 'resume_flow_v1',
      jdMatch: evaluationJDMatch,
    };
  };
  const persistCalls = [];

  try {
    const { useResumeEvaluation } = await importResumeEvaluationHook();
    const view = runtime.render(() => useResumeEvaluation({
      authUserKey: 'owner-a',
      resumeId: 'resume-a',
      jdText,
      jdAvailable: Boolean(jdText.trim()),
      jdMatchPercentage: jdText.trim() ? jdAnalysisResult?.matchPercentage : undefined,
      hasMissingJdContext: false,
      hasPendingJdFileSelection: () => false,
      isJdAnalysisInputCurrent,
      jdAnalysisResult,
      isEvaluationOutdated: true,
      snapshot: { profile: { name: 'Candidate' } },
      evaluationSignature: 'evaluation-signature',
      persistEvaluation: (...args) => {
        persistCalls.push(args);
        return true;
      },
    }));
    runtime.flushPassiveEffects();
    return {
      outcome: await view.generateEvaluation(),
      persistCalls,
      evaluationCalls,
    };
  } finally {
    delete globalThis.__resumeEvaluationHooks;
    delete globalThis.__resumeEvaluationOwnerGuard;
    delete globalThis.__evaluateResume;
  }
};

test('six-dimension report uses a dedicated stream and isolated controller', () => {
  const service = read('services/aiService.ts');
  const hook = read('hooks/useResumeEvaluation.ts');
  const jdHook = read('hooks/useJDAnalysis.ts');
  const editor = read('views/ResumeEditor/index.tsx');
  const resumeData = read('hooks/useResumeData.ts');

  assert.match(service, /path: '\/api\/resume-evaluation\/stream'/);
  assert.match(service, /jd_match_percentage/);
  assert.match(hook, /const controllerRef = useRef<AbortController \| null>\(null\)/);
  assert.match(hook, /const runIdRef = useRef\(0\)/);
  assert.match(hook, /const requestInputs = latestInputsRef\.current/);
  assert.match(hook, /const requestEvaluationSignature = requestInputs\.evaluationSignature/);
  assert.match(
    hook,
    /latestInputsRef\.current\.persistEvaluation\(\s*evaluation,\s*requestEvaluationSignature,\s*requestJDResultIdentity,\s*requestJDMatchPercentage\s*\)/,
  );
  assert.match(hook, /if \(controllerRef\.current\)/);
  assert.match(
    hook,
    /\[evaluationSignature, hasJdAnalysisPersistenceConflict, jdResultIdentity, stopEvaluation\]/,
  );
  assert.match(hook, /if \(!isCurrent\(\)\) return \{ status: "aborted" \}/);
  assert.match(jdHook, /const persistResumeEvaluation = useCallback/);
  assert.match(jdHook, /resolveResumeEvaluationJDContext\(\{/);
  assert.match(
    jdHook,
    /analysisContext\?\.jdInputSignature === jdInputSignature[\s\S]*?analysisResult\?\.matchPercentage[\s\S]*?: undefined/,
  );
  assert.match(jdHook, /beginJDAttachmentReplacement\(\{[\s\S]*?jdText: jdTextRef\.current,[\s\S]*?attachmentExtractedText: attachmentExtractedTextRef\.current/);
  assert.match(jdHook, /setJdText\(replacement\.jdText\)/);
  assert.match(jdHook, /setAttachmentExtractedText\(replacement\.attachmentExtractedText\)/);
  assert.match(
    jdHook,
    /isEvaluationOutdated = useMemo[\s\S]*?resumeEvaluationJDContext\.hasMissingAttachmentText/,
  );
  assert.match(
    jdHook,
    /resolveHydratedEvaluationSignature\([\s\S]*?hydratedEvaluationJDContext\.hasMissingAttachmentText/,
  );
  assert.match(
    jdHook,
    /attachmentExtractedText: attachmentExtractedTextRef\.current,[\s\S]*?\n\s*\};\n\s*\}, \[\]\);/,
  );
  assert.match(jdHook, /jdAvailable: resumeEvaluationJDContext\.jdAvailable/);
  assert.match(jdHook, /if \(requestEvaluationSignature !== evaluationSignatureRef\.current\)/);
  assert.match(jdHook, /persistedJDAnalysisRef\.current/);
  assert.match(jdHook, /jdInputSignature,\s*resume: evaluationSnapshot/);
  assert.match(jdHook, /evaluationIsOutdated: false/);
  assert.match(jdHook, /evaluationSignature: requestEvaluationSignature,\s*targetRoleSignature,/);
  assert.match(jdHook, /evaluationSignature: requestEvaluationSignature,\s*targetRoleSignature,\s*\}/);
  assert.match(editor, /runResumeEvaluationAfterLinkPreflight\(\{/);
  assert.match(editor, /ensureLinks: ensureSelectedExperienceLinks/);
  assert.match(editor, /flushConfig: flushResumeConfig/);
  assert.match(editor, /generateEvaluation/);
  assert.match(editor, /jdText: evaluationJdText/);
  assert.match(editor, /jdAvailable: evaluationJdAvailable/);
  assert.match(editor, /jdMatchPercentage: evaluationJdMatchPercentage/);
  assert.match(editor, /isJdAnalysisInputCurrent: isEvaluationJdAnalysisInputCurrent/);
  assert.match(editor, /hasMissingJdContext: hasMissingEvaluationJdContext/);
  assert.match(editor, /hasPendingJdFileSelection/);
  assert.match(resumeData, /adoptResumeDetailUpdatedAt\(state\.resumeUpdatedAtRef, detail\)/);
  assert.match(editor, /const handleAnalyzePersistedSnapshot = useCallback/);
  assert.match(editor, /handleAnalyze: handleAnalyzePersistedSnapshot/);
  assert.match(resumeData, /expected_updated_at: expectedUpdatedAt/);
  assert.match(resumeData, /forceVersionCheck: true/);
  assert.match(resumeData, /subscribeToResumeVersionConflicts/);
  assert.match(resumeData, /const conflictedDraftSignature = JSON\.stringify\(conflictedDraft\)/);
  assert.match(resumeData, /suppressedAutoSaveSignatureRef\.current = conflictedDraftSignature/);
  assert.match(resumeData, /if \(hasResumeVersionConflict\) \{\s*return;/);
  const conflictRecovery = resumeData.match(
    /return subscribeToResumeVersionConflicts[\s\S]*?\n\s*\}, \[state\.resumeId,[^\n]+\]\);/,
  )?.[0] ?? '';
  assert.match(conflictRecovery, /resumeVersionConflictRef\.current = true/);
  assert.match(conflictRecovery, /resumeVersionConflictEpochRef\.current \+= 1/);
  assert.match(conflictRecovery, /setHasResumeVersionConflict\(true\)/);
  assert.doesNotMatch(conflictRecovery, /resumeService\.get|resumeUpdatedAtRef|setHasResumeVersionConflict\(false\)/);
  assert.match(resumeData, /assertCanPersist: \(\) => \{\s*assertSaveOwnerCurrent\(\);\s*if \(resumeVersionConflictRef\.current\) \{\s*throw new Error/);
  assert.match(resumeData, /if \(resumeVersionConflictRef\.current\) \{\s*setSaveState\('error'\);\s*throw new Error/);
  assert.match(
    resumeData,
    /suppressedAutoSaveSignatureRef\.current = null;\s*shouldWaitForDebouncedConfigRef\.current = true;/,
  );
  const autoSave = resumeData.slice(
    resumeData.indexOf('const useResumeAutoSave = ('),
    resumeData.indexOf('const useResumeConfigFlusher = ('),
  );
  const suppressionClearIndex = autoSave.indexOf('suppressedAutoSaveSignatureRef.current = null;');
  const barrierResetIndex = autoSave.indexOf(
    'shouldWaitForDebouncedConfigRef.current = true;',
    suppressionClearIndex,
  );
  const barrierCheckIndex = autoSave.indexOf('if (shouldWaitForDebouncedConfigRef.current)');
  const debounceGuardIndex = autoSave.indexOf(
    'if (debouncedConfigSignature !== configSignature)',
    barrierCheckIndex,
  );
  const persistIndex = autoSave.indexOf('saveResumeConfig(debouncedConfig)');
  assert.ok(suppressionClearIndex >= 0 && suppressionClearIndex < barrierResetIndex);
  assert.ok(barrierResetIndex < barrierCheckIndex);
  assert.ok(barrierCheckIndex < debounceGuardIndex && debounceGuardIndex < persistIndex);
  const explicitReload = resumeData.match(
    /const reloadResumeContext = useCallback\(async[\s\S]*?\n\s*\}, \[reloadResumeContextBase\]\);/,
  )?.[0] ?? '';
  assert.match(explicitReload, /const conflictEpochAtStart = resumeVersionConflictEpochRef\.current/);
  assert.match(explicitReload, /resumeVersionConflictEpochRef\.current === conflictEpochAtStart/);
  assert.doesNotMatch(explicitReload, /suppressedAutoSaveSignatureRef\.current = null/);
  assert.match(editor, /自动保存已暂停/);
  assert.match(editor, /重新加载远端版本/);
});

test('default JD matching keeps the lightweight request and does not require a report', () => {
  const runner = read('hooks/jdAnalysisRequestRunner.ts');
  const normalizer = read('services/aiNormalizeUtils.ts');
  const planner = read('hooks/jdAnalysisRunStateUtils.ts');

  assert.match(runner, /buildResumeAISnapshot/);
  assert.doesNotMatch(runner, /snapshot\.analysisPayload \?\? buildAnalyzePayload/);
  assert.doesNotMatch(normalizer, /matchPercentage: resumeEvaluation\.overallScore/);
  assert.doesNotMatch(planner, /hasCurrentEvaluation/);
});

test('report stop action and single-button placeholder stay accessible', () => {
  const report = read('views/ResumeEditor/components/ResumeEvaluationReport/ResumeEvaluationReport.tsx');
  const panel = read('views/ResumeEditor/components/JDAnalysisPanel.tsx');
  const editor = read('views/ResumeEditor/index.tsx');

  assert.match(report, /aria-label="获取简历改进指导"/);
  assert.match(report, /停止生成/);
  assert.match(panel, /onStop=\{onStopEvaluation\}/);
  const placeholder = report.slice(
    report.indexOf('const placeholderContent'),
    report.indexOf('if (onGenerate && !isGenerating)')
  );
  assert.doesNotMatch(placeholder, /<h4|<p/);
  assert.match(panel, /onStopEvaluation\?: \(\) => void/);
  assert.match(editor, /onStopEvaluation: stopEvaluation/);
});

test('guidance failures retain only a current trusted report and expose safe retryable messages', () => {
  const hook = read('hooks/useResumeEvaluation.ts');
  const report = read('views/ResumeEditor/components/ResumeEvaluationReport/ResumeEvaluationReport.tsx');
  const catchBlock = hook.slice(
    hook.indexOf('} catch (cause) {'),
    hook.indexOf('} finally {'),
  );

  assert.match(hook, /const RESUME_EVALUATION_PUBLIC_ERROR_MESSAGE = "本次简历改进指导未保存，请重试。"/);
  assert.match(hook, /const RESUME_EVALUATION_RETAINED_ERROR_MESSAGE =[\s\S]*"本次简历改进指导未保存，已保留上一份可信指导，请重试。"/);
  assert.match(hook, /export const isCurrentTrustedEvaluation = \([\s\S]*isEvaluationOutdated === false/);
  assert.match(hook, /const hasTrustedEvaluationRef = useRef\(false\)/);
  assert.match(hook, /const trustedEvaluationIdentityRef = useRef\(\{ authUserKey, resumeId \}\)/);
  assert.match(
    hook,
    /useLayoutEffect\(\(\) => \{[\s\S]*?const identityChanged[\s\S]*?hasTrustedEvaluationRef\.current = \([\s\S]*?!identityChanged[\s\S]*?\}, \[authUserKey, isEvaluationOutdated, jdAnalysisResult, resumeId\]\)/,
  );
  assert.match(catchBlock, /hasTrustedEvaluationRef\.current/);
  assert.match(catchBlock, /setError\(/);
  assert.doesNotMatch(catchBlock, /cause\.message|setError\(cause|Invalid resume evaluation structure|repair attempt/);
  assert.doesNotMatch(catchBlock, /persistResumeEvaluationResult|onEvaluationComplete/);
  assert.match(catchBlock, /return \{ status: "error" \}/);
  assert.match(report, /if \(onGenerate && !isGenerating\)/);
  assert.match(report, /role="alert"/);
});

test('an evaluation invalidated while a request is running is not reported as retained after failure', async () => {
  const error = await runEvaluationFailureScenario({ invalidateWhileRunning: true });
  assert.equal(error, '本次简历改进指导未保存，请重试。');
  assert.doesNotMatch(error, /已保留上一份可信指导/);
});

test('a still-current trusted evaluation is explicitly reported as retained after failure', async () => {
  const error = await runEvaluationFailureScenario({ invalidateWhileRunning: false });
  assert.equal(error, '本次简历改进指导未保存，已保留上一份可信指导，请重试。');
});

test('an owner switch cannot retain the previous owner report in failure copy', async () => {
  const error = await runEvaluationFailureScenario({
    invalidateWhileRunning: false,
    switchOwnerBeforeRequest: true,
  });
  assert.equal(error, '本次简历改进指导未保存，请重试。');
  assert.doesNotMatch(error, /已保留上一份可信指导/);
});

test('a late evaluation cannot persist onto a different same-score JD result', async () => {
  const { outcome, persistCalls } = await runEvaluationJDResultRaceScenario();

  assert.deepEqual(outcome, { status: 'aborted' });
  assert.deepEqual(persistCalls, []);
});

test('a completed JD rerun drops the old report and rebinds same-score signatures', async () => {
  const {
    buildEvaluationSignature,
    buildJDResultIdentity,
    rebindEvaluationSignature,
    reconcileJDResultEvaluation,
  } = await importResumeEvaluationHook();
  const evaluationA = { evaluationVersion: 'resume_flow_v1', jdMatch: 88 };
  const resultA = {
    matchPercentage: 88,
    summary: 'JD result A',
    jobKeywords: ['typescript'],
    resumeEvaluation: evaluationA,
  };
  const resultBWithCarriedEvaluation = {
    matchPercentage: 88,
    summary: 'JD result B',
    jobKeywords: ['typescript', 'react'],
    resumeEvaluation: evaluationA,
  };

  const reconciled = reconcileJDResultEvaluation(
    resultA,
    resultBWithCarriedEvaluation,
  );
  assert.equal(reconciled.jdResultChanged, true);
  assert.equal('resumeEvaluation' in reconciled.result, false);

  const sharedInput = {
    jdInputSignature: 'same-jd-input',
    resume: { profile: { name: 'Candidate' } },
    jdAvailable: true,
  };
  assert.notEqual(
    buildEvaluationSignature({ ...sharedInput, jdAnalysisResult: resultA }),
    buildEvaluationSignature({ ...sharedInput, jdAnalysisResult: reconciled.result }),
  );

  const changedScoreResult = {
    ...reconciled.result,
    matchPercentage: 77,
  };
  const rebound = JSON.parse(rebindEvaluationSignature(
    buildEvaluationSignature({ ...sharedInput, jdAnalysisResult: resultA }),
    changedScoreResult,
  ));
  assert.equal(rebound.jdMatchPercentage, 77);
  assert.equal(rebound.jdResultIdentity, buildJDResultIdentity(changedScoreResult));
});

test('an unchanged JD result retains the latest live report, not a stale captured one', async () => {
  const { reconcileJDResultEvaluation } = await importResumeEvaluationHook();
  const latestEvaluation = { evaluationVersion: 'resume_flow_v1', jdMatch: 88, marker: 'latest' };
  const staleEvaluation = { evaluationVersion: 'resume_flow_v1', jdMatch: 88, marker: 'stale' };
  const currentResult = {
    matchPercentage: 88,
    summary: 'same JD result',
    resumeEvaluation: latestEvaluation,
  };
  const requestCapturedResult = {
    matchPercentage: 88,
    summary: 'same JD result',
    resumeEvaluation: staleEvaluation,
  };

  const reconciled = reconcileJDResultEvaluation(currentResult, requestCapturedResult);
  assert.equal(reconciled.jdResultChanged, false);
  assert.equal(reconciled.result.resumeEvaluation, latestEvaluation);
});

test('a mismatched returned JD match is rejected before persistence', async () => {
  const { outcome, persistCalls } = await runReturnedJDMatchScenario({
    jdText: 'JD',
    jdAnalysisResult: { matchPercentage: 88, summary: 'current JD result' },
    evaluationJDMatch: 77,
  });

  assert.deepEqual(outcome, { status: 'aborted' });
  assert.deepEqual(persistCalls, []);
});

test('no-JD evaluation requires null JD match and does not reuse a stale outer score', async () => {
  const staleJDResult = { matchPercentage: 88, summary: 'stale JD result' };
  const mismatched = await runReturnedJDMatchScenario({
    jdText: '',
    jdAnalysisResult: staleJDResult,
    evaluationJDMatch: 88,
  });
  assert.deepEqual(mismatched.outcome, { status: 'aborted' });
  assert.deepEqual(mismatched.persistCalls, []);

  const current = await runReturnedJDMatchScenario({
    jdText: '',
    jdAnalysisResult: staleJDResult,
    evaluationJDMatch: null,
  });
  assert.equal(current.outcome.status, 'success');
  assert.equal(current.persistCalls.length, 1);
  assert.equal(current.persistCalls[0][3], undefined);
});

test('clearing an analyzed JD cannot persist a fresh no-JD report over the old JD state', async () => {
  const staleJDResult = { matchPercentage: 88, summary: 'old JD result' };
  const blocked = await runReturnedJDMatchScenario({
    jdText: '',
    jdAnalysisResult: staleJDResult,
    evaluationJDMatch: null,
    isJdAnalysisInputCurrent: false,
  });

  assert.deepEqual(blocked.outcome, { status: 'error' });
  assert.equal(blocked.evaluationCalls, 0);
  assert.deepEqual(blocked.persistCalls, []);
});

test('attachment JD evaluation context is canonical and fails closed without extracted body text', async () => {
  const {
    resolveResumeEvaluationJDContext,
    splitAttachmentDerivedJdText,
    JD_ATTACHMENT_SUPPLEMENT_PREFIX,
  } =
    await importJDAnalysisSignatureUtils();

  assert.deepEqual(resolveResumeEvaluationJDContext({
    jdText: '',
    inputMode: 'attachment',
    attachmentExtractedText: null,
    matchPercentage: 88,
  }), {
    text: '',
    jdAvailable: false,
    jdMatchPercentage: undefined,
    hasMissingAttachmentText: true,
  });
  assert.deepEqual(resolveResumeEvaluationJDContext({
    jdText: '只是一段补充说明',
    inputMode: 'attachment',
    attachmentExtractedText: undefined,
    matchPercentage: 88,
  }), {
    text: '',
    jdAvailable: false,
    jdMatchPercentage: undefined,
    hasMissingAttachmentText: true,
  });

  const restored = resolveResumeEvaluationJDContext({
    jdText: '',
    inputMode: 'attachment',
    attachmentExtractedText: '  完整附件 JD 正文  ',
    matchPercentage: 88,
  });
  assert.deepEqual(restored, {
    text: '完整附件 JD 正文',
    jdAvailable: true,
    jdMatchPercentage: 88,
    hasMissingAttachmentText: false,
  });

  const withSupplement = resolveResumeEvaluationJDContext({
    jdText: '  需要英语流利  ',
    inputMode: 'attachment',
    attachmentExtractedText: '完整附件 JD 正文',
    matchPercentage: 88,
  });
  assert.deepEqual(withSupplement, {
    text: `完整附件 JD 正文${JD_ATTACHMENT_SUPPLEMENT_PREFIX}需要英语流利`,
    jdAvailable: true,
    jdMatchPercentage: 88,
    hasMissingAttachmentText: false,
  });
  assert.deepEqual(resolveResumeEvaluationJDContext({
    jdText: withSupplement.text,
    inputMode: 'attachment',
    attachmentExtractedText: '完整附件 JD 正文',
    matchPercentage: 88,
  }), withSupplement);
  assert.equal(
    splitAttachmentDerivedJdText(
      withSupplement.text,
      '完整附件 JD 正文',
    ).supplementalText,
    '需要英语流利',
  );
});

test('a restored attachment report without recoverable body text is never current or trusted', async () => {
  const {
    isCurrentTrustedEvaluation,
    resolveResumeEvaluationOutdated,
  } = await importResumeEvaluationHook();
  const result = {
    matchPercentage: 88,
    resumeEvaluation: { evaluationVersion: 'resume_flow_v1', jdMatch: 88 },
  };
  const isOutdated = resolveResumeEvaluationOutdated({
    evaluationVersion: 'resume_flow_v1',
    boundEvaluationSignature: 'same-signature',
    currentEvaluationSignature: 'same-signature',
    persistedEvaluationIsOutdated: false,
    hasMissingAttachmentText: true,
  });

  assert.equal(isOutdated, true);
  assert.equal(isCurrentTrustedEvaluation(result, isOutdated), false);
});

test('missing attachment text blocks six-dimension evaluation without calling or persisting no-JD output', async () => {
  const runtime = createHookRuntime();
  globalThis.__resumeEvaluationHooks = runtime;
  globalThis.__resumeEvaluationOwnerGuard = {
    beginOperation: async () => ({ expectedAuthCacheKey: 'owner-a' }),
    assertOperationCurrent: async () => undefined,
    isOperationCurrent: () => true,
  };
  let evaluationCalls = 0;
  let persistCalls = 0;
  globalThis.__evaluateResume = async () => {
    evaluationCalls += 1;
    return { evaluationVersion: 'resume_flow_v1', jdMatch: null };
  };

  try {
    const { useResumeEvaluation } = await importResumeEvaluationHook();
    const options = {
      authUserKey: 'owner-a',
      resumeId: 'resume-a',
      jdText: '',
      jdAvailable: false,
      jdMatchPercentage: undefined,
      hasMissingJdContext: true,
      hasPendingJdFileSelection: () => false,
      isJdAnalysisInputCurrent: true,
      jdAnalysisResult: { matchPercentage: 88, summary: 'attachment-backed result' },
      isEvaluationOutdated: true,
      snapshot: { profile: { name: 'Candidate' } },
      evaluationSignature: 'attachment-signature',
      persistEvaluation: () => {
        persistCalls += 1;
        return true;
      },
    };
    const view = runtime.render(() => useResumeEvaluation(options));
    runtime.flushPassiveEffects();
    assert.deepEqual(await view.generateEvaluation(), { status: 'error' });
    assert.equal(evaluationCalls, 0);
    assert.equal(persistCalls, 0);
    assert.match(
      runtime.render(() => useResumeEvaluation(options)).evaluationError,
      /重新上传.*JD.*分析/,
    );
  } finally {
    delete globalThis.__resumeEvaluationHooks;
    delete globalThis.__resumeEvaluationOwnerGuard;
    delete globalThis.__evaluateResume;
  }
});

test('six-dimension request sends canonical attachment-derived JD text with its explicit bound match', async () => {
  const runtime = createHookRuntime();
  globalThis.__resumeEvaluationHooks = runtime;
  globalThis.__resumeEvaluationOwnerGuard = {
    beginOperation: async () => ({ expectedAuthCacheKey: 'owner-a' }),
    assertOperationCurrent: async () => undefined,
    isOperationCurrent: () => true,
  };
  const requests = [];
  globalThis.__evaluateResume = async (params) => {
    requests.push(params);
    return { evaluationVersion: 'resume_flow_v1', jdMatch: 88 };
  };

  try {
    const { useResumeEvaluation } = await importResumeEvaluationHook();
    const canonicalJdText = '完整附件 JD 正文\n\n补充 JD 说明：\n需要英语流利';
    const view = runtime.render(() => useResumeEvaluation({
      authUserKey: 'owner-a',
      resumeId: 'resume-a',
      jdText: canonicalJdText,
      jdAvailable: true,
      jdMatchPercentage: 88,
      hasMissingJdContext: false,
      hasPendingJdFileSelection: () => false,
      isJdAnalysisInputCurrent: true,
      jdAnalysisResult: { matchPercentage: 88, summary: 'attachment-backed result' },
      isEvaluationOutdated: true,
      snapshot: { profile: { name: 'Candidate' } },
      evaluationSignature: 'attachment-signature',
      persistEvaluation: () => true,
    }));
    runtime.flushPassiveEffects();
    assert.equal((await view.generateEvaluation()).status, 'success');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].text, canonicalJdText);
    assert.equal(requests[0].jdMatchPercentage, 88);
  } finally {
    delete globalThis.__resumeEvaluationHooks;
    delete globalThis.__resumeEvaluationOwnerGuard;
    delete globalThis.__evaluateResume;
  }
});

test('changed JD input or a pending attachment selection cannot reuse an earlier JD match', async () => {
  const runBlockedScenario = async ({ pending }) => {
    const runtime = createHookRuntime();
    globalThis.__resumeEvaluationHooks = runtime;
    globalThis.__resumeEvaluationOwnerGuard = {
      beginOperation: async () => ({ expectedAuthCacheKey: 'owner-a' }),
      assertOperationCurrent: async () => undefined,
      isOperationCurrent: () => true,
    };
    let evaluationCalls = 0;
    let persistCalls = 0;
    globalThis.__evaluateResume = async () => {
      evaluationCalls += 1;
      return { evaluationVersion: 'resume_flow_v1', jdMatch: null };
    };
    try {
      const { useResumeEvaluation } = await importResumeEvaluationHook();
      const view = runtime.render(() => useResumeEvaluation({
        authUserKey: 'owner-a',
        resumeId: 'resume-a',
        jdText: 'new JD input',
        jdAvailable: true,
        jdMatchPercentage: pending ? 88 : undefined,
        hasMissingJdContext: false,
        hasPendingJdFileSelection: () => pending,
        isJdAnalysisInputCurrent: pending,
        jdAnalysisResult: { matchPercentage: 88, summary: 'old JD result' },
        isEvaluationOutdated: true,
        snapshot: { profile: { name: 'Candidate' } },
        evaluationSignature: 'changed-jd-signature',
        persistEvaluation: () => {
          persistCalls += 1;
          return true;
        },
      }));
      runtime.flushPassiveEffects();
      assert.deepEqual(await view.generateEvaluation(), { status: 'error' });
      assert.equal(evaluationCalls, 0);
      assert.equal(persistCalls, 0);
    } finally {
      delete globalThis.__resumeEvaluationHooks;
      delete globalThis.__resumeEvaluationOwnerGuard;
      delete globalThis.__evaluateResume;
    }
  };

  await runBlockedScenario({ pending: false });
  await runBlockedScenario({ pending: true });
});

test('an unresolved JD persistence conflict blocks evaluation before provider or persistence', async () => {
  const runtime = createHookRuntime();
  globalThis.__resumeEvaluationHooks = runtime;
  globalThis.__resumeEvaluationOwnerGuard = {
    beginOperation: async () => ({ expectedAuthCacheKey: 'owner-a' }),
    assertOperationCurrent: async () => undefined,
    isOperationCurrent: () => true,
  };
  let evaluationCalls = 0;
  let persistCalls = 0;
  globalThis.__evaluateResume = async () => {
    evaluationCalls += 1;
    return { evaluationVersion: 'resume_flow_v1', jdMatch: 88 };
  };
  try {
    const { useResumeEvaluation } = await importResumeEvaluationHook();
    const view = runtime.render(() => useResumeEvaluation({
      authUserKey: 'owner-a',
      resumeId: 'resume-a',
      jdText: 'current JD',
      jdAvailable: true,
      jdMatchPercentage: 88,
      isJdAnalysisInputCurrent: true,
      hasMissingJdContext: false,
      hasPendingJdFileSelection: () => false,
      hasJdAnalysisPersistenceConflict: true,
      jdAnalysisResult: { matchPercentage: 88, summary: 'local pending result' },
      isEvaluationOutdated: true,
      snapshot: { profile: { name: 'Candidate' } },
      evaluationSignature: 'conflicted-signature',
      persistEvaluation: () => {
        persistCalls += 1;
        return true;
      },
    }));
    runtime.flushPassiveEffects();

    assert.deepEqual(await view.generateEvaluation(), { status: 'error' });
    assert.equal(evaluationCalls, 0);
    assert.equal(persistCalls, 0);
  } finally {
    delete globalThis.__resumeEvaluationHooks;
    delete globalThis.__resumeEvaluationOwnerGuard;
    delete globalThis.__evaluateResume;
  }
});

test('a persistence conflict discovered during owner capture blocks evaluation before the provider', async () => {
  const runtime = createHookRuntime();
  let resolveOwner;
  let canPersist = true;
  let evaluationCalls = 0;
  globalThis.__resumeEvaluationHooks = runtime;
  globalThis.__resumeEvaluationOwnerGuard = {
    beginOperation: () => new Promise((resolve) => {
      resolveOwner = resolve;
    }),
    assertOperationCurrent: async () => undefined,
    isOperationCurrent: () => true,
  };
  globalThis.__evaluateResume = async () => {
    evaluationCalls += 1;
    return { evaluationVersion: 'resume_flow_v1', jdMatch: 88 };
  };
  try {
    const { useResumeEvaluation } = await importResumeEvaluationHook();
    const view = runtime.render(() => useResumeEvaluation({
      authUserKey: 'owner-a',
      resumeId: 'resume-a',
      jdText: 'current JD',
      jdAvailable: true,
      jdMatchPercentage: 88,
      isJdAnalysisInputCurrent: true,
      hasMissingJdContext: false,
      hasPendingJdFileSelection: () => false,
      hasJdAnalysisPersistenceConflict: false,
      canPersistCurrentJDAnalysis: () => canPersist,
      jdAnalysisResult: { matchPercentage: 88, summary: 'current result' },
      isEvaluationOutdated: true,
      snapshot: { profile: { name: 'Candidate' } },
      evaluationSignature: 'current-signature',
      persistEvaluation: () => true,
    }));
    runtime.flushPassiveEffects();
    const pending = view.generateEvaluation();
    await Promise.resolve();
    canPersist = false;
    resolveOwner({ expectedAuthCacheKey: 'owner-a' });

    assert.deepEqual(await pending, { status: 'error' });
    assert.equal(evaluationCalls, 0);
  } finally {
    delete globalThis.__resumeEvaluationHooks;
    delete globalThis.__resumeEvaluationOwnerGuard;
    delete globalThis.__evaluateResume;
  }
});
