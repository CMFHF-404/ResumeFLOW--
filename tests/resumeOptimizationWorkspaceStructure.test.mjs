import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('workspace shell keeps the existing emerald slate language across desktop and mobile', () => {
  const workspace = read('views/ResumeEditor/components/ResumeOptimization/ResumeOptimizationWorkspace.tsx');
  const rail = read('views/ResumeEditor/components/ResumeOptimization/ResumeOptimizationStepRail.tsx');
  const progress = read('views/ResumeEditor/components/ResumeOptimization/ResumeOptimizationProgress.tsx');

  assert.match(workspace, /role="dialog"/);
  assert.match(workspace, /aria-modal="true"/);
  assert.match(workspace, /aria-labelledby="resume-optimization-workspace-title"/);
  assert.match(workspace, /id="resume-optimization-workspace-title"/);
  assert.match(workspace, /fixed inset-0 z-\[100\]/);
  assert.match(workspace, /max-w-6xl/);
  assert.match(workspace, /100dvh/);
  assert.match(workspace, /rounded-2xl/);
  assert.match(workspace, /w-\[220px\]/);
  assert.match(workspace, /sticky bottom-0/);
  assert.match(workspace, /min-h-\[44px\]/);
  assert.match(workspace, /safe-area-inset-bottom/);
  assert.match(workspace, /motion-reduce:transition-none/);
  assert.match(workspace, /ResumeOptimizationStepRail[\s\S]*variant="desktop"/);
  assert.match(workspace, /ResumeOptimizationStepRail[\s\S]*variant="mobile"/);
  assert.match(rail, /overflow-x-auto/);
  assert.match(rail, /aria-current=\{isActive \? 'step' : undefined\}/);
  assert.match(progress, /aria-live="polite"/);
  assert.match(progress, /motion-reduce:animate-none/);

  for (const label of ['优化方案', '补充信息', '对照确认', '优化结果']) {
    assert.match(rail, new RegExp(label));
  }
  assert.match(rail, /hasQuestions[\s\S]*filter/);
});

test('workspace focus, overlay, and close handling fail closed and restore exact state', () => {
  const workspace = read('views/ResumeEditor/components/ResumeOptimization/ResumeOptimizationWorkspace.tsx');

  assert.match(workspace, /tabIndex=\{-1\}/);
  assert.match(workspace, /headingRef\.current\?\.focus\(\)/);
  assert.match(workspace, /event\.key === 'Escape'/);
  assert.match(workspace, /event\.key !== 'Tab'/);
  assert.match(workspace, /event\.shiftKey/);
  assert.match(workspace, /event\.shiftKey[\s\S]*document\.activeElement === headingRef\.current/);
  assert.match(workspace, /event\.stopPropagation\(\)/);
  assert.match(workspace, /document\.addEventListener\('focusin'/);
  assert.match(workspace, /querySelectorAll<HTMLElement>/);
  assert.match(workspace, /element\.inert = true/);
  assert.match(workspace, /ariaHidden/);
  assert.match(workspace, /document\.body\.style\.overflow = 'hidden'/);
  assert.match(workspace, /document\.documentElement\.style\.overflow = 'hidden'/);
  assert.match(workspace, /document\.body\.style\.overflow = previousBodyOverflow/);
  assert.match(workspace, /document\.documentElement\.style\.overflow = previousHtmlOverflow/);
  assert.match(workspace, /querySelectorAll<HTMLElement>\('\[data-resume-optimization-focus-return\]:not\(\[disabled\]\)'\)/);
  assert.match(workspace, /isConnected/);
  assert.match(workspace, /getClientRects\(\)\.length > 0/);
  assert.match(workspace, /uiState === 'applying' \|\| uiState === 'rescoring'/);
  assert.match(workspace, /closeRequestInFlightRef/);
  assert.match(workspace, /event\.target === event\.currentTarget/);
  assert.match(workspace, /onMouseDown=\{\(event\) => event\.stopPropagation\(\)\}/);
});

test('workspace keeps stable steps and does not expose low-level source pointers', () => {
  const workspace = read('views/ResumeEditor/components/ResumeOptimization/ResumeOptimizationWorkspace.tsx');
  const rail = read('views/ResumeEditor/components/ResumeOptimization/ResumeOptimizationStepRail.tsx');
  const progress = read('views/ResumeEditor/components/ResumeOptimization/ResumeOptimizationProgress.tsx');
  const combined = `${workspace}\n${rail}\n${progress}`;

  assert.match(workspace, /resolveResumeOptimizationActiveStep/);
  assert.match(workspace, /type ResumeOptimizationFlowSlice = ReturnType<typeof useResumeOptimizationFlow>/);
  assert.match(workspace, /const \[displayStep, setDisplayStep\] = useState/);
  assert.match(workspace, /previousUiStateRef\.current === 'starting'/);
  assert.match(workspace, /activeStep=\{displayStep\}/);
  assert.match(workspace, /uiState === 'error' \|\| uiState === 'stale'/);
  assert.match(workspace, /run\?\.status/);
  for (const forbidden of ['fieldPath', 'sourceRefs', 'sourceSnapshotHash', 'requestId', '/currentResume']) {
    assert.doesNotMatch(combined, new RegExp(forbidden));
  }
  for (const action of [
    'answerDrafts', 'setAnswer', 'submitAnswers', 'acceptedChangeIds',
    'toggleChange', 'applyAcceptedChanges', 'retryRescore', 'revertRun',
  ]) {
    assert.match(workspace, new RegExp(action));
  }
});

test('editor closes report overlays before start and mounts one top-level workspace', () => {
  const editor = read('views/ResumeEditor/index.tsx');
  assert.match(editor, /import \{ ResumeOptimizationWorkspace \}/);
  const wrapper = editor.slice(
    editor.indexOf('const handleStartResumeOptimization'),
    editor.indexOf('const commitLayoutSnapshot', editor.indexOf('const handleStartResumeOptimization')),
  );
  const capture = wrapper.indexOf('document.activeElement');
  const close = wrapper.indexOf('setIsJDAnalysisDetailsSidebarOpen(false)');
  const nextFrame = wrapper.indexOf('requestAnimationFrame');
  const start = wrapper.indexOf('startOptimization');
  assert.ok(capture >= 0 && capture < close && close < nextFrame && nextFrame < start);
  assert.match(editor, /onStartOptimization: handleStartResumeOptimization/g);
  assert.match(editor, /resumeOptimizationFlow\.uiState !== 'closed'/);
  assert.match(editor, /onRequestClose=\{handleCloseResumeOptimization\}/);
  assert.match(editor, /returnFocusRef=\{resumeOptimizationReturnFocusRef\}/);
  assert.match(editor, /<ResumeOptimizationWorkspace[\s\S]*\{\.\.\.resumeOptimizationFlow\}/);
});

test('CTA-owned workspace close remounts the report before focus restoration and never opens it for hydration', () => {
  const editor = read('views/ResumeEditor/index.tsx');
  assert.match(editor, /const resumeOptimizationShouldRestoreReportRef = useRef\(false\)/);

  const startWrapper = editor.slice(
    editor.indexOf('const handleStartResumeOptimization'),
    editor.indexOf('const commitLayoutSnapshot', editor.indexOf('const handleStartResumeOptimization')),
  );
  const markOrigin = startWrapper.indexOf('resumeOptimizationShouldRestoreReportRef.current = true');
  const closeReport = startWrapper.indexOf('setIsJDAnalysisDetailsSidebarOpen(false)');
  const startRequest = startWrapper.indexOf('startOptimization');
  assert.ok(markOrigin >= 0 && markOrigin < closeReport && closeReport < startRequest);

  const closeWrapperStart = editor.indexOf('const handleCloseResumeOptimization');
  const closeWrapper = editor.slice(closeWrapperStart, editor.indexOf('const commitLayoutSnapshot', closeWrapperStart));
  const awaitClose = closeWrapper.indexOf('await resumeOptimizationFlow.closeWorkspace()');
  const rejectedGuard = closeWrapper.indexOf('if (!didClose) return false');
  const originGuard = closeWrapper.indexOf('resumeOptimizationShouldRestoreReportRef.current');
  const reopenReport = closeWrapper.indexOf('setIsJDAnalysisDetailsSidebarOpen(true)');
  const clearOrigin = closeWrapper.indexOf('resumeOptimizationShouldRestoreReportRef.current = false');
  assert.ok(
    awaitClose >= 0
      && awaitClose < rejectedGuard
      && rejectedGuard < originGuard
      && originGuard < reopenReport
      && reopenReport < clearOrigin,
  );
  assert.match(editor, /onRequestClose=\{handleCloseResumeOptimization\}/);
  assert.match(
    editor,
    /if \(resumeOptimizationFlow\.uiState === 'closed'\) \{\s*resumeOptimizationShouldRestoreReportRef\.current = false;/,
  );
  assert.doesNotMatch(closeWrapper, /setIsJDAnalysisDetailsSidebarOpen\(true\)[\s\S]*if \(resumeOptimizationShouldRestoreReportRef\.current\)/);
});
