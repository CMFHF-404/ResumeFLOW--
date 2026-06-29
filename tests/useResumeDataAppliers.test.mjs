import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import { build } from 'esbuild';

const importUseResumeDataAppliers = async () => {
  const result = await build({
    entryPoints: ['hooks/useResumeDataAppliers.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const source = result.outputFiles[0].text;
  const encoded = Buffer.from(source).toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
};

const captureSetter = () => {
  const calls = [];
  return {
    calls,
    setter: (value) => calls.push(value),
  };
};

const ids = (set) => [...set].sort();

test('resume config applier hydrates profile, summary visibility, density, and layout config', async () => {
  const { createApplyResumeConfig } = await importUseResumeDataAppliers();
  const profile = captureSetter();
  const summary = captureSetter();
  const summaryOverride = captureSetter();
  const syncMode = captureSetter();
  const socialLinks = captureSetter();
  const sectionOrder = captureSetter();
  const density = captureSetter();
  const summaryVisible = captureSetter();
  const layoutConfig = captureSetter();
  const profileData = {
    social_links: { github: 'https://example.com' },
    summary: 'Profile summary',
  };
  const resolvedProfile = { fullName: 'Ada', summary: 'Profile summary' };
  const applyResumeConfig = createApplyResumeConfig(
    profile.setter,
    summary.setter,
    summaryOverride.setter,
    syncMode.setter,
    socialLinks.setter,
    sectionOrder.setter,
    density.setter,
    summaryVisible.setter,
    layoutConfig.setter,
    (order) => order ?? ['profile', 'experience'],
    () => 'manual',
    () => resolvedProfile
  );

  applyResumeConfig({
    personalSummary: 'Pinned summary',
    layout: {
      sectionOrder: ['experience', 'profile'],
      density: 'compact',
      isSummaryVisible: undefined,
    },
  }, profileData);

  assert.deepEqual(profile.calls[0], resolvedProfile);
  assert.equal(summary.calls[0], 'Pinned summary');
  assert.equal(summaryOverride.calls[0], true);
  assert.equal(syncMode.calls[0], 'manual');
  assert.deepEqual(socialLinks.calls[0], { github: 'https://example.com' });
  assert.deepEqual(sectionOrder.calls[0], ['experience', 'profile']);
  assert.equal(density.calls[0], 'compact');
  assert.equal(summaryVisible.calls[0], true);
  assert.equal(layoutConfig.calls[0].layout.density, 'compact');
});

test('applyExplicitOrder keeps configured ids first and appends remaining items once', async () => {
  const { applyExplicitOrder } = await importUseResumeDataAppliers();
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  const ordered = applyExplicitOrder(items, (item) => item.id, ['c', 'missing', 'a', 'c']);

  assert.deepEqual(ordered.map((item) => item.id), ['c', 'a', 'b']);
});

test('experience applier orders work and project groups and defaults selection to resume map ids', async () => {
  const { createApplyExperienceState } = await importUseResumeDataAppliers();
  const appliedDetail = captureSetter();
  const sourceMap = captureSetter();
  const experiences = captureSetter();
  const selected = captureSetter();
  const sourceItems = [
    { master: { id: 'work-1' }, category: 'work' },
    { master: { id: 'work-2' }, category: 'work' },
    { master: { id: 'project-1' }, category: 'project' },
    { master: { id: 'project-2' }, category: 'project' },
  ];
  const resumeMap = new Map([
    ['work-2', { id: 'resume-work-2' }],
    ['project-1', { id: 'resume-project-1' }],
  ]);
  const applyExperienceState = createApplyExperienceState(
    appliedDetail.setter,
    sourceMap.setter,
    experiences.setter,
    selected.setter,
    () => new Map(sourceItems.map((item) => [item.master.id, item])),
    () => resumeMap,
    (item, resumeItem) => ({
      id: item.master.id,
      category: item.category,
      resumeItem,
    }),
    (items) => items,
    () => 0,
    (value) => new Set(value ?? [])
  );

  applyExperienceState({ resume: { id: 'resume-1' } }, sourceItems, {
    layout: {
      orders: {
        workExperienceIds: ['work-2'],
        projectExperienceIds: ['project-2'],
      },
    },
    selection: { experienceIds: [] },
  });

  assert.equal(appliedDetail.calls[0].resume.id, 'resume-1');
  assert.equal(sourceMap.calls[0].get('work-1'), sourceItems[0]);
  assert.deepEqual(experiences.calls[0].map((item) => item.id), [
    'work-2',
    'work-1',
    'project-2',
    'project-1',
  ]);
  assert.equal(experiences.calls[0][0].resumeItem.id, 'resume-work-2');
  assert.deepEqual(ids(selected.calls[0]), ['project-1', 'work-2']);
});

test('education applier filters stale selected ids and preserves explicit order', async () => {
  const { createApplyEducationState } = await importUseResumeDataAppliers();
  const educations = captureSetter();
  const sourceMap = captureSetter();
  const selected = captureSetter();
  const items = [
    { master: { id: 'edu-1' }, latest_version: { title: 'A' } },
    { master: { id: 'edu-2' }, latest_version: { title: 'B' } },
  ];
  const buildEducationView = (item) => ({
    id: item.master.id,
    title: item.latest_version.title,
  });
  const buildSourceMap = (sourceItems) => new Map(sourceItems.map((item) => [item.master.id, item]));
  const resolveSelectionSet = (value) => new Set(value ?? []);
  const applyEducationState = createApplyEducationState(
    educations.setter,
    sourceMap.setter,
    selected.setter,
    buildEducationView,
    buildSourceMap,
    resolveSelectionSet
  );

  applyEducationState(items, {
    layout: { orders: { educationIds: ['edu-2'] } },
    selection: { educationIds: ['edu-2', 'stale-id'] },
  });

  assert.deepEqual(educations.calls[0].map((item) => item.id), ['edu-2', 'edu-1']);
  assert.equal(sourceMap.calls[0].get('edu-1'), items[0]);
  assert.deepEqual(ids(selected.calls[0]), ['edu-2']);
});

test('certification applier sorts by date, preserves source map, and defaults selection to valid ids', async () => {
  const { createApplyCertificationState } = await importUseResumeDataAppliers();
  const certifications = captureSetter();
  const sourceMap = captureSetter();
  const selected = captureSetter();
  const items = [
    { id: 'cert-old', name: 'Old', date: '2022-01' },
    { id: 'cert-new', name: 'New', date: '2024-03' },
  ];
  const applyCertificationState = createApplyCertificationState(
    certifications.setter,
    sourceMap.setter,
    selected.setter,
    (item) => ({
      id: item.id,
      name: item.name,
      date: item.date,
    }),
    (value) => new Set(value ?? [])
  );

  applyCertificationState(items, {
    layout: { orders: { certificationIds: [] } },
    selection: { certificationIds: ['missing'] },
  });

  assert.deepEqual(certifications.calls[0].map((item) => item.id), ['cert-new', 'cert-old']);
  assert.equal(sourceMap.calls[0].get('cert-old'), items[0]);
  assert.deepEqual(ids(selected.calls[0]), ['cert-new', 'cert-old']);
});

test('certification applier preserves explicit empty selection when every certification is deselected', async () => {
  const { createApplyCertificationState } = await importUseResumeDataAppliers();
  const certifications = captureSetter();
  const sourceMap = captureSetter();
  const selected = captureSetter();
  const items = [
    { id: 'cert-1', name: 'AWS', date: '2024-03' },
    { id: 'cert-2', name: 'PMP', date: '2023-08' },
  ];
  const applyCertificationState = createApplyCertificationState(
    certifications.setter,
    sourceMap.setter,
    selected.setter,
    (item) => ({
      id: item.id,
      name: item.name,
      date: item.date,
    }),
    (value) => new Set(value ?? [])
  );

  applyCertificationState(items, {
    selection: { certificationIds: [] },
  });

  assert.deepEqual(ids(selected.calls[0]), []);
});

test('skill applier defaults selection to all valid ids when config selection is missing', async () => {
  const { createApplySkillState } = await importUseResumeDataAppliers();
  const skillGroups = captureSetter();
  const selected = captureSetter();
  const skills = [
    { id: 'skill-1', name: 'TypeScript', category: 'Frontend' },
    { id: 'skill-2', name: 'FastAPI', category: 'Backend' },
  ];
  const buildSkillGroups = (items) => [
    { id: 'group-backend', name: 'Backend', skills: items.filter((item) => item.category === 'Backend') },
    { id: 'group-frontend', name: 'Frontend', skills: items.filter((item) => item.category === 'Frontend') },
  ];
  const resolveSelectionSet = (value) => new Set(value ?? []);
  const applySkillState = createApplySkillState(
    skillGroups.setter,
    selected.setter,
    buildSkillGroups,
    resolveSelectionSet
  );

  applySkillState(skills, {
    layout: { orders: { skillGroupNames: ['Frontend'] } },
    selection: {},
  });

  assert.deepEqual(skillGroups.calls[0].map((group) => group.name), ['Frontend', 'Backend']);
  assert.deepEqual(ids(selected.calls[0]), ['skill-1', 'skill-2']);
});

test('skill applier preserves explicit empty selection when every skill is deselected', async () => {
  const { createApplySkillState } = await importUseResumeDataAppliers();
  const skillGroups = captureSetter();
  const selected = captureSetter();
  const skills = [
    { id: 'skill-1', name: 'TypeScript', category: 'Frontend' },
    { id: 'skill-2', name: 'FastAPI', category: 'Backend' },
  ];
  const buildSkillGroups = (items) => [
    { id: 'group-backend', name: 'Backend', skills: items.filter((item) => item.category === 'Backend') },
    { id: 'group-frontend', name: 'Frontend', skills: items.filter((item) => item.category === 'Frontend') },
  ];
  const resolveSelectionSet = (value) => new Set(value ?? []);
  const applySkillState = createApplySkillState(
    skillGroups.setter,
    selected.setter,
    buildSkillGroups,
    resolveSelectionSet
  );

  applySkillState(skills, {
    selection: { skillIds: [] },
  });

  assert.deepEqual(ids(selected.calls[0]), []);
});
