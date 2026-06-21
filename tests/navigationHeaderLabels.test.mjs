import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Dashboard header is renamed to 我的简历 without the English suffix', () => {
  const dashboard = read('views/Dashboard.tsx');

  assert.match(dashboard, />我的简历</);
  assert.doesNotMatch(dashboard, /仪表盘\s*\/\s*Dashboard/);
});

test('Experience Bank header keeps only the Chinese label', () => {
  const experienceBank = read('views/ExperienceBank.tsx');

  assert.match(experienceBank, />经历库</);
  assert.doesNotMatch(experienceBank, /经历库\s*\/\s*Experience Bank/);
});
