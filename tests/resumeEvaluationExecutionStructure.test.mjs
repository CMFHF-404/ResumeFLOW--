import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('six-dimension report uses a dedicated stream and isolated controller', () => {
  const service = read('services/aiService.ts');
  const hook = read('hooks/useResumeEvaluation.ts');
  const jdHook = read('hooks/useJDAnalysis.ts');
  const editor = read('views/ResumeEditor/index.tsx');
  const resumeData = read('hooks/useResumeData.ts');

  assert.match(service, /path: '\/api\/resume-evaluation\/stream'/);
  assert.match(service, /jd_match_percentage/);
  assert.match(hook, /const controllerRef = useRef<AbortController \| null>\(null\)/);
  assert.match(hook, /const runIdRef = useRef\(0\)/);
  assert.match(hook, /const requestEvaluationSignature = evaluationSignature/);
  assert.match(hook, /persistEvaluation\(evaluation, requestEvaluationSignature\)/);
  assert.match(hook, /if \(controllerRef\.current\)/);
  assert.match(hook, /\[evaluationSignature, stopEvaluation\]/);
  assert.match(hook, /if \(!isCurrent\(\)\) return \{ status: "aborted" \}/);
  assert.match(jdHook, /const persistResumeEvaluation = useCallback/);
  assert.match(jdHook, /if \(requestEvaluationSignature !== evaluationSignatureRef\.current\)/);
  assert.match(jdHook, /persistedJDAnalysisRef\.current/);
  assert.match(jdHook, /jdInputSignature,\s*resume: evaluationSnapshot/);
  assert.match(jdHook, /evaluationIsOutdated: false/);
  assert.match(jdHook, /evaluationSignature: requestEvaluationSignature,\s*targetRoleSignature,/);
  assert.match(jdHook, /evaluationSignature: requestEvaluationSignature,\s*targetRoleSignature,\s*\}/);
  assert.match(editor, /await flushResumeConfig\(\)/);
  assert.match(editor, /return generateEvaluation\(\)/);
  assert.match(editor, /const handleAnalyzePersistedSnapshot = useCallback/);
  assert.match(editor, /handleAnalyze: handleAnalyzePersistedSnapshot/);
  assert.match(resumeData, /expected_updated_at: expectedUpdatedAt/);
  assert.match(resumeData, /forceVersionCheck: true/);
  assert.match(resumeData, /subscribeToResumeVersionConflicts/);
  assert.match(resumeData, /waitForResumeMutations\(conflictedResumeId\)/);
  assert.match(resumeData, /resumeService\.get\(conflictedResumeId\)/);
  assert.match(resumeData, /const conflictedDraftSignature = JSON\.stringify\(conflictedDraft\)/);
  assert.match(resumeData, /suppressedAutoSaveSignatureRef\.current = conflictedDraftSignature/);
  assert.match(resumeData, /if \(isConflictRecoveryPending\) \{\s*return;/);
  assert.match(resumeData, /setIsConflictRecoveryPending\(false\)/);
  assert.match(resumeData, /shouldWaitForDebouncedConfigRef\.current = true/);
  assert.match(resumeData, /setSaveRetryVersion\(\(version\) => version \+ 1\)/);
});

test('default JD matching keeps the lightweight request and does not require a report', () => {
  const runner = read('hooks/jdAnalysisRequestRunner.ts');
  const normalizer = read('services/aiNormalizeUtils.ts');
  const planner = read('hooks/jdAnalysisRunStateUtils.ts');

  assert.match(runner, /buildResumeAISnapshot/);
  assert.doesNotMatch(runner, /snapshot\.analysisPayload \?\? buildAnalyzePayload/);
  assert.doesNotMatch(normalizer, /matchPercentage: resumeEvaluation\.overallScore/);
  assert.doesNotMatch(planner, /hasCurrentEvaluation/);
});

test('report stop action and single-button placeholder stay accessible', () => {
  const report = read('views/ResumeEditor/components/ResumeEvaluationReport/ResumeEvaluationReport.tsx');
  const panel = read('views/ResumeEditor/components/JDAnalysisPanel.tsx');
  const editor = read('views/ResumeEditor/index.tsx');

  assert.match(report, /aria-label="获取六维报告"/);
  assert.match(report, /停止生成/);
  assert.match(panel, /onStop=\{onStopEvaluation\}/);
  const placeholder = report.slice(
    report.indexOf('const placeholderContent'),
    report.indexOf('if (onGenerate && !isGenerating)')
  );
  assert.doesNotMatch(placeholder, /<h4|<p/);
  assert.match(panel, /onStopEvaluation\?: \(\) => void/);
  assert.match(editor, /onStopEvaluation=\{stopEvaluation\}/);
});
