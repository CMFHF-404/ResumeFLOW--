import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import test from 'node:test';
import { build } from 'esbuild';

let importSequence = 0;

const importAuthGuard = async () => {
  const result = await build({
    entryPoints: ['components/AuthGuard.tsx'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    define: {
      'import.meta.env.VITE_LOGTO_REDIRECT_URI': 'undefined',
    },
    plugins: [{
      name: 'auth-guard-runtime-stubs',
      setup(buildContext) {
        const stub = (filter, path) => buildContext.onResolve({ filter }, () => ({
          path,
          namespace: 'stub',
        }));
        stub(/^react$/, 'react-stub');
        stub(/^react\/jsx-runtime$/, 'react-jsx-runtime-stub');
        stub(/^@logto\/react$/, 'logto-stub');
        stub(/^\.\.\/services\/authTokenProvider$/, 'token-provider-stub');
        stub(/^\.\.\/services\/authRedirect$/, 'auth-redirect-stub');
        stub(/^\.\.\/services\/authRecoveryCoordinator$/, 'recovery-stub');
        stub(/^\.\.\/services\/apiClient$/, 'api-client-stub');
        stub(/^\.\.\/services\/devLogger$/, 'dev-logger-stub');
        stub(/^\.\.\/services\/authFlowState$/, 'auth-flow-stub');
        stub(/^\.\.\/utils\/analyticsTracker$/, 'analytics-stub');

        buildContext.onLoad({ filter: /^react-stub$/, namespace: 'stub' }, () => ({
          contents: `
            export const useEffect = (...args) => globalThis.__authGuardHooks.useEffect(...args);
            export const useRef = (...args) => globalThis.__authGuardHooks.useRef(...args);
            export const useState = (...args) => globalThis.__authGuardHooks.useState(...args);
          `,
          loader: 'js',
        }));
        buildContext.onLoad({ filter: /^react-jsx-runtime-stub$/, namespace: 'stub' }, () => ({
          contents: `
            export const Fragment = Symbol('Fragment');
            export const jsx = (type, props) => ({ type, props });
            export const jsxs = jsx;
          `,
          loader: 'js',
        }));
        buildContext.onLoad({ filter: /^logto-stub$/, namespace: 'stub' }, () => ({
          contents: 'export const useLogto = () => globalThis.__authGuardLogto;',
          loader: 'js',
        }));
        buildContext.onLoad({ filter: /^token-provider-stub$/, namespace: 'stub' }, () => ({
          contents: `
            export const clearAuthTokenProvider = () => {};
            export const createLogtoAuthSessionRefresher = () => async () => null;
            export const isAuthSessionSnapshotCurrent = () => true;
            export const isAuthSessionInvalidError = () => true;
            export const markAuthSessionInvalid = () => true;
            export const readAuthSessionSnapshot = () => ({ epoch: 0, ownerKey: null });
            export const resolveUsableAuthToken = async () => null;
            export const setAuthTokenProvider = () => {};
          `,
          loader: 'js',
        }));
        buildContext.onLoad({ filter: /^auth-redirect-stub$/, namespace: 'stub' }, () => ({
          contents: `
            export const subscribeLoginRequired = (handler) => {
              globalThis.__authGuardLoginRequiredHandler = handler;
              return () => {};
            };
          `,
          loader: 'js',
        }));
        buildContext.onLoad({ filter: /^recovery-stub$/, namespace: 'stub' }, () => ({
          contents: `
            export const handleAuthFailure = (input) => {
              globalThis.__authGuardRecoveryInputs.push(input);
              return globalThis.__authGuardRecoveryOutcomes.shift() ?? 'ignored';
            };
            export const readAuthRecoveryIssue = () => null;
            export const resetAuthRecoveryCycle = () => {};
            export const scheduleAuthDependencyProbe = () => null;
            export const subscribeAuthRecoveryIssue = () => () => {};
          `,
          loader: 'js',
        }));
        buildContext.onLoad({ filter: /^api-client-stub$/, namespace: 'stub' }, () => ({
          contents: 'export default { get: async () => ({ status: 200 }) };',
          loader: 'js',
        }));
        buildContext.onLoad({ filter: /^dev-logger-stub$/, namespace: 'stub' }, () => ({
          contents: 'export const devLog = () => {};',
          loader: 'js',
        }));
        buildContext.onLoad({ filter: /^auth-flow-stub$/, namespace: 'stub' }, () => ({
          contents: `
            export const isForceReauthReason = (reason) => (
              reason === 'invalid-token' || reason === 'session-invalid'
            );
            export const markUserSignInStarted = () => {};
            export const shouldAutoSignInForLoginRequired = (input) => (
              globalThis.__authGuardShouldAutoSignIn
                ? globalThis.__authGuardShouldAutoSignIn(input)
                : !input.isLoading && !input.isSigningIn
            );
          `,
          loader: 'js',
        }));
        buildContext.onLoad({ filter: /^analytics-stub$/, namespace: 'stub' }, () => ({
          contents: 'export const trackLoginStart = async () => {};',
          loader: 'js',
        }));
      },
    }],
  });
  importSequence += 1;
  return import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}#${importSequence}`
  );
};

const createHookRuntime = () => {
  const slots = [];
  let cursor = 0;
  const depsChanged = (before, after) => (
    !before
    || before.length !== after.length
    || before.some((value, index) => !Object.is(value, after[index]))
  );
  return {
    render(component) {
      cursor = 0;
      return component();
    },
    useState(initialValue) {
      const index = cursor++;
      if (!slots[index]) {
        slots[index] = {
          value: typeof initialValue === 'function' ? initialValue() : initialValue,
        };
      }
      return [slots[index].value, (value) => {
        slots[index].value = typeof value === 'function'
          ? value(slots[index].value)
          : value;
      }];
    },
    useRef(initialValue) {
      const index = cursor++;
      if (!slots[index]) {
        slots[index] = { current: initialValue };
      }
      return slots[index];
    },
    useEffect(effect, deps = []) {
      const index = cursor++;
      const previous = slots[index]?.deps;
      slots[index] = { deps };
      if (depsChanged(previous, deps)) {
        effect();
      }
    },
  };
};

test('AuthGuard retries invalid-grant recovery when an unknown-owner attempt was ignored', async () => {
  globalThis.__authGuardHooks = createHookRuntime();
  globalThis.__authGuardRecoveryInputs = [];
  globalThis.__authGuardRecoveryOutcomes = ['ignored', 'login-requested'];
  globalThis.__authGuardLogto = {
    isAuthenticated: true,
    isLoading: false,
    error: { code: 'invalid_grant', generation: 1 },
    signIn: async () => {},
    clearAccessToken: async () => {},
    clearAllTokens: async () => {},
    getAccessToken: async () => null,
    getIdToken: null,
  };

  try {
    const { default: AuthGuard } = await importAuthGuard();
    const render = () => globalThis.__authGuardHooks.render(() => AuthGuard({
      authUserKey: null,
      children: null,
    }));
    render();
    globalThis.__authGuardLogto = {
      ...globalThis.__authGuardLogto,
      error: { code: 'invalid_grant', generation: 2 },
    };
    render();

    assert.equal(globalThis.__authGuardRecoveryInputs.length, 2);
    assert.equal(globalThis.__authGuardRecoveryInputs[0].sessionOwnerKey, null);
    assert.equal(globalThis.__authGuardRecoveryInputs[0].isAuthenticated, true);
    assert.equal(
      globalThis.__authGuardRecoveryInputs[0].data.error.code,
      'session_invalid',
      'Logto invalid_grant must retain frontend session semantics',
    );
  } finally {
    delete globalThis.__authGuardHooks;
    delete globalThis.__authGuardRecoveryInputs;
    delete globalThis.__authGuardRecoveryOutcomes;
    delete globalThis.__authGuardLogto;
  }
});

test('AuthGuard replays a login requirement that arrives while Logto is loading', async () => {
  globalThis.__authGuardHooks = createHookRuntime();
  globalThis.__authGuardRecoveryInputs = [];
  globalThis.__authGuardRecoveryOutcomes = [];
  let signInCalls = 0;
  let clearAllTokensCalls = 0;
  globalThis.__authGuardLogto = {
    isAuthenticated: true,
    isLoading: true,
    error: null,
    signIn: async () => {
      signInCalls += 1;
    },
    clearAccessToken: async () => {},
    clearAllTokens: async () => {
      clearAllTokensCalls += 1;
    },
    getAccessToken: async () => null,
    getIdToken: null,
  };

  try {
    const { default: AuthGuard } = await importAuthGuard();
    const render = () => globalThis.__authGuardHooks.render(() => AuthGuard({
      authUserKey: 'owner-a',
      children: null,
    }));
    render();

    globalThis.__authGuardLoginRequiredHandler({
      reason: 'invalid-token',
      redirectUri: 'https://app.example.com/callback',
    });
    await Promise.resolve();
    assert.equal(signInCalls, 0, 'loading must defer, rather than start, sign-in');

    globalThis.__authGuardLogto = {
      ...globalThis.__authGuardLogto,
      isLoading: false,
    };
    render();
    globalThis.__authGuardLoginRequiredHandler({
      reason: 'invalid-token',
      redirectUri: 'https://app.example.com/callback',
    });
    assert.equal(
      clearAllTokensCalls,
      1,
      'the replayed login must remain single-flight before navigation starts',
    );
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(clearAllTokensCalls, 1);
    assert.equal(signInCalls, 1, 'the deferred login must replay after loading');
  } finally {
    delete globalThis.__authGuardHooks;
    delete globalThis.__authGuardRecoveryInputs;
    delete globalThis.__authGuardRecoveryOutcomes;
    delete globalThis.__authGuardLogto;
    delete globalThis.__authGuardLoginRequiredHandler;
  }
});

test('AuthGuard does not queue a login event rejected by sign-out suppression', async () => {
  globalThis.__authGuardHooks = createHookRuntime();
  globalThis.__authGuardRecoveryInputs = [];
  globalThis.__authGuardRecoveryOutcomes = [];
  let signOutSuppressed = true;
  let signInCalls = 0;
  globalThis.__authGuardShouldAutoSignIn = ({ isLoading, isSigningIn }) => (
    !isLoading && !isSigningIn && !signOutSuppressed
  );
  globalThis.__authGuardLogto = {
    isAuthenticated: true,
    isLoading: true,
    error: null,
    signIn: async () => {
      signInCalls += 1;
    },
    clearAccessToken: async () => {},
    clearAllTokens: async () => {},
    getAccessToken: async () => null,
    getIdToken: null,
  };

  try {
    const { default: AuthGuard } = await importAuthGuard();
    const render = () => globalThis.__authGuardHooks.render(() => AuthGuard({
      authUserKey: 'owner-a',
      children: null,
    }));
    render();
    globalThis.__authGuardLoginRequiredHandler({ reason: 'invalid-token' });

    signOutSuppressed = false;
    globalThis.__authGuardLogto = {
      ...globalThis.__authGuardLogto,
      isLoading: false,
    };
    render();
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(signInCalls, 0, 'a stale logout-era event must never replay');
  } finally {
    delete globalThis.__authGuardHooks;
    delete globalThis.__authGuardRecoveryInputs;
    delete globalThis.__authGuardRecoveryOutcomes;
    delete globalThis.__authGuardLogto;
    delete globalThis.__authGuardLoginRequiredHandler;
    delete globalThis.__authGuardShouldAutoSignIn;
  }
});
