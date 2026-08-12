import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

const importBillingService = async (harness) => {
  const source = readFileSync(new URL('../services/billingService.ts', import.meta.url), 'utf8');
  const injectedSource = source.replace(
    "import apiClient, { getAuthCacheKey } from './apiClient';",
    'const { apiClient, getAuthCacheKey } = globalThis.__billingServiceCacheTestHarness;',
  );
  assert.notEqual(injectedSource, source);
  const { outputText } = ts.transpileModule(injectedSource, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  });
  globalThis.__billingServiceCacheTestHarness = harness;
  try {
    const moduleUrl = `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}#${Date.now()}-${Math.random()}`;
    return (await import(moduleUrl)).billingService;
  } finally {
    delete globalThis.__billingServiceCacheTestHarness;
  }
};

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

test('late summary responses cannot refill cleared cache or overwrite a newer force refresh', async () => {
  const pendingSummaryRequests = [];
  let ownerKey = 'owner-a';
  const apiClient = {
    get: (url) => {
      assert.equal(url, '/api/billing/summary');
      return new Promise((resolve) => { pendingSummaryRequests.push(resolve); });
    },
    post: async () => { throw new Error('unexpected POST'); },
  };
  const billingService = await importBillingService({
    apiClient,
    getAuthCacheKey: async () => ownerKey,
  });

  const staleAfterClear = billingService.getSummary({ force: true });
  await nextTurn();
  assert.equal(pendingSummaryRequests.length, 1);
  billingService.clearBillingCache();
  const freshAfterClear = billingService.getSummary({ force: true });
  await nextTurn();
  assert.equal(pendingSummaryRequests.length, 2);

  pendingSummaryRequests[1]({ data: { user_id: 'owner-a', remaining_tokens: 200 } });
  assert.equal((await freshAfterClear).remaining_tokens, 200);
  pendingSummaryRequests[0]({ data: { user_id: 'owner-a', remaining_tokens: 100 } });
  assert.equal((await staleAfterClear).remaining_tokens, 100);
  assert.equal((await billingService.getSummary()).remaining_tokens, 200);
  assert.equal(pendingSummaryRequests.length, 2);

  const olderForceRefresh = billingService.getSummary({ force: true });
  await nextTurn();
  const newerForceRefresh = billingService.getSummary({ force: true });
  await nextTurn();
  assert.equal(pendingSummaryRequests.length, 4);

  pendingSummaryRequests[3]({ data: { user_id: 'owner-a', remaining_tokens: 400 } });
  assert.equal((await newerForceRefresh).remaining_tokens, 400);
  pendingSummaryRequests[2]({ data: { user_id: 'owner-a', remaining_tokens: 300 } });
  assert.equal((await olderForceRefresh).remaining_tokens, 300);
  assert.equal((await billingService.getSummary()).remaining_tokens, 400);
  assert.equal(pendingSummaryRequests.length, 4);

  const previousOwnerRefresh = billingService.getSummary({ force: true });
  await nextTurn();
  ownerKey = 'owner-b';
  const currentOwnerRefresh = billingService.getSummary({ force: true });
  await nextTurn();
  assert.equal(pendingSummaryRequests.length, 6);

  pendingSummaryRequests[5]({ data: { user_id: 'owner-b', remaining_tokens: 600 } });
  assert.equal((await currentOwnerRefresh).remaining_tokens, 600);
  pendingSummaryRequests[4]({ data: { user_id: 'owner-a', remaining_tokens: 500 } });
  assert.equal((await previousOwnerRefresh).remaining_tokens, 500);
  assert.equal((await billingService.getSummary()).user_id, 'owner-b');
  assert.equal(pendingSummaryRequests.length, 6);
});

test('redemption rejects an owner change and cannot poison the new owner cache', async () => {
  let ownerKey = 'owner-a';
  let redemptionConfig;
  let resolveRedemption;
  let summaryGets = 0;
  const apiClient = {
    post: (url, body, config) => {
      assert.equal(url, '/api/billing/redemptions');
      assert.deepEqual(body, { code: 'RF-TEST' });
      redemptionConfig = config;
      return new Promise((resolve) => { resolveRedemption = resolve; });
    },
    get: async (url) => {
      assert.equal(url, '/api/billing/summary');
      summaryGets += 1;
      return { data: { user_id: ownerKey, remaining_tokens: 900 } };
    },
  };
  const billingService = await importBillingService({
    apiClient,
    getAuthCacheKey: async () => ownerKey,
  });
  const controller = new AbortController();
  const redemption = billingService.redeemCode('RF-TEST', { signal: controller.signal });
  await nextTurn();

  assert.equal(redemptionConfig.expectedAuthCacheKey, 'owner-a');
  assert.equal(redemptionConfig.signal, controller.signal);
  assert.equal(redemptionConfig.timeout, 15_000);
  ownerKey = 'owner-b';
  resolveRedemption({
    data: {
      tokens: 100,
      package_name: 'old owner package',
      summary: { user_id: 'owner-a', remaining_tokens: 100 },
    },
  });

  await assert.rejects(redemption, /Authentication context changed during redemption/);
  assert.equal((await billingService.getSummary()).user_id, 'owner-b');
  assert.equal(summaryGets, 1);
});
