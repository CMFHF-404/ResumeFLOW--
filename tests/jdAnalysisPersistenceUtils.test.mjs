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
    updatedAt: '2026-06-06T00:00:00.000Z',
  });
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
