import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { build } from 'esbuild';

const importAIService = async () => {
  const result = await build({
    entryPoints: ['services/aiService.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    define: {
      'import.meta.env.DEV': 'false',
      'import.meta.env.VITE_API_BASE_URL': 'undefined',
    },
    plugins: [{
      name: 'assistant-pagination-api-client-stub',
      setup(buildContext) {
        buildContext.onResolve({ filter: /^\.\/apiClient$/ }, () => ({
          path: 'apiClient',
          namespace: 'stub',
        }));
        buildContext.onLoad({ filter: /^apiClient$/, namespace: 'stub' }, () => ({
          contents: `
            export class AuthContextChangedError extends Error {}
            export const getApiBaseUrl = () => '';
            export const getAuthorizationHeader = async () => ({});
            export const getAuthCacheKey = () => 'test-owner';
            export default {
              get: (...args) => globalThis.__assistantPaginationContractTest.get(...args),
              post: (...args) => globalThis.__assistantPaginationContractTest.post(...args),
              patch: (...args) => globalThis.__assistantPaginationContractTest.patch(...args),
              put: (...args) => globalThis.__assistantPaginationContractTest.put(...args),
              delete: (...args) => globalThis.__assistantPaginationContractTest.delete(...args),
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

const createApiStub = (get) => ({
  get,
  post: async () => ({ data: {} }),
  patch: async () => ({ data: {} }),
  put: async () => ({ data: {} }),
  delete: async () => undefined,
});

test('session list pagination forwards owner and cursor and reads a Link next cursor', async () => {
  const calls = [];
  globalThis.__assistantPaginationContractTest = createApiStub(async (...args) => {
    calls.push(args);
    return {
      data: [{ id: 'session-1' }],
      headers: new Headers({
        'x-assistant-sessions-truncated': 'TRUE',
        link: '</api/assistant/sessions?limit=50&before=opaque%2Fcursor%2B1>; rel="next"',
      }),
    };
  });

  try {
    const { aiService } = await importAIService();
    const page = await aiService.listAssistantSessionsPage({
      limit: 50,
      before: 'previous/cursor',
      expectedAuthCacheKey: 'owner-a',
    });

    assert.deepEqual(calls[0], [
      '/api/assistant/sessions',
      {
        expectedAuthCacheKey: 'owner-a',
        params: { limit: 50, before: 'previous/cursor' },
      },
    ]);
    assert.deepEqual(page.sessions, [{ id: 'session-1' }]);
    assert.equal(page.truncated, true);
    assert.equal(page.nextCursor, 'opaque/cursor+1');
  } finally {
    delete globalThis.__assistantPaginationContractTest;
  }
});

test('explicit next-cursor header wins and a missing cursor cannot claim truncation', async () => {
  const responses = [
    {
      data: [],
      headers: {
        'x-assistant-sessions-truncated': 'true',
        'x-assistant-sessions-next-cursor': 'header-cursor',
        link: '</api/assistant/sessions?before=link-cursor>; rel=next',
      },
    },
    {
      data: [],
      headers: { 'x-assistant-sessions-truncated': 'true' },
    },
  ];
  globalThis.__assistantPaginationContractTest = createApiStub(async () => responses.shift());

  try {
    const { aiService } = await importAIService();
    const withHeader = await aiService.listAssistantSessionsPage();
    const withoutCursor = await aiService.listAssistantSessionsPage();

    assert.equal(withHeader.nextCursor, 'header-cursor');
    assert.equal(withHeader.truncated, true);
    assert.equal(withoutCursor.nextCursor, null);
    assert.equal(withoutCursor.truncated, false);
  } finally {
    delete globalThis.__assistantPaginationContractTest;
  }
});

test('session detail pagination forwards limit, cursor, and owner authority unchanged', async () => {
  const calls = [];
  globalThis.__assistantPaginationContractTest = createApiStub(async (...args) => {
    calls.push(args);
    return { data: { session: { id: 'session-1' }, messages: [] }, headers: {} };
  });

  try {
    const { aiService } = await importAIService();
    await aiService.getAssistantSession('session-1', {
      limit: 100,
      before: 'message-cursor',
      expectedAuthCacheKey: 'owner-b',
    });

    assert.deepEqual(calls[0], [
      '/api/assistant/sessions/session-1',
      {
        expectedAuthCacheKey: 'owner-b',
        params: { limit: 100, before: 'message-cursor' },
      },
    ]);
  } finally {
    delete globalThis.__assistantPaginationContractTest;
  }
});

test('pagination UI and loader retain owner and request-generation guards end to end', async () => {
  const [pageSource, loaderSource] = await Promise.all([
    readFile('views/AIAssistant.tsx', 'utf8'),
    readFile('views/AIAssistant/useAssistantSessionLoading.ts', 'utf8'),
  ]);

  for (const prop of [
    'hasEarlierSessions={hasEarlierSessions}',
    'isLoadingEarlierSessions={isLoadingEarlierSessions}',
    'earlierSessionsError={earlierSessionsError}',
    'hasEarlierMessages={hasEarlierMessages}',
    'isLoadingEarlierMessages={isLoadingEarlierMessages}',
    'earlierMessagesError={earlierMessagesError}',
    'storageProjectionTruncated={storageProjectionTruncated}',
  ]) {
    assert.match(pageSource, new RegExp(prop.replace(/[{}]/g, '\\$&')));
  }
  assert.match(loaderSource, /expectedAuthCacheKey:\s*operation\.expectedAuthCacheKey/g);
  assert.match(loaderSource, /earlierSessionsRequestIdRef\.current === requestId/);
  assert.match(loaderSource, /earlierMessagesRequestIdRef\.current === requestId/);
  assert.match(loaderSource, /ownerGuard\.isOperationCurrent\(operation\)/);
  assert.match(loaderSource, /historyPaginationRef\.current\.generation === historyGeneration/);
  assert.match(loaderSource, /sessionListPaginationRef\.current\.generation === paginationGeneration/);
});
