import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const importFlow = async () => {
  const result = await build({
    entryPoints: ['views/ResumeEditor/hooks/useResumeOptimizationFlow.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    plugins: [{
      name: 'resume-optimization-flow-stubs',
      setup(buildContext) {
        buildContext.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'stub' }));
        buildContext.onLoad({ filter: /^react$/, namespace: 'stub' }, () => ({
          loader: 'js',
          contents: `
            export const useCallback = (value) => value;
            export const useEffect = () => undefined;
            export const useLayoutEffect = () => undefined;
            export const useMemo = (factory) => factory();
            export const useRef = (current) => ({ current });
            export const useState = (initial) => [initial, () => undefined];
          `,
        }));
        buildContext.onResolve({ filter: /useAuthOwnerOperationGuard$/ }, () => ({ path: 'owner', namespace: 'stub' }));
        buildContext.onLoad({ filter: /^owner$/, namespace: 'stub' }, () => ({
          loader: 'js',
          contents: 'export const useAuthOwnerOperationGuard = () => ({});',
        }));
        buildContext.onResolve({ filter: /resumeOptimizationService$/ }, () => ({ path: 'service', namespace: 'stub' }));
        buildContext.onLoad({ filter: /^service$/, namespace: 'stub' }, () => ({
          loader: 'js',
          contents: `
            export const createResumeOptimizationIdempotencyKey = () => 'key';
            export const isResumeOptimizationServiceError = () => false;
            export const resumeOptimizationService = {};
          `,
        }));
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}#${Math.random()}`);
};

const launchMountedHookBrowser = async (t) => {
  const systemBrowserCandidates = process.platform === 'win32'
    ? [
        'C:/Program Files/Google/Chrome/Application/chrome.exe',
        'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
        'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      ]
    : [];
  const attempts = [undefined, ...systemBrowserCandidates.filter(existsSync)];
  for (const executablePath of attempts) {
    try {
      return await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    } catch {
      // Fall through to an installed system browser when Playwright's browser is unavailable.
    }
  }
  t.skip('A Chromium runtime is required for the mounted-hook lifecycle regression.');
  return null;
};

const createSameOriginHarnessPage = async (browser) => {
  const page = await browser.newPage();
  await page.route('http://resume.test/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><html><body></body></html>',
    });
  });
  await page.goto('http://resume.test/');
  await page.addScriptTag({ content: await buildMountedHookHarness() });
  return page;
};

const buildMountedHookHarness = async () => {
  const result = await build({
    stdin: {
      resolveDir: process.cwd(),
      sourcefile: 'resume-optimization-mounted-hook-harness.tsx',
      loader: 'tsx',
      contents: `
        import React, { useLayoutEffect, useMemo, useState } from 'react';
        import { createRoot } from 'react-dom/client';
        import { flushSync } from 'react-dom';
        import { ResumeOptimizationWorkspace } from './views/ResumeEditor/components/ResumeOptimization/ResumeOptimizationWorkspace';
        import {
          saveResumeOptimizationPostApplyCheckpoint,
          useResumeOptimizationFlow,
        } from './views/ResumeEditor/hooks/useResumeOptimizationFlow';

        const auditReceipt = {
          receiptId: 'receipt-1', inputHash: 'input-hash', tasksHash: 'tasks-hash',
          judgmentsHash: 'judgments-hash', rubricHash: 'rubric-hash', schemaHash: 'schema-hash',
          auditVersion: 'guidance_task_audit_v1',
        };
        const sourceEvaluation = {
          evaluationVersion: 'guidance_audit_v1', overallBand: 'needs_attention',
          auditReceipt,
        };
        const postEvaluation = {
          evaluationVersion: 'guidance_audit_v1', overallBand: 'adequate',
          auditReceipt: { ...auditReceipt, receiptId: 'receipt-2', inputHash: 'post-input-hash' },
        };
        const plan = {
          changes: [{
            changeId: 'change-a',
            safetyStatus: 'allowed',
            actionKind: 'rewrite_now',
            targetedValue: 'after',
            beforeValue: 'before',
            moduleType: 'personal_summary',
            moduleId: 'resume',
            fieldPath: 'personalSummary',
            sourceLabels: [],
            safetyFindings: [],
          }],
          questions: [],
          bankSuggestions: [],
          safetySummary: { allowedChangeIds: ['change-a'], blockedChangeIds: [], pendingChangeIds: [], findings: [] },
        };
        const previewRun = {
          id: 'run-a', resumeId: 'resume-a', status: 'preview_ready',
          sourceResumeUpdatedAt: '2026-09-01T00:00:00Z',
          sourceEvaluationSignature: 'S1', sourceBeforeScore: null,
          plan, result: null, answers: [], acceptedChangeIds: [],
        };
        const appliedRun = {
          ...previewRun, status: 'applied', acceptedChangeIds: ['change-a'],
          appliedAt: '2026-09-01T00:00:01Z',
          appliedResumeUpdatedAt: '2026-09-01T00:00:02Z',
        };
        const completedRun = {
          ...appliedRun, status: 'completed',
          postEvaluation: {
            version: 'guidance_optimization_post_v1',
            overallBandBefore: 'needs_attention', overallBandAfter: 'adequate',
            dimensionStatusChanges: [], issueSummary: { resolved: 1, remaining: 0 },
            unresolvedFactGapCount: 0, acceptedChangeCount: 1,
            blockedChangeCount: 0, bankSuggestionCount: 0,
          },
        };
        const rescoringRun = {
          ...appliedRun, status: 'rescoring',
        };

        let root;
        let harnessMode = 'apply';
        let externalEdited = false;
        const calls = { getLatest: 0, get: 0, apply: 0, claim: 0, generate: 0, finalize: 0, flush: 0, cancel: 0 };
        const regenerationEvents = [];
        let regenerationCancelled = false;
        const unreviewableRun = {
          ...previewRun,
          plan: { ...plan, changes: plan.changes.map((change) => ({ ...change, safetyStatus: 'pending' })) },
        };
        const claimIds = [];
        const startKeys = [];
        const startPayloads = [];
        let generatedKeyIndex = 0;
        const generatedKeys = [
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        ];
        globalThis.__nextResumeOptimizationIdempotencyKey = () => (
          generatedKeys[generatedKeyIndex++] ?? generatedKeys.at(-1)
        );
        globalThis.__resumeOptimizationHarnessService = {
          getLatest: async (requestedResumeId) => {
            calls.getLatest += 1;
            if (requestedResumeId !== 'resume-a') return null;
            if (['observer-complete', 'observer-close'].includes(harnessMode)) {
              return calls.get >= 2 ? completedRun : rescoringRun;
            }
            if (harnessMode === 'external-edit' && externalEdited) return null;
            if (harnessMode === 'cached-invalid' && calls.getLatest > 1) return null;
            if (harnessMode.startsWith('planning-')) return null;
            if (harnessMode.startsWith('regenerate-')) return unreviewableRun;
            return ['checkpoint', 'hard-refresh', 'external-edit', 'claim-retry', 'cached-invalid'].includes(harnessMode)
              ? appliedRun
              : previewRun;
          },
          get: async (_runId, options) => {
            calls.get += 1;
            if (harnessMode.startsWith('regenerate-')) {
              globalThis.__regenerationPendingSignal = options?.signal;
              if (harnessMode === 'regenerate-close-get') {
                await new Promise((resolve) => { globalThis.__releaseRegenerationCloseStage = resolve; });
              }
              if (harnessMode === 'regenerate-refreshed') return previewRun;
              return regenerationCancelled ? { ...unreviewableRun, status: 'cancelled' } : unreviewableRun;
            }
            if (['observer-complete', 'observer-close'].includes(harnessMode)) {
              return calls.get === 1 ? rescoringRun : completedRun;
            }
            return appliedRun;
          },
          apply: async (_runId, _payload, options) => {
            calls.apply += 1;
            if (harnessMode === 'switch') {
              return await new Promise((_resolve, reject) => {
                const rejectAbort = () => {
                  const error = new Error('aborted by owner switch');
                  error.name = 'AbortError';
                  reject(error);
                };
                if (options.signal.aborted) rejectAbort();
                else options.signal.addEventListener('abort', rejectAbort, { once: true });
              });
            }
            return { run: appliedRun, resumeUpdatedAt: appliedRun.appliedResumeUpdatedAt };
          },
          claimRescore: async (_runId, payload) => {
            calls.claim += 1;
            claimIds.push(payload.claimId);
            return appliedRun;
          },
          start: async (payload, options) => {
            startKeys.push(options.idempotencyKey);
            startPayloads.push(payload);
            if (harnessMode.startsWith('regenerate-')) {
              regenerationEvents.push('start');
              globalThis.__regenerationPendingSignal = options.signal;
              if (harnessMode === 'regenerate-close-start') {
                await new Promise((resolve) => { globalThis.__releaseRegenerationCloseStage = resolve; });
              }
              if (harnessMode === 'regenerate-start-retry' && startKeys.length === 1) {
                throw new Error('Planning response unavailable');
              }
              return { ...previewRun, id: 'run-b', sourceResumeUpdatedAt: payload.expectedResumeUpdatedAt };
            }
            const staleError = () => Object.assign(new Error('Resume changed'), {
              name: 'ResumeOptimizationServiceError',
              code: 'resume_optimization_context_stale',
              statusCode: 409,
            });
            if (harnessMode === 'planning-restored-stale') {
              if (new Date(payload.expectedResumeUpdatedAt).getTime() !== new Date('2026-09-01T00:00:03Z').getTime()) {
                throw staleError();
              }
              return previewRun;
            }
            if (harnessMode === 'planning-context-stale') {
              if (startKeys.length === 1) throw staleError();
              return previewRun;
            }
            if (['planning-network-retry', 'planning-provider-retry'].includes(harnessMode)) {
              if (startKeys.length === 1) {
                const error = new Error('Network response unavailable');
                if (harnessMode === 'planning-provider-retry') Object.assign(error, {
                  name: 'ResumeOptimizationServiceError',
                  code: 'ai_provider_unavailable',
                  statusCode: 503,
                });
                throw error;
              }
              return previewRun;
            }
            if (harnessMode === 'planning-error') {
              throw new Error('planning provider unavailable');
            }
            return startKeys.length === 1
              ? { ...previewRun, status: 'cancelled' }
              : previewRun;
          },
          finalize: async () => {
            calls.finalize += 1;
            return { run: completedRun };
          },
          cancel: async (runId, options) => {
            calls.cancel += 1;
            regenerationEvents.push('cancel');
            globalThis.__regenerationPendingSignal = options?.signal;
            if (harnessMode === 'regenerate-cancel-error' && calls.cancel === 1) {
              throw new Error('Cancellation unavailable');
            }
            regenerationCancelled = true;
            if (harnessMode === 'regenerate-cancel-retry' && calls.cancel === 1) {
              throw new Error('Cancellation response unavailable');
            }
            if (harnessMode === 'regenerate-deferred') {
              await new Promise((resolve) => { globalThis.__releaseRegenerationCancel = resolve; });
            }
            return { ...unreviewableRun, id: runId, status: 'cancelled' };
          },
        };

        const Harness = () => {
          const [inputs, setInputs] = useState(() => !['checkpoint', 'hard-refresh', 'external-edit', 'claim-retry', 'cached-invalid'].includes(harnessMode) ? {
            authUserKey: 'owner-a',
            resumeId: 'resume-a',
            sourceResumeUpdatedAt: previewRun.sourceResumeUpdatedAt,
            evaluationSignature: 'S1',
            evaluation: sourceEvaluation,
            persistedEvaluationSignature: 'S1',
            persistedEvaluation: sourceEvaluation,
            isEvaluationOutdated: false,
          } : harnessMode === 'hard-refresh' ? {
            authUserKey: 'owner-a',
            resumeId: 'resume-a',
            sourceResumeUpdatedAt: appliedRun.appliedResumeUpdatedAt,
            evaluationSignature: 'S1',
            evaluation: null,
            persistedEvaluationSignature: null,
            persistedEvaluation: null,
            isEvaluationOutdated: true,
          } : {
            authUserKey: 'owner-a',
            resumeId: 'resume-a',
            sourceResumeUpdatedAt: appliedRun.appliedResumeUpdatedAt,
            evaluationSignature: 'S2',
            evaluation: null,
            persistedEvaluationSignature: null,
            persistedEvaluation: null,
            isEvaluationOutdated: true,
          });
          const toast = useMemo(() => ({ success() {}, error() {}, info() {} }), []);
          const flow = useResumeOptimizationFlow({
            enabled: true,
            ...inputs,
            jdText: '',
            hasResumeVersionConflict: false,
            isEvaluationRunning: false,
            isPolishing: false,
            isAutoAssembling: false,
            reloadResumeContext: async () => {
              flushSync(() => setInputs((current) => ({
                ...current,
                sourceResumeUpdatedAt: appliedRun.appliedResumeUpdatedAt,
                evaluationSignature: 'S2',
                evaluation: null,
                persistedEvaluationSignature: null,
                persistedEvaluation: null,
                isEvaluationOutdated: true,
              })));
              return { status: 'success', resumeId: 'resume-a' };
            },
            generateEvaluation: async () => {
              calls.generate += 1;
              if (harnessMode === 'claim-retry' && calls.generate === 1) {
                return { status: 'error' };
              }
              flushSync(() => setInputs((current) => ({
                ...current,
                evaluation: postEvaluation,
                persistedEvaluationSignature: 'S2',
                persistedEvaluation: postEvaluation,
                isEvaluationOutdated: false,
              })));
              return { status: 'success', evaluation: postEvaluation };
            },
            flushResumeConfig: async () => {
              calls.flush += 1;
              if (harnessMode === 'regenerate-close-flush') {
                await new Promise((resolve) => { globalThis.__releaseRegenerationCloseStage = resolve; });
              }
              return '2026-09-01T00:00:03Z';
            },
            commitLatestResumeConfigIfNeeded: async () => previewRun.sourceResumeUpdatedAt,
            toast,
          });
          useLayoutEffect(() => {
            globalThis.__resumeOptimizationHarnessFlow = flow;
            globalThis.__setResumeOptimizationHarnessInputs = setInputs;
          }, [flow]);
          const output = React.createElement('output', {
            'data-ui-state': flow.uiState,
            'data-run-status': flow.run?.status ?? '',
            'data-can-resume': String(flow.canResumeLatestRun),
            'data-accepted-count': String(flow.acceptedChangeIds.length),
          });
          return React.createElement(React.Fragment, null, output,
            harnessMode.startsWith('regenerate-') && flow.uiState !== 'closed'
              ? React.createElement(ResumeOptimizationWorkspace, {
                  ...flow, surface: 'sidebar', onRequestClose: flow.closeWorkspace,
                  returnFocusRef: { current: null }, suppressReturnFocusRef: { current: false },
                  skillNameById: {}, moduleOrder: [], onViewExperience: () => {}, onOpenAutoAssembly: () => {},
                }) : null,
          );
        };

        globalThis.__seedResumeOptimizationCheckpoint = () => {
          saveResumeOptimizationPostApplyCheckpoint('owner-a', 'resume-a', {
            runId: 'run-a',
            phase: 'evaluation_ready',
            sourceEvaluationSignature: 'S2',
            evaluationReceipt: postEvaluation,
          });
        };
        globalThis.__mountResumeOptimizationHarness = (mode) => {
          harnessMode = mode;
          const container = document.createElement('div');
          document.body.append(container);
          root = createRoot(container);
          flushSync(() => root.render(React.createElement(Harness)));
        };
        globalThis.__unmountResumeOptimizationHarness = () => {
          flushSync(() => root.unmount());
          document.body.replaceChildren();
        };
        globalThis.__applyResumeOptimization = () => (
          globalThis.__resumeOptimizationHarnessFlow.applyAcceptedChanges()
        );
        globalThis.__selectResumeOptimizationChange = () => (
          globalThis.__resumeOptimizationHarnessFlow.toggleChange('change-a')
        );
        globalThis.__beginResumeOptimizationApply = () => {
          globalThis.__pendingResumeOptimizationApply = (
            globalThis.__resumeOptimizationHarnessFlow.applyAcceptedChanges()
          );
        };
        globalThis.__switchResumeOptimizationOwner = () => {
          flushSync(() => globalThis.__setResumeOptimizationHarnessInputs((current) => ({
            ...current,
            authUserKey: 'owner-b',
            resumeId: 'resume-b',
          })));
        };
        globalThis.__retryResumeOptimizationRescore = () => (
          globalThis.__resumeOptimizationHarnessFlow.retryRescore()
        );
        globalThis.__startResumeOptimization = () => (
          globalThis.__resumeOptimizationHarnessFlow.startOptimization()
        );
        globalThis.__reopenResumeOptimization = () => (
          globalThis.__resumeOptimizationHarnessFlow.reopenLatestRun()
        );
        globalThis.__closeResumeOptimization = () => (
          globalThis.__resumeOptimizationHarnessFlow.closeWorkspace()
        );
        globalThis.__refreshResumeOptimizationEvaluationInputs = () => {
          flushSync(() => globalThis.__setResumeOptimizationHarnessInputs((current) => ({
            ...current,
            evaluation: current.evaluation ? { ...current.evaluation } : current.evaluation,
            persistedEvaluation: current.persistedEvaluation
              ? { ...current.persistedEvaluation }
              : current.persistedEvaluation,
          })));
        };
        globalThis.__beginResumeOptimizationRescore = () => {
          globalThis.__pendingResumeOptimizationRescore = (
            globalThis.__resumeOptimizationHarnessFlow.retryRescore()
          );
        };
        globalThis.__publishPersistedResumeOptimizationEvaluation = () => {
          flushSync(() => globalThis.__setResumeOptimizationHarnessInputs((current) => ({
            ...current,
            evaluation: postEvaluation,
            persistedEvaluationSignature: 'S2',
            persistedEvaluation: postEvaluation,
            isEvaluationOutdated: false,
          })));
        };
        globalThis.__publishExternalResumeEdit = () => {
          externalEdited = true;
          flushSync(() => globalThis.__setResumeOptimizationHarnessInputs((current) => ({
            ...current,
            sourceResumeUpdatedAt: '2026-09-01T00:00:09Z',
            evaluationSignature: 'S3',
            evaluation: postEvaluation,
            persistedEvaluationSignature: 'S3',
            persistedEvaluation: postEvaluation,
            isEvaluationOutdated: false,
          })));
        };
        globalThis.__resumeOptimizationHarnessCalls = calls;
        globalThis.__resumeOptimizationHarnessClaimIds = claimIds;
        globalThis.__resumeOptimizationHarnessStartKeys = startKeys;
        globalThis.__resumeOptimizationHarnessStartPayloads = startPayloads;
        globalThis.__regenerationEvents = regenerationEvents;
      `,
    },
    bundle: true,
    format: 'iife',
    platform: 'browser',
    write: false,
    plugins: [{
      name: 'resume-optimization-mounted-hook-stubs',
      setup(buildContext) {
        buildContext.onResolve({ filter: /useAuthOwnerOperationGuard$/ }, () => ({ path: 'owner', namespace: 'stub' }));
        buildContext.onLoad({ filter: /^owner$/, namespace: 'stub' }, () => ({
          loader: 'js',
          contents: `
            const guards = new Map();
            export const useAuthOwnerOperationGuard = (owner) => {
              if (!guards.has(owner)) guards.set(owner, {
                beginOperation: async () => {
                  if (globalThis.__pauseNextOwnerOperation) {
                    globalThis.__pauseNextOwnerOperation = false;
                    await new Promise((resolve) => { globalThis.__releaseRegenerationCloseStage = resolve; });
                  }
                  return { expectedAuthCacheKey: owner };
                },
                assertOperationCurrent: async () => undefined,
              });
              return guards.get(owner);
            };
          `,
        }));
        buildContext.onResolve({ filter: /resumeOptimizationService$/ }, () => ({ path: 'service', namespace: 'stub' }));
        buildContext.onLoad({ filter: /^service$/, namespace: 'stub' }, () => ({
          loader: 'js',
          contents: `
            const service = () => globalThis.__resumeOptimizationHarnessService;
            export const createResumeOptimizationIdempotencyKey = () => (
              globalThis.__nextResumeOptimizationIdempotencyKey?.()
              ?? 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
            );
            export const isResumeOptimizationServiceError = (error) => (
              error?.name === 'ResumeOptimizationServiceError'
            );
            export const resumeOptimizationService = new Proxy({}, {
              get: (_target, key) => (...args) => service()[key](...args),
            });
          `,
        }));
        buildContext.onResolve({ filter: /analyticsTracker$/ }, () => ({ path: 'analytics', namespace: 'stub' }));
        buildContext.onLoad({ filter: /^analytics$/, namespace: 'stub' }, () => ({
          loader: 'js',
          contents: `
            export const toResumeOptimizationAnalyticsFailureCode = () => undefined;
            export const trackResumeOptimizationApplyResult = () => undefined;
            export const trackResumeOptimizationApplyStart = () => undefined;
            export const trackResumeOptimizationChangeToggle = () => undefined;
            export const trackResumeOptimizationPlanResult = () => undefined;
            export const trackResumeOptimizationPlanStart = () => undefined;
            export const trackResumeOptimizationBankSuggestionClick = () => undefined;
            export const trackResumeOptimizationPreviewView = () => undefined;
            export const trackResumeOptimizationQuestionsView = () => undefined;
            export const trackResumeOptimizationQuestionsSubmit = () => undefined;
            export const trackResumeOptimizationRescoreResult = () => undefined;
            export const trackResumeOptimizationRevertResult = () => undefined;
          `,
        }));
      },
    }],
  });
  return result.outputFiles[0].text;
};

const changes = [
  { changeId: 'allowed-a', safetyStatus: 'allowed', actionKind: 'rewrite_now', targetedValue: 'A' },
  { changeId: 'allowed-b', safetyStatus: 'allowed', actionKind: 'ask_user', targetedValue: 'B' },
  { changeId: 'blocked', safetyStatus: 'blocked', actionKind: 'rewrite_now', targetedValue: 'X' },
  { changeId: 'null-target', safetyStatus: 'allowed', actionKind: 'rewrite_now', targetedValue: null },
];

test('apply attempt synchronously freezes only selectable IDs', async () => {
  const { freezeResumeOptimizationApplyAttempt } = await importFlow();
  const attempt = freezeResumeOptimizationApplyAttempt({
    id: 'run-a',
    sourceResumeUpdatedAt: '2026-09-01T00:00:00Z',
    plan: { changes },
    result: null,
  }, ['allowed-b', 'blocked', 'allowed-a', 'allowed-b', 'null-target']);
  assert.deepEqual(attempt, {
    runId: 'run-a',
    acceptedChangeIds: ['allowed-b', 'allowed-a'],
    sourceResumeUpdatedAt: '2026-09-01T00:00:00Z',
    previewReadyConfirmations: 0,
  });
  assert.equal(freezeResumeOptimizationApplyAttempt({
    id: 'run-a',
    sourceResumeUpdatedAt: '2026-09-01T00:00:00Z',
    plan: { changes },
    result: null,
  }, ['blocked']), null);
});

test('source orders one apply, reload, one evaluation receipt, v3 commit, then finalize', () => {
  const hook = read('views/ResumeEditor/hooks/useResumeOptimizationFlow.ts');
  const applyBlock = hook.slice(hook.indexOf('const applyAcceptedChanges'), hook.indexOf('const retryRescore'));
  const postScoreBlock = hook.slice(hook.indexOf('const runPostApplyEvaluation'), hook.indexOf('const applyAcceptedChanges'));

  const publishAttempt = applyBlock.indexOf('applyAttemptRef.current =');
  const beginOperation = applyBlock.indexOf('await beginHandledOperation');
  const saveBarrier = applyBlock.indexOf('commitLatestResumeConfigIfNeeded');
  const apply = applyBlock.indexOf('resumeOptimizationService.apply');
  const reload = applyBlock.indexOf('reloadResumeContext');
  assert.ok(publishAttempt >= 0 && publishAttempt < beginOperation);
  assert.ok(beginOperation < saveBarrier && saveBarrier < apply && apply < reload);
  assert.match(applyBlock, /acceptedChangeIds: attempt\.acceptedChangeIds/);
  assert.match(applyBlock, /expectedResumeUpdatedAt: committedSourceUpdatedAt/);

  const generate = postScoreBlock.indexOf('latestGenerateEvaluationRef.current');
  const checkpointEvaluation = postScoreBlock.indexOf("phase: 'evaluation_ready'", generate);
  const receipt = postScoreBlock.indexOf('waitForPersistedEvaluationReceipt', checkpointEvaluation);
  const flush = postScoreBlock.indexOf('latestFlushResumeConfigRef.current', receipt);
  const selfOwnedV3 = postScoreBlock.indexOf('markSelfOwnedResumeTimestamp', flush);
  const checkpointReport = postScoreBlock.indexOf("phase: 'report_committed'", selfOwnedV3);
  const finalize = postScoreBlock.indexOf('resumeOptimizationService.finalize', checkpointReport);
  assert.ok(generate >= 0 && generate < checkpointEvaluation);
  assert.ok(checkpointEvaluation < receipt && receipt < flush && flush < selfOwnedV3);
  assert.ok(selfOwnedV3 < checkpointReport && checkpointReport < finalize);
  assert.doesNotMatch(postScoreBlock, /resumeOptimizationService\.revert/);
});

test('checkpoint retries skip completed phases, GET before uncertain finalize, and never replay apply', () => {
  const hook = read('views/ResumeEditor/hooks/useResumeOptimizationFlow.ts');
  const postScoreBlock = hook.slice(hook.indexOf('const runPostApplyEvaluation'), hook.indexOf('const applyAcceptedChanges'));
  const retryBlock = hook.slice(hook.indexOf('const retryRescore'), hook.indexOf('const revertRun'));

  assert.match(hook, /postApplyCheckpointRef = useRef/);
  assert.match(postScoreBlock, /checkpoint\.phase === 'needs_evaluation'/);
  assert.match(postScoreBlock, /checkpoint\.phase === 'evaluation_ready'/);
  assert.match(postScoreBlock, /checkpoint\.phase === 'report_committed'/);
  assert.ok(retryBlock.indexOf('resumeOptimizationService.get') < retryBlock.indexOf('runPostApplyEvaluation'));
  assert.match(retryBlock, /authoritativeRun\.status === 'completed'/);
  assert.doesNotMatch(retryBlock, /resumeOptimizationService\.apply/);
  assert.doesNotMatch(postScoreBlock, /resumeOptimizationService\.apply/);
  const pendingReset = postScoreBlock.indexOf('EVALUATION_PENDING_ERROR_CODE');
  const pendingCheckpoint = postScoreBlock.indexOf("phase: 'needs_evaluation'", pendingReset);
  const authoritativeGet = postScoreBlock.indexOf('resumeOptimizationService.get', pendingReset);
  assert.ok(pendingReset >= 0 && pendingReset < pendingCheckpoint && pendingCheckpoint < authoritativeGet);
});

test('save conflicts fail closed and revert uses the latest-snapshot barrier before mutation', () => {
  const hook = read('views/ResumeEditor/hooks/useResumeOptimizationFlow.ts');
  const revertBlock = hook.slice(hook.indexOf('const revertRun'), hook.indexOf('const cancelRun'));
  const errorHandler = hook.slice(hook.indexOf('const handleOperationError'), hook.indexOf('const beginHandledOperation'));
  const source = read('hooks/useResumeData.ts');

  assert.match(hook, /isResumeVersionConflictLike/);
  assert.match(hook, /resume_optimization_evaluation_pending/);
  assert.match(hook, /hasResumeVersionConflict[\s\S]*invalidateGeneration\(false, true\)/);
  assert.match(errorHandler, /applyAttemptRef\.current = null/);
  assert.match(errorHandler, /clearPostApplyCheckpoint\(\)/);
  assert.ok(revertBlock.indexOf('commitLatestResumeConfigIfNeeded') < revertBlock.indexOf('resumeOptimizationService.revert'));
  assert.ok(revertBlock.indexOf('resumeOptimizationService.revert') < revertBlock.indexOf('reloadResumeContext'));
  assert.match(revertBlock, /setUiState\('closed'\)/);
  assert.match(source, /commitLatestResumeConfigIfNeeded/);
  assert.match(source, /latestEffectiveConfigSnapshotRef\.current/);
  assert.match(source, /pendingResumeSaveDrainRef\.current\(\)/);
});

test('uncertain apply retries only the authoritative GET and never blindly replays apply', () => {
  const hook = read('views/ResumeEditor/hooks/useResumeOptimizationFlow.ts');
  const recoverStart = hook.indexOf('const recoverUncertainApplyAttempt');
  const applyStart = hook.indexOf('const applyAcceptedChanges');
  const retryStart = hook.indexOf('const retryRescore');

  assert.ok(recoverStart >= 0 && recoverStart < applyStart);
  const recoverBlock = hook.slice(recoverStart, applyStart);
  const applyBlock = hook.slice(applyStart, retryStart);
  const backoff = recoverBlock.indexOf('await waitForResumeOptimizationApplyConfirmationBackoff');
  const authoritativeRead = recoverBlock.indexOf('resumeOptimizationService.get(attempt.runId');
  assert.ok(backoff >= 0 && backoff < authoritativeRead);
  const backoffHelper = hook.slice(
    hook.indexOf('const waitForResumeOptimizationApplyConfirmationBackoff'),
    hook.indexOf('const rawHttpStatus'),
  );
  assert.match(backoffHelper, /\}, 500\);/);
  assert.match(backoffHelper, /signal\.addEventListener\('abort'/);
  assert.match(recoverBlock, /resumeOptimizationService\.get\(attempt\.runId/);
  assert.doesNotMatch(recoverBlock, /resumeOptimizationService\.apply/);
  assert.match(recoverBlock, /authoritativeRun\.status === 'preview_ready'[\s\S]*applyAttemptRef\.current = null/);
  assert.match(recoverBlock, /previewReadyConfirmations[\s\S]*< 2/);
  const previewBranch = recoverBlock.slice(
    recoverBlock.indexOf("authoritativeRun.status === 'preview_ready'"),
    recoverBlock.indexOf("authoritativeRun.status === 'completed'"),
  );
  assert.ok(
    previewBranch.indexOf('previewReadyConfirmations < 2')
      < previewBranch.indexOf('applyAttemptRef.current = null'),
  );
  assert.match(
    recoverBlock,
    /authoritativeRun\.status === 'preview_ready'[\s\S]*setUiState\('preview'\)[\s\S]*if \(originalCause !== undefined\)/,
  );
  assert.match(recoverBlock, /authoritativeRun\.status === 'applied'/);
  assert.match(recoverBlock, /authoritativeRun\.appliedResumeUpdatedAt/);
  assert.doesNotMatch(recoverBlock, /canonicalizeResumeOptimizationFlowTimestamp\(\s*authoritativeRun\.appliedAt/);
  assert.match(recoverBlock, /authoritativeRun\.status === 'completed'/);
  assert.match(recoverBlock, /catch \(cause\)[\s\S]*applyAttemptRef\.current === attempt/);

  const recoverPending = applyBlock.indexOf('const pendingAttempt = applyAttemptRef.current');
  const recover = applyBlock.indexOf('recoverUncertainApplyAttempt', recoverPending);
  const freeze = applyBlock.indexOf('freezeResumeOptimizationApplyAttempt');
  assert.ok(recoverPending >= 0 && recoverPending < recover && recover < freeze);
});

test('applied reload cannot resolve the source waiter from the pre-reload evaluation signature', () => {
  const hook = read('views/ResumeEditor/hooks/useResumeOptimizationFlow.ts');
  const waiterBlock = hook.slice(
    hook.indexOf('const waitForCommittedSource'),
    hook.indexOf('const waitForPersistedEvaluationReceipt'),
  );
  const layoutBlock = hook.slice(
    hook.indexOf('useLayoutEffect(() => {'),
    hook.indexOf('useLayoutEffect(() => {', hook.indexOf('useLayoutEffect(() => {') + 1),
  );
  assert.match(waiterBlock, /latest\.evaluationSignature !== previousEvaluationSignature/);
  assert.match(layoutBlock, /evaluationSignature !== waiter\.previousEvaluationSignature/);
  const settleBlock = hook.slice(
    hook.indexOf('const settleCommittedSourceAfterReload'),
    hook.indexOf('const waitForPersistedEvaluationReceipt'),
  );
  assert.match(waiterBlock, /minimumInputRevision/);
  assert.match(settleBlock, /latestInputsRevisionRef\.current >= waiter\.minimumInputRevision/);

  for (const [start, end] of [
    ['const applyAcceptedChanges', 'const retryRescore'],
    ['const retryRescore', 'const revertRun'],
  ]) {
    const block = hook.slice(hook.indexOf(start), hook.indexOf(end));
    const reload = block.indexOf('reloadResumeContext');
    const settle = block.indexOf('settleCommittedSourceAfterReload', reload);
    const awaitCommit = block.indexOf('await sourceCommitPromise', settle);
    assert.ok(reload >= 0 && reload < settle && settle < awaitCommit, `${start} must settle S2 after reload`);
  }
});

test('mounted apply owns reload/signature changes without hydration aborting or stealing its generation', async (t) => {
  const browser = await launchMountedHookBrowser(t);
  if (!browser) return;
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent('<!doctype html><html><body></body></html>');
  await page.addScriptTag({ content: await buildMountedHookHarness() });
  await page.evaluate(() => globalThis.__mountResumeOptimizationHarness('apply'));
  await page.waitForFunction(() => (
    document.querySelector('output')?.dataset.runStatus === 'preview_ready'
  ));
  await page.evaluate(() => globalThis.__selectResumeOptimizationChange());
  await page.waitForFunction(() => (
    document.querySelector('output')?.dataset.acceptedCount === '1'
  ));

  const result = await page.evaluate(() => globalThis.__applyResumeOptimization());
  const observed = await page.evaluate(() => ({
    uiState: document.querySelector('output')?.dataset.uiState,
    runStatus: document.querySelector('output')?.dataset.runStatus,
    calls: { ...globalThis.__resumeOptimizationHarnessCalls },
  }));

  assert.equal(result?.status ?? null, 'completed', JSON.stringify(observed));
  assert.equal(observed.uiState, 'completed');
  assert.equal(observed.runStatus, 'completed');
  assert.deepEqual(observed.calls, {
    getLatest: 1,
    get: 0,
    apply: 1,
    claim: 2,
    generate: 1,
    finalize: 1,
    flush: 1,
    cancel: 0,
  });
});

test('mounted owner switch still aborts an in-flight apply and clears the old run', async (t) => {
  const browser = await launchMountedHookBrowser(t);
  if (!browser) return;
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent('<!doctype html><html><body></body></html>');
  await page.addScriptTag({ content: await buildMountedHookHarness() });
  await page.evaluate(() => globalThis.__mountResumeOptimizationHarness('switch'));
  await page.waitForFunction(() => (
    document.querySelector('output')?.dataset.runStatus === 'preview_ready'
  ));
  await page.evaluate(() => globalThis.__selectResumeOptimizationChange());
  await page.waitForFunction(() => (
    document.querySelector('output')?.dataset.acceptedCount === '1'
  ));
  await page.evaluate(() => globalThis.__beginResumeOptimizationApply());
  await page.waitForFunction(() => globalThis.__resumeOptimizationHarnessCalls.apply === 1);
  await page.evaluate(() => globalThis.__switchResumeOptimizationOwner());

  const result = await page.evaluate(() => globalThis.__pendingResumeOptimizationApply);
  await page.waitForFunction(() => (
    document.querySelector('output')?.dataset.uiState === 'closed'
    && document.querySelector('output')?.dataset.runStatus === ''
  ));
  const calls = await page.evaluate(() => ({ ...globalThis.__resumeOptimizationHarnessCalls }));
  assert.equal(result, null);
  assert.equal(calls.apply, 1);
  assert.equal(calls.claim, 0);
  assert.equal(calls.generate, 0);
  assert.equal(calls.finalize, 0);
});

test('post-apply checkpoint survives a hook remount and restores the exact evaluation receipt', async () => {
  const {
    clearResumeOptimizationPostApplyCheckpoint,
    doesResumeOptimizationEvaluationReceiptMatch,
    readResumeOptimizationPostApplyCheckpoint,
    saveResumeOptimizationPostApplyCheckpoint,
  } = await importFlow();
  const evaluationReceipt = {
    evaluationVersion: 'guidance_audit_v1', overallBand: 'adequate',
    auditReceipt: {
      receiptId: 'receipt-2', inputHash: 'post-input-hash', tasksHash: 'tasks-hash',
      judgmentsHash: 'judgments-hash', rubricHash: 'rubric-hash', schemaHash: 'schema-hash',
      auditVersion: 'guidance_task_audit_v1',
    },
  };
  const checkpoint = {
    runId: 'run-a',
    phase: 'evaluation_ready',
    sourceEvaluationSignature: 'S2',
    evaluationReceipt,
  };

  saveResumeOptimizationPostApplyCheckpoint('owner-a', 'resume-a', checkpoint);
  assert.deepEqual(
    readResumeOptimizationPostApplyCheckpoint('owner-a', 'resume-a', 'run-a'),
    checkpoint,
  );
  assert.equal(
    readResumeOptimizationPostApplyCheckpoint('owner-a', 'resume-b', 'run-a'),
    null,
  );
  const deserializedReceipt = JSON.parse(JSON.stringify(evaluationReceipt));
  assert.notEqual(deserializedReceipt, evaluationReceipt);
  assert.equal(
    doesResumeOptimizationEvaluationReceiptMatch('S2', deserializedReceipt, 'S2', evaluationReceipt),
    true,
  );
  assert.equal(
    doesResumeOptimizationEvaluationReceiptMatch(
      'S2',
      { ...deserializedReceipt, confidence: 'low' },
      'S2',
      evaluationReceipt,
    ),
    false,
  );
  clearResumeOptimizationPostApplyCheckpoint('owner-a', 'resume-a');
  assert.equal(
    readResumeOptimizationPostApplyCheckpoint('owner-a', 'resume-a', 'run-a'),
    null,
  );

  const hook = read('views/ResumeEditor/hooks/useResumeOptimizationFlow.ts');
  const applyRunBlock = hook.slice(
    hook.indexOf('const applyRunToState'),
    hook.indexOf('const markSelfOwnedResumeTimestamp'),
  );
  assert.match(applyRunBlock, /readResumeOptimizationPostApplyCheckpoint/);
  assert.match(applyRunBlock, /latestInputsRef\.current\.hasTrustedEvaluation/);
  assert.match(
    applyRunBlock,
    /!resumeOptimizationFlowTimestampsEqual\([\s\S]*nextRun\.sourceResumeUpdatedAt[\s\S]*evaluationSignature !== nextRun\.sourceEvaluationSignature/,
  );
  assert.match(
    applyRunBlock,
    /phase: 'evaluation_ready'[\s\S]*evaluationReceipt: latestInputsRef\.current\.persistedEvaluation/,
  );
  assert.match(hook, /saveResumeOptimizationPostApplyCheckpoint/);
  assert.match(hook, /clearResumeOptimizationPostApplyCheckpoint/);
  assert.match(hook, /canonicalStringify/);
  assert.doesNotMatch(hook, /persistedEvaluation === evaluationWaiter\.evaluationReceipt/);
});

test('mounted applied-run remount resumes from module checkpoint without trusting or rebilling the source report', async (t) => {
  const browser = await launchMountedHookBrowser(t);
  if (!browser) return;
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent('<!doctype html><html><body></body></html>');
  await page.addScriptTag({ content: await buildMountedHookHarness() });
  await page.evaluate(() => {
    globalThis.__seedResumeOptimizationCheckpoint();
    globalThis.__mountResumeOptimizationHarness('checkpoint');
  });
  await page.waitForFunction(() => (
    document.querySelector('output')?.dataset.runStatus === 'applied'
  ));
  await page.evaluate(() => globalThis.__unmountResumeOptimizationHarness());
  await page.evaluate(() => globalThis.__mountResumeOptimizationHarness('checkpoint'));
  await page.waitForFunction(() => (
    document.querySelector('output')?.dataset.runStatus === 'applied'
  ));

  assert.equal(
    await page.locator('output').getAttribute('data-can-resume'),
    'true',
    'an applied run must remain enterable when the old source evaluation is no longer trusted',
  );
  await page.evaluate(() => globalThis.__beginResumeOptimizationRescore());
  await page.waitForTimeout(50);
  assert.equal(
    await page.evaluate(() => globalThis.__resumeOptimizationHarnessCalls.generate),
    0,
    'hydration must restore the module checkpoint before retry decides whether to regenerate',
  );
  await page.evaluate(() => globalThis.__publishPersistedResumeOptimizationEvaluation());
  const result = await page.evaluate(() => globalThis.__pendingResumeOptimizationRescore);
  const observed = await page.evaluate(() => ({
    calls: { ...globalThis.__resumeOptimizationHarnessCalls },
  }));
  assert.equal(result?.status ?? null, 'completed', JSON.stringify(observed));
  assert.equal(observed.calls.generate, 0, 'the recovered evaluation_ready receipt must not be regenerated');
  assert.equal(observed.calls.claim, 2, 'the recovered receipt claims and renews its server-side run lease');
  assert.equal(observed.calls.finalize, 1);
  assert.equal(observed.calls.flush, 1);
});

test('hydration lets applyRunToState observe a new run before publishing the latest ref', () => {
  const hook = read('views/ResumeEditor/hooks/useResumeOptimizationFlow.ts');
  const hydrationBlock = hook.slice(
    hook.indexOf('useEffect(() => {', hook.indexOf('const beginHandledOperation')),
    hook.indexOf('const isFlowBusy'),
  );
  const applyRun = hydrationBlock.search(/applyRunToState\(\s*latest,\s*true,\s*false,\s*observedRunPresentationDismissedRef\.current \? 'closed' : resolvedHydratedUiState/);
  assert.ok(applyRun >= 0);
  assert.doesNotMatch(hydrationBlock.slice(0, applyRun), /latestRunRef\.current = latest/);
  assert.match(
    hydrationBlock,
    /TERMINAL_RESUME_OPTIMIZATION_STATUSES\.has\(latest\.status\)[\s\S]*latestRunRef\.current = null/,
  );
});

test('an applied run without a checkpoint reloads the explicit applied version before evaluation', () => {
  const hook = read('views/ResumeEditor/hooks/useResumeOptimizationFlow.ts');
  const retryBlock = hook.slice(hook.indexOf('const retryRescore'), hook.indexOf('const revertRun'));
  const missingCheckpoint = retryBlock.indexOf('!checkpoint || checkpoint.runId !== authoritativeRun.id');
  const explicitToken = retryBlock.indexOf('authoritativeRun.appliedResumeUpdatedAt', missingCheckpoint);
  const needsReload = retryBlock.indexOf("phase: 'needs_reload'", explicitToken);
  const reload = retryBlock.indexOf('reloadResumeContext', needsReload);
  const needsEvaluation = retryBlock.indexOf("phase: 'needs_evaluation'", reload);

  assert.ok(missingCheckpoint >= 0 && missingCheckpoint < explicitToken);
  assert.ok(explicitToken < needsReload && needsReload < reload && reload < needsEvaluation);
});

test('mounted hard-refresh applied run without checkpoint claims once and still completes', async (t) => {
  const browser = await launchMountedHookBrowser(t);
  if (!browser) return;
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent('<!doctype html><html><body></body></html>');
  await page.addScriptTag({ content: await buildMountedHookHarness() });
  await page.evaluate(() => globalThis.__mountResumeOptimizationHarness('hard-refresh'));
  await page.waitForFunction(() => document.querySelector('output')?.dataset.runStatus === 'applied');

  const result = await page.evaluate(() => globalThis.__retryResumeOptimizationRescore());
  const calls = await page.evaluate(() => ({ ...globalThis.__resumeOptimizationHarnessCalls }));
  assert.equal(result?.status ?? null, 'completed', JSON.stringify(calls));
  assert.equal(calls.claim, 2);
  assert.equal(calls.generate, 1);
  assert.equal(calls.finalize, 1);
});

test('mounted external content edit makes an old applied run non-resumable', async (t) => {
  const browser = await launchMountedHookBrowser(t);
  if (!browser) return;
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent('<!doctype html><html><body></body></html>');
  await page.addScriptTag({ content: await buildMountedHookHarness() });
  await page.evaluate(() => globalThis.__mountResumeOptimizationHarness('external-edit'));
  await page.waitForFunction(() => document.querySelector('output')?.dataset.canResume === 'true');
  await page.evaluate(() => globalThis.__publishExternalResumeEdit());
  await page.waitForFunction(() => (
    document.querySelector('output')?.dataset.canResume === 'false'
    && document.querySelector('output')?.dataset.runStatus === ''
  ));

  assert.equal(await page.locator('output').getAttribute('data-can-resume'), 'false');
});

test('mounted rescore failure remount reuses the session-scoped claim UUID', async (t) => {
  const browser = await launchMountedHookBrowser(t);
  if (!browser) return;
  t.after(() => browser.close());
  const page = await createSameOriginHarnessPage(browser);
  await page.evaluate(() => globalThis.__mountResumeOptimizationHarness('claim-retry'));
  await page.waitForFunction(() => document.querySelector('output')?.dataset.runStatus === 'applied');

  assert.equal(await page.evaluate(() => globalThis.__retryResumeOptimizationRescore()), null);
  await page.evaluate(() => globalThis.__unmountResumeOptimizationHarness());
  await page.evaluate(() => globalThis.__mountResumeOptimizationHarness('claim-retry'));
  await page.waitForFunction(() => document.querySelector('output')?.dataset.runStatus === 'applied');
  const result = await page.evaluate(() => globalThis.__retryResumeOptimizationRescore());
  const claimIds = await page.evaluate(() => [...globalThis.__resumeOptimizationHarnessClaimIds]);

  assert.equal(result?.status ?? null, 'completed');
  assert.equal(claimIds.length, 3);
  assert.ok(claimIds.every((claimId) => claimId === claimIds[0]));
  assert.match(claimIds[0], /^[0-9a-f-]{36}$/);
});

for (const mode of ['regenerate-success', 'regenerate-cancel-error', 'regenerate-cancel-retry', 'regenerate-start-retry']) {
  test(`mounted unreviewable plan offers regeneration and recovers ${mode}`, async (t) => {
    const browser = await launchMountedHookBrowser(t);
    if (!browser) return;
    t.after(() => browser.close());
    const page = await createSameOriginHarnessPage(browser);
    await page.evaluate((mode) => globalThis.__mountResumeOptimizationHarness(mode), mode);
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.setDefaultTimeout(5000);
    await page.waitForFunction(() => document.querySelector('output')?.dataset.uiState === 'preview');
    // Closing and reopening must still expose the actual recovery action.
    await page.evaluate(() => globalThis.__closeResumeOptimization());
    await page.evaluate(() => globalThis.__reopenResumeOptimization());
    const regenerate = page.getByRole('button', { name: '重新生成优化方案', exact: true });
    assert.equal(await regenerate.count(), 1);
    assert.equal(await regenerate.isEnabled(), true);
    await regenerate.click();
    if (mode !== 'regenerate-success') {
      await page.waitForFunction(() => document.querySelector('output')?.dataset.uiState === 'error');
      const events = await page.evaluate(() => [...globalThis.__regenerationEvents]);
      assert.deepEqual(events, mode.startsWith('regenerate-cancel-') ? ['cancel'] : ['cancel', 'start']);
      await page.getByRole('button', {
        name: mode.startsWith('regenerate-cancel-') ? '重新生成优化方案' : '重试生成方案', exact: true,
      }).click();
    }
    await page.waitForFunction(() => globalThis.__resumeOptimizationHarnessFlow.run?.id === 'run-b').catch(async (error) => {
      throw new Error(JSON.stringify({ pageErrors, state: await page.evaluate(() => ({
        uiState: globalThis.__resumeOptimizationHarnessFlow.uiState,
        run: globalThis.__resumeOptimizationHarnessFlow.run?.id,
        error: globalThis.__resumeOptimizationHarnessFlow.error,
        events: globalThis.__regenerationEvents,
      })) }), { cause: error });
    });
    const actual = await page.evaluate(() => ({
      events: [...globalThis.__regenerationEvents],
      keys: [...globalThis.__resumeOptimizationHarnessStartKeys],
      calls: globalThis.__resumeOptimizationHarnessCalls,
    }));
    assert.deepEqual(actual.events, mode === 'regenerate-cancel-error'
      ? ['cancel', 'cancel', 'start'] : mode === 'regenerate-start-retry'
        ? ['cancel', 'start', 'start'] : ['cancel', 'start']);
    if (actual.keys.length === 2) assert.equal(actual.keys[0], actual.keys[1]);
    assert.equal(actual.calls.apply, 0);
    assert.deepEqual(pageErrors, []);
  });
}

test('mounted regeneration waits for cancellation and ignores duplicate clicks', async (t) => {
  const browser = await launchMountedHookBrowser(t);
  if (!browser) return;
  t.after(() => browser.close());
  const page = await createSameOriginHarnessPage(browser);
  await page.evaluate(() => globalThis.__mountResumeOptimizationHarness('regenerate-deferred'));
  page.setDefaultTimeout(5000);
  await page.waitForFunction(() => document.querySelector('output')?.dataset.uiState === 'preview');
  await page.evaluate(() => {
    const flow = globalThis.__resumeOptimizationHarnessFlow;
    globalThis.__regenerationPromise = flow.startOptimization({ replaceUnreviewableRun: true });
    void flow.startOptimization({ replaceUnreviewableRun: true });
  });
  await page.waitForFunction(() => typeof globalThis.__releaseRegenerationCancel === 'function');
  assert.deepEqual(await page.evaluate(() => [...globalThis.__regenerationEvents]), ['cancel']);
  await page.evaluate(() => globalThis.__releaseRegenerationCancel());
  await page.evaluate(() => globalThis.__regenerationPromise);
  assert.deepEqual(await page.evaluate(() => [...globalThis.__regenerationEvents]), ['cancel', 'start']);
});

for (const { stage, confirmClose } of ['auth', 'get', 'cancel', 'flush', 'start'].flatMap(
  (stage) => [true, false].map((confirmClose) => ({ stage, confirmClose })),
)) {
  test(`mounted regeneration close ${confirmClose ? 'cancels' : 'continues'} the pending ${stage}`, async (t) => {
    const browser = await launchMountedHookBrowser(t);
    if (!browser) return;
    t.after(() => browser.close());
    const page = await createSameOriginHarnessPage(browser);
    page.setDefaultTimeout(5000);
    await page.evaluate((mode) => globalThis.__mountResumeOptimizationHarness(mode),
      stage === 'cancel' ? 'regenerate-deferred' : `regenerate-close-${stage}`);
    await page.waitForFunction(() => document.querySelector('output')?.dataset.uiState === 'preview');
    await page.evaluate((stage) => {
      // A caller retained before the React update must still see the active operation.
      globalThis.__capturedClose = globalThis.__resumeOptimizationHarnessFlow.closeWorkspace;
      globalThis.__pauseNextOwnerOperation = stage === 'auth';
      globalThis.__regenerationPromise = globalThis.__resumeOptimizationHarnessFlow.startOptimization({ replaceUnreviewableRun: true });
    }, stage);
    await page.waitForFunction(() => typeof (globalThis.__releaseRegenerationCancel
      ?? globalThis.__releaseRegenerationCloseStage) === 'function');
    const dialogs = [];
    page.on('dialog', async (dialog) => {
      dialogs.push(dialog.message());
      if (confirmClose) await dialog.accept();
      else await dialog.dismiss();
    });
    const closed = await page.evaluate(() => globalThis.__capturedClose());
    assert.equal(dialogs.length, 1);
    assert.equal(closed, confirmClose);
    if (stage !== 'auth') {
      assert.equal(await page.evaluate(() => globalThis.__regenerationPendingSignal.aborted), confirmClose);
    }
    await page.evaluate(() => (globalThis.__releaseRegenerationCancel
      ?? globalThis.__releaseRegenerationCloseStage)());
    const result = await page.evaluate(() => globalThis.__regenerationPromise);
    if (confirmClose) {
      assert.equal(result, null);
      assert.deepEqual(await page.evaluate(() => [...globalThis.__regenerationEvents]),
        ['auth', 'get'].includes(stage) ? [] : stage === 'start' ? ['cancel', 'start'] : ['cancel']);
      assert.equal(await page.evaluate(() => globalThis.__resumeOptimizationHarnessFlow.getLatestUiState()), 'closed');
    } else {
      assert.equal(result?.id, 'run-b');
      assert.deepEqual(await page.evaluate(() => [...globalThis.__regenerationEvents]), ['cancel', 'start']);
    }
  });
}

test('mounted regeneration stops when the current server plan is reviewable', async (t) => {
  const browser = await launchMountedHookBrowser(t);
  if (!browser) return;
  t.after(() => browser.close());
  const page = await createSameOriginHarnessPage(browser);
  await page.evaluate(() => globalThis.__mountResumeOptimizationHarness('regenerate-refreshed'));
  await page.waitForFunction(() => document.querySelector('output')?.dataset.uiState === 'preview');
  await page.getByRole('button', { name: '重新生成优化方案', exact: true }).click();
  await page.waitForFunction(() => globalThis.__resumeOptimizationHarnessFlow.run?.plan.changes[0].safetyStatus === 'allowed');
  assert.deepEqual(await page.evaluate(() => [...globalThis.__regenerationEvents]), []);
});

test('mounted regeneration drops late cancellation after an owner switch', async (t) => {
  const browser = await launchMountedHookBrowser(t);
  if (!browser) return;
  t.after(() => browser.close());
  const page = await createSameOriginHarnessPage(browser);
  await page.evaluate(() => globalThis.__mountResumeOptimizationHarness('regenerate-deferred'));
  await page.waitForFunction(() => document.querySelector('output')?.dataset.uiState === 'preview');
  await page.evaluate(() => {
    globalThis.__regenerationPromise = globalThis.__resumeOptimizationHarnessFlow.startOptimization({ replaceUnreviewableRun: true });
  });
  await page.waitForFunction(() => typeof globalThis.__releaseRegenerationCancel === 'function');
  await page.evaluate(() => globalThis.__switchResumeOptimizationOwner());
  await page.evaluate(() => globalThis.__releaseRegenerationCancel());
  assert.equal(await page.evaluate(() => globalThis.__regenerationPromise), null);
  assert.deepEqual(await page.evaluate(() => [...globalThis.__regenerationEvents]), ['cancel']);
});

test('mounted cancelled planning response clears its stored key before retry', async (t) => {
  const browser = await launchMountedHookBrowser(t);
  if (!browser) return;
  t.after(() => browser.close());
  const page = await createSameOriginHarnessPage(browser);
  await page.evaluate(() => globalThis.__mountResumeOptimizationHarness('planning-retry'));
  await page.waitForFunction(() => document.querySelector('output')?.dataset.uiState === 'closed');

  assert.equal(await page.evaluate(() => globalThis.__startResumeOptimization()), null);
  const second = await page.evaluate(() => globalThis.__startResumeOptimization());
  const keys = await page.evaluate(() => [...globalThis.__resumeOptimizationHarnessStartKeys]);

  assert.equal(second?.status ?? null, 'preview_ready');
  assert.equal(keys.length, 2);
  assert.notEqual(keys[0], keys[1]);
});

const seedPlanningAttempt = (page, expectedResumeUpdatedAt) => page.evaluate((timestamp) => {
  sessionStorage.setItem('resumeflow:resume-optimization:start:owner-a:resume-a', JSON.stringify({
    resumeId: 'resume-a',
    evaluationSignature: 'S1',
    expectedResumeUpdatedAt: timestamp,
    idempotencyKey: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  }));
}, expectedResumeUpdatedAt);

for (const [scenario, timestamp] of [
  ['stale', '2026-08-31T00:00:00Z'],
  ['malformed', 'invalid-timestamp'],
]) {
  test(`mounted restored ${scenario} planning attempt refreshes its version before starting`, async (t) => {
    const browser = await launchMountedHookBrowser(t);
    if (!browser) return;
    t.after(() => browser.close());
    const page = await createSameOriginHarnessPage(browser);
    await seedPlanningAttempt(page, timestamp);
    await page.evaluate(() => globalThis.__mountResumeOptimizationHarness('planning-restored-stale'));
    await page.waitForFunction(() => document.querySelector('output')?.dataset.uiState === 'closed');

    const result = await page.evaluate(() => globalThis.__startResumeOptimization());
    const observed = await page.evaluate(() => ({
      flush: globalThis.__resumeOptimizationHarnessCalls.flush,
      payloads: globalThis.__resumeOptimizationHarnessStartPayloads,
      keys: globalThis.__resumeOptimizationHarnessStartKeys,
    }));
    assert.equal(result?.status, 'preview_ready');
    assert.equal(observed.flush, 1);
    assert.deepEqual(observed.payloads.map((payload) => payload.expectedResumeUpdatedAt), [
      '2026-09-01T00:00:03.000Z',
    ]);
    assert.notEqual(observed.keys[0], 'dddddddd-dddd-4ddd-8ddd-dddddddddddd');
  });
}

test('mounted authoritative stale planning error clears its attempt before reopening', async (t) => {
  const browser = await launchMountedHookBrowser(t);
  if (!browser) return;
  t.after(() => browser.close());
  const page = await createSameOriginHarnessPage(browser);
  await seedPlanningAttempt(page, '2026-09-01T00:00:00Z');
  await page.evaluate(() => globalThis.__mountResumeOptimizationHarness('planning-context-stale'));
  await page.waitForFunction(() => document.querySelector('output')?.dataset.uiState === 'closed');

  assert.equal(await page.evaluate(() => globalThis.__startResumeOptimization()), null);
  await page.waitForFunction(() => document.querySelector('output')?.dataset.uiState === 'stale');
  assert.equal(await page.evaluate(() => sessionStorage.getItem(
    'resumeflow:resume-optimization:start:owner-a:resume-a',
  )), null);
  await page.evaluate(() => globalThis.__resumeOptimizationHarnessFlow.closeWorkspace());
  const result = await page.evaluate(() => globalThis.__startResumeOptimization());
  const observed = await page.evaluate(() => ({
    flush: globalThis.__resumeOptimizationHarnessCalls.flush,
    keys: globalThis.__resumeOptimizationHarnessStartKeys,
  }));
  assert.equal(result?.status, 'preview_ready');
  assert.equal(observed.flush, 1);
  assert.equal(observed.keys.length, 2);
  assert.notEqual(observed.keys[0], observed.keys[1]);
});

test('mounted ambiguous planning failure retains the just-flushed version before React catches up', async (t) => {
  const browser = await launchMountedHookBrowser(t);
  if (!browser) return;
  t.after(() => browser.close());
  const page = await createSameOriginHarnessPage(browser);
  await page.evaluate(() => globalThis.__mountResumeOptimizationHarness('planning-network-retry'));
  await page.waitForFunction(() => document.querySelector('output')?.dataset.uiState === 'closed');

  assert.equal(await page.evaluate(() => globalThis.__startResumeOptimization()), null);
  const stored = await page.evaluate(() => JSON.parse(sessionStorage.getItem(
    'resumeflow:resume-optimization:start:owner-a:resume-a',
  )));
  assert.equal(stored.expectedResumeUpdatedAt, '2026-09-01T00:00:03.000Z');
  const result = await page.evaluate(() => globalThis.__startResumeOptimization());
  const observed = await page.evaluate(() => ({
    flush: globalThis.__resumeOptimizationHarnessCalls.flush,
    keys: globalThis.__resumeOptimizationHarnessStartKeys,
    payloads: globalThis.__resumeOptimizationHarnessStartPayloads,
  }));
  assert.equal(result?.status, 'preview_ready');
  assert.equal(observed.flush, 1);
  assert.deepEqual(observed.keys, [stored.idempotencyKey, stored.idempotencyKey]);
  assert.deepEqual(observed.payloads[0], observed.payloads[1]);
});

test('mounted ambiguous planning failure retains a current restored attempt across remount', async (t) => {
  const browser = await launchMountedHookBrowser(t);
  if (!browser) return;
  t.after(() => browser.close());
  const page = await createSameOriginHarnessPage(browser);
  await seedPlanningAttempt(page, '2026-09-01T00:00:00+00:00');
  await page.evaluate(() => globalThis.__mountResumeOptimizationHarness('planning-provider-retry'));
  await page.waitForFunction(() => document.querySelector('output')?.dataset.uiState === 'closed');

  assert.equal(await page.evaluate(() => globalThis.__startResumeOptimization()), null);
  await page.evaluate(() => globalThis.__unmountResumeOptimizationHarness());
  await page.evaluate(() => globalThis.__mountResumeOptimizationHarness('planning-provider-retry'));
  await page.waitForFunction(() => document.querySelector('output')?.dataset.uiState === 'closed');
  const result = await page.evaluate(() => globalThis.__startResumeOptimization());
  const observed = await page.evaluate(() => ({
    flush: globalThis.__resumeOptimizationHarnessCalls.flush,
    keys: globalThis.__resumeOptimizationHarnessStartKeys,
  }));
  assert.equal(result?.status, 'preview_ready');
  assert.equal(observed.flush, 0);
  assert.deepEqual(observed.keys, [
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  ]);
});

test('mounted planning failure exposes the latest error state even to the pre-await flow snapshot', async (t) => {
  const browser = await launchMountedHookBrowser(t);
  if (!browser) return;
  t.after(() => browser.close());
  const page = await createSameOriginHarnessPage(browser);
  await page.evaluate(() => globalThis.__mountResumeOptimizationHarness('planning-error'));
  await page.waitForFunction(() => document.querySelector('output')?.dataset.uiState === 'closed');

  const observed = await page.evaluate(async () => {
    const capturedFlow = globalThis.__resumeOptimizationHarnessFlow;
    const result = await capturedFlow.startOptimization();
    return {
      result,
      capturedUiState: capturedFlow.uiState,
      latestUiState: capturedFlow.getLatestUiState(),
    };
  });
  await page.waitForFunction(() => document.querySelector('output')?.dataset.uiState === 'error');

  assert.equal(observed.result, null);
  assert.equal(observed.capturedUiState, 'closed');
  assert.equal(observed.latestUiState, 'error');
  assert.equal(await page.locator('output').getAttribute('data-ui-state'), 'error');
});

test('mounted cached applied reopen rechecks latest authority and drops a hidden run', async (t) => {
  const browser = await launchMountedHookBrowser(t);
  if (!browser) return;
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent('<!doctype html><html><body></body></html>');
  await page.addScriptTag({ content: await buildMountedHookHarness() });
  await page.evaluate(() => globalThis.__mountResumeOptimizationHarness('cached-invalid'));
  await page.waitForFunction(() => document.querySelector('output')?.dataset.runStatus === 'applied');

  await page.evaluate(() => globalThis.__reopenResumeOptimization());
  const calls = await page.evaluate(() => ({ ...globalThis.__resumeOptimizationHarnessCalls }));
  assert.equal(calls.getLatest, 2);
  assert.equal(await page.locator('output').getAttribute('data-run-status'), '');
  assert.equal(await page.locator('output').getAttribute('data-can-resume'), 'false');
});

test('mounted observer keeps a hydrated visible rescore open through completion', async (t) => {
  const browser = await launchMountedHookBrowser(t);
  if (!browser) return;
  t.after(() => browser.close());
  const page = await createSameOriginHarnessPage(browser);
  await page.evaluate(() => globalThis.__mountResumeOptimizationHarness('observer-complete'));
  await page.waitForFunction(() => document.querySelector('output')?.dataset.uiState === 'rescoring');

  await page.waitForFunction(() => globalThis.__resumeOptimizationHarnessCalls.get >= 1);
  assert.equal(await page.locator('output').getAttribute('data-ui-state'), 'rescoring');
  await page.waitForFunction(() => document.querySelector('output')?.dataset.runStatus === 'completed');
  assert.equal(await page.locator('output').getAttribute('data-ui-state'), 'completed');
});

test('mounted observer never reopens a hydrated rescore after an explicit close', async (t) => {
  const browser = await launchMountedHookBrowser(t);
  if (!browser) return;
  t.after(() => browser.close());
  const page = await createSameOriginHarnessPage(browser);
  await page.evaluate(() => globalThis.__mountResumeOptimizationHarness('observer-close'));
  await page.waitForFunction(() => document.querySelector('output')?.dataset.uiState === 'rescoring');

  assert.equal(await page.evaluate(() => globalThis.__closeResumeOptimization()), true);
  await page.waitForFunction(() => document.querySelector('output')?.dataset.uiState === 'closed');
  await page.evaluate(() => globalThis.__refreshResumeOptimizationEvaluationInputs());
  await page.waitForFunction(() => document.querySelector('output')?.dataset.runStatus === 'completed');
  assert.equal(await page.locator('output').getAttribute('data-ui-state'), 'closed');
  const getLatestBeforeRefresh = await page.evaluate(
    () => globalThis.__resumeOptimizationHarnessCalls.getLatest,
  );
  await page.evaluate(() => globalThis.__refreshResumeOptimizationEvaluationInputs());
  await page.waitForFunction(
    (previousCount) => globalThis.__resumeOptimizationHarnessCalls.getLatest > previousCount,
    getLatestBeforeRefresh,
  );
  assert.equal(await page.locator('output').getAttribute('data-run-status'), 'completed');
  assert.equal(await page.locator('output').getAttribute('data-ui-state'), 'closed');
  assert.equal(await page.locator('output').getAttribute('data-can-resume'), 'true');

  const reopened = await page.evaluate(() => globalThis.__reopenResumeOptimization());
  assert.equal(reopened?.status, 'completed');
  await page.waitForFunction(() => document.querySelector('output')?.dataset.uiState === 'completed');
  assert.equal(await page.locator('output').getAttribute('data-run-status'), 'completed');
});
