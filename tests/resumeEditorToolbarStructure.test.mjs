import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('desktop editor toolbar keeps primary actions without template or manual layout toggles', () => {
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
  assert.match(actionCluster, /onLaunchAssistant/);
  assert.match(toolbar, /isAssistantSidebarOpen\?: boolean/);
  assert.match(toolbar, /isAssistantSidebarOpen = false/);
  assert.match(toolbar, /const isAssistantButtonDisabled = !canLaunchAssistant && !isAssistantSidebarOpen;/);
  assert.match(toolbar, /const assistantButtonTitle = isAssistantSidebarOpen\s*\?\s*'关闭 AI 侧栏'\s*:\s*canLaunchAssistant\s*\?\s*'带着当前简历打开 AI 助理'\s*:\s*'当前简历加载中';/);
  assert.match(actionCluster, /aria-pressed=\{isAssistantSidebarOpen\}/);
  assert.match(actionCluster, /disabled=\{isAssistantButtonDisabled\}/);
  assert.match(actionCluster, /title=\{assistantButtonTitle\}/);
  assert.match(actionCluster, /isAssistantSidebarOpen\s*\?\s*'border border-emerald-200 bg-emerald-50 text-emerald-700 shadow-sm shadow-emerald-100\/70 hover:bg-emerald-100 dark:border-emerald-500\/30 dark:bg-emerald-500\/15 dark:text-emerald-200 dark:shadow-none'/);
  assert.match(actionCluster, /:\s*'ai-active-gradient text-white hover:opacity-90'/);
  assert.match(actionCluster, /onAdjustToSinglePage/);
});
