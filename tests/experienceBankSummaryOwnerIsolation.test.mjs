import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import { build } from 'esbuild';

const deferred = () => {
  let resolve;
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
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
  return {
    useState(initialValue) {
      const slotIndex = index++;
      slots[slotIndex] ??= { value: typeof initialValue === 'function' ? initialValue() : initialValue };
      return [slots[slotIndex].value, (update) => {
        slots[slotIndex].value = typeof update === 'function' ? update(slots[slotIndex].value) : update;
      }];
    },
    useRef(initialValue) {
      const slotIndex = index++;
      slots[slotIndex] ??= { value: { current: initialValue } };
      return slots[slotIndex].value;
    },
    useCallback(callback, dependencies) {
      const slotIndex = index++;
      if (!slots[slotIndex] || !areDepsEqual(slots[slotIndex].dependencies, dependencies)) {
        slots[slotIndex] = { callback, dependencies };
      }
      return slots[slotIndex].callback;
    },
    useLayoutEffect(effect, dependencies) {
      const slotIndex = index++;
      const previous = slots[slotIndex];
      if (!previous || !areDepsEqual(previous.dependencies, dependencies)) {
        previous?.cleanup?.();
        const cleanup = effect();
        slots[slotIndex] = {
          dependencies,
          cleanup: typeof cleanup === 'function' ? cleanup : undefined,
        };
      }
    },
    render(callback) {
      index = 0;
      return callback();
    },
  };
};

const importHook = async () => {
  const result = await build({
    entryPoints: ['views/ExperienceBank/useExperienceBankSummaryGeneration.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    plugins: [{
      name: 'summary-owner-stubs',
      setup(buildApi) {
        buildApi.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'stub' }));
        buildApi.onResolve({ filter: /services[\\/]aiService$/ }, () => ({ path: 'ai', namespace: 'stub' }));
        buildApi.onResolve({ filter: /services[\\/]apiClient$/ }, () => ({ path: 'api', namespace: 'stub' }));
        buildApi.onResolve({ filter: /utils[\\/]aiThought$/ }, () => ({ path: 'thought', namespace: 'stub' }));
        buildApi.onResolve({ filter: /utils[\\/]richText$/ }, () => ({ path: 'rich', namespace: 'stub' }));
        buildApi.onLoad({ filter: /^react$/, namespace: 'stub' }, () => ({
          contents: `
            const runtime = () => globalThis.__summaryOwnerRuntime;
            export const useState = (value) => runtime().useState(value);
            export const useRef = (value) => runtime().useRef(value);
            export const useCallback = (callback, deps) => runtime().useCallback(callback, deps);
            export const useLayoutEffect = (effect, deps) => runtime().useLayoutEffect(effect, deps);
          `,
          loader: 'js',
        }));
        buildApi.onLoad({ filter: /^ai$/, namespace: 'stub' }, () => ({
          contents: `export const aiService = { generatePersonalSummaryStream: (...args) => globalThis.__summaryOwnerHarness.ai(...args) };`,
          loader: 'js',
        }));
        buildApi.onLoad({ filter: /^api$/, namespace: 'stub' }, () => ({
          contents: `
            export class AuthContextChangedError extends Error { constructor() { super('changed'); this.name = 'AuthContextChangedError'; } }
            export const isAuthContextChangedError = (error) => error?.name === 'AuthContextChangedError';
            export const assertAuthCacheKey = async (expected) => {
              if (expected !== globalThis.__summaryOwnerHarness.activeOwner) throw new AuthContextChangedError();
            };
          `,
          loader: 'js',
        }));
        buildApi.onLoad({ filter: /^thought$/, namespace: 'stub' }, () => ({
          contents: `export const resolveThoughtDisplayEvent = () => null;`,
          loader: 'js',
        }));
        buildApi.onLoad({ filter: /^rich$/, namespace: 'stub' }, () => ({
          contents: `export const stripRichTextToText = (value) => value;`,
          loader: 'js',
        }));
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}#${Math.random()}`);
};

const snapshot = {
  profile: { user_id: 'owner-a', summary: '' },
  workItems: [{ master: { id: 'work-a' } }],
  projectItems: [],
  educationItems: [],
  certifications: [],
  skills: [],
};

const buildProps = (overrides = {}) => ({
  authUserKey: 'owner-a',
  isLoadingProfile: false,
  isEditingProfile: false,
  hasHydratedProfileRef: { current: false },
  setIsEditingProfile: () => undefined,
  setSummary: (...args) => globalThis.__summaryOwnerHarness.summaryCommits.push(args),
  loadExportSnapshot: async () => snapshot,
  loadValidationSnapshot: async () => snapshot,
  buildSummaryPayload: (_profile, value) => ({ workIds: value.workItems.map((item) => item.master.id) }),
  buildCurrentProfileDraftSnapshot: (profile) => profile,
  mergeRecoveredProfileIntoDraft: (...args) => globalThis.__summaryOwnerHarness.profileCommits.push(args),
  markSummaryDraftTouched: () => undefined,
  toastError: () => undefined,
  loading: () => 'toast-1',
  updateToast: () => undefined,
  closeToast: () => undefined,
  ...overrides,
});

test('owner switch while the initial snapshot is pending prevents AI dispatch and profile/summary commits', async () => {
  const runtime = createHookRuntime();
  const snapshotGate = deferred();
  globalThis.__summaryOwnerRuntime = runtime;
  globalThis.__summaryOwnerHarness = {
    activeOwner: 'owner-a',
    aiCalls: 0,
    summaryCommits: [],
    profileCommits: [],
    ai: async () => {
      globalThis.__summaryOwnerHarness.aiCalls += 1;
      return { summary: 'unexpected' };
    },
  };

  try {
    const { useExperienceBankSummaryGeneration } = await importHook();
    const hook = runtime.render(() => useExperienceBankSummaryGeneration(buildProps({
      loadExportSnapshot: (expectedOwner) => {
        assert.equal(expectedOwner, 'owner-a');
        return snapshotGate.promise;
      },
    })));
    const pending = hook.handleGenerateSummary();
    await Promise.resolve();
    globalThis.__summaryOwnerHarness.activeOwner = 'owner-b';
    snapshotGate.resolve(snapshot);
    await pending;

    assert.equal(globalThis.__summaryOwnerHarness.aiCalls, 0);
    assert.deepEqual(globalThis.__summaryOwnerHarness.profileCommits, []);
    assert.deepEqual(globalThis.__summaryOwnerHarness.summaryCommits, []);
  } finally {
    delete globalThis.__summaryOwnerRuntime;
    delete globalThis.__summaryOwnerHarness;
  }
});

test('owner switch while the AI response is pending prevents validation and summary commit', async () => {
  const runtime = createHookRuntime();
  const aiGate = deferred();
  let validationCalls = 0;
  globalThis.__summaryOwnerRuntime = runtime;
  globalThis.__summaryOwnerHarness = {
    activeOwner: 'owner-a',
    aiCalls: 0,
    summaryCommits: [],
    profileCommits: [],
    ai: async () => {
      globalThis.__summaryOwnerHarness.aiCalls += 1;
      return aiGate.promise;
    },
  };

  try {
    const { useExperienceBankSummaryGeneration } = await importHook();
    const hook = runtime.render(() => useExperienceBankSummaryGeneration(buildProps({
      loadValidationSnapshot: async () => {
        validationCalls += 1;
        return snapshot;
      },
    })));
    const pending = hook.handleGenerateSummary();
    while (globalThis.__summaryOwnerHarness.aiCalls === 0) await Promise.resolve();
    globalThis.__summaryOwnerHarness.activeOwner = 'owner-b';
    aiGate.resolve({ summary: 'owner-b must not commit' });
    await pending;

    assert.equal(validationCalls, 0);
    assert.deepEqual(globalThis.__summaryOwnerHarness.summaryCommits, []);
  } finally {
    delete globalThis.__summaryOwnerRuntime;
    delete globalThis.__summaryOwnerHarness;
  }
});
