import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const loadSchedulerModule = async () => {
  const result = await build({
    entryPoints: ['views/ResumeEditor/hooks/previewMeasurementScheduler.ts'],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
  });
  const encoded = Buffer.from(result.outputFiles[0].text).toString('base64');
  return import(`data:text/javascript;base64,${encoded}#${Date.now()}-${Math.random()}`);
};

const flushAsyncWork = async () => {
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
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

const createFrameHarness = () => {
  let nextFrameId = 1;
  const frames = new Map();
  return {
    frames,
    requestFrame(callback) {
      const frameId = nextFrameId;
      nextFrameId += 1;
      frames.set(frameId, callback);
      return frameId;
    },
    cancelFrame(frameId) {
      frames.delete(frameId);
    },
    runNextFrame() {
      const entry = frames.entries().next().value;
      assert.ok(entry, 'a measurement frame should be pending');
      const [frameId, callback] = entry;
      frames.delete(frameId);
      callback();
    },
  };
};

test('preview measurement scheduler stays single-flight and coalesces a trailing rerun', async () => {
  const { createPreviewMeasurementScheduler } = await loadSchedulerModule();
  const frameHarness = createFrameHarness();
  const pendingCollections = [];
  const commits = [];
  let activeCollections = 0;
  let maxActiveCollections = 0;
  let collectionCount = 0;

  const scheduler = createPreviewMeasurementScheduler({
    requestFrame: frameHarness.requestFrame,
    cancelFrame: frameHarness.cancelFrame,
    collect: (isCancelled) => {
      collectionCount += 1;
      activeCollections += 1;
      maxActiveCollections = Math.max(maxActiveCollections, activeCollections);
      return new Promise((resolve) => {
        pendingCollections.push({
          isCancelled,
          resolve(value) {
            activeCollections -= 1;
            resolve(value);
          },
        });
      });
    },
    commit: (measurement) => commits.push(measurement),
  });

  scheduler.schedule();
  scheduler.schedule();
  assert.equal(frameHarness.frames.size, 1, 'pre-frame notifications should be coalesced');
  frameHarness.runNextFrame();
  assert.equal(collectionCount, 1);
  assert.equal(activeCollections, 1);

  for (let index = 0; index < 100; index += 1) {
    scheduler.schedule();
  }
  assert.equal(collectionCount, 1, 'notifications must not start overlapping collectors');
  assert.equal(pendingCollections[0].isCancelled(), true, 'older collector should become stale');

  pendingCollections[0].resolve({ version: 'stale' });
  await flushAsyncWork();
  assert.equal(collectionCount, 2, 'all pending notifications should become one trailing pass');
  assert.equal(activeCollections, 1);
  assert.equal(commits.length, 0, 'stale results must not commit');

  pendingCollections[1].resolve({ version: 'latest' });
  await flushAsyncWork();
  assert.equal(maxActiveCollections, 1);
  assert.deepEqual(commits, [{ version: 'latest' }]);
  assert.equal(frameHarness.frames.size, 0);
});

test('preview measurement scheduler cancellation prevents pending work from committing', async () => {
  const { createPreviewMeasurementScheduler } = await loadSchedulerModule();
  const frameHarness = createFrameHarness();
  let pendingCollection;
  let commitCount = 0;
  const scheduler = createPreviewMeasurementScheduler({
    requestFrame: frameHarness.requestFrame,
    cancelFrame: frameHarness.cancelFrame,
    collect: (isCancelled) => new Promise((resolve) => {
      pendingCollection = { isCancelled, resolve };
    }),
    commit: () => {
      commitCount += 1;
    },
  });

  scheduler.schedule();
  frameHarness.runNextFrame();
  scheduler.schedule();
  scheduler.cancel();
  assert.equal(pendingCollection.isCancelled(), true);
  pendingCollection.resolve({ version: 'cancelled' });
  await flushAsyncWork();
  assert.equal(commitCount, 0);
  assert.equal(frameHarness.frames.size, 0);
});

test('preview measurement scheduler recovers a trailing pass after collector failure', async () => {
  const { createPreviewMeasurementScheduler } = await loadSchedulerModule();
  const frameHarness = createFrameHarness();
  const failedCollection = deferred();
  const commits = [];
  const errors = [];
  let collectionCount = 0;
  const scheduler = createPreviewMeasurementScheduler({
    requestFrame: frameHarness.requestFrame,
    cancelFrame: frameHarness.cancelFrame,
    collect: () => {
      collectionCount += 1;
      return collectionCount === 1
        ? failedCollection.promise
        : Promise.resolve({ version: 'recovered' });
    },
    commit: (measurement) => commits.push(measurement),
    onError: (error) => errors.push(error),
  });

  scheduler.schedule();
  frameHarness.runNextFrame();
  scheduler.schedule();
  const failure = new Error('layout failed');
  failedCollection.reject(failure);
  await flushAsyncWork();

  assert.equal(collectionCount, 2);
  assert.deepEqual(errors, [failure]);
  assert.deepEqual(commits, [{ version: 'recovered' }]);
});

test('preview measurement equality tracks only the state consumed by the UI', async () => {
  const { arePreviewMeasurementsEquivalent } = await loadSchedulerModule();
  const base = {
    fits: false,
    overflowPx: 12,
    printableTop: 10,
    printableBottom: 100,
    contentBottom: 112,
    overflowingSectionIds: ['work', 'projects'],
  };

  assert.equal(arePreviewMeasurementsEquivalent(base, {
    ...base,
    overflowPx: 12.25,
    contentBottom: 112.25,
  }), true, 'subpixel geometry that preserves visible overflow state should not re-render');
  assert.equal(arePreviewMeasurementsEquivalent(base, {
    ...base,
    overflowingSectionIds: ['projects', 'work'],
  }), false);
  assert.equal(arePreviewMeasurementsEquivalent(base, { ...base, fits: true }), false);
});
