import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('desktop editor toolbar keeps primary actions and exposes the three-mode workspace switcher', () => {
  const toolbar = read('views/ResumeEditor/components/EditorToolbar.tsx');
  const titleCluster = toolbar.match(
    /<div className="hidden items-center gap-2 md:flex">[\s\S]*?<div className="hidden h-6 w-px/
  )?.[0] ?? '';
  const actionCluster = toolbar.match(
    /<div className="flex flex-wrap items-center gap-2 md:justify-end md:gap-4">[\s\S]*?<\/div>\s*<\/div>\s*<\/header>/
  )?.[0] ?? '';

  assert.match(titleCluster, /简历工厂/);
  assert.doesNotMatch(toolbar, /onOpenTemplateSelector/);
  assert.doesNotMatch(toolbar, /onToggleLayoutAdjustToolbar/);
  assert.doesNotMatch(toolbar, /SlidersHorizontal/);
  assert.doesNotMatch(actionCluster, /aria-label="打开手动调节工具栏"/);
  assert.match(actionCluster, /role="radiogroup"/);
  assert.match(actionCluster, /aria-label="编辑器布局"/);
  assert.match(actionCluster, /role="radio"/);
  assert.match(actionCluster, /aria-checked=\{workspaceLayout === option\.id\}/);
  assert.match(toolbar, /ArrowUp/);
  assert.match(toolbar, /ArrowDown/);
  assert.match(toolbar, /pendingWorkspaceLayoutFocusRef/);
  assert.match(toolbar, /workspaceLayoutRadioRefs/);
  assert.match(toolbar, /workspaceLayoutRadioRefs\.current\[workspaceLayout\]\?\.focus\(\)/);
  assert.match(toolbar, /onClick=\{\(\) => handleWorkspaceLayoutClick\(option\.id\)\}/);
  assert.match(toolbar, /result === false/);
  assert.doesNotMatch(toolbar, /workspaceLayoutFocusCleanupTimerRef|setTimeout\(/);
  assert.match(toolbar, /pendingWorkspaceLayoutFocusRef\.current = null;[\s\S]*?Promise\.resolve\(onWorkspaceLayoutChange\(layout\)\)/);
  assert.match(toolbar, /const nextLayout = enabledOptions\[nextIndex\]\.id;[\s\S]*?if \(nextLayout === workspaceLayout\) \{[\s\S]*?pendingWorkspaceLayoutFocusRef\.current = null;[\s\S]*?return;[\s\S]*?\}[\s\S]*?requestWorkspaceLayoutFromKeyboard\(nextLayout\)/);
  assert.match(toolbar, /workspaceLayout: ResumeEditorWorkspaceLayout/);
  assert.match(toolbar, /canOpenWorkspacePanels\?: boolean/);
  assert.match(toolbar, /isWorkspaceLayoutLocked\?: boolean/);
  assert.doesNotMatch(actionCluster, /onLaunchAssistant|aria-pressed=\{isAssistantSidebarOpen\}/);
  assert.match(actionCluster, /onAdjustToSinglePage/);
});
