import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('ExperienceTab toolbar keeps add-copy and action buttons on one line', () => {
  const experienceTab = read('views/ResumeEditor/components/ExperienceTab.tsx');
  const matchScoreFilter = read('views/ResumeEditor/components/MatchScoreFilter.tsx');
  const desktopWorkspace = read('views/ResumeEditor/components/ResumeEditorDesktopWorkspace.tsx');

  assert.match(experienceTab, /勾选以加入简历/);
  assert.doesNotMatch(experienceTab, /当前可选添加经历项/);
  assert.match(experienceTab, /className="flex min-w-0 items-center justify-between gap-2"/);
  assert.match(experienceTab, /className="flex shrink-0 items-center gap-1\.5"/);
  assert.match(experienceTab, /className="[^"]*whitespace-nowrap[^"]*bg-violet-600/);
  assert.match(experienceTab, /className="[^"]*whitespace-nowrap[^"]*bg-emerald-50/);
  assert.match(matchScoreFilter, /className=\{`inline-flex whitespace-nowrap items-center/);
  assert.match(desktopWorkspace, /md:w-\[430px\]/);
  assert.match(desktopWorkspace, /xl:w-\[460px\]/);
});
