import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import { build } from 'esbuild';

const importDashboardUtils = async () => {
  const result = await build({
    entryPoints: ['views/Dashboard/dashboardUtils.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const source = result.outputFiles[0].text;
  const encoded = Buffer.from(source).toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
};

const importDashboardScoreUtils = async () => {
  const result = await build({
    entryPoints: ['utils/dashboardResumeScore.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const encoded = Buffer.from(result.outputFiles[0].text).toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
};

const importDashboardMapper = async () => {
  const result = await build({
    entryPoints: ['utils/dashboardResumeMapper.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const encoded = Buffer.from(result.outputFiles[0].text).toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
};

const resume = (overrides = {}) => ({
  id: 'resume-1',
  name: 'Resume',
  targetRole: 'PM',
  evaluationScore: null,
  evaluationBaseFingerprint: '__null__',
  evaluationTargetRoleSignature: '{"targetRole":"PM"}',
  matchRate: 0,
  createdAt: '2026-01-01',
  createdAtValue: '2026-01-01T00:00:00.000Z',
  lastModified: 'today',
  updatedAtValue: '2026-01-01T12:00:00.000Z',
  status: 'draft',
  type: 'standard',
  ...overrides,
});

const scoreRubric = [
  ['逻辑清晰', [['信息顺序', 25], ['因果关系', 30], ['信息层级', 20], ['一致性与聚焦', 25]]],
  ['STAR应用', [['Situation情境', 15], ['Task任务', 15], ['Action行动', 35], ['Result结果', 35]]],
  ['内容可读', [['扫读结构', 25], ['句子清晰度', 25], ['信息密度', 20], ['语法与自然度', 15], ['重复与冗余', 15]]],
  ['内容完整', [['基础信息', 10], ['教育经历', 15], ['核心经历模块', 25], ['经历必要字段', 20], ['技能与资格', 15], ['求职方向', 10], ['补充信息', 5]]],
  ['专业表达', [['行动动词', 20], ['岗位术语', 20], ['表达精确度', 20], ['贡献与责任边界', 20], ['客观与可信', 20]]],
  ['成果量化', [['结果指标', 30], ['基线与前后对比', 25], ['覆盖规模', 15], ['时间窗口', 10], ['过程数量', 10], ['数据可信度', 10]]],
];

const evaluationAt = (score) => ({
  evaluationVersion: 'resume_flow_v1',
  evaluationScope: 'full_resume',
  overallScore: score,
  overallLevel: '',
  evaluationConfidence: 0.8,
  scoreCalculation: {
    dimensionSum: score * 6,
    rawAverage: score,
    roundingRule: 'round_half_up',
    finalScore: score,
  },
  dimensions: scoreRubric.map(([dimension, items]) => {
    let remaining = score;
    const subscores = items.map(([name, maxScore]) => {
      const itemScore = Math.min(maxScore, remaining);
      remaining -= itemScore;
      return { name, maxScore, score: itemScore, evidenceIds: [] };
    });
    return { dimension, score, level: '', subscores, strengths: [], issues: [], improvementQuestions: [] };
  }),
  evidence: [],
  issues: [],
  jdMatch: null,
  missingInformation: [],
  riskFlags: [],
  topPriorities: [],
});

test('dashboard score accepts only the current full-resume evaluation version', async () => {
  const { resolveDashboardResumeEvaluationScore } = await importDashboardScoreUtils();

  assert.equal(resolveDashboardResumeEvaluationScore(evaluationAt(86)), 86);
  assert.equal(resolveDashboardResumeEvaluationScore(evaluationAt(0)), 0);
  assert.equal(resolveDashboardResumeEvaluationScore({ ...evaluationAt(86), overallScore: 99 }), null);
  assert.equal(resolveDashboardResumeEvaluationScore({ evaluationVersion: 'legacy', overallScore: 99 }), null);
  assert.equal(resolveDashboardResumeEvaluationScore(undefined), null);
});

test('dashboard rejects current scores with stale, missing, or mismatched signatures', async () => {
  globalThis.localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };
  const {
    buildDashboardTargetRoleSignature,
    resolveDashboardResumeEvaluationScoreForResume,
  } = await importDashboardMapper();
  const targetRoleSignature = buildDashboardTargetRoleSignature('产品经理');
  const persisted = {
    jdText: '',
    jdInputSignature: '',
    experienceSignature: 'experience-signature',
    evaluationSignature: 'evaluation-signature',
    targetRoleSignature,
    result: { matchPercentage: 86, resumeEvaluation: evaluationAt(86) },
    itemSignatures: { experiences: {}, certifications: {}, skills: {} },
    inputMode: 'text',
    updatedAt: '2026-08-08T00:00:00.000Z',
  };

  assert.equal(
    resolveDashboardResumeEvaluationScoreForResume(
      'resume-1',
      { jdAnalysis: persisted },
      targetRoleSignature
    ),
    86
  );
  assert.equal(
    resolveDashboardResumeEvaluationScoreForResume('resume-1', {
      jdAnalysis: { ...persisted, isOutdated: true },
    }, targetRoleSignature),
    null
  );
  assert.equal(
    resolveDashboardResumeEvaluationScoreForResume('resume-1', {
      jdAnalysis: { ...persisted, isOutdated: true, evaluationIsOutdated: false },
    }, targetRoleSignature),
    86
  );
  assert.equal(
    resolveDashboardResumeEvaluationScoreForResume('resume-1', {
      jdAnalysis: { ...persisted, evaluationIsOutdated: true },
    }, targetRoleSignature),
    null
  );
  assert.equal(
    resolveDashboardResumeEvaluationScoreForResume(
      'resume-1',
      { jdAnalysis: persisted },
      buildDashboardTargetRoleSignature('增长产品经理')
    ),
    null
  );
  assert.equal(
    resolveDashboardResumeEvaluationScoreForResume('resume-1', {
      jdAnalysis: { ...persisted, evaluationSignature: undefined },
    }),
    null
  );
  assert.equal(
    resolveDashboardResumeEvaluationScoreForResume('resume-1', {
      jdAnalysis: { ...persisted, targetRoleSignature: undefined },
    }),
    null
  );
});

test('dashboard hides an explicitly stale JD match rate', async () => {
  globalThis.localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };
  const { resolveDashboardResumeMatchRate } = await importDashboardMapper();
  const persisted = {
    jdText: '产品经理 JD',
    jdInputSignature: 'jd-signature',
    experienceSignature: 'experience-signature',
    isOutdated: true,
    evaluationIsOutdated: true,
    result: { matchPercentage: 82, resumeEvaluation: evaluationAt(86) },
    itemSignatures: { experiences: {}, certifications: {}, skills: {} },
    inputMode: 'text',
    updatedAt: '2026-08-08T00:00:00.000Z',
  };

  assert.equal(resolveDashboardResumeMatchRate('resume-1', { jdAnalysis: persisted }), 0);
});

test('mergeEvaluationScoresIntoResumes applies current evaluation scores and preserves unchanged array identity', async () => {
  const { mergeEvaluationScoresIntoResumes } = await importDashboardUtils();
  const items = [
    resume({ id: 'a', matchRate: 99, evaluationScore: null, status: 'final' }),
    resume({ id: 'b', matchRate: 20, evaluationScore: 20, status: 'final' }),
  ];

  const unchanged = mergeEvaluationScoresIntoResumes(items, () => undefined);
  const changed = mergeEvaluationScoresIntoResumes(items, (id) => (id === 'a' ? 82 : undefined));

  assert.equal(unchanged, items);
  assert.notEqual(changed, items);
  assert.deepEqual(changed.map((item) => [item.id, item.matchRate, item.evaluationScore, item.status]), [
    ['a', 99, 82, 'final'],
    ['b', 20, 20, 'final'],
  ]);
});

test('mergeMatchRatesIntoResumes applies local JD match rates without requiring a diagnosis score', async () => {
  const { mergeMatchRatesIntoResumes } = await importDashboardUtils();
  const items = [resume({ id: 'a', matchRate: 0, evaluationScore: null, status: 'draft' })];

  const changed = mergeMatchRatesIntoResumes(items, () => 82);

  assert.equal(changed[0].matchRate, 82);
  assert.equal(changed[0].evaluationScore, null);
  assert.equal(changed[0].status, 'final');
});

test('mergeEvaluationScoresIntoResumes clears a cached score when local analysis is explicitly stale', async () => {
  const { mergeEvaluationScoresIntoResumes } = await importDashboardUtils();
  const items = [resume({ evaluationScore: 72, status: 'final' })];

  const changed = mergeEvaluationScoresIntoResumes(items, () => null);

  assert.equal(changed[0].evaluationScore, null);
  assert.equal(changed[0].status, 'draft');
});

test('dashboard rejects a pending local score when its backend base fingerprint no longer matches', async () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  };
  const persisted = {
    jdText: '',
    jdInputSignature: 'jd-signature',
    experienceSignature: 'experience-signature',
    evaluationSignature: 'evaluation-signature',
    targetRoleSignature: '{"targetRole":"PM"}',
    result: { matchPercentage: 86, resumeEvaluation: evaluationAt(86) },
    itemSignatures: { experiences: {}, certifications: {}, skills: {} },
    inputMode: 'text',
    updatedAt: '2026-08-08T00:00:00.000Z',
  };
  storage.set('yuanzijianli.jdAnalysisCache:resume-1', JSON.stringify({
    payload: persisted,
    pendingSync: true,
    basePersistedFingerprint: 'older-backend-fingerprint',
  }));
  const { resolveDashboardResumeLocalEvaluationScore } = await importDashboardMapper();

  assert.equal(
    resolveDashboardResumeLocalEvaluationScore(
      'resume-1',
      'current-backend-fingerprint',
      '{"targetRole":"PM"}'
    ),
    undefined
  );
});

test('dashboard accepts a pending local score only when it is based on the current backend snapshot', async () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  };
  const persisted = {
    jdText: '',
    jdInputSignature: 'jd-signature',
    experienceSignature: 'experience-signature',
    evaluationSignature: 'evaluation-signature',
    targetRoleSignature: '{"targetRole":"PM"}',
    result: { matchPercentage: 86, resumeEvaluation: evaluationAt(86) },
    itemSignatures: { experiences: {}, certifications: {}, skills: {} },
    inputMode: 'text',
    updatedAt: '2026-08-08T00:00:00.000Z',
  };
  storage.set('yuanzijianli.jdAnalysisCache:resume-1', JSON.stringify({
    payload: persisted,
    pendingSync: true,
    basePersistedFingerprint: 'current-backend-fingerprint',
  }));
  const { resolveDashboardResumeLocalEvaluationScore } = await importDashboardMapper();

  assert.equal(
    resolveDashboardResumeLocalEvaluationScore(
      'resume-1',
      'current-backend-fingerprint',
      '{"targetRole":"PM"}'
    ),
    86
  );
});

test('areResumeListsEqual compares dashboard visible resume fields in order', async () => {
  const { areResumeListsEqual } = await importDashboardUtils();
  const first = [resume({ id: 'a' }), resume({ id: 'b' })];
  const same = [resume({ id: 'a' }), resume({ id: 'b' })];
  const renamed = [resume({ id: 'a', name: 'Renamed' }), resume({ id: 'b' })];
  const reordered = [resume({ id: 'b' }), resume({ id: 'a' })];

  assert.equal(areResumeListsEqual(first, first), true);
  assert.equal(areResumeListsEqual(first, same), true);
  assert.equal(areResumeListsEqual(first, renamed), false);
  assert.equal(areResumeListsEqual(first, reordered), false);
});

test('removeResumeIds and filterExistingResumeIds keep deletion cleanup deterministic', async () => {
  const { filterExistingResumeIds, removeResumeIds } = await importDashboardUtils();
  const items = [resume({ id: 'a' }), resume({ id: 'b' }), resume({ id: 'c' })];

  assert.deepEqual(removeResumeIds(items, ['b']).map((item) => item.id), ['a', 'c']);
  assert.deepEqual(filterExistingResumeIds(['a', 'missing', 'c'], items), ['a', 'c']);
});

test('filterSelectedDashboardResumeIds drops hidden filtered selections', async () => {
  const { filterSelectedDashboardResumeIds } = await importDashboardUtils();
  const visible = [resume({ id: 'visible-a' }), resume({ id: 'visible-b' })];

  assert.deepEqual(
    filterSelectedDashboardResumeIds(['hidden', 'visible-b', 'visible-a'], visible),
    ['visible-b', 'visible-a']
  );
});

test('mergeDashboardResumeServerUpdate preserves the raw updated timestamp for sorting', async () => {
  const { mergeDashboardResumeServerUpdate } = await importDashboardUtils();
  const updatedAt = '2026-06-19T12:30:00.000Z';
  const current = resume({
    id: 'resume-1',
    name: 'Old title',
    updatedAtValue: '2026-01-01T00:00:00.000Z',
  });

  const merged = mergeDashboardResumeServerUpdate(current, {
    id: 'resume-1',
    title: 'New title',
    updated_at: updatedAt,
  });

  assert.equal(merged.name, 'New title');
  assert.equal(merged.updatedAtValue, updatedAt);
});

test('getVisibleDashboardResumes searches names with trimmed case-insensitive text', async () => {
  const { getVisibleDashboardResumes } = await importDashboardUtils();
  const items = [
    resume({ id: 'a', name: 'AI Product Manager' }),
    resume({ id: 'b', name: 'User Operations' }),
    resume({ id: 'c', name: 'ai research intern' }),
  ];

  const visible = getVisibleDashboardResumes(items, { searchQuery: '  AI  ' });

  assert.deepEqual(visible.map((item) => item.id), ['a', 'c']);
});

test('getVisibleDashboardResumes filters creation time by presets and custom ranges', async () => {
  const { getVisibleDashboardResumes } = await importDashboardUtils();
  const items = [
    resume({ id: 'old', createdAtValue: '2026-01-01T00:00:00.000Z' }),
    resume({ id: 'recent', createdAtValue: '2026-06-15T00:00:00.000Z' }),
    resume({ id: 'range', createdAtValue: '2026-05-20T00:00:00.000Z' }),
  ];

  const recent = getVisibleDashboardResumes(items, {
    nowMs: Date.parse('2026-06-19T00:00:00.000Z'),
    timeFilter: { preset: '7d', startDate: '', endDate: '' },
  });
  const custom = getVisibleDashboardResumes(items, {
    timeFilter: { preset: 'custom', startDate: '2026-05-01', endDate: '2026-05-31' },
  });

  assert.deepEqual(recent.map((item) => item.id), ['recent']);
  assert.deepEqual(custom.map((item) => item.id), ['range']);
});

test('getVisibleDashboardResumes filters JD match rates independently from diagnosis scores', async () => {
  const { getVisibleDashboardResumes } = await importDashboardUtils();
  const items = [
    resume({ id: 'low', matchRate: 10, evaluationScore: 99 }),
    resume({ id: 'good', matchRate: 82, evaluationScore: null }),
    resume({ id: 'great', matchRate: 94, evaluationScore: null }),
  ];

  const preset = getVisibleDashboardResumes(items, {
    matchFilter: { preset: '80', min: '', max: '' },
  });
  const custom = getVisibleDashboardResumes(items, {
    matchFilter: { preset: 'custom', min: '90', max: '160' },
  });

  assert.deepEqual(preset.map((item) => item.id), ['good', 'great']);
  assert.deepEqual(custom.map((item) => item.id), ['great']);
});

test('getVisibleDashboardResumes sorts resumes by JD match rate', async () => {
  const { getVisibleDashboardResumes } = await importDashboardUtils();
  const items = [
    resume({
      id: 'a',
      matchRate: 80,
      evaluationScore: 20,
      createdAtValue: '2026-01-01T00:00:00.000Z',
      updatedAtValue: '2026-02-01T00:00:00.000Z',
    }),
    resume({
      id: 'b',
      matchRate: 95,
      evaluationScore: 10,
      createdAtValue: '2026-03-01T00:00:00.000Z',
      updatedAtValue: '2026-01-15T00:00:00.000Z',
    }),
    resume({
      id: 'c',
      matchRate: 0,
      evaluationScore: 99,
      createdAtValue: '2026-02-01T00:00:00.000Z',
      updatedAtValue: '2026-04-01T00:00:00.000Z',
    }),
  ];

  assert.deepEqual(getVisibleDashboardResumes(items, { sortMode: 'created-desc' }).map((item) => item.id), ['b', 'c', 'a']);
  assert.deepEqual(getVisibleDashboardResumes(items, { sortMode: 'created-asc' }).map((item) => item.id), ['a', 'c', 'b']);
  assert.deepEqual(getVisibleDashboardResumes(items, { sortMode: 'updated-desc' }).map((item) => item.id), ['c', 'a', 'b']);
  assert.deepEqual(getVisibleDashboardResumes(items, { sortMode: 'match-desc' }).map((item) => item.id), ['b', 'a', 'c']);
  assert.deepEqual(getVisibleDashboardResumes(items, { sortMode: 'match-asc' }).map((item) => item.id), ['c', 'a', 'b']);
});

test('resolveDropdownPosition keeps the menu within the viewport and opens upward near the bottom', async () => {
  const { resolveDropdownPosition } = await importDashboardUtils();
  const position = resolveDropdownPosition(
    { top: 520, right: 390, bottom: 560, left: 350 },
    { width: 192, height: 180 },
    { width: 400, height: 600 }
  );

  assert.deepEqual(position, { top: 336, left: 198 });
});

test('resolveDropdownPosition can be called without window when viewport is omitted', async () => {
  const { resolveDropdownPosition } = await importDashboardUtils();
  const position = resolveDropdownPosition(
    { top: 10, right: 60, bottom: 30, left: 20 },
    { width: 192, height: 180 }
  );

  assert.deepEqual(position, { top: 8, left: 8 });
});
