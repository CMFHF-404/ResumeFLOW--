import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import { build } from 'esbuild';

const importJDAnalysisRequestRunner = async () => {
  const result = await build({
    entryPoints: ['hooks/jdAnalysisRequestRunner.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    define: {
      'import.meta.env.DEV': 'false',
      'import.meta.env.VITE_API_BASE_URL': '""',
      'import.meta.env.VITE_LOGTO_APP_ID': 'undefined',
      'import.meta.env.VITE_LOGTO_RESOURCE': 'undefined',
    },
  });
  const source = result.outputFiles[0].text;
  const encoded = Buffer.from(source).toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
};

const buildSnapshot = (overrides = {}) => ({
  experiences: [
    {
      id: 'exp-1',
      title: 'Product Manager',
      company: 'Acme',
      category: 'work',
      startDate: '2025-01',
      endDate: '2025-12',
      star: { s: 'S', t: 'T', a: 'A', r: 'R' },
    },
  ],
  certifications: [
    {
      id: 'cert-1',
      name: 'PMP',
      issuer: 'PMI',
      date: '2025-02',
    },
  ],
  skillGroups: [
    {
      id: 'group-1',
      name: 'Product',
      skills: [{ id: 'skill-1', name: 'Roadmap' }],
    },
  ],
  jdText: 'JD text',
  jdFile: null,
  attachmentExtractedText: null,
  itemSignatures: {
    experiences: { 'exp-1': 'old-exp' },
    certifications: { 'cert-1': 'old-cert' },
    skills: { 'skill-1': 'old-skill' },
  },
  experienceSignature: 'experience-signature',
  jdInputSignature: 'jd-signature',
  experienceText: '{"experiences":[]}',
  inputMode: 'text',
  ...overrides,
});

const buildResult = (overrides = {}) => ({
  matchPercentage: 80,
  jobKeywords: ['product'],
  missingKeywords: [],
  summary: 'Matched',
  ...overrides,
});

test('runs text JD analysis with full payload and forwards stream events', async () => {
  const { runJDAnalysisRequest } = await importJDAnalysisRequestRunner();
  const calls = [];
  const events = [];
  const progress = [];
  const service = {
    analyzeJD: async (params, onEvent) => {
      calls.push(params);
      onEvent?.({ type: 'progress', node: 'request_ai', title: 'Requesting AI' });
      return buildResult();
    },
    analyzeJDWithAttachment: async () => {
      throw new Error('attachment path should not be used');
    },
  };

  const output = await runJDAnalysisRequest({
    snapshot: buildSnapshot(),
    mode: 'full',
    analysisContext: null,
    analysisResult: null,
    service,
    onProgress: (node) => progress.push(node),
    onEvent: (event) => events.push(event),
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].text, 'JD text');
  assert.equal(calls[0].experienceText, '{"experiences":[]}');
  assert.equal(calls[0].prevResult, undefined);
  assert.equal(calls[0].prevExperienceText, undefined);
  assert.match(calls[0].resumeText, /"experiences"/);
  assert.match(calls[0].resumeText, /"certifications"/);
  assert.match(calls[0].resumeText, /"skills"/);
  assert.deepEqual(progress, ['request_ai']);
  assert.deepEqual(events.map((event) => event.type), ['progress']);
  assert.equal(output.currentFile, null);
  assert.equal(output.shouldUsePrev, false);
  assert.equal(output.shouldPersistAttachmentAsText, false);
});

test('runs attachment JD analysis with supplemental text and persisted extracted text flag', async () => {
  const { runJDAnalysisRequest } = await importJDAnalysisRequestRunner();
  const file = { name: 'jd.pdf', size: 10, lastModified: 1, type: 'application/pdf' };
  const extracted = 'Extracted JD';
  const calls = [];
  const service = {
    analyzeJD: async () => {
      throw new Error('text path should not be used');
    },
    analyzeJDWithAttachment: async (params) => {
      calls.push(params);
      return buildResult({ extractedJdText: ` ${extracted} ` });
    },
  };

  const output = await runJDAnalysisRequest({
    snapshot: buildSnapshot({
      jdFile: file,
      inputMode: 'attachment',
      attachmentName: 'jd.pdf',
      attachmentExtractedText: extracted,
      jdText: `${extracted}\n\n补充 JD 说明：\nSupplement`,
    }),
    mode: 'full',
    analysisContext: null,
    analysisResult: null,
    service,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, file);
  assert.equal(calls[0].jdText, 'Supplement');
  assert.equal(calls[0].experienceText, '{"experiences":[]}');
  assert.equal(calls[0].prevResult, undefined);
  assert.equal(output.currentFile, file);
  assert.equal(output.attachmentSupplementalJdText, 'Supplement');
  assert.equal(output.extractedAttachmentText, extracted);
  assert.equal(output.shouldPersistAttachmentAsText, true);
});

test('partial analysis sends previous result only when context and result are available', async () => {
  const { runJDAnalysisRequest } = await importJDAnalysisRequestRunner();
  const calls = [];
  const service = {
    analyzeJD: async (params) => {
      calls.push(params);
      return buildResult();
    },
    analyzeJDWithAttachment: async () => {
      throw new Error('attachment path should not be used');
    },
  };

  const output = await runJDAnalysisRequest({
    snapshot: buildSnapshot(),
    mode: 'partial',
    analysisContext: {
      jdInputSignature: 'jd-signature',
      experienceSignature: 'experience-signature',
      itemSignatures: buildSnapshot().itemSignatures,
      experienceText: 'previous-experience-text',
    },
    analysisResult: buildResult({
      matchPercentage: 72,
      capabilityAnalysis: { roleFamily: 'PM' },
      experienceMatches: [
        { id: 'exp-1', score: 66, reason: 'ok' },
        { id: 'exp-2', score: undefined, reason: 'ignored' },
      ],
      certificationMatches: [{ id: 'cert-1', score: 40 }],
      skillMatches: [{ id: 'skill-1', score: 88 }],
    }),
    service,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].prevExperienceText, 'previous-experience-text');
  assert.deepEqual(calls[0].prevResult, {
    matchPercentage: 72,
    capabilityAnalysis: { roleFamily: 'PM' },
    experienceMatches: [{ id: 'exp-1', score: 66 }],
    certificationMatches: [{ id: 'cert-1', score: 40 }],
    skillMatches: [{ id: 'skill-1', score: 88 }],
  });
  assert.equal(output.shouldUsePrev, true);
  assert.equal(output.prevExperienceText, 'previous-experience-text');
});
