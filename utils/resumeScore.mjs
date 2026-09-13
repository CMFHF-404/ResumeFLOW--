import {normalizeEvidenceResumeScore,REVIEW_RESPONSE_SCHEMA_VERSION} from './evidenceResumeScore.mjs';
export const SCORE_VERSION = 'resume_score_v2';
export const SCORE_DIMENSIONS = ['逻辑清晰', 'STAR应用', '内容可读', '内容完整', '专业表达', '成果量化'];
export const EVIDENCE_SCORE_ENABLED = import.meta.env?.VITE_ENABLE_EVIDENCE_RESUME_SCORE === 'true';
export const REVIEW_V4_ENABLED = EVIDENCE_SCORE_ENABLED && import.meta.env?.VITE_ENABLE_RESUME_REVIEW_V4 === 'true';
export const isCurrentScoreVersion = value => EVIDENCE_SCORE_ENABLED
  ? REVIEW_V4_ENABLED ? value?.evaluationVersion === 'resume_score_v4' && value.scoringVersion === 'evidence_rubric_v2' && value.metadata?.responseSchemaVersion === REVIEW_RESPONSE_SCHEMA_VERSION
    : value?.evaluationVersion === 'resume_score_v3' && value.scoringVersion === 'evidence_rubric_v1'
  : value?.evaluationVersion === 'resume_score_v2' && value.scoringVersion === 'single_pass_v1';

export function normalizeResumeScore(value) {
  if (value?.evaluationVersion === 'resume_score_v3' || value?.evaluationVersion === 'resume_score_v4') return normalizeEvidenceResumeScore(value);
  if (!value || value.evaluationVersion !== SCORE_VERSION || value.scoringVersion !== 'single_pass_v1'
    || typeof value.summary !== 'string' || !Array.isArray(value.dimensions) || value.dimensions.length !== 6) return undefined;
  const dimensions = new Map();
  for (const row of value.dimensions) {
    if (!row || !SCORE_DIMENSIONS.includes(row.dimension) || dimensions.has(row.dimension)
      || typeof row.score !== 'number' || !Number.isFinite(row.score) || row.score < 0 || row.score > 100
      || (row.comment !== undefined && typeof row.comment !== 'string')) return undefined;
    dimensions.set(row.dimension, { dimension: row.dimension, score: row.score, comment: row.comment ?? '' });
  }
  const suggestions = value.suggestions ?? [];
  const ids = new Set();
  if (!Array.isArray(suggestions)) return undefined;
  for (const row of suggestions) {
    if (!row || ['suggestionId', 'moduleType', 'moduleId', 'fieldPath', 'dimension', 'problem', 'direction', 'label'].some(k => typeof row[k] !== 'string')
      || typeof row.editable !== 'boolean' || !SCORE_DIMENSIONS.includes(row.dimension) || ids.has(row.suggestionId)) return undefined;
    ids.add(row.suggestionId);
  }
  return { evaluationVersion: SCORE_VERSION, scoringVersion: 'single_pass_v1', evaluationScope: 'full_resume',
    overallScore: Math.round([...dimensions.values()].reduce((sum, row) => sum + row.score, 0) / 6),
    dimensions: SCORE_DIMENSIONS.map(name => dimensions.get(name)), summary: value.summary, suggestions,
    jdMatch: value.jdMatch ?? null };
}

export const scoreModuleKey = row => {
  if(row.executionBlockReason){
    if(row.fieldPath==='experience')return `experience_star:${row.moduleId}`;
    if(row.fieldPath==='education')return 'read_only:educations';
    if(row.fieldPath==='certification')return 'read_only:certifications';
    if(row.fieldPath==='skill')return `skill_text:${row.moduleId}`;
    if(row.fieldPath==='summary')return 'personal_summary:current_resume';
  }
  if(['experience_restructure','experience_hide'].includes(row.moduleType))return `experience_star:${row.moduleId}`;
  if(['education_courses','education_notes'].includes(row.moduleType))return 'read_only:educations';
  if(['certification_order','certification_hide'].includes(row.moduleType))return 'read_only:certifications';
  if(row.moduleType==='skill_create')return 'skills_order:skills';
  return `${row.moduleType}:${row.moduleId}`;
};
export function groupScoreSuggestions(suggestions) {
  const groups = new Map();
  for (const row of suggestions) {
    const key = scoreModuleKey(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.entries()];
}
