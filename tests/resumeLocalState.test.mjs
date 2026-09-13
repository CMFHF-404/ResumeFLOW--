import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { build } from 'esbuild';

const localId = 'resume-skill:88888888-8888-8888-8888-888888888888';
const noop = () => {};
const props = {
  profile: {}, originalProfile: {}, profileSyncMode: 'local', originalProfileSyncMode: 'local',
  isEditingProfile: false, resumeId: null, resumeDetail: null,
  personalSummary: '', hasPersonalSummaryOverride: false, bossGreetingSnapshot: null,
  selectedExpIds: new Set(), selectedEduIds: new Set(['edu']), selectedCertIds: new Set(),
  selectedSkillIds: new Set(['bank-1', localId]), sectionOrder: ['education', 'skills'],
  density: 'standard', topPaddingPx: 0, sectionSpacingKey: 'standard', itemSpacingEm: 1,
  lineHeight: 1.5, fontSize: 14, isSmartPageApplied: false, isSummaryVisible: false,
  layoutOrders: {}, resumeTemplateId: 'classic', themeColorPresetId: 'default',
  experienceListMarkerStyle: 'disc', skillTagSeparator: '、', persistedJDAnalysisSnapshot: null,
  careerStage: 'unspecified', skillOverrides: {}, localSkills: {}, educationOverrides: {},
};

const root = readFileSync('views/ResumeEditor/index.tsx', 'utf8');
const start = root.indexOf('const resumeConfigSnapshot = useMemo(');
const end = root.indexOf('const applyLayoutConfig =', start);
assert.ok(start >= 0 && end > start);
let runtime;
const require = createRequire(import.meta.url);
const result = await build({
  stdin: {
    contents: `
      import {useMemo} from 'react';
      import {buildResumeConfigSnapshot} from './views/ResumeEditor/helpers';
      export {useCommittedResumeConfigSnapshot} from './views/ResumeEditor/hooks/useCommittedResumeConfigSnapshot';
      export {useResumeEditorReorder} from './views/ResumeEditor/hooks/useResumeEditorReorder';
      export {createSkillHandlers} from './hooks/experienceActionHandlers/skillHandlers';
      export {skillsService} from './services/skillsService';
      export {useResumeConfigApplier} from './hooks/useResumeDataAppliers';
      export * from './utils/skillOverrides';
      export function automaticSnapshot({${Object.keys(props).join(',')}}) {
        ${root.slice(start, end)}
        return resumeConfigSnapshot;
      }
    `,
    loader: 'ts', resolveDir: process.cwd(),
  },
  bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react'],
  define: { 'import.meta.env': '{}' },
});
const module = { exports: {} };
const react = {
  ...require('react'),
  useMemo: (fn, deps) => runtime.memo(fn, deps),
  useCallback: (fn, deps) => runtime.memo(() => fn, deps),
  useRef: value => runtime.ref(value),
  useState: value => runtime.state(value),
};
new Function('require', 'module', 'exports', result.outputFiles[0].text)(
  id => id === 'react' ? react : require(id), module, module.exports,
);
const api = module.exports;

function memoRuntime() {
  let cursor = 0;
  const slots = [];
  return {
    render(fn) { cursor = 0; runtime = this; return fn(); },
    ref(value) {
      const index = cursor++;
      return slots[index] ??= { current: value };
    },
    state(value) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof value === 'function' ? value() : value;
      return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }];
    },
    memo(fn, deps) {
      const index = cursor++;
      if (!slots[index] || deps.some((value, i) => !Object.is(value, slots[index].deps[i]))) {
        slots[index] = { deps, value: fn() };
      }
      return slots[index].value;
    },
  };
}

test('automatic and committed snapshots persist edits, reloads and removal of local overrides', () => {
  const automatic = memoRuntime(), committed = memoRuntime();
  let input = { ...props };
  const render = () => {
    const auto = automatic.render(() => api.automaticSnapshot(input));
    const explicit = committed.render(() => api.useCommittedResumeConfigSnapshot(input)());
    assert.deepEqual(auto, explicit, 'automatic saves and explicit saves must carry identical local data');
    return auto;
  };
  let previous = render();
  for (const [key, value] of Object.entries({
    educationOverrides: { edu: { courses: '程序设计', notes: '已确认的研究工作' } },
    localSkills: { [localId]: { name: 'Python用于数据清洗', category: '分析工具' } },
    skillOverrides: { 'bank-1': { name: 'Python基础', category: '课程工具' } },
  })) {
    input = { ...input, [key]: value };
    const next = render();
    assert.notEqual(JSON.stringify(next), JSON.stringify(previous), `${key} must change the auto-save signature`);
    assert.deepEqual(JSON.parse(JSON.stringify(next))[key], value);
    previous = next;
  }
  const saved = JSON.parse(JSON.stringify(previous));
  assert.deepEqual(memoRuntime().render(() => api.automaticSnapshot({ ...input, ...saved })).localSkills, saved.localSkills);
  input = { ...input, skillOverrides: {}, localSkills: {}, educationOverrides: {} };
  const cleared = render();
  for (const key of ['skillOverrides', 'localSkills', 'educationOverrides']) {
    assert.equal(key in cleared, false, 'a full config replacement must remove cleared overrides');
  }
});

test('bank skill create, update and delete retain selected local skills and drop stale bank IDs', async () => {
  const record = { id: 'bank-1', name: 'Python', category: 'tools' };
  const original = { ...api.skillsService };
  try {
    for (const operation of ['create', 'update', 'delete']) {
      let selected = new Set(['bank-1', 'stale-bank', localId]);
      const domain = {
        groups: [{ name: 'tools', skills: [record] }], localSkillIds: new Set([localId]),
        setGroups: noop, setSelectedIds: fn => { selected = fn(selected); },
      };
      const state = {
        skillDraft: record, editingSkillId: operation === 'update' ? record.id : null,
        isSavingSkill: false, deletingSkillIds: new Set(), setDeletingSkillIds: noop,
        setIsSavingSkill: noop, setEditingSkillId: noop, setSkillDraft: noop, setSkillDraftContext: noop,
      };
      api.skillsService.create = async () => record;
      api.skillsService.update = async () => record;
      api.skillsService.delete = async () => {};
      api.skillsService.list = async () => operation === 'delete' ? [] : [record];
      const handlers = api.createSkillHandlers(domain, { buildSkillGroups: () => [] }, state, {}, {}, noop,
        { setSkillMatchScores: noop, setSkillMatchTrends: noop }, {
          beginOperation: async () => ({ expectedAuthCacheKey: 'owner' }),
          assertOperationCurrent: async () => {}, isOperationCurrent: () => true,
        });
      if (operation === 'delete') await handlers.performDeleteSkill(record.id);
      else await handlers.handleSaveSkill();
      assert.equal(selected.has(localId), true, `${operation} must preserve local selection`);
      assert.equal(selected.has('stale-bank'), false);
      assert.equal(selected.has(record.id), operation !== 'delete');
    }
  } finally { Object.assign(api.skillsService, original); }
  assert.match(root, /skill:\s*\{\s*groups: skillGroups,\s*localSkillIds:/);
});

test('cancelling item or section dragging restores source state without baking in overlays', () => {
  const originals = {
    skills: [{ name: 'Languages', skills: [{ id: 'bank-1', name: 'English' }] }],
    education: [{ id: 'edu', courses: '课程A、课程B' }],
  };
  const local = { [localId]: { name: 'Python', category: 'Tools' } };
  const overrides = { edu: { courses: '课程A', notes: '当前简历说明' } };
  for (const kind of ['item', 'section']) {
    let skills = structuredClone(originals.skills), education = structuredClone(originals.education);
    const hook = memoRuntime().render(() => api.useResumeEditorReorder({
      authUserKey: 'owner', experienceItems: [], setExperienceItems: noop,
      educations: api.applyEducationOverrides(education, overrides), sourceEducations: education,
      setEducations: value => { education = value; }, certifications: [], setCertifications: noop,
      skillGroups: api.applySkillGroupOverrides(skills, {}, local), sourceSkillGroups: skills,
      setSkillGroups: value => { skills = value; }, sectionOrder: ['education', 'skills'], setSectionOrder: noop,
    }));
    if (kind === 'item') hook.startItemReorder('skillGroup:Tools');
    else hook.startSectionReorder('education');
    hook.cancelTouchDragInteraction();
    assert.deepEqual(skills, originals.skills);
    assert.deepEqual(education, originals.education);
    assert.equal(api.applySkillGroupOverrides(skills, {}, local).flatMap(g => g.skills).filter(s => s.id === localId).length, 1);
    assert.equal(api.applyEducationOverrides(education, {})[0].courses, '课程A、课程B');
    assert.equal(api.applyEducationOverrides(education, overrides)[0].notes, '当前简历说明');
  }
  assert.match(root, /sourceEducations: bankEducations/);
  assert.match(root, /sourceSkillGroups: bankSkillGroups/);
});

for (const operation of ['rename', 'delete']) {
  for (const mode of ['local-only', 'mixed', 'partial-failure']) {
    test(`${operation} ${mode} category routes only bank IDs to the API and reconciles completed changes`, async () => {
      const originals = { ...api.skillsService };
      const oldError = console.error;
      const errors = [];
      console.error = (...args) => errors.push(args);
      const bankIds = mode === 'local-only' ? [] : ['bank-1', 'bank-2'];
      let local = { [localId]: { name: 'Local Python', category: 'Tools' } };
      let overrides = { 'bank-1': { name: 'Scoped Python', category: 'Tools' }, [localId]: { name: 'Confirmed local', category: 'Tools' } };
      const otherResume = structuredClone({ local, overrides });
      let selected = new Set([...bankIds, localId]);
      const calls = [], completed = [];
      let refreshes = 0;
      try {
        const mutate = async id => {
          calls.push(id);
          assert.equal(id.startsWith('resume-skill:'), false);
          if (mode === 'partial-failure' && id === 'bank-2') throw new Error('bank-2 failed');
          completed.push(id);
        };
        api.skillsService.update = mutate;
        api.skillsService.delete = mutate;
        api.skillsService.list = async () => { refreshes++; return bankIds.filter(id => operation !== 'delete' || !completed.includes(id)).map(id => ({ id })); };
        const domain = {
          groups: [{ name: 'Tools', skills: [...bankIds.map(id => ({ id, name: id })), { id: localId, name: 'Local Python' }] }],
          localSkillIds: new Set([localId]), setGroups: noop, setSelectedIds: fn => { selected = fn(selected); },
          onCategoryRenamed: (ids, category) => {
            local = api.renameSkillCategories(local, ids, category);
            overrides = api.renameSkillCategories(overrides, ids, category);
          },
          onSkillsDeleted: ids => {
            local = api.removeSkillEntries(local, ids);
            overrides = api.removeSkillEntries(overrides, ids);
            selected = new Set([...selected].filter(id => !ids.includes(id)));
          },
        };
        const handlers = api.createSkillHandlers(domain, { buildSkillGroups: () => [] }, {
          deletingSkillCategories: new Set(), setDeletingSkillCategories: noop,
          setRenamingCategoryTarget: noop, setRenamingCategoryDraft: noop,
        }, {}, {}, noop, { setSkillMatchScores: noop, setSkillMatchTrends: noop }, {
          beginOperation: async () => ({ expectedAuthCacheKey: 'owner' }),
          assertOperationCurrent: async () => {}, isOperationCurrent: () => true,
        });
        if (operation === 'rename') await handlers.handleRenameCategory('Tools', 'Analysis');
        else await handlers.performDeleteSkillCategory('Tools');
        assert.deepEqual(calls, bankIds);
        assert.equal(refreshes, bankIds.length ? 1 : 0);
        assert.equal(errors.length, mode === 'partial-failure' ? 1 : 0);
        if (operation === 'rename') {
          assert.equal(local[localId].category, 'Analysis');
          assert.equal(overrides[localId].category, 'Analysis');
          if (bankIds.length) assert.equal(overrides['bank-1'].category, 'Analysis');
          assert.equal(selected.has(localId), true);
        } else {
          assert.equal(localId in local, false);
          assert.equal(localId in overrides, false);
          assert.equal(selected.has(localId), false);
          if (mode === 'partial-failure') assert.equal(selected.has('bank-2'), true);
        }
        assert.equal(otherResume.local[localId].category, 'Tools');
        assert.equal(otherResume.overrides['bank-1'].category, 'Tools');
      } finally { Object.assign(api.skillsService, originals); console.error = oldError; }
    });
  }
}

test('visible skill groups reorder, survive config hydration, and cancel without mutating bank data', () => {
  const bank = [{ name: 'Languages', skills: [{ id: 'bank-1', name: 'English' }] },
    { name: 'Code', skills: [{ id: 'bank-2', name: 'Python' }] }];
  const before = structuredClone(bank);
  const local = { [localId]: { name: 'Local Python', category: 'Tools' } };
  const overrides = { 'bank-2': { name: 'Basic Python', category: 'Analysis' } };
  let order = [];
  const hooks = memoRuntime();
  const render = () => hooks.render(() => api.useResumeEditorReorder({
    authUserKey: 'owner', experienceItems: [], setExperienceItems: noop,
    educations: [], setEducations: noop, certifications: [], setCertifications: noop,
    skillGroups: api.applySkillGroupOverrides(bank, overrides, local, order), sourceSkillGroups: bank,
    skillGroupOrder: order, setSkillGroupOrder: value => { order = value; },
    setSkillGroups: () => assert.fail('visible group ordering must not replace bank state'),
    sectionOrder: ['skills'], setSectionOrder: noop,
  }));
  const names = () => api.applySkillGroupOverrides(bank, overrides, local, order).map(group => group.name);
  render().startItemReorder('skillGroup:Tools');
  render().handleItemDragHover('skillGroup:Languages', 'before');
  assert.deepEqual(names(), ['Tools', 'Languages', 'Analysis']);
  render().finishDragInteraction();
  render().startItemReorder('skillGroup:Analysis');
  render().handleItemDragHover('skillGroup:Tools', 'before');
  assert.deepEqual(names(), ['Analysis', 'Tools', 'Languages']);
  render().cancelTouchDragInteraction();
  assert.deepEqual(names(), ['Tools', 'Languages', 'Analysis']);
  const config = memoRuntime().render(() => api.automaticSnapshot({ ...props,
    localSkills: local, skillOverrides: overrides, layoutOrders: { skillGroupNames: names() } }));
  const saved = JSON.parse(JSON.stringify(config));
  const applier = memoRuntime().render(() => api.useResumeConfigApplier({
    setSkillGroupOrder: value => { order = value; }, setProfile: noop, setPersonalSummary: noop,
    setHasPersonalSummaryOverride: noop, setProfileSyncMode: noop, setProfileSocialLinks: noop,
    setSectionOrder: noop, setDensity: noop, setIsSummaryVisible: noop, applyLayoutConfig: noop,
    normalizeSectionOrder: value => value, resolveProfileSyncMode: () => 'local', resolveProfileSnapshot: () => ({}),
  }));
  order = [];
  applier(saved);
  assert.deepEqual(names(), ['Tools', 'Languages', 'Analysis']);
  applier({});
  assert.deepEqual(names(), ['Languages', 'Analysis', 'Tools'], 'switching resumes resets the saved order');
  assert.deepEqual(bank, before);
  assert.match(root, /skillGroupNames: skillGroups.map/);
  assert.match(root, /setSkillOverrides, setLocalSkills, setEducationOverrides, setSkillGroupOrder/);
});

test('a completed category request cannot change local state after switching resumes', async () => {
  const originals = { ...api.skillsService };
  let release, entered;
  const pending = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  let current = true;
  let localWrites = 0, refreshes = 0;
  try {
    api.skillsService.update = async () => { entered(); await pending; };
    api.skillsService.list = async () => { refreshes++; return []; };
    const handlers = api.createSkillHandlers({
      groups: [{ name: 'Tools', skills: [{ id: 'bank-1' }, { id: localId }] }],
      localSkillIds: new Set([localId]), isCurrent: () => current,
      onCategoryRenamed: () => { localWrites++; },
      setGroups: noop, setSelectedIds: noop,
    }, { buildSkillGroups: () => [] }, { setRenamingCategoryTarget: noop, setRenamingCategoryDraft: noop },
    {}, {}, noop, { setSkillMatchScores: noop, setSkillMatchTrends: noop }, {
      beginOperation: async () => ({ expectedAuthCacheKey: 'owner' }),
      assertOperationCurrent: async () => {}, isOperationCurrent: () => true,
    });
    const operation = handlers.handleRenameCategory('Tools', 'Analysis');
    await started;
    current = false;
    release();
    await operation;
    assert.equal(localWrites, 0, 'late results must not update another resume');
    assert.equal(refreshes, 0, 'a switched resume must not receive the old refresh');
  } finally { Object.assign(api.skillsService, originals); }
});
