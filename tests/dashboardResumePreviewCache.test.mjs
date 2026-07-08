import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import { build } from 'esbuild';

const importPreviewCache = async () => {
  const result = await build({
    entryPoints: ['views/Dashboard/dashboardResumePreviewCache.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const source = result.outputFiles[0].text;
  const encoded = Buffer.from(source).toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
};

test('buildDashboardResumePreviewCacheKey invalidates previews by updated timestamp', async () => {
  const { buildDashboardResumePreviewCacheKey } = await importPreviewCache();

  assert.equal(
    buildDashboardResumePreviewCacheKey('resume-1', '2026-07-08T10:00:00.000Z'),
    'resume-1::2026-07-08T10:00:00.000Z'
  );
  assert.notEqual(
    buildDashboardResumePreviewCacheKey('resume-1', '2026-07-08T10:00:00.000Z'),
    buildDashboardResumePreviewCacheKey('resume-1', '2026-07-08T10:05:00.000Z')
  );
});

test('buildDashboardResumePreviewCacheKey invalidates previews by shared preview data revision', async () => {
  const { buildDashboardResumePreviewCacheKey } = await importPreviewCache();

  assert.equal(
    buildDashboardResumePreviewCacheKey('resume-1', '2026-07-08T10:00:00.000Z', 3),
    'resume-1::2026-07-08T10:00:00.000Z::3'
  );
  assert.notEqual(
    buildDashboardResumePreviewCacheKey('resume-1', '2026-07-08T10:00:00.000Z', 3),
    buildDashboardResumePreviewCacheKey('resume-1', '2026-07-08T10:00:00.000Z', 4)
  );
});

test('buildDashboardResumePreviewCacheKey isolates previews by owner', async () => {
  const { buildDashboardResumePreviewCacheKey } = await importPreviewCache();

  assert.equal(
    buildDashboardResumePreviewCacheKey('resume-1', '2026-07-08T10:00:00.000Z', 3, 'user-a'),
    'user-a::resume-1::2026-07-08T10:00:00.000Z::3'
  );
  assert.notEqual(
    buildDashboardResumePreviewCacheKey('resume-1', '2026-07-08T10:00:00.000Z', 3, 'user-a'),
    buildDashboardResumePreviewCacheKey('resume-1', '2026-07-08T10:00:00.000Z', 3, 'user-b')
  );
});

test('resolveDashboardResumePreviewEntry drops stale snapshots and errors', async () => {
  const { resolveDashboardResumePreviewEntry } = await importPreviewCache();
  const fresh = {
    cacheKey: 'resume-1::2026-07-08T10:00:00.000Z',
    status: 'ready',
    snapshot: { resumeId: 'resume-1', state: {} },
  };
  const stale = {
    cacheKey: 'resume-1::2026-07-08T09:00:00.000Z',
    status: 'error',
    error: 'failed',
  };

  assert.equal(
    resolveDashboardResumePreviewEntry(fresh, 'resume-1', '2026-07-08T10:00:00.000Z'),
    fresh
  );
  assert.deepEqual(
    resolveDashboardResumePreviewEntry(stale, 'resume-1', '2026-07-08T10:00:00.000Z'),
    {
      cacheKey: 'resume-1::2026-07-08T10:00:00.000Z',
      status: 'idle',
    }
  );
});

test('dashboard preview queue prioritizes visible work and preserves fifo within priority', async () => {
  const {
    takeNextDashboardResumePreviewQueueItem,
    upsertDashboardResumePreviewQueueItem,
  } = await importPreviewCache();

  let queue = [];
  queue = upsertDashboardResumePreviewQueueItem(queue, {
    resumeId: 'nearby-a',
    cacheKey: 'nearby-a::v1',
    priority: 'nearby',
    sequence: 1,
  });
  queue = upsertDashboardResumePreviewQueueItem(queue, {
    resumeId: 'visible-a',
    cacheKey: 'visible-a::v1',
    priority: 'visible',
    sequence: 2,
  });
  queue = upsertDashboardResumePreviewQueueItem(queue, {
    resumeId: 'visible-b',
    cacheKey: 'visible-b::v1',
    priority: 'visible',
    sequence: 3,
  });

  const first = takeNextDashboardResumePreviewQueueItem(queue);
  assert.equal(first.next.resumeId, 'visible-a');
  const second = takeNextDashboardResumePreviewQueueItem(first.remaining);
  assert.equal(second.next.resumeId, 'visible-b');
  const third = takeNextDashboardResumePreviewQueueItem(second.remaining);
  assert.equal(third.next.resumeId, 'nearby-a');
  assert.deepEqual(third.remaining, []);
});

test('dashboard preview queue upgrades existing nearby work without losing fifo order', async () => {
  const {
    takeNextDashboardResumePreviewQueueItem,
    upsertDashboardResumePreviewQueueItem,
  } = await importPreviewCache();

  let queue = [];
  queue = upsertDashboardResumePreviewQueueItem(queue, {
    resumeId: 'resume-a',
    cacheKey: 'resume-a::v1',
    priority: 'nearby',
    sequence: 1,
  });
  queue = upsertDashboardResumePreviewQueueItem(queue, {
    resumeId: 'resume-b',
    cacheKey: 'resume-b::v1',
    priority: 'visible',
    sequence: 2,
  });
  queue = upsertDashboardResumePreviewQueueItem(queue, {
    resumeId: 'resume-a',
    cacheKey: 'resume-a::v1',
    priority: 'visible',
    sequence: 99,
  });

  const first = takeNextDashboardResumePreviewQueueItem(queue);
  assert.equal(first.next.resumeId, 'resume-a');
  assert.equal(first.next.sequence, 1);
  const second = takeNextDashboardResumePreviewQueueItem(first.remaining);
  assert.equal(second.next.resumeId, 'resume-b');
});

test('dashboard preview entries can represent queued loading work', async () => {
  const {
    resolveDashboardResumePreviewEntry,
    shouldLoadDashboardResumePreviewEntry,
  } = await importPreviewCache();
  const queued = {
    cacheKey: 'resume-1::2026-07-08T10:00:00.000Z',
    status: 'queued',
  };

  assert.equal(
    resolveDashboardResumePreviewEntry(queued, 'resume-1', '2026-07-08T10:00:00.000Z'),
    queued
  );
  assert.equal(shouldLoadDashboardResumePreviewEntry(queued), false);
});

test('dashboard preview queue completion ignores stale reset generations', async () => {
  const { isDashboardResumePreviewQueueGenerationCurrent } = await importPreviewCache();

  assert.equal(isDashboardResumePreviewQueueGenerationCurrent(2, 2), true);
  assert.equal(isDashboardResumePreviewQueueGenerationCurrent(2, 1), false);
});
