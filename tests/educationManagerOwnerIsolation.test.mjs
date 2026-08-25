import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import { build } from 'esbuild';

const deferred = () => {
  let resolve;
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
};

const dependenciesEqual = (left, right) => (
  left
  && left.length === right.length
  && left.every((value, index) => Object.is(value, right[index]))
);

const createHookRuntime = () => {
  const slots = [];
  let index = 0;
  let pendingEffects = [];

  const useMemo = (factory, dependencies) => {
    const slotIndex = index++;
    const previous = slots[slotIndex];
    if (!previous || !dependenciesEqual(previous.dependencies, dependencies)) {
      slots[slotIndex] = { value: factory(), dependencies };
    }
    return slots[slotIndex].value;
  };

  return {
    useState(initialValue) {
      const slotIndex = index++;
      if (!slots[slotIndex]) {
        slots[slotIndex] = {
          value: typeof initialValue === 'function' ? initialValue() : initialValue,
        };
      }
      const setValue = (nextValue) => {
        const current = slots[slotIndex].value;
        slots[slotIndex].value = typeof nextValue === 'function'
          ? nextValue(current)
          : nextValue;
      };
      return [slots[slotIndex].value, setValue];
    },
    useRef(initialValue) {
      const slotIndex = index++;
      slots[slotIndex] ??= { current: initialValue };
      return slots[slotIndex];
    },
    useMemo,
    useCallback(callback, dependencies) {
      return useMemo(() => callback, dependencies);
    },
    useEffect(effect, dependencies) {
      const slotIndex = index++;
      const previous = slots[slotIndex];
      if (!previous || !dependenciesEqual(previous.dependencies, dependencies)) {
        pendingEffects.push({ effect, previous, slotIndex, dependencies });
      }
    },
    render(callback) {
      index = 0;
      pendingEffects = [];
      const value = callback();
      const effects = pendingEffects;
      pendingEffects = [];
      for (const { effect, previous, slotIndex, dependencies } of effects) {
        previous?.cleanup?.();
        slots[slotIndex] = { dependencies, cleanup: effect() };
      }
      return value;
    },
    unmount() {
      for (const slot of slots) slot?.cleanup?.();
    },
  };
};

const importHook = async () => {
  const result = await build({
    entryPoints: ['hooks/useEducationManager.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    plugins: [{
      name: 'education-owner-isolation-stubs',
      setup(buildApi) {
        buildApi.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'stub' }));
        buildApi.onResolve({ filter: /services[\\/]apiClient$/ }, () => ({ path: 'api-client', namespace: 'stub' }));
        buildApi.onResolve({ filter: /services[\\/]experienceService$/ }, () => ({ path: 'experience-service', namespace: 'stub' }));
        buildApi.onLoad({ filter: /^react$/, namespace: 'stub' }, () => ({
          contents: `
            const runtime = () => globalThis.__educationOwnerRuntime;
            export const useState = (value) => runtime().useState(value);
            export const useRef = (value) => runtime().useRef(value);
            export const useMemo = (factory, deps) => runtime().useMemo(factory, deps);
            export const useCallback = (callback, deps) => runtime().useCallback(callback, deps);
            export const useEffect = (effect, deps) => runtime().useEffect(effect, deps);
            export const useLayoutEffect = (effect, deps) => runtime().useEffect(effect, deps);
          `,
          loader: 'js',
        }));
        buildApi.onLoad({ filter: /^api-client$/, namespace: 'stub' }, () => ({
          contents: `
            export class AuthContextChangedError extends Error {
              constructor() {
                super('Authentication context changed during operation');
                this.name = 'AuthContextChangedError';
              }
            }
            export const isAuthContextChangedError = (error) => error?.name === 'AuthContextChangedError';
            export const assertAuthCacheKey = async (expectedOwner) => {
              globalThis.__educationOwnerHarness.assertCalls.push(expectedOwner);
              if (globalThis.__educationOwnerHarness.activeOwner !== expectedOwner) {
                throw new AuthContextChangedError();
              }
            };
          `,
          loader: 'js',
        }));
        buildApi.onLoad({ filter: /^experience-service$/, namespace: 'stub' }, () => ({
          contents: `
            const harness = () => globalThis.__educationOwnerHarness;
            export const experienceService = {
              peekList: (...args) => harness().peekList(...args),
              list: (...args) => harness().list(...args),
              create: (...args) => harness().create(...args),
              update: (...args) => harness().update(...args),
              delete: (...args) => harness().delete(...args),
            };
          `,
          loader: 'js',
        }));
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}#${Math.random()}`);
};

const buildEducation = (owner, id = `edu-${owner}`) => ({
  master: { id, category: 'education' },
  latest_version: {
    id: `version-${id}`,
    title: `${owner} major`,
    org: `${owner} school`,
    start_date: '2024-09-01',
    end_date: null,
    star: {},
  },
});

const settleAsyncWork = async () => {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
};

const createHarness = (overrides = {}) => {
  const calls = {
    create: [],
    update: [],
    delete: [],
    toast: [],
  };
  const harness = {
    activeOwner: 'owner-a',
    assertCalls: [],
    peekList: () => null,
    list: async (_category, options) => [buildEducation(options.expectedAuthCacheKey)],
    create: async (...args) => {
      calls.create.push(args);
      return buildEducation(args[1]?.expectedAuthCacheKey, 'created-education');
    },
    update: async (...args) => {
      calls.update.push(args);
      return buildEducation(args[2]?.expectedAuthCacheKey, args[0]);
    },
    delete: async (...args) => {
      calls.delete.push(args);
      return buildEducation(args[1]?.expectedAuthCacheKey, args[0]);
    },
    ...overrides,
  };
  const toast = {
    success: (message) => { calls.toast.push(['success', message]); return 'success-toast'; },
    error: (message) => { calls.toast.push(['error', message]); return 'error-toast'; },
    loading: (message) => { calls.toast.push(['loading', message]); return 'loading-toast'; },
    updateToast: (id, updates) => { calls.toast.push(['update', id, updates]); },
  };
  return { calls, harness, toast };
};

const renderManager = async ({ runtime, useEducationManager, toast, authUserKey = 'owner-a' }) => {
  let manager = runtime.render(() => useEducationManager(toast, {
    authUserKey,
    isAuthenticated: true,
    onRequireAuth: () => undefined,
  }));
  await settleAsyncWork();
  manager = runtime.render(() => useEducationManager(toast, {
    authUserKey,
    isAuthenticated: true,
    onRequireAuth: () => undefined,
  }));
  return manager;
};

test('education create fails closed before dispatch or UI commits when B is active first', async () => {
  const runtime = createHookRuntime();
  const { calls, harness, toast } = createHarness();
  globalThis.__educationOwnerRuntime = runtime;
  globalThis.__educationOwnerHarness = harness;
  try {
    const { useEducationManager } = await importHook();
    const manager = await renderManager({ runtime, useEducationManager, toast });
    calls.toast.length = 0;
    harness.activeOwner = 'owner-b';

    await manager.handleAddEdu();

    assert.equal(calls.create.length, 0);
    assert.deepEqual(calls.toast, []);
    assert.deepEqual(manager.educations.map((item) => item.master.id), ['edu-owner-a']);
  } finally {
    runtime.unmount();
    delete globalThis.__educationOwnerRuntime;
    delete globalThis.__educationOwnerHarness;
  }
});

test('education update fails closed before dispatch or UI commits when B is active first', async () => {
  const runtime = createHookRuntime();
  const { calls, harness, toast } = createHarness();
  globalThis.__educationOwnerRuntime = runtime;
  globalThis.__educationOwnerHarness = harness;
  try {
    const { useEducationManager } = await importHook();
    let manager = await renderManager({ runtime, useEducationManager, toast });
    manager.toggleEduCard('edu-owner-a');
    manager = runtime.render(() => useEducationManager(toast, {
      authUserKey: 'owner-a',
      isAuthenticated: true,
      onRequireAuth: () => undefined,
    }));
    calls.toast.length = 0;
    harness.activeOwner = 'owner-b';

    await manager.handleSaveEdu('edu-owner-a');

    assert.equal(calls.update.length, 0);
    assert.deepEqual(calls.toast, []);
    assert.equal(manager.getEduCardData(manager.educations[0]).school, 'owner-a school');
  } finally {
    runtime.unmount();
    delete globalThis.__educationOwnerRuntime;
    delete globalThis.__educationOwnerHarness;
  }
});

test('education delete confirmation fails closed before dispatch or optimistic commits when B is active first', async () => {
  const runtime = createHookRuntime();
  const { calls, harness, toast } = createHarness();
  globalThis.__educationOwnerRuntime = runtime;
  globalThis.__educationOwnerHarness = harness;
  try {
    const { useEducationManager } = await importHook();
    let manager = await renderManager({ runtime, useEducationManager, toast });
    manager.requestDeleteEdu('edu-owner-a');
    manager = runtime.render(() => useEducationManager(toast, {
      authUserKey: 'owner-a',
      isAuthenticated: true,
      onRequireAuth: () => undefined,
    }));
    assert.equal(manager.deletingEduId, 'edu-owner-a');
    calls.toast.length = 0;
    harness.activeOwner = 'owner-b';

    await manager.handleConfirmDelete();
    manager = runtime.render(() => useEducationManager(toast, {
      authUserKey: 'owner-a',
      isAuthenticated: true,
      onRequireAuth: () => undefined,
    }));

    assert.equal(calls.delete.length, 0);
    assert.deepEqual(calls.toast, []);
    assert.deepEqual(manager.educations.map((item) => item.master.id), ['edu-owner-a']);
    assert.equal(manager.deletingEduId, 'edu-owner-a');
  } finally {
    runtime.unmount();
    delete globalThis.__educationOwnerRuntime;
    delete globalThis.__educationOwnerHarness;
  }
});

test('late A create response cannot commit after the hook owner advances to B', async () => {
  const runtime = createHookRuntime();
  const createGate = deferred();
  const { calls, harness, toast } = createHarness({
    create: async (...args) => {
      calls.create.push(args);
      return createGate.promise;
    },
  });
  globalThis.__educationOwnerRuntime = runtime;
  globalThis.__educationOwnerHarness = harness;
  try {
    const { useEducationManager } = await importHook();
    let manager = await renderManager({ runtime, useEducationManager, toast });
    calls.toast.length = 0;
    const pending = manager.handleAddEdu();
    await settleAsyncWork();
    assert.equal(calls.create.length, 1);
    assert.equal(calls.create[0][1]?.expectedAuthCacheKey, 'owner-a');

    harness.activeOwner = 'owner-b';
    manager = runtime.render(() => useEducationManager(toast, {
      authUserKey: 'owner-b',
      isAuthenticated: true,
      onRequireAuth: () => undefined,
    }));
    await settleAsyncWork();
    createGate.resolve(buildEducation('owner-a', 'created-owner-a'));
    await pending;
    await settleAsyncWork();
    manager = runtime.render(() => useEducationManager(toast, {
      authUserKey: 'owner-b',
      isAuthenticated: true,
      onRequireAuth: () => undefined,
    }));

    assert.deepEqual(manager.educations.map((item) => item.master.id), ['edu-owner-b']);
    assert.equal(manager.isCreating, false);
    assert.equal(
      calls.toast.some((entry) => entry[0] === 'update' && entry[2]?.type === 'success'),
      false,
    );
  } finally {
    runtime.unmount();
    delete globalThis.__educationOwnerRuntime;
    delete globalThis.__educationOwnerHarness;
  }
});

test('education CRUD dispatches every request with the captured owner', async () => {
  const runtime = createHookRuntime();
  const { calls, harness, toast } = createHarness();
  globalThis.__educationOwnerRuntime = runtime;
  globalThis.__educationOwnerHarness = harness;
  try {
    const { useEducationManager } = await importHook();
    let manager = await renderManager({ runtime, useEducationManager, toast });

    await manager.handleAddEdu();
    assert.equal(calls.create[0]?.[1]?.expectedAuthCacheKey, 'owner-a');
    await settleAsyncWork();

    manager = runtime.render(() => useEducationManager(toast, {
      authUserKey: 'owner-a',
      isAuthenticated: true,
      onRequireAuth: () => undefined,
    }));
    manager.toggleEduCard('edu-owner-a');
    manager = runtime.render(() => useEducationManager(toast, {
      authUserKey: 'owner-a',
      isAuthenticated: true,
      onRequireAuth: () => undefined,
    }));
    await manager.handleSaveEdu('edu-owner-a');
    assert.equal(calls.update[0]?.[2]?.expectedAuthCacheKey, 'owner-a');

    manager = runtime.render(() => useEducationManager(toast, {
      authUserKey: 'owner-a',
      isAuthenticated: true,
      onRequireAuth: () => undefined,
    }));
    manager.requestDeleteEdu('edu-owner-a');
    manager = runtime.render(() => useEducationManager(toast, {
      authUserKey: 'owner-a',
      isAuthenticated: true,
      onRequireAuth: () => undefined,
    }));
    await manager.handleConfirmDelete();
    assert.equal(calls.delete[0]?.[1]?.expectedAuthCacheKey, 'owner-a');
  } finally {
    runtime.unmount();
    delete globalThis.__educationOwnerRuntime;
    delete globalThis.__educationOwnerHarness;
  }
});
