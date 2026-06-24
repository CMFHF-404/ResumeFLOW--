import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('token quota modal guards zero quota progress', () => {
  const modal = read('components/TokenQuotaModal.tsx');

  assert.match(modal, /const limit = Math\.max\(Number\(summary\?\.token_limit \?\? 0\), 0\);/);
  assert.match(modal, /const usedPercent = limit > 0\s+\? Math\.max\(0, Math\.min\(\(used \/ limit\) \* 100, 100\)\)\s+: 0;/);
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
