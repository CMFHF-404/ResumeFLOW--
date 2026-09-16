import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { getCompatibleScoreSuggestionAdditions as additions, scoreSuggestionsConflict as conflict } from '../utils/resumeScore.mjs';

const row = (id, kind, moduleId = 'exp1', fieldPath = kind, selectedItems = []) => ({
  suggestionId: id, moduleType: kind, moduleId, fieldPath, selectedItems,
  editable: true, problem: id, label: id, direction: id,
});
const rows = [row('restructure', 'experience_restructure'), row('action', 'experience_star', 'exp1', 'star.a'),
  row('result', 'experience_star', 'exp1', 'star.r'), row('hide', 'experience_hide'),
  row('summary', 'personal_summary', 'current_resume')];

test('bulk selection preserves user choices and excludes mutually exclusive experience changes', () => {
  assert.deepEqual(additions(rows, []), ['restructure', 'summary']);
  assert.deepEqual(additions(rows, ['action']), ['result', 'summary']);
  assert.deepEqual(additions(rows, ['hide']), ['summary']);
  assert.deepEqual(additions(rows, ['action', 'result', 'summary']), []);
  assert.equal(conflict(rows[1], rows[2]), false);
  assert.equal(conflict(rows[0], row('other', 'experience_star', 'exp2', 'star.a')), false);
  assert.equal(conflict(rows[0], row('same', 'experience_restructure')), false);
});

test('bulk selection respects skill and deterministic selection conflicts and blocked rows', () => {
  const create = row('create', 'skill_create', 'new:1');
  const order = row('order', 'skills_order', 'skills');
  const courseA = row('courses-a', 'education_courses', 'edu1', 'education_courses', ['course-1']);
  const courseB = row('courses-b', 'education_courses', 'edu1', 'education_courses', ['course-2']);
  const candidates = [create, order, courseA, courseB, { ...rows[0], editable: false },
    { ...rows[1], executionBlockReason: { code: 'parameters_invalid' } }];
  const before = structuredClone(candidates);
  assert.deepEqual(additions(candidates, []), ['create', 'order', 'courses-a']);
  assert.deepEqual(additions(candidates, ['order', 'courses-b']), ['create']);
  assert.equal(conflict(courseA, { ...courseA, suggestionId: 'same-choice' }), false);
  assert.equal(conflict(create, order), false);
  assert.equal(conflict(order, create), false);
  assert.deepEqual(candidates, before);
});

test('report bulk button selects a compatible batch, clears it, and lets the user choose an alternative', async t => {
  let browser;
  for (const executablePath of [undefined, ...[
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ].filter(existsSync)]) {
    try { browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) }); break; }
    catch { /* Try the next installed Chromium runtime. */ }
  }
  assert.ok(browser, 'A Chromium runtime is required for this interaction regression');
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.route('**/*', route => route.abort());
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const bundle = await build({
    stdin: { contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {ScoreActionList} from './views/ResumeEditor/components/ResumeEvaluationReport/ScoreActionList';
      import {ScoreAnnotationProvider,useScoreAnnotations} from './views/ResumeEditor/components/ResumeEvaluationReport/ScoreAnnotations';
      const rows = ${JSON.stringify([...rows,
        {...row('create','skill_create','new:1'),diagnosticId:'diag-create'},
        {...row('order','skills_order','skills'),diagnosticId:'diag-order'}])};
      function Selection(){const state=useScoreAnnotations();return <output>{JSON.stringify(state.selected)}</output>}
      createRoot(document.getElementById('root')).render(
        <ScoreAnnotationProvider suggestions={rows} reportKey="test">
          <ScoreActionList suggestions={rows} disabled={false}/>
          <Selection/>
        </ScoreAnnotationProvider>);
    `, resolveDir: process.cwd(), loader: 'tsx' },
    bundle: true, format: 'iife', platform: 'browser', write: false, logLevel: 'silent',
  });
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const checkbox = id => page.getByRole('checkbox', { name: `选择方案：${id}`, exact: true });
  await page.getByRole('button', { name: '选择可兼容方案', exact: true }).click();
  assert.equal(await checkbox('restructure').isChecked(), true);
  assert.equal(await checkbox('summary').isChecked(), true);
  assert.equal(await checkbox('action').isDisabled(), true);
  await page.getByRole('button', { name: '取消选择', exact: true }).click();
  assert.equal(await checkbox('restructure').isChecked(), false);
  await checkbox('action').check();
  await page.getByRole('button', { name: '选择可兼容方案', exact: true }).click();
  assert.equal(await checkbox('action').isChecked(), true);
  assert.equal(await checkbox('result').isChecked(), true);
  assert.equal(await checkbox('restructure').isDisabled(), true);
  assert.equal(await checkbox('hide').isDisabled(), true);
  const create=checkbox('create'), order=checkbox('order');
  const combined=page.getByRole('status',{name:'技能合并处理提示'});
  assert.equal(await create.isChecked(),true);
  assert.equal(await order.isChecked(),true);
  assert.match(await combined.textContent(),/将合并处理/);
  assert.equal(await page.locator('#review-diag-order').count(),1);
  await create.uncheck();
  assert.equal(await order.isChecked(),true);
  assert.equal(await combined.count(),0);
  let selection=JSON.parse(await page.locator('output').textContent());
  assert.equal(selection.includes('create'),false);
  assert.equal(selection.includes('order'),true);
  await order.uncheck();
  await create.check();
  assert.equal(await order.isEnabled(),true);
  assert.equal(await order.isChecked(),false);
  assert.equal(await combined.count(),0);
  await order.check();
  selection=JSON.parse(await page.locator('output').textContent());
  assert.ok(selection.includes('create')&&selection.includes('order'));
  assert.match(await combined.textContent(),/将合并处理/);
  assert.deepEqual(errors, []);
});
