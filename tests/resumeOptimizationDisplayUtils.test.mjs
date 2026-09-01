import assert from 'node:assert/strict';
import test from 'node:test';

import {
  areResumeOptimizationAnswersComplete,
  buildResumeOptimizationOverviewMetrics,
  buildResumeOptimizationQuestionChoices,
  formatResumeOptimizationDimensionLabel,
  formatResumeOptimizationModuleLabel,
  formatResumeOptimizationSourceLabel,
  formatResumeOptimizationUserCopy,
  isResumeOptimizationAnswerComplete,
  resolveResumeOptimizationChoiceDraft,
  sortResumeOptimizationChangesByExpectedGain,
} from '../views/ResumeEditor/components/ResumeOptimization/optimizationDisplayUtils.mjs';

const change = (changeId, actionKind, safetyStatus, expectedScoreGain) => ({
  changeId,
  actionKind,
  safetyStatus,
  expectedScoreGain,
});

test('overview metrics count only the documented plan categories', () => {
  const metrics = buildResumeOptimizationOverviewMetrics({
    changes: [
      change('direct-a', 'rewrite_now', 'allowed', 3),
      change('direct-b', 'rewrite_now', 'allowed', 2),
      change('blocked-rewrite', 'rewrite_now', 'blocked', 9),
      change('pending-question', 'ask_user', 'pending', 8),
    ],
    questions: [{ questionId: 'q1' }, { questionId: 'q2' }],
    bankSuggestions: [{ suggestionId: 'bank-1' }],
  });

  assert.deepEqual(metrics, {
    directChanges: 2,
    questions: 2,
    blockedChanges: 1,
    bankOpportunities: 1,
  });
});

test('expected gain sorting is stable, descending, and does not mutate input', () => {
  const changes = [
    change('first', 'rewrite_now', 'allowed', 3),
    change('second', 'rewrite_now', 'allowed', 9),
    change('third', 'ask_user', 'pending', 9),
    change('fourth', 'leave_unchanged', 'blocked', 0),
  ];
  const original = [...changes];

  assert.deepEqual(
    sortResumeOptimizationChangesByExpectedGain(changes).map((item) => item.changeId),
    ['second', 'third', 'first', 'fourth'],
  );
  assert.deepEqual(changes, original);
});

test('display labels use allowlists and never echo paths or unknown identifiers', () => {
  assert.equal(formatResumeOptimizationModuleLabel('experience_star'), '经历 STAR');
  assert.equal(formatResumeOptimizationModuleLabel('personal_summary'), '个人总结');
  assert.equal(formatResumeOptimizationModuleLabel('skills_order'), '技能顺序');
  assert.equal(formatResumeOptimizationModuleLabel('section_order'), '模块顺序');
  assert.equal(formatResumeOptimizationModuleLabel('bank_suggestion'), '经历库机会');
  assert.equal(formatResumeOptimizationModuleLabel('personal_summary', 'unsupported'), '当前简历');
  assert.equal(formatResumeOptimizationModuleLabel('../../private'), '简历内容');

  assert.equal(formatResumeOptimizationDimensionLabel(' STAR 应用 '), 'STAR应用');
  assert.equal(formatResumeOptimizationDimensionLabel('内容完整性'), '内容完整');
  assert.equal(formatResumeOptimizationDimensionLabel('教育背景'), '教育背景');
  assert.equal(formatResumeOptimizationDimensionLabel('证书完整性'), '证书完整性');
  assert.equal(formatResumeOptimizationDimensionLabel('/currentResume/private'), '综合优化');
  assert.equal(formatResumeOptimizationDimensionLabel('unknown-secret'), '综合优化');

  assert.equal(formatResumeOptimizationSourceLabel('当前简历'), '当前简历');
  assert.equal(formatResumeOptimizationSourceLabel('已选经历原始版本'), '从总经历补回');
  assert.equal(formatResumeOptimizationSourceLabel('本轮补充信息'), '来自补充信息');
  assert.equal(formatResumeOptimizationSourceLabel('/currentResume/private'), '已验证来源');

  assert.equal(formatResumeOptimizationUserCopy('保留可确认的项目事实', '安全降级'), '保留可确认的项目事实');
  assert.equal(
    formatResumeOptimizationUserCopy('请核对 /currentResume/experiences/private-id/star/a', '安全降级'),
    '安全降级',
  );
  assert.equal(
    formatResumeOptimizationUserCopy('请修改 fieldPath=star.a 并参考 moduleId=private-id', '安全降级'),
    '安全降级',
  );
});

test('answer completeness accepts four terminal states and fails closed for malformed sets', () => {
  assert.equal(isResumeOptimizationAnswerComplete({ state: 'answered', value: '  有效事实  ' }), true);
  assert.equal(isResumeOptimizationAnswerComplete({ state: 'answered', value: ' \n ' }), false);
  for (const state of ['no_data', 'unknown', 'not_my_work', 'skipped']) {
    assert.equal(isResumeOptimizationAnswerComplete({ state, value: '' }), true);
  }
  assert.equal(isResumeOptimizationAnswerComplete({ state: 'invented', value: 'x' }), false);
  assert.equal(isResumeOptimizationAnswerComplete(undefined), false);

  const questions = [{ questionId: 'q1' }, { questionId: 'q2' }];
  assert.equal(areResumeOptimizationAnswersComplete(questions, {
    q1: { state: 'answered', value: '事实' },
    q2: { state: 'unknown', value: '' },
  }), true);
  assert.equal(areResumeOptimizationAnswersComplete(questions, {
    q1: { state: 'answered', value: '事实' },
  }), false);
  assert.equal(areResumeOptimizationAnswersComplete([], {}), false);
  assert.equal(areResumeOptimizationAnswersComplete(
    Array.from({ length: 6 }, (_, index) => ({ questionId: `q${index}` })),
    {},
  ), false);
});

test('question choices submit human labels, map terminal choices, and deduplicate safely', () => {
  assert.deepEqual(
    resolveResumeOptimizationChoiceDraft({ value: 'partial', label: '  负责部分页面  ' }),
    { state: 'answered', value: '负责部分页面' },
  );
  assert.deepEqual(
    resolveResumeOptimizationChoiceDraft({ value: 'not_my_work', label: '不是我的工作' }),
    { state: 'not_my_work', value: '' },
  );
  assert.deepEqual(
    resolveResumeOptimizationChoiceDraft({ value: 'opaque', label: '没有数据' }),
    { state: 'no_data', value: '' },
  );

  assert.deepEqual(buildResumeOptimizationQuestionChoices([
    { value: 'partial', label: '负责部分页面' },
    { value: 'duplicate', label: '负责部分页面' },
    { value: 'not_my_work', label: '不属于我的工作' },
    { value: 'opaque', label: '没有数据' },
  ]), [{
    label: '负责部分页面',
    draft: { state: 'answered', value: '负责部分页面' },
  }]);
});
