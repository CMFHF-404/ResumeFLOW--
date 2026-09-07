import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import {
  areResumeOptimizationAnswersComplete,
  buildResumeOptimizationChangePreview,
  buildResumeOptimizationSafetyFindingCopy,
  buildResumeOptimizationExperienceComparisonMap,
  buildResumeOptimizationPersonalSummaryComparison,
  buildResumeOptimizationOverviewMetrics,
  buildResumeOptimizationQuestionChoices,
  formatResumeOptimizationDimensionLabel,
  formatResumeOptimizationModuleLabel,
  formatResumeOptimizationSourceLabel,
  formatResumeOptimizationUserCopy,
  hasPreservedResumeOptimizationRichText,
  isResumeOptimizationChangeReviewable,
  isResumeOptimizationAnswerComplete,
  normalizeResumeOptimizationActionParagraphEndings,
  resolveResumeOptimizationExperienceCategory,
  resolveResumeOptimizationChoiceDraft,
  shouldRenderResumeOptimizationComparison,
  sortResumeOptimizationChangesByResumeOrder,
} from '../views/ResumeEditor/components/ResumeOptimization/optimizationDisplayUtils.mjs';

const change = (changeId, actionKind, safetyStatus) => ({
  changeId,
  actionKind,
  safetyStatus,
  beforeValue: '原内容',
  targetedValue: '新内容',
});

test('complete sentence reflow remains selectable and visible in inline comparisons', () => {
  const item = {
    ...change('reflow', 'rewrite_now', 'allowed', 3),
    moduleType: 'experience_star', moduleId: 'exp-a', fieldPath: 'star.a',
    beforeValue: '完成调研。<br>完成交付。',
    targetedValue: '完成调研并交付。',
  };
  assert.equal(hasPreservedResumeOptimizationRichText(item.beforeValue, item.targetedValue), true);
  assert.equal(isResumeOptimizationChangeReviewable(item), true);
  assert.equal(buildResumeOptimizationExperienceComparisonMap([item]).get('exp-a')[0].changeId, 'reflow');
});

test('reflow keeps fragments and protected markup under the strict structure gate', () => {
  const cases = JSON.parse(readFileSync(new URL('./fixtures/resumeOptimizationReflow.json', import.meta.url), 'utf8'));
  for (const { before, after, allowed } of cases) {
    assert.equal(hasPreservedResumeOptimizationRichText(before, after), allowed, before);
  }
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

test('overview metrics and reviewability share the same rich-text safety gate', () => {
  const safe = {
    ...change('safe', 'rewrite_now', 'allowed', 3),
    beforeValue: '<strong>旧内容</strong>',
    targetedValue: '<strong>新内容</strong>',
  };
  const unsafe = {
    ...change('unsafe', 'rewrite_now', 'allowed', 3),
    beforeValue: '<strong>旧内容</strong>',
    targetedValue: '新内容',
  };

  assert.equal(isResumeOptimizationChangeReviewable(safe), true);
  assert.equal(isResumeOptimizationChangeReviewable(unsafe), false);
  assert.deepEqual(buildResumeOptimizationOverviewMetrics({
    changes: [safe, unsafe],
    questions: [],
    bankSuggestions: [],
  }), {
    directChanges: 1,
    questions: 0,
    blockedChanges: 0,
    bankOpportunities: 0,
  });
});

test('only an exact empty personal summary is reviewable as an explicit deletion', () => {
  const deletion = {
    ...change('delete-summary', 'rewrite_now', 'allowed', 1),
    moduleType: 'personal_summary',
    moduleId: 'current_resume',
    fieldPath: 'personal_summary',
    beforeValue: '原评价',
    targetedValue: '',
  };

  assert.equal(hasPreservedResumeOptimizationRichText('原评价', ''), false);
  assert.equal(isResumeOptimizationChangeReviewable(deletion), true);
  assert.equal(isResumeOptimizationChangeReviewable({
    ...deletion,
    moduleType: 'experience_star',
    moduleId: 'experience-1',
    fieldPath: 'star.a',
  }), false);
  for (const targetedValue of [' ', '<p></p>', '<strong>&nbsp;</strong>', '\u200B']) {
    assert.equal(isResumeOptimizationChangeReviewable({
      ...deletion,
      targetedValue,
    }), false, JSON.stringify(targetedValue));
  }
  assert.deepEqual(buildResumeOptimizationOverviewMetrics({
    changes: [deletion],
    questions: [],
    bankSuggestions: [],
  }), {
    directChanges: 1,
    questions: 0,
    blockedChanges: 0,
    bankOpportunities: 0,
  });
  assert.deepEqual(
    buildResumeOptimizationPersonalSummaryComparison([deletion], ['delete-summary']),
    {
      changeId: 'delete-summary',
      beforeValue: '原评价',
      afterValue: '',
      selected: true,
      readOnly: false,
    },
  );
});

test('resume order sorting is stable, field-aware, and does not mutate input', () => {
  const changes = [
    { ...change('project-r', 'rewrite_now', 'allowed', 99), moduleType: 'experience_star', moduleId: 'project-1', fieldPath: 'star.r' },
    { ...change('work-r', 'rewrite_now', 'allowed', 1), moduleType: 'experience_star', moduleId: 'work-1', fieldPath: 'star.r' },
    { ...change('summary', 'rewrite_now', 'allowed', 5), moduleType: 'personal_summary', moduleId: 'current_resume', fieldPath: 'personal_summary' },
    { ...change('work-s', 'rewrite_now', 'allowed', 2), moduleType: 'experience_star', moduleId: 'work-1', fieldPath: 'star.s' },
    { ...change('unknown', 'rewrite_now', 'allowed', 100), moduleType: 'experience_star', moduleId: 'unknown', fieldPath: 'star.a' },
  ];
  const original = [...changes];

  assert.deepEqual(
    sortResumeOptimizationChangesByResumeOrder(
      changes,
      ['summary', 'work-1', 'project-1'],
    ).map((item) => item.changeId),
    ['summary', 'work-s', 'work-r', 'project-r', 'unknown'],
  );
  assert.deepEqual(changes, original);
});

test('comparison lifecycle clears prior review content while a new run is starting', () => {
  for (const state of ['closed', 'starting', 'awaiting_answers', 'answering', 'error', 'stale']) {
    assert.equal(shouldRenderResumeOptimizationComparison(state), false, state);
  }
  for (const state of ['preview', 'applying', 'rescoring', 'completed']) {
    assert.equal(shouldRenderResumeOptimizationComparison(state), true, state);
  }
});

test('historical plans cannot remove or rewrite rich-text links and emphasis', () => {
  assert.equal(hasPreservedResumeOptimizationRichText(
    '交付（<a href="https://example.com/project">项目链接</a>）',
    '交付（项目链接）',
  ), false);
  assert.equal(hasPreservedResumeOptimizationRichText(
    '负责 <strong>核心流程</strong>',
    '负责 <b>核心流程</b>',
  ), false);
  assert.equal(hasPreservedResumeOptimizationRichText(
    '输出 **高保真原型** 与 *交互说明*',
    '完成 **高保真原型** 与 *交互说明*',
  ), true);
  assert.equal(hasPreservedResumeOptimizationRichText(
    '参考 [项目](https://example.com/path_(legacy)?v=1)',
    '参考 [项目](https://example.com/path_(legacy)?v=2)',
  ), false);
  assert.equal(hasPreservedResumeOptimizationRichText(
    '[查看 [项目]](https://e.test/a_(b)?v=1)',
    '[查看 [项目]](https://e.test/a_(b)?v=2)',
  ), false);
  assert.equal(hasPreservedResumeOptimizationRichText(
    '[查看 \\]](https://e.test/a_(b)?v=1)',
    '[查看 \\]](https://e.test/a_(b)?v=2)',
  ), false);
  assert.equal(hasPreservedResumeOptimizationRichText(
    '第一段',
    '<ul><li><strong>第一段</strong></li></ul>',
  ), true);
  assert.equal(hasPreservedResumeOptimizationRichText(
    '第一行<br>第二行',
    '第一行第二行',
  ), false);
  assert.equal(hasPreservedResumeOptimizationRichText(
    '<ul><li>甲</li></ul>',
    '<li>甲</li>',
  ), false);
  assert.equal(hasPreservedResumeOptimizationRichText(
    '<ol><li>甲</li></ol>',
    '<li>甲</li>',
  ), false);
  assert.equal(hasPreservedResumeOptimizationRichText(
    '<ul><li>甲</li><li>乙</li></ul>',
    '<ul>甲乙</ul>',
  ), false);
  assert.equal(hasPreservedResumeOptimizationRichText(
    '<ol><li>甲</li><li>乙</li></ol>',
    '<ol><li>甲</li><li>乙</li></ol>',
  ), true);
  for (const candidate of [
    '<ul><li>甲</li></ul><ul><li>乙</li></ul>',
    '<li><ul><li>甲</li></ul></li>',
    '<ul><div><li>甲</li></div></ul>',
  ]) {
    const before = candidate.includes('乙')
      ? '<ul><li>甲</li><li>乙</li></ul>'
      : '<ul><li>甲</li></ul>';
    assert.equal(hasPreservedResumeOptimizationRichText(before, candidate), false, candidate);
    assert.equal(isResumeOptimizationChangeReviewable({
      safetyStatus: 'allowed',
      actionKind: 'rewrite_now',
      beforeValue: before,
      targetedValue: candidate,
    }), false, `reviewable: ${candidate}`);
  }
  assert.equal(hasPreservedResumeOptimizationRichText(
    '<ul><li>旧内容</li><li><strong>旧重点</strong></li></ul>',
    '<ul><li>新内容</li><li><strong>新重点</strong></li></ul>',
  ), true);
  assert.equal(hasPreservedResumeOptimizationRichText(
    '<a href="https://example.com">项目链接</a>',
    '<a href="https://example.com"></a>项目链接',
  ), false);
  assert.equal(hasPreservedResumeOptimizationRichText(
    '<strong>核心流程</strong>',
    '<strong></strong>核心流程',
  ), false);
  assert.equal(hasPreservedResumeOptimizationRichText(
    '<ul><li>甲</li><li>乙</li></ul>',
    '<ul><li></li><li></li></ul>甲乙',
  ), false);
  assert.equal(hasPreservedResumeOptimizationRichText(
    '<a href="https://example.com">旧项目</a><strong>旧表达</strong>',
    '<a href="https://example.com">新项目</a><strong>新表达</strong><em>新增强调</em>',
  ), true);
  // A protected marker must stay bound to its source content. Matching only the
  // tag kind or URL would let a historical plan move the link/emphasis wrapper
  // onto adjacent text and expose the previously protected source as plain text.
  for (const [before, candidate, expected] of [
    ['<b>old</b> outside', '<b>outside</b> old', false],
    ['[old](https://example.test/link) outside', '[outside](https://example.test/link) old', false],
    [
      '<strong>prefix</strong> [old](https://example.test/link) outside',
      '<strong>prefix</strong> [outside](https://example.test/link) old',
      false,
    ],
    [
      '[old](https://example.test/link) <em>suffix</em> outside',
      '[outside](https://example.test/link) <em>suffix</em> old',
      false,
    ],
    ['<strong>old</strong> outside', '<strong>rewritten old</strong> outside', true],
    ['[old](https://example.test/link) outside', '[rewritten old](https://example.test/link) outside', true],
    ['old outside', '<strong>rewritten old</strong> outside', true],
  ]) {
    assert.equal(
      hasPreservedResumeOptimizationRichText(before, candidate),
      expected,
      `${before} -> ${candidate}`,
    );
  }
  for (const candidate of [
    '<a href="https://example.com">安全<a href="https://evil.example">恶意</a></a>',
    '<strong>未闭合内容',
    '</em>错位内容<em>',
    '<ul><li>未闭合列表</ul>',
    '<strong>new</ strong>',
    '< strong>new</ strong>',
    '<a href="/x"><div>项目</a></div>',
    '<strong><p>项目</strong></p>',
    '<strong',
    'text <a href="https://x"',
    '<div',
    'text <p class="lead"',
    '可见内容<script',
    '可见内容<x-shell',
    '<a href="https://safe.example>text</a>',
  ]) {
    assert.equal(
      hasPreservedResumeOptimizationRichText('原内容', candidate),
      false,
      candidate,
    );
  }
  assert.equal(
    hasPreservedResumeOptimizationRichText(
      '原内容',
      '<strong class="highlight">新内容</strong><br />下一行',
    ),
    true,
  );
  assert.equal(hasPreservedResumeOptimizationRichText('指标 2 < 3', '指标 2 < 4'), true);
  assert.equal(
    hasPreservedResumeOptimizationRichText(
      '<p>旧内容</p>',
      '<div class="wrapper"><p>新内容</p></div>',
    ),
    true,
  );
  for (const candidate of [
    '<br>',
    '<p></p>',
    '<strong>&nbsp;</strong>',
    '<strong>&#160;</strong>',
    '<strong>&#xA0;</strong>',
    '<strong>&#8203;</strong>',
    '<strong>&#x200B;</strong>',
    '<strong>\u200B</strong>',
    '<strong>&ZeroWidthSpace;</strong>',
    '<strong>\u200C\u200D\uFEFF</strong>',
  ]) {
    assert.equal(hasPreservedResumeOptimizationRichText('非空原内容', candidate), false, candidate);
    assert.equal(isResumeOptimizationChangeReviewable({
      safetyStatus: 'allowed',
      actionKind: 'rewrite_now',
      beforeValue: '非空原内容',
      targetedValue: candidate,
    }), false, candidate);
  }
  assert.equal(isResumeOptimizationChangeReviewable({
    safetyStatus: 'allowed',
    actionKind: 'rewrite_now',
    beforeValue: ['skill-a', 'skill-b'],
    targetedValue: ['skill-b', 'skill-a'],
  }), true);

  const quotedGreaterBefore = '<a title=">" href="https://safe.example">old</a>';
  assert.equal(hasPreservedResumeOptimizationRichText(
    quotedGreaterBefore,
    '<a title=">" href="https://evil.example">new</a>',
  ), false);
  assert.equal(hasPreservedResumeOptimizationRichText(
    quotedGreaterBefore,
    '<a title=">" href="https://safe.example">new</a>',
  ), true);
  assert.equal(hasPreservedResumeOptimizationRichText(
    '<a title=\'note href="decoy"\' href="https://safe.example">old</a>',
    '<a title=\'note href="decoy"\' href="https://evil.example">new</a>',
  ), false);
  assert.equal(hasPreservedResumeOptimizationRichText(
    '<a href="https://safe.example">old</a>',
    '<a href="https://safe.example" href="https://evil.example">new</a>',
  ), false);
  for (const candidate of [
    '<strong class="first" CLASS="second">new</strong>',
    '<strong data-x="first" data-x="second">new</strong>',
  ]) {
    assert.equal(hasPreservedResumeOptimizationRichText('old', candidate), false, candidate);
    assert.equal(isResumeOptimizationChangeReviewable({
      safetyStatus: 'allowed',
      actionKind: 'rewrite_now',
      beforeValue: 'old',
      targetedValue: candidate,
    }), false, `reviewable: ${candidate}`);
  }
  for (const candidate of [
    '<strong.foo>new</strong>',
    '<strong_bar>new</strong>',
    '<strong@x>new</strong>',
    '<strong-x>new</strong-x>',
    '<strong>new</strong.foo>',
    '<strong>new</strong_bar>',
    '<strong>new</strong@x>',
    '<strong.foo>new</strong.foo>',
    '<strong_bar>new</strong_bar>',
    '<strong@x>new</strong@x>',
    '<strong-x>new</strong-x>',
  ]) {
    assert.equal(
      hasPreservedResumeOptimizationRichText('<strong>old</strong>', candidate),
      false,
      candidate,
    );
    assert.equal(
      hasPreservedResumeOptimizationRichText('old', candidate),
      false,
      `plain source: ${candidate}`,
    );
  }
  assert.equal(
    hasPreservedResumeOptimizationRichText(
      '<strong>old</strong>',
      '<strong data-x="preserved">new</strong>',
    ),
    true,
  );
});

test('equivalent named link entities remain reviewable without changing destinations', () => {
  const pairs = [
    ['https://example.com/work', 'https:&sol;&sol;example.com&sol;work'],
    ['https://example.com/?q=work&lang=en', 'https://example.com/?q&equals;work&amp;lang&equals;en'],
    ['https://example.com/©/α', 'https://example.com/&copy;/&alpha;'],
    ['https://example.com/?q=&amp;sol;', 'https://example.com/?q=&#38;sol;'],
  ];
  for (const [plain, encoded] of pairs) {
    const beforeValue = `<a href="${plain}">作品</a>`;
    const targetedValue = `<a href="${encoded}">作品</a>`;
    assert.equal(hasPreservedResumeOptimizationRichText(beforeValue, targetedValue), true, encoded);
    assert.equal(isResumeOptimizationChangeReviewable({
      actionKind: 'rewrite_now', safetyStatus: 'allowed', beforeValue, targetedValue,
    }), true, encoded);
  }
  assert.equal(hasPreservedResumeOptimizationRichText(
    '<a href="https://example.com/work">作品</a>',
    '<a href="https:&sol;&sol;example.com&sol;different">作品</a>',
  ), false);
  assert.equal(hasPreservedResumeOptimizationRichText(
    '<a href="https://example.com/?q=/">作品</a>',
    '<a href="https://example.com/?q=&amp;sol;">作品</a>',
  ), false);
});

test('link targets are exact and action entities follow the backend contract', () => {
  const beforeHtml = '<a href="https://safe.example/project">旧项目</a>';
  const beforeMarkdown = '[旧项目](https://safe.example/project "title ) text")';
  for (const [before, targeted] of [
    [
      beforeHtml,
      '<a href="https://evil.example">新项目</a>'
        + '<a href="https://safe.example/project">旧 URL decoy</a>',
    ],
    [
      beforeHtml,
      '<a href="https://safe.example/project">新项目</a>'
        + '<a href="https://safe.example/project">重复 URL</a>',
    ],
    [
      beforeMarkdown,
      '[新项目](https://evil.example "title ) text") '
        + '[旧 URL decoy](https://safe.example/project "title ) text")',
    ],
    ['普通文本', '<a href="javascript&#58;alert(1)">危险链接</a>'],
    ['普通文本', '[危险链接](javascript&#58;alert(1))'],
  ]) {
    assert.equal(hasPreservedResumeOptimizationRichText(before, targeted), false, targeted);
  }
  assert.equal(
    hasPreservedResumeOptimizationRichText(
      beforeMarkdown,
      '[新项目](https://safe.example/project "title ) text")',
    ),
    true,
  );
  assert.equal(
    hasPreservedResumeOptimizationRichText('普通文本', '<strong>安全的格式添加</strong>'),
    true,
  );

  for (const [source, expected] of [
    ['行动&hellip;', '行动。'],
    ['行动&#8230;', '行动。'],
    ['行动&#x2026;', '行动。'],
    [
      '[项目&hellip;](https://safe.example "title ) text")',
      '[项目。](https://safe.example "title ) text")',
    ],
    [
      "[项目&#x2026;](https://safe.example 'title ) text')",
      "[项目。](https://safe.example 'title ) text')",
    ],
  ]) {
    assert.equal(normalizeResumeOptimizationActionParagraphEndings(source), expected, source);
    assert.equal(
      normalizeResumeOptimizationActionParagraphEndings(expected),
      expected,
      `${source}: idempotent`,
    );
  }
});

test('protected wrappers stay bound to the same duplicate-text occurrence', () => {
  for (const [before, targeted] of [
    [
      '<a href="https://safe.example">重复</a> 重复',
      '重复 <a href="https://safe.example">重复</a>',
    ],
    ['<b>重复</b> 重复', '重复 <b>重复</b>'],
    ['**重复** 重复', '重复 **重复**'],
    [
      '<a href="https://safe.example">旧</a> 旧',
      '新 <a href="https://safe.example">新</a>',
    ],
    ['<b>旧</b> 旧', '新 <b>新</b>'],
    ['**旧** 旧', '新 **新**'],
    [
      '<a href="https://safe.example">重复</a> 重复',
      '重复 <a href="https://safe.example">改写重复</a>',
    ],
    ['<b>重复</b> 重复', '重复 <b>改写重复</b>'],
    ['**重复** 重复', '重复 **改写重复**'],
    ['重复 <b>重复</b> 重复 重复', '重复 重复 <b>改写重复</b> 重复'],
    [
      '重复 <a href="https://safe.example">重复</a> 重复 重复',
      '重复 重复 <a href="https://safe.example">改写重复</a> 重复',
    ],
    ['重复 **重复** 重复 重复', '重复 重复 **改写重复** 重复'],
    ['重复，<b>重复</b>，重复，重复', '重复，重复，<b>改写重复</b>，重复'],
    [
      '重复，<a href="https://safe.example">重复</a>，重复，重复',
      '重复，重复，<a href="https://safe.example">改写重复</a>，重复',
    ],
    ['重复，**重复**，重复，重复', '重复，重复，**改写重复**，重复'],
  ]) {
    assert.equal(hasPreservedResumeOptimizationRichText(before, targeted), false, targeted);
  }
  for (const [before, targeted] of [
    ['<b>旧</b> 旧', '<b>新</b> 新'],
    [
      '<a href="https://safe.example">旧</a> 旧',
      '<a href="https://safe.example">新</a> 新',
    ],
    ['**旧** 旧', '**新** 新'],
  ]) {
    assert.equal(hasPreservedResumeOptimizationRichText(before, targeted), true, targeted);
  }
});

test('optimization link signatures ignore malformed Markdown that the renderer keeps literal', () => {
  const before = '[safe](https://safe.example)';
  for (const malformedPrefix of [
    String.raw`\[evil](https://evil.example)`,
    '[evil\nlabel](https://evil.example)',
    '[evil](https://evil.example "unfinished)',
  ]) {
    assert.equal(
      hasPreservedResumeOptimizationRichText(before, `${malformedPrefix} ${before}`),
      true,
      malformedPrefix,
    );
  }
  assert.equal(
    hasPreservedResumeOptimizationRichText(
      '[safe](https://safe.example/path_(v1) "old title")',
      '[new](https://safe.example/path_(v1) "new title")',
    ),
    true,
  );
  assert.equal(
    hasPreservedResumeOptimizationRichText(
      '[safe](https://safe.example/?a=1&amp;b=2)',
      '[new](https://safe.example/?a=1&b=2)',
    ),
    false,
  );
  assert.equal(
    hasPreservedResumeOptimizationRichText(
      '<a href="https://safe.example/?a=1&amp;b=2">safe</a>',
      '<a href="https://safe.example/?a=1&b=2">new</a>',
    ),
    true,
  );
});

test('optimization gate fails closed for malformed comments and raw-text containers', () => {
  for (const candidate of [
    '正文<!--><a href="https://attacker.example/a">点击</a>',
    '<noscript><a href="https://attacker.example/a">点击</a></noscript>',
  ]) {
    assert.equal(hasPreservedResumeOptimizationRichText('正文', candidate), false, candidate);
  }
});

test('rich-text review rejects malformed protected HTML in either value', () => {
  for (const [beforeValue, targetedValue] of [
    ['<strong>old', '<strong>new</strong>'],
    ['<a href="/safe"><em>old</a></em>', '<a href="/safe"><em>new</em></a>'],
    ['< strong>old</ strong>', '<strong>new</strong>'],
    ['<strong>old</strong>', '<strong>new'],
  ]) {
    assert.equal(
      hasPreservedResumeOptimizationRichText(beforeValue, targetedValue),
      false,
      `${beforeValue} -> ${targetedValue}`,
    );
  }
  assert.equal(
    hasPreservedResumeOptimizationRichText('<a href>old</a>', '<a href>new</a>'),
    false,
  );
  assert.equal(
    hasPreservedResumeOptimizationRichText('<a href="">old</a>', '<a href="">new</a>'),
    true,
  );
});

test('rich-text review ignores links hidden in comments, raw text, and attributes', () => {
  const before = '<a href="/safe">旧链接</a>';
  const hiddenDecoys = [
    '<!-- <a href="/safe">注释链接</a> -->',
    '<script><a href="/safe">脚本链接</a></script>',
    '<style><a href="/safe">样式链接</a></style>',
    '<title><a href="/safe">标题链接</a></title>',
    '<template><a href="/safe">模板链接</a></template>',
    '<x-shell data-note=\'<a href="/safe">属性链接</a>\'></x-shell>',
    '<x-shell data-note=\'> <a href="/safe">属性链接</a>\'></x-shell>',
  ];

  for (const candidate of hiddenDecoys) {
    assert.equal(hasPreservedResumeOptimizationRichText(before, candidate), false, candidate);
    assert.equal(isResumeOptimizationChangeReviewable({
      safetyStatus: 'allowed',
      actionKind: 'rewrite_now',
      beforeValue: before,
      targetedValue: candidate,
    }), false, candidate);
    assert.equal(
      hasPreservedResumeOptimizationRichText(before, `${candidate}普通可见内容`),
      false,
      `visible suffix: ${candidate}`,
    );
  }

  for (const decoy of hiddenDecoys) {
    assert.equal(
      hasPreservedResumeOptimizationRichText(
        before,
        `${decoy}<a href="/different">真实链接</a>`,
      ),
      false,
      `different real link: ${decoy}`,
    );
  }

  assert.equal(
    hasPreservedResumeOptimizationRichText(
      before,
      '<x-shell data-note=\'<a href="/decoy">属性链接</a>\'></x-shell>'
        + '<a title=">" href="/safe">真实链接</a>',
    ),
    true,
  );
});

test('rich-text signatures ignore Markdown tokens hidden in HTML syntax', () => {
  const cases = [
    {
      before: '[旧链接](/safe)',
      candidates: [
        '普通内容<!-- [注释链接](/safe) -->',
        "普通内容<script>const link = '[脚本链接](/safe)'</script>",
        '<x-shell data-note="[属性链接](/safe)">普通内容</x-shell>',
        '<strong title="[属性链接](/safe)">普通内容</strong>',
      ],
    },
    {
      before: '**旧强调**',
      candidates: [
        '普通内容<!-- **注释强调** -->',
        "普通内容<script>const emphasis = '**脚本强调**'</script>",
        '<x-shell data-note="**属性强调**">普通内容</x-shell>',
        '<strong title="**属性强调**">普通内容</strong>',
      ],
    },
  ];

  for (const { before, candidates } of cases) {
    for (const candidate of candidates) {
      assert.equal(
        hasPreservedResumeOptimizationRichText(before, candidate),
        false,
        `${before} -> ${candidate}`,
      );
    }
  }
});

test('default-ignorable code points are empty while meaningful marks and ZWJ emoji stay visible', () => {
  for (const candidate of [
    '\u034F',
    '\u180B',
    '\u180C',
    '\u180D',
    '\u180F',
    '\uFE0F',
    '\u{E0100}',
    '&#847;',
    '&#x180F;',
    '&#65039;',
    '&#xFE0F;',
  ]) {
    assert.equal(hasPreservedResumeOptimizationRichText('非空原内容', candidate), false, candidate);
    assert.equal(isResumeOptimizationChangeReviewable({
      safetyStatus: 'allowed',
      actionKind: 'rewrite_now',
      beforeValue: '非空原内容',
      targetedValue: candidate,
    }), false, candidate);
  }

  assert.equal(hasPreservedResumeOptimizationRichText('旧内容', '👩‍💻'), true);
  assert.equal(hasPreservedResumeOptimizationRichText('旧内容', '\u0301'), true);
  assert.equal(isResumeOptimizationChangeReviewable({
    safetyStatus: 'allowed',
    actionKind: 'rewrite_now',
    beforeValue: '旧内容',
    targetedValue: '👩‍💻',
  }), true);
});

test('action paragraphs end with Chinese full stops without losing rich text', () => {
  for (const [source, expected] of [
    ['<span title="<br>">行动；</span>', '<span title="<br>">行动。</span>'],
    ['<a href="https://safe.example/?x=&NewLine;">行动；</a>', '<a href="https://safe.example/?x=&NewLine;">行动。</a>'],
    ['行动；&NewLine;下一段；', '行动。&NewLine;下一段。'],
    ['行动；&#0010;下一段；', '行动。&#0010;下一段。'],
    ['行动；&#X000A;下一段；', '行动。&#X000A;下一段。'],
    ['行动；&newline;', '行动&newline;。'],
    ['行动；&#10;', '行动。&#10;'],
    ['行动；<!--note-->\u200B', '行动。<!--note-->\u200B'],
    ['行动；\u2060', '行动。\u2060'],
    ['[项目；](https://safe.example "unfinished)', '[项目；](https://safe.example "unfinished)。'],
    ['<strong>action;</strong>\u200b', '<strong>action。</strong>\u200b'],
    ['<strong>action;\u200b</strong>', '<strong>action。\u200b</strong>'],
    [
      '<strong>action;</strong><!--note--> \u200b',
      '<strong>action。</strong><!--note--> \u200b',
    ],
    [
      '<em><strong>action;</strong> \u200b</em><!--note-->',
      '<em><strong>action。</strong> \u200b</em><!--note-->',
    ],
    ['action;<!-- x > y\n hidden -->', 'action。<!-- x > y\n hidden -->'],
    ['<strong>action;</strong>”', '<strong>action。</strong>”'],
    ['<strong>action;</strong>&#8203;', '<strong>action。</strong>&#8203;'],
    ['<p>x</p>&#8203;', '<p>x。</p>&#8203;'],
    ['<p>x</p>&ZeroWidthSpace;', '<p>x。</p>&ZeroWidthSpace;'],
    ['<p>x</p>&zwnj;', '<p>x。</p>&zwnj;'],
    ['<p>x</p>&zwj;', '<p>x。</p>&zwj;'],
    ['<p>x;</p>\u0085', '<p>x。</p>\u0085。'],
    ['<p>x;</p>\u001c', '<p>x。</p>\u001c。'],
    ['<p>x;</p>\u001d', '<p>x。</p>\u001d。'],
    ['<p>x;</p>\u001e', '<p>x。</p>\u001e。'],
    ['<p>x;</p>\u001f', '<p>x。</p>\u001f。'],
    ['<p>x;</p>\u0600', '<p>x。</p>\u0600。'],
    ['<p>x;</p><!-- x > y -->', '<p>x。</p><!-- x > y -->'],
    ['x;<!--a-->x<!--b-->', 'x;<!--a-->x。<!--b-->'],
    ['x;***', 'x;***。'],
    ['<p>x;</p>*', '<p>x。</p>*。'],
    ['<p>x;</p>**', '<p>x。</p>**。'],
    ['<p>x;</p>***', '<p>x。</p>***。'],
    ['<p>x;</p>__', '<p>x。</p>__。'],
    ['<p>x;</p>＊＊', '<p>x。</p>＊＊。'],
    ['<p>x;</p>&#42;', '<p>x。</p>&#42;。'],
    ['<p>x;</p>&#95;&#95;', '<p>x。</p>&#95;&#95;。'],
    ['<p>x;</p>&ApplyFunction;', '<p>x。</p>&ApplyFunction;'],
    ['<p>x;</p>&af;', '<p>x。</p>&af;'],
    ['<p>x;</p>&InvisibleTimes;', '<p>x。</p>&InvisibleTimes;'],
    ['<p>x;</p>&it;', '<p>x。</p>&it;'],
    ['<p>x;</p>&InvisibleComma;', '<p>x。</p>&InvisibleComma;'],
    ['<p>x;</p>&ic;', '<p>x。</p>&ic;'],
    ['<strong>x;</strong>&#0008221;', '<strong>x。</strong>&#0008221;'],
    ['<p>x;</p>&ZEROWIDTHSPACE;', '<p>x。</p>&ZEROWIDTHSPACE;。'],
    ['<strong>x;</strong>&CloseCurlyDoubleQuote;', '<strong>x。</strong>&CloseCurlyDoubleQuote;'],
    ['<strong>x;</strong>&CloseCurlyQuote;', '<strong>x。</strong>&CloseCurlyQuote;'],
    ['<strong>x;</strong>&rdquor;', '<strong>x。</strong>&rdquor;'],
    ['<strong>x;</strong>&rsquor;', '<strong>x。</strong>&rsquor;'],
    ['<strong>x;</strong>&CLOSECURLYQUOTE;', '<strong>x;</strong>&CLOSECURLYQUOTE;。'],
    ['**x;***', '**x;***。'],
    ['__x;___', '__x;___。'],
    ['＊＊x;＊＊＊', '＊＊x;＊＊＊。'],
    ['***x;****', '***x;****。'],
    ['**x;***<!--end-->', '**x;***。<!--end-->'],
    ['<strong>**x;***</strong>', '<strong>**x;***。</strong>'],
    ['<em>**x;**</em><!--note-->***', '<em>**x;**</em><!--note-->***。'],
    ['x&#133;', 'x。'],
    ['x&#x00085;', 'x。'],
    ['<strong>x;</strong>&#146;', '<strong>x。</strong>&#146;'],
    ['<strong>x;</strong>&#000146;', '<strong>x。</strong>&#000146;'],
    ['<strong>x;</strong>&#148;', '<strong>x。</strong>&#148;'],
    ['<strong>x;</strong>&#x00094;', '<strong>x。</strong>&#x00094;'],
    ['<strong>x;</strong>&nbsp;', '<strong>x。</strong>&nbsp;'],
    ['<strong>x;</strong>&Tab;', '<strong>x。</strong>&Tab;'],
    ['<strong>x;</strong>&#9;', '<strong>x。</strong>&#9;'],
    ['<strong>x;</strong>&#160;', '<strong>x。</strong>&#160;'],
    ['<strong>x;\t</strong>', '<strong>x。\t</strong>'],
    ['<strong>x;\u00a0</strong>', '<strong>x。\u00a0</strong>'],
  ]) {
    assert.equal(normalizeResumeOptimizationActionParagraphEndings(source), expected, source);
    assert.equal(normalizeResumeOptimizationActionParagraphEndings(expected), expected, `${source}: idempotent`);
  }
  assert.equal(
    normalizeResumeOptimizationActionParagraphEndings(
      '<div title=">"><p data-note="x > y">第一段</p></div>',
    ),
    '<div title=">"><p data-note="x > y">第一段。</p></div>',
  );
  assert.equal(
    normalizeResumeOptimizationActionParagraphEndings(
      '<ul><li>Parent<ul><li>Child</li></ul></li></ul>',
    ),
    '<ul><li>Parent。<ul><li>Child。</li></ul></li></ul>',
  );
  assert.equal(
    normalizeResumeOptimizationActionParagraphEndings(
      '<div><p>第一段</p><p>第二段</p></div>',
    ),
    '<div><p>第一段。</p><p>第二段。</p></div>',
  );
  assert.equal(
    normalizeResumeOptimizationActionParagraphEndings(
      '第一段；\n第二段;<br><strong>第三段</strong>',
    ),
    '第一段。\n第二段。<br><strong>第三段。</strong>',
  );
  assert.equal(
    normalizeResumeOptimizationActionParagraphEndings(
      '<ul><li>第一段；</li><li><em>第二段</em></li></ul>',
    ),
    '<ul><li>第一段。</li><li><em>第二段。</em></li></ul>',
  );
  assert.equal(
    normalizeResumeOptimizationActionParagraphEndings('<p>行动&nbsp;</p>'),
    '<p>行动&nbsp;。</p>',
  );
  assert.equal(
    normalizeResumeOptimizationActionParagraphEndings('行动&nbsp;；'),
    '行动&nbsp;。',
  );
  assert.equal(
    normalizeResumeOptimizationActionParagraphEndings('Action&nbsp;;'),
    'Action&nbsp;。',
  );
  assert.equal(
    normalizeResumeOptimizationActionParagraphEndings('行动&#160;;'),
    '行动&#160;。',
  );
  assert.equal(
    normalizeResumeOptimizationActionParagraphEndings('行动&nbsp;”'),
    '行动&nbsp;。”',
  );
  assert.equal(
    normalizeResumeOptimizationActionParagraphEndings('行动&nbsp;；”'),
    '行动&nbsp;。”',
  );
  for (const [input, expected] of [
    ['行动&rdquo;', '行动。&rdquo;'],
    ['行动&rsquo;', '行动。&rsquo;'],
    ['行动&quot;', '行动。&quot;'],
    ['行动&apos;', '行动。&apos;'],
    ['行动&#8221;', '行动。&#8221;'],
    ['行动&#8217;', '行动。&#8217;'],
    ['行动&#34;', '行动。&#34;'],
    ['行动&#39;', '行动。&#39;'],
    ['行动&#x201D;', '行动。&#x201D;'],
    ['行动&#x2019;', '行动。&#x2019;'],
    ['行动&#x22;', '行动。&#x22;'],
    ['行动&#x27;', '行动。&#x27;'],
    ['行动&nbsp;；&rdquo;', '行动&nbsp;。&rdquo;'],
    ['行动&nbsp;；&apos;', '行动&nbsp;。&apos;'],
    [
      '[项目](https://example.com/resume?from=optimizer&lang=zh)',
      '[项目](https://example.com/resume?from=optimizer&lang=zh)。',
    ],
    [
      '[项目](https://example.com/path_(legacy)?v=1)',
      '[项目](https://example.com/path_(legacy)?v=1)。',
    ],
    [
      '[查看 [项目]](https://e.test/a_(b)?v=1)',
      '[查看 [项目]](https://e.test/a_(b)?v=1)。',
    ],
    [
      '[查看 \\]](https://e.test/a_(b)?v=1)',
      '[查看 \\]](https://e.test/a_(b)?v=1)。',
    ],
    ['参与数据库迁移（MySQL）', '参与数据库迁移（MySQL）。'],
    [
      '参与数据库迁移（<strong>MySQL</strong>）',
      '参与数据库迁移（<strong>MySQL</strong>）。',
    ],
  ]) {
    assert.equal(normalizeResumeOptimizationActionParagraphEndings(input), expected, input);
  }
});

test('action punctuation is normalized inside trailing Markdown link labels only', () => {
  for (const [input, expected] of [
    [
      '[完成交付；](https://example.com/path;a=1?note=&#59;)',
      '[完成交付。](https://example.com/path;a=1?note=&#59;)',
    ],
    [
      '[完成交付。](https://example.com/path_(legacy)?v=1)',
      '[完成交付。](https://example.com/path_(legacy)?v=1)',
    ],
    [
      '[完成交付&#59;](https://example.com/path_(legacy)?v=1)',
      '[完成交付。](https://example.com/path_(legacy)?v=1)',
    ],
    [
      '[完成交付&#x3B;](https://example.com/path_(legacy)?v=1)',
      '[完成交付。](https://example.com/path_(legacy)?v=1)',
    ],
    [
      '[完成交付&semi;](https://example.com/path_(legacy)?v=1)',
      '[完成交付。](https://example.com/path_(legacy)?v=1)',
    ],
    [
      '[完成交付&Semi;](https://example.com/path_(legacy)?v=1)',
      '[完成交付&Semi;](https://example.com/path_(legacy)?v=1)。',
    ],
    [
      '[完成交付&Period;](https://example.com/path_(legacy)?v=1)',
      '[完成交付&Period;](https://example.com/path_(legacy)?v=1)。',
    ],
    [
      '[完成交付&#x3002;](https://example.com/path_(legacy)?v=1)',
      '[完成交付。](https://example.com/path_(legacy)?v=1)',
    ],
    [
      '[完成交付&nbsp;&#59;&rdquo;](https://example.com/path_(legacy)?v=1)',
      '[完成交付&nbsp;。&rdquo;](https://example.com/path_(legacy)?v=1)',
    ],
    [
      '参考 [查看 [项目]；](https://e.test/a_(b)?v=1)',
      '参考 [查看 [项目]。](https://e.test/a_(b)?v=1)',
    ],
    [
      '[**项目；**](https://example.com/path_(legacy)?v=1)',
      '[**项目。**](https://example.com/path_(legacy)?v=1)',
    ],
    [
      '[*项目；*](https://example.com/path_(legacy)?v=1)',
      '[*项目。*](https://example.com/path_(legacy)?v=1)',
    ],
    [
      '[<strong>项目；</strong>](https://example.com/path_(legacy)?v=1)',
      '[<strong>项目；</strong>](https://example.com/path_(legacy)?v=1)。',
    ],
    [
      '[项目；](https://e.test "a ) b")',
      '[项目。](https://e.test "a ) b")',
    ],
    [
      '[项目&#59;](https://e.test "a ( b")',
      '[项目。](https://e.test "a ( b")',
    ],
    ['[a;](https://x\u0085y)', '[a。](https://x\u0085y)'],
    ['[a;](https://x\u001cy)', '[a。](https://x\u001cy)'],
    ['[a;](https://x\u001fy)', '[a。](https://x\u001fy)'],
    ['[a;](https://x\uFEFFy)', '[a;](https://x\uFEFFy)。'],
    ['[a;](https://x\u00A0y)', '[a;](https://x\u00A0y)。'],
    ['[a;](https://x\u0085"title")', '[a。](https://x\u0085"title")'],
    ['[a;](https://x\uFEFF"title")', '[a。](https://x\uFEFF"title")'],
    ['[a;](https://x\u00A0"title")', '[a。](https://x\u00A0"title")'],
  ]) {
    assert.equal(normalizeResumeOptimizationActionParagraphEndings(input), expected, input);
    assert.equal(normalizeResumeOptimizationActionParagraphEndings(expected), expected, `${input}: idempotent`);
  }
});

test('action punctuation follows valid nested Markdown rendering inside trailing link labels', () => {
  for (const [input, expected] of [
    [
      '[*x;**y;***](https://e.test)',
      '[*x;**y。***](https://e.test)',
    ],
    [
      '[***x;***](https://e.test/a_(b)?v=1)',
      '[***x。***](https://e.test/a_(b)?v=1)',
    ],
    [
      '[__x;**y;**__](https://e.test "a ) b")',
      '[__x;**y。**__](https://e.test "a ) b")',
    ],
    [
      '[**x;__y;__**](https://e.test/path_(legacy)?v=1)',
      '[**x;__y。__**](https://e.test/path_(legacy)?v=1)',
    ],
    [
      '[*x;__y;**z;**__*](https://e.test/a_(b)?v=1)',
      '[*x;__y;**z。**__*](https://e.test/a_(b)?v=1)',
    ],
  ]) {
    assert.equal(normalizeResumeOptimizationActionParagraphEndings(input), expected, input);
    assert.equal(normalizeResumeOptimizationActionParagraphEndings(expected), expected, `${input}: idempotent`);
  }
});

test('invalid Markdown remains literal instead of rebinding punctuation across links or comments', () => {
  for (const [input, expected] of [
    ['[*x;**y;**](https://e.test)', '[*x;**y;**](https://e.test)。'],
    ['[**x;**y;***](https://e.test)', '[**x;**y;***](https://e.test)。'],
    ['[**x;*y;***](https://e.test)', '[**x;*y;***](https://e.test)。'],
    ['[__x;**y;**_](https://e.test)', '[__x;**y;**_](https://e.test)。'],
    [
      '[**x;**<!--c-->*](https://e.test)',
      '[**x;**<!--c-->*](https://e.test)。',
    ],
    [
      '[项目；<!--c-->x](https://e.test)',
      '[项目；<!--c-->x](https://e.test)。',
    ],
    ['**x;**<!--c-->*', '**x;**<!--c-->*。'],
  ]) {
    assert.equal(normalizeResumeOptimizationActionParagraphEndings(input), expected, input);
    assert.equal(normalizeResumeOptimizationActionParagraphEndings(expected), expected, `${input}: idempotent`);
  }
});

test('experience comparison uses the selected duplicate target candidate', () => {
  const base = {
    moduleType: 'experience_star',
    moduleId: 'experience-1',
    fieldPath: 'star.a',
    actionKind: 'rewrite_now',
    safetyStatus: 'allowed',
    beforeValue: '原始行动',
  };
  const comparison = buildResumeOptimizationExperienceComparisonMap([
    { ...base, changeId: 'first', targetedValue: '第一候选' },
    { ...base, changeId: 'second', targetedValue: '第二候选' },
  ], ['second']);

  assert.deepEqual(comparison.get('experience-1'), [{
    changeId: 'second',
    field: 'a',
    beforeValue: '原始行动',
    afterValue: '第二候选。',
    selected: true,
    readOnly: false,
  }]);
  assert.equal(
    buildResumeOptimizationExperienceComparisonMap([
      { ...base, changeId: 'first', targetedValue: '第一候选' },
      { ...base, changeId: 'second', targetedValue: '第二候选' },
    ], ['second', 'first']).get('experience-1')[0].changeId,
    'first',
  );
});

test('read-only experience comparison never falls back to an unaccepted candidate', () => {
  const base = {
    moduleType: 'experience_star',
    moduleId: 'experience-1',
    fieldPath: 'star.a',
    actionKind: 'rewrite_now',
    safetyStatus: 'allowed',
    beforeValue: '原始行动',
  };
  const changes = [
    { ...base, changeId: 'first', targetedValue: '第一候选' },
    { ...base, changeId: 'second', targetedValue: '第二候选' },
  ];

  assert.equal(buildResumeOptimizationExperienceComparisonMap(changes, [], true).size, 0);
  assert.equal(
    buildResumeOptimizationExperienceComparisonMap(changes, [], false)
      .get('experience-1')[0].changeId,
    'first',
  );
});

test('personal summary comparison maps only a safe changed candidate', () => {
  const base = {
    actionKind: 'rewrite_now',
    safetyStatus: 'allowed',
    moduleType: 'personal_summary',
    moduleId: 'current_resume',
    fieldPath: 'personal_summary',
    beforeValue: '原评价',
    targetedValue: '新评价',
  };
  const comparison = buildResumeOptimizationPersonalSummaryComparison([
    { ...base, changeId: 'blocked', safetyStatus: 'blocked' },
    { ...base, changeId: 'first', targetedValue: '第一版评价' },
    { ...base, changeId: 'second', targetedValue: '第二版评价' },
  ], ['second']);

  assert.deepEqual(comparison, {
    changeId: 'second',
    beforeValue: '原评价',
    afterValue: '第二版评价',
    selected: true,
    readOnly: false,
  });
  assert.equal(
    buildResumeOptimizationPersonalSummaryComparison([
      { ...base, changeId: 'first', targetedValue: '第一版评价' },
      { ...base, changeId: 'second', targetedValue: '第二版评价' },
    ], ['second', 'first']).changeId,
    'first',
  );
});

test('read-only personal summary comparison never falls back to an unaccepted candidate', () => {
  const changes = [{
    actionKind: 'rewrite_now',
    safetyStatus: 'allowed',
    moduleType: 'personal_summary',
    moduleId: 'current_resume',
    fieldPath: 'personal_summary',
    beforeValue: '原评价',
    targetedValue: '新评价',
    changeId: 'summary-change',
  }];

  assert.equal(buildResumeOptimizationPersonalSummaryComparison(changes, [], true), null);
  assert.equal(
    buildResumeOptimizationPersonalSummaryComparison(changes, [], false)?.changeId,
    'summary-change',
  );
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
  assert.equal(
    formatResumeOptimizationUserCopy('{"issueId":"ISS_PRIVATE","evidenceId":"E_PRIVATE"}', '安全降级'),
    '安全降级',
  );
  assert.equal(
    formatResumeOptimizationUserCopy('来自 masterExperienceId=private-id 的 runId=private-run', '安全降级'),
    '安全降级',
  );
});

test('safety findings preserve safe explanations and fail closed for missing or internal copy', () => {
  assert.deepEqual(
    buildResumeOptimizationSafetyFindingCopy(['改写会引入无法验证的业务结果']),
    ['改写会引入无法验证的业务结果'],
  );
  for (const findings of [
    [],
    ['请核对 /currentResume/experiences/private-id/star/a'],
    ['{"issueId":"ISS_PRIVATE","evidenceId":"E_PRIVATE"}'],
  ]) {
    assert.deepEqual(
      buildResumeOptimizationSafetyFindingCopy(findings),
      ['该项未通过自动安全规则，已保留原文。'],
    );
  }
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
    { value: 'other', label: '其他具体指标（请补充）' },
    { value: 'other-delivery', label: '其他具体交付产出（请补充）' },
  ]), [{
    label: '负责部分页面',
    draft: { state: 'answered', value: '负责部分页面' },
  }]);
});

test('diff values use targeted output, safe rich text, skill names, and static section labels', () => {
  const textPreview = buildResumeOptimizationChangePreview({
    moduleType: 'experience_star',
    fieldPath: 'star.a',
    beforeValue: '<b>原始行动</b><br>第二行',
    generalValue: '不得展示的通用稿',
    targetedValue: '<strong>定向行动</strong>',
  }, {});
  assert.deepEqual(textPreview, {
    before: ['原始行动', '第二行'],
    after: ['定向行动。'],
  });
  assert.doesNotMatch(JSON.stringify(textPreview), /不得展示的通用稿|<b>|<strong>/);

  assert.deepEqual(buildResumeOptimizationChangePreview({
    moduleType: 'experience_star',
    beforeValue: '{"issueId":"ISS_PRIVATE"}',
    targetedValue: '{"evidenceId":"E_PRIVATE"}',
  }, {}), {
    before: ['无内容'],
    after: ['无内容'],
  });

  const skillPreview = buildResumeOptimizationChangePreview({
    moduleType: 'skills_order',
    beforeValue: ['private-skill-a', 'private-skill-unknown'],
    generalValue: ['private-skill-unknown', 'private-skill-a'],
    targetedValue: ['private-skill-unknown', 'private-skill-a'],
  }, { 'private-skill-a': '用户研究' });
  assert.deepEqual(skillPreview, {
    before: ['用户研究', '未知技能'],
    after: ['未知技能', '用户研究'],
  });
  assert.doesNotMatch(JSON.stringify(skillPreview), /private-skill/);

  assert.deepEqual(buildResumeOptimizationChangePreview({
    moduleType: 'section_order',
    beforeValue: ['summary', 'work', 'private-section'],
    generalValue: ['work', 'summary', 'private-section'],
    targetedValue: ['work', 'summary', 'private-section'],
  }, {}), {
    before: ['个人评价', '工作经历', '其他模块'],
    after: ['工作经历', '个人评价', '其他模块'],
  });

  assert.deepEqual(buildResumeOptimizationChangePreview({
    moduleType: 'personal_summary',
    beforeValue: { secret: true },
    generalValue: null,
    targetedValue: null,
  }, {}), {
    before: ['内容暂不可预览'],
    after: ['保留原文'],
  });
});

test('bank navigation categories fail closed without echoing unknown server values', () => {
  assert.equal(resolveResumeOptimizationExperienceCategory('work'), 'work');
  assert.equal(resolveResumeOptimizationExperienceCategory('project'), 'project');
  assert.equal(resolveResumeOptimizationExperienceCategory('education'), 'education');
  assert.equal(resolveResumeOptimizationExperienceCategory('../../private'), undefined);
});
