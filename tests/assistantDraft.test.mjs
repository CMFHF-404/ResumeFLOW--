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

test('normalizes legacy education draft cards to experience cards', async () => {
  const { isAssistantDraftCardDisplayable, normalizeAssistantDraftCard } = await importAssistantDraftUtils();

  const normalized = normalizeAssistantDraftCard({
    type: 'education',
    status: 'draft_ready',
    summary: '教育经历',
    data: {
      org: '某大学',
      title: '计算机科学',
      startDate: '2022-09',
      endDate: '2026-06',
      isCurrent: false,
      star: {
        s: '本科阶段',
        t: '课程学习',
        a: '数据结构\n操作系统',
        r: '完成核心课程',
      },
    },
  });

  assert.equal(normalized.type, 'experience');
  assert.equal(normalized.data.category, 'education');
  assert.equal(normalized.data.org, '某大学');
  assert.deepEqual(Object.keys(normalized.data.star).sort(), ['a', 'r', 's', 't']);
  assert.equal(isAssistantDraftCardDisplayable(normalized), true);
});

test('folds explicit education draft fields into the internal star mapping', async () => {
  const { normalizeAssistantDraftCard } = await importAssistantDraftUtils();

  const normalized = normalizeAssistantDraftCard({
    type: 'experience',
    status: 'draft_ready',
    summary: '教育经历',
    data: {
      category: 'education',
      org: '厦门大学嘉庚学院',
      title: '计算机科学与技术',
      startDate: '2025-09',
      endDate: '',
      isCurrent: true,
      degree: '本科',
      gpa: '3.46/4.0',
      courses: '测试课程（90）\n另一门课（A）',
      star: {
        s: '',
        t: '',
        a: '',
        r: '不应作为教育保存字段',
      },
    },
  });

  assert.equal(normalized.data.star.s, '本科');
  assert.equal(normalized.data.star.t, '3.46/4.0');
  assert.equal(normalized.data.star.a, '测试课程（90）\n另一门课（A）');
  assert.equal(normalized.data.star.r, '');
});

test('returns semantic display fields for education draft cards', async () => {
  const { getAssistantEducationDraftFields, normalizeAssistantDraftCard } = await importAssistantDraftUtils();

  const normalized = normalizeAssistantDraftCard({
    type: 'experience',
    status: 'draft_ready',
    summary: '教育经历',
    data: {
      category: 'education',
      org: '厦门大学嘉庚学院',
      title: '计算机科学与技术',
      startDate: '2025-09',
      endDate: '',
      isCurrent: true,
      star: {
        s: '本科',
        t: '3.46/4.0',
        a: '测试课程（90）',
        r: '不会保存的结果字段',
      },
    },
  });

  assert.deepEqual(getAssistantEducationDraftFields(normalized), [
    ['学校', '厦门大学嘉庚学院'],
    ['专业', '计算机科学与技术'],
    ['学位', '本科'],
    ['GPA/绩点', '3.46/4.0'],
    ['课程', '测试课程（90）'],
  ]);
});
