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
