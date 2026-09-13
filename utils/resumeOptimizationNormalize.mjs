const STATUS_VALUES = new Set([
  'planning',
  'awaiting_answers',
  'preview_ready',
  'applying',
  'applied',
  'rescoring',
  'completed',
  'failed',
  'stale',
  'cancelled',
  'reverted',
]);
const ACTION_VALUES = new Set([
  'rewrite_now',
  'ask_user',
  'suggest_from_bank',
  'leave_unchanged',
]);
const SCOPE_VALUES = new Set(['general', 'jd_targeted']);
const MODULE_VALUES = new Set([
  'experience_star',
  'personal_summary',
  'skills_order',
  'skill_text',
  'education_courses','education_notes','certification_order','certification_hide','experience_order','experience_hide','experience_restructure','skill_create',
  'section_order',
  'bank_suggestion',
]);
const ANSWER_STATE_VALUES = new Set([
  'answered',
  'no_data',
  'unknown',
  'not_my_work',
  'skipped',
]);
const SAFETY_STATUS_VALUES = new Set(['pending', 'allowed', 'blocked', 'not_reviewed']);
const GUIDANCE_BAND_VALUES = new Set([
  'strong',
  'adequate',
  'needs_attention',
  'insufficient_evidence',
]);
const PROGRESS_NODES = new Set([
  'freeze_snapshot',
  'prepare_context',
  'plan_changes',
  'verify_changes',
  'persist_run',
  'rewrite_answers',
]);
const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ISO_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?([zZ]|[+-]\d{2}:\d{2})?$/;

export const RESUME_OPTIMIZATION_DIMENSIONS = Object.freeze([
  '逻辑清晰',
  'STAR应用',
  '内容可读',
  '内容完整',
  '专业表达',
  '成果量化',
]);

export class ResumeOptimizationNormalizationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ResumeOptimizationNormalizationError';
    this.code = 'resume_optimization_response_invalid';
  }
}

const fail = (message) => {
  throw new ResumeOptimizationNormalizationError(message);
};

const toRecord = (value, fieldName) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${fieldName} must be an object`);
  }
  return value;
};

const aliased = (record, camel, snake) => (
  Object.prototype.hasOwnProperty.call(record, camel)
    ? record[camel]
    : record[snake]
);

const hasAliased = (record, camel, snake) => (
  Object.prototype.hasOwnProperty.call(record, camel)
  || Object.prototype.hasOwnProperty.call(record, snake)
);

const requiredText = (value, fieldName) => {
  if (typeof value !== 'string' || !value.trim()) {
    fail(`${fieldName} must be a non-empty string`);
  }
  return value.trim();
};

const optionalText = (value, fieldName, defaultValue = '') => {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value !== 'string') fail(`${fieldName} must be a string`);
  return value;
};

const requiredBoolean = (value, fieldName) => {
  if (typeof value !== 'boolean') fail(`${fieldName} must be a boolean`);
  return value;
};

const integer = (value, fieldName, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) => {
  if (!Number.isInteger(value) || value < min || value > max) {
    fail(`${fieldName} must be an integer between ${min} and ${max}`);
  }
  return value;
};

const enumValue = (value, allowed, fieldName) => {
  if (typeof value !== 'string' || !allowed.has(value)) {
    fail(`${fieldName} has an unsupported value`);
  }
  return value;
};

const textArray = (value, fieldName, { defaultEmpty = true } = {}) => {
  if ((value === undefined || value === null) && defaultEmpty) return [];
  if (!Array.isArray(value)) fail(`${fieldName} must be an array`);
  return value.map((item, index) => requiredText(item, `${fieldName}[${index}]`));
};

const uniqueTextArray = (value, fieldName, options = {}) => {
  const resolved = textArray(value, fieldName, options);
  if (new Set(resolved).size !== resolved.length) {
    fail(`${fieldName} must not contain duplicates`);
  }
  return resolved;
};

const cloneJsonValue = (value) => {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    fail('optimization values must be JSON serializable');
  }
};

export const canonicalizeResumeOptimizationUuid = (value, fieldName = 'uuid') => {
  if (typeof value !== 'string' || !CANONICAL_UUID.test(value)) {
    fail(`${fieldName} must be a canonical UUID`);
  }
  return value;
};

export const canonicalizeResumeOptimizationTimestamp = (
  value,
  fieldName = 'timestamp',
) => {
  if (typeof value !== 'string' || !value.trim()) {
    fail(`${fieldName} must be an ISO timestamp`);
  }
  const source = value.trim();
  const match = ISO_TIMESTAMP.exec(source);
  if (!match) fail(`${fieldName} must be an ISO timestamp`);
  const [, year, month, day, hour, minute, second, fraction = '', zone = ''] = match;
  const wallClock = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
  if (
    !Number.isFinite(wallClock.getTime())
    || wallClock.getUTCFullYear() !== Number(year)
    || wallClock.getUTCMonth() + 1 !== Number(month)
    || wallClock.getUTCDate() !== Number(day)
    || wallClock.getUTCHours() !== Number(hour)
    || wallClock.getUTCMinutes() !== Number(minute)
    || wallClock.getUTCSeconds() !== Number(second)
  ) {
    fail(`${fieldName} must be an ISO timestamp`);
  }
  const candidate = zone ? source : `${source}Z`;
  const parsed = Date.parse(candidate);
  if (!Number.isFinite(parsed)) fail(`${fieldName} must be an ISO timestamp`);
  const canonical = new Date(parsed).toISOString();
  return fraction.length > 3
    ? `${canonical.slice(0, 19)}.${fraction}Z`
    : canonical;
};

const optionalTimestamp = (value, fieldName) => (
  value === undefined || value === null
    ? null
    : canonicalizeResumeOptimizationTimestamp(value, fieldName)
);

export const formatResumeOptimizationSourceRef = (value) => {
  if (typeof value !== 'string') return '已验证来源';
  if (value === '/currentResume' || value.startsWith('/currentResume/')) {
    return '当前简历';
  }
  if (
    value === '/selectedSourceExperiences'
    || value.startsWith('/selectedSourceExperiences/')
  ) {
    return '已选经历原始版本';
  }
  if (value === '/userAnswers' || value.startsWith('/userAnswers/')) {
    return '本轮补充信息';
  }
  return '已验证来源';
};

const normalizeSafetySummary = (value, fieldName, knownChangeIds = null) => {
  const record = value === undefined || value === null
    ? {}
    : toRecord(value, fieldName);
  const allowedChangeIds = uniqueTextArray(
    aliased(record, 'allowedChangeIds', 'allowed_change_ids'),
    `${fieldName}.allowed_change_ids`,
  );
  const blockedChangeIds = uniqueTextArray(
    aliased(record, 'blockedChangeIds', 'blocked_change_ids'),
    `${fieldName}.blocked_change_ids`,
  );
  const pendingChangeIds = uniqueTextArray(
    aliased(record, 'pendingChangeIds', 'pending_change_ids'),
    `${fieldName}.pending_change_ids`,
  );
  const findings = uniqueTextArray(record.findings, `${fieldName}.findings`);
  const combined = [...allowedChangeIds, ...blockedChangeIds, ...pendingChangeIds];
  if (new Set(combined).size !== combined.length) {
    fail(`${fieldName} status ID sets must be disjoint`);
  }
  if (knownChangeIds) {
    for (const changeId of combined) {
      if (!knownChangeIds.has(changeId)) {
        fail(`${fieldName} references an unknown change ID`);
      }
    }
  }
  return { allowedChangeIds, blockedChangeIds, pendingChangeIds, findings };
};

const normalizeChange = (value, index) => {
  const fieldName = `changes[${index}]`;
  const record = toRecord(value, fieldName);
  const changeId = requiredText(aliased(record, 'changeId', 'change_id'), `${fieldName}.change_id`);
  const actionKind = enumValue(
    aliased(record, 'actionKind', 'action_kind'),
    ACTION_VALUES,
    `${fieldName}.action_kind`,
  );
  const moduleType = enumValue(
    aliased(record, 'moduleType', 'module_type'),
    MODULE_VALUES,
    `${fieldName}.module_type`,
  );
  const safetyStatus = enumValue(
    aliased(record, 'safetyStatus', 'safety_status'),
    SAFETY_STATUS_VALUES,
    `${fieldName}.safety_status`,
  );
  const sourceRefs = textArray(
    aliased(record, 'sourceRefs', 'source_refs'),
    `${fieldName}.source_refs`,
  );
  if (!hasAliased(record, 'beforeValue', 'before_value')) {
    fail(`${fieldName}.before_value is required`);
  }
  const generalValue = cloneJsonValue(aliased(record, 'generalValue', 'general_value'));
  const targetedValue = cloneJsonValue(aliased(record, 'targetedValue', 'targeted_value'));
  for(const preview of [record.display_before??record.displayBefore,record.display_after??record.displayAfter]){
    if(preview!=null&&(!Array.isArray(preview)||!preview.every(item=>typeof item==='string')))fail(`${fieldName} invalid display values`);
  }
  if (actionKind === 'rewrite_now' && (generalValue === null || targetedValue === null)) {
    fail(`${fieldName} rewrite_now values are required`);
  }
  if(moduleType==='skill_text') {
    for(const v of [aliased(record,'beforeValue','before_value'),generalValue,targetedValue]) {
      if(v===null)continue;
      if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join(',')!=='category,name'||typeof v.name!=='string'||!v.name.trim()||typeof v.category!=='string'||!v.category.trim())fail(`${fieldName} invalid skill text`);
    }
    if(aliased(record,'fieldPath','field_path')!=='skill.text')fail(`${fieldName} invalid skill path`);
  }
  const isTextModule = moduleType === 'experience_star' || moduleType === 'personal_summary';
  const isTextChanging = isTextModule && (
    actionKind === 'rewrite_now'
    || (actionKind === 'ask_user' && (generalValue !== null || targetedValue !== null))
  );
  if (isTextChanging && safetyStatus !== 'not_reviewed' && sourceRefs.length === 0) {
    fail(`${fieldName} text changes require source references`);
  }
  const sourceLabels = [...new Set(sourceRefs.map(formatResumeOptimizationSourceRef))];
  const requestedDefault = requiredBoolean(
    aliased(record, 'defaultSelected', 'default_selected'),
    `${fieldName}.default_selected`,
  );
  return {
    changeId,
    displayBefore: record.display_before ?? record.displayBefore ?? null,
    displayAfter: record.display_after ?? record.displayAfter ?? null,
    issueIds: uniqueTextArray(
      aliased(record, 'issueIds', 'issue_ids'),
      `${fieldName}.issue_ids`,
    ),
    dimension: requiredText(record.dimension, `${fieldName}.dimension`),
    moduleType,
    moduleId: requiredText(
      aliased(record, 'moduleId', 'module_id'),
      `${fieldName}.module_id`,
    ),
    fieldPath: requiredText(
      aliased(record, 'fieldPath', 'field_path'),
      `${fieldName}.field_path`,
    ),
    actionKind,
    scope: enumValue(record.scope, SCOPE_VALUES, `${fieldName}.scope`),
    beforeValue: cloneJsonValue(aliased(record, 'beforeValue', 'before_value')),
    generalValue,
    targetedValue,
    sourceLabels,
    introducedTerms: textArray(
      aliased(record, 'introducedTerms', 'introduced_terms'),
      `${fieldName}.introduced_terms`,
    ),
    rationale: requiredText(record.rationale, `${fieldName}.rationale`),
    defaultSelected: safetyStatus === 'blocked' ? false : requestedDefault,
    safetyStatus,
    safetyFindings: uniqueTextArray(
      aliased(record, 'safetyFindings', 'safety_findings'),
      `${fieldName}.safety_findings`,
    ),
  };
};

const normalizeQuestion = (value, index) => {
  const fieldName = `questions[${index}]`;
  const record = toRecord(value, fieldName);
  const rawChoices = record.choices ?? [];
  if (!Array.isArray(rawChoices)) fail(`${fieldName}.choices must be an array`);
  const choices = rawChoices.map((choiceValue, choiceIndex) => {
    const choice = toRecord(choiceValue, `${fieldName}.choices[${choiceIndex}]`);
    return {
      value: requiredText(choice.value, `${fieldName}.choices[${choiceIndex}].value`),
      label: requiredText(choice.label, `${fieldName}.choices[${choiceIndex}].label`),
    };
  });
  if (new Set(choices.map((choice) => choice.value)).size !== choices.length) {
    fail(`${fieldName}.choices must have unique values`);
  }
  const answerType = record.answer_type ?? record.answerType ?? 'single_choice_with_text';
  if (!['single_choice_with_text','skill_confirmation'].includes(answerType)) {
    fail(`${fieldName}.answer_type has an unsupported value`);
  }
  if(answerType==='skill_confirmation'){
    const original=record.skill_original??record.skillOriginal;
    if(!original||typeof original.name!=='string'||!original.name.trim()||typeof original.category!=='string'||!original.category.trim()||choices.length)fail(`${fieldName} skill confirmation requires original text and no inferred choices`);
  }
  const affectsChangeIds = uniqueTextArray(
    aliased(record, 'affectsChangeIds', 'affects_change_ids'),
    `${fieldName}.affects_change_ids`,
  );
  if (affectsChangeIds.length === 0) {
    fail(`${fieldName}.affects_change_ids must not be empty`);
  }
  return {
    questionId: requiredText(
      aliased(record, 'questionId', 'question_id'),
      `${fieldName}.question_id`,
    ),
    moduleId: requiredText(
      aliased(record, 'moduleId', 'module_id'),
      `${fieldName}.module_id`,
    ),
    fieldPath: requiredText(
      aliased(record, 'fieldPath', 'field_path'),
      `${fieldName}.field_path`,
    ),
    text: requiredText(record.text, `${fieldName}.text`),
    reason: requiredText(record.reason, `${fieldName}.reason`),
    answerType,
    skillOriginal: record.skill_original ?? record.skillOriginal ?? null,
    choices,
    affectsChangeIds,
    priority: integer(record.priority ?? 0, `${fieldName}.priority`, { min: 0 }),
  };
};

const normalizeAnswer = (value, index) => {
  const fieldName = `answers[${index}]`;
  const record = toRecord(value, fieldName);
  const state = enumValue(record.state, ANSWER_STATE_VALUES, `${fieldName}.state`);
  const rawValue = record.value ?? '';
  if (typeof rawValue !== 'string') fail(`${fieldName}.value must be a string`);
  if (state === 'answered' && !rawValue.trim()) {
    fail(`${fieldName}.answered value must not be empty`);
  }
  return {
    questionId: requiredText(
      aliased(record, 'questionId', 'question_id'),
      `${fieldName}.question_id`,
    ),
    state,
    value: rawValue,
  };
};

const normalizeBankSuggestion = (value, index) => {
  const fieldName = `bank_suggestions[${index}]`;
  const record = toRecord(value, fieldName);
  return {
    suggestionId: requiredText(
      aliased(record, 'suggestionId', 'suggestion_id'),
      `${fieldName}.suggestion_id`,
    ),
    masterExperienceId: requiredText(
      aliased(record, 'masterExperienceId', 'master_experience_id'),
      `${fieldName}.master_experience_id`,
    ),
    category: requiredText(record.category, `${fieldName}.category`),
    title: requiredText(record.title, `${fieldName}.title`),
    org: requiredText(record.org, `${fieldName}.org`),
    matchScore: integer(
      aliased(record, 'matchScore', 'match_score'),
      `${fieldName}.match_score`,
      { min: 0, max: 100 },
    ),
    reason: requiredText(record.reason, `${fieldName}.reason`),
    capabilities: uniqueTextArray(record.capabilities, `${fieldName}.capabilities`),
  };
};

const assertUniqueIds = (values, fieldName) => {
  if (new Set(values).size !== values.length) fail(`${fieldName} IDs must be unique`);
};

const normalizePlan = (value, fieldName) => {
  const record = value === undefined || value === null
    ? {}
    : toRecord(value, fieldName);
  const rawChanges = record.changes ?? [];
  const rawQuestions = record.questions ?? [];
  const rawSuggestions = aliased(record, 'bankSuggestions', 'bank_suggestions') ?? [];
  if (!Array.isArray(rawChanges)) fail(`${fieldName}.changes must be an array`);
  if (!Array.isArray(rawQuestions)) fail(`${fieldName}.questions must be an array`);
  if (!Array.isArray(rawSuggestions)) fail(`${fieldName}.bank_suggestions must be an array`);
  if (rawQuestions.length > 5) fail(`${fieldName} may contain at most five questions`);
  if (rawSuggestions.length > 3) fail(`${fieldName} may contain at most three suggestions`);

  const changes = rawChanges.map(normalizeChange);
  const questions = rawQuestions.map(normalizeQuestion);
  const bankSuggestions = rawSuggestions.map(normalizeBankSuggestion);
  assertUniqueIds(changes.map((item) => item.changeId), `${fieldName}.changes`);
  assertUniqueIds(questions.map((item) => item.questionId), `${fieldName}.questions`);
  assertUniqueIds(bankSuggestions.map((item) => item.suggestionId), `${fieldName}.bank_suggestions`);
  assertUniqueIds(
    bankSuggestions.map((item) => item.masterExperienceId),
    `${fieldName}.bank_suggestions.master_experience_id`,
  );

  const changeIds = new Set(changes.map((item) => item.changeId));
  for (const question of questions) {
    for (const changeId of question.affectsChangeIds) {
      if (!changeIds.has(changeId)) fail(`${fieldName}.questions reference an unknown change`);
    }
  }
  const safetySummary = normalizeSafetySummary(
    aliased(record, 'safetySummary', 'safety_summary'),
    `${fieldName}.safety_summary`,
    changeIds,
  );
  const changesById = new Map(changes.map((item) => [item.changeId, item]));
  for (const changeId of safetySummary.allowedChangeIds) {
    if (changesById.get(changeId)?.safetyStatus !== 'allowed') {
      fail(`${fieldName}.allowed_change_ids disagrees with change safety status`);
    }
  }
  for (const changeId of safetySummary.blockedChangeIds) {
    if (changesById.get(changeId)?.safetyStatus !== 'blocked') {
      fail(`${fieldName}.blocked_change_ids disagrees with change safety status`);
    }
  }
  for (const changeId of safetySummary.pendingChangeIds) {
    if (changesById.get(changeId)?.safetyStatus !== 'pending') {
      fail(`${fieldName}.pending_change_ids disagrees with change safety status`);
    }
  }
  return { changes, questions, bankSuggestions, safetySummary };
};

const normalizeLegacyPostEvaluation = (record, knownChangeIds) => {
  const beforeScore = integer(record.beforeScore, 'post_evaluation.beforeScore', { min: 0, max: 100 });
  const afterScore = integer(record.afterScore, 'post_evaluation.afterScore', { min: 0, max: 100 });
  const scoreDelta = integer(record.scoreDelta, 'post_evaluation.scoreDelta', { min: -100, max: 100 });
  if (scoreDelta !== afterScore - beforeScore) fail('post_evaluation score arithmetic is invalid');
  if (!Array.isArray(record.dimensionDeltas) || record.dimensionDeltas.length !== 6) {
    fail('post_evaluation.dimensionDeltas must contain six items');
  }
  const dimensionDeltas = record.dimensionDeltas.map((item, index) => {
    const deltaRecord = toRecord(item, `post_evaluation.dimensionDeltas[${index}]`);
    const dimension = requiredText(deltaRecord.dimension, `post_evaluation.dimensionDeltas[${index}].dimension`);
    if (dimension !== RESUME_OPTIMIZATION_DIMENSIONS[index]) {
      fail('post_evaluation dimension order is invalid');
    }
    const before = integer(deltaRecord.beforeScore, 'dimension beforeScore', { min: 0, max: 100 });
    const after = integer(deltaRecord.afterScore, 'dimension afterScore', { min: 0, max: 100 });
    const delta = integer(deltaRecord.delta, 'dimension delta', { min: -100, max: 100 });
    if (delta !== after - before) fail('post_evaluation dimension arithmetic is invalid');
    return { dimension, beforeScore: before, afterScore: after, delta };
  });
  const issueRecord = toRecord(record.issueCounts, 'post_evaluation.issueCounts');
  const issueCounts = {
    before: integer(issueRecord.before, 'issueCounts.before', { min: 0 }),
    after: integer(issueRecord.after, 'issueCounts.after', { min: 0 }),
    resolved: integer(issueRecord.resolved, 'issueCounts.resolved', { min: 0 }),
    remaining: integer(issueRecord.remaining, 'issueCounts.remaining', { min: 0 }),
    introduced: integer(issueRecord.introduced, 'issueCounts.introduced', { min: 0 }),
  };
  if (
    issueCounts.remaining !== issueCounts.after
    || issueCounts.resolved > issueCounts.before
    || issueCounts.introduced > issueCounts.after
    || issueCounts.after !== issueCounts.before - issueCounts.resolved + issueCounts.introduced
  ) {
    fail('post_evaluation issue arithmetic is invalid');
  }
  return {
    version: 'resume_optimization_post_evaluation_v1',
    evaluationSignature: requiredText(record.evaluationSignature, 'post_evaluation.evaluationSignature'),
    resumeUpdatedAt: canonicalizeResumeOptimizationTimestamp(record.resumeUpdatedAt, 'post_evaluation.resumeUpdatedAt'),
    beforeScore,
    afterScore,
    scoreDelta,
    dimensionDeltas,
    issueCounts,
    unresolvedFactGapCount: integer(record.unresolvedFactGapCount, 'post_evaluation.unresolvedFactGapCount', { min: 0 }),
    acceptedChangeCount: integer(record.acceptedChangeCount, 'post_evaluation.acceptedChangeCount', { min: 0 }),
    blockedChangeCount: integer(record.blockedChangeCount, 'post_evaluation.blockedChangeCount', { min: 0 }),
    bankSuggestionCount: integer(record.bankSuggestionCount, 'post_evaluation.bankSuggestionCount', { min: 0 }),
    safetySummary: normalizeSafetySummary(
      record.safetySummary,
      'post_evaluation.safetySummary',
      knownChangeIds,
    ),
  };
};

const normalizeGuidancePostEvaluation = (record, knownChangeIds) => {
  for (const forbiddenField of [
    'beforeScore', 'before_score', 'afterScore', 'after_score',
    'scoreDelta', 'score_delta', 'dimensionDeltas', 'dimension_deltas',
  ]) {
    if (Object.prototype.hasOwnProperty.call(record, forbiddenField)) {
      fail(`post_evaluation.${forbiddenField} is not public guidance data`);
    }
  }
  const rawDimensionChanges = aliased(
    record,
    'dimensionStatusChanges',
    'dimension_status_changes',
  );
  if (!Array.isArray(rawDimensionChanges) || rawDimensionChanges.length !== 6) {
    fail('post_evaluation.dimensionStatusChanges must contain six items');
  }
  const dimensionStatusChanges = rawDimensionChanges.map((item, index) => {
    const change = toRecord(item, `post_evaluation.dimensionStatusChanges[${index}]`);
    const dimension = requiredText(
      change.dimension,
      `post_evaluation.dimensionStatusChanges[${index}].dimension`,
    );
    if (dimension !== RESUME_OPTIMIZATION_DIMENSIONS[index]) {
      fail('post_evaluation dimension order is invalid');
    }
    return {
      dimension,
      beforeStatus: enumValue(
        aliased(change, 'beforeStatus', 'before_status'),
        GUIDANCE_BAND_VALUES,
        `post_evaluation.dimensionStatusChanges[${index}].beforeStatus`,
      ),
      afterStatus: enumValue(
        aliased(change, 'afterStatus', 'after_status'),
        GUIDANCE_BAND_VALUES,
        `post_evaluation.dimensionStatusChanges[${index}].afterStatus`,
      ),
    };
  });
  const issueRecord = toRecord(
    aliased(record, 'issueSummary', 'issue_summary'),
    'post_evaluation.issueSummary',
  );
  return {
    version: 'guidance_optimization_post_v1',
    evaluationSignature: requiredText(
      aliased(record, 'evaluationSignature', 'evaluation_signature'),
      'post_evaluation.evaluationSignature',
    ),
    resumeUpdatedAt: canonicalizeResumeOptimizationTimestamp(
      aliased(record, 'resumeUpdatedAt', 'resume_updated_at'),
      'post_evaluation.resumeUpdatedAt',
    ),
    overallBandBefore: enumValue(
      aliased(record, 'overallBandBefore', 'overall_band_before'),
      GUIDANCE_BAND_VALUES,
      'post_evaluation.overallBandBefore',
    ),
    overallBandAfter: enumValue(
      aliased(record, 'overallBandAfter', 'overall_band_after'),
      GUIDANCE_BAND_VALUES,
      'post_evaluation.overallBandAfter',
    ),
    dimensionStatusChanges,
    issueSummary: {
      resolved: integer(issueRecord.resolved, 'post_evaluation.issueSummary.resolved', { min: 0 }),
      remaining: integer(issueRecord.remaining, 'post_evaluation.issueSummary.remaining', { min: 0 }),
    },
    unresolvedFactGapCount: integer(
      aliased(record, 'unresolvedFactGapCount', 'unresolved_fact_gap_count'),
      'post_evaluation.unresolvedFactGapCount',
      { min: 0 },
    ),
    acceptedChangeCount: integer(
      aliased(record, 'acceptedChangeCount', 'accepted_change_count'),
      'post_evaluation.acceptedChangeCount',
      { min: 0 },
    ),
    blockedChangeCount: integer(
      aliased(record, 'blockedChangeCount', 'blocked_change_count'),
      'post_evaluation.blockedChangeCount',
      { min: 0 },
    ),
    bankSuggestionCount: integer(
      aliased(record, 'bankSuggestionCount', 'bank_suggestion_count'),
      'post_evaluation.bankSuggestionCount',
      { min: 0 },
    ),
    safetySummary: normalizeSafetySummary(
      aliased(record, 'safetySummary', 'safety_summary'),
      'post_evaluation.safetySummary',
      knownChangeIds,
    ),
  };
};

const normalizePostEvaluation = (value, knownChangeIds) => {
  const record = toRecord(value, 'post_evaluation');
  if (record.version === 'resume_optimization_post_evaluation_v1') {
    return normalizeLegacyPostEvaluation(record, knownChangeIds);
  }
  if (record.version === 'guidance_optimization_post_v1') {
    return normalizeGuidancePostEvaluation(record, knownChangeIds);
  }
  fail('post_evaluation.version is unsupported');
};

const sameSafetySummary = (left, right) => JSON.stringify(left) === JSON.stringify(right);

export const normalizeResumeOptimizationRun = (value) => {
  const record = toRecord(value, 'run');
  const status = enumValue(record.status, STATUS_VALUES, 'run.status');
  if (record.optimizer_version !== 'resume_optimization_v1') fail('run.optimizer_version is unsupported');
  if (!['thin_safety_v1', 'evidence_semantic_v2', 'json_structure_v1', 'json_structure_v2', 'json_structure_v3'].includes(record.policy_version)) fail('run.policy_version is unsupported');
  if (!['resume_optimization_prompt_v1', 'resume_optimization_tasks_v2', 'resume_optimization_single_pass_v1'].includes(record.prompt_version)) fail('run.prompt_version is unsupported');

  const plan = normalizePlan(record.plan, 'run.plan');
  const rawResult = record.result;
  let result = null;
  if (rawResult !== undefined && rawResult !== null) {
    const resultRecord = toRecord(rawResult, 'run.result');
    if (Object.keys(resultRecord).length > 0) {
      result = normalizePlan(resultRecord, 'run.result');
    }
  }
  if (result !== null && JSON.stringify(plan) !== JSON.stringify(result)) {
    fail('run.plan and non-empty run.result must be identical');
  }
  const effectivePlan = result ?? plan;
  const effectiveChangeIds = new Set(effectivePlan.changes.map((item) => item.changeId));

  const rawAnswers = record.answers ?? [];
  if (!Array.isArray(rawAnswers) || rawAnswers.length > 5) fail('run.answers must be an array of at most five items');
  const answers = rawAnswers.map(normalizeAnswer);
  assertUniqueIds(answers.map((item) => item.questionId), 'run.answers');

  const acceptedChangeIds = uniqueTextArray(record.accepted_change_ids, 'run.accepted_change_ids');
  const changesById = new Map(effectivePlan.changes.map((item) => [item.changeId, item]));
  for (const changeId of acceptedChangeIds) {
    const change = changesById.get(changeId);
    if (!change || !['allowed', 'not_reviewed'].includes(change.safetyStatus)) {
      fail('run.accepted_change_ids contains an unknown or unsafe change');
    }
  }

  const sourceBeforeScore = record.source_before_score === undefined || record.source_before_score === null
    ? null
    : integer(record.source_before_score, 'run.source_before_score', { min: 0, max: 100 });
  const postEvaluation = record.post_evaluation === undefined || record.post_evaluation === null
    ? null
    : normalizePostEvaluation(record.post_evaluation, effectiveChangeIds);
  if (postEvaluation !== null && status !== 'completed' && status !== 'reverted') {
    fail('post_evaluation is allowed only on completed or reverted runs');
  }
  if (status === 'completed' && postEvaluation === null) {
    fail('completed runs require post_evaluation');
  }
  if (postEvaluation) {
    if (
      postEvaluation.acceptedChangeCount !== acceptedChangeIds.length
      || postEvaluation.blockedChangeCount !== effectivePlan.safetySummary.blockedChangeIds.length
      || postEvaluation.bankSuggestionCount !== effectivePlan.bankSuggestions.length
      || !sameSafetySummary(postEvaluation.safetySummary, effectivePlan.safetySummary)
    ) {
      fail('post_evaluation disagrees with the run result');
    }
    if (
      postEvaluation.version === 'resume_optimization_post_evaluation_v1'
      && (sourceBeforeScore === null || postEvaluation.beforeScore !== sourceBeforeScore)
    ) {
      fail('post_evaluation disagrees with the run result');
    }
  }

  return {
    id: canonicalizeResumeOptimizationUuid(record.id, 'run.id'),
    resumeId: canonicalizeResumeOptimizationUuid(record.resume_id, 'run.resume_id'),
    status,
    optimizerVersion: 'resume_optimization_v1',
    policyVersion: record.policy_version,
    promptVersion: record.prompt_version,
    sourceResumeUpdatedAt: canonicalizeResumeOptimizationTimestamp(
      record.source_resume_updated_at,
      'run.source_resume_updated_at',
    ),
    sourceEvaluationSignature: requiredText(
      record.source_evaluation_signature,
      'run.source_evaluation_signature',
    ),
    sourceJdSignature: optionalText(record.source_jd_signature, 'run.source_jd_signature'),
    sourceSnapshotHash: requiredText(record.source_snapshot_hash, 'run.source_snapshot_hash'),
    sourceBeforeScore,
    plan,
    answers,
    result,
    postEvaluation,
    acceptedChangeIds,
    appliedContentSignature: record.applied_content_signature === undefined || record.applied_content_signature === null
      ? null
      : requiredText(record.applied_content_signature, 'run.applied_content_signature'),
    createdAt: canonicalizeResumeOptimizationTimestamp(record.created_at, 'run.created_at'),
    updatedAt: canonicalizeResumeOptimizationTimestamp(record.updated_at, 'run.updated_at'),
    appliedResumeUpdatedAt: optionalTimestamp(
      record.applied_resume_updated_at,
      'run.applied_resume_updated_at',
    ),
    appliedAt: optionalTimestamp(record.applied_at, 'run.applied_at'),
    completedAt: optionalTimestamp(record.completed_at, 'run.completed_at'),
  };
};

export const normalizeResumeOptimizationApplyResponse = (value) => {
  const record = toRecord(value, 'apply_response');
  const run = normalizeResumeOptimizationRun(record.run);
  const appliedChangeIds = uniqueTextArray(record.applied_change_ids, 'apply_response.applied_change_ids');
  if (JSON.stringify(appliedChangeIds) !== JSON.stringify(run.acceptedChangeIds)) {
    fail('apply response IDs disagree with the run');
  }
  return {
    run,
    resumeUpdatedAt: canonicalizeResumeOptimizationTimestamp(
      record.resume_updated_at,
      'apply_response.resume_updated_at',
    ),
    appliedChangeIds,
  };
};

export const normalizeResumeOptimizationFinalizeResponse = (value) => {
  const record = toRecord(value, 'finalize_response');
  return { run: normalizeResumeOptimizationRun(record.run) };
};

export const normalizeResumeOptimizationRevertResponse = (value) => {
  const record = toRecord(value, 'revert_response');
  return {
    run: normalizeResumeOptimizationRun(record.run),
    resumeUpdatedAt: canonicalizeResumeOptimizationTimestamp(
      record.resume_updated_at,
      'revert_response.resume_updated_at',
    ),
  };
};

export const normalizeResumeOptimizationStreamEvent = (value) => {
  const record = toRecord(value, 'stream_event');
  if (record.type === 'progress') {
    return {
      type: 'progress',
      node: enumValue(record.node, PROGRESS_NODES, 'stream_event.node'),
      title: requiredText(record.title, 'stream_event.title'),
      requestId: requiredText(record.requestId, 'stream_event.requestId'),
    };
  }
  if (record.type === 'final') {
    return {
      type: 'final',
      result: normalizeResumeOptimizationRun(record.result),
      requestId: requiredText(record.requestId, 'stream_event.requestId'),
    };
  }
  if (record.type === 'error') {
    return {
      type: 'error',
      code: requiredText(record.code, 'stream_event.code'),
      message: requiredText(record.message, 'stream_event.message'),
      requestId: requiredText(record.requestId, 'stream_event.requestId'),
      statusCode: integer(record.statusCode, 'stream_event.statusCode', { min: 100, max: 599 }),
      retryable: requiredBoolean(record.retryable, 'stream_event.retryable'),
    };
  }
  fail('stream_event.type is unsupported');
};
