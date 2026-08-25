import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import { build } from 'esbuild';

const deferred = () => {
  let resolve;
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
};

const createHookRuntime = () => {
  const slots = [];
  let index = 0;
  const runtime = {
    useRef(initialValue) {
      const slotIndex = index++;
      slots[slotIndex] ??= { current: initialValue };
      return slots[slotIndex];
    },
    useCallback(callback, dependencies) {
      const slotIndex = index++;
      const previous = slots[slotIndex];
      const unchanged = previous
        && previous.dependencies.length === dependencies.length
        && previous.dependencies.every((value, dependencyIndex) => Object.is(value, dependencies[dependencyIndex]));
      if (!unchanged) slots[slotIndex] = { callback, dependencies };
      return slots[slotIndex].callback;
    },
    useEffect(effect, dependencies) {
      const slotIndex = index++;
      const previous = slots[slotIndex];
      const unchanged = previous
        && previous.dependencies.length === dependencies.length
        && previous.dependencies.every((value, dependencyIndex) => Object.is(value, dependencies[dependencyIndex]));
      if (!unchanged) {
        previous?.cleanup?.();
        slots[slotIndex] = { dependencies, cleanup: effect() };
      }
    },
    render(callback) {
      index = 0;
      return callback();
    },
    unmount() {
      for (const slot of slots) slot?.cleanup?.();
    },
  };
  return runtime;
};

const importHook = async () => {
  const result = await build({
    entryPoints: ['views/ResumeEditor/hooks/useDashboardResumeSync.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    plugins: [{
      name: 'dashboard-resume-sync-owner-stubs',
      setup(buildApi) {
        buildApi.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'stub' }));
        buildApi.onResolve({ filter: /services[\\/]apiClient$/ }, () => ({ path: 'api-client', namespace: 'stub' }));
        buildApi.onResolve({ filter: /services[\\/]resumeService$/ }, () => ({ path: 'resume-service', namespace: 'stub' }));
        buildApi.onResolve({ filter: /utils[\\/]dashboardResumeMapper$/ }, () => ({ path: 'mapper', namespace: 'stub' }));
        buildApi.onLoad({ filter: /^react$/, namespace: 'stub' }, () => ({
          contents: `
            const runtime = () => globalThis.__dashboardSyncRuntime;
            export const useRef = (value) => runtime().useRef(value);
            export const useCallback = (callback, deps) => runtime().useCallback(callback, deps);
            export const useEffect = (effect, deps) => runtime().useEffect(effect, deps);
            export const useLayoutEffect = (effect, deps) => runtime().useEffect(effect, deps);
          `,
          loader: 'js',
        }));
        buildApi.onLoad({ filter: /^api-client$/, namespace: 'stub' }, () => ({
          contents: `export const isAuthContextChangedError = (error) => error?.name === 'AuthContextChangedError';`,
          loader: 'js',
        }));
        buildApi.onLoad({ filter: /^resume-service$/, namespace: 'stub' }, () => ({
          contents: `
            export class ResumeAuthContextChangedError extends Error {}
            export const resumeService = {
              list: (...args) => globalThis.__dashboardSyncHarness.list(...args),
            };
            export const assertResumeAuthContext = async (expectedOwner) => {
              if (expectedOwner !== globalThis.__dashboardSyncHarness.activeOwner) {
                throw new ResumeAuthContextChangedError('Authentication context changed during resume operation');
              }
            };
          `,
          loader: 'js',
        }));
        buildApi.onLoad({ filter: /^mapper$/, namespace: 'stub' }, () => ({
          contents: `
            export const mapResumesToDashboard = (rows, owner) => rows.map((row) => ({ ...row, owner }));
            export const replaceDashboardResumeFromServer = (rows) => rows;
          `,
          loader: 'js',
        }));
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}#${Math.random()}`);
};

test('a B session established before the A closure updates cannot commit B rows as owner A', async () => {
  const runtime = createHookRuntime();
  const listGate = deferred();
  const listCalls = [];
  const updates = [];
  globalThis.__dashboardSyncRuntime = runtime;
  globalThis.__dashboardSyncHarness = {
    activeOwner: 'owner-a',
    list: (options) => {
      listCalls.push(options);
      return listGate.promise;
    },
  };

  try {
    const { useDashboardResumeSync } = await importHook();
    const hook = runtime.render(() => useDashboardResumeSync({
      authUserKey: 'owner-a',
      cachedResumes: [],
      isCacheOwnerMatched: true,
      onResumesUpdate: (rows) => updates.push(rows),
    }));
    const pending = hook.refreshDashboardResumesFromServer();
    await Promise.resolve();
    assert.equal(listCalls[0]?.expectedAuthCacheKey, 'owner-a');

    globalThis.__dashboardSyncHarness.activeOwner = 'owner-b';
    listGate.resolve([{ id: 'resume-b', title: 'B resume' }]);
    const result = await pending;

    assert.equal(result.status, 'skipped');
    assert.deepEqual(updates, []);
  } finally {
    delete globalThis.__dashboardSyncRuntime;
    delete globalThis.__dashboardSyncHarness;
  }
});

test('an older same-owner refresh cannot overwrite a newer refresh', async () => {
  const runtime = createHookRuntime();
  const first = deferred();
  const second = deferred();
  const requests = [first.promise, second.promise];
  const updates = [];
  globalThis.__dashboardSyncRuntime = runtime;
  globalThis.__dashboardSyncHarness = {
    activeOwner: 'owner-a',
    list: () => requests.shift(),
  };

  try {
    const { useDashboardResumeSync } = await importHook();
    const hook = runtime.render(() => useDashboardResumeSync({
      authUserKey: 'owner-a',
      cachedResumes: [],
      isCacheOwnerMatched: true,
      onResumesUpdate: (rows) => updates.push(rows),
    }));
    const older = hook.refreshDashboardResumesFromServer();
    const newer = hook.refreshDashboardResumesFromServer();
    second.resolve([{ id: 'resume-new', title: 'New' }]);
    assert.equal((await newer).status, 'success');
    first.resolve([{ id: 'resume-old', title: 'Old' }]);
    assert.equal((await older).status, 'skipped');
    assert.deepEqual(updates.map((rows) => rows[0].id), ['resume-new']);
  } finally {
    delete globalThis.__dashboardSyncRuntime;
    delete globalThis.__dashboardSyncHarness;
  }
});

test('an unmounted old instance cannot overwrite a newer instance for the same owner', async () => {
  const oldRuntime = createHookRuntime();
  const newRuntime = createHookRuntime();
  const oldRequest = deferred();
  const newRequest = deferred();
  const requests = [oldRequest.promise, newRequest.promise];
  const updates = [];
  globalThis.__dashboardSyncHarness = {
    activeOwner: 'owner-a',
    list: () => requests.shift(),
  };

  try {
    const { useDashboardResumeSync } = await importHook();
    globalThis.__dashboardSyncRuntime = oldRuntime;
    const oldHook = oldRuntime.render(() => useDashboardResumeSync({
      authUserKey: 'owner-a',
      cachedResumes: [],
      isCacheOwnerMatched: true,
      onResumesUpdate: (rows) => updates.push(rows),
    }));
    const oldPending = oldHook.refreshDashboardResumesFromServer();
    oldRuntime.unmount();

    globalThis.__dashboardSyncRuntime = newRuntime;
    const newHook = newRuntime.render(() => useDashboardResumeSync({
      authUserKey: 'owner-a',
      cachedResumes: [],
      isCacheOwnerMatched: true,
      onResumesUpdate: (rows) => updates.push(rows),
    }));
    const newPending = newHook.refreshDashboardResumesFromServer();
    newRequest.resolve([{ id: 'resume-new', title: 'New' }]);
    assert.equal((await newPending).status, 'success');
    oldRequest.resolve([{ id: 'resume-old', title: 'Old' }]);
    assert.equal((await oldPending).status, 'skipped');
    assert.deepEqual(updates.map((rows) => rows[0].id), ['resume-new']);
  } finally {
    delete globalThis.__dashboardSyncRuntime;
    delete globalThis.__dashboardSyncHarness;
  }
});
