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

test('matches legacy education previews against normalized experience draft cards', async () => {
  const { isSameDraftCard } = await importAssistantSessionUtils();

  const preview = {
    type: 'education',
    status: 'draft_ready',
    data: {
      org: '某大学',
      title: '计算机科学',
      startDate: '2022-09',
      endDate: '2026-06',
      isCurrent: false,
      star: {
        s: '本科阶段',
        t: '课程学习',
        a: '数据结构',
        r: '完成核心课程',
      },
    },
  };
  const card = {
    type: 'experience',
    status: 'draft_ready',
    data: {
      category: 'education',
      org: '某大学',
      title: '计算机科学',
      startDate: '2022-09',
      endDate: '2026-06',
      isCurrent: false,
      star: {
        s: '本科阶段',
        t: '课程学习',
        a: '数据结构',
        r: '完成核心课程',
      },
    },
  };

  assert.equal(isSameDraftCard(preview, card), true);
});
