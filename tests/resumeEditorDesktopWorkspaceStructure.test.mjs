import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('ResumeEditor delegates desktop sidebar and preview workspace shell', () => {
  const editor = read('views/ResumeEditor/index.tsx');
  const workspace = read('views/ResumeEditor/components/ResumeEditorDesktopWorkspace.tsx');
  const factorySidebar = read('views/ResumeEditor/components/ResumeFactorySidebar.tsx');

  assert.match(editor, /ResumeEditorDesktopWorkspace/);
  assert.match(editor, /factorySidebarProps=\{factorySidebarProps\}/);
  assert.match(editor, /layoutAdjustProps=\{mobileTemplates\.active \? \{ \.\.\.layoutAdjustProps, isOpen: false \} : layoutAdjustProps\}/);
  assert.match(editor, /previewProps=\{editorPreviewPropsWithOptimization\}/);
  assert.match(editor, /const isRightSidebarOpen = workspaceLayout !== 'list' && rightSidebarSurface !== null/);
  assert.match(editor, /isRightSidebarOpen=\{isRightSidebarOpen\}/);
  assert.match(editor, /surface="sidebar"/);
  assert.match(editor, /workspaceLayout=\{workspaceLayout\}/);
  assert.match(editor, /onWorkspaceLayoutChange=\{handleWorkspaceLayoutChange\}/);
  assert.doesNotMatch(editor, /handleOpenDesktopTemplateTab/);
  assert.doesNotMatch(editor, /handleOpenDesktopLayoutTab/);
  assert.doesNotMatch(editor, /handleToggleResumeAssistantSidebar/);
  assert.doesNotMatch(editor, /SIDEBAR_WIDTH_CLASS/);
  assert.doesNotMatch(editor, /<EditorSidebar\s/);

  assert.match(workspace, /import ResumeFactorySidebar, \{ type ResumeFactorySidebarProps \} from '\.\/ResumeFactorySidebar'/);
  assert.match(workspace, /import ResumeEditorPreviewStage from '\.\/ResumeEditorPreviewStage'/);
  assert.match(workspace, /factorySidebarProps: ResumeFactorySidebarProps/);
  assert.match(workspace, /rightSidebar\?: React\.ReactNode/);
  assert.match(workspace, /isRightSidebarOpen\?: boolean/);
  assert.match(workspace, /layoutMode: ResumeEditorWorkspaceLayout/);
  assert.match(workspace, /relative flex flex-1 flex-col overflow-visible md:min-h-0 md:overflow-hidden md:flex-row/);
  assert.match(workspace, /<ResumeFactorySidebar \{\.\.\.factorySidebarProps\} \/>/);
  assert.match(workspace, /<ResumeEditorPreviewStage/);
  assert.match(workspace, /layoutAdjustProps=\{layoutAdjustProps\}/);
  assert.match(workspace, /previewProps=\{previewProps\}/);
  assert.match(workspace, /lastExpandedLayout.current === 'triple'\s*\? '\[--factory-sidebar-width:0px\] xl:\[--factory-sidebar-width:460px\]'/);
  assert.match(workspace, /factorySidebarProps\.activeTab === 'templates'[\s\S]*factory-sidebar-width:384px[\s\S]*factory-sidebar-width:562.5px[\s\S]*factory-sidebar-width:607.5px/);
  assert.match(workspace, /const DEFAULT_RIGHT_SIDEBAR_WIDTH = '390px'/);
  assert.match(workspace, /const AI_RIGHT_SIDEBAR_WIDTH = '460px'/);
  assert.match(workspace, /data-rf-right-sidebar/);
  assert.match(workspace, /showRightSidebar\s*\n\s*\? 'w-\[390px\] opacity-100 md:border-l shadow-\[/);
  assert.match(workspace, /const rightSidebarWidth = layoutMode === 'ai' \? AI_RIGHT_SIDEBAR_WIDTH : DEFAULT_RIGHT_SIDEBAR_WIDTH/);
  assert.match(workspace, /style=\{\{\s*width: showRightSidebar \? rightSidebarWidth : 0,\s*opacity: showRightSidebar \? 1 : 0,\s*flexShrink: 0,\s*\}\}/);
  assert.match(workspace, /: 'w-0 opacity-0 md:border-l-0 pointer-events-none'/);
  assert.match(workspace, /<div className="h-full shrink-0 [^"]*transition-\[width\][^"]*" style=\{\{ width: rightSidebarWidth \}\}>/);
  assert.doesNotMatch(workspace, /h-full w-\[390px\] shrink-0 2xl:w-\[420px\]/);
  assert.match(workspace, /\{rightSidebar\}/);
  assert.doesNotMatch(workspace, /layoutMode="drawer"/);
  assert.doesNotMatch(workspace, /showJDPanel=\{false\}/);

  assert.match(factorySidebar, /export type ResumeFactoryTab = 'templates' \| 'edit' \| 'layout'/);
  assert.match(factorySidebar, /label: '模板选择'/);
  assert.match(factorySidebar, /label: '简历编辑'/);
  assert.match(factorySidebar, /label: '页面布局'/);
  assert.match(factorySidebar, /<TemplateSelectionPanel \{\.\.\.rest\} \/>/);
  assert.match(factorySidebar, /<LayoutPanel \{\.\.\.rest\} \/>/);

  const templateSelectionPanel = factorySidebar.match(
    /const TemplateSelectionPanel[\s\S]*?const LayoutPanel/
  )?.[0] ?? '';
  assert.match(templateSelectionPanel, /className="grid gap-x-3 gap-y-5"/);
  assert.match(templateSelectionPanel, /gridTemplateColumns: 'repeat\(auto-fit, minmax\(160px, 1fr\)\)'/);
  assert.match(templateSelectionPanel, /aspect-\[794\/1123\]/);
  assert.match(templateSelectionPanel, /thumbnailSrc=\{template\.thumbnailSrc\}/);
  assert.match(templateSelectionPanel, /aria-pressed=\{isSelected\}/);
  assert.match(templateSelectionPanel, /isSelected \? \([\s\S]*?bottom-1\.5 right-1\.5[\s\S]*?aria-hidden="true"[\s\S]*?<Check className="h-3 w-3" \/>/);
  assert.match(templateSelectionPanel, /group-hover:opacity-100/);
});

test('triple layout defers its factory rail below xl so the desktop preview remains readable', () => {
  const workspace = read('views/ResumeEditor/components/ResumeEditorDesktopWorkspace.tsx');
  const previewStage = read('views/ResumeEditor/components/ResumeEditorPreviewStage.tsx');

  assert.match(
    workspace,
    /lastExpandedLayout.current === 'triple'\s*\? '\[--factory-sidebar-width:0px\] xl:\[--factory-sidebar-width:460px\]'/,
  );
  assert.doesNotMatch(workspace, /layoutMode === 'triple'\s*\? 'md:w-\[430px\]/);
  assert.match(workspace, /showRightSidebar\s*\? 'w-\[390px\] opacity-100/);
  assert.match(previewStage, /flex flex-1 flex-col min-w-0/);
});

test('desktop layout sidebar groups layout parameters and removes density shortcuts', () => {
  const editor = read('views/ResumeEditor/index.tsx');
  const factorySidebar = read('views/ResumeEditor/components/ResumeFactorySidebar.tsx');

  assert.match(editor, /onAdjustToSinglePage: adjustToSinglePage/);
  assert.match(factorySidebar, /onAdjustToSinglePage: \(\) => void/);
  assert.doesNotMatch(factorySidebar, /DENSITY_OPTIONS/);
  assert.doesNotMatch(factorySidebar, /onDensityChange/);
  assert.doesNotMatch(factorySidebar, />密度</);
  assert.doesNotMatch(factorySidebar, /\{selectedTemplate\.name\}模板默认/);

  const templateDefaultSection = factorySidebar.match(
    /<section className="rounded-xl border border-gray-200 bg-white p-4[\s\S]*?<\/section>/
  )?.[0] ?? '';
  assert.match(templateDefaultSection, /flex items-center justify-between/);
  assert.match(templateDefaultSection, /\{selectedTemplate\.name\}/);
  assert.match(templateDefaultSection, /onClick=\{\(\) => void saveDefault\(\)\}[\s\S]*onClick=\{onRestoreDefault\}/);
  assert.doesNotMatch(templateDefaultSection, /mt-3 grid grid-cols-2/);

  const parameterSection = factorySidebar.match(
    /<section className="rounded-xl border border-gray-200 bg-white p-4[\s\S]*?排版参数[\s\S]*?<\/section>/
  )?.[0] ?? '';
  assert.match(parameterSection, /onAdjustToSinglePage/);
  assert.match(parameterSection, /智能一页/);
  for (const label of ['主题颜色', '字号', '行高', '页边距', '模块间距', '条目间距']) {
    assert.match(parameterSection, new RegExp(label));
  }
});

test('factory sidebar promotes experience edit mode to a full sidebar sliding layer', () => {
  const factorySidebar = read('views/ResumeEditor/components/ResumeFactorySidebar.tsx');

  assert.match(factorySidebar, /import React, \{ useEffect, useState \} from 'react'/);
  assert.match(factorySidebar, /import ExperienceTab from '\.\/ExperienceTab'/);
  assert.match(factorySidebar, /const SIDEBAR_SLIDE_DURATION_MS = 300/);
  assert.match(factorySidebar, /const isExperienceEditingFullscreen = activeTab === 'edit'\s*&& editorSidebarProps\.sidebarTab === 'experience'\s*&& Boolean\(editorSidebarProps\.experienceTabProps\.experience\.editingExpId\);/);
  assert.match(factorySidebar, /const \[shouldRenderExperienceEditLayer, setShouldRenderExperienceEditLayer\] = useState\(isExperienceEditingFullscreen\);/);
  assert.match(factorySidebar, /const \[isExperienceEditLayerVisible, setIsExperienceEditLayerVisible\] = useState\(isExperienceEditingFullscreen\);/);
  assert.match(factorySidebar, /window\.requestAnimationFrame\(\(\) => setIsExperienceEditLayerVisible\(true\)\)/);
  assert.match(factorySidebar, /setIsExperienceEditLayerVisible\(false\);/);
  assert.match(factorySidebar, /window\.setTimeout\(\(\) => setShouldRenderExperienceEditLayer\(false\), SIDEBAR_SLIDE_DURATION_MS\)/);
  assert.match(factorySidebar, /aria-hidden=\{isExperienceEditingFullscreen\}/);
  assert.match(factorySidebar, /inert=\{isExperienceEditingFullscreen \? true : undefined\}/);
  assert.match(factorySidebar, /'-translate-x-full opacity-0 pointer-events-none'/);
  assert.match(factorySidebar, /'translate-x-0 opacity-100'/);
  assert.match(factorySidebar, /aria-hidden=\{!isExperienceEditingFullscreen\}/);
  assert.match(factorySidebar, /inert=\{!isExperienceEditingFullscreen \? true : undefined\}/);
  assert.match(factorySidebar, /'translate-x-full opacity-0 pointer-events-none'/);
  assert.match(factorySidebar, /import EditorSidebar, \{ EditingSuggestionNav, type EditorSidebarProps \} from '\.\/EditorSidebar'/);
  assert.match(factorySidebar, /<EditingSuggestionNav \{\.\.\.editorSidebarProps\.editingSuggestion\} \/>/);
  assert.match(factorySidebar, /<ExperienceTab\s*\n\s*\{\.\.\.editorSidebarProps\.experienceTabProps\}\s*\n\s*layoutMode="inline"\s*\n\s*scrollContainerRef=\{fullscreenEditScrollRef\}/);
  assert.match(factorySidebar, /<EditorSidebar \{\.\.\.editorSidebarProps\} \/>/);
});
