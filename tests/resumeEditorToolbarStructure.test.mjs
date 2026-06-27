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
  assert.match(actionCluster, /onAdjustToSinglePage/);
});
