export const EVALUATION_DIMENSIONS = [
  '逻辑清晰',
  'STAR应用',
  '内容可读',
  '内容完整',
  '专业表达',
  '成果量化',
];

const DIMENSION_ALIASES = {
  '逻辑清晰': '逻辑清晰',
  '逻辑性': '逻辑清晰',
  logic: '逻辑清晰',
  'STAR应用': 'STAR应用',
  star: 'STAR应用',
  '内容可读': '内容可读',
  readability: '内容可读',
  '内容完整': '内容完整',
  completeness: '内容完整',
  '专业表达': '专业表达',
  professionalism: '专业表达',
  '成果量化': '成果量化',
  quantification: '成果量化',
};

export const clampEvaluationScore = (value) => (
  typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(100, Math.round(value)))
    : 0
);

export const normalizeEvaluationDimension = (value) => {
  if (typeof value !== 'string') return '';
  const normalized = value.replace(/\s+/g, '').trim();
  return DIMENSION_ALIASES[normalized] || DIMENSION_ALIASES[normalized.toLowerCase()] || '';
};

const textList = (value, formatter = (item) => item) => (
  Array.isArray(value)
    ? value.map(formatter).filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
    : []
);

const text = (value) => typeof value === 'string' ? value.trim() : '';

const describeSubscores = (value) => (
  Array.isArray(value)
    ? value.map((item) => {
      if (!item || typeof item !== 'object') return text(item);
      const name = text(item.name) || text(item.label) || '子项';
      const score = typeof item.score === 'number' && Number.isFinite(item.score) ? item.score : null;
      const maxScore = typeof item.maxScore === 'number' && Number.isFinite(item.maxScore) ? item.maxScore : null;
      return score === null ? name : `${name} ${score}${maxScore === null ? '' : `/${maxScore}`}`;
    }).filter(Boolean)
    : value && typeof value === 'object'
      ? Object.entries(value).map(([key, item]) => `${key} ${String(item)}`)
      : []
);

export const normalizeResumeEvaluation = (value) => {
  if (!value || typeof value !== 'object' || value.evaluationVersion !== 'resume_flow_v1') {
    return null;
  }

  const evidenceEntries = Array.isArray(value.evidence) ? value.evidence : [];
  const evidenceById = new Map(evidenceEntries.map((item) => [
    item && typeof item === 'object' ? text(item.evidenceId) : '',
    item && typeof item === 'object'
      ? text(item.sourceText) || text(item.description) || text(item.text)
      : text(item),
  ]).filter(([id, description]) => id && description));
  const issueEntries = Array.isArray(value.issues) ? value.issues : [];
  const issueById = new Map(issueEntries.map((item) => [
    item && typeof item === 'object' ? text(item.issueId) : '',
    item && typeof item === 'object' ? text(item.description) || text(item.issue) : text(item),
  ]).filter(([id, description]) => id && description));
  const issueEvidenceById = new Map(issueEntries.map((item) => [
    item && typeof item === 'object' ? text(item.issueId) : '',
    item && typeof item === 'object' && Array.isArray(item.evidenceIds)
      ? item.evidenceIds.map(text).filter(Boolean)
      : [],
  ]).filter(([id]) => id));

  const dimensionMap = new Map();
  for (const item of Array.isArray(value.dimensions) ? value.dimensions : []) {
    if (!item || typeof item !== 'object') continue;
    const dimension = normalizeEvaluationDimension(item.dimension);
    if (!dimension || dimensionMap.has(dimension)) continue;
    const issueIds = textList(item.issues);
    const subscoreEvidenceIds = Array.isArray(item.subscores)
      ? item.subscores.flatMap((subscore) => (
        subscore && typeof subscore === 'object' && Array.isArray(subscore.evidenceIds)
          ? subscore.evidenceIds.map(text).filter(Boolean)
          : []
      ))
      : [];
    const evidenceIds = [...new Set([
      ...subscoreEvidenceIds,
      ...issueIds.flatMap((issueId) => issueEvidenceById.get(issueId) || []),
    ])];
    dimensionMap.set(dimension, {
      dimension,
      score: clampEvaluationScore(item.score),
      level: typeof item.level === 'string' ? item.level.trim() : '',
      subscores: describeSubscores(item.subscores),
      strengths: textList(item.strengths),
      issues: issueIds.map((issueId) => issueById.get(issueId) || issueId),
      evidence: evidenceIds.map((evidenceId) => evidenceById.get(evidenceId)).filter(Boolean),
      improvementQuestions: textList(item.improvementQuestions),
    });
  }

  return {
    evaluationVersion: String(value.evaluationVersion).trim(),
    overallScore: clampEvaluationScore(value.overallScore),
    overallLevel: typeof value.overallLevel === 'string' ? value.overallLevel.trim() : '',
    evaluationConfidence: typeof value.evaluationConfidence === 'number' && Number.isFinite(value.evaluationConfidence)
      ? `${Math.round(Math.max(0, Math.min(1, value.evaluationConfidence)) * 100)}%`
      : typeof value.evaluationConfidence === 'string' ? value.evaluationConfidence.trim() : '',
    dimensions: EVALUATION_DIMENSIONS.map((dimension) => dimensionMap.get(dimension) || {
      dimension,
      score: 0,
      level: '',
      subscores: [],
      strengths: [],
      issues: [],
      evidence: [],
      improvementQuestions: [],
      unavailable: true,
    }),
    evidence: textList(value.evidence, (item) => typeof item === 'object' && item ? text(item.sourceText) || text(item.description) || text(item.text) : text(item)),
    issues: textList(value.issues, (item) => typeof item === 'object' && item ? text(item.description) || text(item.issue) : text(item)),
    missingInformation: textList(value.missingInformation, (item) => {
      if (!item || typeof item !== 'object') return text(item);
      return text(item.question) || [text(item.field), text(item.reason)].filter(Boolean).join('：');
    }),
    riskFlags: textList(value.riskFlags, (item) => typeof item === 'object' && item ? text(item.description) || text(item.type) : text(item)),
    topPriorities: textList(value.topPriorities, (item) => typeof item === 'object' && item ? text(item.action) || text(item.description) : text(item)),
    jdMatch: typeof value.jdMatch === 'number' && Number.isFinite(value.jdMatch)
      ? clampEvaluationScore(value.jdMatch)
      : null,
  };
};

export const buildRadarPoints = (scores, radius = 42, center = 50) => (
  EVALUATION_DIMENSIONS.map((_, index) => {
    const score = clampEvaluationScore(scores[index]);
    const angle = (-Math.PI / 2) + (index * Math.PI * 2 / EVALUATION_DIMENSIONS.length);
    const distance = radius * score / 100;
    return `${(center + Math.cos(angle) * distance).toFixed(2)},${(center + Math.sin(angle) * distance).toFixed(2)}`;
  }).join(' ')
);

export const buildRadarAxis = (index, radius = 42, center = 50) => {
  const angle = (-Math.PI / 2) + (index * Math.PI * 2 / EVALUATION_DIMENSIONS.length);
  return {
    x: +(center + Math.cos(angle) * radius).toFixed(2),
    y: +(center + Math.sin(angle) * radius).toFixed(2),
  };
};
