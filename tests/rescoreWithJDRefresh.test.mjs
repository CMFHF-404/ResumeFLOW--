import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const load = async () => {
  const slots = [];
  let cursor = 0;
  let effects = [];
  const changed = (a, b) => !a || !b || a.some((v, i) => !Object.is(v, b[i]));
  const effect = (fn, deps) => {
    const i = cursor++;
    if (!slots[i] || changed(slots[i].deps, deps)) {
      const prev = slots[i];
      slots[i] = { deps };
      effects.push(() => { prev?.cleanup?.(); slots[i].cleanup = fn(); });
    }
  };
  globalThis.__rescoreHooks = {
    useRef(value) { const i = cursor++; return slots[i] ??= { current: value }; },
    useState(value) {
      const slot = slots[cursor++] ??= { value };
      return [slot.value, next => { slot.value = next; }];
    },
    useCallback(fn, deps) {
      const i = cursor++;
      if (!slots[i] || changed(slots[i].deps, deps)) slots[i] = { deps, value: fn };
      return slots[i].value;
    },
    useLayoutEffect: effect,
    useEffect: effect,
  };
  const compiled = await build({
    entryPoints: ['views/ResumeEditor/hooks/useRescoreWithJDRefresh.ts'],
    bundle: true, write: false, format: 'esm', platform: 'node',
    plugins: [{ name: 'react', setup(b) {
      b.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'stub' }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents:
        ['useRef', 'useState', 'useCallback', 'useLayoutEffect', 'useEffect'].map(name =>
          `export const ${name} = (...args) => globalThis.__rescoreHooks.${name}(...args);`).join('\n') }));
    } }],
  });
  const { useRescoreWithJDRefresh } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}#${Math.random()}`);
  const calls = [];
  let completeRefresh;
  let options = {
    inputKey: 'owner-a/resume-a/content-a', needsJDRefresh: true, jdResultIdentity: 'old',
    refreshJD: () => { calls.push('refresh'); return new Promise(r => { completeRefresh = r; }); },
    resultIdentity: result => result.identity,
    evaluate: async () => { calls.push('score-old'); return { status: 'success' }; },
    stopJD: () => calls.push('stop-jd'), stopEvaluation: () => calls.push('stop-score'),
    onRefreshFailure: () => calls.push('failure'),
  };
  const render = (update = {}) => {
    options = { ...options, ...update }; cursor = 0;
    const hook = useRescoreWithJDRefresh(options);
    const queued = effects; effects = []; queued.forEach(fn => fn());
    return hook;
  };
  return { calls, render, complete: value => completeRefresh(value) };
};
const tick = () => new Promise(resolve => setImmediate(resolve));

test('stale JD refresh commits before exactly one score with the new inputs', async () => {
  const h = await load(); const hook = h.render(); const result = hook.run();
  assert.equal((await hook.run()).status, 'aborted');
  h.complete({ status: 'success', result: { identity: 'new' } }); await tick();
  assert.deepEqual(h.calls, ['refresh']);
  h.render({ needsJDRefresh: false, jdResultIdentity: 'new', evaluate: async () => {
    h.calls.push('score-new'); return { status: 'success' };
  } });
  assert.equal((await result).status, 'success');
  assert.deepEqual(h.calls, ['refresh', 'score-new']);
  assert.equal(h.render().isRunning, false);
});

test('fresh JD skips refresh and scores once', async () => {
  const h = await load(); const hook = h.render({ needsJDRefresh: false });
  assert.equal((await hook.run()).status, 'success');
  assert.deepEqual(h.calls, ['score-old']);
});

for (const status of ['error', 'missing_attachment', 'pending_conflict', 'empty', 'aborted']) {
  test(`JD ${status} never starts scoring`, async () => {
    const h = await load(); const result = h.render().run();
    h.complete({ status }); await result; h.render();
    assert.ok(!h.calls.includes('score-old'));
    assert.equal(h.render().isRunning, false);
  });
}

for (const update of [{ inputKey: 'owner-b/resume-b' }, { needsJDRefresh: true, jdResultIdentity: 'new' }, { needsJDRefresh: false, jdResultIdentity: 'other' }]) {
  test(`changed inputs or stale/replaced result abort continuation: ${JSON.stringify(update)}`, async () => {
    const h = await load(); const result = h.render().run();
    h.complete({ status: 'success', result: { identity: 'new' } }); await tick();
    h.render(update);
    assert.equal((await result).status, 'aborted');
    assert.ok(!h.calls.includes('score-old'));
  });
}

test('stop during refresh suppresses its late success and allows retry', async () => {
  const h = await load(); const hook = h.render(); const result = hook.run();
  hook.stop(); assert.equal((await result).status, 'aborted');
  h.complete({ status: 'success', result: { identity: 'new' } }); await tick();
  const next = h.render({ needsJDRefresh: false, jdResultIdentity: 'new' });
  assert.ok(!h.calls.includes('score-old'));
  assert.equal((await next.run()).status, 'success');
});

test('no-change refresh can continue after the stale flag clears', async () => {
  const h = await load(); const result = h.render().run();
  h.complete({ status: 'no_change' }); await tick();
  h.render({ needsJDRefresh: false });
  assert.equal((await result).status, 'success');
});

test('stop invalidates the authority passed to pending save preflights', async () => {
  for (const needsJDRefresh of [true, false]) {
    const h = await load();
    let isCurrent;
    const wait = current => { isCurrent = current; return new Promise(() => {}); };
    const hook = h.render({ needsJDRefresh, refreshJD: wait, evaluate: wait });
    const result = hook.run();
    assert.equal(isCurrent(), true);
    hook.stop();
    assert.equal(isCurrent(), false);
    assert.equal((await result).status, 'aborted');
  }
});
