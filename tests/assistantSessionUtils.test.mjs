import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import { build } from 'esbuild';

const importAssistantSessionUtils = async () => {
  const result = await build({
    entryPoints: ['views/AIAssistant/sessionUtils.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const source = result.outputFiles[0].text;
  const encoded = Buffer.from(source).toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
};

test('rejects assistant session list responses that are not arrays', async () => {
  const { assertAssistantSessionListResponse } = await importAssistantSessionUtils();

  assert.throws(
    () => assertAssistantSessionListResponse({ sessions: [] }),
    /Assistant session list response must be an array/
  );
});

test('rejects assistant session details whose messages are not arrays', async () => {
  const { assertAssistantSessionDetailResponse } = await importAssistantSessionUtils();

  assert.throws(
    () => assertAssistantSessionDetailResponse({
      session: {
        id: 'session-1',
        user_id: 'user-1',
        title: 'AI 助理',
        mode: 'general',
        entry_source: 'direct',
        latest_preview: {},
        context_json: {},
        created_at: '2026-06-03T00:00:00Z',
        updated_at: '2026-06-03T00:00:00Z',
      },
      messages: { items: [] },
    }),
    /Assistant session detail messages must be an array/
  );
});
