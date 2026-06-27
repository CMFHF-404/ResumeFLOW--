import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import { build } from 'esbuild';

const importSelectionUtils = async () => {
  const result = await build({
    entryPoints: ['views/AIAssistant/resumeSelectionUtils.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const encoded = Buffer.from(result.outputFiles[0].text).toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
};

const buildResume = () => ({
  resumeId: 'resume-1',
  resumeName: 'AI 产品实习简历',
  jdContext: '产品实习 JD',
  snapshot: {
    experiences: [
      { id: 'exp-1', title: '产品助理', org: 'A 公司', star: { s: 's1', t: '', a: '', r: '' } },
      { id: 'exp-2', title: 'RPG 项目', org: '个人项目', star: { s: 's2', t: '', a: '', r: '' } },
    ],
    educations: [{ id: 'edu-1', school: '浙江农林大学', major: '地理信息科学', degree: '本科' }],
    certifications: [{ id: 'cert-1', name: '英语四级', issue_date: '2025-01' }],
    skills: [{ id: 'skill-1', name: 'Axure', category: '产品工具' }],
  },
});

test('defaults resume experience selection to all resume experiences', async () => {
  const { buildDefaultResumeExperienceSelection } = await importSelectionUtils();

  assert.deepEqual(buildDefaultResumeExperienceSelection(buildResume()), ['exp-1', 'exp-2']);
});

test('builds selected resume snapshots with a filtered experience subset', async () => {
  const { buildSelectedResumeWithExperienceSelection } = await importSelectionUtils();

  const selected = buildSelectedResumeWithExperienceSelection(buildResume(), ['exp-2', 'missing']);

  assert.equal(selected.selection.mode, 'subset');
  assert.deepEqual(selected.selection.experienceIds, ['exp-2']);
  assert.deepEqual(selected.snapshot.experiences.map((item) => item.id), ['exp-2']);
  assert.deepEqual(selected.snapshot.educations.map((item) => item.id), ['edu-1']);
  assert.deepEqual(selected.snapshot.skills.map((item) => item.id), ['skill-1']);
});

test('keeps all mode when every resume experience remains selected', async () => {
  const { buildSelectedResumeWithExperienceSelection } = await importSelectionUtils();

  const selected = buildSelectedResumeWithExperienceSelection(buildResume(), ['exp-2', 'exp-1']);

  assert.equal(selected.selection.mode, 'all');
  assert.deepEqual(selected.selection.experienceIds, ['exp-1', 'exp-2']);
  assert.deepEqual(selected.snapshot.experiences.map((item) => item.id), ['exp-1', 'exp-2']);
});

test('rejects empty resume experience selection when the resume has experiences', async () => {
  const { buildSelectedResumeWithExperienceSelection } = await importSelectionUtils();

  assert.equal(buildSelectedResumeWithExperienceSelection(buildResume(), []), null);
});

test('filters selected resume snapshots by non-experience modules', async () => {
  const { buildSelectedResumeWithModuleSelection } = await importSelectionUtils();

  const selected = buildSelectedResumeWithModuleSelection(buildResume(), [
    { id: 'edu-1', kind: 'education', contextId: 'edu-1' },
    { id: 'skills-all', kind: 'skills' },
  ]);

  assert.deepEqual(selected.snapshot.experiences, []);
  assert.deepEqual(selected.snapshot.educations.map((item) => item.id), ['edu-1']);
  assert.deepEqual(selected.snapshot.certifications, []);
  assert.deepEqual(selected.snapshot.skills.map((item) => item.id), ['skill-1']);
  assert.equal(selected.selection, undefined);
});

test('filters selected resume snapshots by mixed module selections', async () => {
  const { buildSelectedResumeWithModuleSelection } = await importSelectionUtils();

  const selected = buildSelectedResumeWithModuleSelection(buildResume(), [
    { id: 'exp-2', kind: 'experience', contextId: 'exp-2' },
    { id: 'cert-1', kind: 'certification', contextId: 'cert-1' },
  ]);

  assert.equal(selected.selection.mode, 'subset');
  assert.deepEqual(selected.selection.experienceIds, ['exp-2']);
  assert.deepEqual(selected.snapshot.experiences.map((item) => item.id), ['exp-2']);
  assert.deepEqual(selected.snapshot.educations, []);
  assert.deepEqual(selected.snapshot.certifications.map((item) => item.id), ['cert-1']);
  assert.deepEqual(selected.snapshot.skills, []);
});
