import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import { build } from 'esbuild';

const importCoordinator = async () => {
  const result = await build({
    entryPoints: ['hooks/resumeConfigSaveCoordinator.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const encoded = Buffer.from(result.outputFiles[0].text).toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
};

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const createHarness = async (persist) => {
  const { createResumeConfigSaveCoordinator } = await importCoordinator();
  let resumeId = 'resume-1';
  let expectedUpdatedAt = 'version-1';
  let lastSavedSignature = JSON.stringify({ value: 'saved' });
  let hydrated = true;
  const calls = [];
  const coordinator = createResumeConfigSaveCoordinator({
    getResumeId: () => resumeId,
    getExpectedUpdatedAt: () => expectedUpdatedAt,
    getLastSavedSignature: () => lastSavedSignature,
    isHydrated: () => hydrated,
    persist: async (resumeId, config, expected) => {
      calls.push({ resumeId, config, expected });
      return persist(config, expected);
    },
    onSaveStart: () => undefined,
    onSaveSuccess: (_resumeId, result, signature) => {
      expectedUpdatedAt = result.updated_at;
      lastSavedSignature = signature;
    },
  });
  return {
    coordinator,
    calls,
    setResumeId: (nextResumeId) => {
      resumeId = nextResumeId;
    },
    setHydrated: (nextHydrated) => {
      hydrated = nextHydrated;
    },
  };
};

test('forceVersionCheck validates an unchanged config instead of returning early', async () => {
  const harness = await createHarness(async () => ({ updated_at: 'version-2' }));

  await harness.coordinator.save(
    { value: 'saved' },
    { forceVersionCheck: true }
  );

  assert.deepEqual(harness.calls, [{
    resumeId: 'resume-1',
    config: { value: 'saved' },
    expected: 'version-1',
  }]);
});

test('a flush waits for an identical in-flight autosave without issuing a duplicate PATCH', async () => {
  const first = deferred();
  const harness = await createHarness(() => first.promise);
  const config = { value: 'next' };

  const autoSave = harness.coordinator.save(config);
  await Promise.resolve();
  await Promise.resolve();
  const flush = harness.coordinator.save(config, { forceVersionCheck: true });
  first.resolve({ updated_at: 'version-2' });

  await Promise.all([autoSave, flush]);
  assert.equal(harness.calls.length, 1);
  assert.equal(harness.calls[0].expected, 'version-1');
});

test('a newer flush runs after autosave and uses the returned concurrency token', async () => {
  const first = deferred();
  let callCount = 0;
  const harness = await createHarness(async () => {
    callCount += 1;
    return callCount === 1
      ? first.promise
      : { updated_at: 'version-3' };
  });

  const autoSave = harness.coordinator.save({ value: 'debounced' });
  await Promise.resolve();
  await Promise.resolve();
  const flush = harness.coordinator.save(
    { value: 'latest' },
    { forceVersionCheck: true }
  );
  first.resolve({ updated_at: 'version-2' });

  await Promise.all([autoSave, flush]);
  assert.deepEqual(harness.calls.map((call) => call.expected), [
    'version-1',
    'version-2',
  ]);
});

test('a save pending for another resume cannot satisfy the current resume version barrier', async () => {
  const first = deferred();
  let callCount = 0;
  const harness = await createHarness(async () => {
    callCount += 1;
    return callCount === 1
      ? first.promise
      : { updated_at: 'resume-2-version-2' };
  });

  const oldResumeSave = harness.coordinator.save({ value: 'old-resume-change' });
  await Promise.resolve();
  await Promise.resolve();
  harness.setResumeId('resume-2');
  const currentBarrier = harness.coordinator.save(
    { value: 'saved' },
    { forceVersionCheck: true }
  );
  first.resolve({ updated_at: 'resume-1-version-2' });

  await Promise.all([oldResumeSave, currentBarrier]);
  assert.equal(harness.calls.length, 2);
  assert.equal(harness.calls[1].resumeId, 'resume-2');
});

test('drain waits for an in-flight save and hydration blocks its stale success callback', async () => {
  const first = deferred();
  const harness = await createHarness(() => first.promise);

  const save = harness.coordinator.save({ value: 'next' });
  await Promise.resolve();
  await Promise.resolve();
  harness.setHydrated(false);
  let drained = false;
  const drain = harness.coordinator.drain().then(() => {
    drained = true;
  });

  await Promise.resolve();
  assert.equal(drained, false);
  first.resolve({ updated_at: 'version-2' });
  await Promise.all([save, drain]);

  harness.setHydrated(true);
  await harness.coordinator.save(
    { value: 'saved' },
    { forceVersionCheck: true }
  );
  assert.equal(harness.calls[1].expected, 'version-1');
});
