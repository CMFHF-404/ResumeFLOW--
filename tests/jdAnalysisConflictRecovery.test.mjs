import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';

const between = (source, start, end) => {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `Missing hook boundary: ${start}`);
  return source.slice(from, to);
};

// Exercise the hook's real authority/recovery callbacks and run cancellation
// with the real request executor; only React setters and storage IO are stubbed.
const importRecoveryHarness = async () => {
  const source = readFileSync('hooks/useJDAnalysis.ts', 'utf8');
  const invalidate = between(source, '  const invalidateAnalysisRun =', '  useLayoutEffect(');
  const authority = between(source, '  const resolveLocalAnalysisWriteBase =', '  const canApplyAnalysisResult =');
  const recovery = between(source, '  const restorePendingJDAnalysisRecovery =', '  useEffect(');
  const continuation = between(source, '        shouldContinue:', '        canApplyAnalysisResult,')
    .replace('shouldContinue:', 'const shouldContinue =')
    .replace(/,\s*$/, ';');
  const built = await build({
    stdin: {
      contents: `
        import {
          normalizeJDAnalysisPersistence, resolveLocalJDAnalysisWriteBase,
          buildJDAnalysisPersistenceFingerprint,
        } from './services/jdAnalysisStorage';
        export { runJDAnalysisExecution } from './hooks/useJDAnalysisExecution';
        export const createHarness = (rawBackend) => {
          const backend = normalizeJDAnalysisPersistence(rawBackend);
          const useCallback = (callback) => callback;
          const authUserKey = 'owner-1', resumeId = 'resume-1';
          const analysisIdentity = 'owner-1:resume-1', isAnalysisStateCurrent = true;
          const activeResumeIdRef = { current: resumeId };
          const activeAnalysisIdentityRef = { current: analysisIdentity };
          const persistedJDAnalysisConfigRef = { current: backend };
          const persistedJDAnalysisRef = { current: backend };
          const pendingJDAnalysisConflictRef = { current: null };
          const activeAnalysisRunIdRef = { current: 0 };
          const analyzeRequestRef = { current: null };
          const abortControllerRef = { current: null };
          const ownerOperation = {};
          const ownerGuard = { isOperationCurrent: () => true };
          let nextRunId = 0;
          let cache = { payload: backend, pendingSync: false, basePersistedFingerprint: null };
          const setIsAnalyzing = () => {};
          const setThinkingText = () => {};
          const setPersistedJDAnalysis = (payload) => { persistedJDAnalysisRef.current = payload; };
          const resetJDAnalysisState = () => {};
          const publishPendingJDAnalysisConflict = (conflict) => {
            pendingJDAnalysisConflictRef.current = conflict;
          };
          const loadJDAnalysisCache = () => cache;
          const saveJDAnalysisCache = (_owner, _resume, payload, options) => {
            cache = { payload: normalizeJDAnalysisPersistence(payload), ...options };
          };
          const clearJDAnalysisCache = () => { cache = null; };
          const applyPersistedAnalysisState = setPersistedJDAnalysis;
          ${invalidate}
          ${authority}
          ${recovery}
          return {
            canPersistCurrentJDAnalysis,
            restore: restorePendingJDAnalysisRecovery,
            discard: discardPendingJDAnalysisRecovery,
            get current() { return persistedJDAnalysisRef.current; },
            get cache() { return cache; },
            injectPending(payload) {
              saveJDAnalysisCache(authUserKey, resumeId, payload, {
                pendingSync: true,
                basePersistedFingerprint: buildJDAnalysisPersistenceFingerprint(backend),
              });
            },
            beginRun() {
              const runId = ++nextRunId;
              activeAnalysisRunIdRef.current = runId;
              const controller = new AbortController();
              abortControllerRef.current = controller;
              ${continuation}
              return { signal: controller.signal, shouldContinue };
            },
          };
        };
      `,
      loader: 'ts',
      resolveDir: process.cwd(),
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    define: {
      'import.meta.env.DEV': 'false',
      'import.meta.env.VITE_API_BASE_URL': '""',
      'import.meta.env.VITE_LOGTO_APP_ID': 'undefined',
    },
  });
  return import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
};

const buildPayload = (summary) => ({
  jdText: 'Same JD',
  inputMode: 'text',
  jdInputSignature: 'same-jd',
  experienceSignature: 'same-resume',
  itemSignatures: { experiences: {}, certifications: {}, skills: {} },
  result: { matchPercentage: 80, jobKeywords: [], missingKeywords: [], summary },
});

const beginDeferredAnalysis = (runJDAnalysisExecution, harness) => {
  let resolveProvider;
  const provider = new Promise((resolve) => { resolveProvider = resolve; });
  const effects = { requests: 0, scores: [], writes: [], completions: [] };
  const controls = harness.beginRun();
  const noop = () => {};
  const run = runJDAnalysisExecution({
    resumeId: 'resume-1',
    analysisContext: null,
    analysisResult: harness.current.result,
    service: {},
    buildAnalyzeSnapshot: () => ({
      ...harness.current,
      experiences: [], certifications: [], skillGroups: [], jdFile: null,
    }),
    requestRunner: () => { effects.requests += 1; return provider; },
    canApplyAnalysisResult: harness.canPersistCurrentJDAnalysis,
    ...controls,
    recordPostAnalyzeDiff: () => ({
      experiences: new Set(), certifications: new Set(), skills: new Set(),
    }),
    updateAnalysisState: (payload) => effects.writes.push(payload),
    applyMatchScoresForResult: (result) => effects.scores.push(result),
    trackComplete: (result) => effects.completions.push(result),
    updateAnalyzeDiffState: noop,
    promoteAttachmentToText: noop,
    clearFullAnalysisDiffState: noop,
    setIsAnalyzing: noop,
    setIsJDCollapsed: noop,
    setDebugInfo: noop,
    trackStart: noop,
  });
  return {
    run, effects, signal: controls.signal,
    finish(summary = 'Late old response') {
      resolveProvider({
        result: buildPayload(summary).result,
        currentFile: null,
        attachmentSupplementalJdText: '',
        extractedAttachmentText: '',
        shouldPersistAttachmentAsText: false,
      });
    },
  };
};

test('detecting a JD cache conflict immediately aborts the active request', async () => {
  const { createHarness, runJDAnalysisExecution } = await importRecoveryHarness();
  const harness = createHarness(buildPayload('Server base'));
  const pending = beginDeferredAnalysis(runJDAnalysisExecution, harness);
  assert.equal(pending.effects.requests, 1);
  harness.injectPending(buildPayload('New local analysis'));
  assert.equal(harness.canPersistCurrentJDAnalysis(), false);
  const abortedAtDetection = pending.signal.aborted;
  pending.finish();
  assert.equal((await pending.run).status, 'aborted');
  assert.equal(abortedAtDetection, true);
  assert.deepEqual(pending.effects.writes, []);
  assert.equal(harness.cache.payload.result.summary, 'New local analysis');
});

for (const recovery of ['restore', 'discard']) {
  test(`late JD results cannot overwrite the ${recovery} choice, and fresh analysis remains usable`, async () => {
    const { createHarness, runJDAnalysisExecution } = await importRecoveryHarness();
    const harness = createHarness(buildPayload('Server base'));
    const pending = beginDeferredAnalysis(runJDAnalysisExecution, harness);
    harness.injectPending(buildPayload('New local analysis'));
    assert.equal(harness.canPersistCurrentJDAnalysis(), false);
    assert.equal(harness[recovery](), true);
    assert.equal(harness.canPersistCurrentJDAnalysis(), true);
    const expectedSummary = recovery === 'restore' ? 'New local analysis' : 'Server base';
    assert.equal(harness.current.result.summary, expectedSummary);

    // A provider may still resolve after abort, so verify no unsafe side effect.
    pending.finish();
    assert.equal((await pending.run).status, 'aborted');
    assert.deepEqual(pending.effects.scores, []);
    assert.deepEqual(pending.effects.writes, []);
    assert.deepEqual(pending.effects.completions, []);
    assert.equal(harness.current.result.summary, expectedSummary);
    assert.equal(harness.cache?.payload.result.summary ?? null,
      recovery === 'restore' ? 'New local analysis' : null);

    const fresh = beginDeferredAnalysis(runJDAnalysisExecution, harness);
    fresh.finish('Fresh response');
    assert.equal((await fresh.run).status, 'success');
    assert.equal(fresh.effects.writes.length, 1);
    assert.equal(fresh.effects.writes[0].result.summary, 'Fresh response');
  });
}
