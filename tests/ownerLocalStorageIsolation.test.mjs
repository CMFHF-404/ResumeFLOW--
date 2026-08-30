import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const importBundledModule = async (entryPoint, { stubProfileService = false } = {}) => {
  const result = await build({
    entryPoints: [entryPoint],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    ...(stubProfileService ? {
      plugins: [{
        name: 'stub-profile-service',
        setup(buildApi) {
          buildApi.onResolve({ filter: /profileService$/ }, () => ({
            path: 'profileService',
            namespace: 'owner-isolation-test',
          }));
          buildApi.onLoad({ filter: /.*/, namespace: 'owner-isolation-test' }, () => ({
            contents: `export const profileService = {
              getProfile: async () => { throw new Error('unexpected profile read'); },
              updateProfile: async () => { throw new Error('unexpected profile write'); },
            };`,
            loader: 'js',
          }));
        },
      }],
    } : {}),
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
};

const createLocalStorage = () => {
  const values = new Map();
  return {
    get length() {
      return values.size;
    },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
};

const buildAnalysis = (jdText) => ({
  jdText,
  jdInputSignature: 'jd-signature',
  experienceSignature: 'experience-signature',
  result: { matchPercentage: 80, jobKeywords: [], missingKeywords: [], summary: 'ok' },
  itemSignatures: { experiences: {}, certifications: {}, skills: {} },
  inputMode: 'text',
  updatedAt: '2026-08-24T00:00:00.000Z',
});

const buildAssistantDraft = (createdAt = Date.now()) => ({
  source: 'resume_editor',
  sessionId: 'session-1',
  messageId: 'message-1',
  resumeId: 'resume-1',
  masterId: 'master-1',
  draft: {
    category: 'work',
    org: 'ResumeFLOW',
    title: 'Engineer',
    startDate: '2024-01',
    endDate: '2025-01',
    star: { s: 's', t: 't', a: 'a', r: 'r' },
  },
  createdAt,
});

test('owner-key guard preserves the owner-scoped storage boundary', async () => {
  const { isAuthenticatedOwnerKey } = await importBundledModule('utils/authOwner.ts');

  assert.equal(isAuthenticatedOwnerKey('owner-a'), true);
  assert.equal(isAuthenticatedOwnerKey(' anonymous '), true);
  assert.equal(isAuthenticatedOwnerKey('anonymous'), false);
  assert.equal(isAuthenticatedOwnerKey(''), false);
  assert.equal(isAuthenticatedOwnerKey('   '), false);
  assert.equal(isAuthenticatedOwnerKey(null), false);
  assert.equal(isAuthenticatedOwnerKey(undefined), false);
});

test('JD local cache is isolated by authenticated owner and never reads a legacy key', async () => {
  const localStorage = createLocalStorage();
  globalThis.localStorage = localStorage;
  const storage = await importBundledModule('services/jdAnalysisStorage.ts');

  localStorage.setItem('yuanzijianli.jdAnalysisCache:resume-1', JSON.stringify(buildAnalysis('legacy secret')));
  storage.saveJDAnalysisCache('owner-a', 'resume-1', buildAnalysis('owner A'));
  storage.saveJDAnalysisCache('owner-b', 'resume-1', buildAnalysis('owner B'));

  assert.equal(storage.loadJDAnalysisCache('owner-a', 'resume-1')?.payload.jdText, 'owner A');
  assert.equal(storage.loadJDAnalysisCache('owner-b', 'resume-1')?.payload.jdText, 'owner B');
  assert.equal(storage.loadJDAnalysisCache(null, 'resume-1'), null);
  assert.equal(localStorage.getItem('yuanzijianli.jdAnalysisCache:resume-1'), null);
  assert.equal(storage.loadJDAnalysisCache('anonymous', 'resume-1'), null);
});

test('assistant manual-save drafts are owner-isolated, expire after seven days, and remove legacy drafts', async () => {
  const localStorage = createLocalStorage();
  globalThis.window = { localStorage };
  const storage = await importBundledModule('views/assistantManualSaveStorage.ts');
  const now = Date.now();

  localStorage.setItem('yuanzijianli.assistantManualSaveDraft', JSON.stringify(buildAssistantDraft(now)));
  storage.writePendingAssistantManualSaveDraft('owner-a', buildAssistantDraft(now));
  storage.writePendingAssistantManualSaveDraft('owner-b', {
    ...buildAssistantDraft(now),
    messageId: 'message-b',
  });
  storage.writePendingAssistantManualSaveDraft('owner-expired', buildAssistantDraft(now - 8 * 24 * 60 * 60 * 1000));

  assert.deepEqual(
    storage.readPendingAssistantManualSaveDrafts('owner-a').map((draft) => draft.messageId),
    ['message-1'],
  );
  assert.deepEqual(
    storage.readPendingAssistantManualSaveDrafts('owner-b').map((draft) => draft.messageId),
    ['message-b'],
  );
  assert.deepEqual(storage.readPendingAssistantManualSaveDrafts(null), []);
  assert.deepEqual(storage.readPendingAssistantManualSaveDrafts('owner-expired'), []);
  storage.writePendingAssistantManualSaveDraft('anonymous', buildAssistantDraft(now));
  storage.writePendingAssistantManualSaveDraft('   ', buildAssistantDraft(now));
  assert.deepEqual(storage.readPendingAssistantManualSaveDrafts('anonymous'), []);
  assert.deepEqual(storage.readPendingAssistantManualSaveDrafts('   '), []);
  assert.equal(localStorage.getItem('yuanzijianli.assistantManualSaveDraft:anonymous'), null);
  assert.equal(localStorage.getItem('yuanzijianli.assistantManualSaveDraft:%20%20%20'), null);
  assert.equal(localStorage.getItem('yuanzijianli.assistantManualSaveDraft'), null);
});

test('active resume selection is owner-isolated and legacy data is delete-only', async () => {
  const localStorage = createLocalStorage();
  globalThis.localStorage = localStorage;
  const storage = await importBundledModule('services/resumeStorage.ts');

  localStorage.setItem('yuanzijianli.activeResumeId', 'legacy-resume');
  storage.setActiveResumeId('owner-a', 'resume-a');
  storage.setActiveResumeId('owner-b', 'resume-b');

  assert.equal(storage.getActiveResumeId('owner-a'), 'resume-a');
  assert.equal(storage.getActiveResumeId('owner-b'), 'resume-b');
  assert.equal(storage.getActiveResumeId(null), null);
  assert.equal(storage.getActiveResumeId('anonymous'), null);
  assert.equal(localStorage.getItem('yuanzijianli.activeResumeId'), null);

  storage.setActiveResumeId(null, 'resume-without-owner');
  assert.equal(localStorage.getItem('yuanzijianli.activeResumeId:null'), null);

  storage.clearActiveResumeId('owner-a');
  assert.equal(storage.getActiveResumeId('owner-a'), null);
  assert.equal(storage.getActiveResumeId('owner-b'), 'resume-b');
});

test('active resume callers pass the authenticated owner and logout cleanup removes that owner state', () => {
  const app = read('App.tsx');
  const callers = [
    app,
    read('hooks/useResumeData.ts'),
    read('views/Dashboard.tsx'),
    read('views/Dashboard/useDashboardResumeList.ts'),
    read('views/ExperienceBank/useExperienceBankProfile.ts'),
  ].join('\n');

  assert.doesNotMatch(callers, /\b(?:getActiveResumeId|clearActiveResumeId)\(\s*\)/);
  assert.doesNotMatch(callers, /\bsetActiveResumeId\(\s*[^,\n)]+\s*\)/);
  assert.match(app, /clearOwnerScopedSensitiveLocalState[\s\S]*?clearActiveResumeId\(ownerKey\)/);
  assert.match(app, /clearOwnerScopedSensitiveLocalState\(previousKey \?\? storedKey\)/);
  assert.match(app, /!isAuthLoading && !isAuthenticated && storedKey[\s\S]*?clearOwnerScopedSensitiveLocalState\(storedKey\)/);
  assert.equal(read('views/resumeStorage.ts').trim(), "export * from '../services/resumeStorage';");
});

test('resume template preferences and presets are owner-isolated and legacy globals are delete-only', async () => {
  const localStorage = createLocalStorage();
  globalThis.localStorage = localStorage;
  globalThis.window = { localStorage };
  const storage = await importBundledModule('services/resumeTemplateStorage.ts', {
    stubProfileService: true,
  });
  const legacyPreset = {
    'modern-slate': {
      themeColorPresetId: 'rose',
      updatedAt: '2026-08-24T00:00:00.000Z',
    },
  };

  localStorage.setItem(
    'yuanzijianli.preferredResumeTemplate',
    JSON.stringify({ templateId: 'deephire-standard' }),
  );
  localStorage.setItem('yuanzijianli.resumeTemplatePresets', JSON.stringify(legacyPreset));

  assert.equal(storage.loadPreferredResumeTemplateId('owner-a'), 'modern-slate');
  assert.deepEqual(storage.loadResumeTemplatePresetMap('owner-a'), {});
  assert.equal(localStorage.getItem('yuanzijianli.preferredResumeTemplate'), null);
  assert.equal(localStorage.getItem('yuanzijianli.resumeTemplatePresets'), null);

  storage.savePreferredResumeTemplateId('deephire-standard', 'owner-a');
  storage.syncResumeTemplatePresetsFromProfile(
    { resumeTemplatePresets: legacyPreset },
    'owner-a',
  );

  assert.equal(storage.loadPreferredResumeTemplateId('owner-a'), 'deephire-standard');
  assert.equal(
    storage.loadResumeTemplatePresetMap('owner-a')['modern-slate']?.themeColorPresetId,
    'rose',
  );

  // Simulate A -> logout -> B. Neither logout nor B may inherit A's local choices.
  assert.equal(storage.loadPreferredResumeTemplateId(null), 'modern-slate');
  assert.deepEqual(storage.loadResumeTemplatePresetMap(null), {});
  assert.equal(storage.loadPreferredResumeTemplateId('owner-b'), 'modern-slate');
  assert.deepEqual(storage.loadResumeTemplatePresetMap('owner-b'), {});

  storage.savePreferredResumeTemplateId('modern-slate-avatar', 'owner-b');
  assert.equal(storage.loadPreferredResumeTemplateId('owner-b'), 'modern-slate-avatar');
  assert.equal(storage.loadPreferredResumeTemplateId('owner-a'), 'deephire-standard');

  const unsafeOwner = 'owner:a/b?%';
  assert.equal(
    storage.buildPreferredResumeTemplateStorageKey(unsafeOwner),
    `yuanzijianli.preferredResumeTemplate:${encodeURIComponent(unsafeOwner)}`,
  );
  assert.equal(
    storage.buildResumeTemplatePresetStorageKey(unsafeOwner),
    `yuanzijianli.resumeTemplatePresets:${encodeURIComponent(unsafeOwner)}`,
  );
});

test('anonymous template storage fails closed even when stale profile data is supplied', async () => {
  const localStorage = createLocalStorage();
  globalThis.localStorage = localStorage;
  globalThis.window = { localStorage };
  const storage = await importBundledModule('services/resumeTemplateStorage.ts', {
    stubProfileService: true,
  });
  const staleExtraJson = {
    resumeTemplatePresets: {
      'modern-slate': {
        themeColorPresetId: 'rose',
        updatedAt: '2026-08-24T00:00:00.000Z',
      },
    },
  };

  storage.savePreferredResumeTemplateId('deephire-standard', null);
  storage.savePreferredResumeTemplateId('deephire-standard', 'anonymous');

  assert.equal(storage.loadPreferredResumeTemplateId(null), 'modern-slate');
  assert.deepEqual(storage.syncResumeTemplatePresetsFromProfile(staleExtraJson, null), {});
  assert.equal(storage.resolveResumeTemplatePreset('modern-slate', staleExtraJson, null), null);
  assert.deepEqual(storage.buildPreferredResumeCreateConfig(staleExtraJson, null), {
    layout: {
      templateId: 'modern-slate',
      themeColorPresetId: 'slate',
      experienceListMarkerStyle: 'unordered',
      skillTagSeparator: '，',
    },
  });
  await assert.rejects(
    storage.saveResumeTemplatePreset({ templateId: 'modern-slate' }, null),
    /未登录状态/,
  );
  assert.equal(localStorage.length, 0);
});

test('resume template storage callers always provide the active owner', () => {
  const actions = read('views/ResumeEditor/hooks/useTemplatePresetActions.ts');
  const callers = [
    actions,
    read('hooks/useProfile.ts'),
    read('hooks/useResumeData.ts'),
    read('views/Dashboard/useDashboardResumeList.ts'),
    read('views/ResumeEditor/hooks/useCreateResumeFlow.ts'),
    read('views/ResumeEditor/hooks/useTemplatePresetSync.ts'),
  ].join('\n');

  assert.match(actions, /savePreferredResumeTemplateId\(templateId, authUserKey\)/);
  assert.match(actions, /saveResumeTemplatePreset\(normalizedPreset, authUserKey\)/);
  assert.doesNotMatch(callers, /loadPreferredResumeTemplateId\(\s*\)/);
  assert.doesNotMatch(callers, /savePreferredResumeTemplateId\(\s*[^,\n)]+\s*\)/);
  assert.doesNotMatch(callers, /loadResumeTemplatePresetMap\(\s*\)/);
  assert.equal(read('views/resumeTemplateStorage.ts').trim(), "export * from '../services/resumeTemplateStorage';");
});
