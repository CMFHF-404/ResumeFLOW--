import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { build } from 'esbuild';


const importExportService = async () => {
  const result = await build({
    entryPoints: ['services/exportService.ts'],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    write: false,
    plugins: [{
      name: 'export-owner-stubs',
      setup(buildApi) {
        buildApi.onResolve({ filter: /^axios$/ }, () => ({ path: 'axios', namespace: 'stub' }));
        buildApi.onLoad({ filter: /^axios$/, namespace: 'stub' }, () => ({
          contents: `
            const axios = {
              isAxiosError: () => false,
              get: (...args) => globalThis.__exportOwnerHarness.legacyGet(...args),
            };
            export default axios;
          `,
          loader: 'js',
        }));
        buildApi.onResolve({ filter: /^\.\/apiClient$/ }, () => ({ path: 'apiClient', namespace: 'stub' }));
        buildApi.onLoad({ filter: /^apiClient$/, namespace: 'stub' }, () => ({
          contents: `
            const apiClient = {
              defaults: { baseURL: '/api' },
              get: (...args) => globalThis.__exportOwnerHarness.get(...args),
              post: (...args) => globalThis.__exportOwnerHarness.post(...args),
            };
            export const getAuthCacheKey = () => Promise.resolve(globalThis.__exportOwnerHarness.owner);
            export default apiClient;
          `,
          loader: 'js',
        }));
      },
    }],
  });
  const encoded = Buffer.from(result.outputFiles[0].text).toString('base64');
  return import(`data:text/javascript;base64,${encoded}#${Date.now()}-${Math.random()}`);
};


const importDownloadHelper = async () => {
  const result = await build({
    entryPoints: ['utils/downloadUrlFile.ts'],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    write: false,
    plugins: [{
      name: 'download-owner-stubs',
      setup(buildApi) {
        buildApi.onResolve({ filter: /^\.\/downloadBlobFile$/ }, () => ({ path: 'blob', namespace: 'stub' }));
        buildApi.onLoad({ filter: /^blob$/, namespace: 'stub' }, () => ({
          contents: `export const downloadBlobFile = (...args) => globalThis.__downloadOwnerHarness.download(...args);`,
          loader: 'js',
        }));
        buildApi.onResolve({ filter: /^\.\.\/services\/apiClient$/ }, () => ({ path: 'apiClient', namespace: 'stub' }));
        buildApi.onLoad({ filter: /^apiClient$/, namespace: 'stub' }, () => ({
          contents: `
            export const getApiBaseUrl = () => '/api';
            export const getAuthorizationHeader = (...args) => (
              globalThis.__downloadOwnerHarness.authorization?.(...args)
              ?? Promise.resolve('Bearer token-a')
            );
            export const getAuthCacheKey = () => Promise.resolve(globalThis.__downloadOwnerHarness.owner);
          `,
          loader: 'js',
        }));
      },
    }],
  });
  const encoded = Buffer.from(result.outputFiles[0].text).toString('base64');
  return import(`data:text/javascript;base64,${encoded}#${Date.now()}-${Math.random()}`);
};


test('deferred export POST rejects after auth owner changes from A to B', async () => {
  let resolvePost;
  const postCalls = [];
  globalThis.__exportOwnerHarness = {
    owner: 'owner-a',
    get: async () => ({ data: {} }),
    legacyGet: async () => ({ data: {} }),
    post: (...args) => {
      postCalls.push(args);
      return new Promise((resolve) => { resolvePost = resolve; });
    },
  };
  try {
    const { exportService } = await importExportService();
    const pending = exportService.createResumePdfDownloadLink(
      { resumeName: 'A' },
      'A.pdf',
      { expectedAuthCacheKey: 'owner-a' },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    globalThis.__exportOwnerHarness.owner = 'owner-b';
    resolvePost({ data: { downloadUrl: '/a', fileName: 'A.pdf' } });

    await assert.rejects(pending, /Authentication context changed during export/);
    assert.equal(postCalls[0][2].expectedAuthCacheKey, 'owner-a');
    assert.equal(
      postCalls[0][2].headers['X-ResumeFlow-Export-Mode'],
      'authenticated-v2',
    );
  } finally {
    delete globalThis.__exportOwnerHarness;
  }
});


test('download owner switch during token resolution prevents the snapshot fetch', async () => {
  let resolveAuthorization;
  const authorizationGate = new Promise((resolve) => { resolveAuthorization = resolve; });
  const authorizationCalls = [];
  let fetchCalls = 0;
  globalThis.__downloadOwnerHarness = {
    owner: 'owner-a',
    download: () => undefined,
    authorization: async (expectedAuthCacheKey) => {
      authorizationCalls.push(expectedAuthCacheKey);
      await authorizationGate;
      if (expectedAuthCacheKey !== globalThis.__downloadOwnerHarness.owner) {
        throw new Error('Authentication context changed during operation');
      }
      return 'Bearer token-a';
    },
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error('fetch must not run');
  };

  try {
    const { downloadUrlFile } = await importDownloadHelper();
    const pending = downloadUrlFile('/exports/download/resume-pdf/a', 'A.pdf', 'owner-a');
    await new Promise((resolve) => setTimeout(resolve, 0));
    globalThis.__downloadOwnerHarness.owner = 'owner-b';
    resolveAuthorization();

    await assert.rejects(pending, /Authentication context changed/);
    assert.deepEqual(authorizationCalls, ['owner-a']);
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.__downloadOwnerHarness;
  }
});


test('deferred snapshot GET rejects after auth owner changes from A to B', async () => {
  let resolveGet;
  const getCalls = [];
  globalThis.__exportOwnerHarness = {
    owner: 'owner-a',
    get: (...args) => {
      getCalls.push(args);
      return new Promise((resolve) => { resolveGet = resolve; });
    },
    legacyGet: async () => ({ data: {} }),
    post: async () => ({ data: {} }),
  };
  try {
    const { exportService } = await importExportService();
    const pending = exportService.getRenderSnapshot(
      'snapshot-a',
      undefined,
      { expectedAuthCacheKey: 'owner-a' },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    globalThis.__exportOwnerHarness.owner = 'owner-b';
    resolveGet({ data: { snapshot: { resumeName: 'A' } } });

    await assert.rejects(pending, /Authentication context changed during export/);
    assert.deepEqual(getCalls[0][1], { expectedAuthCacheKey: 'owner-a' });
  } finally {
    delete globalThis.__exportOwnerHarness;
  }
});


test('deferred download does not commit a blob after auth owner changes', async () => {
  let resolveFetch;
  const downloads = [];
  globalThis.__downloadOwnerHarness = {
    owner: 'owner-a',
    download: (...args) => downloads.push(args),
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => new Promise((resolve) => { resolveFetch = resolve; });
  try {
    const { downloadUrlFile } = await importDownloadHelper();
    const pending = downloadUrlFile('/exports/download/resume-pdf/a', 'A.pdf', 'owner-a');
    await new Promise((resolve) => setTimeout(resolve, 0));
    globalThis.__downloadOwnerHarness.owner = 'owner-b';
    resolveFetch({
      ok: true,
      headers: new Headers({ 'Content-Disposition': 'attachment; filename="A.pdf"' }),
      blob: async () => new Blob(['pdf'], { type: 'application/pdf' }),
    });

    await assert.rejects(pending, /Authentication context changed during export/);
    assert.deepEqual(downloads, []);
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.__downloadOwnerHarness;
  }
});


test('both export hooks capture owner and generation before committing UI effects', () => {
  const resumeHook = readFileSync('views/ResumeEditor/hooks/useResumePdfExport.ts', 'utf8');
  const bankHook = readFileSync('views/ExperienceBank/useExperienceBankPdfExport.ts', 'utf8');

  for (const source of [resumeHook, bankHook]) {
    assert.match(source, /captureResumeAuthCacheKey/);
    assert.match(source, /exportGenerationRef/);
    assert.match(source, /expectedAuthCacheKey/);
    assert.match(source, /assertResumeAuthContext/);
    assert.match(source, /downloadUrlFile\(downloadUrl, fileName, expectedAuthCacheKey\)/);
    assert.match(source, /let toastSettled = false/);
    assert.match(source, /if \(toastId && !toastSettled\) \{\s*closeToast\(toastId\)/);
  }
});
