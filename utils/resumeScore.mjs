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

export function sortScoreSuggestionsByPreview(suggestions, moduleOrder = []) {
  const rank = new Map(moduleOrder.map((key, index) => [key, index]));
  const keyFor = row => ['education_courses','education_notes'].includes(row.moduleType)
    ? `education:${row.moduleId}` : row.moduleType === 'certification_hide'
      ? `certification:${row.moduleId}` : row.moduleType === 'certification_order'
        ? 'read_only:certifications' : row.moduleType === 'experience_order'
          ? `experience_order:${row.moduleId}` : scoreModuleKey(row);
  const fieldRank = row => ({'star.s':1,'star.t':2,'star.a':3,'star.r':4}[row.fieldPath] ?? 0);
  return suggestions.map((row,index)=>({row,index})).sort((a,b)=>
    (rank.get(keyFor(a.row)) ?? Number.MAX_SAFE_INTEGER) - (rank.get(keyFor(b.row)) ?? Number.MAX_SAFE_INTEGER)
    || (keyFor(a.row)===keyFor(b.row) ? fieldRank(a.row)-fieldRank(b.row) : 0)
    || a.index-b.index).map(({row})=>row);
}

// Keep these relationships aligned with simple_planner.targets on the server.
export function scoreSuggestionsConflict(a, b) {
  const sameTarget = a.moduleType === b.moduleType && a.moduleId === b.moduleId && a.fieldPath === b.fieldPath;
  const localKinds = ['education_courses', 'education_notes', 'certification_order', 'certification_hide',
    'experience_order', 'experience_hide', 'experience_restructure', 'skill_create'];
  if (sameTarget) {
    return localKinds.includes(a.moduleType)
      && JSON.stringify(a.selectedItems ?? []) !== JSON.stringify(b.selectedItems ?? []);
  }
  const experienceKinds = ['experience_star', 'experience_restructure', 'experience_hide'];
  if (a.moduleId === b.moduleId && experienceKinds.includes(a.moduleType) && experienceKinds.includes(b.moduleType)) {
    return a.moduleType !== 'experience_star' || b.moduleType !== 'experience_star';
  }
  return (a.moduleType === 'skill_create' && b.moduleType === 'skills_order')
    || (b.moduleType === 'skill_create' && a.moduleType === 'skills_order');
}

export function getCompatibleScoreSuggestionAdditions(suggestions, selectedIds) {
  const executable = suggestions.filter(row => row.editable && !row.executionBlockReason);
  const chosen = executable.filter(row => selectedIds.includes(row.suggestionId));
  const additions = [];
  for (const row of executable) {
    if (selectedIds.includes(row.suggestionId) || chosen.some(other => scoreSuggestionsConflict(row, other))) continue;
    chosen.push(row);
    additions.push(row.suggestionId);
  }
  return additions;
}
