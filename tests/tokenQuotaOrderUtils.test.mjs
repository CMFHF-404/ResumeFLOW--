import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

const importTypeScriptModule = async (path) => {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
};

test('order pages append uniquely while preserving cursor order', async () => {
  const { appendPaymentOrderPage } = await importTypeScriptModule('components/tokenQuotaOrderUtils.ts');
  const current = [
    { id: 'order-3', status: 'pending' },
    { id: 'order-2', status: 'pending' },
  ];
  const page = [
    { id: 'order-2', status: 'fulfilled' },
    { id: 'order-1', status: 'cancelled' },
  ];

  const merged = appendPaymentOrderPage(current, page);

  assert.deepEqual(merged, [
    { id: 'order-3', status: 'pending' },
    { id: 'order-2', status: 'pending' },
    { id: 'order-1', status: 'cancelled' },
  ]);
  assert.equal(new Set(merged.map((order) => order.id)).size, merged.length);
});

test('periodic refresh replays the loaded page depth from a fresh first-page cursor', async () => {
  const { appendPaymentOrderPage, getOrderRefreshPageDepth } = await importTypeScriptModule('components/tokenQuotaOrderUtils.ts');
  const pageSize = 20;
  const loadedBeforeRefresh = Array.from({ length: 40 }, (_, index) => ({ id: `old-${100 - index}` }));
  assert.equal(getOrderRefreshPageDepth(loadedBeforeRefresh.length, pageSize), 2);

  const freshFirstPage = Array.from({ length: 20 }, (_, index) => ({ id: `new-${121 - index}` }));
  const freshSecondPage = [
    { id: 'new-101' },
    ...Array.from({ length: 19 }, (_, index) => ({ id: `old-${100 - index}` })),
  ];
  const replayed = appendPaymentOrderPage(freshFirstPage, freshSecondPage);

  assert.equal(replayed.length, 40);
  assert.equal(replayed[20].id, 'new-101');
  assert.equal(replayed.some((order) => order.id === 'old-61'), false);
});

test('invalid or empty loaded counts still refresh one page', async () => {
  const { getOrderRefreshPageDepth } = await importTypeScriptModule('components/tokenQuotaOrderUtils.ts');

  assert.equal(getOrderRefreshPageDepth(0, 20), 1);
  assert.equal(getOrderRefreshPageDepth(Number.NaN, 20), 1);
  assert.equal(getOrderRefreshPageDepth(20, 0), 1);
});

test('purchase context starts independently and reconciles after a successful order refresh', async () => {
  const { coordinatePaymentOrdersAndContextRefresh } = await importTypeScriptModule('components/tokenQuotaOrderUtils.ts');
  let resolveOrders;
  let resolveInitialContext;
  let orderCalls = 0;
  let contextCalls = 0;

  const run = coordinatePaymentOrdersAndContextRefresh(
    () => {
      orderCalls += 1;
      return new Promise((resolve) => { resolveOrders = resolve; });
    },
    () => {
      contextCalls += 1;
      if (contextCalls === 1) {
        return new Promise((resolve) => { resolveInitialContext = resolve; });
      }
      return Promise.resolve();
    },
  );

  assert.equal(orderCalls, 1);
  assert.equal(contextCalls, 1);
  resolveOrders(true);
  await Promise.resolve();
  assert.equal(contextCalls, 1);
  resolveInitialContext();
  await run;
  assert.equal(contextCalls, 2);
});

test('failed order history does not suppress or duplicate the independent purchase context', async () => {
  const { coordinatePaymentOrdersAndContextRefresh } = await importTypeScriptModule('components/tokenQuotaOrderUtils.ts');
  let contextCalls = 0;

  await coordinatePaymentOrdersAndContextRefresh(
    async () => false,
    async () => { contextCalls += 1; },
  );

  assert.equal(contextCalls, 1);
});

test('invalidated payment refresh does not start the final context reconciliation', async () => {
  const { coordinatePaymentOrdersAndContextRefresh } = await importTypeScriptModule('components/tokenQuotaOrderUtils.ts');
  let resolveOrders;
  let resolveInitialContext;
  let contextCalls = 0;
  let isCurrent = true;

  const run = coordinatePaymentOrdersAndContextRefresh(
    () => new Promise((resolve) => { resolveOrders = resolve; }),
    () => {
      contextCalls += 1;
      if (contextCalls === 1) {
        return new Promise((resolve) => { resolveInitialContext = resolve; });
      }
      return Promise.resolve();
    },
    () => isCurrent,
  );

  resolveOrders(true);
  await Promise.resolve();
  isCurrent = false;
  resolveInitialContext();
  await run;

  assert.equal(contextCalls, 1);
});

test('unsettled payment conflicts expose only supported 409 detail codes and their order id', async () => {
  const { resolveUnsettledPaymentOrderConflict, paymentOrderConflictMessage } = await importTypeScriptModule('components/tokenQuotaOrderUtils.ts');

  assert.deepEqual(resolveUnsettledPaymentOrderConflict({
    response: {
      status: 409,
      data: { detail: { code: 'payment_order_unsettled', order_id: 'order-1' } },
    },
  }), { code: 'payment_order_unsettled', orderId: 'order-1', latestOrder: null });
  assert.deepEqual(resolveUnsettledPaymentOrderConflict({
    response: {
      status: 409,
      data: { detail: { code: 'payment_order_reconciliation_required', order_id: 'order-2' } },
    },
  }), { code: 'payment_order_reconciliation_required', orderId: 'order-2', latestOrder: null });
  assert.deepEqual(resolveUnsettledPaymentOrderConflict({
    response: {
      status: 409,
      data: { detail: { code: 'payment_order_catalog_changed', order_id: 'order-3' } },
    },
  }), { code: 'payment_order_catalog_changed', orderId: 'order-3', latestOrder: null });
  assert.deepEqual(resolveUnsettledPaymentOrderConflict({
    response: {
      status: 409,
      data: { detail: { code: 'payment_order_not_payable', order_id: 'order-4' } },
    },
  }), { code: 'payment_order_not_payable', orderId: 'order-4', latestOrder: null });
  assert.deepEqual(resolveUnsettledPaymentOrderConflict({
    response: {
      status: 409,
      data: { detail: { code: 'payment_order_state_changed', latest_order: { id: 'order-5' } } },
    },
  }), { code: 'payment_order_state_changed', orderId: 'order-5', latestOrder: { id: 'order-5' } });
  assert.deepEqual(resolveUnsettledPaymentOrderConflict({
    response: {
      status: 409,
      data: { detail: { code: 'payment_catalog_changed', catalog_version: 'catalog-v2' } },
    },
  }), { code: 'payment_catalog_changed', orderId: null, latestOrder: null });

  assert.equal(paymentOrderConflictMessage({ code: 'payment_order_unsettled', orderId: null }), '已有未结算订单，请先继续或查询。');
  assert.equal(paymentOrderConflictMessage({ code: 'payment_order_reconciliation_required', orderId: null }), '订单需要人工对账，请联系支持后再继续购买。');
  assert.equal(paymentOrderConflictMessage({ code: 'payment_order_catalog_changed', orderId: null }), '套餐信息已更新，请联系客服确认原订单。');
  assert.match(paymentOrderConflictMessage({ code: 'payment_order_not_payable', orderId: null }), /无法继续/);
  assert.match(paymentOrderConflictMessage({ code: 'payment_order_state_changed', orderId: null }), /再次点击购买/);
  assert.match(paymentOrderConflictMessage({ code: 'payment_catalog_changed', orderId: null }), /套餐价格\/权益已更新/);
});

test('unsettled payment conflict resolver ignores unrelated errors and missing order ids', async () => {
  const { resolveUnsettledPaymentOrderConflict } = await importTypeScriptModule('components/tokenQuotaOrderUtils.ts');

  assert.equal(resolveUnsettledPaymentOrderConflict({
    response: { status: 400, data: { detail: { code: 'payment_order_unsettled' } } },
  }), null);
  assert.equal(resolveUnsettledPaymentOrderConflict({
    response: { status: 409, data: { detail: { code: 'idempotency_key_conflict' } } },
  }), null);
  assert.deepEqual(resolveUnsettledPaymentOrderConflict({
    response: { status: 409, data: { detail: { code: 'payment_order_unsettled', order_id: '  ' } } },
  }), { code: 'payment_order_unsettled', orderId: null, latestOrder: null });
});

test('payment order creation rate limits expose only the supported 429 message', async () => {
  const { paymentOrderCreationRateLimitMessage } = await importTypeScriptModule('components/tokenQuotaOrderUtils.ts');

  assert.equal(paymentOrderCreationRateLimitMessage({
    response: {
      status: 429,
      data: {
        detail: {
          code: 'payment_order_rate_limited',
          message: ' 请一小时后再试。 ',
        },
      },
    },
  }), '请一小时后再试。');
  assert.equal(paymentOrderCreationRateLimitMessage({
    response: {
      status: 429,
      data: { detail: { code: 'payment_order_rate_limited' } },
    },
  }), '短时间内取消或超时的支付订单过多，请一小时后再试。');
  assert.equal(paymentOrderCreationRateLimitMessage({
    response: {
      status: 409,
      data: { detail: { code: 'payment_order_rate_limited' } },
    },
  }), null);
  assert.equal(paymentOrderCreationRateLimitMessage({
    response: {
      status: 429,
      data: { detail: { code: 'unrelated_rate_limit' } },
    },
  }), null);
});

test('paid purchase context requires a deliberate second click for the same token', async () => {
  const { requiresRepeatPurchaseAcknowledgement } = await importTypeScriptModule('components/tokenQuotaOrderUtils.ts');

  assert.equal(requiresRepeatPurchaseAcknowledgement('token-a', null, null), false);
  assert.equal(requiresRepeatPurchaseAcknowledgement('token-a', { status: 'pending' }, null), false);
  assert.equal(requiresRepeatPurchaseAcknowledgement('token-a', { status: 'paid' }, null), true);
  assert.equal(requiresRepeatPurchaseAcknowledgement('token-a', { status: 'fulfilled' }, 'token-b'), true);
  assert.equal(requiresRepeatPurchaseAcknowledgement('token-a', { status: 'fulfilled' }, 'token-a'), false);
});

test('purchase retries reuse one idempotency key per SKU until the attempt is cleared', async () => {
  const { getOrCreatePurchaseIdempotencyKey } = await importTypeScriptModule('components/tokenQuotaOrderUtils.ts');
  const keysBySku = new Map();
  let sequence = 0;
  const createKey = () => `key-${++sequence}`;

  assert.equal(getOrCreatePurchaseIdempotencyKey(keysBySku, 'tokens_100k', createKey), 'key-1');
  assert.equal(getOrCreatePurchaseIdempotencyKey(keysBySku, 'tokens_100k', createKey), 'key-1');
  assert.equal(getOrCreatePurchaseIdempotencyKey(keysBySku, 'tokens_500k', createKey), 'key-2');
  assert.equal(sequence, 2);

  keysBySku.delete('tokens_100k');
  assert.equal(getOrCreatePurchaseIdempotencyKey(keysBySku, 'tokens_100k', createKey), 'key-3');
});

test('any matching terminal order clears an active purchase attempt', async () => {
  const { clearMatchingTerminalPurchaseAttempt } = await importTypeScriptModule('components/tokenQuotaOrderUtils.ts');
  const keysBySku = new Map([['tokens_100k', 'active-key']]);
  const orderIdsBySku = new Map([['tokens_100k', 'pending-a']]);

  assert.equal(clearMatchingTerminalPurchaseAttempt(keysBySku, orderIdsBySku, {
    id: 'cancelled-b',
    sku: 'tokens_100k',
    status: 'cancelled',
  }), false);
  assert.equal(keysBySku.get('tokens_100k'), 'active-key');
  assert.equal(orderIdsBySku.get('tokens_100k'), 'pending-a');

  assert.equal(clearMatchingTerminalPurchaseAttempt(keysBySku, orderIdsBySku, {
    id: 'pending-a',
    sku: 'tokens_100k',
    status: 'cancelled',
  }), true);
  assert.equal(keysBySku.has('tokens_100k'), false);
  assert.equal(orderIdsBySku.has('tokens_100k'), false);

  keysBySku.set('tokens_100k', 'expired-key');
  orderIdsBySku.set('tokens_100k', 'expired-order');
  assert.equal(clearMatchingTerminalPurchaseAttempt(keysBySku, orderIdsBySku, {
    id: 'expired-order',
    sku: 'tokens_100k',
    status: 'expired',
  }), true);
  assert.equal(keysBySku.has('tokens_100k'), false);
  assert.equal(orderIdsBySku.has('tokens_100k'), false);

  keysBySku.set('tokens_100k', 'fulfilled-key');
  orderIdsBySku.set('tokens_100k', 'fulfilled-order');
  assert.equal(clearMatchingTerminalPurchaseAttempt(keysBySku, orderIdsBySku, {
    id: 'fulfilled-order',
    sku: 'tokens_100k',
    status: 'fulfilled',
  }), true);
  assert.equal(keysBySku.has('tokens_100k'), false);
  assert.equal(orderIdsBySku.has('tokens_100k'), false);

  keysBySku.set('tokens_100k', 'failed-key');
  orderIdsBySku.set('tokens_100k', 'failed-order');
  assert.equal(clearMatchingTerminalPurchaseAttempt(keysBySku, orderIdsBySku, {
    id: 'failed-order',
    sku: 'tokens_100k',
    status: 'failed',
  }), true);
});
