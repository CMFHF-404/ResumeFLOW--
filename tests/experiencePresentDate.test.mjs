import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
const result = await build({ stdin: { contents: `export * from './views/ExperienceSection/cardDataUtils'; export { buildResumeExperienceView } from './views/ResumeEditor/helpers'; export { buildExperienceDate } from './utils/dateUtils';`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', write: false });
const { buildVersionPayload, buildExperienceCardData, applyOptimisticSave, buildResumeExperienceView, buildExperienceDate } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const card = end_date => ({ org: '示例公司', title: '产品经理', start_date: '2024.12', end_date, star: { s: '', t: '', a: '', r: '' }, editMode: 'expert', simpleText: '' });
const item = version => ({ master: { id: 'experience-1', category: 'project', is_archived: false }, latest_version: { id: 'version-1', ...version } });

test('present month selection survives JSON save and renders in the resume factory', () => {
  for (const label of ['至今', 'Present']) {
    const payload = JSON.parse(JSON.stringify(buildVersionPayload(card(label))));
    assert.equal(payload.is_current, true);
    assert.equal(payload.end_date, undefined);
    const saved = item({ ...payload, end_date: null });
    assert.equal(buildResumeExperienceView(saved).date, '2024.12 - 至今');
    assert.equal(buildExperienceCardData(saved).end_date, '至今');
  }
});

test('reading an existing current experience and editing its text preserves current state', () => {
  const loaded = buildExperienceCardData(item({ start_date: '2024-12-01', end_date: null, is_current: true }));
  assert.equal(loaded.end_date, '至今');
  loaded.star.s = '更新描述';
  assert.equal(buildVersionPayload(loaded).is_current, true);
});

test('changing present to a month or clearing it explicitly clears current state', () => {
  for (const [end, expected] of [['2025.10', '2025-10-01'], ['', undefined]]) {
    const payload = buildVersionPayload(card(end));
    assert.equal(payload.is_current, false);
    assert.equal(payload.end_date, expected);
  }
  assert.equal(buildExperienceDate('2024-12-01', ''), '2024.12');
});

test('optimistic save updates current state in both directions instead of retaining the old flag', () => {
  for (const end of ['至今', '2025.10', '']) {
    let items = [item({ is_current: end !== '至今', end_date: '2025-01-01' })];
    applyOptimisticSave('experience-1', card(end), update => update(new Map()), update => update(new Set()), update => { items = update(items); });
    assert.equal(items[0].latest_version.is_current, end === '至今');
    assert.equal(buildResumeExperienceView(items[0]).date, end === '至今' ? '2024.12 - 至今' : end ? '2024.12 - 2025.10' : '2024.12');
  }
});
