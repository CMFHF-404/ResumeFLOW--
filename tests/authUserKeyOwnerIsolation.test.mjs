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
          subscribeAuthSession,
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
  let activeToken = createToken('owner-a');
  authModule.setAuthTokenProvider(async () => activeToken);
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
    activeToken = createToken('owner-b');
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

test('a Logto claims proxy loading toggle preserves its own in-flight read', async () => {
  const runtime = createHookRuntime();
  globalThis.__authOwnerHookRuntime = runtime;
  globalThis.__authOwnerFallback = async () => null;
  const authModule = await importUseAuthUserKey();
  const { useAuthUserKey } = authModule;
  authModule.setAuthTokenProvider(async () => createToken('owner-a'));
  const ownerAClaims = deferred();
  let getterCalls = 0;
  const getOwnerAClaims = () => {
    getterCalls += 1;
    return ownerAClaims.promise;
  };

  try {
    globalThis.__authOwnerLogto = {
      isAuthenticated: true,
      isLoading: false,
      getIdTokenClaims: getOwnerAClaims,
    };
    assert.equal(runtime.render(() => useAuthUserKey()), null);
    assert.equal(getterCalls, 1);

    globalThis.__authOwnerLogto = {
      isAuthenticated: true,
      isLoading: true,
      getIdTokenClaims: getOwnerAClaims,
    };
    assert.equal(runtime.render(() => useAuthUserKey()), null);

    globalThis.__authOwnerLogto = {
      isAuthenticated: true,
      isLoading: false,
      getIdTokenClaims: getOwnerAClaims,
    };
    ownerAClaims.resolve({ sub: 'owner-a' });
    await settleAsyncWork();
    assert.equal(runtime.render(() => useAuthUserKey()), 'owner-a');
    assert.equal(runtime.render(() => useAuthUserKey()), 'owner-a');
    assert.equal(
      getterCalls,
      2,
      'the original claims read is preserved and one post-token safety recheck is allowed',
    );
  } finally {
    delete globalThis.__authOwnerHookRuntime;
    delete globalThis.__authOwnerLogto;
    delete globalThis.__authOwnerFallback;
    authModule.clearAuthTokenProvider();
  }
});

test('an initial account-switch pulse cannot commit deferred claims from the previous owner', async () => {
  const runtime = createHookRuntime();
  const staleOwnerAClaims = deferred();
  let activeToken = createToken('owner-a');
  let claimsCalls = 0;
  const stableClaimsGetter = () => {
    claimsCalls += 1;
    return claimsCalls === 1
      ? staleOwnerAClaims.promise
      : Promise.resolve({ sub: 'owner-b' });
  };
  globalThis.__authOwnerHookRuntime = runtime;
  globalThis.__authOwnerFallback = async () => null;
  const authModule = await importUseAuthUserKey();
  const { useAuthUserKey } = authModule;
  authModule.setAuthTokenProvider(async () => activeToken);

  try {
    globalThis.__authOwnerLogto = {
      isAuthenticated: true,
      isLoading: false,
      getIdTokenClaims: stableClaimsGetter,
    };
    assert.equal(runtime.render(() => useAuthUserKey()), null);
    assert.equal(claimsCalls, 1);

    globalThis.__authOwnerLogto = {
      isAuthenticated: true,
      isLoading: true,
      getIdTokenClaims: stableClaimsGetter,
    };
    runtime.render(() => useAuthUserKey());
    activeToken = createToken('owner-b');
    globalThis.__authOwnerLogto = {
      isAuthenticated: true,
      isLoading: false,
      getIdTokenClaims: stableClaimsGetter,
    };
    runtime.render(() => useAuthUserKey());

    staleOwnerAClaims.resolve({ sub: 'owner-a' });
    await settleAsyncWork();
    runtime.render(() => useAuthUserKey());
    await settleAsyncWork();
    assert.equal(runtime.render(() => useAuthUserKey()), 'owner-b');
    assert.equal(authModule.readAuthSessionSnapshot().ownerKey, 'owner-b');
    assert.ok(claimsCalls >= 1);
  } finally {
    runtime.unmount();
    authModule.clearAuthTokenProvider();
    delete globalThis.__authOwnerHookRuntime;
    delete globalThis.__authOwnerLogto;
    delete globalThis.__authOwnerFallback;
  }
});

test('an overlapping account-switch pulse cannot commit stale same-owner claims', async () => {
  const runtime = createHookRuntime();
  const staleOwnerAClaims = deferred();
  let claimsCalls = 0;
  let activeToken = createToken('owner-a');
  let freshClaimsOwner = 'owner-a';
  const stableClaimsGetter = async () => {
    claimsCalls += 1;
    if (claimsCalls === 1) {
      return { sub: 'owner-a' };
    }
    if (claimsCalls === 2) {
      return staleOwnerAClaims.promise;
    }
    return { sub: freshClaimsOwner };
  };
  globalThis.__authOwnerHookRuntime = runtime;
  globalThis.__authOwnerFallback = async () => null;
  const authModule = await importUseAuthUserKey();
  const { useAuthUserKey } = authModule;
  authModule.setAuthTokenProvider(async () => activeToken);

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
    assert.equal(claimsCalls, 2);

    activeToken = createToken('owner-b');
    freshClaimsOwner = 'owner-b';
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

    staleOwnerAClaims.resolve({ sub: 'owner-a' });
    await settleAsyncWork();
    runtime.render(() => useAuthUserKey());
    await settleAsyncWork();
    assert.equal(runtime.render(() => useAuthUserKey()), 'owner-b');
    assert.equal(authModule.readAuthSessionSnapshot().ownerKey, 'owner-b');
  } finally {
    runtime.unmount();
    authModule.clearAuthTokenProvider();
    delete globalThis.__authOwnerHookRuntime;
    delete globalThis.__authOwnerLogto;
    delete globalThis.__authOwnerFallback;
  }
});

test('a loading pulse with null claims hides the old owner and resolves the current token owner', async () => {
  const runtime = createHookRuntime();
  const switchedClaims = deferred();
  let claimsCalls = 0;
  let activeToken = createToken('owner-a');
  const stableClaimsGetter = () => {
    claimsCalls += 1;
    return claimsCalls === 1
      ? Promise.resolve({ sub: 'owner-a' })
      : switchedClaims.promise;
  };
  globalThis.__authOwnerHookRuntime = runtime;
  let authModule;
  globalThis.__authOwnerFallback = async () => {
    await authModule.requestAuthToken();
    return authModule.readAuthSessionSnapshot().ownerKey;
  };
  authModule = await importUseAuthUserKey();
  const { useAuthUserKey } = authModule;
  authModule.setAuthTokenProvider(async () => activeToken);

  try {
    globalThis.__authOwnerLogto = {
      isAuthenticated: true,
      isLoading: false,
      getIdTokenClaims: stableClaimsGetter,
    };
    runtime.render(() => useAuthUserKey());
    await settleAsyncWork();
    await authModule.requestAuthToken();
    assert.equal(runtime.render(() => useAuthUserKey()), 'owner-a');

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
    assert.equal(claimsCalls, 2);

    globalThis.__authOwnerLogto = {
      isAuthenticated: true,
      isLoading: true,
      getIdTokenClaims: stableClaimsGetter,
    };
    runtime.render(() => useAuthUserKey());
    activeToken = createToken('owner-b');
    globalThis.__authOwnerLogto = {
      isAuthenticated: true,
      isLoading: false,
      getIdTokenClaims: stableClaimsGetter,
    };
    runtime.render(() => useAuthUserKey());

    switchedClaims.resolve(null);
    await settleAsyncWork();
    assert.equal(runtime.render(() => useAuthUserKey()), 'owner-b');
    assert.equal(authModule.readAuthSessionSnapshot().ownerKey, 'owner-b');
  } finally {
    runtime.unmount();
    authModule.clearAuthTokenProvider();
    delete globalThis.__authOwnerHookRuntime;
    delete globalThis.__authOwnerLogto;
    delete globalThis.__authOwnerFallback;
  }
});

test('a real loading pulse during token verification rereads claims for the newest owner', async () => {
  const runtime = createHookRuntime();
  const ownerBToken = deferred();
  let claimsCalls = 0;
  let tokenRequests = 0;
  let unsubscribe = () => undefined;
  const publishedOwners = [];
  const stableClaimsGetter = async () => {
    claimsCalls += 1;
    return { sub: claimsCalls === 1 ? 'owner-a' : claimsCalls === 2 ? 'owner-b' : 'owner-c' };
  };
  globalThis.__authOwnerHookRuntime = runtime;
  globalThis.__authOwnerFallback = async () => null;
  const authModule = await importUseAuthUserKey();
  const { useAuthUserKey } = authModule;
  authModule.setAuthTokenProvider(() => {
    tokenRequests += 1;
    if (tokenRequests === 1) return Promise.resolve(createToken('owner-a'));
    if (tokenRequests === 2) return ownerBToken.promise;
    return Promise.resolve(createToken('owner-c'));
  });

  try {
    globalThis.__authOwnerLogto = {
      isAuthenticated: true,
      isLoading: false,
      getIdTokenClaims: stableClaimsGetter,
    };
    runtime.render(() => useAuthUserKey());
    await settleAsyncWork();
    await authModule.requestAuthToken();
    assert.equal(runtime.render(() => useAuthUserKey()), 'owner-a');
    publishedOwners.push(authModule.readAuthSessionSnapshot().ownerKey);
    unsubscribe = authModule.subscribeAuthSession(() => {
      publishedOwners.push(authModule.readAuthSessionSnapshot().ownerKey);
    });

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
    assert.equal(claimsCalls, 2);
    assert.equal(tokenRequests, 2);
    assert.equal(authModule.readAuthSessionSnapshot().ownerKey, null);

    globalThis.__authOwnerLogto = {
      isAuthenticated: true,
      isLoading: true,
      getIdTokenClaims: stableClaimsGetter,
    };
    runtime.render(() => useAuthUserKey());
    ownerBToken.resolve(createToken('owner-b'));
    await settleAsyncWork();
    assert.equal(
      authModule.readAuthSessionSnapshot().ownerKey,
      null,
      'the cancelled B token must not become visible after the C switch starts',
    );
    globalThis.__authOwnerLogto = {
      isAuthenticated: true,
      isLoading: false,
      getIdTokenClaims: stableClaimsGetter,
    };
    runtime.render(() => useAuthUserKey());
    await settleAsyncWork();

    assert.equal(claimsCalls, 5);
    assert.equal(tokenRequests, 3);
    assert.equal(runtime.render(() => useAuthUserKey()), 'owner-c');
    assert.equal(authModule.readAuthSessionSnapshot().ownerKey, 'owner-c');
    assert.deepEqual(
      publishedOwners.filter((owner, index) => index === 0 || owner !== publishedOwners[index - 1]),
      ['owner-a', null, 'owner-c'],
      'the superseded B proof must never be published between A and C',
    );
  } finally {
    unsubscribe();
    ownerBToken.resolve(null);
    runtime.unmount();
    authModule.clearAuthTokenProvider();
    delete globalThis.__authOwnerHookRuntime;
    delete globalThis.__authOwnerLogto;
    delete globalThis.__authOwnerFallback;
  }
});

test('a current-owner token getter loading pulse does not restart verification forever', async () => {
  const runtime = createHookRuntime();
  const verificationToken = deferred();
  const tokenA = createToken('owner-a');
  let tokenRequests = 0;
  const stableClaimsGetter = async () => ({ sub: 'owner-a' });
  globalThis.__authOwnerHookRuntime = runtime;
  globalThis.__authOwnerFallback = async () => null;
  const authModule = await importUseAuthUserKey();
  const { useAuthUserKey } = authModule;
  authModule.setAuthTokenProvider(() => {
    tokenRequests += 1;
    if (tokenRequests !== 2) {
      return Promise.resolve(tokenA);
    }
    globalThis.__authOwnerLogto = {
      isAuthenticated: true,
      isLoading: true,
      getIdTokenClaims: stableClaimsGetter,
    };
    runtime.render(() => useAuthUserKey());
    return verificationToken.promise.then((token) => {
      globalThis.__authOwnerLogto = {
        isAuthenticated: true,
        isLoading: false,
        getIdTokenClaims: stableClaimsGetter,
      };
      runtime.render(() => useAuthUserKey());
      return token;
    });
  });

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
    assert.equal(tokenRequests, 2);

    verificationToken.resolve(tokenA);
    await settleAsyncWork();
    assert.equal(tokenRequests, 2, 'the token getter pulse must not start another verifier');
    assert.equal(authModule.readAuthSessionSnapshot().ownerKey, 'owner-a');
    assert.equal(tokenRequests, 2);
  } finally {
    verificationToken.resolve(tokenA);
    runtime.unmount();
    authModule.clearAuthTokenProvider();
    delete globalThis.__authOwnerHookRuntime;
    delete globalThis.__authOwnerLogto;
    delete globalThis.__authOwnerFallback;
  }
});

test('a switched-owner token getter loading pulse does not cancel its own verification', async () => {
  const runtime = createHookRuntime();
  const ownerBToken = deferred();
  const tokenA = createToken('owner-a');
  const tokenB = createToken('owner-b');
  let claimsOwner = 'owner-a';
  let tokenRequests = 0;
  const stableClaimsGetter = async () => ({ sub: claimsOwner });
  globalThis.__authOwnerHookRuntime = runtime;
  globalThis.__authOwnerFallback = async () => null;
  const authModule = await importUseAuthUserKey();
  const { useAuthUserKey } = authModule;
  authModule.setAuthTokenProvider(() => {
    tokenRequests += 1;
    if (tokenRequests === 1) {
      return Promise.resolve(tokenA);
    }
    if (tokenRequests === 2) {
      globalThis.__authOwnerLogto = {
        isAuthenticated: true,
        isLoading: true,
        getIdTokenClaims: stableClaimsGetter,
      };
      runtime.render(() => useAuthUserKey());
      return ownerBToken.promise.then((token) => {
        globalThis.__authOwnerLogto = {
          isAuthenticated: true,
          isLoading: false,
          getIdTokenClaims: stableClaimsGetter,
        };
        runtime.render(() => useAuthUserKey());
        return token;
      });
    }
    return Promise.resolve(tokenB);
  });

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
    assert.equal(tokenRequests, 2);

    ownerBToken.resolve(tokenB);
    await settleAsyncWork();
    runtime.render(() => useAuthUserKey());
    await settleAsyncWork();
    assert.equal(tokenRequests, 2, 'the B verifier must not restart after its own loading pulse');
    assert.equal(authModule.readAuthSessionSnapshot().ownerKey, 'owner-b');
  } finally {
    ownerBToken.resolve(tokenB);
    runtime.unmount();
    authModule.clearAuthTokenProvider();
    delete globalThis.__authOwnerHookRuntime;
    delete globalThis.__authOwnerLogto;
    delete globalThis.__authOwnerFallback;
  }
});

test('a current-owner verification rechecks claims before preserving old authority', async () => {
  const runtime = createHookRuntime();
  const pendingOwnerAToken = deferred();
  const tokenA = createToken('owner-a');
  const tokenB = createToken('owner-b');
  let claimsOwner = 'owner-a';
  let claimsCalls = 0;
  let tokenRequests = 0;
  const stableClaimsGetter = async () => {
    claimsCalls += 1;
    return { sub: claimsOwner };
  };
  globalThis.__authOwnerHookRuntime = runtime;
  globalThis.__authOwnerFallback = async () => null;
  const authModule = await importUseAuthUserKey();
  const { useAuthUserKey } = authModule;
  authModule.setAuthTokenProvider(() => {
    tokenRequests += 1;
    if (tokenRequests === 1) {
      return Promise.resolve(tokenA);
    }
    if (tokenRequests === 2) {
      globalThis.__authOwnerLogto = {
        isAuthenticated: true,
        isLoading: true,
        getIdTokenClaims: stableClaimsGetter,
      };
      runtime.render(() => useAuthUserKey());
      return pendingOwnerAToken.promise.then((token) => {
        globalThis.__authOwnerLogto = {
          isAuthenticated: true,
          isLoading: false,
          getIdTokenClaims: stableClaimsGetter,
        };
        runtime.render(() => useAuthUserKey());
        return token;
      });
    }
    return Promise.resolve(tokenB);
  });

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
    assert.equal(tokenRequests, 2);

    claimsOwner = 'owner-b';
    pendingOwnerAToken.resolve(tokenA);
    await settleAsyncWork();
    await settleAsyncWork();
    assert.equal(claimsCalls, 3, 'verification should reread claims after confirming A');
    assert.equal(
      authModule.readAuthSessionSnapshot().ownerKey,
      null,
      'fresh B claims must revoke A before starting their verifier',
    );
    runtime.render(() => useAuthUserKey());
    await settleAsyncWork();
    await settleAsyncWork();

    assert.equal(tokenRequests, 3, 'fresh B claims should be verified exactly once');
    assert.equal(authModule.readAuthSessionSnapshot().ownerKey, 'owner-b');
  } finally {
    pendingOwnerAToken.resolve(tokenA);
    runtime.unmount();
    authModule.clearAuthTokenProvider();
    delete globalThis.__authOwnerHookRuntime;
    delete globalThis.__authOwnerLogto;
    delete globalThis.__authOwnerFallback;
  }
});

test('a getter replacement during token verification rejects the superseded late token', async () => {
  const runtime = createHookRuntime();
  const ownerBClaims = deferred();
  const ownerBToken = deferred();
  const ownerCToken = deferred();
  let tokenRequests = 0;
  const ownerAClaimsGetter = async () => ({ sub: 'owner-a' });
  const ownerBClaimsGetter = () => ownerBClaims.promise;
  const ownerCClaimsGetter = async () => ({ sub: 'owner-c' });
  globalThis.__authOwnerHookRuntime = runtime;
  globalThis.__authOwnerFallback = async () => null;
  const authModule = await importUseAuthUserKey();
  const { useAuthUserKey } = authModule;
  authModule.setAuthTokenProvider(() => {
    tokenRequests += 1;
    if (tokenRequests === 1) return Promise.resolve(createToken('owner-a'));
    if (tokenRequests === 2) return ownerBToken.promise;
    return ownerCToken.promise;
  });

  try {
    globalThis.__authOwnerLogto = {
      isAuthenticated: true,
      isLoading: false,
      getIdTokenClaims: ownerAClaimsGetter,
    };
    runtime.render(() => useAuthUserKey());
    await settleAsyncWork();
    await authModule.requestAuthToken();
    assert.equal(runtime.render(() => useAuthUserKey()), 'owner-a');

    globalThis.__authOwnerLogto = {
      isAuthenticated: true,
      isLoading: false,
      getIdTokenClaims: ownerBClaimsGetter,
    };
    runtime.render(() => useAuthUserKey());
    globalThis.__authOwnerLogto = {
      isAuthenticated: true,
      isLoading: true,
      getIdTokenClaims: ownerBClaimsGetter,
    };
    runtime.render(() => useAuthUserKey());
    globalThis.__authOwnerLogto = {
      isAuthenticated: true,
      isLoading: false,
      getIdTokenClaims: ownerBClaimsGetter,
    };
    runtime.render(() => useAuthUserKey());
    ownerBClaims.resolve({ sub: 'owner-b' });
    await settleAsyncWork();
    assert.equal(tokenRequests, 2);
    assert.equal(
      authModule.readAuthSessionSnapshot().ownerKey,
      null,
      'fresh B claims hide A while the non-publishing B probe is pending',
    );

    globalThis.__authOwnerLogto = {
      isAuthenticated: true,
      isLoading: false,
      getIdTokenClaims: ownerCClaimsGetter,
    };
    runtime.render(() => useAuthUserKey());
    await settleAsyncWork();
    assert.equal(
      tokenRequests,
      2,
      'the C verifier may share the bounded in-flight wrapper until B settles',
    );

    ownerBToken.resolve(createToken('owner-b'));
    await settleAsyncWork();
    await new Promise((resolve) => setTimeout(resolve, 70));
    await settleAsyncWork();
    assert.equal(tokenRequests, 3);
    assert.notEqual(
      authModule.readAuthSessionSnapshot().ownerKey,
      'owner-b',
      'the superseded B token must not publish after the C getter becomes current',
    );

    ownerCToken.resolve(createToken('owner-c'));
    await settleAsyncWork();
    assert.equal(runtime.render(() => useAuthUserKey()), 'owner-c');
  } finally {
    ownerBToken.resolve(null);
    ownerCToken.resolve(null);
    runtime.unmount();
    authModule.clearAuthTokenProvider();
    delete globalThis.__authOwnerHookRuntime;
    delete globalThis.__authOwnerLogto;
    delete globalThis.__authOwnerFallback;
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

test('an initial timed-out verification retries without requiring another render', async () => {
  const runtime = createHookRuntime();
  const fakeTimers = createFakeTimers();
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const pendingTokenRead = deferred();
  const ownerAClaims = deferred();
  let tokenRequests = 0;
  globalThis.__authOwnerHookRuntime = runtime;
  globalThis.__authOwnerFallback = async () => null;
  const authModule = await importUseAuthUserKey();
  const { useAuthUserKey } = authModule;
  authModule.setAuthTokenProvider(async () => {
    tokenRequests += 1;
    return tokenRequests === 1
      ? pendingTokenRead.promise
      : createToken('owner-a');
  });

  try {
    globalThis.setTimeout = fakeTimers.setTimeout;
    globalThis.clearTimeout = fakeTimers.clearTimeout;
    const getOwnerAClaims = () => ownerAClaims.promise;
    globalThis.__authOwnerLogto = {
      isAuthenticated: true,
      isLoading: false,
      getIdTokenClaims: getOwnerAClaims,
    };
    assert.equal(runtime.render(() => useAuthUserKey()), null);

    globalThis.__authOwnerLogto = {
      isAuthenticated: true,
      isLoading: true,
      getIdTokenClaims: getOwnerAClaims,
    };
    runtime.render(() => useAuthUserKey());
    globalThis.__authOwnerLogto = {
      isAuthenticated: true,
      isLoading: false,
      getIdTokenClaims: getOwnerAClaims,
    };
    runtime.render(() => useAuthUserKey());
    ownerAClaims.resolve({ sub: 'owner-a' });
    await settleAsyncWork();
    assert.equal(tokenRequests, 1);

    await fakeTimers.advanceBy(10_000);
    assert.equal(authModule.readAuthSessionSnapshot().ownerKey, null);
    await fakeTimers.advanceBy(50);
    assert.equal(tokenRequests, 2);
    assert.equal(authModule.readAuthSessionSnapshot().ownerKey, 'owner-a');
    assert.equal(runtime.render(() => useAuthUserKey()), 'owner-a');
  } finally {
    pendingTokenRead.resolve(null);
    runtime.unmount();
    authModule.clearAuthTokenProvider();
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    delete globalThis.__authOwnerHookRuntime;
    delete globalThis.__authOwnerLogto;
    delete globalThis.__authOwnerFallback;
  }
});

test('an invalid-grant verification stops without scheduling another token request', async () => {
  const runtime = createHookRuntime();
  const fakeTimers = createFakeTimers();
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const originalConsoleWarn = console.warn;
  const ownerAClaims = deferred();
  const getOwnerAClaims = () => ownerAClaims.promise;
  let tokenRequests = 0;
  globalThis.__authOwnerHookRuntime = runtime;
  globalThis.__authOwnerFallback = async () => null;
  const authModule = await importUseAuthUserKey();
  const { useAuthUserKey } = authModule;
  authModule.setAuthTokenProvider(async () => {
    tokenRequests += 1;
    const error = new Error('Authorization request is invalid');
    error.code = 'oidc.invalid_grant';
    throw error;
  });

  try {
    console.warn = () => undefined;
    globalThis.setTimeout = fakeTimers.setTimeout;
    globalThis.clearTimeout = fakeTimers.clearTimeout;
    globalThis.__authOwnerLogto = {
      isAuthenticated: true,
      isLoading: false,
      getIdTokenClaims: getOwnerAClaims,
    };

    assert.equal(runtime.render(() => useAuthUserKey()), null);
    globalThis.__authOwnerLogto = {
      isAuthenticated: true,
      isLoading: true,
      getIdTokenClaims: getOwnerAClaims,
    };
    runtime.render(() => useAuthUserKey());
    globalThis.__authOwnerLogto = {
      isAuthenticated: true,
      isLoading: false,
      getIdTokenClaims: getOwnerAClaims,
    };
    runtime.render(() => useAuthUserKey());
    ownerAClaims.resolve({ sub: 'owner-a' });
    await settleAsyncWork();

    assert.equal(tokenRequests, 1);
    assert.equal(fakeTimers.pendingCount(), 0);
    await fakeTimers.advanceBy(60_000);
    assert.equal(tokenRequests, 1);
  } finally {
    runtime.unmount();
    authModule.clearAuthTokenProvider();
    console.warn = originalConsoleWarn;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    delete globalThis.__authOwnerHookRuntime;
    delete globalThis.__authOwnerLogto;
    delete globalThis.__authOwnerFallback;
  }
});

test('verification rate-limits hung token reads and half-opens after a cooldown', async () => {
  const runtime = createHookRuntime();
  const fakeTimers = createFakeTimers();
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const ownerAClaims = deferred();
  const tokenReads = [];
  let tokenRequests = 0;
  globalThis.__authOwnerHookRuntime = runtime;
  globalThis.__authOwnerFallback = async () => null;
  const authModule = await importUseAuthUserKey();
  const { useAuthUserKey } = authModule;
  authModule.setAuthTokenProvider(() => {
    tokenRequests += 1;
    if (tokenRequests === 3) return Promise.resolve(createToken('owner-a'));
    const tokenRead = deferred();
    tokenReads.push(tokenRead);
    return tokenRead.promise;
  });

  try {
    globalThis.setTimeout = fakeTimers.setTimeout;
    globalThis.clearTimeout = fakeTimers.clearTimeout;
    const getOwnerAClaims = () => ownerAClaims.promise;
    globalThis.__authOwnerLogto = {
      isAuthenticated: true,
      isLoading: false,
      getIdTokenClaims: getOwnerAClaims,
    };
    assert.equal(runtime.render(() => useAuthUserKey()), null);

    globalThis.__authOwnerLogto = {
      isAuthenticated: true,
      isLoading: true,
      getIdTokenClaims: getOwnerAClaims,
    };
    runtime.render(() => useAuthUserKey());
    globalThis.__authOwnerLogto = {
      isAuthenticated: true,
      isLoading: false,
      getIdTokenClaims: getOwnerAClaims,
    };
    runtime.render(() => useAuthUserKey());
    ownerAClaims.resolve({ sub: 'owner-a' });
    await settleAsyncWork();
    assert.equal(tokenRequests, 1);

    await fakeTimers.advanceBy(10_000);
    await fakeTimers.advanceBy(50);
    assert.equal(tokenRequests, 2);
    await fakeTimers.advanceBy(10_000);
    assert.equal(tokenRequests, 2);
    assert.equal(authModule.readAuthSessionSnapshot().ownerKey, null);
    assert.equal(fakeTimers.pendingCount(), 1, 'one cooldown timer should own the half-open probe');

    await fakeTimers.advanceBy(29_999);
    assert.equal(tokenRequests, 2);
    await fakeTimers.advanceBy(1);
    assert.equal(tokenRequests, 3);
    assert.equal(authModule.readAuthSessionSnapshot().ownerKey, 'owner-a');
    assert.equal(runtime.render(() => useAuthUserKey()), 'owner-a');
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

test('multiple hook instances share one pending token verification request', async () => {
  const runtimes = [createHookRuntime(), createHookRuntime(), createHookRuntime()];
  const pendingOwnerBToken = deferred();
  let claimsOwner = 'owner-a';
  let tokenRequests = 0;
  let unsubscribe = () => undefined;
  const publishedOwners = [];
  globalThis.__authOwnerFallback = async () => null;
  const authModule = await importUseAuthUserKey();
  const { useAuthUserKey } = authModule;
  authModule.setAuthTokenProvider(() => {
    tokenRequests += 1;
    return tokenRequests === 1
      ? Promise.resolve(createToken('owner-a'))
      : pendingOwnerBToken.promise;
  });
  const stableClaimsGetter = async () => ({ sub: claimsOwner });
  const renderAll = () => {
    for (const runtime of runtimes) {
      globalThis.__authOwnerHookRuntime = runtime;
      runtime.render(() => useAuthUserKey());
    }
  };

  try {
    globalThis.__authOwnerLogto = {
      isAuthenticated: true,
      isLoading: false,
      getIdTokenClaims: stableClaimsGetter,
    };
    renderAll();
    await settleAsyncWork();
    await authModule.requestAuthToken();
    assert.equal(tokenRequests, 1);
    publishedOwners.push(authModule.readAuthSessionSnapshot().ownerKey);
    unsubscribe = authModule.subscribeAuthSession(() => {
      publishedOwners.push(authModule.readAuthSessionSnapshot().ownerKey);
    });

    claimsOwner = 'owner-b';
    globalThis.__authOwnerLogto = {
      isAuthenticated: true,
      isLoading: true,
      getIdTokenClaims: stableClaimsGetter,
    };
    renderAll();
    globalThis.__authOwnerLogto = {
      isAuthenticated: true,
      isLoading: false,
      getIdTokenClaims: stableClaimsGetter,
    };
    renderAll();
    await settleAsyncWork();

    assert.equal(tokenRequests, 2, 'all hook instances must share one B verification request');
    assert.equal(authModule.readAuthSessionSnapshot().ownerKey, null);

    pendingOwnerBToken.resolve(createToken('owner-b'));
    await settleAsyncWork();
    renderAll();
    await settleAsyncWork();
    assert.equal(tokenRequests, 2, 'a shared proof should publish without starting another request');
    assert.equal(authModule.readAuthSessionSnapshot().ownerKey, 'owner-b');
    assert.deepEqual(
      publishedOwners.filter((owner, index) => index === 0 || owner !== publishedOwners[index - 1]),
      ['owner-a', null, 'owner-b'],
    );
  } finally {
    unsubscribe();
    pendingOwnerBToken.resolve(null);
    for (const runtime of runtimes) {
      globalThis.__authOwnerHookRuntime = runtime;
      runtime.unmount();
    }
    authModule.clearAuthTokenProvider();
    delete globalThis.__authOwnerHookRuntime;
    delete globalThis.__authOwnerLogto;
    delete globalThis.__authOwnerFallback;
  }
});

test('getter identity churn cannot bypass the hung verification budget before cooldown', async () => {
  const runtime = createHookRuntime();
  const fakeTimers = createFakeTimers();
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const initialClaims = deferred();
  const tokenReads = [];
  let tokenRequests = 0;
  globalThis.__authOwnerHookRuntime = runtime;
  globalThis.__authOwnerFallback = async () => null;
  const authModule = await importUseAuthUserKey();
  const { useAuthUserKey } = authModule;
  authModule.setAuthTokenProvider(() => {
    tokenRequests += 1;
    const tokenRead = deferred();
    tokenReads.push(tokenRead);
    return tokenRead.promise;
  });

  try {
    globalThis.setTimeout = fakeTimers.setTimeout;
    globalThis.clearTimeout = fakeTimers.clearTimeout;
    const initialClaimsGetter = () => initialClaims.promise;
    globalThis.__authOwnerLogto = {
      isAuthenticated: true,
      isLoading: false,
      getIdTokenClaims: initialClaimsGetter,
    };
    assert.equal(runtime.render(() => useAuthUserKey()), null);

    globalThis.__authOwnerLogto = {
      isAuthenticated: true,
      isLoading: true,
      getIdTokenClaims: initialClaimsGetter,
    };
    runtime.render(() => useAuthUserKey());
    globalThis.__authOwnerLogto = {
      isAuthenticated: true,
      isLoading: false,
      getIdTokenClaims: initialClaimsGetter,
    };
    runtime.render(() => useAuthUserKey());
    initialClaims.resolve({ sub: 'owner-a' });
    await settleAsyncWork();
    assert.equal(tokenRequests, 1);

    const replacementClaims = deferred();
    const replacementClaimsGetter = () => replacementClaims.promise;
    globalThis.__authOwnerLogto = {
      isAuthenticated: true,
      isLoading: false,
      getIdTokenClaims: replacementClaimsGetter,
    };
    runtime.render(() => useAuthUserKey());
    await fakeTimers.advanceBy(10_000);
    replacementClaims.resolve({ sub: 'owner-a' });
    await settleAsyncWork();
    assert.equal(tokenRequests, 2);

    const finalClaims = deferred();
    const finalClaimsGetter = () => finalClaims.promise;
    globalThis.__authOwnerLogto = {
      isAuthenticated: true,
      isLoading: false,
      getIdTokenClaims: finalClaimsGetter,
    };
    runtime.render(() => useAuthUserKey());
    await fakeTimers.advanceBy(10_000);
    finalClaims.resolve({ sub: 'owner-a' });
    await settleAsyncWork();

    assert.equal(tokenRequests, 2, 'stale effects must still consume the global timeout budget');
    assert.equal(authModule.readAuthSessionSnapshot().ownerKey, null);
    assert.equal(fakeTimers.pendingCount(), 1, 'only the shared cooldown probe may remain scheduled');
  } finally {
    for (const tokenRead of tokenReads) tokenRead.resolve(null);
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
