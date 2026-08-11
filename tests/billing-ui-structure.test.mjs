import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('GlobalSidebar exposes token quota ring and quota menu entry', () => {
  const sidebar = read('components/GlobalSidebar.tsx');
  const app = read('App.tsx');

  assert.match(sidebar, /quotaSummary/);
  assert.match(sidebar, /onOpenTokenQuota/);
  assert.match(sidebar, /onOpenTokenPurchase/);
  assert.match(sidebar, /购买套餐/);
  assert.match(sidebar, /CreditCard/);
  assert.equal((sidebar.match(/data-token-quota-focus-return/g) ?? []).length, 2);
  assert.match(sidebar, /TokenQuotaSummary/);
  assert.match(sidebar, /isUnlimitedQuota/);
  assert.match(sidebar, /unlimited_expires_at/);
  assert.match(sidebar, /额度/);
  assert.match(sidebar, /strokeDasharray/);
  assert.match(sidebar, /剩余/);
  assert.match(sidebar, /text-amber-300/);
  assert.match(sidebar, /TOKEN_RING_CIRCUMFERENCE/);

  assert.match(app, /TokenQuotaModal/);
  assert.match(app, /isTokenQuotaOpen/);
  assert.match(app, /billingService/);
  assert.match(app, /handleOpenTokenQuota/);
  assert.match(app, /handleOpenTokenPurchase/);
  assert.match(app, /initialView=\{tokenQuotaInitialView\}/);
  assert.match(app, /returnFocusElement=\{tokenQuotaReturnFocusElement\}/);
  assert.match(app, /onOpenPurchase=\{\(\) => handleOpenTokenPurchase\(\)\}/);
  assert.doesNotMatch(sidebar, /赞赏作者|HeartHandshake|onOpenAppreciation/);
  assert.doesNotMatch(app, /AppreciationModal|isAppreciationOpen|handleOpenAppreciation/);
});

test('TokenQuotaModal renders summary, charts, usage detail, payment, and redemption actions', () => {
  const modal = read('components/TokenQuotaModal.tsx');

  assert.match(modal, /TokenQuotaModal/);
  assert.match(modal, /usageByDay/);
  assert.match(modal, /usageByEntrypoint/);
  assert.match(modal, /redeemCode/);
  assert.match(modal, /svg/);
  assert.match(modal, /isUnlimitedQuota/);
  assert.match(modal, /unlimited_expires_at/);
  assert.match(modal, /∞/);
  assert.match(modal, /金色/);
  assert.match(modal, /用量明细/);
  assert.match(modal, /兑换卡密/);
  assert.match(modal, /购买额度/);
  assert.match(modal, /PurchaseCatalog/);
  assert.match(modal, /不自动续费/);
  assert.match(modal, /paymentsEnabled/);
  assert.doesNotMatch(modal, /createPlaceholderPurchase/);
  assert.doesNotMatch(modal, /item\.taobao\.com/);
});

test('TokenQuotaModal keeps the usage analysis title on one line and hides chart tabs on desktop', () => {
  const modal = read('components/TokenQuotaModal.tsx');

  assert.match(modal, /<h3 className="[^"]*\bshrink-0\b[^"]*\bwhitespace-nowrap\b[^"]*">用量分析<\/h3>/);
  assert.match(modal, /<span className="[^"]*\bshrink-0\b[^"]*\bwhitespace-nowrap\b[^"]*\bmd:hidden\b[^"]*">用量分析<\/span>/);
  assert.match(modal, /<div className="[^"]*\binline-flex\b[^"]*\bmd:hidden\b[^"]*">/);
});

test('billingService uses the billing, redemption, and Yifut payment API surface', () => {
  const service = read('services/billingService.ts');

  assert.match(service, /\/api\/billing\/summary/);
  assert.match(service, /\/api\/billing\/usage/);
  assert.match(service, /\/api\/billing\/redemptions/);
  assert.match(service, /\/api\/billing\/products/);
  assert.match(service, /\/api\/billing\/payment-orders/);
  assert.match(service, /Idempotency-Key/);
  assert.match(service, /getPaymentCheckout/);
  assert.match(service, /syncPaymentOrder/);
  assert.match(service, /payments_enabled: boolean/);
  assert.match(service, /amount_fen: number/);
  assert.match(service, /redeemCode/);
  assert.match(service, /is_unlimited: boolean/);
  assert.match(service, /unlimited_expires_at\?: string \| null/);
  assert.match(service, /unlimited_plan_name\?: string \| null/);
  assert.doesNotMatch(service, /\/api\/billing\/purchases\/options/);
  assert.doesNotMatch(service, /createPlaceholderPurchase/);
  assert.match(service, /clearBillingCache/);
  assert.match(service, /TokenQuotaSummary/);
});

test('ProfileTab omits token quota details and keeps the shared quota entry in GlobalSidebar', () => {
  const profileTab = read('views/ResumeEditor/components/ProfileTab.tsx');
  const editorDesktop = read('views/ResumeEditor/components/ResumeEditorDesktopWorkspace.tsx');

  assert.doesNotMatch(profileTab, /quotaSummary/);
  assert.doesNotMatch(profileTab, /onOpenTokenQuota/);
  assert.doesNotMatch(profileTab, /AI 额度/);
  assert.doesNotMatch(profileTab, /剩余额度/);
  assert.doesNotMatch(profileTab, /当前用量/);
  assert.doesNotMatch(profileTab, /查看额度/);

  assert.doesNotMatch(editorDesktop, /quotaSummary/);
  assert.doesNotMatch(editorDesktop, /onOpenTokenQuota/);
});
