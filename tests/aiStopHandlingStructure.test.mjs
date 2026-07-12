import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const readSource = (path) => readFileSync(path, 'utf8');

const bodyOf = (source, functionName) => {
  const start = source.indexOf(`const ${functionName} = useCallback`);
  assert.notEqual(start, -1, `${functionName} should exist`);
  const next = source.indexOf('\n    const ', start + 1);
  return next === -1 ? source.slice(start) : source.slice(start, next);
};

const runningStatusSnippets = (source, marker) => {
  const snippets = [];
  let searchFrom = 0;

  while (searchFrom < source.length) {
    const markerIndex = source.indexOf(marker, searchFrom);
    if (markerIndex === -1) {
      break;
    }

    const innerStart = source.lastIndexOf('<div className="', markerIndex);
    const outerStart = source.lastIndexOf('<div className="', innerStart - 1);
    const stopIndex = source.indexOf('停止', markerIndex);
    const buttonEnd = source.indexOf('</button>', stopIndex);

    assert.notEqual(innerStart, -1, 'running status inner row should be found');
    assert.notEqual(outerStart, -1, 'running status outer row should be found');
    assert.notEqual(stopIndex, -1, 'running status stop button should be found');
    assert.notEqual(buttonEnd, -1, 'running status stop button end should be found');

    snippets.push(source.slice(outerStart, buttonEnd + '</button>'.length));
    searchFrom = markerIndex + marker.length;
  }

  return snippets;
};

test('editing polish abort keeps the stopped toast from being overwritten', () => {
  const source = readSource('views/ResumeEditor/hooks/useEditingExperiencePolishActions.ts');
  const body = bodyOf(source, 'handleRunEditingExperiencePolish');

  assert.match(body, /let\s+wasAborted\s*=\s*false/);
  assert.match(body, /wasAborted\s*=\s*true/);
  assert.match(body, /if\s*\(\s*wasAborted\s*\)\s*\{[\s\S]*?return;/);
});

test('floating polish abort keeps stopped toasts from being overwritten', () => {
  const source = readSource('views/ResumeEditor/hooks/useFloatingExperiencePolishActions.ts');
  const singleBody = bodyOf(source, 'handleRunFloatingExperiencePolish');
  const batchBody = bodyOf(source, 'handleRunBatchExperiencePolish');

  for (const body of [singleBody, batchBody]) {
    assert.match(body, /let\s+wasAborted\s*=\s*false/);
    assert.match(body, /wasAborted\s*=\s*true/);
    assert.match(body, /if\s*\(\s*wasAborted\s*\)\s*\{[\s\S]*?return;/);
  }
});

test('batch polish creates a fresh abort controller and treats aborted settlements separately', () => {
  const source = readSource('views/ResumeEditor/hooks/useFloatingExperiencePolishActions.ts');
  const batchBody = bodyOf(source, 'handleRunBatchExperiencePolish');

  assert.match(batchBody, /floatingAbortControllerRef\.current\s*=\s*new\s+AbortController\(\)/);
  assert.match(batchBody, /abortedIds/);
  assert.match(batchBody, /isAbortError\(/);
});

test('batch polish failure settlements update the original loading toast', () => {
  const source = readSource('views/ResumeEditor/hooks/useFloatingExperiencePolishActions.ts');
  const batchBody = bodyOf(source, 'handleRunBatchExperiencePolish');
  const failedBranchStart = batchBody.indexOf('if (failedIds.length > 0)');
  assert.notEqual(failedBranchStart, -1, 'failed settlement branch should exist');

  const failedBranchEnd = batchBody.indexOf('} else if', failedBranchStart);
  assert.notEqual(failedBranchEnd, -1, 'failed settlement branch should precede unchanged branch');
  const failedBranch = batchBody.slice(failedBranchStart, failedBranchEnd);

  assert.match(failedBranch, /updateToast\(toastId,\s*\{[\s\S]*type:\s*'error'[\s\S]*duration:\s*3000/);
  assert.doesNotMatch(failedBranch, /showToastError/);
});

test('AI polish toolbar only shows Stop for cancellable generation runs', () => {
  const source = readSource('components/AIPolishToolbar.tsx');

  assert.match(
    source,
    /const canStopRunning = isRunning && typeof onStop === 'function' && !isPreviewing;/
  );
  assert.match(source, /if\s*\(\s*canStopRunning\s*\)/);
  assert.doesNotMatch(source, /if\s*\(\s*isRunning\s*\)\s*\{/);
});

test('AI polish running status aligns the thinking label with the stop control', () => {
  const source = readSource('components/AIPolishToolbar.tsx');
  const start = source.indexOf('if (canStopRunning)');
  const end = source.indexOf('if (isPreviewing)', start);
  assert.notEqual(start, -1, 'AI polish running branch should exist');
  assert.notEqual(end, -1, 'AI polish preview branch should follow the running branch');

  const runningBranch = source.slice(start, end);
  assert.match(runningBranch, /flex items-center justify-between/);
  assert.match(runningBranch, /flex min-w-0 flex-1 items-center/);
  assert.doesNotMatch(runningBranch, /mt-0\.5/);
});

test('JD analysis running status aligns the thinking label with the stop control', () => {
  const source = readSource('views/ResumeEditor/components/JDAnalysisPanel.tsx');
  const snippets = runningStatusSnippets(
    source,
    "思考中：{thinkingText || '正在分析岗位要求...'}"
  );

  assert.equal(snippets.length, 2, 'desktop JD analysis should have collapsed and input running states');

  for (const snippet of snippets) {
    assert.match(snippet, /flex items-center justify-between/);
    assert.match(snippet, /flex min-w-0 flex-1 items-center/);
    assert.doesNotMatch(snippet, /mt-0\.5/);
  }
});

test('JD analysis thinking text stays on a single truncated line', () => {
  const panelSource = readSource('views/ResumeEditor/components/JDAnalysisPanel.tsx');
  const mobileSource = readSource('views/ResumeEditor/components/MobileEditorHeader.tsx');

  for (const source of [panelSource, mobileSource]) {
    const snippets = runningStatusSnippets(
      source,
      "思考中：{thinkingText || '正在分析岗位要求...'}"
    );
    assert.ok(snippets.length > 0, 'JD thinking status should be rendered');
    for (const snippet of snippets) {
      assert.match(snippet, /min-w-0 flex-1 truncate/);
      assert.doesNotMatch(snippet, /SmoothHeightContainer/);
      assert.doesNotMatch(snippet, /whitespace-normal/);
      assert.doesNotMatch(snippet, /whitespace-pre-wrap/);
      assert.doesNotMatch(snippet, /break-words/);
      assert.doesNotMatch(snippet, /break-all/);
    }
  }
});

test('JD analysis stop action shows an aborted toast before restoring controls', () => {
  const source = readSource('views/ResumeEditor/index.tsx');
  const body = bodyOf(source, 'handleStopAnalysisWithToast');

  assert.match(body, /handleStopAnalysis\(\);/);
  assert.match(body, /invalidateJdAnalyzeWorkflow\(\);/);
  assert.match(body, /showToastInfo\('分析中止',\s*2000\);/);
  assert.match(source, /onStopAnalyze: handleStopAnalysisWithToast/);
  assert.match(source, /onStopAnalyze=\{handleStopAnalysisWithToast\}/);
});

test('JD analysis aborted outcome does not show the no-change toast', () => {
  const source = readSource('views/ResumeEditor/hooks/useJdAnalyzeWithToast.ts');
  const body = bodyOf(source, 'runJdAnalyzeWorkflow');
  const abortIndex = body.indexOf("result.status === 'aborted'");
  const noChangeIndex = body.indexOf('JD_ANALYSIS_TOAST_MESSAGES.noChange');

  assert.notEqual(abortIndex, -1, 'aborted JD analysis should be handled explicitly');
  assert.notEqual(noChangeIndex, -1, 'no-change JD analysis should still keep its own toast');
  assert.ok(
    abortIndex < noChangeIndex,
    'aborted JD analysis should return before the no-change toast fallback'
  );
  assert.match(body, /if \(result\.status === 'aborted'\) \{\s*return null;\s*\}/);
  assert.doesNotMatch(body, /closeToast\(toastId\)/);
});

test('JD analysis stop motion mirrors the analysis launch motion', () => {
  const panelSource = readSource('views/ResumeEditor/components/JDAnalysisPanel.tsx');
  const mobileSource = readSource('views/ResumeEditor/components/MobileEditorHeader.tsx');
  const motionSource = readSource('views/ResumeEditor/components/jdAnalysisMotion.ts');
  const htmlSource = readSource('index.html');

  for (const source of [panelSource, mobileSource]) {
    assert.match(source, /useJDAnalysisMotion\(isAnalyzing\)/);
    assert.match(source, /jdAnalysisMotion\.shouldRenderStatus/);
    assert.match(source, /jdAnalysisMotion\.statusMotionClass/);
    assert.match(source, /jdAnalysisMotion\.idleControlsMotionClass/);
    assert.doesNotMatch(source, /absolute bottom-3 right-3 flex items-center gap-2 animate-in fade-in slide-in-from-bottom-1 duration-200/);
  }

  assert.match(motionSource, /jd-analysis-status-enter/);
  assert.match(motionSource, /jd-analysis-status-exit/);
  assert.match(motionSource, /jd-analysis-controls-return/);
  assert.match(htmlSource, /@keyframes jdAnalysisStatusEnter/);
  assert.match(htmlSource, /@keyframes jdAnalysisStatusExit/);
  assert.match(htmlSource, /@keyframes jdAnalysisControlsReturn/);
  assert.match(htmlSource, /transform-origin: bottom right/);
});

test('mobile JD analysis running status aligns the thinking label with the stop control', () => {
  const source = readSource('views/ResumeEditor/components/MobileEditorHeader.tsx');
  const snippets = runningStatusSnippets(
    source,
    "思考中：{thinkingText || '正在分析岗位要求...'}"
  );

  assert.equal(snippets.length, 1, 'mobile JD analysis should have one input running state');

  for (const snippet of snippets) {
    assert.match(snippet, /flex items-center justify-between/);
    assert.match(snippet, /flex min-w-0 flex-1 items-center/);
    assert.doesNotMatch(snippet, /mt-0\.5/);
  }
});

test('JD analysis stop invalidates stale runs before they can clear a newer run', () => {
  const source = readSource('hooks/useJDAnalysis.ts');
  const stopBody = bodyOf(source, 'handleStopAnalysis');
  const runBody = bodyOf(source, 'runAnalyze');

  assert.match(source, /const analysisRunIdRef = useRef\(0\);/);
  assert.match(source, /const activeAnalysisRunIdRef = useRef\(0\);/);
  assert.match(stopBody, /activeAnalysisRunIdRef\.current = 0;/);
  assert.match(runBody, /const runId = analysisRunIdRef\.current \+ 1;/);
  assert.match(runBody, /activeAnalysisRunIdRef\.current = runId;/);
  assert.match(runBody, /const setIsAnalyzingForRun = \(value: boolean\) => \{/);
  assert.match(runBody, /if \(activeAnalysisRunIdRef\.current !== runId\) \{/);
  assert.match(runBody, /setIsAnalyzing: setIsAnalyzingForRun/);
});

test('JD analysis invalidates active work when the selected resume changes', () => {
  const source = readSource('hooks/useJDAnalysis.ts');

  assert.match(source, /const activeResumeIdRef = useRef\(resumeId\);/);
  assert.match(source, /previousResumeIdRef\.current === resumeId/);
  assert.match(source, /activeAnalysisRunIdRef\.current = 0;/);
  assert.match(source, /analyzeRequestRef\.current = null;/);
  assert.match(source, /abortControllerRef\.current\.abort\(\);/);
  assert.match(
    source,
    /shouldContinue: \(\) => \([\s\S]*activeResumeIdRef\.current === resumeId[\s\S]*\)/,
  );
});

test('JD analysis stop releases both request and UI workflow locks', () => {
  const analysisSource = readSource('hooks/useJDAnalysis.ts');
  const stopBody = bodyOf(analysisSource, 'handleStopAnalysis');
  const workflowSource = readSource('views/ResumeEditor/jdAnalyzeWorkflow.ts');

  assert.match(stopBody, /analyzeRequestRef\.current = null;/);
  assert.match(workflowSource, /invalidate\(\) \{[\s\S]*inFlight = null;/);
});

test('experience internal polish toolbar starts collapsed with mobile full-width comment', () => {
  const source = readSource('views/ResumeEditor/components/EditorSidebar.tsx');

  assert.match(source, /const \[isPolishCardCollapsed, setIsPolishCardCollapsed\] = React\.useState\(true\);/);
  assert.match(source, /isPolishCardCollapsed \? 'flex items-start gap-3'/);
  assert.match(source, /isPolishCardCollapsed \? 'flex-col md:flex-row md:items-start'/);
  assert.match(source, /w-full[^"']*md:flex-1/);
});
