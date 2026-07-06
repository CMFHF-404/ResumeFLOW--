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

test('keeps the full selected resume snapshot in picker state while recording the experience subset', async () => {
  const { buildSelectedResumeWithExperienceSelection } = await importSelectionUtils();

  const selected = buildSelectedResumeWithExperienceSelection(buildResume(), ['exp-2', 'missing']);

  assert.equal(selected.selection.mode, 'subset');
  assert.deepEqual(selected.selection.experienceIds, ['exp-2']);
  assert.deepEqual(selected.snapshot.experiences.map((item) => item.id), ['exp-1', 'exp-2']);
  assert.deepEqual(selected.snapshot.educations.map((item) => item.id), ['edu-1']);
  assert.deepEqual(selected.snapshot.skills.map((item) => item.id), ['skill-1']);
});

test('builds a focused turn payload from an explicit experience subset', async () => {
  const {
    buildSelectedResumeForTurn,
    buildSelectedResumeWithExperienceSelection,
  } = await importSelectionUtils();

  const stateResume = buildSelectedResumeWithExperienceSelection(buildResume(), ['exp-2']);
  const payloadResume = buildSelectedResumeForTurn(stateResume, []);

  assert.equal(payloadResume.selection.mode, 'subset');
  assert.deepEqual(payloadResume.selection.experienceIds, ['exp-2']);
  assert.deepEqual(payloadResume.snapshot.experiences.map((item) => item.id), ['exp-2']);
  assert.deepEqual(payloadResume.snapshot.educations, []);
  assert.deepEqual(payloadResume.snapshot.certifications, []);
  assert.deepEqual(payloadResume.snapshot.skills, []);
  assert.equal(payloadResume.jdContext, '产品实习 JD');
});

test('keeps the full resume payload when no explicit selection was made', async () => {
  const { buildSelectedResumeForTurn } = await importSelectionUtils();

  const payloadResume = buildSelectedResumeForTurn(buildResume(), []);

  assert.equal(payloadResume.selection, undefined);
  assert.deepEqual(payloadResume.snapshot.experiences.map((item) => item.id), ['exp-1', 'exp-2']);
  assert.deepEqual(payloadResume.snapshot.educations.map((item) => item.id), ['edu-1']);
  assert.deepEqual(payloadResume.snapshot.skills.map((item) => item.id), ['skill-1']);
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
  assert.deepEqual(selected.selection, {
    mode: 'subset',
    experienceIds: [],
    moduleIds: ['edu-1', 'skills-all'],
  });
});

test('filters selected resume snapshots by mixed module selections', async () => {
  const { buildSelectedResumeWithModuleSelection } = await importSelectionUtils();

  const selected = buildSelectedResumeWithModuleSelection(buildResume(), [
    { id: 'exp-2', kind: 'experience', contextId: 'exp-2' },
    { id: 'cert-1', kind: 'certification', contextId: 'cert-1' },
  ]);

  assert.equal(selected.selection.mode, 'subset');
  assert.deepEqual(selected.selection.experienceIds, ['exp-2']);
  assert.deepEqual(selected.selection.moduleIds, ['exp-2', 'cert-1']);
  assert.deepEqual(selected.snapshot.experiences.map((item) => item.id), ['exp-2']);
  assert.deepEqual(selected.snapshot.educations, []);
  assert.deepEqual(selected.snapshot.certifications.map((item) => item.id), ['cert-1']);
  assert.deepEqual(selected.snapshot.skills, []);
});

test('keeps subset mode when all experiences and only selected non-experience modules are included', async () => {
  const { buildSelectedResumeWithModuleSelection } = await importSelectionUtils();

  const selected = buildSelectedResumeWithModuleSelection(buildResume(), [
    { id: 'exp-1', kind: 'experience', contextId: 'exp-1' },
    { id: 'exp-2', kind: 'experience', contextId: 'exp-2' },
    { id: 'skills-all', kind: 'skills' },
  ]);

  assert.equal(selected.selection.mode, 'subset');
  assert.deepEqual(selected.selection.experienceIds, ['exp-1', 'exp-2']);
  assert.deepEqual(selected.selection.moduleIds, ['exp-1', 'exp-2', 'skills-all']);
  assert.deepEqual(selected.snapshot.experiences.map((item) => item.id), ['exp-1', 'exp-2']);
  assert.deepEqual(selected.snapshot.educations, []);
  assert.deepEqual(selected.snapshot.certifications, []);
  assert.deepEqual(selected.snapshot.skills.map((item) => item.id), ['skill-1']);
});
