import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import { build } from 'esbuild';

let apiClientImportSequence = 0;

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
                      response: {
                        use(successHandler, errorHandler) {
                          globalThis.__apiClientResponseInterceptor = successHandler;
                          globalThis.__apiClientResponseErrorInterceptor = errorHandler;
                        }
                      }
                    }
                  };
                }
              };
            `,
            loader: 'js',
          }));
          buildContext.onLoad({ filter: /^auth-token-provider-stub$/, namespace: 'stub' }, () => ({
            contents: `
              let sessionEpoch = 1;
              let sessionOwner = null;
              let requestGeneration = 0;
              let latestCompletedGeneration = 0;
              const readOwner = (token) => (
                token === 'token-a' ? 'user-a' : token === 'token-b' ? 'user-b' : null
              );
              export const requestAuthToken = () => {
                globalThis.__authTokenRequestCount = (globalThis.__authTokenRequestCount || 0) + 1;
                const generation = ++requestGeneration;
                let request;
                if (globalThis.__authTokenRequests?.length) {
                  request = globalThis.__authTokenRequests.shift();
                } else if (globalThis.__activeAuthToken !== undefined) {
                  request = Promise.resolve(globalThis.__activeAuthToken);
                } else {
                  request = new Promise(() => {});
                }
                return Promise.resolve(request).then((token) => {
                  const owner = readOwner(token);
                  if (owner === null) {
                    return null;
                  }
                  if (generation < latestCompletedGeneration) {
                    return owner === sessionOwner ? token : null;
                  }
                  latestCompletedGeneration = generation;
                  if (owner !== sessionOwner) {
                    sessionOwner = owner;
                    sessionEpoch += 1;
                  }
                  return token;
                });
              };
              export const readAuthSessionSnapshot = () => ({
                epoch: sessionEpoch,
                ownerKey: sessionOwner,
              });
              export const isAuthSessionSnapshotCurrent = (snapshot) => (
                snapshot.epoch === sessionEpoch && snapshot.ownerKey === sessionOwner
              );
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
  apiClientImportSequence += 1;
  return import(`data:text/javascript;base64,${encoded}#${apiClientImportSequence}`);
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
      /Authentication context changed/,
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

test('cache ownership survives a transient null token but advances on a real token switch', async () => {
  globalThis.__authTokenRequestCount = 0;
  globalThis.__activeAuthToken = 'token-a';
  try {
    const { getAuthCacheKey } = await importApiClientWithPendingToken();
    assert.equal(await getAuthCacheKey(), 'user-a');
    assert.equal(globalThis.__authTokenRequestCount, 1);

    globalThis.__activeAuthToken = null;
    assert.equal(await getAuthCacheKey(), 'user-a');
    assert.equal(
      globalThis.__authTokenRequestCount,
      1,
      'an established cache owner must not be erased by a transient null token read',
    );

    globalThis.__activeAuthToken = 'token-b';
    const requestInterceptor = globalThis.__apiClientRequestInterceptor;
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
        method: 'get',
        expectedAuthCacheKey: 'user-a',
      }),
      /Authentication context changed/,
    );
    assert.equal(await getAuthCacheKey(), 'user-b');
  } finally {
    delete globalThis.__activeAuthToken;
    delete globalThis.__authTokenRequestCount;
    delete globalThis.__apiClientRequestInterceptor;
  }
});

test('token de-duplication never shares an account A request with account B', async () => {
  const accountAToken = deferred();
  const accountBToken = deferred();
  globalThis.__authTokenRequestCount = 0;
  globalThis.__authTokenRequests = [accountAToken.promise, accountBToken.promise];

  try {
    await importApiClientWithPendingToken();
    const requestInterceptor = globalThis.__apiClientRequestInterceptor;
    const makeHeaders = () => ({
      values: new Map(),
      delete(name) {
        this.values.delete(name);
      },
      set(name, value) {
        this.values.set(name, value);
      },
    });
    const accountAHeaders = makeHeaders();
    const accountBHeaders = makeHeaders();

    const accountARequest = requestInterceptor({
      data: null,
      headers: accountAHeaders,
      method: 'post',
      expectedAuthCacheKey: 'user-a',
    });
    const accountBRequest = requestInterceptor({
      data: null,
      headers: accountBHeaders,
      method: 'post',
      expectedAuthCacheKey: 'user-b',
    });

    assert.equal(globalThis.__authTokenRequestCount, 2);
    accountBToken.resolve('token-b');
    await accountBRequest;
    accountAToken.resolve('token-a');
    await assert.rejects(accountARequest, /Authentication context changed/);
    assert.equal(accountAHeaders.values.get('Authorization'), undefined);
    assert.equal(accountBHeaders.values.get('Authorization'), 'Bearer token-b');
  } finally {
    delete globalThis.__authTokenRequests;
    delete globalThis.__authTokenRequestCount;
    delete globalThis.__apiClientRequestInterceptor;
  }
});

test('unbound delayed requests do not reuse an older token promise', async () => {
  const firstToken = deferred();
  const secondToken = deferred();
  globalThis.__authTokenRequestCount = 0;
  globalThis.__authTokenRequests = [firstToken.promise, secondToken.promise];

  try {
    const { getAuthorizationHeader } = await importApiClientWithPendingToken();
    const firstHeader = getAuthorizationHeader();
    const secondHeader = getAuthorizationHeader();

    assert.equal(globalThis.__authTokenRequestCount, 2);
    secondToken.resolve('token-b');
    assert.equal(await secondHeader, 'Bearer token-b');
    firstToken.resolve('token-a');
    assert.equal(await firstHeader, null);
  } finally {
    delete globalThis.__authTokenRequests;
    delete globalThis.__authTokenRequestCount;
  }
});

test('a response is rejected when its dispatch session epoch is no longer active', async () => {
  globalThis.__activeAuthToken = 'token-a';
  try {
    const { getAuthorizationHeader } = await importApiClientWithPendingToken();
    const requestInterceptor = globalThis.__apiClientRequestInterceptor;
    const responseInterceptor = globalThis.__apiClientResponseInterceptor;
    const headers = {
      values: new Map(),
      delete(name) {
        this.values.delete(name);
      },
      set(name, value) {
        this.values.set(name, value);
      },
    };
    const config = await requestInterceptor({
      data: null,
      headers,
      method: 'post',
      expectedAuthCacheKey: 'user-a',
    });
    assert.equal(config.authCacheKeyAtDispatch, 'user-a');

    globalThis.__activeAuthToken = 'token-b';
    await assert.rejects(
      () => getAuthorizationHeader('user-b'),
      /Authentication context changed/,
    );
    await assert.rejects(
      () => responseInterceptor({ config, data: { ok: true } }),
      /Authentication context changed/,
    );
  } finally {
    delete globalThis.__activeAuthToken;
    delete globalThis.__apiClientRequestInterceptor;
    delete globalThis.__apiClientResponseInterceptor;
    delete globalThis.__apiClientResponseErrorInterceptor;
  }
});
