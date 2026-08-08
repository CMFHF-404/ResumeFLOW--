import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  buildRadarPoints,
  clampEvaluationScore,
  EVALUATION_DIMENSIONS,
  normalizeResumeEvaluation,
} from '../views/ResumeEditor/components/ResumeEvaluationReport/evaluationReportUtils.mjs';

test('resume evaluation only becomes available with an evaluation version', () => {
  assert.equal(normalizeResumeEvaluation({ overallScore: 86, dimensions: [] }), null);

  const report = normalizeResumeEvaluation({
    evaluationVersion: 'resume_flow_v1',
    overallScore: 120,
    dimensions: [{ dimension: '成果量化', score: -20 }],
  });
  assert.equal(report.overallScore, 100);
  assert.deepEqual(report.dimensions.map((item) => item.dimension), EVALUATION_DIMENSIONS);
  assert.equal(report.dimensions.at(-1).score, 0);
  assert.equal(report.dimensions.at(-1).unavailable, undefined);
  assert.equal(report.dimensions[0].unavailable, true);
});

test('report normalizer exposes structured evidence and action records as readable text', () => {
  const report = normalizeResumeEvaluation({
    evaluationVersion: 'resume_flow_v1',
    overallScore: 82,
    evaluationConfidence: 0.82,
    dimensions: [{ dimension: 'STAR应用', score: 81, subscores: [{ name: '情境', score: 12, maxScore: 15, evidenceIds: ['E1'] }], issues: ['I1'] }],
    evidence: [{ evidenceId: 'E1', sourceText: '主导一次跨团队交付' }],
    issues: [{ issueId: 'I1', description: '成果缺少量化结果', evidenceIds: ['E1'] }],
    missingInformation: [{ field: '影响范围', question: '影响了多少用户？' }],
    riskFlags: [{ type: 'unverified_fact', description: '该成果仍待核验' }],
    topPriorities: [{ action: '补充影响范围和具体指标' }],
  });
  assert.deepEqual(report.evidence, ['主导一次跨团队交付']);
  assert.deepEqual(report.issues, ['成果缺少量化结果']);
  assert.deepEqual(report.missingInformation, ['影响了多少用户？']);
  assert.deepEqual(report.riskFlags, ['该成果仍待核验']);
  assert.deepEqual(report.topPriorities, ['补充影响范围和具体指标']);
  assert.deepEqual(report.dimensions[1].subscores, ['情境 12/15']);
  assert.deepEqual(report.dimensions[1].issues, ['成果缺少量化结果']);
  assert.deepEqual(report.dimensions[1].evidence, ['主导一次跨团队交付']);
  assert.equal(report.evaluationConfidence, '82%');
});

test('radar coordinates clamp every score and always contain six finite points', () => {
  assert.equal(clampEvaluationScore(Number.NaN), 0);
  assert.equal(clampEvaluationScore(1000), 100);
  const points = buildRadarPoints([-10, 0, 50, 100, 200, Number.NaN]).split(' ');
  assert.equal(points.length, 6);
  for (const point of points) {
    const [x, y] = point.split(',').map(Number);
    assert.ok(Number.isFinite(x));
    assert.ok(Number.isFinite(y));
    assert.ok(x >= 0 && x <= 100);
    assert.ok(y >= 0 && y <= 100);
  }
});

test('radar uses the full report width and writes scores beside each axis label', () => {
  const source = readFileSync(
    new URL('../views/ResumeEditor/components/ResumeEvaluationReport/ResumeEvaluationReport.tsx', import.meta.url),
    'utf8'
  );
  assert.match(source, /max-w-\[320px\]/);
  assert.match(source, /const item = dimensions\[index\]/);
  assert.match(source, /<tspan[^>]*>\{dimension\}<\/tspan>/);
  assert.match(source, /<tspan[^>]*>\{scoreText\}<\/tspan>/);
  assert.match(source, /<div className="space-y-3">\s*<ResumeEvaluationRadar/);
  assert.doesNotMatch(source, /sm:grid-cols-\[minmax\(0,1\.12fr\)/);
  assert.doesNotMatch(source, /<ul className="mt-2 grid grid-cols-2/);
  assert.doesNotMatch(source, /<ul className="mt-2 space-y-1 border-t/);
});

test('report keeps every returned item and marks stale evaluations as historical', () => {
  const source = readFileSync(
    new URL('../views/ResumeEditor/components/ResumeEvaluationReport/ResumeEvaluationReport.tsx', import.meta.url),
    'utf8'
  );
  assert.match(source, /items\.map\(/);
  assert.doesNotMatch(source, /items\.slice\(0, 4\)/);
  assert.match(source, /这是较早版本简历的历史评分/);
  assert.match(source, /isOutdated = false/);
});

test('report keeps the diagnosis focused by hiding confidence, scoring version, and collected evidence', () => {
  const source = readFileSync(
    new URL('../views/ResumeEditor/components/ResumeEvaluationReport/ResumeEvaluationReport.tsx', import.meta.url),
    'utf8'
  );
  assert.doesNotMatch(source, /置信度/);
  assert.doesNotMatch(source, /评分标准/);
  assert.doesNotMatch(source, /已识别证据/);
  assert.doesNotMatch(source, /评分证据/);
});

test('missing report exposes a keyboard-accessible explicit generation action', () => {
  const source = readFileSync(
    new URL('../views/ResumeEditor/components/ResumeEvaluationReport/ResumeEvaluationReport.tsx', import.meta.url),
    'utf8'
  );
  assert.match(source, /type="button"/);
  assert.match(source, /获取六维报告/);
  assert.match(source, /基于六大维度，对简历质量进行深度评价/);
  assert.doesNotMatch(source, /JD 匹配已独立保留/);
  assert.match(source, /重新生成六维报告/);
  assert.match(source, /aria-busy=\{isGenerating\}/);
  assert.match(source, /disabled=\{isGenerating\}/);
  assert.match(source, /focus-visible:ring-2/);
  assert.match(source, /aria-label="获取六维报告"/);
  assert.match(source, /停止生成/);
});
