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

const BANDS = new Set([
  'strong',
  'adequate',
  'needs_attention',
  'insufficient_evidence',
]);

const text = (value) => typeof value === 'string' ? value.trim() : '';

const textList = (value, formatter = (item) => item) => (
  Array.isArray(value)
    ? value.map(formatter).filter((item) => typeof item === 'string' && item.trim())
      .map((item) => item.trim())
    : []
);

export const normalizeEvaluationDimension = (value) => {
  if (typeof value !== 'string') return '';
  const normalized = value.replace(/\s+/g, '').trim();
  return DIMENSION_ALIASES[normalized] || DIMENSION_ALIASES[normalized.toLowerCase()] || '';
};

const guidanceFieldLabel = (value) => {
  const path = text(value).replace(/^resume\./, '');
  const experience = /^experiences\[(\d+)\](?:\.star(?:\.([star]))?)?$/.exec(path);
  if (experience && Number.isSafeInteger(Number(experience[1]) + 1)) {
    const field = { s: '背景', t: '任务', a: '行动', r: '结果' }[experience[2]];
    return [`第${Number(experience[1]) + 1}段经历`, field].filter(Boolean).join(' · ');
  }
  return {
    personal_summary: '个人总结', summary: '个人总结', resume: '简历整体',
    educations: '教育经历', experiences: '经历信息',
    'profile.name,profile.email,profile.phone': '基础信息',
    'experiences[].title,org,start_date,end_date': '经历名称、组织与时间',
    'skills,certifications': '技能与资格',
    'personal_summary,experiences[].title': '求职方向',
  }[path] || '';
};

const normalizeGuidanceActionList = (value) => textList(value, (item) => (
  item && typeof item === 'object'
    ? [guidanceFieldLabel(item.fieldPath), text(item.description), text(item.action)].filter(Boolean).join('：')
    : text(item)
));

const normalizeGuidanceDimension = (value) => {
  if (!value || typeof value !== 'object') return null;
  const dimension = normalizeEvaluationDimension(value.dimension);
  const status = text(value.status);
  if (!dimension || !BANDS.has(status)) return null;
  return {
    dimension,
    status,
    strengths: textList(value.strengths),
    issues: textList(value.issues),
    actions: textList(value.actions),
  };
};

const legacyDimension = (value, issueById) => {
  if (!value || typeof value !== 'object') return null;
  const dimension = normalizeEvaluationDimension(value.dimension);
  if (!dimension) return null;
  return {
    dimension,
    status: 'legacy',
    strengths: textList(value.strengths),
    issues: textList(value.issues, (issueId) => issueById.get(text(issueId)) || text(issueId)),
    actions: textList(value.improvementQuestions),
  };
};

/**
 * This is intentionally display-only. API ingress is strictly validated by
 * services/aiNormalizeUtils; this projection never re-exposes quality numbers.
 */
export const normalizeResumeEvaluationDisplay = (value) => {
  if (!value || typeof value !== 'object') return null;
  if (value.evaluationVersion === 'guidance_audit_v1') {
    const dimensionMap = new Map(
      (Array.isArray(value.dimensionGuidance) ? value.dimensionGuidance : [])
        .map(normalizeGuidanceDimension)
        .filter(Boolean)
        .map((item) => [item.dimension, item]),
    );
    const overallBand = text(value.overallBand);
    const confidence = text(value.confidence);
    if (!BANDS.has(overallBand) || !['high', 'medium', 'low'].includes(confidence)) return null;
    return {
      kind: 'guidance',
      overallBand,
      confidence,
      dimensions: EVALUATION_DIMENSIONS.map((dimension) => dimensionMap.get(dimension) || {
        dimension, status: 'insufficient_evidence', strengths: [], issues: [], actions: [], unavailable: true,
      }),
      topPriorities: normalizeGuidanceActionList(value.topPriorities),
      safeCleanup: normalizeGuidanceActionList(value.safeCleanup),
      informationNeeded: normalizeGuidanceActionList(value.informationNeeded),
      riskFlags: textList(value.riskFlags, (item) => (
        item && typeof item === 'object' ? text(item.description) || text(item.type) : text(item)
      )),
    };
  }

  if (value.evaluationVersion !== 'resume_flow_v1') return null;
  const issueById = new Map((Array.isArray(value.issues) ? value.issues : []).map((item) => [
    item && typeof item === 'object' ? text(item.issueId) : '',
    item && typeof item === 'object' ? text(item.description) : text(item),
  ]).filter(([id, description]) => id && description));
  const dimensionMap = new Map(
    (Array.isArray(value.dimensions) ? value.dimensions : [])
      .map((item) => legacyDimension(item, issueById))
      .filter(Boolean)
      .map((item) => [item.dimension, item]),
  );
  return {
    kind: 'legacy',
    overallBand: text(value.overallLevel) || '历史报告',
    confidence: '',
    dimensions: EVALUATION_DIMENSIONS.map((dimension) => dimensionMap.get(dimension) || {
      dimension, status: 'legacy', strengths: [], issues: [], actions: [], unavailable: true,
    }),
    topPriorities: textList(value.topPriorities, (item) => (
      item && typeof item === 'object' ? text(item.action) || text(item.description) : text(item)
    )),
    safeCleanup: [],
    informationNeeded: textList(value.missingInformation, (item) => (
      item && typeof item === 'object' ? text(item.question) || text(item.reason) : text(item)
    )),
    riskFlags: textList(value.riskFlags, (item) => (
      item && typeof item === 'object' ? text(item.description) || text(item.type) : text(item)
    )),
  };
};
