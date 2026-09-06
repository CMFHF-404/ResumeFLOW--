import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { build } from 'esbuild';

const RUN_ID = '22222222-2222-4222-8222-222222222222';
const RESUME_ID = '11111111-1111-4111-8111-111111111111';
const IDEMPOTENCY_KEY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const wirePlan = () => ({
  changes: [{
    change_id: 'CHG_1',
    issue_ids: ['ISSUE_1'],
    dimension: '内容完整',
    module_type: 'personal_summary',
    module_id: 'current_resume',
    field_path: 'personalSummary',
    action_kind: 'rewrite_now',
    scope: 'general',
    before_value: '旧摘要',
    general_value: '通用摘要',
    targeted_value: '定向摘要',
    source_refs: ['/currentResume/personal_summary'],
    introduced_terms: [],
    rationale: '补全现有事实',
    expected_score_gain: 4,
    default_selected: true,
    safety_status: 'allowed',
    safety_findings: [],
  }],
  questions: [],
  bank_suggestions: [],
  safety_summary: {
    allowed_change_ids: ['CHG_1'],
    blocked_change_ids: [],
    pending_change_ids: [],
    findings: [],
  },
});

const wireRun = (overrides = {}) => ({
  id: RUN_ID,
  resume_id: RESUME_ID,
  status: 'preview_ready',
  optimizer_version: 'resume_optimization_v1',
  policy_version: 'thin_safety_v1',
  prompt_version: 'resume_optimization_prompt_v1',
  source_resume_updated_at: '2026-09-01T03:00:00Z',
  source_evaluation_signature: 'evaluation-signature',
  source_jd_signature: 'jd-signature',
  source_snapshot_hash: 'snapshot-hash',
  source_before_score: null,
  plan: wirePlan(),
  answers: [],
  result: wirePlan(),
  post_evaluation: null,
  accepted_change_ids: [],
  applied_content_signature: null,
  created_at: '2026-09-01T03:00:00Z',
  updated_at: '2026-09-01T03:01:00Z',
  applied_at: null,
  completed_at: null,
  ...overrides,
});

const makeHarness = () => ({
  apiCalls: [],
  apiResponses: [],
  apiError: null,
  streamCalls: [],
  streamEvents: [{ type: 'final', result: wireRun(), requestId: 'request-1' }],
  streamError: null,
  versionRecords: [],
});

const importService = async (harness) => {
  globalThis.__resumeOptimizationServiceHarness = harness;
  const result = await build({
    entryPoints: ['services/resumeOptimizationService.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    plugins: [{
      name: 'resume-optimization-service-stubs',
      setup(buildContext) {
        buildContext.onResolve({ filter: /^\.\/apiClient$/ }, () => ({
          path: 'api-client-stub',
          namespace: 'stub',
        }));
        buildContext.onResolve({ filter: /^\.\/aiStreamUtils$/ }, () => ({
          path: 'ai-stream-stub',
          namespace: 'stub',
        }));
        buildContext.onResolve({ filter: /^\.\/resumeService$/ }, () => ({
          path: 'resume-service-stub',
          namespace: 'stub',
        }));
        buildContext.onLoad({ filter: /^api-client-stub$/, namespace: 'stub' }, () => ({
          loader: 'js',
          contents: `
            const invoke = async (method, args) => {
              const harness = globalThis.__resumeOptimizationServiceHarness;
              harness.apiCalls.push({ method, args });
              if (harness.apiError) {
                const error = harness.apiError;
                harness.apiError = null;
                throw error;
              }
              return { data: harness.apiResponses.shift() };
            };
            export default {
              get: (...args) => invoke('get', args),
              post: (...args) => invoke('post', args),
            };
          `,
        }));
        buildContext.onLoad({ filter: /^ai-stream-stub$/, namespace: 'stub' }, () => ({
          loader: 'js',
          contents: `
            export class StreamRequestError extends Error {
              constructor(message, details = {}) {
                super(message);
                this.name = 'StreamRequestError';
                Object.assign(this, details);
              }
            }
            export const postStreamRequest = async (options) => {
              const harness = globalThis.__resumeOptimizationServiceHarness;
              harness.streamCalls.push(options);
              if (harness.streamError) {
                const error = harness.streamError;
                harness.streamError = null;
                throw error;
              }
              let finalResult = null;
              for (const event of harness.streamEvents) {
                options.onParsedEvent?.(event);
                if (event.type === 'error') {
                  throw new StreamRequestError(event.message || 'stream error', {
                    code: event.code,
                    statusCode: event.statusCode,
                    retryable: event.retryable,
                    requestId: event.requestId,
                  });
                }
                const candidate = options.getFinalResult(event);
                if (candidate) finalResult = candidate;
              }
              if (!finalResult) throw new Error('missing final result');
              return finalResult;
            };
          `,
        }));
        buildContext.onLoad({ filter: /^resume-service-stub$/, namespace: 'stub' }, () => ({
          loader: 'js',
          contents: `
            export const recordKnownResumeUpdatedAt = (...args) => {
              globalThis.__resumeOptimizationServiceHarness.versionRecords.push(args);
            };
          `,
        }));
      },
    }],
  });
  const source = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${Math.random()}`);
};

const importStreamUtils = async (harness) => {
  globalThis.__resumeOptimizationStreamHarness = harness;
  const result = await build({
    entryPoints: ['services/aiStreamUtils.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    plugins: [{
      name: 'ai-stream-header-stubs',
      setup(buildContext) {
        const stub = (filter, path, contents) => {
          buildContext.onResolve({ filter }, () => ({ path, namespace: 'stub' }));
          buildContext.onLoad({ filter: new RegExp(`^${path}$`), namespace: 'stub' }, () => ({
            loader: 'js',
            contents,
          }));
        };
        stub(/^\.\/apiClient$/, 'api-client', `
          export class AuthContextChangedError extends Error {
            constructor() { super('changed'); this.name = 'AuthContextChangedError'; }
          }
          export const getAuthorizationHeader = async (owner) => {
            globalThis.__resumeOptimizationStreamHarness.authCalls.push(owner);
            return 'Bearer authoritative';
          };
        `);
        stub(/^\.\/authTokenProvider$/, 'auth-provider', `
          export const readAuthSessionSnapshot = () => ({
            ...globalThis.__resumeOptimizationStreamHarness.session,
          });
          export const isAuthSessionSnapshotCurrent = (snapshot) => {
            const current = globalThis.__resumeOptimizationStreamHarness.session;
            return snapshot.epoch === current.epoch && snapshot.ownerKey === current.ownerKey;
          };
        `);
        stub(/^\.\/authRedirect$/, 'auth-redirect', 'export const dispatchLoginRequired = () => {};');
        stub(/^\.\/authRecoveryCoordinator$/, 'auth-recovery', 'export const handleFetchAuthFailure = async () => {};');
        stub(/^\.\/apiStreamUtils$/, 'api-stream-utils', `
          export const resolveApiUrl = (path) => path;
          export const parseNdjsonLines = (chunk) => chunk.split('\\n').map((line) => line.trim()).filter(Boolean);
        `);
        stub(/^\.\/quotaPurchasePrompt$/, 'quota-prompt', `
          export const DEFAULT_QUOTA_PURCHASE_MESSAGE = 'quota';
          export const dispatchQuotaPurchaseRequired = (message) => {
            globalThis.__resumeOptimizationStreamHarness.quotaCalls?.push(message);
          };
        `);
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}#${Math.random()}`);
};

const streamResponse = (event) => {
  const bytes = new TextEncoder().encode(`${JSON.stringify(event)}\n`);
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  }), { status: 200 });
};

test('start and answer use exact stream paths, snake-case bodies, owner guard, signal, and retained key', async () => {
  const harness = makeHarness();
  const { resumeOptimizationService } = await importService(harness);
  const controller = new AbortController();
  const startPayload = {
    resumeId: RESUME_ID,
    evaluationSignature: 'evaluation-signature',
    expectedResumeUpdatedAt: '2026-09-01T03:00:00.123456Z',
    includeBankSuggestions: true,
  };
  const options = {
    idempotencyKey: IDEMPOTENCY_KEY,
    signal: controller.signal,
    expectedAuthCacheKey: 'owner-a',
  };

  await resumeOptimizationService.start(startPayload, options);
  await resumeOptimizationService.start(startPayload, options);

  for (const call of harness.streamCalls.slice(0, 2)) {
    assert.equal(call.path, '/api/resume-optimizations/stream');
    assert.deepEqual(JSON.parse(call.body), {
      resume_id: RESUME_ID,
      evaluation_signature: 'evaluation-signature',
      expected_resume_updated_at: '2026-09-01T03:00:00.123456Z',
      include_bank_suggestions: true,
    });
    assert.deepEqual(call.headers, { 'Idempotency-Key': IDEMPOTENCY_KEY });
    assert.equal(call.signal, controller.signal);
    assert.equal(call.expectedAuthCacheKey, 'owner-a');
  }

  await resumeOptimizationService.answer(
    RUN_ID,
    { answers: [{ questionId: 'Q1', state: 'answered', value: '补充内容' }] },
    { signal: controller.signal, expectedAuthCacheKey: 'owner-a' },
  );
  const answerCall = harness.streamCalls[2];
  assert.equal(answerCall.path, `/api/resume-optimizations/${RUN_ID}/answers/stream`);
  assert.deepEqual(JSON.parse(answerCall.body), {
    answers: [{ question_id: 'Q1', state: 'answered', value: '补充内容' }],
  });
  assert.equal(answerCall.signal, controller.signal);
  assert.equal(answerCall.expectedAuthCacheKey, 'owner-a');
});

test('answer rewrite contract failures surface a safe Chinese retry message', async () => {
  const harness = makeHarness();
  harness.streamEvents = [{
    type: 'error',
    code: 'resume_optimization_plan_invalid',
    message: 'private provider payload',
    statusCode: 502,
    retryable: true,
    requestId: 'answer-contract',
  }];
  const { resumeOptimizationService, ResumeOptimizationServiceError } = await importService(harness);

  await assert.rejects(
    resumeOptimizationService.answer(
      RUN_ID,
      { answers: [{ questionId: 'Q1', state: 'answered', value: '补充内容' }] },
      { expectedAuthCacheKey: 'owner-a' },
    ),
    (error) => error instanceof ResumeOptimizationServiceError
      && error.code === 'resume_optimization_plan_invalid'
      && error.message === 'AI 返回的优化结果结构异常，请重试。'
      && error.retryable === true
      && error.requestId === 'answer-contract',
  );
});

test('all seven non-stream methods use exact wrappers and forward signal plus expected owner', async () => {
  const harness = makeHarness();
  const { resumeOptimizationService } = await importService(harness);
  const controller = new AbortController();
  const common = { signal: controller.signal, expectedAuthCacheKey: 'owner-a' };
  const appliedRun = wireRun({ accepted_change_ids: ['CHG_1'] });
  harness.apiResponses.push(
    wireRun(),
    wireRun(),
    { run: appliedRun, resume_updated_at: '2026-09-01T03:05:00Z', applied_change_ids: ['CHG_1'] },
    wireRun({ status: 'applied', accepted_change_ids: ['CHG_1'] }),
    { run: wireRun() },
    { run: wireRun({ status: 'reverted' }), resume_updated_at: '2026-09-01T03:15:00Z' },
    wireRun({ status: 'cancelled' }),
  );

  await resumeOptimizationService.get(RUN_ID, common);
  await resumeOptimizationService.getLatest(RESUME_ID, common);
  await resumeOptimizationService.apply(
    RUN_ID,
    { acceptedChangeIds: ['CHG_1'], expectedResumeUpdatedAt: '2026-09-01T03:04:00Z' },
    common,
  );
  await resumeOptimizationService.claimRescore(
    RUN_ID,
    {
      claimId: IDEMPOTENCY_KEY,
      expectedResumeUpdatedAt: '2026-09-01T03:04:00Z',
    },
    common,
  );
  await resumeOptimizationService.finalize(
    RUN_ID,
    { expectedResumeUpdatedAt: '2026-09-01T03:05:00Z', claimId: IDEMPOTENCY_KEY },
    common,
  );
  await resumeOptimizationService.revert(
    RUN_ID,
    { expectedResumeUpdatedAt: '2026-09-01T03:10:00Z', claimId: IDEMPOTENCY_KEY },
    common,
  );
  await resumeOptimizationService.cancel(RUN_ID, common);

  assert.deepEqual(
    harness.apiCalls.map((call) => [call.method, call.args[0]]),
    [
      ['get', `/api/resume-optimizations/${RUN_ID}`],
      ['get', '/api/resume-optimizations/latest'],
      ['post', `/api/resume-optimizations/${RUN_ID}/apply`],
      ['post', `/api/resume-optimizations/${RUN_ID}/rescore-claim`],
      ['post', `/api/resume-optimizations/${RUN_ID}/finalize`],
      ['post', `/api/resume-optimizations/${RUN_ID}/revert`],
      ['post', `/api/resume-optimizations/${RUN_ID}/cancel`],
    ],
  );

  const latestConfig = harness.apiCalls[1].args[1];
  assert.deepEqual(latestConfig.params, { resume_id: RESUME_ID });
  for (const call of harness.apiCalls) {
    const config = call.method === 'get' ? call.args[1] : call.args[2];
    assert.equal(config.signal, controller.signal);
    assert.equal(config.expectedAuthCacheKey, 'owner-a');
  }
  assert.deepEqual(harness.apiCalls[2].args[1], {
    accepted_change_ids: ['CHG_1'],
    expected_resume_updated_at: '2026-09-01T03:04:00.000Z',
  });
  assert.deepEqual(harness.apiCalls[3].args[1], {
    claim_id: IDEMPOTENCY_KEY,
    expected_resume_updated_at: '2026-09-01T03:04:00.000Z',
  });
  assert.deepEqual(harness.apiCalls[4].args[1], {
    expected_resume_updated_at: '2026-09-01T03:05:00.000Z',
    claim_id: IDEMPOTENCY_KEY,
  });
  assert.deepEqual(harness.apiCalls[5].args[1], {
    expected_resume_updated_at: '2026-09-01T03:10:00.000Z',
    claim_id: IDEMPOTENCY_KEY,
  });
  assert.equal(harness.apiCalls[6].args[1], undefined);
  assert.deepEqual(
    harness.versionRecords.map((args) => args.slice(0, 2)),
    [
      [RESUME_ID, '2026-09-01T03:05:00.000Z'],
      [RESUME_ID, '2026-09-01T03:15:00.000Z'],
    ],
  );
});

test('getLatest maps only the exact run-not-found response to null', async () => {
  const harness = makeHarness();
  const { resumeOptimizationService, ResumeOptimizationServiceError } = await importService(harness);
  harness.apiError = {
    response: {
      status: 404,
      data: { detail: { code: 'resume_optimization_run_not_found', message: '未找到' } },
    },
  };
  assert.equal(await resumeOptimizationService.getLatest(RESUME_ID), null);

  harness.apiError = {
    response: {
      status: 404,
      data: { detail: { code: 'resume_optimization_context_not_found', message: '简历不存在' } },
    },
  };
  await assert.rejects(
    resumeOptimizationService.getLatest(RESUME_ID),
    (error) => error instanceof ResumeOptimizationServiceError
      && error.code === 'resume_optimization_context_not_found'
      && error.statusCode === 404,
  );
});

test('preserves stream and HTTP error metadata while passing Abort/Auth errors through', async () => {
  const harness = makeHarness();
  const { resumeOptimizationService, ResumeOptimizationServiceError } = await importService(harness);
  harness.streamEvents = [{
    type: 'error',
    code: 'ai_runtime_timeout',
    message: '请求超时',
    requestId: 'request-timeout',
    statusCode: 504,
    retryable: true,
  }];

  await assert.rejects(
    resumeOptimizationService.start(
      {
        resumeId: RESUME_ID,
        evaluationSignature: 'evaluation-signature',
        expectedResumeUpdatedAt: '2026-09-01T03:00:00Z',
      },
      { idempotencyKey: IDEMPOTENCY_KEY },
    ),
    (error) => error instanceof ResumeOptimizationServiceError
      && error.code === 'ai_runtime_timeout'
      && error.statusCode === 504
      && error.retryable === true
      && error.requestId === 'request-timeout',
  );

  const abortError = new Error('aborted');
  abortError.name = 'AbortError';
  harness.streamError = abortError;
  await assert.rejects(
    resumeOptimizationService.start(
      {
        resumeId: RESUME_ID,
        evaluationSignature: 'evaluation-signature',
        expectedResumeUpdatedAt: '2026-09-01T03:00:00Z',
      },
      { idempotencyKey: IDEMPOTENCY_KEY },
    ),
    (error) => error === abortError,
  );

  const authError = new Error('changed');
  authError.name = 'AuthContextChangedError';
  harness.streamError = authError;
  await assert.rejects(
    resumeOptimizationService.start(
      {
        resumeId: RESUME_ID,
        evaluationSignature: 'evaluation-signature',
        expectedResumeUpdatedAt: '2026-09-01T03:00:00Z',
      },
      { idempotencyKey: IDEMPOTENCY_KEY },
    ),
    (error) => error === authError,
  );

  harness.apiError = {
    response: {
      status: 409,
      data: {
        detail: {
          code: 'resume_optimization_content_conflict',
          message: '内容已变化',
        },
      },
    },
  };
  await assert.rejects(
    resumeOptimizationService.revert(
      RUN_ID,
      { expectedResumeUpdatedAt: '2026-09-01T03:10:00Z' },
    ),
    (error) => error instanceof ResumeOptimizationServiceError
      && error.code === 'resume_optimization_content_conflict'
      && error.statusCode === 409
      && error.message === '简历内容已在优化后发生变化，请刷新后再操作。',
  );

  const canceledError = new Error('canceled');
  canceledError.name = 'CanceledError';
  canceledError.code = 'ERR_CANCELED';
  harness.apiError = canceledError;
  await assert.rejects(
    resumeOptimizationService.get(RUN_ID),
    (error) => error === canceledError,
  );

  harness.apiError = {
    response: {
      status: 503,
      data: {
        error: {
          code: 'auth_dependency_unavailable',
          message: '认证服务暂时不可用',
        },
      },
    },
  };
  await assert.rejects(
    resumeOptimizationService.finalize(
      RUN_ID,
      { expectedResumeUpdatedAt: '2026-09-01T03:10:00Z', claimId: IDEMPOTENCY_KEY },
    ),
    (error) => error instanceof ResumeOptimizationServiceError
      && error.code === 'auth_dependency_unavailable'
      && error.message === '认证服务暂时不可用'
      && error.statusCode === 503
      && error.retryable === true,
  );
});

test('unknown HTTP and transport messages fail closed instead of exposing proxy content', async () => {
  const harness = makeHarness();
  const { resumeOptimizationService, ResumeOptimizationServiceError } = await importService(harness);
  const canary = 'PRIVATE_PROXY_HTML_OR_STACK_CANARY';
  const fallback = '简历优化请求失败，请稍后重试。';
  const errors = [
    {
      response: {
        status: 502,
        data: { detail: { code: 'unknown_proxy_failure', message: canary } },
      },
    },
    {
      response: {
        status: 502,
        data: { detail: canary },
      },
    },
    Object.assign(new Error(canary), {
      response: { status: 502, data: {} },
    }),
    new Error(canary),
  ];

  for (const sourceError of errors) {
    harness.apiError = sourceError;
    await assert.rejects(
      resumeOptimizationService.get(RUN_ID),
      (error) => error instanceof ResumeOptimizationServiceError
        && error.message === fallback
        && !error.message.includes(canary),
    );
  }

  harness.apiError = {
    response: {
      status: 409,
      data: {
        detail: {
          code: 'resume_optimization_content_conflict',
          message: canary,
        },
      },
    },
  };
  await assert.rejects(
    resumeOptimizationService.get(RUN_ID),
    (error) => error instanceof ResumeOptimizationServiceError
      && error.code === 'resume_optimization_content_conflict'
      && error.message === '简历内容已在优化后发生变化，请刷新后再操作。'
      && !error.message.includes(canary),
  );

  harness.streamEvents = [{
    type: 'error',
    code: 'unknown_proxy_failure',
    message: canary,
    requestId: 'proxy-canary-request',
    statusCode: 502,
    retryable: false,
  }];
  await assert.rejects(
    resumeOptimizationService.start(
      {
        resumeId: RESUME_ID,
        evaluationSignature: 'evaluation-signature',
        expectedResumeUpdatedAt: '2026-09-01T03:00:00Z',
      },
      { idempotencyKey: IDEMPOTENCY_KEY },
    ),
    (error) => error instanceof ResumeOptimizationServiceError
      && error.code === 'resume_optimization_request_failed'
      && error.message === fallback
      && error.requestId === undefined
      && !error.message.includes(canary),
  );
});

test('validates UUIDs and duplicate actionable IDs before any network call', async () => {
  const harness = makeHarness();
  const { resumeOptimizationService, ResumeOptimizationServiceError } = await importService(harness);

  await assert.rejects(
    resumeOptimizationService.get(RUN_ID.replaceAll('-', '')),
    (error) => error instanceof ResumeOptimizationServiceError
      && error.code === 'resume_optimization_request_invalid'
      && error.statusCode === 400,
  );
  await assert.rejects(resumeOptimizationService.apply(
    RUN_ID,
    {
      acceptedChangeIds: ['CHG_1', 'CHG_1'],
      expectedResumeUpdatedAt: '2026-09-01T03:00:00Z',
    },
  ), (error) => error instanceof ResumeOptimizationServiceError
    && error.code === 'resume_optimization_request_invalid'
    && error.statusCode === 400);
  await assert.rejects(
    resumeOptimizationService.start(
      {
        resumeId: RESUME_ID,
        evaluationSignature: 'evaluation-signature',
        expectedResumeUpdatedAt: 'not-a-timestamp',
      },
      { idempotencyKey: IDEMPOTENCY_KEY },
    ),
    (error) => error instanceof ResumeOptimizationServiceError
      && error.code === 'resume_optimization_request_invalid'
      && error.statusCode === 400,
  );
  assert.equal(harness.apiCalls.length, 0);
  assert.equal(harness.streamCalls.length, 0);
});

test('generates canonical per-click UUID keys while callers retain them for retry', async () => {
  const harness = makeHarness();
  const { createResumeOptimizationIdempotencyKey } = await importService(harness);

  const first = createResumeOptimizationIdempotencyKey();
  const second = createResumeOptimizationIdempotencyKey();

  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.match(second, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.notEqual(first, second);
});

test('stream helper safely merges caller headers behind authoritative auth/content type', async () => {
  const harness = {
    authCalls: [],
    session: { epoch: 1, ownerKey: 'owner-a' },
  };
  const { postStreamRequest } = await importStreamUtils(harness);
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  let captured;
  globalThis.fetch = async (_url, options) => {
    captured = options;
    return streamResponse({ type: 'final', result: { ok: true } });
  };
  try {
    const result = await postStreamRequest({
      path: '/api/example/stream',
      body: '{}',
      headers: {
        Authorization: 'Bearer attacker',
        'Content-Type': 'text/plain',
        'Idempotency-Key': IDEMPOTENCY_KEY,
      },
      contentType: 'application/json',
      expectedAuthCacheKey: 'owner-a',
      signal: controller.signal,
      getFinalResult: (event) => event.type === 'final' ? event.result : null,
    });

    assert.deepEqual(result, { ok: true });
    assert.equal(captured.headers.get('Authorization'), 'Bearer authoritative');
    assert.equal(captured.headers.get('Content-Type'), 'application/json');
    assert.equal(captured.headers.get('Idempotency-Key'), IDEMPOTENCY_KEY);
    assert.equal(captured.signal, controller.signal);
    assert.deepEqual(harness.authCalls, ['owner-a']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('stream helper rejects CRLF header injection before dispatch', async () => {
  const harness = {
    authCalls: [],
    session: { epoch: 1, ownerKey: 'owner-a' },
  };
  const { postStreamRequest } = await importStreamUtils(harness);
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return streamResponse({ type: 'final', result: { ok: true } });
  };
  try {
    await assert.rejects(postStreamRequest({
      path: '/api/example/stream',
      body: '{}',
      headers: { 'X-Test': 'ok\r\nInjected: true' },
      expectedAuthCacheKey: 'owner-a',
      getFinalResult: (event) => event.type === 'final' ? event.result : null,
    }), TypeError);
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('stream helper still rejects a response after the auth session changes', async () => {
  const harness = {
    authCalls: [],
    session: { epoch: 1, ownerKey: 'owner-a' },
  };
  const { postStreamRequest } = await importStreamUtils(harness);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    harness.session = { epoch: 2, ownerKey: 'owner-b' };
    return streamResponse({ type: 'final', result: { ok: true } });
  };
  try {
    await assert.rejects(
      postStreamRequest({
        path: '/api/example/stream',
        body: '{}',
        expectedAuthCacheKey: 'owner-a',
        getFinalResult: (event) => event.type === 'final' ? event.result : null,
      }),
      (error) => error?.name === 'AuthContextChangedError',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('stream helper preserves top-level auth error metadata', async () => {
  const harness = {
    authCalls: [],
    session: { epoch: 1, ownerKey: 'owner-a' },
  };
  const { postStreamRequest, StreamRequestError } = await importStreamUtils(harness);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: {
      code: 'auth_dependency_unavailable',
      message: '认证服务暂时不可用',
    },
  }), {
    status: 503,
    headers: { 'Content-Type': 'application/json' },
  });
  try {
    await assert.rejects(
      postStreamRequest({
        path: '/api/example/stream',
        body: '{}',
        expectedAuthCacheKey: 'owner-a',
        getFinalResult: (event) => event.type === 'final' ? event.result : null,
      }),
      (error) => error instanceof StreamRequestError
        && error.code === 'auth_dependency_unavailable'
        && error.message === '认证服务暂时不可用'
        && error.statusCode === 503
        && error.retryable === true,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('stream helper preserves NDJSON error metadata', async () => {
  const harness = {
    authCalls: [],
    session: { epoch: 1, ownerKey: 'owner-a' },
  };
  const { postStreamRequest, StreamRequestError } = await importStreamUtils(harness);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => streamResponse({
    type: 'error',
    code: 'ai_runtime_timeout',
    message: '请求超时',
    requestId: 'request-timeout',
    statusCode: 504,
    retryable: true,
  });
  try {
    await assert.rejects(
      postStreamRequest({
        path: '/api/example/stream',
        body: '{}',
        expectedAuthCacheKey: 'owner-a',
        getFinalResult: (event) => event.type === 'final' ? event.result : null,
      }),
      (error) => error instanceof StreamRequestError
        && error.code === 'ai_runtime_timeout'
        && error.message === '请求超时'
        && error.requestId === 'request-timeout'
        && error.statusCode === 504
        && error.retryable === true,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('stream helper preserves the existing 402 purchase prompt fallback', async () => {
  const harness = {
    authCalls: [],
    quotaCalls: [],
    session: { epoch: 1, ownerKey: 'owner-a' },
  };
  const { postStreamRequest, StreamRequestError } = await importStreamUtils(harness);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('', { status: 402 });
  try {
    await assert.rejects(
      postStreamRequest({
        path: '/api/example/stream',
        body: '{}',
        expectedAuthCacheKey: 'owner-a',
        getFinalResult: (event) => event.type === 'final' ? event.result : null,
      }),
      (error) => error instanceof StreamRequestError
        && error.code === 'ai_token_quota_exhausted'
        && error.message === 'quota'
        && error.statusCode === 402
        && error.retryable === false,
    );
    assert.deepEqual(harness.quotaCalls, ['quota']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('stream helper never forwards arbitrary 402 response text to the purchase prompt', async () => {
  const canary = 'PRIVATE_QUOTA_RESPONSE_CANARY';
  const harness = {
    authCalls: [],
    quotaCalls: [],
    session: { epoch: 1, ownerKey: 'owner-a' },
  };
  const { postStreamRequest, StreamRequestError } = await importStreamUtils(harness);
  const originalFetch = globalThis.fetch;
  try {
    for (const [payload, expectedRequestId] of [
      [{ detail: canary }, undefined],
      [{
        detail: {
          code: 'ai_token_quota_exhausted',
          message: canary,
          requestId: 'quota-request',
        },
      }, 'quota-request'],
    ]) {
      globalThis.fetch = async () => new Response(JSON.stringify(payload), {
        status: 402,
        headers: { 'Content-Type': 'application/json' },
      });
      await assert.rejects(
        postStreamRequest({
          path: '/api/example/stream',
          body: '{}',
          expectedAuthCacheKey: 'owner-a',
          getFinalResult: (event) => event.type === 'final' ? event.result : null,
        }),
        (error) => error instanceof StreamRequestError
          && error.code === 'ai_token_quota_exhausted'
          && error.message === 'quota'
          && error.requestId === expectedRequestId
          && error.statusCode === 402
          && error.retryable === false
          && !error.message.includes(canary),
      );
    }
    assert.deepEqual(harness.quotaCalls, ['quota', 'quota']);
    assert.doesNotMatch(JSON.stringify(harness.quotaCalls), new RegExp(canary));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('stream helper reports malformed NDJSON without logging parser details or raw lines', async () => {
  const canary = 'PRIVATE_MALFORMED_NDJSON_CANARY';
  const harness = {
    authCalls: [],
    session: { epoch: 1, ownerKey: 'owner-a' },
  };
  const { postStreamRequest } = await importStreamUtils(harness);
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const warnings = [];
  globalThis.fetch = async () => new Response(`${canary}\n`, { status: 200 });
  console.warn = (...args) => warnings.push(args);
  try {
    await assert.rejects(
      postStreamRequest({
        path: '/api/example/stream',
        body: '{}',
        expectedAuthCacheKey: 'owner-a',
        getFinalResult: (event) => event.type === 'final' ? event.result : null,
      }),
      (error) => error instanceof Error
        && error.message === 'AI stream did not return final result',
    );
    assert.deepEqual(warnings, [['Failed to parse stream line']]);
    assert.doesNotMatch(JSON.stringify(warnings), new RegExp(canary));
    assert.doesNotMatch(JSON.stringify(warnings), /SyntaxError|Unexpected token/);
  } finally {
    console.warn = originalWarn;
    globalThis.fetch = originalFetch;
  }
});

test('service source exposes all nine methods and never applies through resumeService.update', async () => {
  const source = await readFile('services/resumeOptimizationService.ts', 'utf8');

  for (const method of ['start', 'answer', 'get', 'getLatest', 'apply', 'claimRescore', 'finalize', 'revert', 'cancel']) {
    assert.match(source, new RegExp(`\\b${method}\\s*\\(`));
  }
  assert.match(source, /postStreamRequest/);
  assert.match(source, /Idempotency-Key/);
  assert.doesNotMatch(source, /resumeService\.update/);
});
