import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';

const importJDAnalysisPersistenceUtils = async () => {
  const result = await build({
    entryPoints: ['hooks/jdAnalysisPersistenceUtils.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const source = result.outputFiles[0].text;
  const encoded = Buffer.from(source).toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
};

const importJDAnalysisStorage = async () => {
  const result = await build({
    entryPoints: ['views/jdAnalysisStorage.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const encoded = Buffer.from(result.outputFiles[0].text).toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
};

const buildResult = () => ({
  matchPercentage: 80,
  jobKeywords: ['product'],
  missingKeywords: [],
  summary: 'Matched',
});

const buildItemSignatures = () => ({
  experiences: { 'exp-1': 'exp-sig' },
  certifications: { 'cert-1': 'cert-sig' },
  skills: { 'skill-1': 'skill-sig' },
});

test('normalizes persisted analysis with fallback item signatures and input signature', async () => {
  const { normalizePersistedAnalysisForState } = await importJDAnalysisPersistenceUtils();
  const fallback = buildItemSignatures();

  const normalized = normalizePersistedAnalysisForState(
    {
      jdText: 'JD text',
      jdInputSignature: '',
      experienceSignature: 'experience-signature',
      result: buildResult(),
      itemSignatures: undefined,
      experienceText: 'experience-text',
      inputMode: 'attachment',
      attachmentName: 'jd.pdf',
      updatedAt: '2026-06-06T00:00:00.000Z',
    },
    fallback
  );

  assert.notEqual(normalized.jdInputSignature, '');
  assert.deepEqual(normalized.itemSignatures, fallback);
  assert.equal(normalized.inputMode, 'attachment');
  assert.equal(normalized.attachmentName, 'jd.pdf');
});

test('builds resume JD analysis payload with stable timestamp injection', async () => {
  const { buildResumeJDAnalysisPayload } = await importJDAnalysisPersistenceUtils();
  const itemSignatures = buildItemSignatures();

  const payload = buildResumeJDAnalysisPayload(
    {
      jdText: 'JD text',
      jdInputSignature: 'jd-signature',
      experienceSignature: 'experience-signature',
      result: buildResult(),
      itemSignatures,
      experienceText: 'experience-text',
      inputMode: 'text',
      attachmentExtractedText: 'previous extracted text',
    },
    '2026-06-06T00:00:00.000Z'
  );

  assert.deepEqual(payload, {
    jdText: 'JD text',
    jdInputSignature: 'jd-signature',
    experienceSignature: 'experience-signature',
    result: buildResult(),
    itemSignatures,
    experienceText: 'experience-text',
    inputMode: 'text',
    attachmentName: undefined,
    attachmentExtractedText: 'previous extracted text',
    isOutdated: false,
    updatedAt: '2026-06-06T00:00:00.000Z',
  });
});

test('hydrates a fresh Agent final-snapshot evaluation against the current client snapshot', async () => {
  const { resolveHydratedEvaluationSignature } = await importJDAnalysisPersistenceUtils();
  const base = {
    jdText: 'JD text',
    jdInputSignature: 'jd-signature',
    experienceSignature: 'experience-signature',
    evaluationSignature: 'python-canonical-signature',
    evaluationSignatureVersion: 'agent_final_snapshot_v1',
    isOutdated: false,
    evaluationIsOutdated: false,
    result: buildResult(),
    itemSignatures: buildItemSignatures(),
    inputMode: 'text',
    updatedAt: '2026-08-08T00:00:00.000Z',
  };

  assert.equal(
    resolveHydratedEvaluationSignature(base, 'client-current-signature'),
    'client-current-signature'
  );
  assert.equal(
    resolveHydratedEvaluationSignature(
      { ...base, evaluationIsOutdated: true },
      'client-current-signature'
    ),
    'python-canonical-signature'
  );
  assert.equal(
    resolveHydratedEvaluationSignature(
      { ...base, evaluationIsOutdated: undefined },
      'client-current-signature'
    ),
    'python-canonical-signature'
  );
});

test('hydrates a fresh Agent final-snapshot JD analysis against current candidate signatures', async () => {
  const { resolveHydratedAnalysisCandidate } = await importJDAnalysisPersistenceUtils();
  const { normalizeJDAnalysisPersistence } = await importJDAnalysisStorage();
  const currentItems = buildItemSignatures();
  const base = {
    jdText: 'JD text',
    jdInputSignature: 'jd-signature',
    experienceSignature: 'python-result-hash',
    analysisSignatureVersion: 'agent_final_snapshot_v1',
    isOutdated: false,
    result: buildResult(),
    itemSignatures: { experiences: {}, certifications: {}, skills: {} },
    inputMode: 'text',
    updatedAt: '2026-08-08T00:00:00.000Z',
  };
  const normalizedBase = normalizeJDAnalysisPersistence(base);
  assert.ok(normalizedBase);

  assert.deepEqual(
    resolveHydratedAnalysisCandidate(normalizedBase, 'client-candidate-signature', currentItems),
    {
      experienceSignature: 'client-candidate-signature',
      itemSignatures: currentItems,
    }
  );
  assert.deepEqual(
    resolveHydratedAnalysisCandidate(
      { ...normalizedBase, isOutdated: true },
      'client-candidate-signature',
      currentItems
    ),
    {
      experienceSignature: 'python-result-hash',
      itemSignatures: base.itemSignatures,
    }
  );
});

test('keeps a pending local snapshot only while the backend is still its base', async () => {
  const {
    buildJDAnalysisPersistenceFingerprint,
    selectPreferredPersistedJDAnalysis,
  } = await importJDAnalysisStorage();
  const backend = {
    jdText: 'backend JD',
    jdInputSignature: 'backend-jd',
    experienceSignature: 'backend-experience',
    result: buildResult(),
    itemSignatures: buildItemSignatures(),
    inputMode: 'text',
    updatedAt: '2026-08-08T00:00:00.000Z',
  };
  const local = { ...backend, jdText: 'local JD', updatedAt: '2026-08-09T00:00:00.000Z' };
  const decision = selectPreferredPersistedJDAnalysis(backend, {
    payload: local,
    pendingSync: true,
    basePersistedFingerprint: buildJDAnalysisPersistenceFingerprint(backend),
  });

  assert.equal(decision.kind, 'keep_pending_local');
  assert.equal(decision.payload, local);
  assert.equal(decision.shouldKeepLocalPendingSync, true);
});

test('adopts a changed backend instead of rebasing an old local payload onto it', async () => {
  const {
    buildJDAnalysisPersistenceFingerprint,
    selectPreferredPersistedJDAnalysis,
  } = await importJDAnalysisStorage();
  const backendV1 = {
    jdText: 'backend v1',
    jdInputSignature: 'backend-v1',
    experienceSignature: 'experience-v1',
    result: buildResult(),
    itemSignatures: buildItemSignatures(),
    inputMode: 'text',
    updatedAt: '2026-08-08T00:00:00.000Z',
  };
  const backendV2 = {
    ...backendV1,
    jdText: 'backend v2',
    jdInputSignature: 'backend-v2',
    updatedAt: '2026-08-10T00:00:00.000Z',
  };
  const local = {
    ...backendV1,
    jdText: 'stale local payload',
    updatedAt: '2026-08-09T00:00:00.000Z',
  };
  const decision = selectPreferredPersistedJDAnalysis(backendV2, {
    payload: local,
    pendingSync: true,
    basePersistedFingerprint: buildJDAnalysisPersistenceFingerprint(backendV1),
  });

  assert.equal(decision.kind, 'adopt_backend');
  assert.equal(decision.payload, backendV2);
  assert.equal(decision.shouldKeepLocalPendingSync, false);
  assert.equal(
    decision.basePersistedFingerprint,
    buildJDAnalysisPersistenceFingerprint(backendV2),
  );
});

test('marks matching backend and cache payloads as synchronized', async () => {
  const {
    buildJDAnalysisPersistenceFingerprint,
    selectPreferredPersistedJDAnalysis,
  } = await importJDAnalysisStorage();
  const backend = {
    jdText: 'backend JD',
    jdInputSignature: 'backend-jd',
    experienceSignature: 'backend-experience',
    result: buildResult(),
    itemSignatures: buildItemSignatures(),
    inputMode: 'text',
    updatedAt: '2026-08-08T00:00:00.000Z',
  };
  const decision = selectPreferredPersistedJDAnalysis(backend, {
    payload: { ...backend },
    pendingSync: false,
    basePersistedFingerprint: buildJDAnalysisPersistenceFingerprint(backend),
  });

  assert.equal(decision.kind, 'in_sync');
  assert.equal(decision.payload, backend);
});

test('adopts an analysis that arrives after an initially empty backend', async () => {
  const { selectPreferredPersistedJDAnalysis } = await importJDAnalysisStorage();
  const backend = {
    jdText: 'late backend JD',
    jdInputSignature: 'late-backend-jd',
    experienceSignature: 'late-backend-experience',
    result: buildResult(),
    itemSignatures: buildItemSignatures(),
    inputMode: 'text',
    updatedAt: '2026-08-11T00:00:00.000Z',
  };

  const decision = selectPreferredPersistedJDAnalysis(backend, null);

  assert.equal(decision.kind, 'adopt_backend');
  assert.equal(decision.payload, backend);
});

test('adopts an authoritative empty backend over a non-pending cache', async () => {
  const { selectPreferredPersistedJDAnalysis } = await importJDAnalysisStorage();
  const cached = {
    jdText: 'removed backend JD',
    jdInputSignature: 'removed-backend-jd',
    experienceSignature: 'removed-backend-experience',
    result: buildResult(),
    itemSignatures: buildItemSignatures(),
    inputMode: 'text',
    updatedAt: '2026-08-10T00:00:00.000Z',
  };

  const decision = selectPreferredPersistedJDAnalysis(null, {
    payload: cached,
    pendingSync: false,
    basePersistedFingerprint: null,
  });

  assert.equal(decision.kind, 'adopt_backend_null');
  assert.equal(decision.payload, null);
});

test('keeps a pending local analysis based on an empty backend', async () => {
  const {
    buildJDAnalysisPersistenceFingerprint,
    selectPreferredPersistedJDAnalysis,
  } = await importJDAnalysisStorage();
  const local = {
    jdText: 'first local JD',
    jdInputSignature: 'first-local-jd',
    experienceSignature: 'first-local-experience',
    result: buildResult(),
    itemSignatures: buildItemSignatures(),
    inputMode: 'text',
    updatedAt: '2026-08-11T00:00:00.000Z',
  };

  const decision = selectPreferredPersistedJDAnalysis(null, {
    payload: local,
    pendingSync: true,
    basePersistedFingerprint: buildJDAnalysisPersistenceFingerprint(null),
  });

  assert.equal(decision.kind, 'keep_pending_local');
  assert.equal(decision.payload, local);
  assert.equal(decision.shouldKeepLocalPendingSync, true);
});

test('local writes allow matching in-memory backend state when cache is missing', async () => {
  const {
    buildJDAnalysisPersistenceFingerprint,
    resolveLocalJDAnalysisWriteBase,
  } = await importJDAnalysisStorage();
  const backend = {
    jdText: 'backend JD',
    jdInputSignature: 'backend-jd',
    experienceSignature: 'backend-experience',
    result: buildResult(),
    itemSignatures: buildItemSignatures(),
    inputMode: 'text',
    updatedAt: '2026-08-12T00:00:00.000Z',
  };

  assert.equal(
    resolveLocalJDAnalysisWriteBase(backend, null, { ...backend }),
    buildJDAnalysisPersistenceFingerprint(backend),
  );
});

test('local writes protect a newer pending cache from older in-memory backend state', async () => {
  const {
    buildJDAnalysisPersistenceFingerprint,
    resolveLocalJDAnalysisWriteBase,
  } = await importJDAnalysisStorage();
  const backend = {
    jdText: 'backend JD',
    jdInputSignature: 'backend-jd',
    experienceSignature: 'backend-experience',
    result: buildResult(),
    itemSignatures: buildItemSignatures(),
    inputMode: 'text',
    updatedAt: '2026-08-12T00:00:00.000Z',
  };
  const pendingLocal = {
    ...backend,
    jdText: 'newer tab analysis',
    jdInputSignature: 'newer-tab-jd',
    updatedAt: '2026-08-13T00:00:00.000Z',
  };
  const cache = {
    payload: pendingLocal,
    pendingSync: true,
    basePersistedFingerprint: buildJDAnalysisPersistenceFingerprint(backend),
  };

  assert.equal(resolveLocalJDAnalysisWriteBase(backend, cache, backend), undefined);
  assert.equal(
    resolveLocalJDAnalysisWriteBase(backend, cache, pendingLocal),
    buildJDAnalysisPersistenceFingerprint(backend),
  );
});

test('local writes reject stale in-memory state when the backend changed', async () => {
  const { resolveLocalJDAnalysisWriteBase } = await importJDAnalysisStorage();
  const backendV1 = {
    jdText: 'backend v1',
    jdInputSignature: 'backend-v1',
    experienceSignature: 'experience-v1',
    result: buildResult(),
    itemSignatures: buildItemSignatures(),
    inputMode: 'text',
    updatedAt: '2026-08-11T00:00:00.000Z',
  };
  const backendV2 = {
    ...backendV1,
    jdText: 'backend v2',
    jdInputSignature: 'backend-v2',
    updatedAt: '2026-08-12T00:00:00.000Z',
  };

  assert.equal(resolveLocalJDAnalysisWriteBase(backendV2, null, backendV1), undefined);
});

test('local writes allow an authoritative empty backend over a stale cache', async () => {
  const {
    buildJDAnalysisPersistenceFingerprint,
    resolveLocalJDAnalysisWriteBase,
  } = await importJDAnalysisStorage();
  const staleCache = {
    jdText: 'stale cached JD',
    jdInputSignature: 'stale-cache-jd',
    experienceSignature: 'stale-cache-experience',
    result: buildResult(),
    itemSignatures: buildItemSignatures(),
    inputMode: 'text',
    updatedAt: '2026-08-11T00:00:00.000Z',
  };

  assert.equal(
    resolveLocalJDAnalysisWriteBase(null, {
      payload: staleCache,
      pendingSync: false,
      basePersistedFingerprint: null,
    }, null),
    buildJDAnalysisPersistenceFingerprint(null),
  );
});

test('live backend reconciliation invalidates active work before adopting the shared decision', () => {
  const source = readFileSync('hooks/useJDAnalysis.ts', 'utf8');
  const start = source.indexOf('const reconciliation = selectPreferredPersistedJDAnalysis');
  const end = source.indexOf('saveJDAnalysisCache(resumeId, reconciledPayload', start);
  const reconciliationBlock = source.slice(start, end);

  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  assert.match(reconciliationBlock, /reconciliation\.kind === "keep_pending_local"/);
  assert.match(
    reconciliationBlock,
    /normalizePersistedAnalysisForState\([\s\S]*reconciliation\.payload/,
  );
  assert.match(reconciliationBlock, /invalidateAnalysisRun\(\);/);
  assert.match(
    reconciliationBlock,
    /applyPersistedAnalysisState\(reconciliation\.payload\)/,
  );
  assert.ok(
    reconciliationBlock.indexOf('invalidateAnalysisRun();')
      < reconciliationBlock.indexOf('applyPersistedAnalysisState(reconciliation.payload)'),
  );
  assert.doesNotMatch(source, /mergeAuthoritativeStaleFlags|shouldKeepPendingLocalSnapshot/);
  assert.match(
    source,
    /normalizeJDAnalysisPersistence\(\s*persistedJDAnalysisConfigRef\.current\s*\)/,
  );
  assert.match(source, /analysisContextRef\.current\?\.evaluationSignature/);
  const staleFlagEffect = source.slice(
    source.indexOf('const basePersistedFingerprint = resolveLocalAnalysisWriteBase'),
    source.indexOf('const applyPersistedAnalysisState'),
  );
  assert.match(
    staleFlagEffect,
    /if \(basePersistedFingerprint === undefined\) \{\s*return;\s*\}/,
  );
  assert.ok(
    staleFlagEffect.indexOf('basePersistedFingerprint === undefined')
      < staleFlagEffect.indexOf('setPersistedJDAnalysis(nextPersistedJDAnalysis)'),
  );
  const executionCallStart = source.indexOf(
    'const outcome = await runJDAnalysisExecution({',
  );
  const executionCall = source.slice(
    executionCallStart,
    source.indexOf('return outcome;', executionCallStart),
  );
  assert.match(executionCall, /canApplyAnalysisResult,/);
});

test('resolves attachment analysis with extracted text as text-mode persisted JD', async () => {
  const { resolvePersistedAttachmentFields } = await importJDAnalysisPersistenceUtils();

  const fields = resolvePersistedAttachmentFields({
    snapshot: {
      jdText: 'Original JD text',
      jdInputSignature: 'attachment-signature',
      inputMode: 'attachment',
      attachmentName: 'jd.pdf',
      attachmentExtractedText: undefined,
    },
    hasCurrentFile: true,
    attachmentSupplementalJdText: ' Supplement ',
    extractedAttachmentText: 'Extracted JD',
    shouldPersistAttachmentAsText: true,
  });

  assert.equal(fields.jdText, 'Extracted JD\n\n补充 JD 说明：\nSupplement');
  assert.equal(fields.inputMode, 'text');
  assert.equal(fields.attachmentName, undefined);
  assert.equal(fields.attachmentExtractedText, 'Extracted JD');
  assert.notEqual(fields.jdInputSignature, 'attachment-signature');
});

test('keeps attachment metadata when extracted text is not promoted to JD text', async () => {
  const { resolvePersistedAttachmentFields } = await importJDAnalysisPersistenceUtils();

  const fields = resolvePersistedAttachmentFields({
    snapshot: {
      jdText: 'Supplement only',
      jdInputSignature: 'attachment-signature',
      inputMode: 'attachment',
      attachmentName: 'jd.pdf',
      attachmentExtractedText: 'Old extracted text',
    },
    hasCurrentFile: true,
    attachmentSupplementalJdText: 'Supplement only',
    extractedAttachmentText: '',
    shouldPersistAttachmentAsText: false,
  });

  assert.deepEqual(fields, {
    jdText: 'Supplement only',
    jdInputSignature: 'attachment-signature',
    inputMode: 'attachment',
    attachmentName: 'jd.pdf',
    attachmentExtractedText: undefined,
  });
});
