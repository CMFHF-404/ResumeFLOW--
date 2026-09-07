import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
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

const guidanceEvaluation = () => ({
  evaluationVersion: 'guidance_audit_v1',
  evaluationScope: 'full_resume',
  targetRole: '产品经理',
  overallBand: 'needs_attention',
  confidence: 'medium',
  dimensionGuidance: [
    '逻辑清晰', 'STAR应用', '内容可读', '内容完整', '专业表达', '成果量化',
  ].map((dimension) => ({
    dimension,
    status: 'needs_attention',
    strengths: [],
    issues: [`${dimension}存在待改进项`],
    actions: [`改善${dimension}的表达`],
  })),
  topPriorities: [{
    taskId: 'TASK_001', issueId: 'ISSUE_001', dimension: 'STAR应用',
    fieldPath: 'experiences[0].star.a', description: '行动描述过于泛化',
    action: '补充具体动作、对象及个人职责',
  }],
  safeCleanup: [{
    taskId: 'TASK_002', issueId: 'ISSUE_002', dimension: '内容可读',
    fieldPath: 'summary', description: '句末缺少标点', action: '补齐句末标点',
  }],
  informationNeeded: [{
    taskId: 'TASK_001', issueId: 'ISSUE_001', dimension: 'STAR应用',
    fieldPath: 'experiences[0].star.a', description: '行动描述过于泛化', action: '补充具体动作、对象及个人职责',
  }],
  riskFlags: [{ taskId: 'TASK_004', type: 'exaggerated_claim', description: '个人总结存在夸大表达' }],
  auditReceipt: {
    receiptId: 'a'.repeat(32), inputHash: 'b'.repeat(64), tasksHash: 'c'.repeat(64),
    judgmentsHash: 'd'.repeat(64), rubricHash: 'e'.repeat(64), schemaHash: 'f'.repeat(64),
    auditVersion: 'guidance_task_audit_v1',
  },
  jdMatch: 78,
});

test('guidance_audit_v1 is strictly normalized without public quality scores', async () => {
  const { isGuidanceAuditEvaluation, normalizeResumeEvaluation } = await importNormalizer();
  const normalized = normalizeResumeEvaluation(guidanceEvaluation());

  assert.ok(normalized);
  assert.equal(isGuidanceAuditEvaluation(normalized), true);
  assert.equal(normalized.overallBand, 'needs_attention');
  assert.equal(normalized.jdMatch, 78);
  assert.equal('overallScore' in normalized, false);
  assert.equal('scoreCalculation' in normalized, false);
  assert.equal('dimensions' in normalized, false);

  const withLeakedScore = guidanceEvaluation();
  withLeakedScore.overallScore = 61;
  assert.equal(normalizeResumeEvaluation(withLeakedScore), undefined);

  const missingAuditHash = guidanceEvaluation();
  missingAuditHash.auditReceipt.rubricHash = '';
  assert.equal(normalizeResumeEvaluation(missingAuditHash), undefined);

  const wrongAuditVersion = guidanceEvaluation();
  wrongAuditVersion.auditReceipt.auditVersion = 'guidance_audit_v1';
  assert.equal(normalizeResumeEvaluation(wrongAuditVersion), undefined);

  const incompleteDimensions = guidanceEvaluation();
  incompleteDimensions.dimensionGuidance.pop();
  assert.equal(normalizeResumeEvaluation(incompleteDimensions), undefined);

  const unclassifiedPriority = guidanceEvaluation();
  unclassifiedPriority.informationNeeded = [];
  assert.equal(normalizeResumeEvaluation(unclassifiedPriority), undefined);

  const conflictingAction = guidanceEvaluation();
  conflictingAction.informationNeeded.push({ ...conflictingAction.safeCleanup[0] });
  assert.equal(normalizeResumeEvaluation(conflictingAction), undefined);
});

test('guidance accepts an empty target role while rejecting invalid role values', async () => {
  const { normalizeResumeEvaluation } = await importNormalizer();
  for (const targetRole of ['', '产品经理']) {
    const report = { ...guidanceEvaluation(), targetRole };
    assert.deepEqual(normalizeResumeEvaluation(report), report);
  }
  for (const targetRole of [undefined, null, 0, {}, []]) {
    assert.equal(normalizeResumeEvaluation({ ...guidanceEvaluation(), targetRole }), undefined);
  }
  assert.equal(normalizeResumeEvaluation({
    ...guidanceEvaluation(), targetRole: '', target_role: '产品经理',
  }), undefined);
});

test('guidance report UI does not reintroduce quality score or radar surfaces', async () => {
  const source = await readFile(
    'views/ResumeEditor/components/ResumeEvaluationReport/ResumeEvaluationReport.tsx',
    'utf8',
  );
  assert.match(source, /整体状态/);
  assert.match(source, /可以直接整理/);
  assert.match(source, /需要补充信息/);
  assert.doesNotMatch(source, /overallScore|scoreCalculation|subscores|buildRadarPoints|六维评分明细/);
});

test('development fixture covers current guidance, historical read gating, and an independent JD badge', async () => {
  const source = await readFile('views/ResumeTemplatePreviewDevPage.tsx', 'utf8');
  assert.match(source, /guidanceReview/);
  assert.match(source, /guidance_audit_v1/);
  assert.match(source, /data-rf-guidance-review-fixture/);
  assert.match(source, /ResumeScoreBadge score=\{82\}/);
  assert.doesNotMatch(source, /aiService|resumeOptimizationService|LogtoProvider/);
});
