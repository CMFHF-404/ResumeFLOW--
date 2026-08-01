import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import { build } from 'esbuild';

const importApiClientWithPendingToken = async () => {
  const result = await build({
    entryPoints: ['services/apiClient.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    define: {
      'import.meta.env.DEV': 'false',
      'import.meta.env.VITE_API_BASE_URL': 'undefined',
    },
    plugins: [
      {
        name: 'stub-api-client-dependencies',
        setup(buildContext) {
          buildContext.onResolve({ filter: /^axios$/ }, () => ({
            path: 'axios-stub',
            namespace: 'stub',
          }));
          buildContext.onResolve({ filter: /^\.\/authTokenProvider$/ }, () => ({
            path: 'auth-token-provider-stub',
            namespace: 'stub',
          }));
          buildContext.onResolve({ filter: /^\.\/authRedirect$/ }, () => ({
            path: 'auth-redirect-stub',
            namespace: 'stub',
          }));
          buildContext.onResolve({ filter: /^\.\/devLogger$/ }, () => ({
            path: 'dev-logger-stub',
            namespace: 'stub',
          }));
          buildContext.onResolve({ filter: /^\.\/apiClientAuth$/ }, () => ({
            path: 'api-client-auth-stub',
            namespace: 'stub',
          }));
          buildContext.onLoad({ filter: /^axios-stub$/, namespace: 'stub' }, () => ({
            contents: `
              export default {
                create() {
                  return {
                    interceptors: {
                      request: {
                        use(handler) {
                          globalThis.__apiClientRequestInterceptor = handler;
                        }
                      },
                      response: { use() {} }
                    }
                  };
                }
              };
            `,
            loader: 'js',
          }));
          buildContext.onLoad({ filter: /^auth-token-provider-stub$/, namespace: 'stub' }, () => ({
            contents: `
              export const requestAuthToken = () => {
                globalThis.__authTokenRequestCount = (globalThis.__authTokenRequestCount || 0) + 1;
                if (globalThis.__activeAuthToken !== undefined) {
                  return Promise.resolve(globalThis.__activeAuthToken);
                }
                return new Promise(() => {});
              };
            `,
            loader: 'js',
          }));
          buildContext.onLoad({ filter: /^auth-redirect-stub$/, namespace: 'stub' }, () => ({
            contents: 'export const dispatchLoginRequired = () => {};',
            loader: 'js',
          }));
          buildContext.onLoad({ filter: /^dev-logger-stub$/, namespace: 'stub' }, () => ({
            contents: 'export const devLog = () => {};',
            loader: 'js',
          }));
          buildContext.onLoad({ filter: /^api-client-auth-stub$/, namespace: 'stub' }, () => ({
            contents: `
              export const readAuthUserKeyFromToken = (token) => (
                token === 'token-a' ? 'user-a' : token === 'token-b' ? 'user-b' : null
              );
            `,
            loader: 'js',
          }));
        },
      },
    ],
  });
  const source = result.outputFiles[0].text;
  const encoded = Buffer.from(source).toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
};

test('auth token requests time out and clear the in-flight request', async () => {
  globalThis.__authTokenRequestCount = 0;
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  globalThis.setTimeout = (handler) => {
    queueMicrotask(handler);
    return 1;
  };
  globalThis.clearTimeout = () => {};

  try {
    const { getAuthorizationHeader } = await importApiClientWithPendingToken();

    await assert.rejects(
      () => getAuthorizationHeader(),
      /获取登录状态超时/
    );
    await assert.rejects(
      () => getAuthorizationHeader(),
      /获取登录状态超时/
    );
    assert.equal(globalThis.__authTokenRequestCount, 2);
  } finally {
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
    delete globalThis.__authTokenRequestCount;
  }
});

test('auth-bound requests reject a token from a different account', async () => {
  globalThis.__activeAuthToken = 'token-b';
  try {
    await importApiClientWithPendingToken();
    const requestInterceptor = globalThis.__apiClientRequestInterceptor;
    assert.equal(typeof requestInterceptor, 'function');

    const headers = {
      values: new Map(),
      delete(name) {
        this.values.delete(name);
      },
      set(name, value) {
        this.values.set(name, value);
      },
    };
    await assert.rejects(
      () => requestInterceptor({
        data: null,
        headers,
        method: 'patch',
        expectedAuthCacheKey: 'user-a',
      }),
      /Authentication context changed before request dispatch/,
    );

    const matchingConfig = {
      data: null,
      headers,
      method: 'patch',
      expectedAuthCacheKey: 'user-b',
    };
    const acceptedConfig = await requestInterceptor(matchingConfig);
    assert.equal(acceptedConfig, matchingConfig);
    assert.equal(headers.values.get('Authorization'), 'Bearer token-b');
  } finally {
    delete globalThis.__activeAuthToken;
    delete globalThis.__apiClientRequestInterceptor;
  }
});
