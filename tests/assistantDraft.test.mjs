import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import { build } from 'esbuild';

const importAssistantDraftUtils = async () => {
  const result = await build({
    entryPoints: ['utils/assistantDraft.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const source = result.outputFiles[0].text;
  const encoded = Buffer.from(source).toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
};

test('normalizes skill group draft cards with missing skills to a render-safe empty list', async () => {
  const { normalizeAssistantDraftCard } = await importAssistantDraftUtils();

  const normalized = normalizeAssistantDraftCard({
    type: 'skill_group',
    status: 'draft_ready',
    summary: '旧技能组草稿',
    data: {
      category: '核心技能',
    },
  });

  assert.deepEqual(normalized.data.skills, []);
});

test('marks skill group draft cards with no skills as non-displayable', async () => {
  const { isAssistantDraftCardDisplayable, normalizeAssistantDraftCard } = await importAssistantDraftUtils();

  const normalized = normalizeAssistantDraftCard({
    type: 'skill_group',
    status: 'draft_ready',
    summary: '旧技能组草稿',
    data: {
      category: '核心技能',
    },
  });

  assert.equal(isAssistantDraftCardDisplayable(normalized), false);
});
