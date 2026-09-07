import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('workspace shell keeps the existing emerald slate language across desktop and mobile', () => {
  const workspace = read('views/ResumeEditor/components/ResumeOptimization/ResumeOptimizationWorkspace.tsx');
  const rail = read('views/ResumeEditor/components/ResumeOptimization/ResumeOptimizationStepRail.tsx');
  const progress = read('views/ResumeEditor/components/ResumeOptimization/ResumeOptimizationProgress.tsx');

  assert.match(workspace, /role=\{isSidebarSurface \? 'region' : 'dialog'\}/);
  assert.match(workspace, /aria-modal=\{isSidebarSurface \? undefined : true\}/);
  assert.match(workspace, /aria-labelledby="resume-optimization-workspace-title"/);
  assert.match(workspace, /id="resume-optimization-workspace-title"/);
  assert.match(workspace, /fixed inset-0 z-\[100\]/);
  assert.match(workspace, /max-w-6xl/);
  assert.match(workspace, /100dvh/);
  assert.match(workspace, /rounded-2xl/);
  assert.match(workspace, /w-\[220px\]/);
  assert.match(workspace, /sticky bottom-0/);
  assert.doesNotMatch(workspace, /可随时返回，未应用的方案会保留/);
  assert.match(workspace, /\{footerStatus \? \([\s\S]*?\) : null\}/);
  assert.match(workspace, /min-h-\[44px\]/);
  assert.match(workspace, /safe-area-inset-bottom/);
  assert.match(workspace, /motion-reduce:transition-none/);
  assert.match(workspace, /ResumeOptimizationStepRail[\s\S]*variant=\{isSidebarSurface \? 'mobile' : 'desktop'\}/);
  assert.match(workspace, /ResumeOptimizationStepRail[\s\S]*variant="mobile"/);
  assert.doesNotMatch(rail, /overflow-x-auto|min-w-max/);
  assert.match(rail, /gridTemplateColumns: `repeat\(\$\{steps\.length\}, minmax\(0, 1fr\)\)`/);
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
  assert.match(
    workspace,
    /\['applying', 'applied', 'rescoring', 'completed', 'reverted', 'cancelled'\]\.includes\(status \?\? ''\)[\s\S]*return 'result'/,
  );
  assert.match(
    workspace,
    /displayStep === 'result' && run && \['applied', 'completed'\]\.includes\(run\.status\)[\s\S]*<ResumeOptimizationResult[\s\S]*onRetry=\{\(\) => void retryRescore\(\)\}[\s\S]*onRevert=\{\(\) => void revertRun\(\)\}/,
  );
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

test('failed planning runs render the error placeholder instead of an empty plan', () => {
  const workspace = read('views/ResumeEditor/components/ResumeOptimization/ResumeOptimizationWorkspace.tsx');
  assert.match(
    workspace,
    /const hasRenderablePlan = Boolean\(plan && run\?\.status !== 'failed'\)/,
  );
  assert.match(
    workspace,
    /displayStep === 'overview' && hasRenderablePlan && plan/,
  );
  assert.match(
    workspace,
    /displayStep === 'overview' && hasRenderablePlan && plan && uiState !== 'stale'/,
  );
});

test('editor moves optimization into the AI layout and keeps mobile modal compatibility', () => {
  const editor = read('views/ResumeEditor/index.tsx');
  assert.match(
    editor,
    /const ResumeOptimizationWorkspace = React\.lazy\(async \(\) => \{[\s\S]*import\('\.\/components\/ResumeOptimization\/ResumeOptimizationWorkspace'\)/,
  );
  assert.doesNotMatch(
    editor,
    /import \{ ResumeOptimizationWorkspace \} from '\.\/components\/ResumeOptimization\/ResumeOptimizationWorkspace'/,
  );
  const wrapper = editor.slice(
    editor.indexOf('const handleStartResumeOptimization'),
    editor.indexOf('const commitLayoutSnapshot', editor.indexOf('const handleStartResumeOptimization')),
  );
  const capture = wrapper.indexOf('document.activeElement');
  const openOptimization = wrapper.indexOf("setRightSidebarSurface('optimization')");
  const setAiLayout = wrapper.indexOf("setWorkspaceLayout('ai')");
  const nextFrame = wrapper.indexOf('requestAnimationFrame');
  const start = wrapper.indexOf('startOptimization');
  const startResultBlock = wrapper.slice(
    wrapper.indexOf('const startedRun = await resumeOptimizationFlow.startOptimization()'),
    wrapper.indexOf('return startedRun;') + 'return startedRun;'.length,
  );
  assert.ok(capture >= 0 && capture < setAiLayout && setAiLayout < openOptimization && openOptimization < nextFrame && nextFrame < start);
  assert.match(startResultBlock, /resumeOptimizationFlow\.getLatestUiState\(\) === 'closed'/);
  assert.doesNotMatch(startResultBlock, /resumeOptimizationFlow\.uiState/);
  const flow = read('views/ResumeEditor/hooks/useResumeOptimizationFlow.ts');
  assert.match(flow, /const latestUiStateRef = useRef<ResumeOptimizationUiState>\('closed'\)/);
  assert.match(flow, /latestUiStateRef\.current = nextState/);
  assert.match(flow, /const getLatestUiState = useCallback\(\(\) => latestUiStateRef\.current, \[\]\)/);
  const reopenBlock = wrapper.slice(
    wrapper.indexOf('hasResumableResumeOptimizationRun'),
    wrapper.indexOf('const startedRun = await resumeOptimizationFlow.startOptimization()'),
  );
  assert.match(reopenBlock, /const reopenedRun = await resumeOptimizationFlow\.reopenLatestRun\(\)/);
  assert.match(reopenBlock, /!reopenedRun && resumeOptimizationFlow\.getLatestUiState\(\) === 'closed'/);
  assert.match(editor, /onStartOptimization: handleStartResumeOptimization/g);
  assert.match(editor, /resumeOptimizationFlow\.uiState !== 'closed'/);
  assert.match(editor, /onRequestClose=\{handleCloseResumeOptimization\}/);
  assert.match(editor, /returnFocusRef=\{resumeOptimizationReturnFocusRef\}/);
  assert.match(editor, /<ResumeOptimizationWorkspace[\s\S]*\{\.\.\.resumeOptimizationFlow\}/);
  assert.match(editor, /surface="sidebar"/);
  assert.match(editor, /surface="modal"/);
  assert.match(
    editor,
    /rightSidebarSurface === 'optimization' && workspaceLayout !== 'ai'[\s\S]*setWorkspaceLayout\('ai'\)/,
  );
});

test('CTA-owned workspace close restores analysis in AI layout and never opens it for hydration', () => {
  const editor = read('views/ResumeEditor/index.tsx');
  assert.match(editor, /const resumeOptimizationShouldRestoreReportRef = useRef\(false\)/);

  const startWrapper = editor.slice(
    editor.indexOf('const handleStartResumeOptimization'),
    editor.indexOf('const commitLayoutSnapshot', editor.indexOf('const handleStartResumeOptimization')),
  );
  const markOrigin = startWrapper.indexOf('resumeOptimizationShouldRestoreReportRef.current = true');
  const openOptimization = startWrapper.indexOf("setRightSidebarSurface('optimization')");
  const startRequest = startWrapper.indexOf('startOptimization');
  assert.ok(markOrigin >= 0 && markOrigin < openOptimization && openOptimization < startRequest);

  const closeWrapperStart = editor.indexOf('const handleCloseResumeOptimization');
  const closeWrapper = editor.slice(closeWrapperStart, editor.indexOf('const commitLayoutSnapshot', closeWrapperStart));
  const originGuard = closeWrapper.indexOf('resumeOptimizationShouldRestoreReportRef.current');
  const suppressCleanup = closeWrapper.indexOf(
    'resumeOptimizationSuppressReturnFocusRef.current = shouldRestoreAnalysis',
  );
  const awaitClose = closeWrapper.indexOf('await resumeOptimizationFlow.closeWorkspace()');
  const rejectedGuard = closeWrapper.indexOf('if (!didClose)');
  const reopenReport = closeWrapper.indexOf("setRightSidebarSurface(shouldRestoreAnalysis ? 'analysis' : null)");
  const preserveAiLayout = closeWrapper.indexOf("setWorkspaceLayout(shouldRestoreAnalysis ? 'ai' : 'list')");
  const focusRestoredReport = closeWrapper.indexOf('focusRestoredAnalysisReport()');
  const clearOrigin = closeWrapper.indexOf('resumeOptimizationShouldRestoreReportRef.current = false');
  assert.ok(
    originGuard >= 0
      && originGuard < suppressCleanup
      && suppressCleanup < awaitClose
      && awaitClose < rejectedGuard
      && originGuard < reopenReport
      && reopenReport < preserveAiLayout
      && preserveAiLayout < focusRestoredReport
      && focusRestoredReport < clearOrigin,
  );
  assert.match(
    closeWrapper,
    /if \(!didClose\) \{[\s\S]*resumeOptimizationSuppressReturnFocusRef\.current = false;[\s\S]*return false;/,
  );
  assert.match(
    editor,
    /const focusRestoredAnalysisReport = useCallback\(\(\) => \{[\s\S]*?window\.requestAnimationFrame[\s\S]*?data-resume-optimization-focus-return="true"\]\[aria-label="关闭分析报告"\][\s\S]*?!candidate\.closest\('\[inert\]'\)[\s\S]*?focusTarget\?\.focus\(\)/,
  );
  assert.match(editor, /onRequestClose=\{handleCloseResumeOptimization\}/);
  assert.match(
    editor,
    /resumeOptimizationFlow\.uiState === 'closed'[\s\S]*rightSidebarSurface !== 'optimization'[\s\S]*resumeOptimizationShouldRestoreReportRef\.current = false;/,
  );
  assert.doesNotMatch(closeWrapper, /setRightSidebarSurface\('analysis'\)[\s\S]*if \(resumeOptimizationShouldRestoreReportRef\.current\)/);

  const returnWrapperStart = editor.indexOf('const handleResumeOptimizationReturnToPlan');
  const returnWrapper = editor.slice(returnWrapperStart, editor.indexOf('useEffect', returnWrapperStart));
  const markReportOrigin = returnWrapper.indexOf('resumeOptimizationShouldRestoreReportRef.current = true');
  const reopenOptimization = returnWrapper.indexOf("setRightSidebarSurface('optimization')");
  assert.ok(markReportOrigin >= 0 && markReportOrigin < reopenOptimization);
});

test('successful revert exits both desktop and mobile optimization surfaces without closing an active run', () => {
  const editor = read('views/ResumeEditor/index.tsx');
  const start = editor.indexOf('const handleRevertResumeOptimization');
  const block = editor.slice(start, editor.indexOf('const handleResumeOptimizationReturnToPlan', start));

  assert.ok(start >= 0);
  assert.match(
    block,
    /resumeOptimizationSuppressReturnFocusRef\.current = shouldRestoreAnalysis[\s\S]*await resumeOptimizationFlow\.revertRun\(\)/,
  );
  assert.match(block, /await resumeOptimizationFlow\.revertRun\(\)/);
  assert.match(
    block,
    /if \(revertedRun\?\.status !== 'reverted'\) \{[\s\S]*resumeOptimizationSuppressReturnFocusRef\.current = false;[\s\S]*return revertedRun;/,
  );
  assert.match(block, /await handleCloseResumeOptimization\(\)/);
  assert.doesNotMatch(block, /cancelRun|setUiState/);
  assert.equal((editor.match(/revertRun=\{handleRevertResumeOptimization\}/g) ?? []).length, 2);
});

test('overview cannot continue when the shared reviewability gate rejects every change', () => {
  const workspace = read('views/ResumeEditor/components/ResumeOptimization/ResumeOptimizationWorkspace.tsx');

  assert.match(workspace, /plan\?\.changes\.some\(isResumeOptimizationChangeReviewable\)/);
  assert.match(workspace, /const canContinueFromOverview = hasQuestions \|\| hasReviewableChanges/);
  assert.match(workspace, /if \(!canContinueFromOverview\) return/);
  assert.match(workspace, /disabled=\{!canContinueFromOverview\}/);
  assert.match(workspace, /请重新生成优化方案/);
});
