import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import { build } from 'esbuild';

const importJDAnalysisRunStateUtils = async () => {
  const result = await build({
    entryPoints: ['hooks/jdAnalysisRunStateUtils.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const source = result.outputFiles[0].text;
  const encoded = Buffer.from(source).toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
};

const emptyDiff = () => ({
  experiences: new Set(),
  certifications: new Set(),
  skills: new Set(),
});

const diffOf = ({ experiences = [], certifications = [], skills = [] } = {}) => ({
  experiences: new Set(experiences),
  certifications: new Set(certifications),
  skills: new Set(skills),
});

const itemSignatures = (value = 'same') => ({
  experiences: { 'exp-1': value },
  certifications: { 'cert-1': value },
  skills: { 'skill-1': value },
});

const context = (overrides = {}) => ({
  jdInputSignature: 'jd-signature',
  experienceSignature: 'experience-signature',
  itemSignatures: itemSignatures(),
  experienceText: 'previous-experience-text',
  ...overrides,
});

const result = {
  matchPercentage: 80,
  jobKeywords: [],
  missingKeywords: [],
  summary: 'Matched',
};

test('skips analysis when previous result and context are current', async () => {
  const { resolveJDAnalyzePlan } = await importJDAnalysisRunStateUtils();

  const plan = resolveJDAnalyzePlan({
    analysisResult: result,
    analysisContext: context(),
    snapshotItemSignatures: itemSignatures(),
    snapshotJdInputSignature: 'jd-signature',
    pendingDiff: emptyDiff(),
    needsReanalysis: true,
    hasMissingAttachmentContext: false,
  });

  assert.deepEqual(plan, {
    action: 'skip',
    status: 'no_change',
    shouldClearNeedsReanalysis: true,
    shouldClearPendingDiff: false,
  });
});

test('keeps skip priority over missing attachment when analysis is already current', async () => {
  const { resolveJDAnalyzePlan } = await importJDAnalysisRunStateUtils();

  const plan = resolveJDAnalyzePlan({
    analysisResult: result,
    analysisContext: context(),
    snapshotItemSignatures: itemSignatures(),
    snapshotJdInputSignature: 'jd-signature',
    pendingDiff: emptyDiff(),
    needsReanalysis: false,
    hasMissingAttachmentContext: true,
  });

  assert.deepEqual(plan, {
    action: 'skip',
    status: 'no_change',
    shouldClearNeedsReanalysis: false,
    shouldClearPendingDiff: false,
  });
});

test('returns missing attachment before falling back to full analysis', async () => {
  const { resolveJDAnalyzePlan } = await importJDAnalysisRunStateUtils();

  const plan = resolveJDAnalyzePlan({
    analysisResult: null,
    analysisContext: context(),
    snapshotItemSignatures: itemSignatures('changed'),
    snapshotJdInputSignature: 'jd-signature',
    pendingDiff: emptyDiff(),
    needsReanalysis: false,
    hasMissingAttachmentContext: true,
  });

  assert.deepEqual(plan, {
    action: 'missing_attachment',
    status: 'missing_attachment',
  });
});

test('chooses partial analysis when only item diff changed and previous experience text exists', async () => {
  const { resolveJDAnalyzePlan } = await importJDAnalysisRunStateUtils();

  const plan = resolveJDAnalyzePlan({
    analysisResult: result,
    analysisContext: context(),
    snapshotItemSignatures: itemSignatures('changed'),
    snapshotJdInputSignature: 'jd-signature',
    pendingDiff: diffOf({ certifications: ['cert-2'] }),
    needsReanalysis: false,
    hasMissingAttachmentContext: false,
  });

  assert.equal(plan.action, 'run');
  assert.equal(plan.mode, 'partial');
  assert.deepEqual([...plan.diff.experiences], ['exp-1']);
  assert.deepEqual([...plan.diff.certifications].sort(), ['cert-1', 'cert-2']);
  assert.deepEqual([...plan.diff.skills], ['skill-1']);
});

test('chooses full analysis when JD input changed', async () => {
  const { resolveJDAnalyzePlan } = await importJDAnalysisRunStateUtils();

  const plan = resolveJDAnalyzePlan({
    analysisResult: result,
    analysisContext: context(),
    snapshotItemSignatures: itemSignatures('changed'),
    snapshotJdInputSignature: 'new-jd-signature',
    pendingDiff: diffOf({ experiences: ['exp-2'] }),
    needsReanalysis: false,
    hasMissingAttachmentContext: false,
  });

  assert.deepEqual(plan, {
    action: 'run',
    mode: 'full',
  });
});

test('partial diff update computes needsReanalysis after clearing stable diff', async () => {
  const { resolveAnalyzeDiffStateUpdate } = await importJDAnalysisRunStateUtils();

  const update = resolveAnalyzeDiffStateUpdate({
    mode: 'partial',
    diff: diffOf({ experiences: ['exp-1', 'exp-2'] }),
    changedDuringAnalyze: diffOf({ experiences: ['exp-2'] }),
    pendingDiff: diffOf({ experiences: ['exp-1'] }),
  });

  assert.deepEqual([...update.stableDiff.experiences], ['exp-1']);
  assert.deepEqual([...update.pendingDiffToClear.experiences], ['exp-1']);
  assert.equal(update.needsReanalysis, false);
  assert.equal(update.shouldMarkPendingDiffStale, false);
});

test('full diff update marks remaining pending diff stale', async () => {
  const { resolveAnalyzeDiffStateUpdate } = await importJDAnalysisRunStateUtils();

  const update = resolveAnalyzeDiffStateUpdate({
    mode: 'full',
    diff: emptyDiff(),
    changedDuringAnalyze: emptyDiff(),
    pendingDiff: diffOf({ skills: ['skill-1'] }),
  });

  assert.equal(update.needsReanalysis, true);
  assert.equal(update.shouldMarkPendingDiffStale, true);
  assert.equal(update.shouldReplaceStale, true);
});
