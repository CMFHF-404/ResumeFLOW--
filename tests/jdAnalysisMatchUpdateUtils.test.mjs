import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import { build } from 'esbuild';

const importJDAnalysisMatchUpdateUtils = async () => {
  const result = await build({
    entryPoints: ['hooks/jdAnalysisMatchUpdateUtils.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const source = result.outputFiles[0].text;
  const encoded = Buffer.from(source).toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
};

const buildExperience = (id, overrides = {}) => ({
  id,
  title: `Title ${id}`,
  company: `Company ${id}`,
  category: 'work',
  startDate: '2025-01',
  endDate: '2025-12',
  star: { s: '', t: '', a: '', r: '' },
  ...overrides,
});

test('applies full experience score and reason updates', async () => {
  const { applyExperienceScoreUpdate } = await importJDAnalysisMatchUpdateUtils();
  const items = [
    buildExperience('exp-1', { matchScore: 10, matchReason: 'old' }),
    buildExperience('exp-2', { matchScore: 20, matchReason: 'old' }),
  ];

  const next = applyExperienceScoreUpdate(items, [
    { id: 'exp-1', score: 88, reason: 'strong' },
  ]);

  assert.equal(next[0].matchScore, 88);
  assert.equal(next[0].matchReason, 'strong');
  assert.equal(next[1].matchScore, undefined);
  assert.equal(next[1].matchReason, undefined);
});

test('applies partial experience score updates only to target ids', async () => {
  const { applyExperienceScoreUpdate } = await importJDAnalysisMatchUpdateUtils();
  const items = [
    buildExperience('exp-1', { matchScore: 10, matchReason: 'old-1' }),
    buildExperience('exp-2', { matchScore: 20, matchReason: 'old-2' }),
  ];

  const next = applyExperienceScoreUpdate(
    items,
    [{ id: 'exp-1', score: 70, reason: 'updated' }],
    { mode: 'partial', targetIds: new Set(['exp-1']) }
  );

  assert.equal(next[0].matchScore, 70);
  assert.equal(next[0].matchReason, 'updated');
  assert.equal(next[1], items[1]);
});

test('applies experience trends and clears missing trends in full mode', async () => {
  const { applyExperienceTrendUpdate } = await importJDAnalysisMatchUpdateUtils();
  const items = [
    buildExperience('exp-1', { matchTrend: 'down' }),
    buildExperience('exp-2', { matchTrend: 'up' }),
  ];

  const next = applyExperienceTrendUpdate(items, [
    { id: 'exp-1', score: 88, trend: 'up' },
  ]);

  assert.equal(next[0].matchTrend, 'up');
  assert.equal(next[1].matchTrend, undefined);
});

test('applies partial score map updates and deletes missing target scores', async () => {
  const { applyScoreMapUpdateValue } = await importJDAnalysisMatchUpdateUtils();
  const prev = new Map([
    ['a', 10],
    ['b', 20],
    ['c', 30],
  ]);
  const scores = new Map([['a', 99]]);

  const next = applyScoreMapUpdateValue(prev, scores, {
    mode: 'partial',
    targetIds: new Set(['a', 'b']),
  });

  assert.deepEqual([...next.entries()].sort(), [
    ['a', 99],
    ['c', 30],
  ]);
});

test('builds skill score map with zero defaults for missing full-mode skills', async () => {
  const { buildSkillScoreUpdateMap } = await importJDAnalysisMatchUpdateUtils();
  const scoreMap = buildSkillScoreUpdateMap(
    [{ id: 'skill-1', score: 75 }],
    [
      {
        id: 'group-1',
        name: 'Product',
        skills: [
          { id: 'skill-1', name: 'Roadmap' },
          { id: 'skill-2', name: 'Metrics' },
        ],
      },
    ]
  );

  assert.deepEqual([...scoreMap.entries()].sort(), [
    ['skill-1', 75],
    ['skill-2', 0],
  ]);
});

test('skips partial skill score update when matches are missing', async () => {
  const { buildSkillScoreUpdateMap } = await importJDAnalysisMatchUpdateUtils();

  const scoreMap = buildSkillScoreUpdateMap(undefined, [], {
    mode: 'partial',
    targetIds: new Set(['skill-1']),
  });

  assert.equal(scoreMap, null);
});

test('clears stale experience and map targets', async () => {
  const {
    clearStaleExperienceMatches,
    updateStaleExperienceIds,
    clearMapTargets,
  } = await importJDAnalysisMatchUpdateUtils();
  const items = [
    buildExperience('exp-1', { matchScore: 10, matchReason: 'old', matchTrend: 'up' }),
    buildExperience('exp-2', { matchScore: 20, matchReason: 'keep', matchTrend: 'same' }),
  ];

  const nextItems = clearStaleExperienceMatches(items, new Set(['exp-1']));
  const nextStaleIds = updateStaleExperienceIds(new Set(['exp-old']), new Set(['exp-1']));
  const nextMap = clearMapTargets(new Map([
    ['a', 1],
    ['b', 2],
  ]), new Set(['a']));

  assert.equal(nextItems[0].matchScore, undefined);
  assert.equal(nextItems[0].matchReason, undefined);
  assert.equal(nextItems[0].matchTrend, undefined);
  assert.equal(nextItems[1].matchScore, 20);
  assert.deepEqual([...nextStaleIds].sort(), ['exp-1', 'exp-old']);
  assert.deepEqual([...nextMap.entries()], [['b', 2]]);
});
