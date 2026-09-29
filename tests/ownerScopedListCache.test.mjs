import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { setImmediate } from 'node:timers/promises';
import { test } from 'node:test';
import { build } from 'esbuild';

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

let bundledServices;
let importSequence = 0;
const importServices = async () => {
  bundledServices ??= build({
    stdin: {
      contents: `
        export { certificationsService } from './services/certificationsService';
        export { skillsService } from './services/skillsService';
      `,
      loader: 'ts',
      resolveDir: process.cwd(),
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    plugins: [{
      name: 'owner-scoped-list-cache-mocks',
      setup(buildContext) {
        buildContext.onResolve({ filter: /(?:^|\/)apiClient$/ }, () => ({
          path: 'apiClient', namespace: 'stub',
        }));
        buildContext.onResolve({ filter: /(?:^|\/)resumePreviewDataRevision$/ }, () => ({
          path: 'resumePreviewDataRevision', namespace: 'stub',
        }));
        buildContext.onLoad({ filter: /^apiClient$/, namespace: 'stub' }, () => ({
          contents: `
            const state = () => globalThis.__ownerScopedListCacheTest;
            export const captureAuthCacheKey = async (expected) => {
              const owner = expected ?? state().owner;
              if (owner !== state().owner) throw new Error('Authentication context changed');
              return owner;
            };
            export const assertAuthCacheKey = async (expected) => {
              if (expected !== state().owner) throw new Error('Authentication context changed');
            };
            export default Object.fromEntries(['get', 'post', 'patch', 'delete'].map(method => [
              method, (...args) => state().request(method, ...args),
            ]));
          `,
          loader: 'js',
        }));
        buildContext.onLoad({ filter: /^resumePreviewDataRevision$/, namespace: 'stub' }, () => ({
          contents: `export const bumpResumePreviewDataRevision = () => {
            globalThis.__ownerScopedListCacheTest.previewBumps += 1;
          };`,
          loader: 'js',
        }));
      },
    }],
  });
  const result = await bundledServices;
  const encoded = Buffer.from(result.outputFiles[0].text).toString('base64');
  return import(`data:text/javascript;base64,${encoded}#${++importSequence}`);
};

const createHarness = async (t, serviceName) => {
  const state = {
    owner: 'owner-a',
    now: 100_000,
    previewBumps: 0,
    requests: [],
    request(method, ...args) {
      const pending = deferred();
      this.requests.push({ method, args, pending });
      return pending.promise;
    },
  };
  globalThis.__ownerScopedListCacheTest = state;
  t.after(() => { delete globalThis.__ownerScopedListCacheTest; });
  t.mock.method(Date, 'now', () => state.now);
  const service = (await importServices())[serviceName];
  const dispatch = async (run) => {
    const before = state.requests.length;
    const result = run();
    await setImmediate();
    assert.equal(state.requests.length, before + 1);
    return { result, request: state.requests.at(-1) };
  };
  const populate = async (data) => {
    const { result, request } = await dispatch(() => service.list());
    request.pending.resolve({ data });
    assert.equal(await result, data);
  };
  return { state, service, dispatch, populate };
};

for (const [serviceName, resource] of [
  ['skillsService', '/skills'],
  ['certificationsService', '/certifications'],
]) {
  test(`${serviceName}: TTL, allowStale and empty results retain their existing semantics`, async (t) => {
    const { state, service, populate, dispatch } = await createHarness(t, serviceName);
    assert.equal(service.peekList({ allowStale: true }), null);
    const empty = [];
    await populate(empty);
    assert.equal(state.requests[0].args[0], resource);
    assert.equal(state.requests[0].args[1].expectedAuthCacheKey, 'owner-a');
    state.now += 9_999;
    assert.equal(service.peekList(), empty);
    assert.equal(await service.list(), empty);
    assert.equal(state.requests.length, 1);
    state.now += 1;
    assert.equal(service.peekList(), null);
    assert.equal(service.peekList({ allowStale: true }), empty);
    assert.equal(await service.peekListForCurrentUser({ allowStale: true }), empty);
    const { result, request } = await dispatch(() => service.list());
    const refreshed = [{ id: 'refreshed' }];
    request.pending.resolve({ data: refreshed });
    assert.equal(await result, refreshed);
    assert.equal(service.peekList(), refreshed);
  });

  test(`${serviceName}: force bypasses cache but reuses an in-flight request`, async (t) => {
    const { state, service, populate, dispatch } = await createHarness(t, serviceName);
    const cached = [{ id: 'cached' }];
    await populate(cached);
    const { result, request } = await dispatch(() => service.list({ force: true }));
    const forcedAgain = service.list({ force: true });
    assert.equal(await service.list(), cached, 'a fresh cache wins over an in-flight refresh');
    await setImmediate();
    assert.equal(state.requests.length, 2);
    const refreshed = [{ id: 'refreshed' }];
    request.pending.resolve({ data: refreshed });
    assert.equal(await result, refreshed);
    assert.equal(await forcedAgain, refreshed);
  });

  test(`${serviceName}: owner-aware access clears cache and rejects late old-owner reads`, async (t) => {
    const { state, service, populate, dispatch } = await createHarness(t, serviceName);
    await populate([{ id: 'owner-a-cache' }]);
    const oldRead = await dispatch(() => service.list({ force: true }));
    state.owner = 'owner-b';
    assert.equal(await service.peekListForCurrentUser({ allowStale: true }), null);
    await assert.rejects(service.list({ expectedAuthCacheKey: 'owner-a' }), /Authentication context changed/);
    const newRead = await dispatch(() => service.list({ expectedAuthCacheKey: 'owner-b' }));
    assert.equal(newRead.request.args[1].expectedAuthCacheKey, 'owner-b');
    const oldRejected = assert.rejects(oldRead.result, /Authentication context changed/);
    oldRead.request.pending.resolve({ data: [{ id: 'late-a' }] });
    await oldRejected;
    const sharedNewRead = service.list({ force: true });
    await setImmediate();
    assert.equal(state.requests.length, 3, 'the old finally must not clear the new owner request');
    const ownerBData = [{ id: 'owner-b-cache' }];
    newRead.request.pending.resolve({ data: ownerBData });
    assert.equal(await newRead.result, ownerBData);
    assert.equal(await sharedNewRead, ownerBData);
    assert.equal(service.peekList(), ownerBData);
  });

  for (const [operation, httpMethod] of [['create', 'post'], ['update', 'patch'], ['delete', 'delete']]) {
    test(`${serviceName}: ${operation} clears cache after owner validation and invalidates pending reads`, async (t) => {
      const { state, service, populate, dispatch } = await createHarness(t, serviceName);
      const cached = [{ id: 'cached' }];
      await populate(cached);
      const oldRead = await dispatch(() => service.list({ force: true }));
      const mutate = () => operation === 'create'
        ? service.create({ name: 'New' })
        : operation === 'update'
          ? service.update('item-1', { name: 'Changed' })
          : service.delete('item-1');
      const mutation = await dispatch(mutate);
      assert.equal(mutation.request.method, httpMethod);
      assert.equal(mutation.request.args[0], operation === 'create' ? resource : `${resource}/item-1`);
      assert.equal(mutation.request.args.at(-1).expectedAuthCacheKey, 'owner-a');
      assert.equal(service.peekList(), cached, 'dispatch does not clear the cache before success');
      const saved = { id: 'item-1' };
      mutation.request.pending.resolve({ data: saved });
      assert.equal(await mutation.result, operation === 'delete' ? undefined : saved);
      assert.equal(service.peekList({ allowStale: true }), null);
      assert.equal(state.previewBumps, 1);
      const newRead = await dispatch(() => service.list());
      const stale = [{ id: 'before-mutation' }];
      oldRead.request.pending.resolve({ data: stale });
      assert.equal(await oldRead.result, stale, 'an invalidated read still returns its own result if no cache exists');
      assert.equal(service.peekList({ allowStale: true }), null, 'the old response cannot repopulate the cache');
      const joined = service.list({ force: true });
      await setImmediate();
      assert.equal(state.requests.length, 4, 'the old finally cannot detach the replacement request');
      const current = [{ id: 'after-mutation' }];
      newRead.request.pending.resolve({ data: current });
      assert.equal(await newRead.result, current);
      assert.equal(await joined, current);
      assert.equal(service.peekList(), current);
    });
  }

  test(`${serviceName}: a late invalidated read returns a newer cached result`, async (t) => {
    const { service, dispatch } = await createHarness(t, serviceName);
    const oldRead = await dispatch(() => service.list());
    const mutation = await dispatch(() => service.create({ name: 'New' }));
    mutation.request.pending.resolve({ data: { id: 'new' } });
    await mutation.result;
    const newRead = await dispatch(() => service.list());
    const current = [{ id: 'after-mutation' }];
    newRead.request.pending.resolve({ data: current });
    await newRead.result;
    oldRead.request.pending.resolve({ data: [{ id: 'before-mutation' }] });
    assert.equal(await oldRead.result, current);
    assert.equal(service.peekList(), current);
  });

  test(`${serviceName}: failed refresh retains cache, releases in-flight work, and permits retry`, async (t) => {
    const { state, service, populate, dispatch } = await createHarness(t, serviceName);
    const cached = [{ id: 'cached' }];
    await populate(cached);
    state.now += 10_000;
    const failedRead = await dispatch(() => service.list());
    const joined = service.list({ force: true });
    const failure = new Error('read failed');
    const rejections = Promise.all([
      assert.rejects(failedRead.result, (error) => error === failure),
      assert.rejects(joined, (error) => error === failure),
    ]);
    await setImmediate();
    assert.equal(state.requests.length, 2);
    failedRead.request.pending.reject(failure);
    await rejections;
    assert.equal(service.peekList(), null);
    assert.equal(service.peekList({ allowStale: true }), cached);
    const retry = await dispatch(() => service.list());
    retry.request.pending.resolve({ data: [] });
    assert.deepEqual(await retry.result, []);
  });

  test(`${serviceName}: failed or stale-owner mutations leave the existing cache untouched`, async (t) => {
    const { state, service, populate, dispatch } = await createHarness(t, serviceName);
    const cached = [{ id: 'cached' }];
    await populate(cached);
    const failedMutation = await dispatch(() => service.update('item-1', { name: 'Changed' }));
    const failure = new Error('write failed');
    const failed = assert.rejects(failedMutation.result, (error) => error === failure);
    failedMutation.request.pending.reject(failure);
    await failed;
    assert.equal(service.peekList(), cached);
    const staleMutation = await dispatch(() => service.delete('item-1'));
    state.owner = 'owner-b';
    const rejected = assert.rejects(staleMutation.result, /Authentication context changed/);
    staleMutation.request.pending.resolve({ data: undefined });
    await rejected;
    assert.equal(service.peekList(), cached, 'plain peek remains a synchronous read without owner capture');
    assert.equal(state.previewBumps, 0);
    assert.equal(await service.peekListForCurrentUser(), null);
  });
}
