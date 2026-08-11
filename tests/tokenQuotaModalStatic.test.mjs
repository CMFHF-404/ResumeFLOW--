import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('token quota modal guards zero quota progress', () => {
  const modal = read('components/TokenQuotaModal.tsx');

  assert.match(modal, /const limit = Math\.max\(Number\(summary\?\.token_limit \?\? 0\), 0\);/);
  assert.match(modal, /const usedPercent = limit > 0\s+\? Math\.max\(0, Math\.min\(\(used \/ limit\) \* 100, 100\)\)\s+: 0;/);
});

test('token quota modal renders unlimited monthly plan state in gold', () => {
  const modal = read('components/TokenQuotaModal.tsx');

  assert.match(modal, /const isUnlimitedQuota = Boolean\(summary\?\.is_unlimited\);/);
  assert.match(modal, /formatDateTime\(summary\?\.unlimited_expires_at\)/);
  assert.match(modal, /∞/);
  assert.match(modal, /bg-gradient-to-r from-amber-500 to-yellow-300/);
  assert.match(modal, /无限额度/);
  assert.match(modal, /到期时间/);
});

test('token quota modal reports unlimited redemption without saying zero tokens', () => {
  const modal = read('components/TokenQuotaModal.tsx');

  assert.match(modal, /result\.summary\.is_unlimited/);
  assert.match(modal, /result\.summary\.unlimited_expires_at/);
  assert.match(modal, /无限额度有效至/);
});

test('token quota modal prioritizes token redemption message over existing unlimited state', () => {
  const modal = read('components/TokenQuotaModal.tsx');

  assert.match(
    modal,
    /if \(result\.tokens > 0\) \{[\s\S]*已兑换 \$\{formatTokens\(result\.tokens\)\} Tokens[\s\S]*\} else if \(result\.summary\.is_unlimited\) \{/,
  );
});

test('token quota modal renders server-owned packages and removes Taobao purchase links', () => {
  const modal = read('components/TokenQuotaModal.tsx');
  const service = read('services/billingService.ts');

  assert.match(modal, />\s*按量\s*<\/button>/);
  assert.match(modal, />\s*包月\s*<\/button>/);
  assert.match(modal, /不自动续费/);
  assert.match(modal, /paymentsEnabled/);
  assert.match(modal, /activeProducts = products\.filter\(\(product\) => product\.category === activeTab\)/);
  assert.match(modal, /activeTab === 'tokens' \? 'sm:grid-cols-2' : 'sm:grid-cols-3'/);
  assert.doesNotMatch(modal, /item\.taobao\.com/);
  assert.doesNotMatch(modal, /立即赞赏获取卡密/);
  assert.match(service, /getProducts/);
  assert.match(service, /createPaymentOrder/);
  assert.match(service, /getPaymentCheckout/);
});

test('token quota modal opens purchases as an accessible secondary page', () => {
  const modal = read('components/TokenQuotaModal.tsx');

  assert.match(modal, /type QuotaModalView = 'overview' \| 'purchase'/);
  assert.match(modal, /onOpenPurchase=\{openPurchaseView\}/);
  assert.match(modal, /aria-label="返回额度概览"/);
  assert.match(modal, /activeView === 'overview' \? \(/);
  assert.match(modal, /data-quota-view="overview"/);
  assert.match(modal, /data-quota-view="purchase"/);
  assert.match(modal, /role="tablist"/);
  assert.match(modal, /role="tab"/);
  assert.match(modal, /aria-selected=\{activeTab === 'tokens'\}/);
  assert.match(modal, /aria-selected=\{activeTab === 'unlimited'\}/);
  assert.equal((modal.match(/aria-controls="billing-plan-panel"/g) ?? []).length, 2);
  assert.match(modal, /id="billing-plan-panel"/);
  assert.match(modal, /role="tabpanel"/);
  assert.match(modal, /event\.key === 'ArrowLeft' \|\| event\.key === 'ArrowRight'/);
  assert.match(modal, /initialView\?: QuotaModalView/);
  assert.match(modal, /initialView = 'overview'/);
  assert.match(modal, /returnFocusElement\?: HTMLElement \| null/);
  assert.match(modal, /dialogRef\.current\?\.focus\(\)/);
  assert.match(modal, /visibleAvatarButton/);
  assert.match(modal, /\[data-token-quota-focus-return\]/);
  assert.match(modal, /focusTarget\?\.isConnected && focusTarget\.offsetParent !== null/);
  assert.match(modal, /if \(initialView === 'purchase' \|\| returnedPaymentOrderId\) \{\s*setActiveView\('purchase'\);/);
  assert.match(modal, /if \(!isOpen\) \{\s*setActiveView\('overview'\);/);
  assert.match(modal, /role="dialog"/);
  assert.match(modal, /aria-modal="true"/);
  assert.match(modal, /aria-labelledby="token-quota-dialog-title"/);
  assert.match(modal, /backButtonRef\.current\?\.focus\(\)/);
  assert.match(modal, /purchaseButtonRef\.current\?\.focus\(\)/);
  assert.match(modal, /event\.key === 'Escape'/);
  assert.match(modal, /event\.key !== 'Tab'/);
  assert.match(modal, /dialog\.querySelectorAll<HTMLElement>/);
  assert.doesNotMatch(modal, /收起兑换/);
  assert.doesNotMatch(modal, /isRedeemOpen/);
});

test('payment checkout submits the signed server form and returned orders sync safely', () => {
  const modal = read('components/TokenQuotaModal.tsx');
  const app = read('App.tsx');

  assert.match(modal, /crypto\.randomUUID/);
  assert.match(modal, /purchaseInFlightRef/);
  assert.match(modal, /checkoutFormRef\.current\.submit\(\)/);
  assert.match(modal, /activeView !== 'purchase'/);
  assert.match(modal, /\[activeView, checkoutForm, isOpen\]/);
  assert.match(modal, /action=\{checkoutForm\.action\}/);
  assert.match(modal, /Object\.entries\(checkoutForm\.fields\)/);
  assert.match(modal, /syncPaymentOrder\(returnedPaymentOrderId\)/);
  assert.match(modal, /attempts < 6/);
  assert.match(modal, /重新查询支付状态/);
  assert.match(modal, /setPaymentSyncRetryRequest\(\(request\) => request \+ 1\)/);
  assert.match(modal, /'creating' \| 'processing'/);
  assert.match(app, /payment_order/);
  assert.match(app, /'sign_type'/);
  assert.match(app, /setIsTokenQuotaOpen\(true\)/);
  assert.match(app, /history\.replaceState/);
});

test('usage trend chart fills its card height and reserves space for date labels', () => {
  const modal = read('components/TokenQuotaModal.tsx');

  assert.match(modal, /const axisMax = maxVal > 0 \? maxVal \* 1\.25 : 1000;/);
  assert.match(modal, /const labelBandHeight = usageByDay\.length >= 2 \? 18 : 0;/);
  assert.match(modal, /const chartBottom = height - labelBandHeight - 1;/);
  assert.match(modal, /item\.total_tokens \/ axisMax/);
  assert.match(modal, /<svg viewBox=\{`0 0 \$\{width\} \$\{height\}`\} className="h-full w-full overflow-visible"/);
});

test('token quota modal uses supported Tailwind CDN utilities', () => {
  const modal = read('components/TokenQuotaModal.tsx');
  const unsupportedUtilityClasses = [
    'border-gray-150',
    'text-gray-650',
    'dark:text-emerald-450',
    'dark:bg-gray-850',
    'dark:border-gray-850',
    'text-emerald-650',
    'dark:text-emerald-350',
    'h-4.5',
    'w-4.5',
    'h-8.5',
    'w-8.5',
    'py-0.2',
    'text-red-650',
    'scrollbar-thin',
    'scrollbar-thumb-gray-250',
  ];

  for (const utilityClass of unsupportedUtilityClasses) {
    const pattern = new RegExp(`\\b${utilityClass.replaceAll('.', '\\.')}\\b`);
    assert.doesNotMatch(modal, pattern, `${utilityClass} should not be used in TokenQuotaModal`);
  }
});
