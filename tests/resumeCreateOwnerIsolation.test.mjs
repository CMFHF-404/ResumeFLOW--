import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
let importSequence = 0;

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const withMutedConsoleError = async (callback) => {
  const originalConsoleError = console.error;
  console.error = () => undefined;
  try {
    return await callback();
  } finally {
    console.error = originalConsoleError;
  }
};

const areHookDepsEqual = (previous, next) => (
  Array.isArray(previous)
  && Array.isArray(next)
  && previous.length === next.length
  && previous.every((value, index) => Object.is(value, next[index]))
);

const createHookRuntime = () => {
  const slots = [];
  let hookIndex = 0;
  let pendingEffects = [];
  const nextSlot = () => hookIndex++;
  const runtime = {
    useState(initialValue) {
      const index = nextSlot();
      if (!slots[index]) {
        slots[index] = {
          kind: 'state',
          value: typeof initialValue === 'function' ? initialValue() : initialValue,
        };
      }
      const setValue = (update) => {
        const currentValue = slots[index].value;
        slots[index].value = typeof update === 'function' ? update(currentValue) : update;
      };
      return [slots[index].value, setValue];
    },
    useRef(initialValue) {
      const index = nextSlot();
      if (!slots[index]) {
        slots[index] = { kind: 'ref', value: { current: initialValue } };
      }
      return slots[index].value;
    },
    useMemo(factory, deps) {
      const index = nextSlot();
      const slot = slots[index];
      if (!slot || !areHookDepsEqual(slot.deps, deps)) {
        slots[index] = { kind: 'memo', deps, value: factory() };
      }
      return slots[index].value;
    },
    useCallback(callback, deps) {
      return runtime.useMemo(() => callback, deps);
    },
    useEffect(effect, deps) {
      const index = nextSlot();
      const slot = slots[index];
      if (!slot || !areHookDepsEqual(slot.deps, deps)) {
        slots[index] = { kind: 'effect', deps, cleanup: slot?.cleanup };
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
  };
  return runtime;
};

const settleAsyncWork = async () => {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
};

const virtualModules = {
  apiClient: `
    export const isAuthContextChangedError = (error) => error?.name === 'AuthContextChangedError';
  `,
  react: `
    const runtime = () => globalThis.__resumeCreateHookRuntime;
    export const useCallback = (callback, deps) => (
      runtime()?.useCallback(callback, deps) ?? callback
    );
    export const useEffect = (effect, deps) => runtime()?.useEffect(effect, deps);
    export const useLayoutEffect = (effect, deps) => runtime()?.useEffect(effect, deps);
    export const useMemo = (factory, deps) => runtime()?.useMemo(factory, deps) ?? factory();
    export const useRef = (value) => runtime()?.useRef(value) ?? ({ current: value });
    export const useState = (initial) => runtime()?.useState(initial) ?? [
      typeof initial === 'function' ? initial() : initial,
      () => undefined,
    ];
  `,
  profileService: `
    export const profileService = {
      getProfile: (...args) => globalThis.__resumeCreateOwnerTest.getProfile(...args),
      peekProfileForCurrentUser: (...args) => (
        globalThis.__resumeCreateOwnerTest.peekProfileForCurrentUser?.(...args) ?? null
      ),
    };
  `,
  resumeService: `
    export class ResumeAuthContextChangedError extends Error {
      constructor() {
        super('Authentication context changed during resume operation');
        this.name = 'ResumeAuthContextChangedError';
      }
    }
    export const assertResumeAuthContext = async (expectedAuthCacheKey) => {
      if (globalThis.__resumeCreateOwnerTest.activeOwner !== expectedAuthCacheKey) {
        throw new ResumeAuthContextChangedError();
      }
    };
    export const captureResumeAuthCacheKey = async (authUserKey) => {
      const expectedAuthCacheKey = authUserKey ?? globalThis.__resumeCreateOwnerTest.activeOwner;
      await assertResumeAuthContext(expectedAuthCacheKey);
      return expectedAuthCacheKey;
    };
    export const resumeService = {
      create: (...args) => globalThis.__resumeCreateOwnerTest.create(...args),
      get: (...args) => globalThis.__resumeCreateOwnerTest.get(...args),
      list: (...args) => globalThis.__resumeCreateOwnerTest.list(...args),
      duplicate: (...args) => globalThis.__resumeCreateOwnerTest.duplicate?.(...args),
      update: (...args) => globalThis.__resumeCreateOwnerTest.update?.(...args),
    };
    export const isResumeVersionConflict = (error) => (
      globalThis.__resumeCreateOwnerTest.isResumeVersionConflict?.(error) ?? false
    );
    export const subscribeToResumeVersionConflicts = () => () => undefined;
    export const waitForResumeMutations = async () => undefined;
  `,
  resumeTemplateStorage: `
    export const buildPreferredResumeCreateConfig = (extraJson, ownerKey) => ({
      ownerKey,
      template: extraJson?.template ?? 'default',
    });
    export const syncResumeTemplatePresetsFromProfile = () => undefined;
  `,
  resumeStorage: `
    export const getActiveResumeId = () => globalThis.__resumeCreateOwnerTest.activeResumeId ?? null;
    export const setActiveResumeId = (...args) => globalThis.__resumeCreateOwnerTest.setActiveResumeId?.(...args);
    export const clearActiveResumeId = (...args) => globalThis.__resumeCreateOwnerTest.clearActiveResumeId?.(...args);
  `,
  useDebounce: 'export const useDebounce = (value) => value;',
  certificationsService: `
    export const certificationsService = { list: async () => [], listCached: () => [] };
  `,
  experienceService: `
    export const experienceService = { listAll: async () => [], listAllCached: () => [] };
  `,
  jdAnalysisStorage: `
    export const loadJDAnalysisCache = () => null;
    export const normalizeJDAnalysisPersistence = (value) => value ?? null;
    export const selectPreferredPersistedJDAnalysis = () => null;
  `,
  skillsService: `
    export const skillsService = { list: async () => [], listCached: () => [] };
  `,
  useResumeDataAppliers: `
    export const useCertificationStateApplier = () => () => undefined;
    export const useEducationStateApplier = () => () => undefined;
    export const useExperienceStateApplier = () => () => undefined;
    export const useResumeConfigApplier = () => () => undefined;
    export const useSkillStateApplier = () => () => undefined;
  `,
  resumeConfigSaveCoordinator: `
    export const createResumeConfigSaveCoordinator = () => ({
      save: async () => undefined,
      flush: async () => undefined,
    });
  `,
  resumeSaveResultUtils: `
    export const mergeResumeSaveResultIntoDetail = (detail) => detail;
  `,
  devLogger: 'export const devLog = () => undefined;',
  analyticsTracker: `
    export const trackResumeDuplicated = () => undefined;
    export const trackFirstExperienceCreated = () => undefined;
  `,
  dashboardResumeMapper: `
    export const mapResumeToDashboard = (resume) => resume;
    export const mapResumesToDashboard = (resumes) => resumes;
    export const resolveDashboardResumeLocalEvaluationScore = () => null;
    export const resolveDashboardResumeLocalMatchRate = () => 0;
  `,
};

const importBundled = async (contents) => {
  const result = await build({
    stdin: {
      contents,
      loader: 'ts',
      resolveDir: repoRoot,
      sourcefile: 'resume-create-owner-test-entry.ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    plugins: [{
      name: 'resume-create-owner-mocks',
      setup(buildApi) {
        buildApi.onLoad({ filter: /hooks[\\/]useResumeData\.ts$/ }, (args) => ({
          contents: readFileSync(args.path, 'utf8').replace(
            'const resolveActiveResumeContext = async (',
            'export const resolveActiveResumeContext = async (',
          ),
          loader: 'ts',
        }));
        for (const [name, moduleContents] of Object.entries(virtualModules)) {
          const filter = name === 'react'
            ? /^react$/
            : new RegExp(`${name}$`);
          buildApi.onResolve({ filter }, () => ({
            path: name,
            namespace: 'resume-create-owner-test',
          }));
          buildApi.onLoad(
            { filter: /.*/, namespace: 'resume-create-owner-test' },
            (args) => ({
              contents: virtualModules[args.path],
              loader: 'js',
            }),
          );
        }
      },
    }],
  });
  importSequence += 1;
  const encoded = Buffer.from(result.outputFiles[0].text).toString('base64');
  return import(`data:text/javascript;base64,${encoded}#${importSequence}`);
};

test('resume context list completion after A to B switch cannot create or select a resume', async () => {
  const delayedList = deferred();
  const calls = { create: 0, setActive: 0, listOptions: [] };
  globalThis.__resumeCreateOwnerTest = {
    activeOwner: 'owner-a',
    activeResumeId: null,
    list: (options) => {
      calls.listOptions.push(options);
      return delayedList.promise;
    },
    get: async () => { throw new Error('unexpected get'); },
    getProfile: async () => ({ user_id: 'owner-a', extra_json: {} }),
    create: async () => {
      calls.create += 1;
      return { id: 'created-a' };
    },
    setActiveResumeId: () => {
      calls.setActive += 1;
    },
  };
  const { resolveActiveResumeContext, ResumeAuthContextChangedError } = await importBundled(`
    export { resolveActiveResumeContext } from './hooks/useResumeData';
    export { ResumeAuthContextChangedError } from './services/resumeService';
  `);

  const pending = resolveActiveResumeContext('owner-a');
  await settleAsyncWork();
  assert.equal(calls.listOptions[0]?.expectedAuthCacheKey, 'owner-a');
  globalThis.__resumeCreateOwnerTest.activeOwner = 'owner-b';
  delayedList.resolve([]);

  await assert.rejects(pending, ResumeAuthContextChangedError);
  assert.deepEqual(calls, {
    create: 0,
    setActive: 0,
    listOptions: [{ expectedAuthCacheKey: 'owner-a' }],
  });
});

test('resume context cached GET completion after A to B switch cannot reuse A selection', async () => {
  const delayedGet = deferred();
  const calls = { list: 0, create: 0 };
  globalThis.__resumeCreateOwnerTest = {
    activeOwner: 'owner-a',
    activeResumeId: 'resume-a',
    get: () => delayedGet.promise,
    list: async () => {
      calls.list += 1;
      return [];
    },
    getProfile: async () => ({ user_id: 'owner-a', extra_json: {} }),
    create: async () => {
      calls.create += 1;
      return { id: 'created-a' };
    },
  };
  const { resolveActiveResumeContext, ResumeAuthContextChangedError } = await importBundled(`
    export { resolveActiveResumeContext } from './hooks/useResumeData';
    export { ResumeAuthContextChangedError } from './services/resumeService';
  `);

  const pending = resolveActiveResumeContext('owner-a');
  await Promise.resolve();
  globalThis.__resumeCreateOwnerTest.activeOwner = 'owner-b';
  delayedGet.resolve({ resume: { id: 'resume-a' }, experiences: [] });

  await assert.rejects(pending, ResumeAuthContextChangedError);
  assert.deepEqual(calls, { list: 0, create: 0 });
});

test('dashboard profile completion after A to B switch never dispatches create or B UI changes', async () => {
  const delayedProfile = deferred();
  const calls = { create: 0, setView: 0, setActive: 0 };
  globalThis.__resumeCreateOwnerTest = {
    activeOwner: 'owner-a',
    getProfile: (_options) => delayedProfile.promise,
    peekProfileForCurrentUser: async () => null,
    list: async () => [],
    get: async () => { throw new Error('unexpected get'); },
    create: async () => {
      calls.create += 1;
      return { id: 'created-a' };
    },
    setActiveResumeId: () => {
      calls.setActive += 1;
    },
  };
  const { useDashboardResumeList } = await importBundled(`
    export { useDashboardResumeList } from './views/Dashboard/useDashboardResumeList';
  `);
  const dashboard = useDashboardResumeList({
    cachedResumes: [],
    cachedResumesOwnerKey: null,
    authUserKey: 'owner-a',
    isAuthenticated: true,
    onRequireAuth: () => undefined,
    userProfile: null,
    setView: () => {
      calls.setView += 1;
    },
    showToastLoading: () => 'toast',
    updateToast: () => undefined,
    closeToast: () => undefined,
  });

  await withMutedConsoleError(async () => {
    const pending = dashboard.createResume();
    await Promise.resolve();
    globalThis.__resumeCreateOwnerTest.activeOwner = 'owner-b';
    delayedProfile.resolve({ user_id: 'owner-a', extra_json: { template: 'a' } });
    await pending;
  });

  assert.deepEqual(calls, { create: 0, setView: 0, setActive: 0 });
});

test('editor profile completion after A to B switch never dispatches create or updates resume UI', async () => {
  const delayedProfile = deferred();
  const calls = { create: 0, reload: 0, setResumeName: 0, updateToast: 0 };
  globalThis.__resumeCreateOwnerTest = {
    activeOwner: 'owner-a',
    getProfile: (_options) => delayedProfile.promise,
    peekProfileForCurrentUser: async () => null,
    list: async () => [],
    get: async () => { throw new Error('unexpected get'); },
    create: async () => {
      calls.create += 1;
      return { id: 'created-a' };
    },
  };
  const { useCreateResumeFlow } = await importBundled(`
    export { useCreateResumeFlow } from './views/ResumeEditor/hooks/useCreateResumeFlow';
  `);
  const createResume = useCreateResumeFlow({
    authUserKey: 'owner-a',
    resumeId: null,
    isCreatingResume: false,
    isLoadingResume: false,
    buildCommittedResumeConfigSnapshot: () => ({ layout: { templateId: 'a' } }),
    clearSuppressedAutoSave: () => undefined,
    flushResumeConfig: async () => undefined,
    refreshDashboardResumesFromServer: async () => ({ status: 'success', resumes: [] }),
    reloadResumeContext: async () => {
      calls.reload += 1;
      return { status: 'failed', reason: 'unexpected', requestedId: null };
    },
    resetEditorTransientState: () => undefined,
    setIsCreatingResume: () => undefined,
    setResumeName: () => {
      calls.setResumeName += 1;
    },
    showToastError: () => 'error-toast',
    showToastInfo: () => 'info-toast',
    showToastLoading: () => 'loading-toast',
    suppressAutoSaveForConfig: () => undefined,
    updateToast: () => {
      calls.updateToast += 1;
    },
  });

  await withMutedConsoleError(async () => {
    const pending = createResume();
    await Promise.resolve();
    globalThis.__resumeCreateOwnerTest.activeOwner = 'owner-b';
    delayedProfile.resolve({ user_id: 'owner-a', extra_json: { template: 'a' } });
    await pending;
  });

  assert.deepEqual(calls, { create: 0, reload: 0, setResumeName: 0, updateToast: 0 });
});

test('dashboard keeps B list and loading state when A list resolves last', async () => {
  const ownerAList = deferred();
  const ownerBList = deferred();
  const listCalls = [];
  globalThis.__resumeCreateOwnerTest = {
    activeOwner: 'owner-a',
    getProfile: async () => ({ user_id: 'owner-a', extra_json: {} }),
    get: async () => { throw new Error('unexpected get'); },
    list: (options) => {
      listCalls.push(options);
      return options.expectedAuthCacheKey === 'owner-a'
        ? ownerAList.promise
        : ownerBList.promise;
    },
    create: async () => ({ id: 'unexpected-create' }),
  };
  const { useDashboardResumeList } = await importBundled(`
    export { useDashboardResumeList } from './views/Dashboard/useDashboardResumeList';
  `);
  const hookRuntime = createHookRuntime();
  globalThis.__resumeCreateHookRuntime = hookRuntime;
  const sharedOptions = {
    cachedResumes: [],
    cachedResumesOwnerKey: null,
    isAuthenticated: true,
    onRequireAuth: () => undefined,
    userProfile: null,
    setView: () => undefined,
    showToastLoading: () => 'toast',
    updateToast: () => undefined,
    closeToast: () => undefined,
  };
  const ownerAOptions = { ...sharedOptions, authUserKey: 'owner-a' };
  const ownerBOptions = { ...sharedOptions, authUserKey: 'owner-b' };

  hookRuntime.render(() => useDashboardResumeList(ownerAOptions));
  await settleAsyncWork();
  assert.equal(listCalls[0]?.expectedAuthCacheKey, 'owner-a');

  globalThis.__resumeCreateOwnerTest.activeOwner = 'owner-b';
  const immediateOwnerBRender = hookRuntime.render(() => useDashboardResumeList(ownerBOptions));
  assert.deepEqual(immediateOwnerBRender.resumes, []);
  await settleAsyncWork();
  assert.equal(listCalls[1]?.expectedAuthCacheKey, 'owner-b');

  ownerBList.resolve([{ id: 'resume-b', title: 'B resume' }]);
  await settleAsyncWork();
  let ownerBRender = hookRuntime.render(() => useDashboardResumeList(ownerBOptions));
  assert.deepEqual(ownerBRender.resumes.map((resume) => resume.id), ['resume-b']);
  assert.equal(ownerBRender.isLoading, false);

  ownerAList.resolve([{ id: 'resume-a', title: 'A resume' }]);
  await settleAsyncWork();
  ownerBRender = hookRuntime.render(() => useDashboardResumeList(ownerBOptions));
  assert.deepEqual(ownerBRender.resumes.map((resume) => resume.id), ['resume-b']);
  assert.equal(ownerBRender.isLoading, false);
  globalThis.__resumeCreateHookRuntime = undefined;
});

test('dashboard owner-pending render hides old resumes and dispatches no operation', async () => {
  const calls = { list: 0, create: 0, duplicate: 0, update: 0 };
  globalThis.__resumeCreateOwnerTest = {
    activeOwner: 'owner-a',
    getProfile: async () => ({ user_id: 'owner-a', extra_json: {} }),
    get: async () => { throw new Error('unexpected get'); },
    list: async () => {
      calls.list += 1;
      return [{ id: 'resume-a', name: 'A resume', title: 'A resume' }];
    },
    create: async () => {
      calls.create += 1;
      return { id: 'created-a' };
    },
    duplicate: async () => {
      calls.duplicate += 1;
      return { id: 'duplicate-a' };
    },
    update: async () => {
      calls.update += 1;
      return { id: 'resume-a' };
    },
  };
  const { useDashboardResumeList } = await importBundled(`
    export { useDashboardResumeList } from './views/Dashboard/useDashboardResumeList';
  `);
  const hookRuntime = createHookRuntime();
  globalThis.__resumeCreateHookRuntime = hookRuntime;
  const sharedOptions = {
    cachedResumes: [],
    cachedResumesOwnerKey: null,
    isAuthenticated: true,
    onRequireAuth: () => undefined,
    userProfile: null,
    setView: () => undefined,
    showToastLoading: () => 'toast',
    updateToast: () => undefined,
    closeToast: () => undefined,
  };
  const ownerAOptions = { ...sharedOptions, authUserKey: 'owner-a' };
  const ownerPendingOptions = { ...sharedOptions, authUserKey: null };

  hookRuntime.render(() => useDashboardResumeList(ownerAOptions));
  await settleAsyncWork();
  const loadedOwnerA = hookRuntime.render(() => useDashboardResumeList(ownerAOptions));
  assert.deepEqual(loadedOwnerA.resumes.map((resume) => resume.id), ['resume-a']);

  let ownerPending = hookRuntime.render(() => useDashboardResumeList(ownerPendingOptions));
  assert.deepEqual(ownerPending.resumes, []);
  assert.equal(ownerPending.isLoading, true);
  await settleAsyncWork();
  ownerPending = hookRuntime.render(() => useDashboardResumeList(ownerPendingOptions));
  assert.deepEqual(ownerPending.resumes, []);

  await ownerPending.createResume();
  await ownerPending.duplicateResume('resume-a', 'A resume');
  assert.equal(await ownerPending.renameResume('resume-a', 'Renamed'), 'busy');
  assert.deepEqual(calls, { list: 1, create: 0, duplicate: 0, update: 0 });
  globalThis.__resumeCreateHookRuntime = undefined;
});

test('dashboard ignores late A duplicate while B operation and toast complete normally', async () => {
  const ownerADuplicate = deferred();
  const ownerBDuplicate = deferred();
  const closedToasts = [];
  const updatedToasts = [];
  let toastSequence = 0;
  globalThis.__resumeCreateOwnerTest = {
    activeOwner: 'owner-a',
    getProfile: async () => ({ user_id: 'owner-a', extra_json: {} }),
    get: async () => { throw new Error('unexpected get'); },
    list: async (options) => [{
      id: `base-${options.expectedAuthCacheKey}`,
      title: `Base ${options.expectedAuthCacheKey}`,
    }],
    create: async () => ({ id: 'unexpected-create' }),
    duplicate: (_id, _payload, options) => (
      options.expectedAuthCacheKey === 'owner-a'
        ? ownerADuplicate.promise
        : ownerBDuplicate.promise
    ),
  };
  const { useDashboardResumeList } = await importBundled(`
    export { useDashboardResumeList } from './views/Dashboard/useDashboardResumeList';
  `);
  const hookRuntime = createHookRuntime();
  globalThis.__resumeCreateHookRuntime = hookRuntime;
  const sharedOptions = {
    cachedResumes: [],
    cachedResumesOwnerKey: null,
    isAuthenticated: true,
    onRequireAuth: () => undefined,
    userProfile: null,
    setView: () => undefined,
    showToastLoading: () => `toast-${toastSequence += 1}`,
    updateToast: (id, update) => updatedToasts.push({ id, update }),
    closeToast: (id) => closedToasts.push(id),
  };
  const ownerAOptions = { ...sharedOptions, authUserKey: 'owner-a' };
  const ownerBOptions = { ...sharedOptions, authUserKey: 'owner-b' };

  hookRuntime.render(() => useDashboardResumeList(ownerAOptions));
  await settleAsyncWork();
  const ownerARender = hookRuntime.render(() => useDashboardResumeList(ownerAOptions));
  const pendingOwnerA = ownerARender.duplicateResume('base-owner-a', 'A');
  await settleAsyncWork();

  globalThis.__resumeCreateOwnerTest.activeOwner = 'owner-b';
  hookRuntime.render(() => useDashboardResumeList(ownerBOptions));
  await settleAsyncWork();
  const ownerBRender = hookRuntime.render(() => useDashboardResumeList(ownerBOptions));
  const pendingOwnerB = ownerBRender.duplicateResume('base-owner-b', 'B');
  await settleAsyncWork();

  ownerBDuplicate.resolve({ id: 'duplicate-b', title: 'B copy' });
  await pendingOwnerB;
  ownerADuplicate.resolve({ id: 'duplicate-a', title: 'A copy' });
  await pendingOwnerA;
  await settleAsyncWork();

  const finalOwnerBRender = hookRuntime.render(() => useDashboardResumeList(ownerBOptions));
  assert.deepEqual(
    finalOwnerBRender.resumes.map((resume) => resume.id),
    ['duplicate-b', 'base-owner-b'],
  );
  assert.equal(finalOwnerBRender.isCopyingResume, false);
  assert.deepEqual(updatedToasts.map(({ id }) => id), ['toast-2']);
  assert.ok(closedToasts.includes('toast-1'));
  globalThis.__resumeCreateHookRuntime = undefined;
});

test('dashboard adopts the fresh server list after a rename version conflict', async () => {
  const conflict = new Error('version conflict');
  conflict.response = { status: 409 };
  let listCallCount = 0;
  globalThis.__resumeCreateOwnerTest = {
    activeOwner: 'owner-a',
    getProfile: async () => ({ user_id: 'owner-a', extra_json: {} }),
    get: async () => { throw new Error('unexpected get'); },
    list: async () => {
      listCallCount += 1;
      return listCallCount === 1
        ? [{ id: 'resume-a', title: 'Original title' }]
        : [{ id: 'resume-a', title: 'Remote title' }];
    },
    create: async () => ({ id: 'unexpected-create' }),
    update: async () => { throw conflict; },
    isResumeVersionConflict: (error) => error === conflict,
  };
  const { useDashboardResumeList } = await importBundled(`
    export { useDashboardResumeList } from './views/Dashboard/useDashboardResumeList';
  `);
  const hookRuntime = createHookRuntime();
  globalThis.__resumeCreateHookRuntime = hookRuntime;
  const options = {
    cachedResumes: [],
    cachedResumesOwnerKey: null,
    authUserKey: 'owner-a',
    isAuthenticated: true,
    onRequireAuth: () => undefined,
    userProfile: null,
    setView: () => undefined,
    showToastLoading: () => 'rename-toast',
    updateToast: () => undefined,
    closeToast: () => undefined,
  };

  hookRuntime.render(() => useDashboardResumeList(options));
  await settleAsyncWork();
  const loaded = hookRuntime.render(() => useDashboardResumeList(options));
  assert.equal(loaded.resumes[0]?.title, 'Original title');

  assert.equal(
    await withMutedConsoleError(() => loaded.renameResume('resume-a', 'Local title')),
    'error',
  );
  await settleAsyncWork();
  const afterConflict = hookRuntime.render(() => useDashboardResumeList(options));
  assert.equal(afterConflict.resumes[0]?.title, 'Remote title');
  assert.equal(listCallCount, 2);
  globalThis.__resumeCreateHookRuntime = undefined;
});

test('dashboard duplicate, rename, and delete commits are owner and generation guarded', () => {
  const hookSource = readFileSync(
    new URL('../views/Dashboard/useDashboardResumeList.ts', import.meta.url),
    'utf8',
  );
  const dashboardSource = readFileSync(
    new URL('../views/Dashboard.tsx', import.meta.url),
    'utf8',
  );

  assert.match(hookSource, /resumeService\.duplicate\([\s\S]*?expectedAuthCacheKey/);
  assert.match(hookSource, /resumeService\.update\([\s\S]*?expectedAuthCacheKey/);
  assert.match(hookSource, /copyRequestGenerationRef/);
  assert.match(hookSource, /renameRequestGenerationRef/);
  assert.match(hookSource, /closeToast\(toastId\)/);
  assert.match(dashboardSource, /resumeService\.remove\(targetId, \{ expectedAuthCacheKey \}\)/);
  assert.match(dashboardSource, /deleteRequestGenerationRef/);
  assert.match(dashboardSource, /canCommitDeleteOperation/);
  assert.match(dashboardSource, /closeToast\(toastId\)/);
  assert.match(dashboardSource, /!authUserKey\?\.trim\(\)/);
});
