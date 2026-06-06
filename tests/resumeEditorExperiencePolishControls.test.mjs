import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import { build } from 'esbuild';

const importExperiencePolishViewUtils = async () => {
  const result = await build({
    entryPoints: ['views/ResumeEditor/experiencePolishViewUtils.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const source = result.outputFiles[0].text;
  const encoded = Buffer.from(source).toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
};

const importExperiencePolishCoordinatorUtils = async () => {
  const result = await build({
    entryPoints: ['views/ResumeEditor/experiencePolishCoordinatorUtils.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const source = result.outputFiles[0].text;
  const encoded = Buffer.from(source).toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
};

const baseExperience = {
  id: 'exp-1',
  sourceId: 'source-1',
  category: 'work',
  title: 'Original title',
  company: 'Original company',
  startDate: '2024-01',
  endDate: '2024-12',
  isCurrent: false,
  date: '2024.01 - 2024.12',
  star: {
    s: 'Original S',
    t: 'Original T',
    a: 'Original A',
    r: 'Original R',
  },
};

test('buildExperienceViewFromDraft applies draft fields and rebuilds display date', async () => {
  const { buildExperienceViewFromDraft } = await importExperiencePolishViewUtils();

  const result = buildExperienceViewFromDraft(baseExperience, {
    masterId: 'exp-1',
    category: 'work',
    title: 'Polished title',
    company: 'Polished company',
    startDate: '2025-02',
    endDate: '2025-10',
    isCurrent: false,
    star: {
      s: 'Polished S',
      t: 'Polished T',
      a: 'Polished A',
      r: 'Polished R',
    },
  });

  assert.equal(result.title, 'Polished title');
  assert.equal(result.company, 'Polished company');
  assert.equal(result.startDate, '2025-02');
  assert.equal(result.endDate, '2025-10');
  assert.equal(result.isCurrent, false);
  assert.equal(result.date, '2025.02 - 2025.10');
  assert.deepEqual(result.star, {
    s: 'Polished S',
    t: 'Polished T',
    a: 'Polished A',
    r: 'Polished R',
  });
});

test('buildExperienceViewFromDraft preserves existing labels when draft title or company is blank', async () => {
  const { buildExperienceViewFromDraft } = await importExperiencePolishViewUtils();

  const result = buildExperienceViewFromDraft(baseExperience, {
    masterId: 'exp-1',
    category: 'work',
    title: '   ',
    company: '',
    startDate: '2025-02',
    endDate: '',
    isCurrent: true,
    star: {
      s: 'S',
      t: 'T',
      a: 'A',
      r: 'R',
    },
  });

  assert.equal(result.title, 'Original title');
  assert.equal(result.company, 'Original company');
  assert.equal(result.endDate, '');
  assert.equal(result.isCurrent, true);
  assert.equal(result.date, '2025.02 - 至今');
});

test('batch polish open helper preserves blocking priority', async () => {
  const { resolveBatchPolishOpenBlockMessage } = await importExperiencePolishCoordinatorUtils();

  assert.equal(resolveBatchPolishOpenBlockMessage({
    isFloatingExperiencePolishRunning: true,
    hasFloatingPolishSession: true,
    activeFloatingPolishExperienceId: 'exp-1',
  }), '请等待当前润色完成后再继续操作');

  assert.equal(resolveBatchPolishOpenBlockMessage({
    isFloatingExperiencePolishRunning: false,
    hasFloatingPolishSession: true,
    activeFloatingPolishExperienceId: 'exp-1',
  }), '请先确认或撤销当前润色结果');

  assert.equal(resolveBatchPolishOpenBlockMessage({
    isFloatingExperiencePolishRunning: false,
    hasFloatingPolishSession: false,
    activeFloatingPolishExperienceId: 'exp-1',
  }), '请先关闭当前润色工具栏');

  assert.equal(resolveBatchPolishOpenBlockMessage({
    isFloatingExperiencePolishRunning: false,
    hasFloatingPolishSession: false,
    activeFloatingPolishExperienceId: null,
  }), null);
});

test('batch polish resets smart completion mode before opening', async () => {
  const { shouldResetFloatingPolishModeForBatch } = await importExperiencePolishCoordinatorUtils();

  assert.equal(shouldResetFloatingPolishModeForBatch('smart_complete'), true);
  assert.equal(shouldResetFloatingPolishModeForBatch('default'), false);
  assert.equal(shouldResetFloatingPolishModeForBatch('highlight'), false);
});
