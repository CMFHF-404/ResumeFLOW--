import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';

const importSerialization = async () => {
  const result = await build({
    entryPoints: ['services/experienceDraftSerialization.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const encoded = Buffer.from(result.outputFiles[0].text).toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
};

test('experience draft card projection preserves persisted fields and nested STAR data', async () => {
  const { projectExperienceDraftCardData } = await importSerialization();
  const star = {
    s: '情境',
    t: '任务',
    a: '行动',
    r: '结果',
    internalScore: 99,
  };

  const result = projectExperienceDraftCardData({
    org: '原子简历',
    title: '产品经理',
    start_date: '2025-01',
    end_date: '2026-07',
    star,
    editMode: 'expert',
    simpleText: '独立存储的简单模式原文',
    draftId: 'draft-server-id',
    clientDraftKey: 'draft-client-key',
    draftStatus: 'saving',
    futureUiOnlyField: 'must-not-leak',
  });

  assert.deepEqual(result, {
    org: '原子简历',
    title: '产品经理',
    start_date: '2025-01',
    end_date: '2026-07',
    star: {
      s: '情境',
      t: '任务',
      a: '行动',
      r: '结果',
    },
  });
  assert.notEqual(result.star, star);
});

test('experience draft service projects UI card data before sending card_data', () => {
  const source = readFileSync('services/experienceDraftService.ts', 'utf8');

  assert.doesNotMatch(source, /views\/ExperienceCard/);
  assert.match(source, /card_data:\s*projectExperienceDraftCardData\(payload\.cardData\)/);
});
