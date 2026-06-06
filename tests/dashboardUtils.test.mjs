import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import { build } from 'esbuild';

const importDashboardUtils = async () => {
  const result = await build({
    entryPoints: ['views/Dashboard/dashboardUtils.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const source = result.outputFiles[0].text;
  const encoded = Buffer.from(source).toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
};

const resume = (overrides = {}) => ({
  id: 'resume-1',
  name: 'Resume',
  targetRole: 'PM',
  matchRate: 0,
  createdAt: '2026-01-01',
  lastModified: 'today',
  status: 'draft',
  type: 'standard',
  ...overrides,
});

test('mergeMatchRatesIntoResumes applies local match rates and preserves unchanged array identity', async () => {
  const { mergeMatchRatesIntoResumes } = await importDashboardUtils();
  const items = [
    resume({ id: 'a', matchRate: 0, status: 'draft' }),
    resume({ id: 'b', matchRate: 20, status: 'final' }),
  ];

  const unchanged = mergeMatchRatesIntoResumes(items, () => undefined);
  const changed = mergeMatchRatesIntoResumes(items, (id) => (id === 'a' ? 82 : undefined));

  assert.equal(unchanged, items);
  assert.notEqual(changed, items);
  assert.deepEqual(changed.map((item) => [item.id, item.matchRate, item.status]), [
    ['a', 82, 'final'],
    ['b', 20, 'final'],
  ]);
});

test('areResumeListsEqual compares dashboard visible resume fields in order', async () => {
  const { areResumeListsEqual } = await importDashboardUtils();
  const first = [resume({ id: 'a' }), resume({ id: 'b' })];
  const same = [resume({ id: 'a' }), resume({ id: 'b' })];
  const renamed = [resume({ id: 'a', name: 'Renamed' }), resume({ id: 'b' })];
  const reordered = [resume({ id: 'b' }), resume({ id: 'a' })];

  assert.equal(areResumeListsEqual(first, first), true);
  assert.equal(areResumeListsEqual(first, same), true);
  assert.equal(areResumeListsEqual(first, renamed), false);
  assert.equal(areResumeListsEqual(first, reordered), false);
});

test('removeResumeIds and filterExistingResumeIds keep deletion cleanup deterministic', async () => {
  const { filterExistingResumeIds, removeResumeIds } = await importDashboardUtils();
  const items = [resume({ id: 'a' }), resume({ id: 'b' }), resume({ id: 'c' })];

  assert.deepEqual(removeResumeIds(items, ['b']).map((item) => item.id), ['a', 'c']);
  assert.deepEqual(filterExistingResumeIds(['a', 'missing', 'c'], items), ['a', 'c']);
});
