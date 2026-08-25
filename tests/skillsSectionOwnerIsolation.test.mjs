import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';

const deferred = () => {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
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
  let pendingLayoutEffects = [];
  let pendingEffects = [];
  const runtime = {
    useState(initialValue) {
      const index = hookIndex++;
      if (!slots[index]) {
        slots[index] = {
          value: typeof initialValue === 'function' ? initialValue() : initialValue,
        };
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
    useLayoutEffect(effect, deps) {
      const index = hookIndex++;
      const slot = slots[index];
      if (!slot || !areDepsEqual(slot.deps, deps)) {
        slots[index] = { deps, cleanup: slot?.cleanup };
        pendingLayoutEffects.push({ index, effect });
      }
    },
    render(callback) {
      hookIndex = 0;
      pendingLayoutEffects = [];
      pendingEffects = [];
      const tree = callback();
      for (const { index, effect } of pendingLayoutEffects) {
        slots[index].cleanup?.();
        const cleanup = effect();
        slots[index].cleanup = typeof cleanup === 'function' ? cleanup : undefined;
      }
      for (const { index, effect } of pendingEffects) {
        slots[index].cleanup?.();
        const cleanup = effect();
        slots[index].cleanup = typeof cleanup === 'function' ? cleanup : undefined;
      }
      return tree;
    },
    renderWithoutCommit(callback) {
      hookIndex = 0;
      pendingLayoutEffects = [];
      pendingEffects = [];
      const tree = callback();
      pendingLayoutEffects = [];
      pendingEffects = [];
      return tree;
    },
    unmount() {
      for (const slot of slots) slot?.cleanup?.();
    },
  };
  return runtime;
};

const virtualModules = {
  react: `
    const runtime = () => globalThis.__skillsSectionHookRuntime;
    const React = {};
    export const useState = (value) => runtime().useState(value);
    export const useRef = (value) => runtime().useRef(value);
    export const useMemo = (factory, deps) => runtime().useMemo(factory, deps);
    export const useCallback = (callback, deps) => runtime().useCallback(callback, deps);
    export const useEffect = (effect, deps) => runtime().useEffect(effect, deps);
    export const useLayoutEffect = (effect, deps) => runtime().useLayoutEffect(effect, deps);
    export default React;
  `,
  jsxRuntime: `
    export const Fragment = Symbol.for('test.fragment');
    export const jsx = (type, props, key) => ({ type, key, props: props || {} });
    export const jsxs = jsx;
  `,
  icons: `
    export const Plus = function Plus() {};
    export const Wrench = function Wrench() {};
    export const ChevronDown = function ChevronDown() {};
  `,
  skillsService: `
    export const skillsService = {
      list: (...args) => globalThis.__skillsSectionOwnerTest.list(...args),
      create: (...args) => globalThis.__skillsSectionOwnerTest.create(...args),
      update: (...args) => globalThis.__skillsSectionOwnerTest.update(...args),
      delete: (...args) => globalThis.__skillsSectionOwnerTest.delete(...args),
    };
  `,
  apiClient: `
    export class AuthContextChangedError extends Error {
      constructor() {
        super('Authentication context changed during operation');
        this.name = 'AuthContextChangedError';
      }
    }
    export const isAuthContextChangedError = (error) => error?.name === 'AuthContextChangedError';
    export const assertAuthCacheKey = async (expected) => {
      globalThis.__skillsSectionOwnerTest.assertions.push(expected);
      if (expected !== globalThis.__skillsSectionOwnerTest.activeOwner) {
        throw new AuthContextChangedError();
      }
    };
  `,
  confirmDialog: 'export default function ConfirmDialog() {}',
  skillCard: 'export default function SkillCategoryCard() {}',
};

const importSkillsSection = async () => {
  const result = await build({
    entryPoints: ['views/SkillsSection.tsx'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    plugins: [{
      name: 'skills-section-owner-stubs',
      setup(buildContext) {
        buildContext.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'stub' }));
        buildContext.onResolve({ filter: /^react\/jsx-runtime$/ }, () => ({ path: 'jsxRuntime', namespace: 'stub' }));
        buildContext.onResolve({ filter: /^lucide-react$/ }, () => ({ path: 'icons', namespace: 'stub' }));
        buildContext.onResolve({ filter: /services[\\/]skillsService$/ }, () => ({ path: 'skillsService', namespace: 'stub' }));
        buildContext.onResolve({ filter: /services[\\/]apiClient$/ }, () => ({ path: 'apiClient', namespace: 'stub' }));
        buildContext.onResolve({ filter: /ConfirmDialog$/ }, () => ({ path: 'confirmDialog', namespace: 'stub' }));
        buildContext.onResolve({ filter: /SkillCategoryCard$/ }, () => ({ path: 'skillCard', namespace: 'stub' }));
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
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
};

const findNodes = (node, predicate, matches = []) => {
  if (node == null || typeof node !== 'object') return matches;
  if (Array.isArray(node)) {
    for (const child of node) findNodes(child, predicate, matches);
    return matches;
  }
  if (predicate(node)) matches.push(node);
  findNodes(node.props?.children, predicate, matches);
  return matches;
};

const findSkillCards = (tree) => findNodes(
  tree,
  (node) => node.type?.name === 'SkillCategoryCard',
);

const createToast = (events) => ({
  success: (...args) => events.push(['success', ...args]),
  error: (...args) => events.push(['error', ...args]),
  loading: (...args) => {
    events.push(['loading', ...args]);
    return 'toast-1';
  },
  updateToast: (...args) => events.push(['update', ...args]),
  closeToast: (...args) => events.push(['close', ...args]),
});

const skill = (id, name, category = 'Engineering') => ({ id, name, category });

test('owner change hides A skills on the first B render before effects can reset state', async () => {
  const runtime = createHookRuntime();
  const listCalls = [];
  globalThis.__skillsSectionHookRuntime = runtime;
  globalThis.__skillsSectionOwnerTest = {
    activeOwner: 'owner-a',
    assertions: [],
    list: async (options) => {
      listCalls.push(options);
      return options.expectedAuthCacheKey === 'owner-a'
        ? [skill('skill-a', 'A-only')]
        : [skill('skill-b', 'B-only')];
    },
    create: async () => ({}),
    update: async () => ({}),
    delete: async () => undefined,
  };

  try {
    const { default: SkillsSection } = await importSkillsSection();
    const toast = createToast([]);
    let props = { toast, isAuthenticated: true, authUserKey: 'owner-a' };
    runtime.render(() => SkillsSection(props));
    await settleAsyncWork();
    let tree = runtime.render(() => SkillsSection(props));
    assert.equal(findSkillCards(tree)[0]?.props.data.skills[0], 'A-only');

    globalThis.__skillsSectionOwnerTest.activeOwner = 'owner-b';
    props = { ...props, authUserKey: 'owner-b' };
    tree = runtime.render(() => SkillsSection(props));
    assert.deepEqual(findSkillCards(tree), [], 'A state must be hidden in the render that first sees owner B');
    await settleAsyncWork();
    tree = runtime.render(() => SkillsSection(props));
    assert.equal(findSkillCards(tree)[0]?.props.data.skills[0], 'B-only');
    assert.deepEqual(
      listCalls.map((options) => options.expectedAuthCacheKey),
      ['owner-a', 'owner-b'],
    );
  } finally {
    runtime.unmount();
    delete globalThis.__skillsSectionHookRuntime;
    delete globalThis.__skillsSectionOwnerTest;
  }
});

test('an A list response cannot commit after session B becomes active before React updates owner', async () => {
  const runtime = createHookRuntime();
  const listGate = deferred();
  globalThis.__skillsSectionHookRuntime = runtime;
  globalThis.__skillsSectionOwnerTest = {
    activeOwner: 'owner-a',
    assertions: [],
    list: () => listGate.promise,
    create: async () => ({}),
    update: async () => ({}),
    delete: async () => undefined,
  };

  try {
    const { default: SkillsSection } = await importSkillsSection();
    const props = { toast: createToast([]), isAuthenticated: true, authUserKey: 'owner-a' };
    runtime.render(() => SkillsSection(props));
    await settleAsyncWork();

    globalThis.__skillsSectionOwnerTest.activeOwner = 'owner-b';
    listGate.resolve([skill('skill-b', 'B-response')]);
    await settleAsyncWork();
    const tree = runtime.render(() => SkillsSection(props));
    assert.deepEqual(findSkillCards(tree), [], 'a response observed under session B must not commit into owner A state');
  } finally {
    runtime.unmount();
    delete globalThis.__skillsSectionHookRuntime;
    delete globalThis.__skillsSectionOwnerTest;
  }
});

test('session B established before React owner update prevents every A save mutation dispatch', async () => {
  const runtime = createHookRuntime();
  const mutationCalls = [];
  const toastEvents = [];
  globalThis.__skillsSectionHookRuntime = runtime;
  globalThis.__skillsSectionOwnerTest = {
    activeOwner: 'owner-a',
    assertions: [],
    list: async () => [skill('skill-a', 'TypeScript')],
    create: async (...args) => mutationCalls.push(['create', ...args]),
    update: async (...args) => mutationCalls.push(['update', ...args]),
    delete: async (...args) => mutationCalls.push(['delete', ...args]),
  };

  try {
    const { default: SkillsSection } = await importSkillsSection();
    const props = {
      toast: createToast(toastEvents),
      isAuthenticated: true,
      authUserKey: 'owner-a',
    };
    runtime.render(() => SkillsSection(props));
    await settleAsyncWork();
    let tree = runtime.render(() => SkillsSection(props));
    let card = findSkillCards(tree)[0];
    card.props.onSkillsChange(['TypeScript', 'Rust']);
    tree = runtime.render(() => SkillsSection(props));
    card = findSkillCards(tree)[0];

    globalThis.__skillsSectionOwnerTest.activeOwner = 'owner-b';
    await card.props.onSave();

    assert.deepEqual(mutationCalls, []);
    assert.deepEqual(toastEvents, [], 'the stale owner must fail before any save toast or stateful result');
  } finally {
    runtime.unmount();
    delete globalThis.__skillsSectionHookRuntime;
    delete globalThis.__skillsSectionOwnerTest;
  }
});

test('an abandoned B render does not invalidate the still-committed owner A actions', async () => {
  const runtime = createHookRuntime();
  const mutationCalls = [];
  globalThis.__skillsSectionHookRuntime = runtime;
  globalThis.__skillsSectionOwnerTest = {
    activeOwner: 'owner-a',
    assertions: [],
    list: async () => [skill('skill-a', 'TypeScript')],
    create: async (...args) => {
      mutationCalls.push(['create', ...args]);
      return skill('skill-rust', 'Rust');
    },
    update: async (...args) => mutationCalls.push(['update', ...args]),
    delete: async (...args) => mutationCalls.push(['delete', ...args]),
  };

  try {
    const { default: SkillsSection } = await importSkillsSection();
    const propsA = {
      toast: createToast([]),
      isAuthenticated: true,
      authUserKey: 'owner-a',
    };
    runtime.render(() => SkillsSection(propsA));
    await settleAsyncWork();
    let tree = runtime.render(() => SkillsSection(propsA));
    let card = findSkillCards(tree)[0];
    card.props.onSkillsChange(['TypeScript', 'Rust']);
    tree = runtime.render(() => SkillsSection(propsA));
    card = findSkillCards(tree)[0];

    runtime.renderWithoutCommit(() => SkillsSection({ ...propsA, authUserKey: 'owner-b' }));
    await card.props.onSave();

    const createCall = mutationCalls.find(([type]) => type === 'create');
    assert.equal(createCall?.[2]?.expectedAuthCacheKey, 'owner-a');
  } finally {
    runtime.unmount();
    delete globalThis.__skillsSectionHookRuntime;
    delete globalThis.__skillsSectionOwnerTest;
  }
});

test('switching owners closes an A loading toast while its mutation is still pending', async () => {
  const runtime = createHookRuntime();
  const createGate = deferred();
  const mutationCalls = [];
  const toastEvents = [];
  globalThis.__skillsSectionHookRuntime = runtime;
  globalThis.__skillsSectionOwnerTest = {
    activeOwner: 'owner-a',
    assertions: [],
    list: async (options) => options.expectedAuthCacheKey === 'owner-a'
      ? [skill('skill-a', 'TypeScript')]
      : [skill('skill-b', 'Go')],
    create: (...args) => {
      mutationCalls.push(['create', ...args]);
      return createGate.promise;
    },
    update: async (...args) => mutationCalls.push(['update', ...args]),
    delete: async (...args) => mutationCalls.push(['delete', ...args]),
  };

  try {
    const { default: SkillsSection } = await importSkillsSection();
    const toast = createToast(toastEvents);
    let props = { toast, isAuthenticated: true, authUserKey: 'owner-a' };
    runtime.render(() => SkillsSection(props));
    await settleAsyncWork();
    let tree = runtime.render(() => SkillsSection(props));
    let card = findSkillCards(tree)[0];
    card.props.onSkillsChange(['TypeScript', 'Rust']);
    tree = runtime.render(() => SkillsSection(props));
    card = findSkillCards(tree)[0];
    const savePromise = card.props.onSave();
    await settleAsyncWork();
    assert.equal(mutationCalls[0]?.[2]?.expectedAuthCacheKey, 'owner-a');
    assert.deepEqual(toastEvents[0], ['loading', '正在保存技能...']);

    globalThis.__skillsSectionOwnerTest.activeOwner = 'owner-b';
    props = { ...props, authUserKey: 'owner-b' };
    runtime.render(() => SkillsSection(props));
    assert.ok(
      toastEvents.some(([type, id]) => type === 'close' && id === 'toast-1'),
      'owner transition must synchronously close the old loading toast in the layout effect',
    );

    createGate.resolve(skill('skill-rust', 'Rust'));
    await savePromise;
    assert.equal(
      mutationCalls.filter(([type]) => type === 'create').length,
      1,
      'the pending A mutation must never be retried under B',
    );
    assert.equal(
      toastEvents.some(([type, _id, update]) => (
        type === 'update'
        && (update?.type === 'success' || update?.type === 'error')
      )),
      false,
      'the stale result must not publish success or error into owner B UI',
    );
  } finally {
    runtime.unmount();
    delete globalThis.__skillsSectionHookRuntime;
    delete globalThis.__skillsSectionOwnerTest;
  }
});

test('authenticated rendering without a resolved owner fails closed', async () => {
  const runtime = createHookRuntime();
  let listCalls = 0;
  globalThis.__skillsSectionHookRuntime = runtime;
  globalThis.__skillsSectionOwnerTest = {
    activeOwner: 'owner-a',
    assertions: [],
    list: async () => {
      listCalls += 1;
      return [skill('skill-a', 'Should-not-load')];
    },
    create: async () => ({}),
    update: async () => ({}),
    delete: async () => undefined,
  };

  try {
    const { default: SkillsSection } = await importSkillsSection();
    const tree = runtime.render(() => SkillsSection({
      toast: createToast([]),
      isAuthenticated: true,
    }));
    await settleAsyncWork();
    assert.equal(listCalls, 0);
    assert.deepEqual(findSkillCards(tree), []);
  } finally {
    runtime.unmount();
    delete globalThis.__skillsSectionHookRuntime;
    delete globalThis.__skillsSectionOwnerTest;
  }
});

test('all SkillsSection service calls carry the captured owner', () => {
  const source = readFileSync(new URL('../views/SkillsSection.tsx', import.meta.url), 'utf8');
  assert.match(source, /skillsService\.list\(\{[\s\S]*?expectedAuthCacheKey: operation\.expectedAuthCacheKey/);
  assert.match(source, /skillsService\.create\([\s\S]*?expectedAuthCacheKey: operation\.expectedAuthCacheKey/);
  assert.match(source, /skillsService\.update\([\s\S]*?expectedAuthCacheKey: operation\.expectedAuthCacheKey/);
  assert.match(source, /skillsService\.delete\([\s\S]*?expectedAuthCacheKey: operation\.expectedAuthCacheKey/);
});
