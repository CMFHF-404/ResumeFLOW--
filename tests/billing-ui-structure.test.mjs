import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('GlobalSidebar exposes token quota ring and quota menu entry', () => {
  const sidebar = read('components/GlobalSidebar.tsx');
  const app = read('App.tsx');

  assert.match(sidebar, /quotaSummary/);
  assert.match(sidebar, /onOpenTokenQuota/);
  assert.match(sidebar, /TokenQuotaSummary/);
  assert.match(sidebar, /额度/);
  assert.match(sidebar, /strokeDasharray/);
  assert.match(sidebar, /剩余/);

  assert.match(app, /TokenQuotaModal/);
  assert.match(app, /isTokenQuotaOpen/);
  assert.match(app, /billingService/);
  assert.match(app, /handleOpenTokenQuota/);
});

test('TokenQuotaModal renders summary, charts, usage detail, and redemption actions', () => {
  const modal = read('components/TokenQuotaModal.tsx');

  assert.match(modal, /TokenQuotaModal/);
  assert.match(modal, /usageByDay/);
  assert.match(modal, /usageByEntrypoint/);
  assert.match(modal, /redeemCode/);
  assert.match(modal, /svg/);
  assert.match(modal, /用量明细/);
  assert.match(modal, /兑换卡密/);
  assert.match(modal, /购买额度/);
  assert.doesNotMatch(modal, /立即购买/);
  assert.doesNotMatch(modal, /createPlaceholderPurchase/);
});

test('TokenQuotaModal keeps the usage analysis title on one line and hides chart tabs on desktop', () => {
  const modal = read('components/TokenQuotaModal.tsx');

  assert.match(modal, /<h3 className="[^"]*\bshrink-0\b[^"]*\bwhitespace-nowrap\b[^"]*">用量分析<\/h3>/);
  assert.match(modal, /<span className="[^"]*\bshrink-0\b[^"]*\bwhitespace-nowrap\b[^"]*\bmd:hidden\b[^"]*">用量分析<\/span>/);
  assert.match(modal, /<div className="[^"]*\binline-flex\b[^"]*\bmd:hidden\b[^"]*">/);
});

test('billingService uses the backend billing API surface and refreshes after redemption', () => {
  const service = read('services/billingService.ts');

  assert.match(service, /\/api\/billing\/summary/);
  assert.match(service, /\/api\/billing\/usage/);
  assert.match(service, /\/api\/billing\/redemptions/);
  assert.match(service, /redeemCode/);
  assert.doesNotMatch(service, /\/api\/billing\/purchases\/options/);
  assert.doesNotMatch(service, /\/api\/billing\/purchases/);
  assert.doesNotMatch(service, /createPlaceholderPurchase/);
  assert.match(service, /clearBillingCache/);
  assert.match(service, /TokenQuotaSummary/);
});

test('ProfileTab shows read-only token usage and opens the shared quota modal', () => {
  const profileTab = read('views/ResumeEditor/components/ProfileTab.tsx');
  const editorDesktop = read('views/ResumeEditor/components/ResumeEditorDesktopWorkspace.tsx');

  assert.match(profileTab, /quotaSummary/);
  assert.match(profileTab, /onOpenTokenQuota/);
  assert.match(profileTab, /剩余额度/);
  assert.match(profileTab, /当前用量/);
  assert.match(profileTab, /查看额度/);

  assert.match(editorDesktop, /quotaSummary/);
  assert.match(editorDesktop, /onOpenTokenQuota/);
});
