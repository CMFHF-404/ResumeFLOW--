import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';

let importSequence = 0;

const importResumeService = async (api) => {
  globalThis.__resumeServiceApiMock = api;
  const result = await build({
    entryPoints: ['services/resumeService.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    plugins: [{
      name: 'api-client-mock',
      setup(buildApi) {
        buildApi.onResolve({ filter: /^\.\/apiClient$/ }, () => ({
          path: 'api-client-mock',
          namespace: 'resume-test',
        }));
        buildApi.onLoad({ filter: /.*/, namespace: 'resume-test' }, () => ({
          contents: `
            const call = (method, ...args) => globalThis.__resumeServiceApiMock[method](...args);
            const apiClient = {
              get: (...args) => call('get', ...args),
              post: (...args) => call('post', ...args),
              patch: (...args) => call('patch', ...args),
              delete: (...args) => call('delete', ...args),
            };
            export const getAuthCacheKey = () => Promise.resolve(
              globalThis.__resumeServiceApiMock.getAuthCacheKey?.() ?? 'test-user'
            );
            export default apiClient;
          `,
          loader: 'js',
        }));
      },
    }],
  });
  const encoded = Buffer.from(result.outputFiles[0].text).toString('base64');
  importSequence += 1;
  return import(`data:text/javascript;base64,${encoded}#${importSequence}`);
};

const deferred = () => {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const resume = (updatedAt) => ({
  id: 'resume-1',
  user_id: 'user-1',
  title: 'Resume',
  created_at: '2026-08-08T00:00:00.000Z',
  updated_at: updatedAt,
});

test('create pins request dispatch and response cache updates to the captured owner', async () => {
  const delayedCreate = deferred();
  const postCalls = [];
  let activeOwner = 'owner-a';
  const { resumeService, ResumeAuthContextChangedError } = await importResumeService({
    getAuthCacheKey: () => activeOwner,
    get: async () => ({ data: [] }),
    patch: async () => ({ data: resume('2026-08-08T00:00:01.000Z') }),
    post: (...args) => {
      postCalls.push(args);
      return delayedCreate.promise;
    },
    delete: async () => undefined,
  });

  const pendingCreate = resumeService.create(
    { title: 'Owner A resume', config: {} },
    { expectedAuthCacheKey: 'owner-a' },
  );
  await Promise.resolve();
  activeOwner = 'owner-b';
  delayedCreate.resolve({ data: resume('2026-08-08T00:00:01.000Z') });

  await assert.rejects(pendingCreate, ResumeAuthContextChangedError);
  assert.deepEqual(postCalls[0][2], { expectedAuthCacheKey: 'owner-a' });
});

test('list pins dispatch and cache commit to the captured owner', async () => {
  const delayedList = deferred();
  const getCalls = [];
  let activeOwner = 'owner-a';
  const { resumeService, ResumeAuthContextChangedError } = await importResumeService({
    getAuthCacheKey: () => activeOwner,
    get: (...args) => {
      getCalls.push(args);
      return getCalls.length === 1
        ? delayedList.promise
        : Promise.resolve({ data: [resume('2026-08-08T00:00:02.000Z')] });
    },
    patch: async () => ({ data: resume('2026-08-08T00:00:01.000Z') }),
    post: async () => ({ data: resume('2026-08-08T00:00:01.000Z') }),
    delete: async () => undefined,
  });

  const pendingList = resumeService.list({ expectedAuthCacheKey: 'owner-a' });
  await Promise.resolve();
  activeOwner = 'owner-b';
  delayedList.resolve({ data: [resume('2026-08-08T00:00:01.000Z')] });

  await assert.rejects(pendingList, ResumeAuthContextChangedError);
  assert.deepEqual(getCalls[0][1], { expectedAuthCacheKey: 'owner-a' });

  activeOwner = 'owner-a';
  await resumeService.list({ expectedAuthCacheKey: 'owner-a' });
  assert.equal(getCalls.length, 2, 'the stale response must not populate the owner cache');
});

test('a delayed GET cannot roll the mutation token back', async () => {
  const delayedGet = deferred();
  const patchPayloads = [];
  const versions = ['2026-08-08T00:00:02.000Z', '2026-08-08T00:00:03.000Z'];
  const { resumeService, recordKnownResumeUpdatedAt } = await importResumeService({
    get: () => delayedGet.promise,
    patch: async (_path, payload) => {
      patchPayloads.push(payload);
      return { data: resume(versions.shift()) };
    },
    post: async () => ({ data: resume(versions[0]) }),
    delete: async () => undefined,
  });
  recordKnownResumeUpdatedAt('resume-1', '2026-08-08T00:00:01.000Z');

  const getRequest = resumeService.get('resume-1');
  await resumeService.update('resume-1', { title: 'First' });
  delayedGet.resolve({ data: { resume: resume('2026-08-08T00:00:01.000Z'), experiences: [] } });
  await getRequest;
  await resumeService.update('resume-1', { title: 'Second' });

  assert.equal(patchPayloads[1].expected_updated_at, '2026-08-08T00:00:02.000Z');
});

test('a 409 blocks queued mutations until a fresh GET restores the token', async () => {
  const patchPayloads = [];
  let conflict = true;
  const {
    resumeService,
    recordKnownResumeUpdatedAt,
    subscribeToResumeVersionConflicts,
  } = await importResumeService({
    get: async () => ({
      data: { resume: resume('2026-08-08T00:00:02.000Z'), experiences: [] },
    }),
    patch: async (_path, payload) => {
      patchPayloads.push(payload);
      if (conflict) {
        conflict = false;
        throw { response: { status: 409 } };
      }
      return { data: resume('2026-08-08T00:00:03.000Z') };
    },
    post: async () => ({ data: resume('2026-08-08T00:00:03.000Z') }),
    delete: async () => undefined,
  });
  recordKnownResumeUpdatedAt('resume-1', '2026-08-08T00:00:01.000Z');
  let conflicts = 0;
  const unsubscribe = subscribeToResumeVersionConflicts('resume-1', () => {
    conflicts += 1;
  });

  await assert.rejects(resumeService.update('resume-1', { title: 'Conflict' }));
  assert.equal(conflicts, 1);
  await assert.rejects(
    resumeService.update('resume-1', { title: 'Still blocked' }),
    /requires a reload/
  );
  assert.equal(patchPayloads.length, 1);

  await resumeService.get('resume-1');
  await resumeService.update('resume-1', { title: 'Recovered' });
  assert.equal(patchPayloads[1].expected_updated_at, '2026-08-08T00:00:02.000Z');
  unsubscribe();
});

test('waitForResumeMutations follows work appended while it is draining', async () => {
  const first = deferred();
  const second = deferred();
  let callCount = 0;
  const { resumeService, recordKnownResumeUpdatedAt, waitForResumeMutations } = await importResumeService({
    get: async () => ({ data: { resume: resume('v1'), experiences: [] } }),
    patch: async () => {
      callCount += 1;
      return callCount === 1 ? first.promise : second.promise;
    },
    post: async () => ({ data: resume('v3') }),
    delete: async () => undefined,
  });
  recordKnownResumeUpdatedAt('resume-1', '2026-08-08T00:00:01.000Z');

  const mutationA = resumeService.update('resume-1', { title: 'A' });
  const draining = waitForResumeMutations('resume-1');
  const mutationB = resumeService.update('resume-1', { title: 'B' });
  let drained = false;
  void draining.then(() => { drained = true; });
  first.resolve({ data: resume('2026-08-08T00:00:02.000Z') });
  await mutationA;
  await Promise.resolve();
  assert.equal(drained, false);
  second.resolve({ data: resume('2026-08-08T00:00:03.000Z') });
  await Promise.all([mutationB, draining]);
  assert.equal(drained, true);
});

test('resume context loading settles even when owner capture or a later assertion fails', () => {
  const source = readFileSync('hooks/useResumeData.ts', 'utf8');
  assert.match(
    source,
    /expectedAuthCacheKey = await captureResumeAuthCacheKey\(authUserKey\);[\s\S]*?catch \(error\) \{\s*setIsLoadingResume\(false\);\s*setIsLoadingExperiences\(false\);/,
  );
  assert.match(
    source,
    /finally \{\s*setIsLoadingResume\(false\);\s*setIsLoadingExperiences\(false\);\s*\}/,
  );
  assert.doesNotMatch(
    source,
    /finally \{\s*if \(!authContextChanged\)/,
  );
});
