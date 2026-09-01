import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import { build } from 'esbuild';

let importSequence = 0;

const createSessionStorage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
};

const importCoordinator = async () => {
  const result = await build({
    entryPoints: ['services/authRecoveryCoordinator.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    define: {
      'import.meta.env.VITE_LOGTO_REDIRECT_URI': 'undefined',
    },
    plugins: [{
      name: 'stub-auth-redirect',
      setup(buildContext) {
        buildContext.onResolve({ filter: /^\.\/authRedirect$/ }, () => ({
          path: 'auth-redirect-stub',
          namespace: 'stub',
        }));
        buildContext.onLoad({ filter: /^auth-redirect-stub$/, namespace: 'stub' }, () => ({
          contents: `
            export const dispatchLoginRequired = (reason) => {
              globalThis.__authRecoveryDispatches.push(reason);
            };
          `,
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

const installBrowserRuntime = ({
  failSessionRead = false,
  failSessionRemove = false,
  failSessionWrite = false,
  failStorageGetter = false,
} = {}) => {
  const listeners = new Map();
  globalThis.sessionStorage = createSessionStorage();
  if (failSessionRead) {
    globalThis.sessionStorage.getItem = () => {
      throw new Error('storage read denied');
    };
  }
  if (failSessionWrite) {
    globalThis.sessionStorage.setItem = () => {
      throw new Error('storage quota exceeded');
    };
  }
  if (failSessionRemove) {
    globalThis.sessionStorage.removeItem = () => {
      throw new Error('storage remove denied');
    };
  }
  globalThis.CustomEvent = class CustomEvent extends Event {
    constructor(type, init = {}) {
      super(type);
      this.detail = init.detail;
    }
  };
  globalThis.window = {
    addEventListener(type, listener) {
      const group = listeners.get(type) ?? new Set();
      group.add(listener);
      listeners.set(type, group);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    dispatchEvent(event) {
      for (const listener of listeners.get(event.type) ?? []) {
        listener(event);
      }
      return true;
    },
  };
  Object.defineProperty(globalThis.window, 'sessionStorage', {
    configurable: true,
    get() {
      if (failStorageGetter) {
        throw new Error('storage access denied');
      }
      return globalThis.sessionStorage;
    },
  });
};

const uninstallBrowserRuntime = () => {
  delete globalThis.window;
  delete globalThis.sessionStorage;
  delete globalThis.CustomEvent;
  delete globalThis.__authRecoveryDispatches;
};

test('concurrent invalid-token responses trigger only one login recovery', async () => {
  installBrowserRuntime();
  globalThis.__authRecoveryDispatches = [];
  try {
    const { handleAuthFailure } = await importCoordinator();
    const input = {
      status: 401,
      data: { error: { code: 'invalid_token' } },
      sessionOwnerKey: 'owner-a',
      isCurrentSession: true,
    };

    assert.equal(handleAuthFailure(input), 'login-requested');
    assert.equal(handleAuthFailure(input), 'already-requested');
    assert.equal(handleAuthFailure(input), 'already-requested');
    assert.deepEqual(globalThis.__authRecoveryDispatches, ['invalid-token']);
  } finally {
    uninstallBrowserRuntime();
  }
});

test('an invalid token after OAuth page navigation becomes a stable error instead of another login', async () => {
  installBrowserRuntime();
  globalThis.__authRecoveryDispatches = [];
  try {
    const firstPage = await importCoordinator();
    assert.equal(firstPage.handleAuthFailure({
      status: 401,
      data: { error: { code: 'invalid_token' } },
      sessionOwnerKey: 'owner-a',
      isCurrentSession: true,
    }), 'login-requested');

    const secondPage = await importCoordinator();
    assert.equal(secondPage.handleAuthFailure({
      status: 401,
      data: { error: { code: 'invalid_token' } },
      sessionOwnerKey: 'owner-a',
      isCurrentSession: true,
    }), 'blocked');
    assert.deepEqual(globalThis.__authRecoveryDispatches, ['invalid-token']);
    assert.equal(secondPage.readAuthRecoveryIssue()?.kind, 'reauth-failed');
  } finally {
    uninstallBrowserRuntime();
  }
});

test('authentication dependency failures never request a login', async () => {
  installBrowserRuntime();
  globalThis.__authRecoveryDispatches = [];
  try {
    const {
      handleAuthFailure,
      markProtectedAuthSuccess,
      readAuthRecoveryIssue,
    } = await importCoordinator();
    assert.equal(handleAuthFailure({
      status: 503,
      data: { error: { code: 'auth_dependency_unavailable' } },
      sessionOwnerKey: 'owner-a',
      isCurrentSession: true,
    }), 'dependency-unavailable');
    assert.deepEqual(globalThis.__authRecoveryDispatches, []);
    assert.equal(readAuthRecoveryIssue()?.kind, 'dependency-unavailable');
    assert.equal(markProtectedAuthSuccess('/profile', 200, 'owner-a'), true);
    assert.equal(readAuthRecoveryIssue(), null);
    assert.equal(handleAuthFailure({
      status: 401,
      data: { error: { message: 'JWKS fetch failed' } },
      sessionOwnerKey: 'owner-a',
      isCurrentSession: true,
    }), 'dependency-unavailable');
    assert.deepEqual(globalThis.__authRecoveryDispatches, []);
  } finally {
    uninstallBrowserRuntime();
  }
});

test('only a successful protected profile probe clears the cross-page recovery cycle', async () => {
  installBrowserRuntime();
  globalThis.__authRecoveryDispatches = [];
  try {
    const firstPage = await importCoordinator();
    firstPage.handleAuthFailure({
      status: 401,
      data: { error: { code: 'session_invalid' } },
      sessionOwnerKey: 'owner-a',
      isCurrentSession: true,
    });
    assert.equal(firstPage.markProtectedAuthSuccess('/resumes', 200, 'owner-a'), false);

    const secondPage = await importCoordinator();
    assert.equal(secondPage.handleAuthFailure({
      status: 401,
      data: { error: { code: 'invalid_token' } },
      sessionOwnerKey: 'owner-a',
      isCurrentSession: true,
    }), 'blocked');
    assert.equal(secondPage.markProtectedAuthSuccess('/profile', 200, 'owner-a'), true);

    const thirdPage = await importCoordinator();
    assert.equal(thirdPage.handleAuthFailure({
      status: 401,
      data: { error: { code: 'invalid_token' } },
      sessionOwnerKey: 'owner-a',
      isCurrentSession: true,
    }), 'login-requested');
    assert.deepEqual(globalThis.__authRecoveryDispatches, ['session-invalid', 'invalid-token']);
  } finally {
    uninstallBrowserRuntime();
  }
});

test('authenticated invalid-grant with an unresolved owner recovers once and blocks after callback', async () => {
  installBrowserRuntime();
  globalThis.__authRecoveryDispatches = [];
  try {
    const firstPage = await importCoordinator();
    assert.equal(firstPage.handleAuthFailure({
      status: 401,
      data: { error: { code: 'session_invalid' } },
      sessionOwnerKey: null,
      isAuthenticated: true,
      isCurrentSession: true,
    }), 'login-requested');

    const callbackPage = await importCoordinator();
    assert.equal(callbackPage.handleAuthFailure({
      status: 401,
      data: { error: { code: 'session_invalid' } },
      sessionOwnerKey: 'owner-a',
      isAuthenticated: true,
      isCurrentSession: true,
    }), 'blocked');
    assert.deepEqual(globalThis.__authRecoveryDispatches, ['session-invalid']);
    assert.equal(callbackPage.markProtectedAuthSuccess('/profile', 200, 'owner-a'), true);
  } finally {
    uninstallBrowserRuntime();
  }
});

test('sessionStorage write failure blocks recovery before navigation across module realms', async () => {
  installBrowserRuntime({ failSessionWrite: true });
  globalThis.__authRecoveryDispatches = [];
  try {
    const firstPage = await importCoordinator();
    const input = {
      status: 401,
      data: { error: { code: 'invalid_token' } },
      sessionOwnerKey: 'owner-a',
      isCurrentSession: true,
    };
    assert.equal(firstPage.handleAuthFailure(input), 'blocked');
    assert.equal(firstPage.readAuthRecoveryIssue()?.kind, 'reauth-failed');
    assert.deepEqual(globalThis.__authRecoveryDispatches, []);

    const secondPage = await importCoordinator();
    assert.equal(secondPage.handleAuthFailure(input), 'blocked');
    assert.equal(secondPage.readAuthRecoveryIssue()?.kind, 'reauth-failed');
    assert.deepEqual(globalThis.__authRecoveryDispatches, []);
  } finally {
    uninstallBrowserRuntime();
  }
});

test('manual reset stays cleared after reload when sessionStorage removal fails', async () => {
  installBrowserRuntime({ failSessionRemove: true });
  globalThis.__authRecoveryDispatches = [];
  try {
    const input = {
      status: 401,
      data: { error: { code: 'invalid_token' } },
      sessionOwnerKey: 'owner-a',
      isCurrentSession: true,
    };
    const firstPage = await importCoordinator();
    assert.equal(firstPage.handleAuthFailure(input), 'login-requested');

    const callbackPage = await importCoordinator();
    assert.equal(callbackPage.handleAuthFailure(input), 'blocked');
    assert.equal(callbackPage.readAuthRecoveryIssue()?.code, 'reauth_cycle_blocked');

    assert.equal(callbackPage.resetAuthRecoveryCycle(), true);
    const reloadedPage = await importCoordinator();
    assert.equal(reloadedPage.readAuthRecoveryIssue(), null);
  } finally {
    uninstallBrowserRuntime();
  }
});

test('sessionStorage read failure blocks recovery before navigation across module realms', async () => {
  installBrowserRuntime({ failSessionRead: true });
  globalThis.__authRecoveryDispatches = [];
  try {
    const input = {
      status: 401,
      data: { error: { code: 'invalid_token' } },
      sessionOwnerKey: 'owner-a',
      isCurrentSession: true,
    };
    const firstPage = await importCoordinator();
    assert.equal(firstPage.handleAuthFailure(input), 'blocked');
    assert.deepEqual(globalThis.__authRecoveryDispatches, []);

    const secondPage = await importCoordinator();
    assert.equal(secondPage.handleAuthFailure(input), 'blocked');
    assert.deepEqual(globalThis.__authRecoveryDispatches, []);
  } finally {
    uninstallBrowserRuntime();
  }
});

test('sessionStorage getter failure blocks recovery before navigation across module realms', async () => {
  installBrowserRuntime({ failStorageGetter: true });
  globalThis.__authRecoveryDispatches = [];
  try {
    const input = {
      status: 401,
      data: { error: { code: 'invalid_token' } },
      sessionOwnerKey: 'owner-a',
      isCurrentSession: true,
    };
    const firstPage = await importCoordinator();
    assert.equal(firstPage.handleAuthFailure(input), 'blocked');
    assert.deepEqual(globalThis.__authRecoveryDispatches, []);

    const secondPage = await importCoordinator();
    assert.equal(secondPage.handleAuthFailure(input), 'blocked');
    assert.deepEqual(globalThis.__authRecoveryDispatches, []);
  } finally {
    uninstallBrowserRuntime();
  }
});

test('dependency profile probes are scheduled with a finite retry budget and cancellable timer', async () => {
  installBrowserRuntime();
  globalThis.__authRecoveryDispatches = [];
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  const scheduled = [];
  const cleared = [];
  globalThis.setTimeout = (handler, delay) => {
    scheduled.push({ handler, delay, cancelled: false });
    return scheduled.length;
  };
  globalThis.clearTimeout = (id) => {
    cleared.push(id);
    if (scheduled[id - 1]) {
      scheduled[id - 1].cancelled = true;
    }
  };
  const runTimer = (index) => {
    if (!scheduled[index].cancelled) {
      scheduled[index].handler();
    }
  };
  try {
    const {
      AUTH_DEPENDENCY_MAX_PROBE_ATTEMPTS,
      scheduleAuthDependencyProbe,
    } = await importCoordinator();
    let probeCount = 0;
    const cancel = scheduleAuthDependencyProbe(0, () => {
      probeCount += 1;
    });
    assert.equal(typeof cancel, 'function');
    assert.equal(scheduled.length, 1);
    assert.ok(scheduled[0].delay > 0);
    cancel();
    assert.deepEqual(cleared, [1]);
    runTimer(0);
    assert.equal(probeCount, 0, 'a cancelled timer must not run its probe');

    for (let attempt = 0; attempt < AUTH_DEPENDENCY_MAX_PROBE_ATTEMPTS; attempt += 1) {
      scheduleAuthDependencyProbe(attempt, () => {
        probeCount += 1;
      });
    }
    assert.equal(scheduled.length, 4);
    runTimer(1);
    runTimer(2);
    runTimer(3);
    assert.equal(probeCount, AUTH_DEPENDENCY_MAX_PROBE_ATTEMPTS);

    assert.equal(
      scheduleAuthDependencyProbe(
        AUTH_DEPENDENCY_MAX_PROBE_ATTEMPTS,
        () => { probeCount += 1; },
      ),
      null,
    );
    assert.equal(scheduled.length, 4, 'no timer is created after the retry budget');
  } finally {
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
    uninstallBrowserRuntime();
  }
});
