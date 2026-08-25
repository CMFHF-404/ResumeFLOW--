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

const createToken = (owner) => {
  const payload = Buffer.from(JSON.stringify({
    sub: owner,
    exp: Math.floor(Date.now() / 1000) + 3600,
  })).toString('base64url');
  return `header.${payload}.signature`;
};

const areDepsEqual = (left, right) => (
  Array.isArray(left)
  && Array.isArray(right)
  && left.length === right.length
  && left.every((value, index) => Object.is(value, right[index]))
);

const createHookRuntime = () => {
  const slots = [];
  let index = 0;
  let pendingEffects = [];
  return {
    useState(initialValue) {
      const slotIndex = index++;
      slots[slotIndex] ??= {
        value: typeof initialValue === 'function' ? initialValue() : initialValue,
      };
      return [slots[slotIndex].value, (value) => {
        slots[slotIndex].value = typeof value === 'function'
          ? value(slots[slotIndex].value)
          : value;
      }];
    },
    useEffect(effect, deps) {
      const slotIndex = index++;
      const current = slots[slotIndex];
      if (!current || !areDepsEqual(current.deps, deps)) {
        slots[slotIndex] = { deps, cleanup: current?.cleanup };
        pendingEffects.push({ slotIndex, effect });
      }
    },
    useCallback(callback, deps) {
      const slotIndex = index++;
      const current = slots[slotIndex];
      if (!current || !areDepsEqual(current.deps, deps)) {
        slots[slotIndex] = { deps, value: callback };
      }
      return slots[slotIndex].value;
    },
    useRef(initialValue) {
      const slotIndex = index++;
      slots[slotIndex] ??= { value: { current: initialValue } };
      return slots[slotIndex].value;
    },
    unmount() {
      for (const slot of slots) {
        slot?.cleanup?.();
        if (slot) {
          slot.cleanup = undefined;
        }
      }
    },
    render(callback) {
      index = 0;
      pendingEffects = [];
      const result = callback();
      for (const { slotIndex, effect } of pendingEffects) {
        slots[slotIndex].cleanup?.();
        const cleanup = effect();
        slots[slotIndex].cleanup = typeof cleanup === 'function' ? cleanup : undefined;
      }
      return result;
    },
  };
};

const importUseAuthUserKey = async () => {
  const result = await build({
    stdin: {
      contents: `
        export { useAuthUserKey } from './hooks/useAuthUserKey.ts';
        export {
          clearAuthTokenProvider,
          readAuthSessionSnapshot,
          requestAuthToken,
          setAuthTokenProvider,
        } from './services/authTokenProvider.ts';
      `,
      resolveDir: process.cwd(),
      sourcefile: 'auth-owner-test-entry.ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    plugins: [{
      name: 'auth-owner-test-stubs',
      setup(buildApi) {
        buildApi.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'stub' }));
        buildApi.onResolve({ filter: /^@logto\/react$/ }, () => ({ path: 'logto', namespace: 'stub' }));
        buildApi.onResolve({ filter: /services[\\/]apiClient$/ }, () => ({ path: 'api-client', namespace: 'stub' }));
        buildApi.onLoad({ filter: /^react$/, namespace: 'stub' }, () => ({
          contents: `
            const runtime = () => globalThis.__authOwnerHookRuntime;
            export const useCallback = (callback, deps) => runtime().useCallback(callback, deps);
            export const useState = (initial) => runtime().useState(initial);
            export const useEffect = (effect, deps) => runtime().useEffect(effect, deps);
            export const useRef = (initial) => runtime().useRef(initial);
            export const useSyncExternalStore = (_subscribe, getSnapshot) => getSnapshot();
          `,
          loader: 'js',
        }));
        buildApi.onLoad({ filter: /^logto$/, namespace: 'stub' }, () => ({
          contents: 'export const useLogto = () => globalThis.__authOwnerLogto;',
          loader: 'js',
        }));
        buildApi.onLoad({ filter: /^api-client$/, namespace: 'stub' }, () => ({
          contents: 'export const resolveAuthUserKeyFromActiveSession = () => globalThis.__authOwnerFallback();',
          loader: 'js',
        }));
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}#${Math.random()}`);
};

const settleAsyncWork = async () => {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
};

const createFakeTimers = () => {
  let now = 0;
  let nextTimerId = 1;
  const timers = new Map();
  return {
    setTimeout(handler, delay = 0) {
      const timerId = nextTimerId;
      nextTimerId += 1;
      timers.set(timerId, {
        dueAt: now + Math.max(0, Number(delay) || 0),
        handler,
      });
      return timerId;
    },
    clearTimeout(timerId) {
      timers.delete(timerId);
    },
    pendingCount() {
      return timers.size;
    },
    async advanceBy(durationMs) {
      const target = now + durationMs;
      while (true) {
        const nextEntry = [...timers.entries()]
          .filter(([, timer]) => timer.dueAt <= target)
          .sort((left, right) => left[1].dueAt - right[1].dueAt)[0];
        if (!nextEntry) {
          break;
        }
        const [timerId, timer] = nextEntry;
        timers.delete(timerId);
        now = timer.dueAt;
        timer.handler();
        await settleAsyncWork();
      }
      now = target;
      await settleAsyncWork();
    },
  };
};

test('a cancelled fallback from owner A cannot overwrite the resolved owner B', async () => {
  const originalConsoleWarn = console.warn;
  console.warn = () => undefined;
  const ownerAFallback = deferred();
  const runtime = createHookRuntime();
  globalThis.__authOwnerHookRuntime = runtime;
  globalThis.__authOwnerFallback = () => ownerAFallback.promise;
  const authModule = await importUseAuthUserKey();
  const { useAuthUserKey } = authModule;

  const getOwnerAClaims = async () => { throw new Error('claims unavailable'); };
  globalThis.__authOwnerLogto = {
    isAuthenticated: true,
    isLoading: false,
    getIdTokenClaims: getOwnerAClaims,
  };
  runtime.render(() => useAuthUserKey());
  await settleAsyncWork();

  const getOwnerBClaims = async () => ({ sub: 'owner-b' });
  globalThis.__authOwnerLogto = {
    isAuthenticated: true,
    isLoading: false,
    getIdTokenClaims: getOwnerBClaims,
  };
  runtime.render(() => useAuthUserKey());
  await settleAsyncWork();
  assert.equal(runtime.render(() => useAuthUserKey()), 'owner-b');

  ownerAFallback.resolve('owner-a');
  await settleAsyncWork();
  assert.equal(runtime.render(() => useAuthUserKey()), 'owner-b');

  try {
    delete globalThis.__authOwnerHookRuntime;
    delete globalThis.__authOwnerLogto;
    delete globalThis.__authOwnerFallback;
    authModule.clearAuthTokenProvider();
  } finally {
    console.warn = originalConsoleWarn;
  }
});

test('a pending Logto getter loading toggle preserves its owner while logout hides it immediately', async () => {
  const runtime = createHookRuntime();
  globalThis.__authOwnerHookRuntime = runtime;
  globalThis.__authOwnerFallback = async () => null;
  const authModule = await importUseAuthUserKey();
  const { useAuthUserKey } = authModule;
  const getOwnerAClaims = async () => ({ sub: 'owner-a' });

  try {
    globalThis.__authOwnerLogto = {
      isAuthenticated: true,
      isLoading: false,
      getIdTokenClaims: getOwnerAClaims,
    };
    runtime.render(() => useAuthUserKey());
    await settleAsyncWork();
    assert.equal(runtime.render(() => useAuthUserKey()), 'owner-a');

    const ownerBClaims = deferred();
    const getOwnerBClaims = () => ownerBClaims.promise;
    globalThis.__authOwnerLogto = {
      isAuthenticated: true,
      isLoading: false,
      getIdTokenClaims: getOwnerBClaims,
    };
    assert.equal(runtime.render(() => useAuthUserKey()), 'owner-a');

    globalThis.__authOwnerLogto = {
      isAuthenticated: true,
      isLoading: true,
      getIdTokenClaims: getOwnerBClaims,
    };
    assert.equal(runtime.render(() => useAuthUserKey()), 'owner-a');
    assert.equal(authModule.readAuthSessionSnapshot().ownerKey, 'owner-a');

    globalThis.__authOwnerLogto = {
      isAuthenticated: true,
      isLoading: false,
      getIdTokenClaims: getOwnerBClaims,
    };
    assert.equal(runtime.render(() => useAuthUserKey()), 'owner-a');
    ownerBClaims.resolve({ sub: 'owner-b' });
    await settleAsyncWork();
    assert.equal(runtime.render(() => useAuthUserKey()), 'owner-b');
    assert.equal(authModule.readAuthSessionSnapshot().ownerKey, 'owner-b');

    globalThis.__authOwnerLogto = {
      isAuthenticated: false,
      isLoading: false,
      getIdTokenClaims: getOwnerBClaims,
    };
    assert.equal(runtime.render(() => useAuthUserKey()), null);
    assert.equal(authModule.readAuthSessionSnapshot().ownerKey, null);
  } finally {
    delete globalThis.__authOwnerHookRuntime;
    delete globalThis.__authOwnerLogto;
    delete globalThis.__authOwnerFallback;
    authModule.clearAuthTokenProvider();
  }
});

test('provider owner B immediately replaces old A while stale A claims cannot roll authority back', async () => {
  const runtime = createHookRuntime();
  globalThis.__authOwnerHookRuntime = runtime;
  globalThis.__authOwnerFallback = async () => null;
  const authModule = await importUseAuthUserKey();
  const { useAuthUserKey } = authModule;
  const getOwnerAClaims = async () => ({ sub: 'owner-a' });
  let activeToken = createToken('owner-a');
  authModule.setAuthTokenProvider(async () => activeToken);

  try {
    globalThis.__authOwnerLogto = {
      isAuthenticated: true,
      isLoading: false,
      getIdTokenClaims: getOwnerAClaims,
    };
    runtime.render(() => useAuthUserKey());
    await settleAsyncWork();
    assert.equal(runtime.render(() => useAuthUserKey()), 'owner-a');
    assert.equal(await authModule.requestAuthToken(), activeToken);

    const staleOwnerAClaims = deferred();
    const getStaleOwnerAClaims = () => staleOwnerAClaims.promise;
    globalThis.__authOwnerLogto = {
      isAuthenticated: true,
      isLoading: false,
      getIdTokenClaims: getStaleOwnerAClaims,
    };
    assert.equal(runtime.render(() => useAuthUserKey()), 'owner-a');

    activeToken = createToken('owner-b');
    assert.equal(await authModule.requestAuthToken(), activeToken);
    assert.equal(runtime.render(() => useAuthUserKey()), 'owner-b');
    staleOwnerAClaims.resolve({ sub: 'owner-a' });
    await settleAsyncWork();
    assert.equal(runtime.render(() => useAuthUserKey()), 'owner-b');
    assert.equal(authModule.readAuthSessionSnapshot().ownerKey, 'owner-b');

    const getOwnerBClaims = async () => ({ sub: 'owner-b' });
    globalThis.__authOwnerLogto = {
      isAuthenticated: true,
      isLoading: false,
      getIdTokenClaims: getOwnerBClaims,
    };
    runtime.render(() => useAuthUserKey());
    await settleAsyncWork();
    assert.equal(runtime.render(() => useAuthUserKey()), 'owner-b');
  } finally {
    delete globalThis.__authOwnerHookRuntime;
    delete globalThis.__authOwnerLogto;
    delete globalThis.__authOwnerFallback;
    authModule.clearAuthTokenProvider();
  }
});

test('a Logto claims proxy loading toggle invalidates the old attempt and settles one fresh read', async () => {
  const runtime = createHookRuntime();
  globalThis.__authOwnerHookRuntime = runtime;
  globalThis.__authOwnerFallback = async () => null;
  const authModule = await importUseAuthUserKey();
  const { useAuthUserKey } = authModule;
  let getterCalls = 0;
  const getOwnerAClaims = async () => {
    getterCalls += 1;
    globalThis.__authOwnerLogto = {
      isAuthenticated: true,
      isLoading: true,
      getIdTokenClaims: getOwnerAClaims,
    };
    await new Promise((resolve) => setTimeout(resolve, 25));
    globalThis.__authOwnerLogto = {
      isAuthenticated: true,
      isLoading: false,
      getIdTokenClaims: getOwnerAClaims,
    };
    return { sub: 'owner-a' };
  };

  try {
    globalThis.__authOwnerLogto = {
      isAuthenticated: true,
      isLoading: false,
      getIdTokenClaims: getOwnerAClaims,
    };
    assert.equal(runtime.render(() => useAuthUserKey()), null);
    assert.equal(getterCalls, 1);
    assert.equal(runtime.render(() => useAuthUserKey()), null);
    await new Promise((resolve) => setTimeout(resolve, 35));
    assert.equal(runtime.render(() => useAuthUserKey()), null);
    assert.equal(getterCalls, 2);
    await new Promise((resolve) => setTimeout(resolve, 35));
    assert.equal(runtime.render(() => useAuthUserKey()), 'owner-a');
    assert.equal(runtime.render(() => useAuthUserKey()), 'owner-a');
    assert.equal(getterCalls, 2);
  } finally {
    delete globalThis.__authOwnerHookRuntime;
    delete globalThis.__authOwnerLogto;
    delete globalThis.__authOwnerFallback;
    authModule.clearAuthTokenProvider();
  }
});

test('a stable getter is reread after a loading pulse and hides A until token B confirms', async () => {
  const runtime = createHookRuntime();
  const ownerBToken = deferred();
  let claimsOwner = 'owner-a';
  let tokenResult = createToken('owner-a');
  globalThis.__authOwnerHookRuntime = runtime;
  const authModule = await importUseAuthUserKey();
  const { useAuthUserKey } = authModule;
  authModule.setAuthTokenProvider(() => Promise.resolve(tokenResult));
  globalThis.__authOwnerFallback = async () => {
    await authModule.requestAuthToken();
    return authModule.readAuthSessionSnapshot().ownerKey;
  };
  const stableClaimsGetter = async () => ({ sub: claimsOwner });

  try {
    globalThis.__authOwnerLogto = {
      isAuthenticated: true,
      isLoading: false,
      getIdTokenClaims: stableClaimsGetter,
    };
    runtime.render(() => useAuthUserKey());
    await settleAsyncWork();
    assert.equal(runtime.render(() => useAuthUserKey()), 'owner-a');
    await authModule.requestAuthToken();

    claimsOwner = 'owner-b';
    tokenResult = ownerBToken.promise;
    globalThis.__authOwnerLogto = {
      isAuthenticated: true,
      isLoading: true,
      getIdTokenClaims: stableClaimsGetter,
    };
    assert.equal(runtime.render(() => useAuthUserKey()), 'owner-a');

    globalThis.__authOwnerLogto = {
      isAuthenticated: true,
      isLoading: false,
      getIdTokenClaims: stableClaimsGetter,
    };
    runtime.render(() => useAuthUserKey());
    await settleAsyncWork();
    assert.equal(runtime.render(() => useAuthUserKey()), null);

    ownerBToken.resolve(createToken('owner-b'));
    await settleAsyncWork();
    assert.equal(runtime.render(() => useAuthUserKey()), 'owner-b');
  } finally {
    authModule.clearAuthTokenProvider();
    delete globalThis.__authOwnerHookRuntime;
    delete globalThis.__authOwnerLogto;
    delete globalThis.__authOwnerFallback;
  }
});

test('pending B keeps bounded token-only retries and confirms B after the old 2.3s window', async () => {
  const runtime = createHookRuntime();
  const fakeTimers = createFakeTimers();
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  let claimsOwner = 'owner-a';
  let activeToken = createToken('owner-a');
  let tokenRequests = 0;
  globalThis.__authOwnerHookRuntime = runtime;
  const authModule = await importUseAuthUserKey();
  const { useAuthUserKey } = authModule;
  authModule.setAuthTokenProvider(async () => {
    tokenRequests += 1;
    return activeToken;
  });
  const stableClaimsGetter = async () => ({ sub: claimsOwner });

  try {
    globalThis.__authOwnerLogto = {
      isAuthenticated: true,
      isLoading: false,
      getIdTokenClaims: stableClaimsGetter,
    };
    runtime.render(() => useAuthUserKey());
    await settleAsyncWork();
    await authModule.requestAuthToken();
    assert.equal(authModule.readAuthSessionSnapshot().ownerKey, 'owner-a');

    globalThis.setTimeout = fakeTimers.setTimeout;
    globalThis.clearTimeout = fakeTimers.clearTimeout;
    claimsOwner = 'owner-b';
    globalThis.__authOwnerLogto = {
      isAuthenticated: true,
      isLoading: true,
      getIdTokenClaims: stableClaimsGetter,
    };
    runtime.render(() => useAuthUserKey());
    globalThis.__authOwnerLogto = {
      isAuthenticated: true,
      isLoading: false,
      getIdTokenClaims: stableClaimsGetter,
    };
    runtime.render(() => useAuthUserKey());
    await settleAsyncWork();
    assert.equal(authModule.readAuthSessionSnapshot().ownerKey, null);

    await fakeTimers.advanceBy(30_000);
    assert.equal(authModule.readAuthSessionSnapshot().ownerKey, null);
    assert.equal(tokenRequests, 11, '30 seconds of pending state has a fixed bounded read count');
    assert.equal(fakeTimers.pendingCount(), 1, 'only one retry timer may remain scheduled');

    activeToken = createToken('owner-b');
    await fakeTimers.advanceBy(9_799);
    assert.equal(authModule.readAuthSessionSnapshot().ownerKey, null);
    await fakeTimers.advanceBy(1);
    assert.equal(authModule.readAuthSessionSnapshot().ownerKey, 'owner-b');
    assert.equal(tokenRequests, 12);
    assert.equal(runtime.render(() => useAuthUserKey()), 'owner-b');
  } finally {
    runtime.unmount();
    authModule.clearAuthTokenProvider();
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    delete globalThis.__authOwnerHookRuntime;
    delete globalThis.__authOwnerLogto;
    delete globalThis.__authOwnerFallback;
  }
});

test('a never-settling B read times out so C can confirm and late B cannot roll it back', async () => {
  const runtime = createHookRuntime();
  const fakeTimers = createFakeTimers();
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  let activeToken = createToken('owner-a');
  const pendingTokenRead = deferred();
  let tokenRequests = 0;
  globalThis.__authOwnerHookRuntime = runtime;
  const authModule = await importUseAuthUserKey();
  const { useAuthUserKey } = authModule;
  authModule.setAuthTokenProvider(async () => {
    tokenRequests += 1;
    return activeToken;
  });

  try {
    const getOwnerAClaims = async () => ({ sub: 'owner-a' });
    globalThis.__authOwnerLogto = {
      isAuthenticated: true,
      isLoading: false,
      getIdTokenClaims: getOwnerAClaims,
    };
    runtime.render(() => useAuthUserKey());
    await settleAsyncWork();
    await authModule.requestAuthToken();

    globalThis.setTimeout = fakeTimers.setTimeout;
    globalThis.clearTimeout = fakeTimers.clearTimeout;
    activeToken = pendingTokenRead.promise;
    const getOwnerBClaims = async () => ({ sub: 'owner-b' });
    globalThis.__authOwnerLogto = {
      isAuthenticated: true,
      isLoading: false,
      getIdTokenClaims: getOwnerBClaims,
    };
    runtime.render(() => useAuthUserKey());
    await settleAsyncWork();
    assert.equal(authModule.readAuthSessionSnapshot().ownerKey, null);
    assert.equal(tokenRequests, 2);
    assert.equal(fakeTimers.pendingCount(), 1, 'the single verification entry owns one timeout');

    const getOwnerCClaims = async () => ({ sub: 'owner-c' });
    globalThis.__authOwnerLogto = {
      isAuthenticated: true,
      isLoading: false,
      getIdTokenClaims: getOwnerCClaims,
    };
    runtime.render(() => useAuthUserKey());
    await settleAsyncWork();
    assert.equal(tokenRequests, 2, 'C must await the one in-flight B verification request');
    assert.equal(fakeTimers.pendingCount(), 1);

    activeToken = createToken('owner-c');
    await fakeTimers.advanceBy(9_999);
    assert.equal(tokenRequests, 2);
    assert.equal(authModule.readAuthSessionSnapshot().ownerKey, null);
    await fakeTimers.advanceBy(1);
    assert.equal(fakeTimers.pendingCount(), 1, 'only the current C loop may schedule a retry');

    await fakeTimers.advanceBy(50);
    assert.equal(tokenRequests, 3, 'only the C loop may retry');
    assert.equal(authModule.readAuthSessionSnapshot().ownerKey, 'owner-c');

    pendingTokenRead.resolve(createToken('owner-b'));
    await settleAsyncWork();
    assert.equal(authModule.readAuthSessionSnapshot().ownerKey, 'owner-c');

    const requestsBeforeUnmount = tokenRequests;
    runtime.unmount();
    assert.equal(fakeTimers.pendingCount(), 0);
    await fakeTimers.advanceBy(60_000);
    assert.equal(tokenRequests, requestsBeforeUnmount);
    assert.equal(authModule.readAuthSessionSnapshot().ownerKey, 'owner-c');
  } finally {
    runtime.unmount();
    authModule.clearAuthTokenProvider();
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    delete globalThis.__authOwnerHookRuntime;
    delete globalThis.__authOwnerLogto;
    delete globalThis.__authOwnerFallback;
  }
});

test('unmount cancels a hung verification timeout and absorbs its late rejection', async () => {
  const runtime = createHookRuntime();
  const fakeTimers = createFakeTimers();
  const pendingTokenRead = deferred();
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const originalConsoleWarn = console.warn;
  let activeToken = createToken('owner-a');
  let tokenRequests = 0;
  globalThis.__authOwnerHookRuntime = runtime;
  const authModule = await importUseAuthUserKey();
  const { useAuthUserKey } = authModule;
  authModule.setAuthTokenProvider(async () => {
    tokenRequests += 1;
    return activeToken;
  });

  try {
    console.warn = () => undefined;
    const getOwnerAClaims = async () => ({ sub: 'owner-a' });
    globalThis.__authOwnerLogto = {
      isAuthenticated: true,
      isLoading: false,
      getIdTokenClaims: getOwnerAClaims,
    };
    runtime.render(() => useAuthUserKey());
    await settleAsyncWork();
    await authModule.requestAuthToken();

    globalThis.setTimeout = fakeTimers.setTimeout;
    globalThis.clearTimeout = fakeTimers.clearTimeout;
    activeToken = pendingTokenRead.promise;
    const getOwnerBClaims = async () => ({ sub: 'owner-b' });
    globalThis.__authOwnerLogto = {
      isAuthenticated: true,
      isLoading: false,
      getIdTokenClaims: getOwnerBClaims,
    };
    runtime.render(() => useAuthUserKey());
    await settleAsyncWork();
    assert.equal(authModule.readAuthSessionSnapshot().ownerKey, null);
    assert.equal(tokenRequests, 2);
    assert.equal(fakeTimers.pendingCount(), 1);

    runtime.unmount();
    authModule.clearAuthTokenProvider();
    assert.equal(fakeTimers.pendingCount(), 0);
    pendingTokenRead.reject(new Error('late SDK rejection'));
    await settleAsyncWork();
    await fakeTimers.advanceBy(60_000);
    assert.equal(tokenRequests, 2);
    assert.equal(authModule.readAuthSessionSnapshot().ownerKey, null);
  } finally {
    runtime.unmount();
    authModule.clearAuthTokenProvider();
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    console.warn = originalConsoleWarn;
    delete globalThis.__authOwnerHookRuntime;
    delete globalThis.__authOwnerLogto;
    delete globalThis.__authOwnerFallback;
  }
});
