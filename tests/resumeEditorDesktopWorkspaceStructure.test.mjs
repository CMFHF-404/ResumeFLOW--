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
  assert.match(editor, /layoutAdjustProps=\{layoutAdjustProps\}/);
  assert.match(editor, /previewProps=\{editorPreviewProps\}/);
  assert.match(editor, /const isRightSidebarOpen = isAssistantSidebarOpen \|\| isJDAnalysisDetailsSidebarOpen/);
  assert.match(editor, /isAssistantSidebarOpen=\{isRightSidebarOpen\}/);
  assert.match(editor, /surface="sidebar"/);
  assert.doesNotMatch(editor, /handleOpenDesktopTemplateTab/);
  assert.doesNotMatch(editor, /handleOpenDesktopLayoutTab/);
  assert.match(editor, /onLaunchAssistant=\{handleOpenResumeAssistantSidebar\}/);
  assert.doesNotMatch(editor, /SIDEBAR_WIDTH_CLASS/);
  assert.doesNotMatch(editor, /<EditorSidebar\s/);

  assert.match(workspace, /import ResumeFactorySidebar, \{ type ResumeFactorySidebarProps \} from '\.\/ResumeFactorySidebar'/);
  assert.match(workspace, /import ResumeEditorPreviewStage from '\.\/ResumeEditorPreviewStage'/);
  assert.match(workspace, /factorySidebarProps: ResumeFactorySidebarProps/);
  assert.match(workspace, /assistantSidebar\?: React\.ReactNode/);
  assert.match(workspace, /isAssistantSidebarOpen\?: boolean/);
  assert.match(workspace, /flex flex-1 flex-col overflow-visible md:min-h-0 md:overflow-hidden md:flex-row/);
  assert.match(workspace, /<ResumeFactorySidebar \{\.\.\.factorySidebarProps\} \/>/);
  assert.match(workspace, /<ResumeEditorPreviewStage/);
  assert.match(workspace, /layoutAdjustProps=\{layoutAdjustProps\}/);
  assert.match(workspace, /previewProps=\{previewProps\}/);
  assert.match(workspace, /isAssistantSidebarOpen\s*\n\s*\? 'w-\[390px\] opacity-100 md:border-l 2xl:w-\[420px\]'/);
  assert.match(workspace, /: 'w-0 opacity-0 md:border-l-0 pointer-events-none'/);
  assert.match(workspace, /\{assistantSidebar\}/);
  assert.doesNotMatch(workspace, /layoutMode="drawer"/);
  assert.doesNotMatch(workspace, /showJDPanel=\{false\}/);

  assert.match(factorySidebar, /export type ResumeFactoryTab = 'templates' \| 'edit' \| 'layout'/);
  assert.match(factorySidebar, /label: '模板选择'/);
  assert.match(factorySidebar, /label: '简历编辑'/);
  assert.match(factorySidebar, /label: '页面布局'/);
  assert.match(factorySidebar, /<TemplateSelectionPanel \{\.\.\.rest\} \/>/);
  assert.match(factorySidebar, /<LayoutPanel \{\.\.\.rest\} \/>/);
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
