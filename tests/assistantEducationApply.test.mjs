import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import { build } from 'esbuild';

const importAssistantApplyUtils = async () => {
  const result = await build({
    entryPoints: ['views/ResumeEditor/assistantApplyUtils.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const source = result.outputFiles[0].text;
  const encoded = Buffer.from(source).toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
};

const importResumeEditorHelpers = async () => {
  const result = await build({
    entryPoints: ['views/ResumeEditor/helpers.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const source = result.outputFiles[0].text;
  const encoded = Buffer.from(source).toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
};

test('maps education assistant draft courses with grades into the education edit draft', async () => {
  const { buildAssistantEducationDraft } = await importAssistantApplyUtils();

  const draft = buildAssistantEducationDraft({
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
      r: '',
    },
  });

  assert.equal(draft.school, '厦门大学嘉庚学院');
  assert.equal(draft.major, '计算机科学与技术');
  assert.equal(draft.degree, '本科');
  assert.equal(draft.gpa, '3.46/4.0');
  assert.equal(draft.courses, '测试课程（90）');
});

test('writes education draft courses with grades into star.courses payload', async () => {
  const { buildEducationVersionPayload } = await importResumeEditorHelpers();

  const payload = buildEducationVersionPayload(null, {
    school: '厦门大学嘉庚学院',
    major: '计算机科学与技术',
    degree: '本科',
    startDate: '2025-09',
    endDate: '至今',
    gpa: '3.46/4.0',
    courses: '测试课程（90）',
  });

  assert.equal(payload.title, '计算机科学与技术');
  assert.equal(payload.org, '厦门大学嘉庚学院');
  assert.equal(payload.star.degree, '本科');
  assert.equal(payload.star.gpa, '3.46/4.0');
  assert.equal(payload.star.courses, '测试课程（90）');
});
