import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  EVALUATION_DIMENSIONS,
  normalizeEvaluationDimension,
  normalizeResumeEvaluationDisplay,
} from '../views/ResumeEditor/components/ResumeEvaluationReport/evaluationReportUtils.mjs';

const guidance = () => ({
  evaluationVersion: 'guidance_audit_v1',
  overallBand: 'needs_attention',
  confidence: 'medium',
  dimensionGuidance: EVALUATION_DIMENSIONS.map((dimension) => ({
    dimension,
    status: 'needs_attention',
    strengths: ['结构完整'],
    issues: ['行动描述过于泛化'],
    actions: ['补充具体动作'],
  })),
  topPriorities: [{ description: '行动描述过于泛化', action: '补充具体动作' }],
  safeCleanup: [{ description: '句末缺少标点', action: '补齐句末标点' }],
  informationNeeded: [{ description: '缺少验收结果', action: '补充交付或验收结果' }],
  riskFlags: [{ type: 'exaggerated_claim', description: '个人总结存在夸大表达' }],
});

test('guidance display normalizes bands and action groups without quality numbers', () => {
  assert.equal(normalizeResumeEvaluationDisplay({ evaluationVersion: 'guidance_audit_v1' }), null);
  const report = normalizeResumeEvaluationDisplay(guidance());

  assert.equal(report.kind, 'guidance');
  assert.equal(report.overallBand, 'needs_attention');
  assert.deepEqual(report.dimensions.map((item) => item.dimension), EVALUATION_DIMENSIONS);
  assert.deepEqual(report.topPriorities, ['行动描述过于泛化：补充具体动作']);
  assert.deepEqual(report.safeCleanup, ['句末缺少标点：补齐句末标点']);
  assert.deepEqual(report.informationNeeded, ['缺少验收结果：补充交付或验收结果']);
  assert.equal('overallScore' in report, false);
  assert.equal('scoreCalculation' in report, false);
});

test('legacy report remains readable as text but does not expose its numeric fields', () => {
  const report = normalizeResumeEvaluationDisplay({
    evaluationVersion: 'resume_flow_v1',
    overallLevel: '良好',
    dimensions: [{ dimension: 'STAR应用', strengths: ['项目背景清楚'], issues: ['成果缺少说明'], improvementQuestions: ['补充验收结果'] }],
    issues: [{ issueId: 'ISSUE_1', description: '成果缺少说明' }],
    topPriorities: [{ action: '补充验收结果' }],
  });

  assert.equal(report.kind, 'legacy');
  assert.equal(report.overallBand, '良好');
  assert.deepEqual(report.dimensions[1].issues, ['成果缺少说明']);
  assert.equal('overallScore' in report, false);
});

test('guidance actions identify their experience and STAR field without raw paths', () => {
  const value = guidance();
  const actions = ['experiences[0].star.a', 'experiences[1].star.a', 'experiences[1].star.r', 'personal_summary']
    .map((fieldPath) => ({ fieldPath, description: '需要整理', action: '保留已有事实' }));
  for (const key of ['topPriorities', 'safeCleanup', 'informationNeeded']) value[key] = actions;
  const report = normalizeResumeEvaluationDisplay(value);
  const expected = [
    '第1段经历 · 行动：需要整理：保留已有事实',
    '第2段经历 · 行动：需要整理：保留已有事实',
    '第2段经历 · 结果：需要整理：保留已有事实',
    '个人总结：需要整理：保留已有事实',
  ];
  for (const key of ['topPriorities', 'safeCleanup', 'informationNeeded']) {
    assert.deepEqual(report[key], expected);
  }
});

test('dimension aliases remain shared with optimization display formatting', () => {
  assert.equal(normalizeEvaluationDimension(' readability '), '内容可读');
  assert.equal(normalizeEvaluationDimension('unknown'), '');
});

test('report surfaces actionable guidance and never renders a radar or quality digits', () => {
  const source = readFileSync(
    new URL('../views/ResumeEditor/components/ResumeEvaluationReport/ResumeEvaluationReport.tsx', import.meta.url),
    'utf8'
  );
  assert.match(source, /整体状态/);
  assert.match(source, /优先改善/);
  assert.match(source, /可以直接整理/);
  assert.match(source, /需要补充信息/);
  assert.match(source, /历史数值报告不能用于新的优化/);
  assert.doesNotMatch(source, /overallScore|scoreCalculation|subscores|buildRadarPoints|六维评分明细/);
});

test('missing report exposes a keyboard-accessible explicit generation action', () => {
  const source = readFileSync(
    new URL('../views/ResumeEditor/components/ResumeEvaluationReport/ResumeEvaluationReport.tsx', import.meta.url),
    'utf8'
  );
  assert.match(source, /type="button"/);
  assert.match(source, /获取简历改进指导/);
  assert.match(source, /基于六大维度给出有证据支持的改进建议/);
  assert.match(source, /重新生成简历改进指导/);
  assert.match(source, /aria-busy=\{isGenerating\}/);
  assert.match(source, /disabled=\{isGenerating\}/);
  assert.match(source, /focus-visible:ring-2/);
  assert.match(source, /aria-label="获取简历改进指导"/);
  assert.match(source, /停止生成/);
});
