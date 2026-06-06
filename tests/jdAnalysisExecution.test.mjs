import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import { build } from 'esbuild';

const importJDAnalysisExecution = async () => {
  const result = await build({
    entryPoints: ['hooks/useJDAnalysisExecution.ts'],
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

const buildSnapshot = (overrides = {}) => ({
  experiences: [],
  certifications: [],
  skillGroups: [],
  jdText: 'JD text',
  jdFile: null,
  attachmentExtractedText: null,
  itemSignatures: itemSignatures(),
  experienceSignature: 'experience-signature',
  jdInputSignature: 'jd-signature',
  experienceText: 'experience-text',
  inputMode: 'text',
  ...overrides,
});

const buildResult = (overrides = {}) => ({
  matchPercentage: 84,
  jobKeywords: ['typescript'],
  missingKeywords: [],
  summary: 'Strong match',
  ...overrides,
});

const buildDeps = (overrides = {}) => {
  const calls = {
    progress: [],
    events: [],
    sequence: [],
    analyzing: [],
    needsReanalysis: [],
    fullStarts: 0,
    requestRuns: 0,
    updates: [],
    diffUpdates: [],
    scores: [],
    promotions: [],
    collapsed: [],
    debugInfo: [],
    starts: [],
    completes: [],
    errors: [],
  };
  const startSnapshot = buildSnapshot();
  const latestSnapshot = buildSnapshot();

  return {
    calls,
    params: {
      mode: 'full',
      diff: emptyDiff(),
      resumeId: 'resume-1',
      authUserKey: 'user-1',
      analysisContext: null,
      analysisResult: null,
      service: { marker: 'injected-service' },
      buildAnalyzeSnapshot: () => startSnapshot,
      recordPostAnalyzeDiff: () => emptyDiff(),
      updateAnalyzeDiffState: (...args) => {
        calls.sequence.push('update-diff-state');
        calls.diffUpdates.push(args);
      },
      updateAnalysisState: (payload) => {
        calls.sequence.push('update-analysis-state');
        calls.updates.push(payload);
      },
      applyMatchScoresForResult: (...args) => {
        calls.sequence.push('apply-scores');
        calls.scores.push(args);
      },
      promoteAttachmentToText: (...args) => {
        calls.sequence.push('promote-attachment');
        calls.promotions.push(args);
      },
      clearFullAnalysisDiffState: () => {
        calls.fullStarts += 1;
      },
      setIsAnalyzing: (value) => calls.analyzing.push(value),
      setNeedsReanalysis: (value) => calls.needsReanalysis.push(value),
      setIsJDCollapsed: (value) => calls.collapsed.push(value),
      setDebugInfo: (value) => calls.debugInfo.push(value),
      trackStart: (payload) => calls.starts.push(payload),
      trackComplete: (payload, authUserKey) => calls.completes.push([payload, authUserKey]),
      logError: (...args) => calls.errors.push(args),
      now: (() => {
        let value = 1000;
        return () => {
          value += 50;
          return value;
        };
      })(),
      requestRunner: async () => {
        calls.requestRuns += 1;
        return {
          result: buildResult(),
          currentFile: null,
          attachmentSupplementalJdText: '',
          extractedAttachmentText: '',
          shouldPersistAttachmentAsText: false,
        };
      },
      onProgress: (node) => calls.progress.push(node),
      onEvent: (event) => calls.events.push(event),
      ...overrides,
    },
  };
};

test('partial execution with empty diff returns no_change without starting a request', async () => {
  const { runJDAnalysisExecution } = await importJDAnalysisExecution();
  const { calls, params } = buildDeps({
    mode: 'partial',
    diff: emptyDiff(),
  });

  const outcome = await runJDAnalysisExecution(params);

  assert.deepEqual(outcome, { status: 'no_change' });
  assert.equal(calls.requestRuns, 0);
  assert.deepEqual(calls.analyzing, []);
  assert.deepEqual(calls.progress, []);
});

test('request errors return error and always clear analyzing state', async () => {
  const { runJDAnalysisExecution } = await importJDAnalysisExecution();
  const { calls, params } = buildDeps({
    requestRunner: async () => {
      calls.requestRuns += 1;
      throw new Error('network failed');
    },
  });

  const outcome = await runJDAnalysisExecution(params);

  assert.deepEqual(outcome, { status: 'error' });
  assert.deepEqual(calls.analyzing, [true, false]);
  assert.equal(calls.requestRuns, 1);
  assert.equal(calls.errors.length, 1);
  assert.deepEqual(calls.updates, []);
});

test('full execution applies result, persists state, and tracks analytics lifecycle', async () => {
  const { runJDAnalysisExecution } = await importJDAnalysisExecution();
  const finalResult = buildResult({
    matchPercentage: 91,
    experienceMatches: [{ id: 'exp-1', score: 88 }],
  });
  const stableDiff = diffOf({ experiences: ['exp-1'] });
  const startSnapshot = buildSnapshot({
    itemSignatures: itemSignatures('start'),
    jdInputSignature: 'jd-start',
  });
  const latestSnapshot = buildSnapshot({
    itemSignatures: itemSignatures('latest'),
  });
  let snapshotCalls = 0;
  const { calls, params } = buildDeps({
    diff: stableDiff,
    analysisContext: {
      jdInputSignature: 'old-jd',
      experienceSignature: 'old-exp',
      itemSignatures: itemSignatures('old'),
      experienceText: 'old-experience-text',
    },
    analysisResult: buildResult({ matchPercentage: 70 }),
    buildAnalyzeSnapshot: () => {
      snapshotCalls += 1;
      return snapshotCalls === 1 ? startSnapshot : latestSnapshot;
    },
    recordPostAnalyzeDiff: (start, latest) => {
      calls.diffRecord = [start, latest];
      return emptyDiff();
    },
    requestRunner: async ({ service, onProgress, onEvent }) => {
      calls.requestRuns += 1;
      calls.requestService = service;
      onProgress?.('request_ai');
      onEvent?.({ type: 'progress', node: 'request_ai', title: 'Requesting AI' });
      return {
        result: finalResult,
        currentFile: null,
        attachmentSupplementalJdText: '',
        extractedAttachmentText: '',
        shouldPersistAttachmentAsText: false,
      };
    },
  });

  const outcome = await runJDAnalysisExecution(params);

  assert.equal(outcome.status, 'success');
  assert.equal(outcome.result.matchPercentage, 91);
  assert.deepEqual(calls.analyzing, [true, false]);
  assert.equal(calls.fullStarts, 1);
  assert.deepEqual(calls.starts, [{ resumeId: 'resume-1' }]);
  assert.equal(calls.completes.length, 1);
  assert.equal(calls.completes[0][0].resumeId, 'resume-1');
  assert.equal(calls.completes[0][0].matchScore, 91);
  assert.equal(calls.completes[0][1], 'user-1');
  assert.deepEqual(calls.progress, [
    'prepare_context',
    'request_ai',
    'request_ai',
    'merge_result',
    'apply_score',
    'persist_result',
  ]);
  assert.deepEqual(calls.events.map((event) => event.type), ['progress']);
  assert.equal(calls.requestRuns, 1);
  assert.deepEqual(calls.requestService, { marker: 'injected-service' });
  assert.deepEqual(calls.diffRecord, [
    startSnapshot.itemSignatures,
    latestSnapshot.itemSignatures,
  ]);
  assert.equal(calls.scores.length, 1);
  assert.equal(calls.scores[0][0].matchPercentage, 91);
  assert.equal(calls.scores[0][1], 'full');
  assert.equal(calls.updates.length, 1);
  assert.equal(calls.updates[0].result.matchPercentage, 91);
  assert.equal(calls.updates[0].jdInputSignature, 'jd-start');
  assert.equal(calls.updates[0].inputMode, 'text');
  assert.equal(calls.diffUpdates.length, 1);
  assert.equal(calls.collapsed[0], true);
  assert.deepEqual(calls.debugInfo, [null]);
});

test('partial execution applies only stable diff and updates persisted state before diff state', async () => {
  const { runJDAnalysisExecution } = await importJDAnalysisExecution();
  const previousResult = buildResult({
    matchPercentage: 70,
    experienceMatches: [
      { id: 'exp-1', score: 50, trend: 'same' },
      { id: 'exp-2', score: 60, trend: 'same' },
    ],
  });
  const incomingResult = buildResult({
    matchPercentage: 76,
    experienceMatches: [
      { id: 'exp-1', score: 82, trend: 'up' },
      { id: 'exp-2', score: 90, trend: 'up' },
    ],
  });
  const requestedDiff = diffOf({ experiences: ['exp-1', 'exp-2'] });
  const changedDuringAnalyze = diffOf({ experiences: ['exp-2'] });
  const { calls, params } = buildDeps({
    mode: 'partial',
    diff: requestedDiff,
    analysisContext: {
      jdInputSignature: 'jd-signature',
      experienceSignature: 'experience-signature',
      itemSignatures: itemSignatures('old'),
      experienceText: 'previous-experience-text',
    },
    analysisResult: previousResult,
    requestRunner: async ({ mode, analysisContext, analysisResult, service }) => {
      calls.requestRuns += 1;
      calls.requestMode = mode;
      calls.requestContext = analysisContext;
      calls.requestAnalysisResult = analysisResult;
      calls.requestService = service;
      return {
        result: incomingResult,
        currentFile: null,
        attachmentSupplementalJdText: '',
        extractedAttachmentText: '',
        shouldPersistAttachmentAsText: false,
      };
    },
    recordPostAnalyzeDiff: () => changedDuringAnalyze,
  });

  const outcome = await runJDAnalysisExecution(params);

  assert.equal(outcome.status, 'success');
  assert.equal(calls.requestMode, 'partial');
  assert.equal(calls.requestContext.experienceText, 'previous-experience-text');
  assert.equal(calls.requestAnalysisResult.matchPercentage, 70);
  assert.deepEqual(calls.requestService, { marker: 'injected-service' });
  assert.equal(calls.scores.length, 1);
  assert.deepEqual([...calls.scores[0][2].experiences], ['exp-1']);
  assert.equal(calls.diffUpdates.length, 1);
  assert.deepEqual(calls.diffUpdates[0], ['partial', requestedDiff, changedDuringAnalyze]);
  assert.deepEqual(calls.sequence, [
    'apply-scores',
    'update-analysis-state',
    'update-diff-state',
  ]);
  assert.equal(calls.collapsed.length, 0);
  assert.equal(calls.starts.length, 0);
  assert.equal(calls.completes.length, 0);
});

test('attachment execution promotes extracted JD text and persists text-mode fields', async () => {
  const { runJDAnalysisExecution } = await importJDAnalysisExecution();
  const file = { name: 'jd.pdf', size: 100, lastModified: 1, type: 'application/pdf' };
  const startSnapshot = buildSnapshot({
    jdText: 'Old extracted text\n\n补充 JD 说明：\nSupplemental note',
    jdFile: file,
    attachmentExtractedText: 'Old extracted text',
    inputMode: 'attachment',
    attachmentName: 'jd.pdf',
    jdInputSignature: 'attachment-signature',
  });
  const extractedText = 'New extracted JD';
  const { calls, params } = buildDeps({
    buildAnalyzeSnapshot: () => startSnapshot,
    requestRunner: async ({ service }) => {
      calls.requestRuns += 1;
      calls.requestService = service;
      return {
        result: buildResult(),
        currentFile: file,
        attachmentSupplementalJdText: 'Supplemental note',
        extractedAttachmentText: extractedText,
        shouldPersistAttachmentAsText: true,
      };
    },
  });

  const outcome = await runJDAnalysisExecution(params);

  assert.equal(outcome.status, 'success');
  assert.deepEqual(calls.requestService, { marker: 'injected-service' });
  assert.deepEqual(calls.promotions, [
    [`${extractedText}\n\n补充 JD 说明：\nSupplemental note`],
  ]);
  assert.equal(calls.updates.length, 1);
  assert.equal(calls.updates[0].jdText, `${extractedText}\n\n补充 JD 说明：\nSupplemental note`);
  assert.equal(calls.updates[0].inputMode, 'text');
  assert.equal(calls.updates[0].attachmentName, undefined);
  assert.equal(calls.updates[0].attachmentExtractedText, extractedText);
  assert.notEqual(calls.updates[0].jdInputSignature, 'attachment-signature');
  assert.deepEqual(calls.sequence, [
    'apply-scores',
    'promote-attachment',
    'update-analysis-state',
    'update-diff-state',
  ]);
});
