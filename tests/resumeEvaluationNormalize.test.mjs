import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import { build } from 'esbuild';

const importNormalizer = async () => {
  const result = await build({
    entryPoints: ['services/aiNormalizeUtils.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const encoded = Buffer.from(result.outputFiles[0].text).toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
};

test('scoring revision is retained without inventing a revision for historical reports', async () => {
  const { normalizeResumeEvaluation } = await importNormalizer();
  const old = buildEvaluation();
  assert.equal(normalizeResumeEvaluation(old).scoringVersion, undefined);
  assert.equal(normalizeResumeEvaluation({ ...old, scoringVersion: 'coverage_consensus_v1' }).scoringVersion,
    'coverage_consensus_v1');
  assert.equal(normalizeResumeEvaluation({ ...old, scoring_version: 'older_rules' }).scoringVersion, 'older_rules');
  for (const scoringVersion of [null, '', 3, {}]) {
    assert.equal(normalizeResumeEvaluation({ ...old, scoringVersion }), undefined);
  }
});

const rubric = [
  ['逻辑清晰', [['信息顺序', 25], ['因果关系', 30], ['信息层级', 20], ['一致性与聚焦', 25]]],
  ['STAR应用', [['Situation情境', 15], ['Task任务', 15], ['Action行动', 35], ['Result结果', 35]]],
  ['内容可读', [['扫读结构', 25], ['句子清晰度', 25], ['信息密度', 20], ['语法与自然度', 15], ['重复与冗余', 15]]],
  ['内容完整', [['基础信息', 10], ['教育经历', 15], ['核心经历模块', 25], ['经历必要字段', 20], ['技能与资格', 15], ['求职方向', 10], ['补充信息', 5]]],
  ['专业表达', [['行动动词', 20], ['岗位术语', 20], ['表达精确度', 20], ['贡献与责任边界', 20], ['客观与可信', 20]]],
  ['成果量化', [['结果指标', 30], ['基线与前后对比', 25], ['覆盖规模', 15], ['时间窗口', 10], ['过程数量', 10], ['数据可信度', 10]]],
];

const buildEvaluation = () => ({
  evaluationVersion: 'resume_flow_v1',
  evaluationScope: 'full_resume',
  targetRole: '产品经理',
  overallScore: 100,
  overallLevel: '卓越',
  evaluationConfidence: 0.82,
  scoreCalculation: {
    dimensionSum: 600,
    rawAverage: 100,
    roundingRule: 'round_half_up',
    finalScore: 100,
  },
  dimensions: rubric.map(([dimension, subscores]) => ({
    dimension,
    score: 100,
    level: '卓越',
    subscores: subscores.map(([name, maxScore]) => ({
      name,
      maxScore,
      score: maxScore,
      evidenceIds: ['E001'],
    })),
    strengths: [],
    issues: [],
    improvementQuestions: [],
  })),
  evidence: [{
    evidenceId: 'E001',
    sourceText: '用户声明事实',
    location: 'resume.profile.name',
    factId: 'FACT_001',
    verificationStatus: 'user_claimed',
    supportedDimensions: rubric.map(([dimension]) => dimension),
  }],
  issues: [],
  jdMatch: 88,
  missingInformation: [],
  riskFlags: [],
  topPriorities: [],
});

const addZeroPointIssue = (evaluation, overrides = {}) => {
  const issue = {
    issueId: 'ISSUE_001',
    description: '需要进一步说明',
    primaryDimension: '逻辑清晰',
    relatedDimensions: [],
    evidenceIds: ['E001'],
    severity: 'low',
    pointsNotEarned: 0,
    ...overrides,
  };
  evaluation.issues = [issue];
  evaluation.dimensions[0].issues = [issue.issueId];
  return issue;
};

test('accepts only an arithmetically consistent fixed six-dimension evaluation', async () => {
  const { normalizeResumeEvaluation } = await importNormalizer();
  const normalized = normalizeResumeEvaluation(buildEvaluation());
  assert.equal(normalized.overallScore, 100);
  assert.equal(normalized.dimensions.length, 6);
  assert.equal(normalized.evaluationConfidence, 0.82);

  const mismatchedOverall = buildEvaluation();
  mismatchedOverall.overallScore = 99;
  assert.equal(normalizeResumeEvaluation(mismatchedOverall), undefined);

  const mismatchedDimension = buildEvaluation();
  mismatchedDimension.dimensions[0].score = 99;
  assert.equal(normalizeResumeEvaluation(mismatchedDimension), undefined);

  const missingSubscore = buildEvaluation();
  missingSubscore.dimensions[1].subscores.pop();
  assert.equal(normalizeResumeEvaluation(missingSubscore), undefined);
});

test('fresh JD analysis accepts a lightweight result and preserves its JD-fit score', async () => {
  const { normalizeCurrentJDAnalysisResult } = await importNormalizer();
  assert.equal(
    normalizeCurrentJDAnalysisResult({
      matchPercentage: 88,
      jobKeywords: [],
      missingKeywords: [],
      summary: '旧结构',
    }).matchPercentage,
    88
  );
  const invalidEvaluation = normalizeCurrentJDAnalysisResult({
      matchPercentage: 88,
      jobKeywords: [],
      missingKeywords: [],
      summary: '非法结构',
      resumeEvaluation: { evaluationVersion: 'resume_flow_v1' },
    });
  assert.equal(invalidEvaluation.matchPercentage, 88);
  assert.equal('resumeEvaluation' in invalidEvaluation, false);
  assert.equal(
    normalizeCurrentJDAnalysisResult({
      matchPercentage: 73,
      jobKeywords: [],
      missingKeywords: [],
      summary: '有效结构',
      resumeEvaluation: buildEvaluation(),
    }).matchPercentage,
    73
  );
});

test('invalid persisted evaluation cannot masquerade as a current resume score', async () => {
  const { normalizeJDAnalysisResult } = await importNormalizer();
  const invalidEvaluation = buildEvaluation();
  invalidEvaluation.scoreCalculation.dimensionSum = 599;
  const normalized = normalizeJDAnalysisResult({
    matchPercentage: 73,
    resumeEvaluation: invalidEvaluation,
    jobKeywords: [],
    missingKeywords: [],
    summary: '历史岗位分析',
  });
  assert.equal(normalized.matchPercentage, 73);
  assert.equal('resumeEvaluation' in normalized, false);

  const current = normalizeJDAnalysisResult({
    matchPercentage: 1,
    resumeEvaluation: buildEvaluation(),
    jobKeywords: [],
    missingKeywords: [],
    summary: '新版评分',
  });
  assert.equal(current.matchPercentage, 1);
  assert.equal(current.resumeEvaluation.evaluationVersion, 'resume_flow_v1');
});

test('rejects evaluations whose evidence and issue references do not form a closed graph', async () => {
  const { normalizeResumeEvaluation } = await importNormalizer();

  const unknownPositiveEvidence = buildEvaluation();
  unknownPositiveEvidence.dimensions[0].subscores[0].evidenceIds = ['E404'];
  assert.equal(normalizeResumeEvaluation(unknownPositiveEvidence), undefined);

  const unknownDimensionIssue = buildEvaluation();
  unknownDimensionIssue.dimensions[0].issues = ['ISSUE_404'];
  assert.equal(normalizeResumeEvaluation(unknownDimensionIssue), undefined);

  const orphanedIssue = buildEvaluation();
  orphanedIssue.issues = [{
    issueId: 'ISSUE_001',
    description: '缺少量化成果',
    primaryDimension: '逻辑清晰',
    relatedDimensions: [],
    evidenceIds: ['E001'],
    severity: 'medium',
    pointsNotEarned: 0,
  }];
  assert.equal(normalizeResumeEvaluation(orphanedIssue), undefined);

  const unknownPriorityIssue = buildEvaluation();
  unknownPriorityIssue.issues = [{
    issueId: 'ISSUE_001',
    description: '缺少量化成果',
    primaryDimension: '逻辑清晰',
    relatedDimensions: [],
    evidenceIds: ['E001'],
    severity: 'medium',
    pointsNotEarned: 0,
  }];
  unknownPriorityIssue.dimensions[0].issues = ['ISSUE_001'];
  unknownPriorityIssue.topPriorities = [{
    priority: 1,
    issueId: 'ISSUE_404',
    action: '补充成果指标',
    expectedScoreGain: 1,
  }];
  assert.equal(normalizeResumeEvaluation(unknownPriorityIssue), undefined);
});

test('matches backend evidence and issue-point contracts without rejecting unique legacy fact aliases', async () => {
  const { normalizeResumeEvaluation } = await importNormalizer();

  const unverifiedPositiveEvidence = buildEvaluation();
  unverifiedPositiveEvidence.evidence[0].verificationStatus = 'unverified';
  assert.equal(normalizeResumeEvaluation(unverifiedPositiveEvidence), undefined);

  const missingIssueForPointsNotEarned = buildEvaluation();
  const reducedSubscore = missingIssueForPointsNotEarned.dimensions[0].subscores[0];
  reducedSubscore.score = 24;
  missingIssueForPointsNotEarned.dimensions[0].score = 99;
  missingIssueForPointsNotEarned.scoreCalculation.dimensionSum = 599;
  missingIssueForPointsNotEarned.scoreCalculation.rawAverage = 599 / 6;
  missingIssueForPointsNotEarned.scoreCalculation.finalScore = 100;
  missingIssueForPointsNotEarned.overallScore = 100;
  assert.equal(normalizeResumeEvaluation(missingIssueForPointsNotEarned), undefined);

  const nonzeroIssueOnPerfectDimension = buildEvaluation();
  nonzeroIssueOnPerfectDimension.issues = [{
    issueId: 'ISSUE_001',
    description: '不应扣分的建议',
    primaryDimension: '逻辑清晰',
    relatedDimensions: [],
    evidenceIds: ['E001'],
    severity: 'low',
    pointsNotEarned: 1,
  }];
  nonzeroIssueOnPerfectDimension.dimensions[0].issues = ['ISSUE_001'];
  assert.equal(
    normalizeResumeEvaluation(nonzeroIssueOnPerfectDimension)?.issues[0].pointsNotEarned,
    0
  );

  const positiveScoreWithoutEvidence = buildEvaluation();
  positiveScoreWithoutEvidence.dimensions[0].subscores[0].evidenceIds = [];
  assert.equal(normalizeResumeEvaluation(positiveScoreWithoutEvidence), undefined);

  const inferredPositiveEvidence = buildEvaluation();
  inferredPositiveEvidence.evidence[0].verificationStatus = 'inferred';
  assert.equal(normalizeResumeEvaluation(inferredPositiveEvidence), undefined);

  const factAlias = buildEvaluation();
  factAlias.dimensions[0].subscores[0].evidenceIds = ['FACT_001'];
  factAlias.issues = [{
    issueId: 'ISSUE_001',
    description: '不应扣分的建议',
    primaryDimension: '逻辑清晰',
    relatedDimensions: [],
    evidenceIds: ['FACT_001'],
    severity: 'low',
    pointsNotEarned: 0,
  }];
  factAlias.dimensions[0].issues = ['ISSUE_001'];
  factAlias.riskFlags = [{
    type: 'unverified_fact',
    description: '需要人工复核',
    evidenceIds: ['FACT_001'],
  }];
  const normalizedFactAlias = normalizeResumeEvaluation(factAlias);
  assert.deepEqual(normalizedFactAlias?.dimensions[0].subscores[0].evidenceIds, ['E001']);
  assert.deepEqual(normalizedFactAlias?.issues[0].evidenceIds, ['E001']);
  assert.deepEqual(normalizedFactAlias?.riskFlags[0].evidenceIds, ['E001']);

  const ambiguousFactAlias = buildEvaluation();
  ambiguousFactAlias.dimensions[0].subscores[0].evidenceIds = ['FACT_001'];
  ambiguousFactAlias.evidence.push({
    ...ambiguousFactAlias.evidence[0],
    evidenceId: 'E002',
  });
  assert.equal(normalizeResumeEvaluation(ambiguousFactAlias), undefined);
});

test('applies backend-legal evidence support and issue-point normalization', async () => {
  const { normalizeResumeEvaluation } = await importNormalizer();

  const incompleteSupport = buildEvaluation();
  incompleteSupport.evidence[0].supportedDimensions = [];
  const normalizedSupport = normalizeResumeEvaluation(incompleteSupport);
  assert.deepEqual(
    normalizedSupport?.evidence[0].supportedDimensions,
    rubric.map(([dimension]) => dimension)
  );

  const weightedIssuePoints = buildEvaluation();
  weightedIssuePoints.dimensions[0].subscores[0].score = 23;
  weightedIssuePoints.dimensions[0].score = 98;
  weightedIssuePoints.scoreCalculation.dimensionSum = 598;
  weightedIssuePoints.scoreCalculation.rawAverage = 598 / 6;
  weightedIssuePoints.scoreCalculation.finalScore = 100;
  weightedIssuePoints.overallScore = 100;
  weightedIssuePoints.issues = [
    {
      issueId: 'ISSUE_A',
      description: '信息顺序需要改进',
      primaryDimension: '逻辑清晰',
      relatedDimensions: [],
      evidenceIds: ['E001'],
      severity: 'medium',
      pointsNotEarned: 1,
    },
    {
      issueId: 'ISSUE_B',
      description: '因果关系需要改进',
      primaryDimension: '逻辑清晰',
      relatedDimensions: [],
      evidenceIds: ['E001'],
      severity: 'medium',
      pointsNotEarned: 3,
    },
  ];
  weightedIssuePoints.dimensions[0].issues = ['ISSUE_A', 'ISSUE_B'];
  const normalizedPoints = normalizeResumeEvaluation(weightedIssuePoints);
  assert.deepEqual(
    normalizedPoints?.issues.map((issue) => issue.pointsNotEarned),
    [1, 1]
  );

  const primaryRepeatedAsRelated = buildEvaluation();
  addZeroPointIssue(primaryRepeatedAsRelated, {
    relatedDimensions: ['逻辑清晰', 'STAR应用'],
  });
  assert.deepEqual(
    normalizeResumeEvaluation(primaryRepeatedAsRelated)?.issues[0].relatedDimensions,
    ['STAR应用']
  );
});

test('deduplicates identical issues and evidence like the backend and rejects cross-primary reuse', async () => {
  const { normalizeResumeEvaluation } = await importNormalizer();

  const samePrimary = buildEvaluation();
  samePrimary.dimensions[0].subscores[0].score = 23;
  samePrimary.dimensions[0].score = 98;
  samePrimary.scoreCalculation.dimensionSum = 598;
  samePrimary.scoreCalculation.rawAverage = 598 / 6;
  samePrimary.scoreCalculation.finalScore = 100;
  samePrimary.issues = [
    {
      issueId: 'ISSUE_A',
      description: '缺少结果指标',
      primaryDimension: '逻辑清晰',
      relatedDimensions: [],
      evidenceIds: ['E001'],
      severity: 'medium',
      pointsNotEarned: 1,
    },
    {
      issueId: 'ISSUE_B',
      description: '缺少结果指标',
      primaryDimension: '逻辑清晰',
      relatedDimensions: [],
      evidenceIds: ['E001'],
      severity: 'medium',
      pointsNotEarned: 1,
    },
  ];
  samePrimary.dimensions[0].issues = ['ISSUE_A', 'ISSUE_B'];
  samePrimary.topPriorities = [{
    priority: 7,
    issueId: 'ISSUE_B',
    action: '补充成果指标',
    expectedScoreGain: 2,
  }];

  const normalized = normalizeResumeEvaluation(samePrimary);
  assert.deepEqual(normalized?.issues.map((issue) => issue.issueId), ['ISSUE_A']);
  assert.equal(normalized?.issues[0].pointsNotEarned, 2);
  assert.deepEqual(normalized?.dimensions[0].issues, ['ISSUE_A']);
  assert.deepEqual(normalized?.topPriorities.map((priority) => ({
    priority: priority.priority,
    issueId: priority.issueId,
  })), [{ priority: 1, issueId: 'ISSUE_A' }]);

  const crossPrimary = buildEvaluation();
  crossPrimary.issues = [
    {
      issueId: 'ISSUE_LOGIC',
      description: '缺少结果指标',
      primaryDimension: '逻辑清晰',
      relatedDimensions: [],
      evidenceIds: ['E001'],
      severity: 'medium',
      pointsNotEarned: 0,
    },
    {
      issueId: 'ISSUE_STAR',
      description: '缺少结果指标',
      primaryDimension: 'STAR应用',
      relatedDimensions: [],
      evidenceIds: ['E001'],
      severity: 'medium',
      pointsNotEarned: 0,
    },
  ];
  crossPrimary.dimensions[0].issues = ['ISSUE_LOGIC'];
  crossPrimary.dimensions[1].issues = ['ISSUE_STAR'];
  assert.equal(normalizeResumeEvaluation(crossPrimary), undefined);
});

test('fails closed on conflicting aliases and distinguishes explicit null from omission', async () => {
  const { normalizeJDAnalysisResult, normalizeResumeEvaluation } = await importNormalizer();

  const conflictingScore = buildEvaluation();
  conflictingScore.overall_score = 99;
  assert.equal(normalizeResumeEvaluation(conflictingScore), undefined);

  const equalScoreAlias = buildEvaluation();
  equalScoreAlias.overall_score = equalScoreAlias.overallScore;
  assert.equal(normalizeResumeEvaluation(equalScoreAlias)?.overallScore, 100);

  const nullTargetRole = buildEvaluation();
  nullTargetRole.targetRole = null;
  assert.equal(normalizeResumeEvaluation(nullTargetRole), undefined);

  const omittedTargetRole = buildEvaluation();
  delete omittedTargetRole.targetRole;
  assert.equal(normalizeResumeEvaluation(omittedTargetRole)?.targetRole, '');

  const nullJdMatch = buildEvaluation();
  nullJdMatch.jdMatch = null;
  assert.equal(normalizeResumeEvaluation(nullJdMatch)?.jdMatch, null);

  const conflictingWrapper = normalizeJDAnalysisResult({
    matchPercentage: 73,
    jobKeywords: [],
    missingKeywords: [],
    summary: 'conflicting wrapper',
    resumeEvaluation: buildEvaluation(),
    resume_evaluation: { ...buildEvaluation(), overallScore: 99 },
  });
  assert.equal('resumeEvaluation' in conflictingWrapper, false);
});

test('matches backend omission and null semantics for optional evaluation fields', async () => {
  const { normalizeResumeEvaluation } = await importNormalizer();

  const missingLocation = buildEvaluation();
  delete missingLocation.evidence[0].location;
  assert.equal(normalizeResumeEvaluation(missingLocation)?.evidence[0].location, '');

  const nullLocation = buildEvaluation();
  nullLocation.evidence[0].location = null;
  assert.equal(normalizeResumeEvaluation(nullLocation), undefined);

  const missingRelatedDimensions = buildEvaluation();
  const missingRelatedIssue = addZeroPointIssue(missingRelatedDimensions);
  delete missingRelatedIssue.relatedDimensions;
  assert.deepEqual(
    normalizeResumeEvaluation(missingRelatedDimensions)?.issues[0].relatedDimensions,
    []
  );

  const nullRelatedDimensions = buildEvaluation();
  addZeroPointIssue(nullRelatedDimensions, { relatedDimensions: null });
  assert.deepEqual(
    normalizeResumeEvaluation(nullRelatedDimensions)?.issues[0].relatedDimensions,
    []
  );

  const missingPotentialDimension = buildEvaluation();
  missingPotentialDimension.missingInformation = [{
    field: 'metric',
    reason: 'missing',
    question: 'Which metric improved?',
    potentialScoreGain: 5,
  }];
  assert.equal(
    normalizeResumeEvaluation(missingPotentialDimension)
      ?.missingInformation[0].potentialDimension,
    ''
  );

  const nullPotentialDimension = buildEvaluation();
  nullPotentialDimension.missingInformation = [{
    field: 'metric',
    reason: 'missing',
    question: 'Which metric improved?',
    potentialDimension: null,
    potentialScoreGain: 5,
  }];
  assert.equal(normalizeResumeEvaluation(nullPotentialDimension), undefined);
});

test('fails closed instead of filtering or coercing malformed evaluation collections', async () => {
  const { normalizeResumeEvaluation } = await importNormalizer();
  const cases = [
    ['null evidence member', (evaluation) => evaluation.evidence.push(null)],
    ['null issue member', (evaluation) => evaluation.issues.push(null)],
    ['invalid missing-information dimension', (evaluation) => {
      evaluation.missingInformation = [{
        field: 'business metric',
        reason: 'missing',
        question: 'Which metric improved?',
        potentialDimension: 'not-a-dimension',
        potentialScoreGain: 5,
      }];
    }],
    ['coerced missing-information gain', (evaluation) => {
      evaluation.missingInformation = [{
        field: 'business metric',
        reason: 'missing',
        question: 'Which metric improved?',
        potentialDimension: '成果量化',
        potentialScoreGain: '5',
      }];
    }],
    ['invalid risk type', (evaluation) => {
      evaluation.riskFlags = [{
        type: 'invented_risk',
        description: 'invalid',
        evidenceIds: ['E001'],
      }];
    }],
    ['malformed risk evidence reference', (evaluation) => {
      evaluation.riskFlags = [{
        type: 'unverified_fact',
        description: 'review required',
        evidenceIds: ['E001', null],
      }];
    }],
    ['coerced priority rank', (evaluation) => {
      addZeroPointIssue(evaluation);
      evaluation.topPriorities = [{
        priority: '1',
        issueId: 'ISSUE_001',
        action: 'Clarify the result',
        expectedScoreGain: 0,
      }];
    }],
    ['invalid related dimension', (evaluation) => {
      addZeroPointIssue(evaluation, { relatedDimensions: ['not-a-dimension'] });
    }],
    ['missing supportedDimensions', (evaluation) => {
      delete evaluation.evidence[0].supportedDimensions;
    }],
    ['invalid confidence type', (evaluation) => {
      evaluation.evaluationConfidence = '0.82';
    }],
    ['excess user-claimed confidence', (evaluation) => {
      evaluation.evaluationConfidence = 0.9;
    }],
  ];

  for (const [label, corrupt] of cases) {
    const evaluation = buildEvaluation();
    corrupt(evaluation);
    assert.equal(
      normalizeResumeEvaluation(evaluation),
      undefined,
      label
    );
  }
});

test('JD analysis strips malformed embedded evaluations without changing JD fit', async () => {
  const { normalizeCurrentJDAnalysisResult } = await importNormalizer();
  for (const rawAverage of [1000, '100']) {
    const evaluation = buildEvaluation();
    evaluation.scoreCalculation.rawAverage = rawAverage;
    const normalized = normalizeCurrentJDAnalysisResult({
        matchPercentage: 100,
        jobKeywords: [],
        missingKeywords: [],
        summary: '非法算术字段',
        resumeEvaluation: evaluation,
      });
    assert.equal(normalized.matchPercentage, 100);
    assert.equal('resumeEvaluation' in normalized, false);
  }
});

test('legacy lossy repair artifacts are stripped while legitimate zero scores remain valid', async () => {
  const { normalizeCurrentJDAnalysisResult, normalizeResumeEvaluation } = await importNormalizer();

  const serverGap = buildEvaluation();
  serverGap.issues = [{
    issueId: 'SERVER_GAP_001',
    description: '服务端补洞产物',
    primaryDimension: '逻辑清晰',
    relatedDimensions: [],
    evidenceIds: [],
    severity: 'high',
    pointsNotEarned: 0,
  }];
  serverGap.dimensions[0].issues = ['SERVER_GAP_001'];
  const sanitized = normalizeCurrentJDAnalysisResult({
    matchPercentage: 73,
    jobKeywords: ['product'],
    missingKeywords: [],
    summary: '保留 JD 分析',
    resumeEvaluation: serverGap,
  });
  assert.equal(sanitized.matchPercentage, 73);
  assert.equal(sanitized.summary, '保留 JD 分析');
  assert.equal('resumeEvaluation' in sanitized, false);

  const priorityFingerprint = buildEvaluation();
  priorityFingerprint.topPriorities = [{
    priority: 1,
    issueId: 'SERVER_GAP_999',
    action: '历史降级动作',
    expectedScoreGain: 1,
  }];
  assert.equal(normalizeResumeEvaluation(priorityFingerprint), undefined);

  const zeroWithStrength = buildEvaluation();
  const dimension = zeroWithStrength.dimensions[0];
  dimension.subscores.forEach((subscore) => {
    subscore.score = 0;
    subscore.evidenceIds = [];
  });
  dimension.score = 0;
  dimension.strengths = ['与零分矛盾的亮点'];
  dimension.issues = ['ISSUE_ZERO_SCORE'];
  zeroWithStrength.issues = [{
    issueId: 'ISSUE_ZERO_SCORE',
    description: '该维度没有可计分证据',
    primaryDimension: dimension.dimension,
    relatedDimensions: [],
    evidenceIds: [],
    severity: 'high',
    pointsNotEarned: 100,
  }];
  zeroWithStrength.scoreCalculation.dimensionSum = 500;
  zeroWithStrength.scoreCalculation.rawAverage = 500 / 6;
  zeroWithStrength.scoreCalculation.finalScore = 83;
  zeroWithStrength.overallScore = 83;
  assert.equal(normalizeResumeEvaluation(zeroWithStrength), undefined);

  dimension.strengths = [];
  assert.equal(normalizeResumeEvaluation(zeroWithStrength)?.dimensions[0].score, 0);
});


test('preserves distinct project issues and distinct evidence despite shared keywords', async () => {
  const { normalizeResumeEvaluation } = await importNormalizer();
  for (const sameText of [false, true]) {
    const value = buildEvaluation();
    value.evidence.push({ ...value.evidence[0], evidenceId: 'E002', factId: 'FACT_002' });
    value.issues = ['支付项目缺少结果指标', sameText ? '支付项目缺少结果指标' : '推荐项目缺少结果指标']
      .map((description, index) => ({
        issueId: `ISSUE_${index}`, description, primaryDimension: '逻辑清晰',
        relatedDimensions: [], evidenceIds: [index ? 'E002' : 'E001'],
        severity: 'medium', pointsNotEarned: 0,
      }));
    value.dimensions[0].issues = ['ISSUE_0', 'ISSUE_1'];
    const normalized = normalizeResumeEvaluation(value);
    assert.deepEqual(normalized?.issues.map(issue => issue.evidenceIds), [['E001'], ['E002']]);
    assert.deepEqual(normalized?.dimensions[0].issues, ['ISSUE_0', 'ISSUE_1']);
  }
});
