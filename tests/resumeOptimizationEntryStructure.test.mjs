import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('only current numeric reports expose a selected-module optimization CTA', () => {
  const report = read('views/ResumeEditor/components/ResumeEvaluationReport/ResumeEvaluationReport.tsx');
  const current = read('views/ResumeEditor/components/ResumeEvaluationReport/ResumeScoreReport.tsx');
  assert.match(report, /if \(numericReport\) return <ResumeScoreReport/);
  assert.match(current, /优化所选模块/);
  assert.match(current, /disabled=\{outdated \|\| busy \|\| generating \|\| !canStart \|\| annotations.selected.length === 0\}/);
  assert.match(current, /onStart\(annotations.selected\)/);
  assert.doesNotMatch(report, /根据指导优化|trackResumeOptimizationCtaClick/);
  assert.match(report, /查看历史文字指导（无数值评分）/);
});

test('optimization props traverse report, details content, sidebar, modal, and panel', () => {
  const panel = read('views/ResumeEditor/components/JDAnalysisPanel.tsx');
  const names = [
    'isOptimizationEnabled',
    'isOptimizationBusy',
    'canStartOptimization',
    'optimizationDisabledReason',
    'onStartOptimization',
  ];

  for (const name of names) {
    const occurrences = panel.split(name).length - 1;
    assert.ok(occurrences >= 10, `${name} must traverse both sidebar and modal paths`);
  }

  const reportCall = panel.slice(
    panel.indexOf('<ResumeEvaluationReport'),
    panel.indexOf('/>', panel.indexOf('<ResumeEvaluationReport')),
  );
  for (const name of names) assert.match(reportCall, new RegExp(`${name}=\\{${name}\\}`));

  assert.match(panel, /<JDAnalysisDetailsContent[\s\S]*onStartOptimization=\{onStartOptimization\}/);
  assert.match(panel, /<JDAnalysisDetailsModal[\s\S]*onStartOptimization=\{onStartOptimization\}/);
});

test('editor uses the exact Vite flag while always calling the gated flow hook', () => {
  const editor = read('views/ResumeEditor/index.tsx');
  const envExample = read('.env.example');
  const backendEnvExample = read('backend/.env.example');
  const viteTypes = read('vite-env.d.ts');

  assert.match(
    editor,
    /const RESUME_OPTIMIZATION_ENABLED = import\.meta\.env\.VITE_ENABLE_RESUME_OPTIMIZATION === 'true';/,
  );
  assert.match(editor, /const resumeOptimizationFlow = useResumeOptimizationFlow\(\{/);
  assert.match(editor, /enabled: RESUME_OPTIMIZATION_ENABLED/);
  assert.doesNotMatch(editor, /if \([^)]*RESUME_OPTIMIZATION_ENABLED[^)]*\)[\s\S]{0,80}useResumeOptimizationFlow/);
  assert.ok((editor.match(/isOptimizationEnabled: RESUME_OPTIMIZATION_ENABLED/g) ?? []).length >= 2);
  assert.ok((editor.match(/onStartOptimization: handleStartResumeOptimization/g) ?? []).length >= 2);
  assert.ok((editor.match(/canStartOptimization: resumeOptimizationFlow\.canStart/g) ?? []).length >= 2);
  assert.ok((editor.match(/optimizationDisabledReason: resumeOptimizationFlow\.disabledReason/g) ?? []).length >= 2);
  assert.match(editor, /const isResumeOptimizationBusy =/);
  assert.ok((editor.match(/isOptimizationBusy: isResumeOptimizationBusy/g) ?? []).length >= 2);

  assert.match(envExample, /^VITE_ENABLE_RESUME_OPTIMIZATION=false$/m);
  assert.match(backendEnvExample, /^ENABLE_RESUME_OPTIMIZATION=false$/m);
  assert.match(backendEnvExample, /^RESUME_OPTIMIZATION_MAX_QUESTIONS=5$/m);
  assert.match(backendEnvExample, /^RESUME_OPTIMIZATION_MAX_BANK_SUGGESTIONS=3$/m);
  assert.match(viteTypes, /readonly VITE_ENABLE_RESUME_OPTIMIZATION: string/);
});

test('editor keeps the optimization toast port stable while the gated hook is disabled', () => {
  const editor = read('views/ResumeEditor/index.tsx');
  const toastMemoStart = editor.indexOf('const resumeOptimizationToast = useMemo');
  const flowStart = editor.indexOf('const resumeOptimizationFlow = useResumeOptimizationFlow');
  const flowEnd = editor.indexOf('const isResumeOptimizationBusy', flowStart);

  assert.ok(toastMemoStart >= 0 && toastMemoStart < flowStart);
  assert.match(
    editor.slice(toastMemoStart, flowStart),
    /useMemo\(\(\) => \(\{[\s\S]*success: showToastSuccess,[\s\S]*error: showToastError,[\s\S]*info: showToastInfo,[\s\S]*\}\), \[showToastError, showToastInfo, showToastSuccess\]\)/,
  );

  const flowCall = editor.slice(flowStart, flowEnd);
  assert.match(flowCall, /toast: resumeOptimizationToast/);
  assert.doesNotMatch(flowCall, /toast:\s*\{/);
});
