import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('valid resume reports expose the restrained emerald optimization CTA', () => {
  const report = read('views/ResumeEditor/components/ResumeEvaluationReport/ResumeEvaluationReport.tsx');

  assert.match(report, /import \{[^}]*Wand2[^}]*\} from 'lucide-react'/s);
  assert.match(report, /根据报告优化/);
  assert.match(report, /data-resume-optimization-focus-return="true"/);
  assert.match(report, /isOptimizationEnabled && onStartOptimization/);
  assert.match(
    report,
    /disabled=\{isOutdated \|\| isOptimizationBusy \|\| !canStartOptimization\}/,
  );
  assert.match(report, /resolvedOptimizationDisabledReason/);
  assert.match(report, /\{resolvedOptimizationDisabledReason\}/);
  for (const className of [
    'inline-flex items-center justify-center gap-1.5',
    'rounded-lg',
    'bg-emerald-600',
    'px-3 py-2',
    'text-[11px] font-bold text-white',
    'shadow-sm',
    'hover:bg-emerald-700',
    'focus-visible:ring-2',
    'focus-visible:ring-emerald-500',
    'disabled:opacity-50',
  ]) {
    assert.ok(report.includes(className), `missing CTA class: ${className}`);
  }
  assert.match(report, /重新生成六维报告/);
  assert.ok(
    report.indexOf('根据报告优化') > report.indexOf('if (!report)'),
    'the optimization CTA must exist only in the valid-report branch',
  );
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
  assert.ok((editor.match(/onStartOptimization: resumeOptimizationFlow\.startOptimization/g) ?? []).length >= 2);
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
