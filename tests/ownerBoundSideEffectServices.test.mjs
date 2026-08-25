import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
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

const importServices = async () => {
  const result = await build({
    stdin: {
      contents: `
        export { experienceService } from './services/experienceService';
        export { certificationsService } from './services/certificationsService';
        export { skillsService } from './services/skillsService';
      `,
      loader: 'ts',
      resolveDir: process.cwd(),
      sourcefile: 'owner-bound-services-test-entry.ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    plugins: [{
      name: 'owner-bound-service-mocks',
      setup(buildContext) {
        buildContext.onResolve({ filter: /(?:^|\/)apiClient$/ }, () => ({
          path: 'apiClient',
          namespace: 'stub',
        }));
        buildContext.onResolve({ filter: /(?:^|\/)resumePreviewDataRevision$/ }, () => ({
          path: 'resumePreviewDataRevision',
          namespace: 'stub',
        }));
        buildContext.onResolve({ filter: /utils\/analyticsTracker$/ }, () => ({
          path: 'analyticsTracker',
          namespace: 'stub',
        }));
        buildContext.onLoad({ filter: /^apiClient$/, namespace: 'stub' }, () => ({
          contents: `
            export class AuthContextChangedError extends Error {
              constructor() {
                super('Authentication context changed during operation');
                this.name = 'AuthContextChangedError';
              }
            }
            export const captureAuthCacheKey = async (expected) => {
              const owner = expected ?? globalThis.__ownerBoundServiceTest.activeOwner;
              if (owner !== globalThis.__ownerBoundServiceTest.activeOwner) {
                throw new AuthContextChangedError();
              }
              return owner;
            };
            export const assertAuthCacheKey = async (expected) => {
              if (expected !== globalThis.__ownerBoundServiceTest.activeOwner) {
                throw new AuthContextChangedError();
              }
            };
            const request = (method, ...args) => (
              globalThis.__ownerBoundServiceTest.request(method, ...args)
            );
            export default {
              get: (...args) => request('get', ...args),
              post: (...args) => request('post', ...args),
              patch: (...args) => request('patch', ...args),
              delete: (...args) => request('delete', ...args),
            };
          `,
          loader: 'js',
        }));
        buildContext.onLoad({ filter: /^resumePreviewDataRevision$/, namespace: 'stub' }, () => ({
          contents: `
            export const bumpResumePreviewDataRevision = () => {
              globalThis.__ownerBoundServiceTest.previewBumps += 1;
            };
          `,
          loader: 'js',
        }));
        buildContext.onLoad({ filter: /^analyticsTracker$/, namespace: 'stub' }, () => ({
          contents: `
            export const trackFirstExperienceCreated = () => {
              globalThis.__ownerBoundServiceTest.analyticsCalls += 1;
            };
          `,
          loader: 'js',
        }));
      },
    }],
  });
  const encoded = Buffer.from(result.outputFiles[0].text).toString('base64');
  return import(`data:text/javascript;base64,${encoded}#${Date.now()}-${Math.random()}`);
};

const settleAsyncWork = async () => {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
};

test('experience, certification, and skill commits fail closed after their owner changes', async () => {
  const requests = [];
  globalThis.__ownerBoundServiceTest = {
    activeOwner: 'owner-a',
    previewBumps: 0,
    analyticsCalls: 0,
    request(method, ...args) {
      const pending = deferred();
      requests.push({ method, args, pending });
      return pending.promise;
    },
  };

  try {
    const { certificationsService, experienceService, skillsService } = await importServices();
    const operations = [
      () => experienceService.create(
        { category: 'work', version: { title: 'A' } },
        { expectedAuthCacheKey: 'owner-a' },
      ),
      () => certificationsService.create(
        { name: 'Certificate A' },
        { expectedAuthCacheKey: 'owner-a' },
      ),
      () => skillsService.create(
        { name: 'Skill A' },
        { expectedAuthCacheKey: 'owner-a' },
      ),
    ];

    for (const runOperation of operations) {
      globalThis.__ownerBoundServiceTest.activeOwner = 'owner-a';
      const pendingOperation = runOperation();
      await settleAsyncWork();
      const request = requests.at(-1);
      assert.equal(request.args.at(-1)?.expectedAuthCacheKey, 'owner-a');

      globalThis.__ownerBoundServiceTest.activeOwner = 'owner-b';
      request.pending.resolve({ data: { id: `response-${requests.length}` } });
      await assert.rejects(pendingOperation, /Authentication context changed/);
    }

    assert.equal(globalThis.__ownerBoundServiceTest.previewBumps, 0);
    assert.equal(globalThis.__ownerBoundServiceTest.analyticsCalls, 0);
  } finally {
    delete globalThis.__ownerBoundServiceTest;
  }
});

test('legacy create signatures capture the current owner before dispatch', async () => {
  const requests = [];
  globalThis.__ownerBoundServiceTest = {
    activeOwner: 'owner-a',
    previewBumps: 0,
    analyticsCalls: 0,
    request(method, ...args) {
      requests.push({ method, args });
      return Promise.resolve({ data: { id: 'skill-a', name: 'Skill A' } });
    },
  };

  try {
    const { skillsService } = await importServices();
    await skillsService.create({ name: 'Skill A' });
    assert.equal(requests[0]?.args.at(-1)?.expectedAuthCacheKey, 'owner-a');
    assert.equal(globalThis.__ownerBoundServiceTest.previewBumps, 1);
  } finally {
    delete globalThis.__ownerBoundServiceTest;
  }
});

test('an account B first-frame peek cannot observe account A cached experiences', async () => {
  const accountAItem = {
    master: { id: 'experience-a', category: 'work', is_archived: false },
    latest_version: { id: 'version-a', title: 'Account A secret experience' },
  };
  globalThis.__ownerBoundServiceTest = {
    activeOwner: 'owner-a',
    previewBumps: 0,
    analyticsCalls: 0,
    request: async () => ({ data: [accountAItem] }),
  };

  try {
    const { experienceService } = await importServices();
    await experienceService.list('work', {
      force: true,
      expectedAuthCacheKey: 'owner-a',
    });
    assert.deepEqual(
      experienceService.peekList('work', { expectedAuthCacheKey: 'owner-a' }),
      [accountAItem],
    );

    globalThis.__ownerBoundServiceTest.activeOwner = 'owner-b';
    assert.equal(
      experienceService.peekList('work', { expectedAuthCacheKey: 'owner-b' }),
      null,
    );
    assert.equal(experienceService.peekList('work'), null);
  } finally {
    delete globalThis.__ownerBoundServiceTest;
  }
});
