import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import { build } from 'esbuild';

const importBundledModule = async (entryPoint) => {
  const result = await build({
    entryPoints: [entryPoint],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const encoded = Buffer.from(result.outputFiles[0].text).toString('base64');
  return import(`data:text/javascript;base64,${encoded}#${Math.random()}`);
};

const importLoader = async () => {
  const [loader, controller] = await Promise.all([
    importBundledModule('components/paymentOrderListLoader.ts'),
    importBundledModule('components/paymentOrderRequestController.ts'),
  ]);
  return { ...loader, ...controller };
};

const order = (id) => ({
  id,
  state_version: 1,
  status: 'pending',
  sku: `sku-${id}`,
  amount_fen: 100,
  currency: 'CNY',
  created_at: '2026-08-17T00:00:00.000Z',
});

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const callbacks = () => {
  const calls = {
    starts: [],
    observed: [],
    successes: [],
    errors: [],
    finishes: [],
  };
  return {
    calls,
    handlers: {
      onStart: (mode) => calls.starts.push(mode),
      onOrderObserved: (item) => calls.observed.push(item.id),
      onSuccess: (result) => calls.successes.push(result),
      onError: (error) => calls.errors.push(error),
      onFinish: (mode) => calls.finishes.push(mode),
    },
  };
};

test('replay loads the recorded page depth with cursor order and one merged success', async () => {
  const {
    createPaymentOrderRequestController,
    runPaymentOrderListLoad,
  } = await importLoader();
  const controller = createPaymentOrderRequestController();
  controller.recordLoadedCount(40);
  const cursors = [];
  const { calls, handlers } = callbacks();

  const loaded = await runPaymentOrderListLoad({
    controller,
    options: { replayLoadedDepth: true },
    pageSize: 20,
    fetchPage: async (_limit, cursor, signal) => {
      assert.equal(signal.aborted, false);
      cursors.push(cursor);
      return cursor === null
        ? { items: [order('1'), order('2')], next_cursor: 'page-2', has_more: true }
        : { items: [order('2'), order('3')], next_cursor: 'page-3', has_more: true };
    },
    ...handlers,
  });

  assert.equal(loaded, true);
  assert.deepEqual(cursors, [null, 'page-2']);
  assert.deepEqual(calls.observed, ['1', '2', '3']);
  assert.deepEqual(calls.successes[0].items.map((item) => item.id), ['1', '2', '3']);
  assert.deepEqual(calls.starts, ['replace']);
  assert.deepEqual(calls.finishes, ['replace']);
  assert.deepEqual(calls.errors, []);
});

test('an invalidated request cannot write or clear a newer request in stale finally', async () => {
  const {
    createPaymentOrderRequestController,
    runPaymentOrderListLoad,
  } = await importLoader();
  const controller = createPaymentOrderRequestController();
  const firstPage = deferred();
  const secondPage = deferred();
  const firstCallbacks = callbacks();
  const secondCallbacks = callbacks();

  const firstRun = runPaymentOrderListLoad({
    controller,
    pageSize: 20,
    fetchPage: () => firstPage.promise,
    ...firstCallbacks.handlers,
  });
  controller.invalidateLoads();
  const secondRun = runPaymentOrderListLoad({
    controller,
    pageSize: 20,
    fetchPage: () => secondPage.promise,
    ...secondCallbacks.handlers,
  });

  firstPage.resolve({ items: [order('stale')], next_cursor: null, has_more: false });
  assert.equal(await firstRun, false);
  assert.deepEqual(firstCallbacks.calls.observed, []);
  assert.deepEqual(firstCallbacks.calls.successes, []);
  assert.deepEqual(firstCallbacks.calls.errors, []);
  assert.deepEqual(firstCallbacks.calls.finishes, [null]);
  assert.equal(
    controller.beginLoad({ append: false, replayLoadedDepth: false }, 20),
    null,
    'the stale finally must not release the second request',
  );

  secondPage.resolve({ items: [order('current')], next_cursor: null, has_more: false });
  assert.equal(await secondRun, true);
  assert.deepEqual(secondCallbacks.calls.observed, ['current']);
  assert.deepEqual(secondCallbacks.calls.finishes, ['replace']);
});

test('current failures report an error and release their own loading mode', async () => {
  const {
    createPaymentOrderRequestController,
    runPaymentOrderListLoad,
  } = await importLoader();
  const controller = createPaymentOrderRequestController();
  const expectedError = new Error('orders unavailable');
  const { calls, handlers } = callbacks();

  const loaded = await runPaymentOrderListLoad({
    controller,
    pageSize: 20,
    fetchPage: async () => { throw expectedError; },
    ...handlers,
  });

  assert.equal(loaded, false);
  assert.deepEqual(calls.errors, [expectedError]);
  assert.deepEqual(calls.finishes, ['replace']);
  assert.deepEqual(calls.observed, []);
  assert.deepEqual(calls.successes, []);
});
