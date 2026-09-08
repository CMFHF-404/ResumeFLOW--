import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

import {
  buildResumeOptimizationExperienceComparisonMap,
} from '../views/ResumeEditor/components/ResumeOptimization/optimizationDisplayUtils.mjs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const readHydratedOptimizationRecoveryGuard = () => {
  const text = read('views/ResumeEditor/index.tsx');
  const source = ts.createSourceFile('ResumeEditor.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let initializer = null;
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.name.text === 'shouldRestoreHydratedOptimizationWorkspace'
    ) {
      initializer = node.initializer;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(initializer, 'the hydration recovery guard must be declared');
  return new Function('state', `
    const {
      isMobileAnalysisViewport,
      rightSidebarSurface,
      resumeId,
      isResumeOptimizationBusy,
    } = state;
    const resumeOptimizationFlow = state.flow;
    return (${initializer.getText(source)});
  `);
};

const readHydratedOptimizationRecoveryEffect = () => {
  const text = read('views/ResumeEditor/index.tsx');
  const source = ts.createSourceFile('ResumeEditor.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback = null;
  const visit = (node) => {
    if (
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === 'useEffect'
      && ts.isArrowFunction(node.arguments[0])
      && node.arguments[0].getText(source).includes('shouldRestoreHydratedOptimizationWorkspace')
    ) {
      callback = node.arguments[0];
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(callback, 'the hydration recovery effect must be declared');
  return new Function('state', `
    const shouldRestoreHydratedOptimizationWorkspace = state.shouldRestore;
    const resumeOptimizationFlow = state.flow;
    const setWorkspaceLayout = (value) => state.calls.push(['layout', value]);
    const setRightSidebarSurface = (value) => state.calls.push(['surface', value]);
    return (${callback.getText(source)});
  `);
};

const buildChange = (overrides = {}) => ({
  changeId: 'change-a',
  moduleType: 'experience_star',
  moduleId: 'experience-1',
  fieldPath: 'star.a',
  actionKind: 'rewrite_now',
  safetyStatus: 'allowed',
  beforeValue: '原始行动',
  targetedValue: '优化行动',
  ...overrides,
});

test('desktop toolbar replaces the AI button with an accessible three-mode layout switcher', () => {
  const toolbar = read('views/ResumeEditor/components/EditorToolbar.tsx');

  assert.match(toolbar, /ResumeEditorWorkspaceLayout/);
  assert.match(toolbar, /role="radiogroup"/);
  assert.match(toolbar, /aria-label="编辑器布局"/);
  assert.match(toolbar, /role="radio"/);
  assert.match(toolbar, /aria-checked=\{workspaceLayout === option\.id\}/);
  assert.match(toolbar, /PanelLeft/);
  assert.match(toolbar, /Columns3/);
  assert.match(toolbar, /PanelRight/);
  for (const label of ['列表布局', '三栏布局', 'AI 布局']) {
    assert.match(toolbar, new RegExp(label));
  }
  assert.match(toolbar, /ArrowLeft/);
  assert.match(toolbar, /ArrowRight/);
  assert.doesNotMatch(toolbar, /<Sparkles[\s\S]*?>\s*AI\s*<\/button>/);
});

test('desktop workspace gives list, triple, and AI modes distinct left and right rails', () => {
  const workspace = read('views/ResumeEditor/components/ResumeEditorDesktopWorkspace.tsx');
  const editor = read('views/ResumeEditor/index.tsx');

  assert.match(workspace, /export type ResumeEditorWorkspaceLayout = 'list' \| 'triple' \| 'ai'/);
  assert.match(workspace, /layoutMode: ResumeEditorWorkspaceLayout/);
  assert.match(workspace, /layoutMode === 'ai'/);
  assert.match(workspace, /md:w-0/);
  assert.match(workspace, /layoutMode !== 'list'/);
  assert.match(workspace, /const DEFAULT_RIGHT_SIDEBAR_WIDTH = '390px'/);
  assert.match(workspace, /const AI_RIGHT_SIDEBAR_WIDTH = '460px'/);
  assert.match(workspace, /layoutMode === 'ai' \? AI_RIGHT_SIDEBAR_WIDTH : DEFAULT_RIGHT_SIDEBAR_WIDTH/);

  assert.match(editor, /type RightSidebarSurface = 'assistant' \| 'analysis' \| 'optimization' \| null/);
  assert.match(editor, /useState<ResumeEditorWorkspaceLayout>\('list'\)/);
  assert.match(editor, /useState<RightSidebarSurface>\(null\)/);
  assert.match(editor, /handleWorkspaceLayoutChange/);
  assert.match(editor, /setWorkspaceLayout\('ai'\)/);
  assert.match(editor, /setRightSidebarSurface\('optimization'\)/);
  assert.match(editor, /layoutMode=\{workspaceLayout\}/);
});

test('opening analysis details preserves an already selected AI layout', () => {
  const editor = read('views/ResumeEditor/index.tsx');

  assert.match(
    editor,
    /const handleOpenJDAnalysisDetailsSidebar[\s\S]*?setRightSidebarSurface\('analysis'\);[\s\S]*?setWorkspaceLayout\(\(currentLayout\) => currentLayout === 'ai' \? 'ai' : 'triple'\);/,
  );
});

test('analysis overlays a mounted assistant so an unsent draft survives the round trip', () => {
  const editor = read('views/ResumeEditor/index.tsx');

  assert.match(editor, /const \[isAssistantSidebarMounted, setIsAssistantSidebarMounted\] = useState\(false\)/);
  assert.match(editor, /setIsAssistantSidebarMounted\(true\)[\s\S]*setRightSidebarSurface\('assistant'\)/);
  assert.match(editor, /isAssistantSidebarMounted \? \(/);
  assert.match(editor, /const isAssistantSidebarActive = rightSidebarSurface === 'assistant'/);
  assert.match(editor, /aria-hidden=\{!isAssistantSidebarActive\}[\s\S]*?<AIAssistant/);
  assert.match(editor, /inert=\{!isAssistantSidebarActive \? true : undefined\}/);
  assert.match(editor, /const handleCloseJDAnalysisDetailsSidebar[\s\S]*lastRightSidebarSurfaceRef.current = 'analysis'[\s\S]*setRightSidebarSurface\(null\)/);
  assert.match(editor, /rightSidebarContent = isRightSidebarOpen \|\| hasOpenedRightSidebar/);
});

test('desktop hydration restores only an active optimization observation to the AI rail', () => {
  const editor = read('views/ResumeEditor/index.tsx');
  const recoveryStart = editor.indexOf('const shouldRestoreHydratedOptimizationWorkspace');
  const recoveryEnd = editor.indexOf('const handleWorkspaceLayoutChange', recoveryStart);
  assert.ok(recoveryStart >= 0, 'the desktop hydration recovery guard must exist');
  assert.ok(recoveryEnd > recoveryStart, 'the recovery guard must stay before layout switching');
  const recovery = editor.slice(recoveryStart, recoveryEnd);

  assert.match(recovery, /!isMobileAnalysisViewport/);
  assert.match(recovery, /rightSidebarSurface === null/);
  assert.match(recovery, /resumeOptimizationFlow\.run\?\.resumeId === resumeId/);
  assert.match(recovery, /\['planning', 'applying', 'rescoring'\]/);
  assert.match(recovery, /\['starting', 'applying', 'rescoring'\]/);
  assert.doesNotMatch(read('views/ResumeEditor/index.tsx').slice(recoveryStart, recovery.indexOf(');') + recoveryStart + 2), /getLatestUiState/);
  assert.match(recovery, /resumeOptimizationFlow\.getLatestUiState\(\) !== resumeOptimizationFlow\.uiState/);
  assert.match(recovery, /setWorkspaceLayout\('ai'\)/);
  assert.match(recovery, /setRightSidebarSurface\('optimization'\)/);
  assert.doesNotMatch(recovery, /uiState === 'closed'[\s\S]*setRightSidebarSurface\('optimization'\)/);
});

test('hydrated desktop recovery guard executes only for the current active task', () => {
  const shouldRestore = readHydratedOptimizationRecoveryGuard();
  const state = ({
    isMobileAnalysisViewport = false,
    rightSidebarSurface = null,
    resumeId = 'resume-a',
    isResumeOptimizationBusy = true,
    run = { resumeId: 'resume-a', status: 'planning' },
    uiState = 'starting',
    latestUiState = uiState,
  } = {}) => ({
    isMobileAnalysisViewport,
    rightSidebarSurface,
    resumeId,
    isResumeOptimizationBusy,
    flow: {
      run,
      uiState,
      getLatestUiState: () => latestUiState,
    },
  });

  assert.equal(shouldRestore(state()), true, 'a matching desktop planning run restores its rail');
  assert.equal(shouldRestore(state({ uiState: 'closed', latestUiState: 'closed' })), false, 'an explicit dismissal stays closed');
  assert.equal(shouldRestore(state({ isMobileAnalysisViewport: true })), false, 'mobile keeps the modal surface');
  assert.equal(shouldRestore(state({ run: { resumeId: 'resume-b', status: 'applying' }, uiState: 'applying' })), false, 'a different resume never opens');
  assert.equal(shouldRestore(state({
    run: { resumeId: 'resume-a', status: 'completed' },
    uiState: 'completed',
    latestUiState: 'completed',
    isResumeOptimizationBusy: false,
  })), false, 'completion never mounts a new recovery surface or steals focus');
});

test('hydrated desktop recovery effect rechecks live state after render before opening', () => {
  const createEffect = readHydratedOptimizationRecoveryEffect();
  const state = {
    shouldRestore: true,
    latestUiState: 'starting',
    flow: {
      uiState: 'starting',
      getLatestUiState: () => state.latestUiState,
    },
    calls: [],
  };
  const effect = createEffect(state);

  state.latestUiState = 'closed';
  effect();
  assert.deepEqual(state.calls, [], 'owner invalidation after render must prevent reopening');

  state.latestUiState = 'starting';
  effect();
  assert.deepEqual(state.calls, [
    ['layout', 'ai'],
    ['surface', 'optimization'],
  ], 'a still-current active task restores the desktop rail');
});

test('desktop optimization is embedded in the right rail while mobile keeps the modal surface', () => {
  const workspace = read('views/ResumeEditor/components/ResumeOptimization/ResumeOptimizationWorkspace.tsx');
  const editor = read('views/ResumeEditor/index.tsx');

  assert.match(workspace, /surface\?: 'modal' \| 'sidebar'/);
  assert.match(workspace, /const isSidebarSurface = surface === 'sidebar'/);
  assert.match(workspace, /isSidebarSurface \? 'region' : 'dialog'/);
  assert.match(workspace, /aria-modal=\{isSidebarSurface \? undefined : true\}/);
  assert.match(workspace, /variant=\{isSidebarSurface \? 'mobile' : 'desktop'\}/);

  assert.match(editor, /rightSidebarSurface === 'optimization'/);
  assert.match(editor, /surface="sidebar"/);
  assert.match(editor, /isMobileAnalysisViewport[\s\S]*surface="modal"/);
});

test('experience comparison mapping is safe, ordered, selected-aware, and filters non-renderable changes', () => {
  const comparisons = buildResumeOptimizationExperienceComparisonMap([
    buildChange({ changeId: 'change-r', fieldPath: 'star.r' }),
    buildChange({ changeId: 'change-s', fieldPath: 'star.s' }),
    buildChange({ changeId: 'change-blocked', safetyStatus: 'blocked' }),
    buildChange({ changeId: 'change-empty', targetedValue: null }),
    buildChange({ changeId: 'change-blank', targetedValue: '   ' }),
    buildChange({ changeId: 'change-unchanged', beforeValue: '相同内容', targetedValue: '相同内容' }),
    buildChange({ changeId: 'change-summary', moduleType: 'personal_summary', moduleId: 'personal_summary' }),
  ], ['change-r']);

  assert.deepEqual(
    comparisons.get('experience-1').map((item) => ({
      changeId: item.changeId,
      field: item.field,
      selected: item.selected,
    })),
    [
      { changeId: 'change-s', field: 's', selected: false },
      { changeId: 'change-r', field: 'r', selected: true },
    ],
  );
  assert.equal(comparisons.size, 1);

  const actionComparison = buildResumeOptimizationExperienceComparisonMap([
    buildChange({ targetedValue: '第一段；\n第二段' }),
  ]).get('experience-1')[0];
  assert.equal(actionComparison.afterValue, '第一段。\n第二段。');
});

test('editor-only text comparisons render experiences and summary without touching export surfaces', () => {
  const preview = read('views/ResumeEditor/components/ResumePreview.tsx');
  const summarySection = read('views/ResumeEditor/components/ResumePreview/sections/SummarySection.tsx');
  const experienceSection = read('views/ResumeEditor/components/ResumePreview/sections/ExperienceSection.tsx');
  const renderUtils = read('views/ResumeEditor/components/ResumePreview/previewRenderUtils.tsx');
  const previewProps = read('views/ResumeEditor/hooks/useResumeEditorPreviewWorkspaceProps.ts');
  const pdfDocument = read('views/ResumeEditor/components/ResumePdfDocument.tsx');
  const devPreview = read('views/ResumeTemplatePreviewDevPage.tsx');

  assert.match(preview, /optimizationComparison\?:/);
  assert.match(preview, /previewScope === 'editor'/);
  assert.match(preview, /buildResumeOptimizationExperienceComparisonMap/);
  assert.match(preview, /buildResumeOptimizationPersonalSummaryComparison/);
  assert.match(summarySection, /summaryComparison/);
  assert.match(summarySection, /renderOptimizationTextComparison/);
  assert.match(experienceSection, /experienceComparisonMap/);
  assert.match(renderUtils, /data-rf-optimization-comparison/);
  assert.match(renderUtils, /原内容/);
  assert.match(renderUtils, /优化后/);
  assert.match(renderUtils, /bg-amber-50/);
  assert.match(renderUtils, /bg-emerald-50/);
  assert.doesNotMatch(previewProps, /measurePreviewProps:[\s\S]*optimizationComparison/);
  assert.match(pdfDocument, /previewScope = 'print'/);
  assert.match(devPreview, /optimizationReview/);
  assert.match(devPreview, /previewScope=\{showOptimizationReview \? 'editor' : 'print'\}/);
  assert.match(devPreview, /onClick=\{handleOptimizationReviewApply\}/);
  assert.match(devPreview, /role="status" aria-live="polite"/);
  assert.match(devPreview, /仅模拟应用，不会写入真实简历。/);
});

test('editor clears old comparison content outside review and passes document order to both surfaces', () => {
  const editor = read('views/ResumeEditor/index.tsx');
  const workspace = read('views/ResumeEditor/components/ResumeOptimization/ResumeOptimizationWorkspace.tsx');
  const preview = read('views/ResumeEditor/components/ResumeOptimization/ResumeOptimizationPreview.tsx');
  const overview = read('views/ResumeEditor/components/ResumeOptimization/ResumeOptimizationOverview.tsx');

  assert.match(editor, /shouldRenderResumeOptimizationComparison\(resumeOptimizationFlow\.uiState\)/);
  assert.match(editor, /!isResumeOptimizationLayoutTransitioning[\s\S]*shouldRenderResumeOptimizationComparison/);
  assert.match(editor, /resumeOptimizationModuleOrder/);
  assert.match(workspace, /moduleOrder=\{moduleOrder\}/);
  assert.match(preview, /sortResumeOptimizationChangesByResumeOrder/);
  assert.match(overview, /sortResumeOptimizationChangesByResumeOrder/);
});

test('editor resumes only a run that still matches the current report snapshot', () => {
  const editor = read('views/ResumeEditor/index.tsx');
  assert.match(editor, /hasResumableResumeOptimizationRun = resumeOptimizationFlow\.canResumeLatestRun/);
  assert.doesNotMatch(editor, /hasResumableResumeOptimizationRun = Boolean\([\s\S]{0,220}preview_ready/);
});
