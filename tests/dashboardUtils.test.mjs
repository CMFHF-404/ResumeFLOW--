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
  createdAtValue: '2026-01-01T00:00:00.000Z',
  lastModified: 'today',
  updatedAtValue: '2026-01-01T12:00:00.000Z',
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

test('filterSelectedDashboardResumeIds drops hidden filtered selections', async () => {
  const { filterSelectedDashboardResumeIds } = await importDashboardUtils();
  const visible = [resume({ id: 'visible-a' }), resume({ id: 'visible-b' })];

  assert.deepEqual(
    filterSelectedDashboardResumeIds(['hidden', 'visible-b', 'visible-a'], visible),
    ['visible-b', 'visible-a']
  );
});

test('mergeDashboardResumeServerUpdate preserves the raw updated timestamp for sorting', async () => {
  const { mergeDashboardResumeServerUpdate } = await importDashboardUtils();
  const updatedAt = '2026-06-19T12:30:00.000Z';
  const current = resume({
    id: 'resume-1',
    name: 'Old title',
    updatedAtValue: '2026-01-01T00:00:00.000Z',
  });

  const merged = mergeDashboardResumeServerUpdate(current, {
    id: 'resume-1',
    title: 'New title',
    updated_at: updatedAt,
  });

  assert.equal(merged.name, 'New title');
  assert.equal(merged.updatedAtValue, updatedAt);
});

test('getVisibleDashboardResumes searches names with trimmed case-insensitive text', async () => {
  const { getVisibleDashboardResumes } = await importDashboardUtils();
  const items = [
    resume({ id: 'a', name: 'AI Product Manager' }),
    resume({ id: 'b', name: 'User Operations' }),
    resume({ id: 'c', name: 'ai research intern' }),
  ];

  const visible = getVisibleDashboardResumes(items, { searchQuery: '  AI  ' });

  assert.deepEqual(visible.map((item) => item.id), ['a', 'c']);
});

test('getVisibleDashboardResumes filters creation time by presets and custom ranges', async () => {
  const { getVisibleDashboardResumes } = await importDashboardUtils();
  const items = [
    resume({ id: 'old', createdAtValue: '2026-01-01T00:00:00.000Z' }),
    resume({ id: 'recent', createdAtValue: '2026-06-15T00:00:00.000Z' }),
    resume({ id: 'range', createdAtValue: '2026-05-20T00:00:00.000Z' }),
  ];

  const recent = getVisibleDashboardResumes(items, {
    nowMs: Date.parse('2026-06-19T00:00:00.000Z'),
    timeFilter: { preset: '7d', startDate: '', endDate: '' },
  });
  const custom = getVisibleDashboardResumes(items, {
    timeFilter: { preset: 'custom', startDate: '2026-05-01', endDate: '2026-05-31' },
  });

  assert.deepEqual(recent.map((item) => item.id), ['recent']);
  assert.deepEqual(custom.map((item) => item.id), ['range']);
});

test('getVisibleDashboardResumes filters match rate by presets and clamped custom ranges', async () => {
  const { getVisibleDashboardResumes } = await importDashboardUtils();
  const items = [
    resume({ id: 'draft', matchRate: 0 }),
    resume({ id: 'good', matchRate: 82 }),
    resume({ id: 'great', matchRate: 94 }),
  ];

  const preset = getVisibleDashboardResumes(items, {
    matchFilter: { preset: '80', min: '', max: '' },
  });
  const custom = getVisibleDashboardResumes(items, {
    matchFilter: { preset: 'custom', min: '90', max: '160' },
  });

  assert.deepEqual(preset.map((item) => item.id), ['good', 'great']);
  assert.deepEqual(custom.map((item) => item.id), ['great']);
});

test('getVisibleDashboardResumes sorts by creation time, updated time, and match rate stably', async () => {
  const { getVisibleDashboardResumes } = await importDashboardUtils();
  const items = [
    resume({
      id: 'a',
      matchRate: 80,
      createdAtValue: '2026-01-01T00:00:00.000Z',
      updatedAtValue: '2026-02-01T00:00:00.000Z',
    }),
    resume({
      id: 'b',
      matchRate: 95,
      createdAtValue: '2026-03-01T00:00:00.000Z',
      updatedAtValue: '2026-01-15T00:00:00.000Z',
    }),
    resume({
      id: 'c',
      matchRate: 80,
      createdAtValue: '2026-02-01T00:00:00.000Z',
      updatedAtValue: '2026-04-01T00:00:00.000Z',
    }),
  ];

  assert.deepEqual(getVisibleDashboardResumes(items, { sortMode: 'created-desc' }).map((item) => item.id), ['b', 'c', 'a']);
  assert.deepEqual(getVisibleDashboardResumes(items, { sortMode: 'created-asc' }).map((item) => item.id), ['a', 'c', 'b']);
  assert.deepEqual(getVisibleDashboardResumes(items, { sortMode: 'updated-desc' }).map((item) => item.id), ['c', 'a', 'b']);
  assert.deepEqual(getVisibleDashboardResumes(items, { sortMode: 'match-desc' }).map((item) => item.id), ['b', 'a', 'c']);
  assert.deepEqual(getVisibleDashboardResumes(items, { sortMode: 'match-asc' }).map((item) => item.id), ['a', 'c', 'b']);
});

test('resolveDropdownPosition keeps the menu within the viewport and opens upward near the bottom', async () => {
  const { resolveDropdownPosition } = await importDashboardUtils();
  const position = resolveDropdownPosition(
    { top: 520, right: 390, bottom: 560, left: 350 },
    { width: 192, height: 180 },
    { width: 400, height: 600 }
  );

  assert.deepEqual(position, { top: 336, left: 198 });
});

test('resolveDropdownPosition can be called without window when viewport is omitted', async () => {
  const { resolveDropdownPosition } = await importDashboardUtils();
  const position = resolveDropdownPosition(
    { top: 10, right: 60, bottom: 30, left: 20 },
    { width: 192, height: 180 }
  );

  assert.deepEqual(position, { top: 8, left: 8 });
});
