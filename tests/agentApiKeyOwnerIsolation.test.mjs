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
  const runtime = {
    useState(initialValue) {
      const index = hookIndex++;
      if (!slots[index]) {
        slots[index] = {
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
      const index = hookIndex++;
      if (!slots[index]) {
        slots[index] = { value: { current: initialValue } };
      }
      return slots[index].value;
    },
    useMemo(factory, deps) {
      const index = hookIndex++;
      if (!slots[index] || !areHookDepsEqual(slots[index].deps, deps)) {
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
      if (!slot || !areHookDepsEqual(slot.deps, deps)) {
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
  };
  return runtime;
};

const virtualModules = {
  react: `
    const runtime = () => globalThis.__agentApiKeyHookRuntime;
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
  agentService: `
    export const resolveAgentApiBaseUrl = () => 'https://api.example.test';
    export const agentService = {
      listApiKeys: (...args) => globalThis.__agentApiKeyTest.listApiKeys(...args),
      createApiKey: (...args) => globalThis.__agentApiKeyTest.createApiKey(...args),
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
    export const captureAuthCacheKey = async (expected) => {
      const owner = expected ?? globalThis.__agentApiKeyTest.activeOwner;
      if (!owner || owner !== globalThis.__agentApiKeyTest.activeOwner) {
        throw new AuthContextChangedError();
      }
      return owner;
    };
    export const assertAuthCacheKey = async (expected) => {
      if (expected !== globalThis.__agentApiKeyTest.activeOwner) {
        throw new AuthContextChangedError();
      }
    };
  `,
};

const importModal = async () => {
  const result = await build({
    entryPoints: ['components/AgentApiPluginConfigModal.tsx'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    plugins: [{
      name: 'agent-api-key-owner-mocks',
      setup(buildContext) {
        buildContext.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'stub' }));
        buildContext.onResolve({ filter: /^react\/jsx-runtime$/ }, () => ({ path: 'jsxRuntime', namespace: 'stub' }));
        buildContext.onResolve({ filter: /services\/agentService$/ }, () => ({ path: 'agentService', namespace: 'stub' }));
        buildContext.onResolve({ filter: /services\/apiClient$/ }, () => ({ path: 'apiClient', namespace: 'stub' }));
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
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
};

const treeText = (node) => {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(treeText).join('');
  const value = typeof node.props?.value === 'string' ? node.props.value : '';
  return `${value}${treeText(node.props?.children)}`;
};

const findButton = (node, label) => {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const match = findButton(child, label);
      if (match) return match;
    }
    return null;
  }
  if (node.type === 'button' && treeText(node).includes(label)) {
    return node;
  }
  return findButton(node.props?.children, label);
};

const createResult = (secret, id = 'key-a') => ({
  key: secret,
  api_key: {
    id,
    name: 'Agent',
    key_prefix: secret.slice(0, 8),
    created_at: '2026-08-24T00:00:00Z',
    revoked_at: null,
  },
});

const activeKey = (id = 'active-a') => ({
  id,
  name: 'Agent',
  key_prefix: 'rfag_active',
  created_at: '2026-08-24T00:00:00Z',
  revoked_at: null,
});

test('an account A create response cannot reveal its one-time secret after switching to B', async () => {
  const createRequest = deferred();
  const createCalls = [];
  const runtime = createHookRuntime();
  globalThis.__agentApiKeyHookRuntime = runtime;
  globalThis.__agentApiKeyTest = {
    activeOwner: 'owner-a',
    listApiKeys: async () => [],
    createApiKey: (...args) => {
      createCalls.push(args);
      return createRequest.promise;
    },
  };
  globalThis.window = { confirm: () => true };

  try {
    const { default: AgentApiPluginConfigModal } = await importModal();
    const props = { isOpen: true, authUserKey: 'owner-a', onClose: () => undefined };
    let tree = runtime.render(() => AgentApiPluginConfigModal(props));
    await settleAsyncWork();
    tree = runtime.render(() => AgentApiPluginConfigModal(props));
    const refreshPromise = findButton(tree, '刷新 API Key').props.onClick();
    await settleAsyncWork();
    assert.equal(createCalls[0]?.[2]?.expectedAuthCacheKey, 'owner-a');

    globalThis.__agentApiKeyTest.activeOwner = 'owner-b';
    createRequest.resolve(createResult('secret-owner-a'));
    await refreshPromise;
    tree = runtime.render(() => AgentApiPluginConfigModal(props));
    assert.doesNotMatch(treeText(tree), /secret-owner-a/);
  } finally {
    delete globalThis.__agentApiKeyHookRuntime;
    delete globalThis.__agentApiKeyTest;
    delete globalThis.window;
  }
});

test('create then close then reopen never renders the previous one-time secret', async () => {
  const runtime = createHookRuntime();
  let isOpen = true;
  globalThis.__agentApiKeyHookRuntime = runtime;
  globalThis.__agentApiKeyTest = {
    activeOwner: 'owner-a',
    listApiKeys: async () => [],
    createApiKey: async () => createResult('secret-close-test'),
  };
  globalThis.window = { confirm: () => true };

  try {
    const { default: AgentApiPluginConfigModal } = await importModal();
    const render = () => runtime.render(() => AgentApiPluginConfigModal({
      isOpen,
      authUserKey: 'owner-a',
      onClose: () => {
        isOpen = false;
      },
    }));
    let tree = render();
    await settleAsyncWork();
    tree = render();
    await findButton(tree, '刷新 API Key').props.onClick();
    tree = render();
    assert.match(treeText(tree), /secret-close-test/);

    findButton(tree, '关闭').props.onClick();
    assert.equal(render(), null);
    isOpen = true;
    tree = render();
    assert.doesNotMatch(treeText(tree), /secret-close-test/);
  } finally {
    delete globalThis.__agentApiKeyHookRuntime;
    delete globalThis.__agentApiKeyTest;
    delete globalThis.window;
  }
});

test('a delayed clipboard failure from a closed generation cannot clear a new secret or fall back to copying', async () => {
  const runtime = createHookRuntime();
  const clipboardWrite = deferred();
  let isOpen = true;
  let fallbackCopies = 0;
  const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const originalDocument = globalThis.document;
  globalThis.__agentApiKeyHookRuntime = runtime;
  let createCalls = 0;
  globalThis.__agentApiKeyTest = {
    activeOwner: 'owner-a',
    listApiKeys: async () => [],
    createApiKey: async () => {
      createCalls += 1;
      return createResult(createCalls === 1 ? 'secret-clipboard-old' : 'secret-clipboard-new');
    },
  };
  globalThis.window = { confirm: () => true };
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { clipboard: { writeText: () => clipboardWrite.promise } },
  });
  globalThis.document = {
    body: { appendChild: () => undefined },
    createElement: () => ({
      value: '',
      style: {},
      setAttribute: () => undefined,
      focus: () => undefined,
      select: () => undefined,
      remove: () => undefined,
    }),
    execCommand: () => {
      fallbackCopies += 1;
      return true;
    },
  };

  try {
    const { default: AgentApiPluginConfigModal } = await importModal();
    const render = () => runtime.render(() => AgentApiPluginConfigModal({
      isOpen,
      authUserKey: 'owner-a',
      onClose: () => {
        isOpen = false;
      },
    }));
    let tree = render();
    await settleAsyncWork();
    tree = render();
    await findButton(tree, '刷新 API Key').props.onClick();
    tree = render();

    const copyPromise = findButton(tree, '复制 Key').props.onClick();
    await settleAsyncWork();
    findButton(tree, '关闭').props.onClick();
    assert.equal(render(), null);
    isOpen = true;
    tree = render();
    await settleAsyncWork();
    tree = render();
    await findButton(tree, '刷新 API Key').props.onClick();
    tree = render();
    assert.match(treeText(tree), /secret-clipboard-new/);

    clipboardWrite.reject(new Error('clipboard denied'));
    await copyPromise;
    tree = render();
    assert.equal(fallbackCopies, 0);
    assert.match(treeText(tree), /secret-clipboard-new/);
  } finally {
    delete globalThis.__agentApiKeyHookRuntime;
    delete globalThis.__agentApiKeyTest;
    delete globalThis.window;
    if (originalNavigatorDescriptor) {
      Object.defineProperty(globalThis, 'navigator', originalNavigatorDescriptor);
    } else {
      delete globalThis.navigator;
    }
    if (originalDocument === undefined) {
      delete globalThis.document;
    } else {
      globalThis.document = originalDocument;
    }
  }
});

test('rotate submits the owner-bound active key id as its CAS precondition', async () => {
  const runtime = createHookRuntime();
  const createCalls = [];
  globalThis.__agentApiKeyHookRuntime = runtime;
  globalThis.__agentApiKeyTest = {
    activeOwner: 'owner-a',
    listApiKeys: async () => [activeKey('active-owner-a')],
    createApiKey: (...args) => {
      createCalls.push(args);
      return Promise.resolve(createResult('secret-cas', 'replacement-a'));
    },
  };
  globalThis.window = { confirm: () => true };

  try {
    const { default: AgentApiPluginConfigModal } = await importModal();
    const props = { isOpen: true, authUserKey: 'owner-a', onClose: () => undefined };
    let tree = runtime.render(() => AgentApiPluginConfigModal(props));
    await settleAsyncWork();
    tree = runtime.render(() => AgentApiPluginConfigModal(props));
    await findButton(tree, '刷新 API Key').props.onClick();
    assert.equal(createCalls[0]?.[2]?.expectedAuthCacheKey, 'owner-a');
    assert.equal(createCalls[0]?.[2]?.expectedActiveKeyId, 'active-owner-a');
  } finally {
    delete globalThis.__agentApiKeyHookRuntime;
    delete globalThis.__agentApiKeyTest;
    delete globalThis.window;
  }
});

test('a stale CAS conflict clears secrets, reloads once, and never retries mutation', async () => {
  const runtime = createHookRuntime();
  let listCalls = 0;
  let createCalls = 0;
  globalThis.__agentApiKeyHookRuntime = runtime;
  globalThis.__agentApiKeyTest = {
    activeOwner: 'owner-a',
    listApiKeys: async () => {
      listCalls += 1;
      return [activeKey(listCalls === 1 ? 'active-old' : 'active-current')];
    },
    createApiKey: async () => {
      createCalls += 1;
      throw { response: { status: 409, data: { detail: 'Active Agent API key changed. Refresh and retry.' } } };
    },
  };
  globalThis.window = { confirm: () => true };

  try {
    const { default: AgentApiPluginConfigModal } = await importModal();
    const props = { isOpen: true, authUserKey: 'owner-a', onClose: () => undefined };
    let tree = runtime.render(() => AgentApiPluginConfigModal(props));
    await settleAsyncWork();
    tree = runtime.render(() => AgentApiPluginConfigModal(props));
    await findButton(tree, '刷新 API Key').props.onClick();
    await settleAsyncWork();
    tree = runtime.render(() => AgentApiPluginConfigModal(props));

    assert.equal(createCalls, 1);
    assert.equal(listCalls, 2);
    assert.doesNotMatch(treeText(tree), /secret-/);
    assert.match(treeText(tree), /状态已在其他操作中变化/);
  } finally {
    delete globalThis.__agentApiKeyHookRuntime;
    delete globalThis.__agentApiKeyTest;
    delete globalThis.window;
  }
});
