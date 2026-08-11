import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('all AI HTTP 402 transports dispatch the shared quota purchase prompt', () => {
  const apiClient = read('services/apiClient.ts');
  const aiStream = read('services/aiStreamUtils.ts');
  const parser = read('services/parserService.ts');
  const promptService = read('services/quotaPurchasePrompt.ts');

  assert.match(apiClient, /error\.response\?\.status === 402/);
  assert.match(apiClient, /dispatchQuotaPurchaseRequired\(readQuotaPurchaseMessage\(error\.response\.data\)\)/);
  assert.match(aiStream, /response\.status === 402[\s\S]*dispatchQuotaPurchaseRequired\(quotaMessage\)/);
  assert.match(parser, /response\.status === 402[\s\S]*dispatchQuotaPurchaseRequired\(quotaMessage\)/);
  assert.match(promptService, /app:quota-purchase-required/);
  assert.match(promptService, /DEFAULT_QUOTA_PURCHASE_MESSAGE/);
});

test('App turns the shared quota event into a keyboard-accessible purchase action', () => {
  const app = read('App.tsx');
  const prompt = read('components/QuotaPurchasePrompt.tsx');

  assert.match(app, /subscribeQuotaPurchaseRequired/);
  assert.match(app, /quotaPurchasePromptMessage && !isTokenQuotaOpen/);
  assert.match(app, /onOpenPurchase=\{\(\) => handleOpenTokenPurchase\(\)\}/);
  assert.match(app, /setIsTokenQuotaOpen\(true\)/);
  assert.match(prompt, /role="alert"/);
  assert.match(prompt, /aria-live="assertive"/);
  assert.match(prompt, /<button[\s\S]*onClick=\{onOpenPurchase\}[\s\S]*购买套餐[\s\S]*<\/button>/);
  assert.match(prompt, /aria-label="关闭额度不足提示"/);
});
