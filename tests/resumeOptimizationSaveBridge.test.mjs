import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { transform } from 'esbuild';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const importMarkedHelpers = async (path, startMarker, endMarker) => {
  const source = read(path);
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);
  assert.ok(start >= 0 && end > start, `${path} must expose the marked testable bridge`);
  const snippet = source.slice(start + startMarker.length, end);
  const result = await transform(snippet, { loader: 'ts', format: 'esm' });
  return import(`data:text/javascript;base64,${Buffer.from(result.code).toString('base64')}#${Math.random()}`);
};

test('save bridge reads the latest ref, returns the new token, and rejects a drain conflict', async () => {
  const {
    assertReloadConflictEpochCurrent,
    resolveCommittedResumeSaveToken,
    selectResumeConfigForFlush,
  } = await importMarkedHelpers(
    'hooks/useResumeData.ts',
    '// RESUME_OPTIMIZATION_SAVE_BRIDGE_START',
    '// RESUME_OPTIMIZATION_SAVE_BRIDGE_END',
  );

  const latest = { current: { value: 'v1' } };
  const oldClosureSnapshot = latest.current;
  latest.current = { value: 'v2-with-persisted-evaluation' };
  assert.deepEqual(selectResumeConfigForFlush(undefined, latest), latest.current);
  assert.notEqual(selectResumeConfigForFlush(undefined, latest), oldClosureSnapshot);
  assert.deepEqual(selectResumeConfigForFlush({ value: 'override' }, latest), { value: 'override' });
  assert.doesNotThrow(() => assertReloadConflictEpochCurrent(2, 2));
  assert.throws(() => assertReloadConflictEpochCurrent(2, 3), /conflict/i);
  assert.equal(resolveCommittedResumeSaveToken({
    requestedResumeId: 'resume-a',
    currentResumeId: 'resume-a',
    requestedConfigSignature: 'config-a',
    lastSavedConfigSignature: 'config-a',
    previousUpdatedAt: 'v1',
    currentUpdatedAt: 'v2',
    isHydrated: true,
  }), 'v2');
  for (const invalidReceipt of [
    { currentResumeId: 'resume-b' },
    { lastSavedConfigSignature: 'config-b' },
    { currentUpdatedAt: 'v1' },
    { isHydrated: false },
  ]) {
    assert.equal(resolveCommittedResumeSaveToken({
      requestedResumeId: 'resume-a',
      currentResumeId: 'resume-a',
      requestedConfigSignature: 'config-a',
      lastSavedConfigSignature: 'config-a',
      previousUpdatedAt: 'v1',
      currentUpdatedAt: 'v2',
      isHydrated: true,
      ...invalidReceipt,
    }), undefined);
  }
});

test('useResumeData places the conflict barrier before hydration setters and flushes the latest config', () => {
  const source = read('hooks/useResumeData.ts');
  const loader = source.slice(
    source.indexOf('const useResumeContextLoader'),
    source.indexOf('const useResumeState'),
  );
  const drainIndex = loader.indexOf('await waitForPendingResumeSaves()');
  const epochIndex = loader.indexOf('const conflictEpochAtStart = getResumeVersionConflictEpoch()');
  const authCaptureIndex = loader.indexOf('await captureResumeAuthCacheKey');
  const barrierIndex = loader.indexOf('assertReloadConflictEpochCurrent', drainIndex);
  const applyIndex = loader.indexOf('applyResumeConfig(', drainIndex);
  assert.ok(epochIndex >= 0 && epochIndex < authCaptureIndex);
  assert.ok(drainIndex >= 0 && drainIndex < barrierIndex && barrierIndex < applyIndex);

  const flusher = source.slice(
    source.indexOf('const useResumeConfigFlusher'),
    source.indexOf('export const useResumeData'),
  );
  assert.match(flusher, /selectResumeConfigForFlush\(configOverride, latestConfigSnapshotRef\)/);
  assert.match(flusher, /const committedUpdatedAt = await saveResumeConfig/);
  assert.match(flusher, /if \(!committedUpdatedAt\)/);
  assert.match(flusher, /return committedUpdatedAt/);
  assert.doesNotMatch(flusher, /resumeUpdatedAtRef/);
  assert.match(source, /useResumeConfigFlusher\(\s*latestEffectiveConfigSnapshotRef/);
  assert.match(source, /flushResumeConfig: \(configOverride\?: ResumeEditorConfig\) => Promise<string \| undefined>/);
  assert.match(source, /resolveCommittedResumeSaveToken\(/);
});

test('local resume evaluation removes inherited agent attestation without mutating the source', async () => {
  const { stripLocalEvaluationAttestation } = await importMarkedHelpers(
    'hooks/useJDAnalysis.ts',
    '// LOCAL_EVALUATION_ATTESTATION_BRIDGE_START',
    '// LOCAL_EVALUATION_ATTESTATION_BRIDGE_END',
  );
  const source = {
    evaluationSignatureVersion: 'agent_final_snapshot_v1',
    analysisSignatureVersion: 'agent_final_snapshot_v1',
    evaluationSignature: 'agent-signature',
    result: { resumeEvaluation: { overallScore: 50 } },
  };

  const stripped = stripLocalEvaluationAttestation(source);

  assert.equal('evaluationSignatureVersion' in stripped, false);
  assert.equal(stripped.analysisSignatureVersion, 'agent_final_snapshot_v1');
  assert.equal(source.evaluationSignatureVersion, 'agent_final_snapshot_v1');
  const hook = read('hooks/useJDAnalysis.ts');
  const persistBlock = hook.slice(
    hook.indexOf('const persistResumeEvaluation'),
    hook.indexOf('const getAnalysisSnapshot'),
  );
  assert.match(persistBlock, /stripLocalEvaluationAttestation\(currentPersisted\)/);
});
