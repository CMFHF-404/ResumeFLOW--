export const SCORE_VERSION = 'resume_score_v2';
export const SCORE_DIMENSIONS = ['逻辑清晰', 'STAR应用', '内容可读', '内容完整', '专业表达', '成果量化'];

export function normalizeResumeScore(value) {
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

export const scoreModuleKey = row => `${row.moduleType}:${row.moduleId}`;
export function groupScoreSuggestions(suggestions) {
  const groups = new Map();
  for (const row of suggestions) {
    const key = scoreModuleKey(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.entries()];
}
