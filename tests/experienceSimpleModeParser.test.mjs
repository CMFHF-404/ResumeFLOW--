import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import { build } from 'esbuild';

const importParser = async () => {
  const result = await build({
    entryPoints: ['views/ExperienceSection/experienceSimpleModeParser.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const source = result.outputFiles[0].text;
  const encoded = Buffer.from(source).toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
};

test('splits simple text by STAR headings while preserving markdown and links', async () => {
  const { parseSimpleExperienceText } = await importParser();
  const input = [
    'S - 情境',
    '负责 [渠道库存](https://example.com) **混乱治理**。',
    'T：任务',
    '建立 *数字化* 溯源链路。',
    'A 行动',
    '梳理单品 - 中包 - 外箱逻辑。',
    'R 结果',
    '交付上线并支撑监管。',
  ].join('\n');

  const result = parseSimpleExperienceText(input);

  assert.equal(result.ok, true);
  assert.equal(result.star.s, '负责 [渠道库存](https://example.com) **混乱治理**。');
  assert.equal(result.star.t, '建立 *数字化* 溯源链路。');
  assert.equal(result.star.a, '梳理单品 - 中包 - 外箱逻辑。');
  assert.equal(result.star.r, '交付上线并支撑监管。');
});

test('preserves rich inline content after STAR headings', async () => {
  const { parseSimpleExperienceText } = await importParser();
  const input = [
    'S：负责 [渠道库存](https://example.com) **混乱治理**。',
    'T：建立 *数字化* 溯源链路。',
    'A：梳理单品 - 中包 - 外箱逻辑。',
    'R：交付上线并支撑监管。',
  ].join('\n');

  const result = parseSimpleExperienceText(input);

  assert.equal(result.ok, true);
  assert.equal(result.star.s, '负责 [渠道库存](https://example.com) **混乱治理**。');
  assert.equal(result.star.t, '建立 *数字化* 溯源链路。');
});

test('keeps label-like inline heading content when no body follows', async () => {
  const { parseSimpleExperienceText } = await importParser();
  const input = [
    'S：背景',
    'T：建立目标',
    'A：执行动作',
    'R：上线结果',
  ].join('\n');

  const result = parseSimpleExperienceText(input);

  assert.equal(result.ok, true);
  assert.equal(result.star.s, '背景');
});

test('preserves content before the first STAR heading instead of dropping it', async () => {
  const { parseSimpleExperienceText } = await importParser();
  const input = [
    '项目概述：负责库存治理整体方案。',
    'S：渠道库存混乱',
    'T：建立溯源链路',
    'A：梳理单品 - 中包 - 外箱逻辑。',
    'R：上线并支撑监管。',
  ].join('\n');

  const result = parseSimpleExperienceText(input);

  assert.equal(result.ok, true);
  assert.equal(result.star.s, '渠道库存混乱');
  assert.equal(result.star.t, '建立溯源链路');
  assert.equal(result.star.a, '项目概述：负责库存治理整体方案。\n梳理单品 - 中包 - 外箱逻辑。');
  assert.equal(result.star.r, '上线并支撑监管。');
});

test('splits simple text by four separator sections', async () => {
  const { parseSimpleExperienceText } = await importParser();

  const result = parseSimpleExperienceText('情境内容\n---\n任务内容\n---\n行动内容\n---\n结果内容');

  assert.equal(result.ok, true);
  assert.deepEqual(result.star, {
    s: '情境内容',
    t: '任务内容',
    a: '行动内容',
    r: '结果内容',
  });
});

test('removes adjacent duplicate lines inside simple separator sections', async () => {
  const { parseSimpleExperienceText } = await importParser();
  const task = '独立负责防窜货风控模块的从0到1设计与落地。';
  const resultText = '该模块最终按时交付并投入生产。';

  const result = parseSimpleExperienceText([
    '情境内容',
    '---',
    task,
    task,
    '---',
    '行动内容',
    '---',
    resultText,
    resultText,
  ].join('\n'));

  assert.equal(result.ok, true);
  assert.equal(result.star.t, task);
  assert.equal(result.star.r, resultText);
});

test('removes adjacent duplicate sentences on the same rich text line', async () => {
  const { parseSimpleExperienceText } = await importParser();
  const task = '独立负责防窜货风控模块的从0到1设计与落地。';

  const result = parseSimpleExperienceText([
    '情境内容',
    '---',
    `${task} ${task}`,
    '---',
    '行动内容',
    '---',
    '结果内容',
  ].join('\n'));

  assert.equal(result.ok, true);
  assert.equal(result.star.t, task);
});

test('falls back to putting unparseable content into action', async () => {
  const { parseSimpleExperienceText } = await importParser();
  const input = '这是一整段暂时没有 STAR 标题的经历，含 **重点** 和 [链接](https://example.com)。';

  const result = parseSimpleExperienceText(input);

  assert.equal(result.ok, false);
  assert.deepEqual(result.star, {
    s: '',
    t: '',
    a: input,
    r: '',
  });
});

test('does not treat plain English verbs as single-letter STAR headings', async () => {
  const { parseSimpleExperienceText } = await importParser();
  const input = [
    'Scaled onboarding conversion by 20%',
    'Tracked sales funnel quality',
    'Automated weekly reporting',
    'Reduced review time by 30%',
  ].join('\n');

  const result = parseSimpleExperienceText(input);

  assert.equal(result.ok, false);
  assert.deepEqual(result.star, {
    s: '',
    t: '',
    a: input,
    r: '',
  });
});

test('does not treat words prefixed by STAR terms as headings', async () => {
  const { parseSimpleExperienceText } = await importParser();
  const input = [
    'Situationed legacy customer data into clean cohorts',
    'Tasked the team with weekly reporting',
    'Actioned retention experiments',
    'Resulted in faster renewal reviews',
  ].join('\n');

  const result = parseSimpleExperienceText(input);

  assert.equal(result.ok, false);
  assert.deepEqual(result.star, {
    s: '',
    t: '',
    a: input,
    r: '',
  });
});

test('joins expert STAR fields into simple text with separators', async () => {
  const { joinStarFieldsForSimpleMode } = await importParser();

  const result = joinStarFieldsForSimpleMode({
    s: '情境',
    t: '',
    a: '行动',
    r: '结果',
  });

  assert.equal(result, '情境\n---\n\n---\n行动\n---\n结果');
});

test('joining expert STAR fields preserves adjacent duplicate content', async () => {
  const { joinStarFieldsForSimpleMode } = await importParser();
  const task = '独立负责防窜货风控模块的从0到1设计与落地。';

  const result = joinStarFieldsForSimpleMode({
    s: '情境',
    t: `${task} ${task}`,
    a: '行动',
    r: '结果',
  });

  assert.equal(result, `情境\n---\n${task} ${task}\n---\n行动\n---\n结果`);
});

test('preserves empty STAR field boundaries when joining expert fields', async () => {
  const { joinStarFieldsForSimpleMode, parseSimpleExperienceText } = await importParser();

  const simpleText = joinStarFieldsForSimpleMode({
    s: '情境',
    t: '',
    a: '行动',
    r: '结果',
  });
  const parsed = parseSimpleExperienceText(simpleText);

  assert.equal(simpleText, '情境\n---\n\n---\n行动\n---\n结果');
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.star, {
    s: '情境',
    t: '',
    a: '行动',
    r: '结果',
  });
});

test('validates AI split output without accepting content loss', async () => {
  const { validateSplitCoverage } = await importParser();
  const source = '负责渠道库存混乱治理，并建立数字化溯源链路。';

  assert.equal(validateSplitCoverage(source, {
    s: '负责渠道库存混乱治理',
    t: '',
    a: '建立数字化溯源链路',
    r: '',
  }), true);

  assert.equal(validateSplitCoverage(source, {
    s: '负责渠道库存治理',
    t: '',
    a: '',
    r: '',
  }), false);
});

test('rejects AI split output that only keeps one copy of repeated source content', async () => {
  const { validateSplitCoverage } = await importParser();
  const source = '负责负责负责负责负责负责库存库存库存库存治理治理治理治理上线上线上线';

  assert.equal(validateSplitCoverage(source, {
    s: '负责库存治理上线',
    t: '',
    a: '',
    r: '',
  }), false);
});

test('rejects AI split output that changes links or adds unsupported facts', async () => {
  const { validateSplitCoverage } = await importParser();

  assert.equal(validateSplitCoverage('负责 [渠道库存](https://example.com) 治理。', {
    s: '负责 [渠道库存](https://evil.example) 治理。',
    t: '',
    a: '',
    r: '',
  }), false);

  assert.equal(validateSplitCoverage('负责渠道库存治理', {
    s: '负责渠道库存治理，并获得CEO认可',
    t: '',
    a: '',
    r: '',
  }), false);
});

test('rejects small unsupported facts appended to long AI split output', async () => {
  const { validateSplitCoverage } = await importParser();
  const source = '负责渠道库存混乱治理并建立数字化溯源链路推动跨部门协同完成上线支撑监管验收提升数据质量减少人工核对时间';

  assert.equal(validateSplitCoverage(source, {
    s: '负责渠道库存混乱治理',
    t: '建立数字化溯源链路',
    a: '推动跨部门协同完成上线支撑监管验收提升数据质量减少人工核对时间',
    r: '获奖',
  }), false);
});

test('rejects AI split output that repeats a source sentence while dropping other details', async () => {
  const { validateSplitCoverage } = await importParser();
  const repeatedTask = '独立负责防窜货风控模块的从0到1设计与落地';
  const omittedResult = '模块按时交付并投入生产';
  const source = [
    '针对跨国销售场景下门店库存管理混乱及跨区窜货的业务痛点',
    repeatedTask,
    '通过重构销售后台核心流程实现项目的全周期管理',
    '独立负责风控模块设计与销售后台流程落地',
    omittedResult,
  ].join('。');

  assert.equal(validateSplitCoverage(source, {
    s: '针对跨国销售场景下门店库存管理混乱及跨区窜货的业务痛点',
    t: `${repeatedTask}\n${repeatedTask}`,
    a: '通过重构销售后台核心流程实现项目的全周期管理\n独立负责风控模块设计与销售后台流程落地',
    r: '',
  }), false);
});
