import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'esbuild';

const rootDir = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const read = (path) => readFileSync(join(rootDir, path), 'utf8');

const loadQuestions = async () => {
  const tempDir = mkdtempSync(join(rootDir, 'tests/.tmp-resume-optimization-questions-'));
  const outputPath = join(tempDir, 'ResumeOptimizationQuestions.mjs');
  try {
    await build({
      entryPoints: [join(rootDir, 'views/ResumeEditor/components/ResumeOptimization/ResumeOptimizationQuestions.tsx')],
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'node20',
      outfile: outputPath,
      external: ['react', 'react/jsx-runtime', 'lucide-react'],
      logLevel: 'silent',
    });
    const module = await import(`${pathToFileURL(outputPath).href}?${Math.random()}`);
    return {
      ResumeOptimizationQuestions: module.ResumeOptimizationQuestions,
      cleanup: () => rmSync(tempDir, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(tempDir, { recursive: true, force: true });
    throw error;
  }
};

const question = (index) => ({
  questionId: `private-question-${index}`,
  moduleId: `/private/module/${index}`,
  fieldPath: `/currentResume/private/${index}`,
  text: `第 ${index} 个证据问题`,
  reason: `需要确认第 ${index} 项事实`,
  answerType: 'single_choice_with_text',
  choices: [
    { value: `opaque-${index}`, label: `快捷事实 ${index}` },
    { value: 'not_my_work', label: '不属于我的工作' },
  ],
  affectsChangeIds: [`private-change-${index}`],
  priority: index,
});

test('question components expose native one-page form semantics without raw pointers', () => {
  const questions = read('views/ResumeEditor/components/ResumeOptimization/ResumeOptimizationQuestions.tsx');
  const card = read('views/ResumeEditor/components/ResumeOptimization/ResumeOptimizationQuestionCard.tsx');

  assert.match(card, /useId\(\)/);
  assert.match(card, /const explicitAnswerId/);
  assert.match(card, /id=\{explicitAnswerId\}/);
  assert.match(card, /htmlFor=\{explicitAnswerId\}/);
  assert.match(card, /const quickChoiceId/);
  assert.match(card, /htmlFor=\{quickChoiceId\}/);
  assert.match(card, /<fieldset/);
  assert.match(card, /<legend/);
  assert.match(card, /aria-describedby=\{reasonId\}/);
  assert.match(card, /<textarea/);
  assert.match(card, /htmlFor=/);
  assert.match(questions, /id="resume-optimization-questions-form"/);
  assert.match(questions, /aria-live="polite"/);
  assert.match(questions, /areResumeOptimizationAnswersComplete/);
  assert.match(questions, /role="alert"/);
  assert.doesNotMatch(`${questions}\n${card}`, /dangerouslySetInnerHTML/);
  for (const privateField of ['fieldPath', 'moduleId', 'affectsChangeIds']) {
    assert.doesNotMatch(card, new RegExp(privateField));
  }
});

test('one page renders all five questions, locks persisted answers, and hides private IDs', async () => {
  const { ResumeOptimizationQuestions, cleanup } = await loadQuestions();
  try {
    const questions = Array.from({ length: 5 }, (_, index) => question(index + 1));
    const drafts = Object.fromEntries(questions.map((item, index) => [item.questionId, {
      state: index === 1 ? 'unknown' : 'answered',
      value: index === 1 ? '' : `回答 ${index + 1}`,
    }]));
    const html = renderToStaticMarkup(React.createElement(ResumeOptimizationQuestions, {
      questions,
      drafts,
      persistedAnswers: [{ questionId: questions[0].questionId, state: 'answered', value: '服务端回答' }],
      disabled: false,
      submissionFrozen: false,
      error: null,
      onSetAnswer: () => undefined,
      onSubmit: () => undefined,
    }));

    assert.equal((html.match(/<fieldset/g) ?? []).length, 5);
    for (const text of ['为什么需要补充', '明确回答', '没有数据', '记不清', '不属于我的工作', '跳过']) {
      assert.match(html, new RegExp(text));
    }
    assert.match(html, /已保存，重试时不可修改/);
    assert.doesNotMatch(html, /private-question|private-change|\/currentResume\/private|\/private\/module/);
  } finally {
    cleanup();
  }
});

test('model-authored question copy fails closed instead of exposing internal pointers', async () => {
  const { ResumeOptimizationQuestions, cleanup } = await loadQuestions();
  try {
    const unsafeQuestion = {
      ...question(1),
      text: '请核对 /currentResume/experiences/private-id/star/a',
      reason: '该内容来自 selectedSourceExperiences/private-id',
      choices: [{ value: 'opaque', label: '使用 fieldPath=star.a' }],
    };
    const html = renderToStaticMarkup(React.createElement(ResumeOptimizationQuestions, {
      questions: [unsafeQuestion],
      drafts: { [unsafeQuestion.questionId]: { state: 'answered', value: '用户确认事实' } },
      persistedAnswers: [],
      disabled: false,
      submissionFrozen: false,
      error: null,
      onSetAnswer: () => undefined,
      onSubmit: () => undefined,
    }));

    assert.doesNotMatch(html, /currentResume|selectedSourceExperiences|fieldPath|private-id|star\.a/);
    assert.match(html, /请补充可确认的相关事实/);
    assert.match(html, /这有助于在不补造信息的前提下完成优化/);
  } finally {
    cleanup();
  }
});

test('zero and oversized question sets fail closed without an empty submission', async () => {
  const { ResumeOptimizationQuestions, cleanup } = await loadQuestions();
  try {
    const sharedProps = {
      drafts: {},
      persistedAnswers: [],
      disabled: false,
      submissionFrozen: false,
      error: null,
      onSetAnswer: () => undefined,
      onSubmit: () => {
        throw new Error('invalid question sets must never submit');
      },
    };
    assert.equal(renderToStaticMarkup(React.createElement(ResumeOptimizationQuestions, {
      ...sharedProps,
      questions: [],
    })), '');

    const oversizedHtml = renderToStaticMarkup(React.createElement(ResumeOptimizationQuestions, {
      ...sharedProps,
      questions: Array.from({ length: 6 }, (_, index) => question(index + 1)),
    }));
    assert.equal((oversizedHtml.match(/<fieldset/g) ?? []).length, 5);
    assert.match(oversizedHtml, /role="alert"/);
    assert.match(oversizedHtml, /问题数据异常/);
    assert.doesNotMatch(oversizedHtml, /<form/);
  } finally {
    cleanup();
  }
});

test('workspace wires overview, questions, retry, no-question skip, and reached-step navigation', () => {
  const workspace = read('views/ResumeEditor/components/ResumeOptimization/ResumeOptimizationWorkspace.tsx');
  const rail = read('views/ResumeEditor/components/ResumeOptimization/ResumeOptimizationStepRail.tsx');

  assert.match(workspace, /ResumeOptimizationOverview/);
  assert.match(workspace, /ResumeOptimizationQuestions/);
  assert.match(workspace, /displayStep === 'overview'/);
  assert.match(workspace, /setDisplayStep\(hasQuestions \? 'questions' : 'preview'\)/);
  assert.match(workspace, /uiState === 'error'[\s\S]*run\?\.status === 'awaiting_answers'/);
  assert.match(workspace, /uiState !== 'stale'/);
  assert.match(workspace, /canRenderQuestions/);
  assert.match(workspace, /canEditQuestions/);
  assert.match(workspace, /disabled=\{!canEditQuestions/);
  assert.match(workspace, /form="resume-optimization-questions-form"/);
  assert.doesNotMatch(workspace, /submitAnswers\(\[\]\)/);
  assert.match(workspace, /\[displayStep, uiState\]/);
  assert.match(workspace, /!dialog\.contains\(document\.activeElement\)/);
  assert.match(rail, /<button/);
  assert.match(rail, /onStepSelect/);
  assert.match(rail, /availableSteps/);
});
