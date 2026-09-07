import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'esbuild';
import { chromium } from 'playwright';

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

const loadWorkspaceStepResolver = async () => {
  const tempDir = mkdtempSync(join(rootDir, 'tests/.tmp-resume-optimization-workspace-'));
  const outputPath = join(tempDir, 'ResumeOptimizationWorkspace.mjs');
  try {
    await build({
      entryPoints: [join(rootDir, 'views/ResumeEditor/components/ResumeOptimization/ResumeOptimizationWorkspace.tsx')],
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
      resolveResumeOptimizationOverviewContinueStep: module.resolveResumeOptimizationOverviewContinueStep,
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

test('typing a quick-choice label preserves custom text through rerenders and question remounts', async (t) => {
  const candidates = [undefined, ...[
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ].filter(existsSync)];
  let browser;
  for (const executablePath of candidates) {
    try {
      browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
      break;
    } catch {
      // Use a system Chromium when the bundled runtime is unavailable.
    }
  }
  if (!browser) return t.skip('A Chromium runtime is required for the question typing regression.');
  t.after(() => browser.close());
  const context = await browser.newContext({ offline: true });
  await context.route('**/*', (route) => route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const result = await build({
    stdin: {
      contents: `
        import React, { useLayoutEffect, useState } from 'react';
        import { createRoot } from 'react-dom/client';
        import { ResumeOptimizationQuestions } from './views/ResumeEditor/components/ResumeOptimization/ResumeOptimizationQuestions';
        const question = ${JSON.stringify({ ...question(1), choices: [{ value: 'yes', label: 'Yes' }] })};
        function Harness() {
          const [draft, setDraft] = useState({ state: 'answered', value: '' });
          const [generation, setGeneration] = useState(0);
          const [persisted, setPersisted] = useState(false);
          useLayoutEffect(() => { window.mountedGeneration = generation; }, [generation]);
          window.currentDraft = draft;
          window.replaceDraft = setDraft;
          window.remountQuestion = () => setGeneration(value => value + 1);
          window.persistAnswer = () => setPersisted(true);
          return <ResumeOptimizationQuestions key={generation} questions={[question]}
            drafts={{ [question.questionId]: draft }}
            persistedAnswers={persisted ? [{ questionId: question.questionId, ...draft }] : []}
            disabled={false} submissionFrozen={false} error={null}
            onSetAnswer={(questionId, state, value, inputSource) => setDraft({ state, value, inputSource })}
            onSubmit={() => {}} />;
        }
        createRoot(document.getElementById('root')).render(<Harness />);
      `,
      resolveDir: rootDir,
      sourcefile: 'question-typing-harness.tsx',
      loader: 'tsx',
    },
    bundle: true,
    format: 'iife',
    platform: 'browser',
    write: false,
    logLevel: 'silent',
  });
  await page.setContent('<!doctype html><html><body><div id="root"></div></body></html>');
  await page.addScriptTag({ content: result.outputFiles[0].text });
  const answer = page.getByRole('textbox');
  const quick = page.getByRole('radio', { name: 'Yes', exact: true });
  const terminal = page.getByRole('radio', { name: '无法回答', exact: true });

  await answer.pressSequentially('Yes');
  assert.equal(await answer.inputValue(), 'Yes');
  assert.equal(await quick.isChecked(), false);
  assert.equal(await quick.isDisabled(), true);
  assert.equal(await terminal.isDisabled(), true);
  await page.evaluate(() => window.replaceDraft({ ...window.currentDraft }));
  await page.evaluate(() => window.remountQuestion());
  await page.waitForFunction(() => window.mountedGeneration === 1);
  assert.equal(await answer.inputValue(), 'Yes');
  await answer.press('ControlOrMeta+End');
  await answer.pressSequentially(', led weekly reviews');
  assert.equal(await answer.inputValue(), 'Yes, led weekly reviews');
  assert.equal(await page.evaluate(() => window.currentDraft.value), 'Yes, led weekly reviews');

  await answer.fill('');
  assert.equal(await quick.isDisabled(), false);
  await quick.check();
  assert.equal(await quick.isChecked(), true);
  assert.equal(await answer.inputValue(), '');
  await answer.pressSequentially('Yes');
  assert.equal(await answer.inputValue(), 'Yes');
  assert.equal(await quick.isChecked(), false);

  await answer.fill('');
  await terminal.check();
  assert.equal(await terminal.isChecked(), true);
  await answer.pressSequentially(' ');
  assert.equal(await answer.inputValue(), ' ');
  assert.equal(await terminal.isChecked(), false);
  assert.equal(await terminal.isDisabled(), false);
  assert.equal(await quick.isDisabled(), false);
  await quick.check();
  assert.equal(await answer.inputValue(), '');
  await answer.fill('Yes');
  await page.evaluate(() => window.persistAnswer());
  await page.waitForFunction(() => document.querySelector('textarea')?.disabled);
  assert.equal(await answer.inputValue(), 'Yes');
  assert.equal(await quick.isChecked(), false);
  assert.deepEqual(errors, []);
});

test('question components expose native one-page form semantics without raw pointers', () => {
  const questions = read('views/ResumeEditor/components/ResumeOptimization/ResumeOptimizationQuestions.tsx');
  const card = read('views/ResumeEditor/components/ResumeOptimization/ResumeOptimizationQuestionCard.tsx');

  assert.match(card, /useId\(\)/);
  assert.doesNotMatch(card, /explicitAnswerId|明确回答/);
  assert.match(card, /const quickChoiceId/);
  assert.match(card, /htmlFor=\{quickChoiceId\}/);
  assert.match(card, /<fieldset/);
  assert.match(card, /<legend className="sr-only">/);
  assert.match(card, /aria-hidden="true"[\s\S]*whitespace-normal[\s\S]*\[overflow-wrap:anywhere\]/);
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
    for (const text of ['为什么需要补充', '无法回答', '补充具体内容']) {
      assert.match(html, new RegExp(text));
    }
    for (const removedText of ['明确回答', '没有数据', '记不清', '不属于我的工作', '跳过']) {
      assert.doesNotMatch(html, new RegExp(removedText));
    }
    assert.doesNotMatch(html, /sm:grid-cols-2/);
    assert.match(html, /已保存，重试时不可修改/);
    assert.doesNotMatch(html, /private-question|private-change|\/currentResume\/private|\/private\/module/);
  } finally {
    cleanup();
  }
});

test('custom text and preset choices are mutually exclusive without a separate answer mode', async () => {
  const { ResumeOptimizationQuestions, cleanup } = await loadQuestions();
  try {
    const customQuestion = {
      ...question(1),
      choices: [
        { value: 'metric', label: '量化结果提升 30%' },
        { value: 'other', label: '其他具体指标（请补充）' },
        { value: 'other-delivery', label: '其他具体交付产出（请补充）' },
      ],
    };
    const customHtml = renderToStaticMarkup(React.createElement(ResumeOptimizationQuestions, {
      questions: [customQuestion],
      drafts: { [customQuestion.questionId]: { state: 'answered', value: '用户填写的可验证事实' } },
      persistedAnswers: [],
      disabled: false,
      submissionFrozen: false,
      error: null,
      onSetAnswer: () => undefined,
      onSubmit: () => undefined,
    }));

    assert.doesNotMatch(customHtml, /其他具体(?:指标|交付产出)/);
    assert.match(customHtml, />用户填写的可验证事实<\/textarea>/);
    assert.equal((customHtml.match(/type="radio"[^>]*disabled=""/g) ?? []).length, 2);
    assert.doesNotMatch(customHtml, /<textarea[^>]*disabled=""/);

    const terminalHtml = renderToStaticMarkup(React.createElement(ResumeOptimizationQuestions, {
      questions: [customQuestion],
      drafts: { [customQuestion.questionId]: { state: 'unknown', value: '' } },
      persistedAnswers: [],
      disabled: false,
      submissionFrozen: false,
      error: null,
      onSetAnswer: () => undefined,
      onSubmit: () => undefined,
    }));
    assert.match(terminalHtml, /type="radio"[^>]*checked=""[^>]*\/>无法回答/);
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
  assert.match(workspace, /setDisplayStep\(overviewContinueStep\)/);
  assert.match(workspace, /uiState === 'error'[\s\S]*run\?\.status === 'awaiting_answers'/);
  assert.match(workspace, /uiState !== 'stale'/);
  assert.match(workspace, /canRenderQuestions/);
  assert.match(workspace, /canEditQuestions/);
  assert.match(workspace, /disabled=\{!canEditQuestions/);
  assert.match(workspace, /form="resume-optimization-questions-form"/);
  assert.match(workspace, /const previousStep = useMemo/);
  assert.match(workspace, /onClick=\{handlePreviousStep\}/);
  assert.match(workspace, />\s*上一步\s*<\/button>/);
  assert.match(workspace, /\{isQuestionRetry \? '重试提交' : '下一步'\}/);
  assert.doesNotMatch(workspace, />\s*返回编辑器\s*<\/button>|提交并生成方案/);
  assert.doesNotMatch(workspace, /submitAnswers\(\[\]\)/);
  assert.match(workspace, /\[displayStep, isSidebarSurface, uiState\]/);
  assert.match(workspace, /!dialog\.contains\(document\.activeElement\)/);
  assert.match(rail, /<button/);
  assert.match(rail, /onStepSelect/);
  assert.match(rail, /availableSteps/);
});

test('answered preview-ready runs continue from overview to the plan instead of a read-only question dead end', async () => {
  const workspace = read('views/ResumeEditor/components/ResumeOptimization/ResumeOptimizationWorkspace.tsx');

  assert.match(workspace, /export const resolveResumeOptimizationOverviewContinueStep/);
  assert.match(workspace, /runStatus === 'preview_ready'[\s\S]*return 'preview'/);
  assert.match(workspace, /runStatus === 'awaiting_answers'[\s\S]*hasQuestions \? 'questions' : 'preview'/);
  assert.match(workspace, /areResumeOptimizationAnswersComplete\(plan\.questions, answerDrafts\)/);
  assert.match(workspace, /setDisplayStep\(overviewContinueStep\)/);
  assert.match(workspace, /canRenderQuestions[\s\S]*!canEditQuestions[\s\S]*run\?\.status === 'preview_ready'/);
  assert.match(workspace, />\s*查看优化方案\s*<\/button>/);

  const { resolveResumeOptimizationOverviewContinueStep, cleanup } = await loadWorkspaceStepResolver();
  try {
    assert.equal(
      resolveResumeOptimizationOverviewContinueStep('preview_ready', true, true),
      'preview',
    );
    assert.equal(
      resolveResumeOptimizationOverviewContinueStep('awaiting_answers', true, true),
      'questions',
    );
    assert.equal(
      resolveResumeOptimizationOverviewContinueStep('planning', true, false),
      'questions',
    );
  } finally {
    cleanup();
  }
});
