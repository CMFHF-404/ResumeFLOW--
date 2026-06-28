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
