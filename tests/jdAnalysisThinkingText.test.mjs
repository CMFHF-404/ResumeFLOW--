import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import { build } from 'esbuild';

const importJDThinkingText = async () => {
  const result = await build({
    entryPoints: ['hooks/jdAnalysisThinkingText.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const source = result.outputFiles[0].text;
  const encoded = Buffer.from(source).toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
};

test('JD analysis thinking text accumulates recent thought summaries', async () => {
  const { appendJDThinkingText } = await importJDThinkingText();

  const first = appendJDThinkingText('', '展现独立执行和技术理解能力');
  const second = appendJDThinkingText(first, '结合 WEBGIS 平台经历评估岗位匹配');

  assert.equal(
    second,
    '展现独立执行和技术理解能力 / 结合 WEBGIS 平台经历评估岗位匹配'
  );
  assert.equal(
    appendJDThinkingText(second, '结合 WEBGIS 平台经历评估岗位匹配'),
    second,
    'repeated summaries should not consume visible width'
  );
});

test('JD analysis thinking text keeps the latest useful stream when it gets long', async () => {
  const { appendJDThinkingText, JD_THINKING_TEXT_MAX_LENGTH } = await importJDThinkingText();

  const current = [
    '分析岗位职责与关键能力',
    '提取项目经历中的技术证据',
    '对齐用户研究和产品设计能力',
    '检查教育背景与岗位硬性要求',
    '识别可迁移的业务场景',
    '校验量化结果和项目边界',
  ].join(' / ');
  const next = appendJDThinkingText(current, '展现独立执行和技术理解能力');

  assert.ok(next.length <= JD_THINKING_TEXT_MAX_LENGTH);
  assert.match(next, /展现独立执行和技术理解能力$/);
  assert.doesNotMatch(next, /^分析岗位职责与关键能力/);
});
