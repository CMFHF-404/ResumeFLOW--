import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('optimization workspace is a labelled modal with a keyboard-visible close control', () => {
  const workspace = read('views/ResumeEditor/components/ResumeOptimization/ResumeOptimizationWorkspace.tsx');

  assert.match(workspace, /role="dialog"/);
  assert.match(workspace, /aria-modal="true"/);
  assert.match(workspace, /aria-labelledby="resume-optimization-workspace-title"/);
  assert.match(workspace, /id="resume-optimization-workspace-title"/);
  assert.match(workspace, /id="resume-optimization-workspace-title"[\s\S]*tabIndex=\{-1\}/);
  assert.match(workspace, /aria-label="关闭简历优化工作区"/);
  assert.match(workspace, /aria-label="关闭简历优化工作区"[\s\S]*min-h-\[44px\][\s\S]*min-w-\[44px\]/);
  assert.match(workspace, /aria-label="关闭简历优化工作区"[\s\S]*focus-visible:ring-2/);
  assert.match(workspace, /event\.key === 'Escape'/);
  assert.match(workspace, /event\.key !== 'Tab'/);
  assert.match(workspace, /event\.shiftKey/);
});

test('workspace moves focus on open, traps it, and restores the saved or CTA target on close', () => {
  const workspace = read('views/ResumeEditor/components/ResumeOptimization/ResumeOptimizationWorkspace.tsx');

  assert.match(workspace, /window\.requestAnimationFrame\(\(\) => headingRef\.current\?\.focus\(\)\)/);
  assert.match(workspace, /dialog && !dialog\.contains\(document\.activeElement\)[\s\S]*headingRef\.current\?\.focus\(\)/);
  assert.match(workspace, /document\.addEventListener\('focusin', handleExternalFocus\)/);
  assert.match(workspace, /document\.removeEventListener\('focusin', handleExternalFocus\)/);
  assert.match(workspace, /document\.activeElement === firstFocusable/);
  assert.match(workspace, /document\.activeElement === lastFocusable/);
  assert.match(workspace, /lastFocusable\.focus\(\)/);
  assert.match(workspace, /firstFocusable\.focus\(\)/);
  assert.match(workspace, /const savedReturnFocus = returnFocusRef\.current/);
  assert.match(workspace, /\[data-resume-optimization-focus-return\]:not\(\[disabled\]\)/);
  assert.match(workspace, /savedReturnFocus && isVisibleFocusable\(savedReturnFocus\)/);
  assert.match(workspace, /returnTarget\?\.focus\(\)/);
  assert.match(workspace, /suppressReturnFocusRef\.current/);
});

test('closed preview return controls are valid focus-restoration targets', () => {
  const experienceTab = read('views/ResumeEditor/components/ExperienceTab.tsx');
  const mobileHeader = read('views/ResumeEditor/components/MobileEditorHeader.tsx');

  for (const source of [experienceTab, mobileHeader]) {
    assert.match(
      source,
      /data-resume-optimization-focus-return="true"[\s\S]*返回优化方案|返回优化方案[\s\S]*data-resume-optimization-focus-return="true"/,
    );
  }
});

test('workspace restores sibling accessibility and document scrolling exactly', () => {
  const workspace = read('views/ResumeEditor/components/ResumeOptimization/ResumeOptimizationWorkspace.tsx');

  assert.match(workspace, /const siblingStates = siblings\.map/);
  assert.match(workspace, /inert: element\.inert/);
  assert.match(workspace, /ariaHidden: element\.getAttribute\('aria-hidden'\)/);
  assert.match(workspace, /element\.inert = true/);
  assert.match(workspace, /element\.setAttribute\('aria-hidden', 'true'\)/);
  assert.match(workspace, /element\.inert = inert/);
  assert.match(workspace, /if \(ariaHidden === null\) element\.removeAttribute\('aria-hidden'\)/);
  assert.match(workspace, /else element\.setAttribute\('aria-hidden', ariaHidden\)/);
  assert.match(workspace, /const previousBodyOverflow = document\.body\.style\.overflow/);
  assert.match(workspace, /const previousHtmlOverflow = document\.documentElement\.style\.overflow/);
  assert.match(workspace, /document\.body\.style\.overflow = 'hidden'/);
  assert.match(workspace, /document\.documentElement\.style\.overflow = 'hidden'/);
  assert.match(workspace, /document\.body\.style\.overflow = previousBodyOverflow/);
  assert.match(workspace, /document\.documentElement\.style\.overflow = previousHtmlOverflow/);
});

test('progress changes use an atomic status live region and honor reduced motion', () => {
  const progress = read('views/ResumeEditor/components/ResumeOptimization/ResumeOptimizationProgress.tsx');

  assert.match(progress, /role="status"/);
  assert.match(progress, /aria-live="polite"/);
  assert.match(progress, /aria-atomic="true"/);
  assert.match(progress, /motion-reduce:animate-none/);
});

test('question choices keep native keyboard semantics, labels, and readable context', () => {
  const questions = read('views/ResumeEditor/components/ResumeOptimization/ResumeOptimizationQuestions.tsx');
  const card = read('views/ResumeEditor/components/ResumeOptimization/ResumeOptimizationQuestionCard.tsx');
  const combined = `${questions}\n${card}`;

  assert.match(card, /<fieldset/);
  assert.match(card, /<legend/);
  assert.match(card, /type="radio"/);
  assert.match(card, /htmlFor=\{explicitAnswerId\}/);
  assert.match(card, /htmlFor=\{quickChoiceId\}/);
  assert.match(card, /htmlFor=\{terminalChoiceId\}/);
  assert.match(card, /aria-describedby=\{reasonId\}/);
  assert.match(card, /min-h-\[44px\]/);
  assert.match(card, /focus-within:ring-2/);
  assert.match(card, /focus-within:ring-emerald-500/);
  assert.match(questions, /aria-live="polite"/);
  assert.doesNotMatch(combined, /<(?:div|span)[^>]*role="button"/);
  assert.doesNotMatch(combined, /<(?:div|span)[^>]*onClick=/);
});

test('each question keeps one radio group and explicitly relates its textarea and reason', () => {
  const card = read('views/ResumeEditor/components/ResumeOptimization/ResumeOptimizationQuestionCard.tsx');

  assert.match(card, /const reasonId = `\$\{instanceId\}-reason`/);
  assert.match(card, /const textareaId = `\$\{instanceId\}-answer`/);
  assert.match(card, /const groupName = `\$\{instanceId\}-answer-mode`/);
  assert.ok((card.match(/name=\{groupName\}/g) ?? []).length >= 3);
  assert.match(card, /<p id=\{reasonId\}/);
  assert.match(card, /<label htmlFor=\{textareaId\}/);
  assert.match(card, /<textarea[\s\S]*id=\{textareaId\}/);
  assert.match(card, /<textarea[\s\S]*aria-describedby=\{reasonId\}/);
  assert.match(card, /disabled=\{controlsDisabled \|\| draft\.state !== 'answered'\}/);
});

test('reached-step navigation and mobile primary actions remain real 44px controls', () => {
  const workspace = read('views/ResumeEditor/components/ResumeOptimization/ResumeOptimizationWorkspace.tsx');
  const rail = read('views/ResumeEditor/components/ResumeOptimization/ResumeOptimizationStepRail.tsx');

  assert.match(rail, /<nav aria-label="简历优化步骤"/);
  assert.match(rail, /<button[\s\S]*type="button"/);
  assert.match(rail, /aria-current=\{isActive \? 'step' : undefined\}/);
  assert.match(rail, /min-h-\[44px\]/);
  assert.match(rail, /focus-visible:ring-2/);
  assert.match(rail, /motion-reduce:transition-none/);
  assert.match(workspace, /sticky bottom-0[\s\S]*min-h-\[44px\]/);
  assert.match(workspace, /sticky bottom-0[\s\S]*focus-visible:ring-2/);
  assert.match(workspace, /safe-area-inset-bottom/);
  assert.match(workspace, /motion-reduce:transition-none/);
});

test('mutation and navigation actions use native controls while backdrop close stays supplemental', () => {
  const workspace = read('views/ResumeEditor/components/ResumeOptimization/ResumeOptimizationWorkspace.tsx');
  const card = read('views/ResumeEditor/components/ResumeOptimization/ResumeOptimizationDiffCard.tsx');
  const bank = read('views/ResumeEditor/components/ResumeOptimization/ResumeOptimizationBankSuggestions.tsx');
  const actionSurfaces = `${card}\n${bank}`;

  assert.match(card, /type="checkbox"/);
  assert.match(card, /<label[\s\S]*<input/);
  assert.match(bank, /<button[\s\S]*查看经历/);
  assert.match(bank, /<button[\s\S]*前往一键组装/);
  assert.doesNotMatch(actionSurfaces, /<(?:div|span)[^>]*(?:onClick=|role="button")/);
  assert.match(workspace, /event\.target === event\.currentTarget/);
  assert.match(workspace, /aria-label="关闭简历优化工作区"/);
  assert.match(workspace, /event\.key === 'Escape'/);
  assert.match(workspace, />\s*返回编辑器\s*<\/button>/);
});

test('stale, oversized-question, and read-only states cannot expose a mutation action', () => {
  const workspace = read('views/ResumeEditor/components/ResumeOptimization/ResumeOptimizationWorkspace.tsx');
  const questions = read('views/ResumeEditor/components/ResumeOptimization/ResumeOptimizationQuestions.tsx');
  const card = read('views/ResumeEditor/components/ResumeOptimization/ResumeOptimizationDiffCard.tsx');
  const bank = read('views/ResumeEditor/components/ResumeOptimization/ResumeOptimizationBankSuggestions.tsx');

  const invalidQuestionBranch = questions.slice(
    questions.indexOf('if (!isQuestionSetValid)'),
    questions.indexOf('const handleSubmit'),
  );
  assert.match(questions, /questions\.length > 0 && questions\.length <= 5/);
  assert.match(invalidQuestionBranch, /问题数据异常/);
  assert.doesNotMatch(invalidQuestionBranch, /<form/);
  assert.match(workspace, /canRenderQuestions[\s\S]*uiState !== 'stale'/);
  assert.match(workspace, /displayStep === 'preview'[\s\S]*uiState !== 'stale'/);
  assert.match(workspace, /readOnly=\{run\?\.status !== 'preview_ready'\}/);
  assert.match(workspace, /displayStep === 'preview' && run\?\.status === 'preview_ready' && uiState !== 'stale'/);
  assert.match(card, /const selectable = changeSelectable && !readOnly/);
  assert.match(card, /disabled=\{!selectable\}/);
  assert.doesNotMatch(bank, /type="checkbox"|acceptedChangeIds|onToggleChange/);
});
