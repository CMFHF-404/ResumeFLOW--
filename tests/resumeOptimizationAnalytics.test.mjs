import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { build } from 'esbuild';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const importTracker = async () => {
  const result = await build({
    entryPoints: ['utils/analyticsTracker.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    plugins: [{
      name: 'analytics-test-stubs',
      setup(buildContext) {
        buildContext.onResolve({ filter: /analyticsClient$/ }, () => ({ path: 'client', namespace: 'stub' }));
        buildContext.onLoad({ filter: /^client$/, namespace: 'stub' }, () => ({
          loader: 'js',
          contents: `
            export const trackEvent = (event, properties = {}) => {
              globalThis.__resumeOptimizationAnalyticsCalls.push({ event, properties });
              return true;
            };
            export const trackEventImmediate = trackEvent;
            export const trackPageView = () => undefined;
          `,
        }));
        buildContext.onResolve({ filter: /analyticsCounters$/ }, () => ({ path: 'counters', namespace: 'stub' }));
        buildContext.onLoad({ filter: /^counters$/, namespace: 'stub' }, () => ({
          loader: 'js',
          contents: `
            export const getAnalyticsCounters = () => ({ exportCount: 0, aiAnalysisCount: 0, resumeSortCount: 0 });
            export const incrementAnalyticsCounter = () => undefined;
          `,
        }));
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}#${Math.random()}`);
};

const plannedTrackers = [
  'trackResumeOptimizationCtaView',
  'trackResumeOptimizationCtaClick',
  'trackResumeOptimizationPlanStart',
  'trackResumeOptimizationPlanResult',
  'trackResumeOptimizationQuestionsView',
  'trackResumeOptimizationQuestionsSubmit',
  'trackResumeOptimizationChangeToggle',
  'trackResumeOptimizationApplyStart',
  'trackResumeOptimizationApplyResult',
  'trackResumeOptimizationRescoreResult',
  'trackResumeOptimizationRevertResult',
  'trackResumeOptimizationBankSuggestionClick',
  'trackResumeOptimizationPreviewView',
];

test('exports the complete optimization funnel and only emits allowlisted aggregate properties', async () => {
  globalThis.__resumeOptimizationAnalyticsCalls = [];
  const tracker = await importTracker();
  for (const name of plannedTrackers) assert.equal(typeof tracker[name], 'function', name);

  const resumeId = '11111111-1111-4111-8111-111111111111';
  const runId = '22222222-2222-4222-8222-222222222222';
  const privateFields = {
    jdText: 'jd-secret',
    answers: [{ questionId: 'question-secret', value: 'answer-secret' }],
    questionId: 'question-secret',
    changeId: 'change-secret',
    suggestionId: 'suggestion-secret',
    masterExperienceId: 'master-secret',
    moduleId: 'module-secret',
    fieldPath: 'private.path',
    value: 'private-value',
    evaluationSignature: 'signature-secret',
    sourceSnapshotHash: 'hash-secret',
  };
  tracker.trackResumeOptimizationCtaView({ beforeScore: 61, ...privateFields });
  tracker.trackResumeOptimizationCtaClick({ beforeScore: 61, ...privateFields });
  tracker.trackResumeOptimizationPlanStart({ resumeId, beforeScore: 61, ...privateFields });
  tracker.trackResumeOptimizationPlanResult({
    resumeId, runId,
    action: 'success', beforeScore: 61, directChangeCount: 4, questionCount: 2,
    blockedChangeCount: 1, bankSuggestionCount: 3, durationMs: 25,
    failureCode: 'resume_optimization_plan_invalid', ...privateFields,
  });
  tracker.trackResumeOptimizationQuestionsView({ resumeId, runId, questionCount: 2, ...privateFields });
  tracker.trackResumeOptimizationQuestionsSubmit({
    resumeId, runId,
    questionCount: 5, answeredCount: 1, noDataCount: 1, unknownCount: 1,
    notMyWorkCount: 1, skippedCount: 1, ...privateFields,
  });
  tracker.trackResumeOptimizationChangeToggle({ resumeId, runId, acceptedChangeCount: 3, ...privateFields });
  tracker.trackResumeOptimizationApplyStart({
    resumeId, runId, beforeScore: 61, acceptedChangeCount: 3,
    blockedChangeCount: 1, bankSuggestionCount: 3, ...privateFields,
  });
  tracker.trackResumeOptimizationApplyResult({
    resumeId, runId, action: 'failure', beforeScore: 61, acceptedChangeCount: 3,
    blockedChangeCount: 1, bankSuggestionCount: 3, durationMs: 40,
    failureCode: 'Unsafe exception message', ...privateFields,
  });
  tracker.trackResumeOptimizationRescoreResult({
    resumeId, runId, action: 'success', beforeScore: 61, afterScore: 78, scoreDelta: 17,
    acceptedChangeCount: 3, blockedChangeCount: 1, bankSuggestionCount: 3,
    durationMs: 50, ...privateFields,
  });
  tracker.trackResumeOptimizationRevertResult({ resumeId, runId, action: 'success', durationMs: 20, ...privateFields });
  tracker.trackResumeOptimizationBankSuggestionClick({
    resumeId, runId, action: 'view_experience', bankSuggestionCount: 3, ...privateFields,
  });
  tracker.trackResumeOptimizationPreviewView({
    resumeId, runId, directChangeCount: 4, questionCount: 2,
    blockedChangeCount: 1, bankSuggestionCount: 3, ...privateFields,
  });

  const calls = globalThis.__resumeOptimizationAnalyticsCalls;
  assert.equal(calls.length, plannedTrackers.length);
  const allowedKeys = new Set([
    'resume_id', 'run_id', 'action', 'direct_change_count',
    'question_count', 'answered_count', 'no_data_count', 'unknown_count',
    'not_my_work_count', 'skipped_count', 'accepted_change_count',
    'blocked_change_count', 'bank_suggestion_count', 'duration_ms', 'failure_code',
  ]);
  for (const { properties } of calls) {
    assert.deepEqual(
      Object.keys(properties).filter((key) => !allowedKeys.has(key)),
      [],
    );
    assert.doesNotMatch(JSON.stringify(properties), /(?:jd|answer|question|change|suggestion|master|module|private|signature|hash)-secret/);
  }
  const ctaCalls = calls.filter(({ event }) => event === 'resume_optimization_cta_view' || event === 'resume_optimization_cta_click');
  for (const { properties } of ctaCalls) assert.deepEqual(properties, {});
  for (const { properties } of calls) {
    assert.equal('before_score' in properties, false);
    assert.equal('after_score' in properties, false);
    assert.equal('score_delta' in properties, false);
  }
  const planStart = calls.find(({ event }) => event === 'resume_optimization_plan_start');
  assert.equal(planStart.properties.resume_id, resumeId);
  assert.equal('run_id' in planStart.properties, false);
  const runBoundEvents = new Set([
    'resume_optimization_plan_result', 'resume_optimization_questions_view',
    'resume_optimization_questions_submit', 'resume_optimization_change_toggle',
    'resume_optimization_apply_start', 'resume_optimization_apply_result',
    'resume_optimization_rescore_result', 'resume_optimization_revert_result',
    'resume_optimization_bank_suggestion_click', 'resume_optimization_preview_view',
  ]);
  for (const { event, properties } of calls) {
    if (!runBoundEvents.has(event)) continue;
    assert.equal(properties.resume_id, resumeId, event);
    assert.equal(properties.run_id, runId, event);
  }
  const unsafeFailure = calls.find(({ event }) => event === 'resume_optimization_apply_result');
  assert.equal('failure_code' in unsafeFailure.properties, false);
});

test('invalid optimization identifiers fail closed instead of becoming analytics properties', async () => {
  globalThis.__resumeOptimizationAnalyticsCalls = [];
  const tracker = await importTracker();
  tracker.trackResumeOptimizationPlanResult({
    resumeId: 'resume-secret',
    runId: 'run-secret',
    action: 'failure',
  });
  assert.deepEqual(globalThis.__resumeOptimizationAnalyticsCalls[0].properties, { action: 'failure' });
});

test('event constants and tracker source use explicit safe property construction', () => {
  const events = read('constants/analyticsEvents.ts');
  const tracker = read('utils/analyticsTracker.ts');
  for (const name of [
    'CTA_VIEW', 'CTA_CLICK', 'PLAN_START', 'PLAN_RESULT', 'QUESTIONS_VIEW',
    'QUESTIONS_SUBMIT', 'CHANGE_TOGGLE', 'APPLY_START', 'APPLY_RESULT',
    'RESCORE_RESULT', 'REVERT_RESULT', 'BANK_SUGGESTION_CLICK',
  ]) {
    assert.match(events, new RegExp(`RESUME_OPTIMIZATION_${name}`));
  }
  const optimizationSource = tracker.slice(tracker.indexOf('type ResumeOptimizationAnalytics'));
  assert.doesNotMatch(optimizationSource, /\.\.\.(?:payload|input|event|properties)/);
  assert.doesNotMatch(optimizationSource, /error\.message|cause\.message/);
  assert.match(optimizationSource, /SAFE_RESUME_OPTIMIZATION_FAILURE_CODE/);
});

test('numeric scoring CTA records only aggregate visibility and selection clicks', () => {
  const report = read('views/ResumeEditor/components/ResumeEvaluationReport/ResumeScoreReport.tsx');
  assert.match(report, /IntersectionObserver/);
  assert.match(report, /ctaViewTrackedRef/);
  assert.match(report, /trackResumeOptimizationCtaView\(\)/);
  assert.match(report, /trackResumeOptimizationCtaClick\(\)/);
  assert.doesNotMatch(report, /本次优化按实际模型用量消耗 Token。/);
});

test('hook emits aggregate events at frozen mutation boundaries without leaking identifiers', () => {
  const hook = read('views/ResumeEditor/hooks/useResumeOptimizationFlow.ts');
  const startBlock = hook.slice(hook.indexOf('const startOptimization'), hook.indexOf('const setAnswer'));
  const submitBlock = hook.slice(hook.indexOf('const submitAnswers'), hook.indexOf('const toggleChange'));
  const toggleBlock = hook.slice(hook.indexOf('const toggleChange'), hook.indexOf('const runPostApplyEvaluation'));
  const applyBlock = hook.slice(hook.indexOf('const applyAcceptedChanges'), hook.indexOf('const retryRescore'));
  const rescoreBlock = hook.slice(hook.indexOf('const runPostApplyEvaluation'), hook.indexOf('const recoverUncertainApplyAttempt'));
  const recoveryBlock = hook.slice(hook.indexOf('const recoverUncertainApplyAttempt'), hook.indexOf('const applyAcceptedChanges'));
  const revertBlock = hook.slice(hook.indexOf('const revertRun'), hook.indexOf('const cancelRun'));
  const retryBlock = hook.slice(hook.indexOf('const retryRescore'), hook.indexOf('const revertRun'));

  assert.match(startBlock, /trackResumeOptimizationPlanStart/);
  assert.match(startBlock, /const planMetrics = summarizeResumeOptimizationPlan\(nextRun\)/);
  assert.match(submitBlock, /answerAttempt\.answers[\s\S]*trackResumeOptimizationQuestionsSubmit/);
  assert.match(toggleBlock, /const next = [\s\S]*trackResumeOptimizationChangeToggle\(\{[\s\S]*acceptedChangeCount: next\.length/);
  assert.ok(applyBlock.indexOf('trackResumeOptimizationApplyStart') < applyBlock.indexOf('resumeOptimizationService.apply'));
  assert.ok(applyBlock.indexOf('resumeOptimizationService.apply') < applyBlock.indexOf('trackResumeOptimizationApplyResult'));
  assert.ok(applyBlock.indexOf('trackResumeOptimizationApplyResult') < applyBlock.indexOf('reloadResumeContext'));
  assert.match(rescoreBlock, /trackCompletedResumeOptimizationRescore\([\s\S]*rescoreStartedAt/);
  assert.match(rescoreBlock, /const trackRescoreFailure[\s\S]*catch \(cause\) \{[\s\S]*trackRescoreFailure\(cause\)[\s\S]*throw cause/);
  assert.match(
    recoveryBlock,
    /authoritativeRun\.status === 'completed'[\s\S]*trackCompletedResumeOptimizationRescore/,
  );
  assert.match(
    retryBlock,
    /authoritativeRun\.status === 'completed'[\s\S]*postEvaluation[\s\S]*trackCompletedResumeOptimizationRescore/,
  );
  assert.ok(revertBlock.indexOf('resumeOptimizationService.revert') < revertBlock.indexOf('trackResumeOptimizationRevertResult'));
  assert.ok(revertBlock.indexOf('trackResumeOptimizationRevertResult') < revertBlock.indexOf('reloadResumeContext'));
  assert.match(startBlock, /trackResumeOptimizationPlanStart\(\{[\s\S]*resumeId/);
  assert.match(startBlock, /trackResumeOptimizationPlanResult\(\{[\s\S]*resumeId[\s\S]*runId/);
  assert.match(submitBlock, /trackResumeOptimizationQuestionsSubmit\(\{[\s\S]*resumeId[\s\S]*runId/);
  assert.match(toggleBlock, /trackResumeOptimizationChangeToggle\(\{[\s\S]*resumeId[\s\S]*runId/);
  assert.match(applyBlock, /trackResumeOptimizationApplyStart\(\{[\s\S]*resumeId[\s\S]*runId/);
  assert.match(rescoreBlock, /trackResumeOptimizationRescoreResult\(\{[\s\S]*resumeId[\s\S]*runId/);
  assert.match(revertBlock, /trackResumeOptimizationRevertResult\(\{[\s\S]*resumeId[\s\S]*runId/);
  assert.doesNotMatch(hook, /trackResumeOptimization\w+\(\{[^}]*?(?:questionId|changeId|moduleId)/s);
  assert.doesNotMatch(hook, /beforeScore|afterScore|scoreDelta|overallScore/);
});

test('question and preview views are real-step deduped and bank clicks send only action plus total count', () => {
  const workspace = read('views/ResumeEditor/components/ResumeOptimization/ResumeOptimizationWorkspace.tsx');
  const bank = read('views/ResumeEditor/components/ResumeOptimization/ResumeOptimizationBankSuggestions.tsx');
  assert.match(workspace, /const resumeOptimizationQuestionsViewRunIds = new Set<string>\(\)/);
  assert.match(workspace, /displayStep === 'questions'[\s\S]*resumeOptimizationQuestionsViewRunIds[\s\S]*trackResumeOptimizationQuestionsView\(\{[\s\S]*resumeId: run\.resumeId[\s\S]*runId: run\.id/);
  assert.match(workspace, /const resumeOptimizationPreviewViewRunIds = new Set<string>\(\)/);
  assert.match(workspace, /displayStep === 'preview'[\s\S]*resumeOptimizationPreviewViewRunIds[\s\S]*trackResumeOptimizationPreviewView\(\{[\s\S]*resumeId: run\.resumeId[\s\S]*runId: run\.id/);
  assert.match(bank, /trackResumeOptimizationBankSuggestionClick\(\{[\s\S]*resumeId[\s\S]*runId[\s\S]*action: 'view_experience'[\s\S]*bankSuggestionCount: suggestions\.length/);
  assert.match(bank, /trackResumeOptimizationBankSuggestionClick\(\{[\s\S]*resumeId[\s\S]*runId[\s\S]*action: 'open_auto_assembly'[\s\S]*bankSuggestionCount: suggestions\.length/);
  const trackerCalls = bank.match(/trackResumeOptimizationBankSuggestionClick\(\{[\s\S]*?\}\)/g) ?? [];
  for (const call of trackerCalls) assert.doesNotMatch(call, /suggestionId|masterExperienceId|moduleId/);
});
