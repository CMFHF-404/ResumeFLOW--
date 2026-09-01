import { normalizeEvaluationDimension } from '../ResumeEvaluationReport/evaluationReportUtils.mjs';
import { stripRichTextToText } from '../../../../utils/richText.ts';

const TERMINAL_ANSWER_STATES = new Set([
  'no_data',
  'unknown',
  'not_my_work',
  'skipped',
]);

const TERMINAL_LABEL_STATES = new Map([
  ['没有数据', 'no_data'],
  ['记不清', 'unknown'],
  ['不属于我的工作', 'not_my_work'],
  ['跳过', 'skipped'],
]);

const MODULE_LABELS = new Map([
  ['experience_star', '经历 STAR'],
  ['personal_summary', '个人总结'],
  ['skills_order', '技能顺序'],
  ['section_order', '模块顺序'],
  ['bank_suggestion', '经历库机会'],
]);

const SOURCE_LABELS = new Map([
  ['当前简历', '当前简历'],
  ['已选经历原始版本', '从总经历补回'],
  ['本轮补充信息', '来自补充信息'],
  ['已验证来源', '已验证来源'],
]);

const SPECIAL_DIMENSION_LABELS = new Map([
  ['内容完整性', '内容完整'],
  ['教育背景', '教育背景'],
  ['证书完整性', '证书完整性'],
]);

const SECTION_LABELS = new Map([
  ['summary', '个人评价'],
  ['education', '教育背景'],
  ['work', '工作经历'],
  ['project', '项目经历'],
  ['certifications', '证书资质'],
  ['skills', '技能清单'],
]);

const EXPERIENCE_CATEGORIES = new Set(['work', 'project', 'education']);

const list = (value) => Array.isArray(value) ? value : [];
const text = (value) => typeof value === 'string' ? value.trim() : '';
const INTERNAL_COPY_MARKER = /(?:\/?(?:currentResume|current_resume|selectedSourceExperiences|selected_source_experiences|userAnswers|user_answers)(?:\/|\.|\b)|\b(?:moduleId|module_id|fieldPath|field_path|sourceRefs?|source_refs?|sourceSnapshotHash|source_snapshot_hash|affectsChangeIds|affects_change_ids|changeId|change_id|questionId|question_id|issueId|issue_id|evidenceId|evidence_id|masterExperienceId|master_experience_id|suggestionId|suggestion_id|runId|run_id|requestId|request_id)\b)/iu;

const looksLikeSerializedStructuredData = (value) => {
  if (!value.startsWith('{') && !value.startsWith('[')) return false;
  try {
    const parsed = JSON.parse(value);
    return parsed !== null && typeof parsed === 'object';
  } catch {
    return false;
  }
};

export const formatResumeOptimizationUserCopy = (value, fallback = '') => {
  const normalized = text(value);
  const safeFallback = text(fallback);
  if (!normalized) return safeFallback;
  const inspectionCopy = normalized
    .normalize('NFKC')
    .replace(/%2f/giu, '/')
    .replace(/~1/gu, '/');
  return INTERNAL_COPY_MARKER.test(inspectionCopy)
    || looksLikeSerializedStructuredData(inspectionCopy)
    ? safeFallback
    : normalized;
};

export const RESUME_OPTIMIZATION_TERMINAL_ANSWER_OPTIONS = Object.freeze([
  Object.freeze({ state: 'no_data', label: '没有数据' }),
  Object.freeze({ state: 'unknown', label: '记不清' }),
  Object.freeze({ state: 'not_my_work', label: '不属于我的工作' }),
  Object.freeze({ state: 'skipped', label: '跳过' }),
]);

export const buildResumeOptimizationOverviewMetrics = (plan) => {
  const changes = list(plan?.changes);
  return {
    directChanges: changes.filter((item) => (
      item?.actionKind === 'rewrite_now' && item?.safetyStatus === 'allowed'
    )).length,
    questions: list(plan?.questions).length,
    blockedChanges: changes.filter((item) => item?.safetyStatus === 'blocked').length,
    bankOpportunities: list(plan?.bankSuggestions).length,
  };
};

export const sortResumeOptimizationChangesByExpectedGain = (changes) => (
  list(changes)
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const leftGain = Number.isFinite(left.item?.expectedScoreGain)
        ? left.item.expectedScoreGain
        : 0;
      const rightGain = Number.isFinite(right.item?.expectedScoreGain)
        ? right.item.expectedScoreGain
        : 0;
      return rightGain - leftGain || left.index - right.index;
    })
    .map(({ item }) => item)
);

export const formatResumeOptimizationModuleLabel = (moduleType, fieldPath = '') => {
  if (fieldPath === 'unsupported') return '当前简历';
  return MODULE_LABELS.get(moduleType) ?? '简历内容';
};

export const formatResumeOptimizationDimensionLabel = (value) => {
  const normalized = text(value).replace(/\s+/g, '');
  if (!normalized) return '综合优化';
  return normalizeEvaluationDimension(normalized)
    || SPECIAL_DIMENSION_LABELS.get(normalized)
    || '综合优化';
};

export const formatResumeOptimizationSourceLabel = (value) => (
  SOURCE_LABELS.get(value) ?? '已验证来源'
);

export const isResumeOptimizationAnswerComplete = (draft) => {
  if (!draft || typeof draft !== 'object' || typeof draft.value !== 'string') return false;
  if (draft.state === 'answered') return Boolean(draft.value.trim());
  return TERMINAL_ANSWER_STATES.has(draft.state);
};

export const areResumeOptimizationAnswersComplete = (questions, drafts) => {
  if (!Array.isArray(questions) || questions.length === 0 || questions.length > 5) return false;
  if (!drafts || typeof drafts !== 'object' || Array.isArray(drafts)) return false;
  const questionIds = questions.map((question) => text(question?.questionId));
  if (questionIds.some((questionId) => !questionId)) return false;
  if (new Set(questionIds).size !== questionIds.length) return false;
  return questionIds.every((questionId) => isResumeOptimizationAnswerComplete(drafts[questionId]));
};

export const resolveResumeOptimizationChoiceDraft = (choice) => {
  if (!choice || typeof choice !== 'object') return null;
  const value = text(choice.value);
  const label = formatResumeOptimizationUserCopy(choice.label);
  if (!value || !label) return null;
  const terminalState = TERMINAL_ANSWER_STATES.has(value)
    ? value
    : TERMINAL_LABEL_STATES.get(label);
  return terminalState
    ? { state: terminalState, value: '' }
    : { state: 'answered', value: label };
};

export const buildResumeOptimizationQuestionChoices = (choices) => {
  const seenLabels = new Set();
  const resolved = [];
  for (const choice of list(choices)) {
    const draft = resolveResumeOptimizationChoiceDraft(choice);
    const label = formatResumeOptimizationUserCopy(choice?.label);
    if (!draft || draft.state !== 'answered' || seenLabels.has(label)) continue;
    seenLabels.add(label);
    resolved.push({ label, draft });
  }
  return resolved;
};

const fallbackPreviewLines = (value) => (
  value === null || value === undefined ? ['无内容'] : ['内容暂不可预览']
);

const formatRichTextPreviewLines = (value) => {
  if (typeof value !== 'string') return fallbackPreviewLines(value);
  const lines = stripRichTextToText(value)
    .split(/\r?\n/u)
    .map((item) => formatResumeOptimizationUserCopy(item))
    .filter(Boolean);
  return lines.length > 0 ? lines : ['无内容'];
};

const formatSkillOrderPreviewLines = (value, skillNameById) => {
  if (!Array.isArray(value)) return fallbackPreviewLines(value);
  return value.map((skillId) => {
    if (typeof skillId !== 'string') return '未知技能';
    const name = Object.prototype.hasOwnProperty.call(skillNameById, skillId)
      ? skillNameById[skillId]
      : undefined;
    return formatResumeOptimizationUserCopy(name, '未知技能');
  });
};

const formatSectionOrderPreviewLines = (value) => {
  if (!Array.isArray(value)) return fallbackPreviewLines(value);
  return value.map((sectionId) => (
    typeof sectionId === 'string' ? SECTION_LABELS.get(sectionId) ?? '其他模块' : '其他模块'
  ));
};

const formatChangePreviewLines = (moduleType, value, skillNameById) => {
  if (moduleType === 'skills_order') {
    return formatSkillOrderPreviewLines(value, skillNameById);
  }
  if (moduleType === 'section_order') {
    return formatSectionOrderPreviewLines(value);
  }
  return formatRichTextPreviewLines(value);
};

export const buildResumeOptimizationChangePreview = (change, skillNameById = {}) => ({
  before: formatChangePreviewLines(change?.moduleType, change?.beforeValue, skillNameById),
  after: change?.targetedValue === null
    ? ['保留原文']
    : formatChangePreviewLines(change?.moduleType, change?.targetedValue, skillNameById),
});

export const resolveResumeOptimizationExperienceCategory = (value) => (
  EXPERIENCE_CATEGORIES.has(value) ? value : undefined
);
