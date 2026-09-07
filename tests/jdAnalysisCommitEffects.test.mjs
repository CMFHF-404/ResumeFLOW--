import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
import { build } from 'esbuild';

const importCommitHarness = async () => {
  const source = readFileSync('hooks/useJDAnalysis.ts', 'utf8');
  const ast = ts.createSourceFile('hook.ts', source, ts.ScriptTarget.Latest, true);
  const callbacks = [];
  const visit = (node) => {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect') {
      const callback = node.arguments[0].getText(ast);
      if (['const nextPersistedJDAnalysis:', 'const preferredPersistedState =',
        'const reconciliation ='].some((marker) => callback.includes(marker))) {
        callbacks.push(callback);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.equal(callbacks.length, 3, 'retain the real write, hydration and reconciliation effects');
  const authority = source.slice(source.indexOf('  const resolveLocalAnalysisWriteBase ='),
    source.indexOf('  const canApplyAnalysisResult ='));
  const built = await build({
    stdin: {
      loader: 'ts', resolveDir: process.cwd(), contents: `
        import {
          normalizeJDAnalysisPersistence, buildJDAnalysisPersistenceFingerprint,
          selectPreferredPersistedJDAnalysis, resolveLocalJDAnalysisWriteBase,
        } from './services/jdAnalysisStorage';
        import { normalizePersistedAnalysisForState } from './hooks/jdAnalysisPersistenceUtils';
        import { arePersistedJDAnalysisEqual, buildEmptyJDItemSignatures }
          from './hooks/jdAnalysisSignatureUtils';
        export { runJDAnalysisExecution } from './hooks/useJDAnalysisExecution';
        export function createHarness(rawBackend, { hydrate = false, pending = null,
          pendingBase = rawBackend, isOutdated = false, isEvaluationOutdated = false } = {}) {
          const backend = normalizeJDAnalysisPersistence(rawBackend);
          const persistedJDAnalysis = hydrate ? undefined : backend;
          const persistedJDAnalysisConfig = backend;
          const persistedJDAnalysisRef = { current: persistedJDAnalysis };
          const persistedJDAnalysisConfigRef = { current: backend };
          const resumeId = 'resume-1', authUserKey = 'owner-1';
          const analysisIdentity = 'owner-1:resume-1', isAnalysisStateCurrent = true;
          const activeResumeIdRef = { current: resumeId };
          const activeAnalysisIdentityRef = { current: analysisIdentity };
          const pendingJDAnalysisConflictRef = { current: null };
          const hasLoadedJdCacheRef = { current: !hydrate };
          const isLoadingResume = false, isLoadingExperiences = false;
          const useCallback = callback => callback;
          const devLog = () => {};
          let invalidations = 0, nextState = persistedJDAnalysis;
          let cache = {
            payload: normalizeJDAnalysisPersistence(pending ?? rawBackend),
            pendingSync: Boolean(pending),
            basePersistedFingerprint: buildJDAnalysisPersistenceFingerprint(
              normalizeJDAnalysisPersistence(pendingBase)),
          };
          // A setter schedules the next render; this commit's captured state stays old.
          const setPersistedJDAnalysis = payload => { nextState = payload; };
          const loadJDAnalysisCache = () => cache;
          const saveJDAnalysisCache = (_owner, _id, payload, options) => {
            cache = { payload: normalizeJDAnalysisPersistence(payload), ...options };
          };
          const clearJDAnalysisCache = () => { cache = null; };
          const applyPersistedAnalysisState = payload => {
            const normalized = normalizePersistedAnalysisForState(payload, buildEmptyJDItemSignatures());
            persistedJDAnalysisRef.current = normalized;
            setPersistedJDAnalysis(normalized);
            return normalized;
          };
          const publishPendingJDAnalysisConflict = conflict => {
            pendingJDAnalysisConflictRef.current = conflict;
          };
          const invalidateAnalysisRun = () => { invalidations += 1; };
          const resetJDAnalysisState = () => {};
          ${authority}
          return {
            canPersistCurrentJDAnalysis,
            flushCommit() { ${callbacks.map(callback => `(${callback})();`).join('\n')} },
            get conflict() { return pendingJDAnalysisConflictRef.current; },
            get cache() { return cache; },
            get current() { return persistedJDAnalysisRef.current; },
            get nextState() { return nextState; },
            get invalidations() { return invalidations; },
          };
        }
      `,
    },
    bundle: true, platform: 'node', format: 'esm', write: false,
    define: { 'import.meta.env.DEV': 'false', 'import.meta.env.VITE_API_BASE_URL': '""',
      'import.meta.env.VITE_LOGTO_APP_ID': 'undefined' },
  });
  return import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
};

const payload = (summary) => ({
  jdText: 'Same JD', jdInputSignature: 'same-jd', experienceSignature: 'same-resume',
  inputMode: 'text', isOutdated: false, evaluationIsOutdated: false,
  result: { matchPercentage: 80, jobKeywords: [], missingKeywords: [], summary },
  itemSignatures: { experiences: {}, certifications: {}, skills: {} },
});

test('same-base pending hydration is usable before React commits the scheduled state', async () => {
  const { createHarness } = await importCommitHarness();
  const harness = createHarness(payload('Server'), { hydrate: true, pending: payload('Local') });
  harness.flushCommit();
  assert.equal(harness.nextState.result.summary, 'Local');
  assert.equal(harness.cache.pendingSync, true);
  assert.equal(harness.conflict, null);
  assert.equal(harness.invalidations, 0);
  assert.equal(harness.canPersistCurrentJDAnalysis(), true);
});

test('own outdated-marker write does not conflict with the old render snapshot', async () => {
  const { createHarness } = await importCommitHarness();
  const harness = createHarness(payload('Server'), { isEvaluationOutdated: true });
  harness.flushCommit();
  assert.equal(harness.nextState.evaluationIsOutdated, true);
  assert.equal(harness.cache.payload.evaluationIsOutdated, true);
  assert.equal(harness.conflict, null);
  assert.equal(harness.invalidations, 0);
  assert.equal(harness.canPersistCurrentJDAnalysis(), true);
});

for (const divergentBase of [false, true]) {
  test(`a foreign pending write still blocks before provider invocation (divergent base: ${divergentBase})`, async () => {
    const { createHarness, runJDAnalysisExecution } = await importCommitHarness();
    const harness = createHarness(payload('Server'), {
      pending: payload('Another page'),
      pendingBase: payload(divergentBase ? 'Older server' : 'Server'),
      isEvaluationOutdated: true,
    });
    harness.flushCommit();
    assert.ok(harness.conflict);
    assert.equal(harness.cache.payload.result.summary, 'Another page');
    assert.equal(harness.canPersistCurrentJDAnalysis(), false);
    let providerCalls = 0;
    const outcome = await runJDAnalysisExecution({
      canApplyAnalysisResult: harness.canPersistCurrentJDAnalysis,
      requestRunner: () => { providerCalls += 1; throw new Error('must not call provider'); },
    });
    assert.equal(outcome.status, 'aborted');
    assert.equal(providerCalls, 0);
  });
}
