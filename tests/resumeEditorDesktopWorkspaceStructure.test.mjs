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
  assert.match(editor, /isAssistantSidebarOpen=\{isAssistantSidebarOpen\}/);
  assert.match(editor, /surface="sidebar"/);
  assert.match(editor, /onOpenTemplateSelector=\{handleOpenDesktopTemplateTab\}/);
  assert.match(editor, /onToggleLayoutAdjustToolbar=\{handleOpenDesktopLayoutTab\}/);
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
