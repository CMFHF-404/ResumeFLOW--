import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import { build } from 'esbuild';

const importBundledModule = async (entryPoint) => {
  const result = await build({
    entryPoints: [entryPoint],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const encoded = Buffer.from(result.outputFiles[0].text).toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
};

test('date utilities preserve accepted month inputs and invalid-date handling', async () => {
  const {
    convertDateToISO,
    formatYearMonth,
    normalizeDateInput,
    parseYearMonthValue,
  } = await importBundledModule('utils/dateUtils.ts');

  assert.equal(convertDateToISO(' 2017年9月 '), '2017-09-01');
  assert.equal(convertDateToISO('2017/12/31'), '2017-12-01');
  assert.equal(convertDateToISO('2017-13'), undefined);
  assert.equal(formatYearMonth('2017-09-28'), '2017.09');
  assert.equal(normalizeDateInput(' '), undefined);
  assert.equal(parseYearMonthValue('2017.09'), 2017 * 12 + 9);
  assert.equal(parseYearMonthValue('至今'), null);
});

test('deduped refresh shares an in-flight task and clears only its own request', async () => {
  const { runDedupedRefresh } = await importBundledModule('utils/asyncUtils.ts');
  const inFlightRef = { current: null };
  let resolveTask;
  let taskCalls = 0;
  const task = () => {
    taskCalls += 1;
    return new Promise((resolve) => {
      resolveTask = resolve;
    });
  };

  const first = runDedupedRefresh(inFlightRef, task);
  const second = runDedupedRefresh(inFlightRef, task);
  assert.equal(taskCalls, 1);

  resolveTask('done');
  assert.deepEqual(await Promise.all([first, second]), ['done', 'done']);
  assert.equal(inFlightRef.current, null);
});

test('experience view facade keeps legacy exports available', async () => {
  const facade = await importBundledModule('views/experienceUtils.ts');

  assert.equal(facade.convertDateToISO('2026.07'), '2026-07-01');
  assert.equal(facade.resolveCardMotionClass(false), 'card-edge-motion card-edge-expand');
  assert.equal(typeof facade.runDedupedRefresh, 'function');
});
