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
