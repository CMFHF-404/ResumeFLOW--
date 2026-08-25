import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';

const importQuotaDisplay = async () => {
  const result = await build({
    entryPoints: ['utils/quotaDisplay.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const encoded = Buffer.from(result.outputFiles[0].text).toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
};

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('quota token formatting preserves the existing display thresholds', async () => {
  const { formatTokenAmount } = await importQuotaDisplay();

  assert.equal(formatTokenAmount(), '0');
  assert.equal(formatTokenAmount(-1), '0');
  assert.equal(formatTokenAmount(999), '999');
  assert.equal(formatTokenAmount(1_000), '1k');
  assert.equal(formatTokenAmount(1_050), '1.1k');
  assert.equal(formatTokenAmount(1_000_000), '1M');
  assert.equal(formatTokenAmount(1_250_000), '1.3M');
});

test('quota date formatting preserves empty invalid and locale-aware output', async () => {
  const { formatDateTime } = await importQuotaDisplay();

  assert.equal(formatDateTime(), '--');
  assert.equal(formatDateTime('not-a-date'), '--');

  const value = '2026-06-24T08:41:00.000Z';
  const date = new Date(value);
  const expected = `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  assert.equal(formatDateTime(value), expected);
});

test('quota surfaces share the display authority instead of defining local copies', () => {
  const sidebar = read('components/GlobalSidebar.tsx');
  const modal = read('components/TokenQuotaModal.tsx');

  assert.match(sidebar, /from ['"]\.\.\/utils\/quotaDisplay['"]/);
  assert.match(modal, /from ['"]\.\.\/utils\/quotaDisplay['"]/);
  assert.doesNotMatch(sidebar, /const\s+format(?:TokenAmount|DateTime)\s*=/);
  assert.doesNotMatch(modal, /const\s+format(?:Tokens|DateTime)\s*=/);
});
