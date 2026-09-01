import assert from 'node:assert/strict';
import { test } from 'node:test';

const RUN_ID = '22222222-2222-4222-8222-222222222222';
const RESUME_ID = '11111111-1111-4111-8111-111111111111';
const DIMENSIONS = [
  '逻辑清晰',
  'STAR应用',
  '内容可读',
  '内容完整',
  '专业表达',
  '成果量化',
];

const importNormalizer = async () => {
  const url = new URL('../utils/resumeOptimizationNormalize.mjs', import.meta.url);
  url.searchParams.set('case', `${Date.now()}-${Math.random()}`);
  return import(url.href);
};

const change = (changeId = 'CHG_1', overrides = {}) => ({
  change_id: changeId,
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
  ...overrides,
});

const suggestion = (suggestionId = 'BANK_1', masterId = 'bank-master-1') => ({
  suggestion_id: suggestionId,
  master_experience_id: masterId,
  category: 'project',
  title: '项目经历',
  org: '示例组织',
  match_score: 87,
  reason: '可以补强能力证据',
  capabilities: ['需求分析'],
});

const plan = () => ({
  changes: [
    change(),
    change('CHG_BLOCKED', {
      source_refs: ['/selectedSourceExperiences/private-master-id/star/a'],
      default_selected: true,
      safety_status: 'blocked',
      safety_findings: ['责任范围证据不足'],
    }),
  ],
  questions: [],
  bank_suggestions: [suggestion()],
  safety_summary: {
    allowed_change_ids: ['CHG_1'],
    blocked_change_ids: ['CHG_BLOCKED'],
    pending_change_ids: [],
    findings: ['已执行薄安全检查'],
  },
});

const run = (overrides = {}) => ({
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
  plan: plan(),
  answers: [],
  result: plan(),
  post_evaluation: null,
  accepted_change_ids: [],
  applied_content_signature: null,
  created_at: '2026-09-01T03:00:00Z',
  updated_at: '2026-09-01T03:01:00Z',
  applied_at: null,
  completed_at: null,
  ...overrides,
});

const postEvaluation = (overrides = {}) => ({
  version: 'resume_optimization_post_evaluation_v1',
  evaluationSignature: 'post-evaluation-signature',
  resumeUpdatedAt: '2026-09-01T03:10:00Z',
  beforeScore: 50,
  afterScore: 60,
  scoreDelta: 10,
  dimensionDeltas: DIMENSIONS.map((dimension, index) => ({
    dimension,
    beforeScore: 40 + index,
    afterScore: 42 + index,
    delta: 2,
  })),
  issueCounts: {
    before: 2,
    after: 2,
    resolved: 1,
    remaining: 2,
    introduced: 1,
  },
  unresolvedFactGapCount: 1,
  acceptedChangeCount: 1,
  blockedChangeCount: 1,
  bankSuggestionCount: 1,
  safetySummary: {
    allowed_change_ids: ['CHG_1'],
    blocked_change_ids: ['CHG_BLOCKED'],
    pending_change_ids: [],
    findings: ['已执行薄安全检查'],
  },
  ...overrides,
});

const completedRun = (overrides = {}) => run({
  status: 'completed',
  source_before_score: 50,
  accepted_change_ids: ['CHG_1'],
  applied_content_signature: 'applied-signature',
  post_evaluation: postEvaluation(),
  applied_at: '2026-09-01T03:05:00Z',
  completed_at: '2026-09-01T03:10:00Z',
  ...overrides,
});

test('normalizes the backend snake-case run and preserves blocked changes safely', async () => {
  const { normalizeResumeOptimizationRun } = await importNormalizer();

  const normalized = normalizeResumeOptimizationRun(run());

  assert.equal(normalized.id, RUN_ID);
  assert.equal(normalized.resumeId, RESUME_ID);
  assert.equal(normalized.status, 'preview_ready');
  assert.equal(normalized.result.changes.length, 2);
  const blocked = normalized.result.changes.find((item) => item.changeId === 'CHG_BLOCKED');
  assert.equal(blocked.safetyStatus, 'blocked');
  assert.equal(blocked.defaultSelected, false);
  assert.deepEqual(blocked.safetyFindings, ['责任范围证据不足']);
  assert.deepEqual(blocked.sourceLabels, ['已选经历原始版本']);
  assert.equal('sourceRefs' in blocked, false);
  assert.doesNotMatch(JSON.stringify(blocked.sourceLabels), /private-master-id|\//);
});

test('accepts a valid non-text section reorder without source refs', async () => {
  const { normalizeResumeOptimizationRun } = await importNormalizer();
  const payload = run();
  const sectionOrderChange = change('CHG_SECTION_ORDER', {
    dimension: '逻辑清晰',
    module_type: 'section_order',
    module_id: 'sections',
    field_path: 'section_order',
    before_value: ['personalInfo', 'summary', 'experience'],
    general_value: ['personalInfo', 'experience', 'summary'],
    targeted_value: ['personalInfo', 'experience', 'summary'],
    source_refs: [],
  });
  payload.plan.changes.push(structuredClone(sectionOrderChange));
  payload.result.changes.push(sectionOrderChange);
  payload.plan.safety_summary.allowed_change_ids.push('CHG_SECTION_ORDER');
  payload.result.safety_summary.allowed_change_ids.push('CHG_SECTION_ORDER');

  const normalized = normalizeResumeOptimizationRun(payload);

  assert.deepEqual(
    normalized.result.changes.find((item) => item.changeId === 'CHG_SECTION_ORDER')?.sourceLabels,
    [],
  );
});

test('accepts duplicate source refs while exposing one safe label', async () => {
  const { normalizeResumeOptimizationRun } = await importNormalizer();
  const payload = run();
  payload.plan.changes[0].source_refs.push('/currentResume/personal_summary');
  payload.result.changes[0].source_refs.push('/currentResume/personal_summary');
  payload.plan.changes[0].introduced_terms = ['已有术语', '已有术语'];
  payload.result.changes[0].introduced_terms = ['已有术语', '已有术语'];

  const normalized = normalizeResumeOptimizationRun(payload);

  assert.deepEqual(normalized.result.changes[0].sourceLabels, ['当前简历']);
  assert.deepEqual(normalized.result.changes[0].introducedTerms, ['已有术语', '已有术语']);
});

test('rejects a non-empty result that diverges from the public plan', async () => {
  const { normalizeResumeOptimizationRun } = await importNormalizer();
  const payload = run();
  payload.result.changes[0].rationale = '与公开计划不同的内容';

  assert.throws(() => normalizeResumeOptimizationRun(payload));
});

test('defaults missing optional arrays without inventing actionable data', async () => {
  const { normalizeResumeOptimizationRun } = await importNormalizer();
  const payload = run({
    status: 'planning',
    plan: { safety_summary: {} },
    result: {},
  });
  delete payload.answers;
  delete payload.accepted_change_ids;

  const normalized = normalizeResumeOptimizationRun(payload);

  assert.deepEqual(normalized.plan.changes, []);
  assert.deepEqual(normalized.plan.questions, []);
  assert.deepEqual(normalized.plan.bankSuggestions, []);
  assert.equal(normalized.result, null);
  assert.deepEqual(normalized.answers, []);
  assert.deepEqual(normalized.acceptedChangeIds, []);
});

test('rejects unknown status, malformed changes, invalid UUIDs, and invalid timestamps', async () => {
  const { normalizeResumeOptimizationRun } = await importNormalizer();
  const invalidPayloads = [];

  const unknownStatus = structuredClone(run());
  unknownStatus.status = 'queued';
  invalidPayloads.push(unknownStatus);

  const malformedChange = structuredClone(run());
  malformedChange.result.changes[0].change_id = '';
  invalidPayloads.push(malformedChange);

  const missingBeforeValue = structuredClone(run());
  delete missingBeforeValue.result.changes[0].before_value;
  invalidPayloads.push(missingBeforeValue);

  const malformedResultRoot = structuredClone(run());
  malformedResultRoot.result = [];
  invalidPayloads.push(malformedResultRoot);

  const nonCanonicalUuid = structuredClone(run());
  nonCanonicalUuid.id = RUN_ID.replaceAll('-', '');
  invalidPayloads.push(nonCanonicalUuid);

  const invalidTimestamp = structuredClone(run());
  invalidTimestamp.updated_at = 'not-a-timestamp';
  invalidPayloads.push(invalidTimestamp);

  for (const payload of invalidPayloads) {
    assert.throws(() => normalizeResumeOptimizationRun(payload));
  }
});

test('rejects duplicate IDs and invalid cross references without silent deduplication', async () => {
  const { normalizeResumeOptimizationRun } = await importNormalizer();
  const invalidPayloads = [];

  const duplicateChanges = structuredClone(run());
  duplicateChanges.result.changes.push(structuredClone(duplicateChanges.result.changes[0]));
  invalidPayloads.push(duplicateChanges);

  const duplicateQuestions = structuredClone(run());
  duplicateQuestions.result.questions = [
    {
      question_id: 'Q1',
      module_id: 'current_resume',
      field_path: 'personalSummary',
      text: '请补充信息',
      reason: '需要事实',
      answer_type: 'single_choice_with_text',
      choices: [{ value: 'yes', label: '有' }],
      affects_change_ids: ['CHG_1'],
      priority: 1,
    },
  ];
  duplicateQuestions.result.questions.push(structuredClone(duplicateQuestions.result.questions[0]));
  invalidPayloads.push(duplicateQuestions);

  const duplicateSuggestions = structuredClone(run());
  duplicateSuggestions.result.bank_suggestions.push(suggestion());
  invalidPayloads.push(duplicateSuggestions);

  const duplicateAnswers = structuredClone(run());
  duplicateAnswers.answers = [
    { question_id: 'Q1', state: 'answered', value: '内容' },
    { question_id: 'Q1', state: 'no_data', value: '' },
  ];
  invalidPayloads.push(duplicateAnswers);

  const duplicateAccepted = structuredClone(run());
  duplicateAccepted.accepted_change_ids = ['CHG_1', 'CHG_1'];
  invalidPayloads.push(duplicateAccepted);

  const unknownQuestionReference = structuredClone(run());
  unknownQuestionReference.result.questions = [{
    ...duplicateQuestions.result.questions[0],
    affects_change_ids: ['CHG_UNKNOWN'],
  }];
  invalidPayloads.push(unknownQuestionReference);

  const emptyQuestionReference = structuredClone(run());
  emptyQuestionReference.result.questions = [{
    ...duplicateQuestions.result.questions[0],
    affects_change_ids: [],
  }];
  invalidPayloads.push(emptyQuestionReference);

  const overlappingSafety = structuredClone(run());
  overlappingSafety.result.safety_summary.blocked_change_ids.push('CHG_1');
  invalidPayloads.push(overlappingSafety);

  for (const payload of invalidPayloads) {
    assert.throws(() => normalizeResumeOptimizationRun(payload));
  }
});

test('rejects more than five questions or three bank suggestions', async () => {
  const { normalizeResumeOptimizationRun } = await importNormalizer();

  const tooManyQuestions = structuredClone(run());
  tooManyQuestions.result.questions = Array.from({ length: 6 }, (_, index) => ({
    question_id: `Q${index + 1}`,
    module_id: 'current_resume',
    field_path: 'personalSummary',
    text: `问题 ${index + 1}`,
    reason: '需要事实',
    answer_type: 'single_choice_with_text',
    choices: [],
    affects_change_ids: ['CHG_1'],
    priority: index,
  }));
  assert.throws(() => normalizeResumeOptimizationRun(tooManyQuestions));

  const tooManySuggestions = structuredClone(run());
  tooManySuggestions.result.bank_suggestions = Array.from(
    { length: 4 },
    (_, index) => suggestion(`BANK_${index + 1}`, `master-${index + 1}`),
  );
  assert.throws(() => normalizeResumeOptimizationRun(tooManySuggestions));
});

test('normalizes fixed six-dimension post evaluation and verifies all arithmetic', async () => {
  const { normalizeResumeOptimizationRun } = await importNormalizer();

  const normalized = normalizeResumeOptimizationRun(completedRun());

  assert.equal(normalized.postEvaluation.version, 'resume_optimization_post_evaluation_v1');
  assert.equal(normalized.postEvaluation.beforeScore, 50);
  assert.equal(normalized.postEvaluation.afterScore, 60);
  assert.equal(normalized.postEvaluation.dimensionDeltas.length, 6);
  assert.deepEqual(
    normalized.postEvaluation.dimensionDeltas.map((item) => item.dimension),
    DIMENSIONS,
  );
  assert.equal(normalized.postEvaluation.issueCounts.introduced, 1);
});

test('rejects missing or inconsistent post evaluation summaries', async () => {
  const { normalizeResumeOptimizationRun } = await importNormalizer();
  const invalidPayloads = [];

  invalidPayloads.push(completedRun({ post_evaluation: null }));

  const badScoreDelta = completedRun();
  badScoreDelta.post_evaluation.scoreDelta = 9;
  invalidPayloads.push(badScoreDelta);

  const badDimensionOrder = completedRun();
  badDimensionOrder.post_evaluation.dimensionDeltas.reverse();
  invalidPayloads.push(badDimensionOrder);

  const badDimensionDelta = completedRun();
  badDimensionDelta.post_evaluation.dimensionDeltas[0].delta = 1;
  invalidPayloads.push(badDimensionDelta);

  const badIssueArithmetic = completedRun();
  badIssueArithmetic.post_evaluation.issueCounts.introduced = 0;
  invalidPayloads.push(badIssueArithmetic);

  const badAcceptedCount = completedRun();
  badAcceptedCount.post_evaluation.acceptedChangeCount = 2;
  invalidPayloads.push(badAcceptedCount);

  invalidPayloads.push(completedRun({ source_before_score: null }));

  for (const payload of invalidPayloads) {
    assert.throws(() => normalizeResumeOptimizationRun(payload));
  }
});

test('allows post evaluation only on completed or reverted runs', async () => {
  const { normalizeResumeOptimizationRun } = await importNormalizer();

  assert.throws(() => normalizeResumeOptimizationRun(completedRun({ status: 'applied' })));
  assert.equal(
    normalizeResumeOptimizationRun(completedRun({ status: 'reverted' })).status,
    'reverted',
  );
});

test('normalizes apply/finalize/revert wrappers and rejects duplicate response IDs', async () => {
  const {
    normalizeResumeOptimizationApplyResponse,
    normalizeResumeOptimizationFinalizeResponse,
    normalizeResumeOptimizationRevertResponse,
  } = await importNormalizer();
  const appliedRun = run({ accepted_change_ids: ['CHG_1'] });

  const applied = normalizeResumeOptimizationApplyResponse({
    run: appliedRun,
    resume_updated_at: '2026-09-01T03:05:00Z',
    applied_change_ids: ['CHG_1'],
  });
  assert.equal(applied.resumeUpdatedAt, '2026-09-01T03:05:00.000Z');
  assert.deepEqual(applied.appliedChangeIds, ['CHG_1']);

  const finalized = normalizeResumeOptimizationFinalizeResponse({ run: completedRun() });
  assert.equal(finalized.run.status, 'completed');

  const reverted = normalizeResumeOptimizationRevertResponse({
    run: run({ status: 'reverted' }),
    resume_updated_at: '2026-09-01T03:15:00Z',
  });
  assert.equal(reverted.run.status, 'reverted');

  assert.throws(() => normalizeResumeOptimizationApplyResponse({
    run: appliedRun,
    resume_updated_at: '2026-09-01T03:05:00Z',
    applied_change_ids: ['CHG_1', 'CHG_1'],
  }));
});

test('canonicalizes naive backend timestamps as UTC rather than browser local time', async () => {
  const { normalizeResumeOptimizationRun } = await importNormalizer();
  const payload = run({
    source_resume_updated_at: '2026-09-01T11:00:00.123456+08:00',
    created_at: '2026-09-01T03:00:00.654321',
    updated_at: '2026-09-01T03:01:00',
  });

  const normalized = normalizeResumeOptimizationRun(payload);

  assert.equal(normalized.sourceResumeUpdatedAt, '2026-09-01T03:00:00.123456Z');
  assert.equal(normalized.createdAt, '2026-09-01T03:00:00.654321Z');
  assert.equal(normalized.updatedAt, '2026-09-01T03:01:00.000Z');
});

test('emits only safe labels for source references', async () => {
  const { formatResumeOptimizationSourceRef } = await importNormalizer();

  assert.equal(formatResumeOptimizationSourceRef('/currentResume/profile'), '当前简历');
  assert.equal(
    formatResumeOptimizationSourceRef('/selectedSourceExperiences/private-id/star/a'),
    '已选经历原始版本',
  );
  assert.equal(formatResumeOptimizationSourceRef('/userAnswers/Q_PRIVATE/value'), '本轮补充信息');
  assert.equal(formatResumeOptimizationSourceRef('/unknown/private/path'), '已验证来源');
});
