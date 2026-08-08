import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
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

test('merges only authoritative stale flags from a differing backend payload', async () => {
  const { mergeAuthoritativeStaleFlags } = await importJDAnalysisPersistenceUtils();
  const local = {
    jdText: 'local JD',
    jdInputSignature: 'local-jd',
    experienceSignature: 'local-experience',
    result: buildResult(),
    itemSignatures: buildItemSignatures(),
    inputMode: 'text',
    isOutdated: false,
    evaluationIsOutdated: false,
    updatedAt: '2026-08-08T00:00:00.000Z',
  };

  assert.deepEqual(
    mergeAuthoritativeStaleFlags(local, {
      ...local,
      jdText: 'older backend JD',
      isOutdated: true,
      evaluationIsOutdated: true,
    }),
    {
      ...local,
      isOutdated: true,
      evaluationIsOutdated: true,
    }
  );
  assert.equal(
    mergeAuthoritativeStaleFlags(
      { ...local, isOutdated: true, evaluationIsOutdated: true },
      { ...local, isOutdated: false, evaluationIsOutdated: false }
    ),
    null
  );
});

test('keeps a pending local snapshot stable until it is synchronized', async () => {
  const { mergeAuthoritativeStaleFlags } = await importJDAnalysisPersistenceUtils();
  const local = {
    jdText: 'local JD',
    jdInputSignature: 'local-jd',
    experienceSignature: 'local-experience',
    result: buildResult(),
    itemSignatures: buildItemSignatures(),
    inputMode: 'text',
    isOutdated: false,
    evaluationIsOutdated: true,
    updatedAt: '2026-08-08T00:00:00.000Z',
  };
  const backend = {
    ...local,
    isOutdated: true,
    evaluationIsOutdated: true,
  };

  assert.equal(mergeAuthoritativeStaleFlags(local, backend, { localPendingSync: true }), null);
});

test('keeps a pending snapshot only while the backend is still its base snapshot', async () => {
  const { shouldKeepPendingLocalSnapshot } = await importJDAnalysisPersistenceUtils();

  assert.equal(shouldKeepPendingLocalSnapshot({
    pendingSync: true,
    basePersistedFingerprint: 'backend-v1',
    backendPersistedFingerprint: 'backend-v1',
  }), true);
  assert.equal(shouldKeepPendingLocalSnapshot({
    pendingSync: true,
    basePersistedFingerprint: 'backend-v1',
    backendPersistedFingerprint: 'backend-v2',
  }), false);
  assert.equal(shouldKeepPendingLocalSnapshot({
    pendingSync: false,
    basePersistedFingerprint: 'backend-v1',
    backendPersistedFingerprint: 'backend-v1',
  }), false);
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
