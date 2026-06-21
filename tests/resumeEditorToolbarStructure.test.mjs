import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('desktop editor toolbar places template beside the AI action', () => {
  const toolbar = read('views/ResumeEditor/components/EditorToolbar.tsx');
  const titleCluster = toolbar.match(
    /<div className="hidden items-center gap-2 md:flex">[\s\S]*?<div className="hidden h-6 w-px/
  )?.[0] ?? '';
  const actionCluster = toolbar.match(
    /<div className="flex flex-wrap items-center gap-2 md:justify-end md:gap-4">[\s\S]*?<div className="inline-flex items-center">/
  )?.[0] ?? '';

  assert.match(titleCluster, /简历工厂/);
  assert.doesNotMatch(titleCluster, /onOpenTemplateSelector/);
  assert.match(actionCluster, /onOpenTemplateSelector[\s\S]*onLaunchAssistant/);
});
