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
      const tree = callback();
      for (const { index, effect } of pendingEffects) {
        slots[index].cleanup?.();
        const cleanup = effect();
        slots[index].cleanup = typeof cleanup === 'function' ? cleanup : undefined;
      }
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
    const runtime = () => globalThis.__certificationSectionHookRuntime;
    const React = {
      useState: (value) => runtime().useState(value),
      useRef: (value) => runtime().useRef(value),
      useMemo: (factory, deps) => runtime().useMemo(factory, deps),
      useCallback: (callback, deps) => runtime().useCallback(callback, deps),
      useEffect: (effect, deps) => runtime().useEffect(effect, deps),
      useLayoutEffect: (effect, deps) => runtime().useEffect(effect, deps),
    };
    export const useState = React.useState;
    export const useRef = React.useRef;
    export const useMemo = React.useMemo;
    export const useCallback = React.useCallback;
    export const useEffect = React.useEffect;
    export const useLayoutEffect = React.useLayoutEffect;
    export default React;
  `,
  jsxRuntime: `
    export const Fragment = Symbol.for('test.fragment');
    export const jsx = (type, props, key) => ({ type, key, props: props || {} });
    export const jsxs = jsx;
  `,
  lucide: `
    export const Award = 'award-icon';
    export const Plus = 'plus-icon';
    export const ChevronDown = 'chevron-icon';
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
      globalThis.__certificationSectionOwnerTest.assertCalls.push(expected);
      if (expected !== globalThis.__certificationSectionOwnerTest.activeOwner) {
        throw new AuthContextChangedError();
      }
    };
  `,
  certificationsService: `
    export const certificationsService = {
      list: (...args) => globalThis.__certificationSectionOwnerTest.list(...args),
      create: (...args) => globalThis.__certificationSectionOwnerTest.create(...args),
      update: (...args) => globalThis.__certificationSectionOwnerTest.update(...args),
      delete: (...args) => globalThis.__certificationSectionOwnerTest.delete(...args),
    };
  `,
  experienceUtils: `
    export const convertDateToISO = (value) => value;
    export const getTodayLocalISODate = () => '2026-08-24';
    export const parseYearMonthValue = () => 0;
    export const runDedupedRefresh = async (ref, task) => {
      if (ref.current) return ref.current;
      let request;
      request = task().finally(() => {
        if (ref.current === request) ref.current = null;
      });
      ref.current = request;
      return request;
    };
  `,
  certificationCard: `export default 'certification-card';`,
  confirmDialog: `export default 'confirm-dialog';`,
};

const importCertificationSection = async () => {
  const result = await build({
    entryPoints: ['views/CertificationSection.tsx'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    plugins: [{
      name: 'certification-section-owner-mocks',
      setup(buildContext) {
        buildContext.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'stub' }));
        buildContext.onResolve({ filter: /^react\/jsx-runtime$/ }, () => ({ path: 'jsxRuntime', namespace: 'stub' }));
        buildContext.onResolve({ filter: /^lucide-react$/ }, () => ({ path: 'lucide', namespace: 'stub' }));
        buildContext.onResolve({ filter: /services\/apiClient$/ }, () => ({ path: 'apiClient', namespace: 'stub' }));
        buildContext.onResolve({ filter: /services\/certificationsService$/ }, () => ({ path: 'certificationsService', namespace: 'stub' }));
        buildContext.onResolve({ filter: /experienceUtils$/ }, () => ({ path: 'experienceUtils', namespace: 'stub' }));
        buildContext.onResolve({ filter: /CertificationCard$/ }, () => ({ path: 'certificationCard', namespace: 'stub' }));
        buildContext.onResolve({ filter: /components\/ConfirmDialog$/ }, () => ({ path: 'confirmDialog', namespace: 'stub' }));
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

const treeText = (node) => {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(treeText).join('');
  return treeText(node.props?.children);
};

const findNode = (node, predicate) => {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const match = findNode(child, predicate);
      if (match) return match;
    }
    return null;
  }
  if (predicate(node)) return node;
  return findNode(node.props?.children, predicate);
};

const findButton = (tree, label) => findNode(
  tree,
  (node) => node.type === 'button' && treeText(node).includes(label),
);

const findCertificationCards = (node, matches = []) => {
  if (!node || typeof node !== 'object') return matches;
  if (Array.isArray(node)) {
    node.forEach((child) => findCertificationCards(child, matches));
    return matches;
  }
  if (node.type === 'certification-card') matches.push(node);
  findCertificationCards(node.props?.children, matches);
  return matches;
};

const certification = (id, name) => ({
  id,
  name,
  issuer: 'Issuer',
  issue_date: '2026-08-24',
  description: null,
});

const createToast = (events) => ({
  success: (message) => { events.push(['success', message]); return 'success-toast'; },
  error: (message) => { events.push(['error', message]); return 'error-toast'; },
  loading: (message) => { events.push(['loading', message]); return 'loading-toast'; },
  updateToast: (_id, update) => events.push([update.type, update.message]),
});

test('an owner prop change hides the previous owner certifications on the first render', async () => {
  const runtime = createHookRuntime();
  const listCalls = [];
  globalThis.__certificationSectionHookRuntime = runtime;
  globalThis.__certificationSectionOwnerTest = {
    activeOwner: 'owner-a',
    assertCalls: [],
    list: async (options) => {
      listCalls.push(options);
      return options.expectedAuthCacheKey === 'owner-a'
        ? [certification('cert-a', 'Owner A certificate')]
        : [];
    },
    create: async () => certification('created', 'Created'),
    update: async () => ({}),
    delete: async () => undefined,
  };

  try {
    const { default: CertificationSection } = await importCertificationSection();
    const toast = createToast([]);
    let authUserKey = 'owner-a';
    const render = () => runtime.render(() => CertificationSection({
      toast,
      authUserKey,
      isAuthenticated: true,
    }));

    render();
    await settleAsyncWork();
    let tree = render();
    assert.equal(findCertificationCards(tree)[0]?.props.data.name, 'Owner A certificate');
    assert.equal(listCalls[0]?.expectedAuthCacheKey, 'owner-a');

    authUserKey = 'owner-b';
    globalThis.__certificationSectionOwnerTest.activeOwner = 'owner-b';
    tree = render();
    assert.equal(findCertificationCards(tree).length, 0);
  } finally {
    runtime.unmount();
    delete globalThis.__certificationSectionHookRuntime;
    delete globalThis.__certificationSectionOwnerTest;
  }
});

test('a session switch before the React owner update prevents stale list commits and write dispatch', async () => {
  const pendingList = deferred();
  const runtime = createHookRuntime();
  const listCalls = [];
  const createCalls = [];
  const toastEvents = [];
  globalThis.__certificationSectionHookRuntime = runtime;
  globalThis.__certificationSectionOwnerTest = {
    activeOwner: 'owner-a',
    assertCalls: [],
    list: (...args) => {
      listCalls.push(args);
      return pendingList.promise;
    },
    create: (...args) => {
      createCalls.push(args);
      return Promise.resolve(certification('wrong-owner', 'Wrong owner'));
    },
    update: async () => ({}),
    delete: async () => undefined,
  };

  try {
    const { default: CertificationSection } = await importCertificationSection();
    const props = {
      toast: createToast(toastEvents),
      authUserKey: 'owner-a',
      isAuthenticated: true,
    };
    let refreshSignal;
    const render = () => runtime.render(() => CertificationSection({
      ...props,
      refreshSignal,
    }));
    let tree = render();
    await settleAsyncWork();
    assert.equal(listCalls.length, 1);

    globalThis.__certificationSectionOwnerTest.activeOwner = 'owner-b';
    pendingList.resolve([certification('cert-a', 'Stale owner A certificate')]);
    await settleAsyncWork();
    tree = render();
    assert.equal(findCertificationCards(tree).length, 0, 'the stale list result must not commit');

    refreshSignal = 1;
    tree = render();
    await settleAsyncWork();
    assert.equal(listCalls.length, 1, 'refresh must fail before service dispatch');

    await findButton(tree, '新增证书资质').props.onClick();
    await settleAsyncWork();
    tree = render();

    assert.equal(createCalls.length, 0, 'the write must fail before service dispatch');
    assert.deepEqual(toastEvents, [], 'an owner mismatch must not commit loading/error/success toasts');
    assert.equal(findCertificationCards(tree).length, 0);
  } finally {
    runtime.unmount();
    delete globalThis.__certificationSectionHookRuntime;
    delete globalThis.__certificationSectionOwnerTest;
  }
});

test('a create already in flight cannot commit after an owner switch and dismisses its loading toast', async () => {
  const pendingCreate = deferred();
  const runtime = createHookRuntime();
  const createCalls = [];
  const toastEvents = [];
  globalThis.__certificationSectionHookRuntime = runtime;
  globalThis.__certificationSectionOwnerTest = {
    activeOwner: 'owner-a',
    assertCalls: [],
    list: async () => [],
    create: (...args) => {
      createCalls.push(args);
      return pendingCreate.promise;
    },
    update: async () => ({}),
    delete: async () => undefined,
  };

  try {
    const { default: CertificationSection } = await importCertificationSection();
    let authUserKey = 'owner-a';
    const toast = {
      success: (message) => { toastEvents.push({ kind: 'success', message }); return 'success-toast'; },
      error: (message) => { toastEvents.push({ kind: 'error', message }); return 'error-toast'; },
      loading: (message) => { toastEvents.push({ kind: 'loading', message }); return 'loading-toast'; },
      updateToast: (id, update) => toastEvents.push({ kind: 'update', id, update }),
      closeToast: (id) => toastEvents.push({ kind: 'close', id }),
    };
    const render = () => runtime.render(() => CertificationSection({
      toast,
      authUserKey,
      isAuthenticated: true,
    }));

    let tree = render();
    await settleAsyncWork();
    tree = render();
    const createPromise = findButton(tree, '新增证书资质').props.onClick();
    await settleAsyncWork();
    assert.equal(createCalls[0]?.[1]?.expectedAuthCacheKey, 'owner-a');
    assert.equal(toastEvents.filter((event) => event.kind === 'loading').length, 1);

    globalThis.__certificationSectionOwnerTest.activeOwner = 'owner-b';
    authUserKey = 'owner-b';
    tree = render();
    assert.equal(findCertificationCards(tree).length, 0);
    assert.deepEqual(
      toastEvents.find((event) => event.kind === 'close'),
      { kind: 'close', id: 'loading-toast' },
      'the committed owner transition must close the stale loading toast immediately',
    );

    pendingCreate.resolve(certification('cert-a', 'Stale created certificate'));
    await createPromise;
    tree = render();

    assert.equal(findCertificationCards(tree).length, 0);
    assert.equal(toastEvents.some((event) => event.kind === 'success'), false);
    assert.equal(toastEvents.some((event) => event.kind === 'error'), false);
    assert.equal(toastEvents.filter((event) => event.kind === 'close').length, 1);
    assert.equal(toastEvents.some((event) => event.kind === 'update'), false);
  } finally {
    runtime.unmount();
    delete globalThis.__certificationSectionHookRuntime;
    delete globalThis.__certificationSectionOwnerTest;
  }
});

test('an authenticated render without a resolved owner fails closed', async () => {
  const runtime = createHookRuntime();
  let listCalls = 0;
  let createCalls = 0;
  globalThis.__certificationSectionHookRuntime = runtime;
  globalThis.__certificationSectionOwnerTest = {
    activeOwner: 'owner-a',
    assertCalls: [],
    list: async () => { listCalls += 1; return []; },
    create: async () => { createCalls += 1; return certification('created', 'Created'); },
    update: async () => ({}),
    delete: async () => undefined,
  };

  try {
    const { default: CertificationSection } = await importCertificationSection();
    const tree = runtime.render(() => CertificationSection({
      toast: createToast([]),
      isAuthenticated: true,
    }));
    await settleAsyncWork();
    await findButton(tree, '新增证书资质').props.onClick();
    await settleAsyncWork();

    assert.equal(listCalls, 0);
    assert.equal(createCalls, 0);
  } finally {
    runtime.unmount();
    delete globalThis.__certificationSectionHookRuntime;
    delete globalThis.__certificationSectionOwnerTest;
  }
});
