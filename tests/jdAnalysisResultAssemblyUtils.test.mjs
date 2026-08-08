import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import { build } from 'esbuild';

const importJDAnalysisResultAssemblyUtils = async () => {
  const result = await build({
    entryPoints: ['hooks/jdAnalysisResultAssemblyUtils.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const source = result.outputFiles[0].text;
  const encoded = Buffer.from(source).toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
};

const diffOf = ({ experiences = [], certifications = [], skills = [] } = {}) => ({
  experiences: new Set(experiences),
  certifications: new Set(certifications),
  skills: new Set(skills),
});

const result = (overrides = {}) => ({
  matchPercentage: 70,
  jobKeywords: ['product'],
  missingKeywords: ['metrics'],
  jobTitle: 'PM',
  company: 'Acme',
  summary: 'Base summary',
  experienceMatches: [
    { id: 'exp-1', score: 60, reason: 'old exp' },
    { id: 'exp-2', score: 50, reason: 'keep exp' },
  ],
  certificationMatches: [{ id: 'cert-1', score: 40 }],
  skillMatches: [{ id: 'skill-1', score: 30 }],
  ...overrides,
});

test('resolves stable diff by subtracting changes that occurred during partial analysis', async () => {
  const { resolveStableAnalysisDiff } = await importJDAnalysisResultAssemblyUtils();

  const stableDiff = resolveStableAnalysisDiff(
    'partial',
    diffOf({ experiences: ['exp-1', 'exp-2'], skills: ['skill-1'] }),
    diffOf({ experiences: ['exp-2'] })
  );

  assert.deepEqual([...stableDiff.experiences], ['exp-1']);
  assert.deepEqual([...stableDiff.skills], ['skill-1']);
});

test('assembles partial result by merging changed targets and stripping their trends', async () => {
  const { assembleJDAnalysisResult } = await importJDAnalysisResultAssemblyUtils();
  const previousResult = result({
    matchPercentage: 70,
    experienceMatches: [
      { id: 'exp-1', score: 60, reason: 'old exp' },
      { id: 'exp-2', score: 50, reason: 'keep exp' },
    ],
  });
  const incomingResult = result({
    matchPercentage: 82,
    summary: 'Updated summary',
    experienceMatches: [
      { id: 'exp-1', score: 90, reason: 'new exp' },
    ],
    skillMatches: [
      { id: 'skill-1', score: 20, reason: 'weaker skill' },
    ],
  });

  const { finalResult, resetTrendBase } = assembleJDAnalysisResult({
    mode: 'partial',
    analysisContext: {
      jdInputSignature: 'jd-signature',
      experienceSignature: 'experience-signature',
      itemSignatures: { experiences: {}, certifications: {}, skills: {} },
      experienceText: 'previous-experience-text',
    },
    previousResult,
    incomingResult,
    stableDiff: diffOf({ experiences: ['exp-1'], skills: ['skill-1'] }),
    currentJdInputSignature: 'jd-signature',
  });

  assert.equal(resetTrendBase, false);
  assert.equal(finalResult.matchPercentage, 82);
  assert.equal(finalResult.matchTrend, 'up');
  assert.deepEqual(finalResult.experienceMatches, [
    { id: 'exp-1', score: 90, reason: 'new exp', trend: undefined },
    { id: 'exp-2', score: 50, reason: 'keep exp', trend: 'same' },
  ]);
  assert.deepEqual(finalResult.skillMatches, [
    { id: 'skill-1', score: 20, reason: 'weaker skill', trend: undefined },
  ]);
});

test('full result resets trend base when JD input signature changed', async () => {
  const { assembleJDAnalysisResult } = await importJDAnalysisResultAssemblyUtils();

  const { finalResult, resetTrendBase } = assembleJDAnalysisResult({
    mode: 'full',
    analysisContext: {
      jdInputSignature: 'old-jd-signature',
      experienceSignature: 'experience-signature',
      itemSignatures: { experiences: {}, certifications: {}, skills: {} },
      experienceText: 'previous-experience-text',
    },
    previousResult: result({ matchPercentage: 50 }),
    incomingResult: result({ matchPercentage: 88 }),
    stableDiff: diffOf(),
    currentJdInputSignature: 'new-jd-signature',
  });

  assert.equal(resetTrendBase, true);
  assert.equal(finalResult.matchPercentage, 88);
  assert.equal(finalResult.matchTrend, undefined);
});

test('full result keeps trend base when JD input signature is unchanged', async () => {
  const { assembleJDAnalysisResult } = await importJDAnalysisResultAssemblyUtils();

  const { finalResult, resetTrendBase } = assembleJDAnalysisResult({
    mode: 'full',
    analysisContext: {
      jdInputSignature: 'jd-signature',
      experienceSignature: 'experience-signature',
      itemSignatures: { experiences: {}, certifications: {}, skills: {} },
      experienceText: 'previous-experience-text',
    },
    previousResult: result({ matchPercentage: 50 }),
    incomingResult: result({ matchPercentage: 88 }),
    stableDiff: diffOf(),
    currentJdInputSignature: 'jd-signature',
  });

  assert.equal(resetTrendBase, false);
  assert.equal(finalResult.matchPercentage, 88);
  assert.equal(finalResult.matchTrend, 'up');
});

test('legacy JD fit is never used as the trend base for the current resume-quality score', async () => {
  const { assembleJDAnalysisResult } = await importJDAnalysisResultAssemblyUtils();

  const { finalResult, resetTrendBase } = assembleJDAnalysisResult({
    mode: 'full',
    analysisContext: {
      jdInputSignature: 'jd-signature',
      experienceSignature: 'experience-signature',
      itemSignatures: { experiences: {}, certifications: {}, skills: {} },
      experienceText: 'previous-experience-text',
    },
    previousResult: result({ matchPercentage: 88 }),
    incomingResult: result({
      matchPercentage: 70,
      resumeEvaluation: {
        evaluationVersion: 'resume_flow_v1',
        overallScore: 70,
        jdMatch: 88,
      },
      experienceMatches: [{ id: 'exp-1', score: 75, reason: 'new exp' }],
    }),
    stableDiff: diffOf(),
    currentJdInputSignature: 'jd-signature',
  });

  assert.equal(resetTrendBase, false);
  assert.equal(finalResult.matchTrend, undefined);
  assert.equal(finalResult.experienceMatches[0].trend, 'up');
});

test('quality-only result updates the six-dimension score and preserves every independent match', async () => {
  const { assembleJDAnalysisResult } = await importJDAnalysisResultAssemblyUtils();
  const previousResult = result({
    matchPercentage: 70,
    resumeEvaluation: { evaluationVersion: 'resume_flow_v1', overallScore: 70, jdMatch: 76 },
  });
  const incomingResult = result({
    matchPercentage: 84,
    resumeEvaluation: { evaluationVersion: 'resume_flow_v1', overallScore: 84, jdMatch: null },
    experienceMatches: [],
    certificationMatches: [],
    skillMatches: [],
  });

  const { finalResult } = assembleJDAnalysisResult({
    mode: 'quality',
    analysisContext: {
      jdInputSignature: 'jd-signature',
      experienceSignature: 'experience-signature',
      itemSignatures: { experiences: {}, certifications: {}, skills: {} },
      experienceText: 'previous-experience-text',
    },
    previousResult,
    incomingResult,
    stableDiff: diffOf({ experiences: ['exp-1'] }),
    currentJdInputSignature: 'jd-signature',
  });

  assert.equal(finalResult.matchPercentage, 84);
  assert.equal(finalResult.resumeEvaluation.jdMatch, null);
  assert.deepEqual(finalResult.experienceMatches.map(({ id, score }) => ({ id, score })), [
    { id: 'exp-1', score: 60 },
    { id: 'exp-2', score: 50 },
  ]);
  assert.deepEqual(finalResult.certificationMatches.map(({ id, score }) => ({ id, score })), [
    { id: 'cert-1', score: 40 },
  ]);
  assert.deepEqual(finalResult.skillMatches.map(({ id, score }) => ({ id, score })), [
    { id: 'skill-1', score: 30 },
  ]);
});

test('full lightweight JD refresh preserves an existing deep evaluation', async () => {
  const { assembleJDAnalysisResult } = await importJDAnalysisResultAssemblyUtils();
  const previousResult = result({
    matchPercentage: 71,
    resumeEvaluation: { evaluationVersion: 'resume_flow_v1', overallScore: 83, jdMatch: 71 },
  });
  const incomingResult = result({ matchPercentage: 88 });

  const { finalResult } = assembleJDAnalysisResult({
    mode: 'full',
    analysisContext: null,
    previousResult,
    incomingResult,
    stableDiff: diffOf(),
    currentJdInputSignature: 'jd-signature',
  });

  assert.equal(finalResult.matchPercentage, 88);
  assert.equal(finalResult.resumeEvaluation.overallScore, 83);
});
