import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const rootDir = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));

const importAiThought = async () => {
  const result = await build({
    entryPoints: ['utils/aiThought.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const source = result.outputFiles[0].text;
  const encoded = Buffer.from(source).toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
};

test('thought display resolver separates model thoughts from transient status', async () => {
  const { resolveThoughtDisplayEvent } = await importAiThought();

  assert.deepEqual(
    resolveThoughtDisplayEvent({ type: 'thought', summary: '**匹配岗位证据**\n继续分析项目经历' }),
    { kind: 'model_thought', text: '匹配岗位证据', persist: true },
  );
  assert.deepEqual(
    resolveThoughtDisplayEvent({
      type: 'thought_status',
      status: 'fallback',
      summary: '实时思考流不可用，正在切换为标准生成',
    }),
    { kind: 'status', text: '实时思考流不可用，正在切换为标准生成', persist: false },
  );
  assert.equal(
    resolveThoughtDisplayEvent({ type: 'progress', node: 'request_ai', title: 'AI 正在思考中...' }),
    null,
    'progress should be ignored unless the caller opts into status display',
  );
  assert.deepEqual(
    resolveThoughtDisplayEvent(
      { type: 'progress', node: 'request_ai', title: 'AI 正在思考中...' },
      { includeProgress: true },
    ),
    { kind: 'status', text: 'AI 正在思考中...', persist: false },
  );
  assert.deepEqual(
    resolveThoughtDisplayEvent(
      { type: 'progress', node: 'request_ai', title: 'Requesting AI' },
      {
        includeProgress: true,
        progressTitleByNode: { request_ai: 'AI 正在思考中...' },
      },
    ),
    { kind: 'status', text: 'AI 正在思考中...', persist: false },
    'caller-owned progress labels should win over raw event titles',
  );
  assert.deepEqual(resolveThoughtDisplayEvent({ type: 'thought_reset' }), { kind: 'reset' });
  assert.equal(resolveThoughtDisplayEvent({ type: 'final', result: {} }), null);
});

test('thought display appender normalizes, deduplicates, and clamps text', async () => {
  const { appendThoughtDisplayText } = await importAiThought();

  assert.equal(
    appendThoughtDisplayText('正在分析上下文\n匹配经历证据', '  匹配经历证据  '),
    '正在分析上下文\n匹配经历证据',
    'default append should avoid repeating the latest line',
  );
  assert.equal(
    appendThoughtDisplayText('分析岗位职责 / 提取项目经历', '分析岗位职责', {
      separator: ' / ',
      dedupeStrategy: 'all',
    }),
    '提取项目经历 / 分析岗位职责',
    'JD-style append should move an existing summary to the latest position',
  );

  const clamped = appendThoughtDisplayText(
    '分析岗位职责与关键能力 / 提取项目经历中的技术证据 / 对齐用户研究和产品设计能力',
    '展现独立执行和技术理解能力',
    {
      separator: ' / ',
      dedupeStrategy: 'all',
      maxLength: 48,
    },
  );
  assert.ok(clamped.length <= 48);
  assert.match(clamped, /展现独立执行和技术理解能力$/);
  assert.doesNotMatch(clamped, /^分析岗位职责与关键能力/);
});

test('thought status event type includes backend hidden status', () => {
  const source = readFileSync(join(rootDir, 'services/aiService.ts'), 'utf8');

  assert.match(
    source,
    /status\?: 'fallback' \| 'hidden';/,
    'frontend event contract should include the Gemini hidden-thought status emitted by the backend',
  );
});
