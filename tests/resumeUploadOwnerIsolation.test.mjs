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

const areDepsEqual = (previous, next) => (
  Array.isArray(previous)
  && Array.isArray(next)
  && previous.length === next.length
  && previous.every((value, index) => Object.is(value, next[index]))
);

const createHookRuntime = () => {
  const slots = [];
  let hookIndex = 0;
  let pendingEffects = [];
  const runtime = {
    useState(initialValue) {
      const index = hookIndex++;
      if (!slots[index]) {
        slots[index] = { value: typeof initialValue === 'function' ? initialValue() : initialValue };
      }
      const setValue = (update) => {
        slots[index].value = typeof update === 'function'
          ? update(slots[index].value)
          : update;
      };
      return [slots[index].value, setValue];
    },
    useRef(initialValue) {
      const index = hookIndex++;
      if (!slots[index]) slots[index] = { value: { current: initialValue } };
      return slots[index].value;
    },
    useMemo(factory, deps) {
      const index = hookIndex++;
      if (!slots[index] || !areDepsEqual(slots[index].deps, deps)) {
        slots[index] = { deps, value: factory() };
      }
      return slots[index].value;
    },
    useCallback(callback, deps) {
      return runtime.useMemo(() => callback, deps);
    },
    useEffect(effect, deps) {
      const index = hookIndex++;
      const slot = slots[index];
      if (!slot || !areDepsEqual(slot.deps, deps)) {
        slots[index] = { deps, cleanup: slot?.cleanup };
        pendingEffects.push({ index, effect });
      }
    },
    render(callback) {
      hookIndex = 0;
      pendingEffects = [];
      const value = callback();
      for (const { index, effect } of pendingEffects) {
        slots[index].cleanup?.();
        const cleanup = effect();
        slots[index].cleanup = typeof cleanup === 'function' ? cleanup : undefined;
      }
      return value;
    },
    unmount() {
      for (const slot of slots) slot?.cleanup?.();
    },
  };
  return runtime;
};

const virtualModules = {
  react: `
    const runtime = () => globalThis.__resumeUploadHookRuntime;
    export const useState = (value) => runtime().useState(value);
    export const useRef = (value) => runtime().useRef(value);
    export const useMemo = (factory, deps) => runtime().useMemo(factory, deps);
    export const useCallback = (callback, deps) => runtime().useCallback(callback, deps);
    export const useEffect = (effect, deps) => runtime().useEffect(effect, deps);
    export const useLayoutEffect = (effect, deps) => runtime().useEffect(effect, deps);
  `,
  apiClient: `
    export class AuthContextChangedError extends Error {
      constructor() {
        super('Authentication context changed during operation');
        this.name = 'AuthContextChangedError';
      }
    }
    export const isAuthContextChangedError = (error) => error?.name === 'AuthContextChangedError';
    export const captureAuthCacheKey = async () => globalThis.__resumeUploadOwnerTest.activeOwner;
    export const assertAuthCacheKey = async (expected) => {
      if (expected !== globalThis.__resumeUploadOwnerTest.activeOwner) {
        throw new AuthContextChangedError();
      }
    };
  `,
  experienceService: `
    export const experienceService = {
      create: (...args) => globalThis.__resumeUploadOwnerTest.createExperience(...args),
    };
  `,
  certificationsService: `
    export const certificationsService = {
      list: async () => [],
      create: (...args) => globalThis.__resumeUploadOwnerTest.createCertification(...args),
    };
  `,
  skillsService: `
    export const skillsService = {
      list: async () => [],
      create: (...args) => globalThis.__resumeUploadOwnerTest.createSkill(...args),
    };
  `,
  parserService: 'export const parserService = {};',
  analyticsTracker: `
    export const trackExperienceBankImported = (...args) => (
      globalThis.__resumeUploadOwnerTest.trackImported(...args)
    );
  `,
};

const importUseResumeImport = async () => {
  const result = await build({
    stdin: {
      contents: `export { useResumeImport } from './components/ResumeUploadModal/stateHooks';`,
      loader: 'ts',
      resolveDir: process.cwd(),
      sourcefile: 'resume-upload-owner-test-entry.ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    plugins: [{
      name: 'resume-upload-owner-mocks',
      setup(buildContext) {
        buildContext.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'stub' }));
        buildContext.onResolve({ filter: /services\/apiClient$/ }, () => ({ path: 'apiClient', namespace: 'stub' }));
        buildContext.onResolve({ filter: /services\/experienceService$/ }, () => ({ path: 'experienceService', namespace: 'stub' }));
        buildContext.onResolve({ filter: /services\/certificationsService$/ }, () => ({ path: 'certificationsService', namespace: 'stub' }));
        buildContext.onResolve({ filter: /services\/skillsService$/ }, () => ({ path: 'skillsService', namespace: 'stub' }));
        buildContext.onResolve({ filter: /services\/parserService$/ }, () => ({ path: 'parserService', namespace: 'stub' }));
        buildContext.onResolve({ filter: /utils\/analyticsTracker$/ }, () => ({ path: 'analyticsTracker', namespace: 'stub' }));
        buildContext.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({
          contents: virtualModules[args.path],
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

const selectedExperience = (id) => ({
  id,
  category: 'work',
  version: { title: id },
});

test('bulk import pins every create to its starting owner and stops after an account switch', async () => {
  const firstCreate = deferred();
  const createCalls = [];
  const toastEvents = [];
  const lifecycleEvents = [];
  const runtime = createHookRuntime();
  globalThis.__resumeUploadHookRuntime = runtime;
  globalThis.__resumeUploadOwnerTest = {
    activeOwner: 'owner-a',
    createExperience: (...args) => {
      createCalls.push(args);
      return createCalls.length === 1 ? firstCreate.promise : Promise.resolve({});
    },
    createCertification: async () => ({}),
    createSkill: async () => ({}),
    trackImported: () => lifecycleEvents.push('tracked'),
  };

  try {
    const { useResumeImport } = await importUseResumeImport();
    const hook = runtime.render(() => useResumeImport(
      [selectedExperience('first'), selectedExperience('second')],
      [],
      [],
      { name: false, email: false, phone: false, location: false },
      {
        success: (message) => toastEvents.push(['success', message]),
        error: (message) => toastEvents.push(['error', message]),
        info: () => undefined,
        loading: () => 'toast-1',
        updateToast: (_id, update) => toastEvents.push([update.type, update.message]),
      },
      async (options) => lifecycleEvents.push(['imported', options]),
      () => lifecycleEvents.push('closed'),
      'owner-a',
    ));
    const importPromise = hook.handleImport();
    await settleAsyncWork();
    assert.equal(createCalls[0]?.[1]?.expectedAuthCacheKey, 'owner-a');

    globalThis.__resumeUploadOwnerTest.activeOwner = 'owner-b';
    firstCreate.resolve({});
    await importPromise;

    assert.equal(createCalls.length, 1, 'the second item must never dispatch under owner B');
    assert.deepEqual(lifecycleEvents, []);
    assert.equal(toastEvents.some(([type]) => type === 'success'), false);
    assert.equal(toastEvents.some(([type]) => type === 'error'), false);
  } finally {
    delete globalThis.__resumeUploadHookRuntime;
    delete globalThis.__resumeUploadOwnerTest;
  }
});

test('unmount invalidates a pending batch before the next item or completion callback', async () => {
  const firstCreate = deferred();
  const createCalls = [];
  const lifecycleEvents = [];
  const runtime = createHookRuntime();
  globalThis.__resumeUploadHookRuntime = runtime;
  globalThis.__resumeUploadOwnerTest = {
    activeOwner: 'owner-a',
    createExperience: (...args) => {
      createCalls.push(args);
      return createCalls.length === 1 ? firstCreate.promise : Promise.resolve({});
    },
    createCertification: async () => ({}),
    createSkill: async () => ({}),
    trackImported: () => lifecycleEvents.push('tracked'),
  };

  try {
    const { useResumeImport } = await importUseResumeImport();
    const hook = runtime.render(() => useResumeImport(
      [selectedExperience('first'), selectedExperience('second')],
      [],
      [],
      { name: false, email: false, phone: false, location: false },
      {
        success: () => undefined,
        error: () => undefined,
        info: () => undefined,
        loading: () => 'toast-1',
        updateToast: () => undefined,
      },
      async () => lifecycleEvents.push('imported'),
      () => lifecycleEvents.push('closed'),
      'owner-a',
    ));
    const importPromise = hook.handleImport();
    await settleAsyncWork();
    runtime.unmount();
    firstCreate.resolve({});
    await importPromise;

    assert.equal(createCalls.length, 1);
    assert.deepEqual(lifecycleEvents, []);
  } finally {
    delete globalThis.__resumeUploadHookRuntime;
    delete globalThis.__resumeUploadOwnerTest;
  }
});

test('successful import passes its starting owner into the personal-info completion callback', async () => {
  const importedOptions = [];
  const runtime = createHookRuntime();
  globalThis.__resumeUploadHookRuntime = runtime;
  globalThis.__resumeUploadOwnerTest = {
    activeOwner: 'owner-a',
    createExperience: async () => ({}),
    createCertification: async () => ({}),
    createSkill: async () => ({}),
    trackImported: () => undefined,
  };

  try {
    const { useResumeImport } = await importUseResumeImport();
    const hook = runtime.render(() => useResumeImport(
      [selectedExperience('only')],
      [],
      [],
      { name: false, email: false, phone: false, location: false },
      {
        success: () => undefined,
        error: () => undefined,
        info: () => undefined,
        loading: () => 'toast-1',
        updateToast: () => undefined,
      },
      async (options) => importedOptions.push(options),
      () => undefined,
      'owner-a',
    ));
    await hook.handleImport();
    assert.deepEqual(importedOptions, [{ expectedAuthCacheKey: 'owner-a' }]);
  } finally {
    delete globalThis.__resumeUploadHookRuntime;
    delete globalThis.__resumeUploadOwnerTest;
  }
});
