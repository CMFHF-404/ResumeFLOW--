import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';

const importCoordinator = async () => {
  const result = await build({
    entryPoints: ['hooks/resumeConfigSaveCoordinator.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const encoded = Buffer.from(result.outputFiles[0].text).toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
};

const importSaveResultUtils = async () => {
  const result = await build({
    entryPoints: ['hooks/resumeSaveResultUtils.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const encoded = Buffer.from(result.outputFiles[0].text).toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
};

const importJDAnalysisStorage = async () => {
  const result = await build({
    entryPoints: ['services/jdAnalysisStorage.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const encoded = Buffer.from(result.outputFiles[0].text).toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
};

const importSaveBoundary = async () => {
  const source = readFileSync('hooks/useResumeData.ts', 'utf8');
  const bridgeStart = source.indexOf('// RESUME_OPTIMIZATION_SAVE_BRIDGE_START');
  const bridgeEnd = source.indexOf('// RESUME_OPTIMIZATION_SAVE_BRIDGE_END');
  const flusherStart = source.indexOf('const useResumeConfigFlusher =');
  const flusherEnd = source.indexOf('export const useResumeData =', flusherStart);
  const saveStart = source.indexOf('const saveResumeConfig = useCallback<SaveResumeConfig>');
  const saveEnd = source.indexOf('    useResumeAutoSave(', saveStart);
  assert.ok(bridgeStart >= 0 && bridgeEnd > bridgeStart);
  assert.ok(flusherStart >= 0 && flusherEnd > flusherStart);
  assert.ok(saveStart >= 0 && saveEnd > saveStart);
  const result = await build({
    stdin: {
      contents: `
        import { graftJDAnalysisAuthority, resolveJDAnalysisForConfigSnapshot }
          from './services/jdAnalysisStorage';
        const useCallback = (callback) => callback;
        ${source.slice(bridgeStart, bridgeEnd)}
        ${source.slice(flusherStart, flusherEnd)}
        export const createSaveBoundary = ({
          state, options, saveCoordinator, latestServerJDAnalysisRef,
          latestEffectiveConfigSnapshotRef, loadJDAnalysisCache,
        }) => {
          ${source.slice(saveStart, saveEnd)}
          return {
            saveResumeConfig,
            flushResumeConfig: useResumeConfigFlusher(
              latestEffectiveConfigSnapshotRef, saveResumeConfig,
              state.setSaveState, { current: false },
            ),
          };
        }`,
      loader: 'ts',
      resolveDir: process.cwd(),
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const encoded = Buffer.from(result.outputFiles[0].text).toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
};

const createSaveBoundaryHarness = async ({
  coordinator, getServerJD, getPendingCache, getToken, getSavedSignature, config,
}) => {
  const { createSaveBoundary } = await importSaveBoundary();
  const saveStates = [];
  return {
    saveStates,
    ...createSaveBoundary({
      state: {
        activeResumeIdRef: { current: 'resume-1' },
        hasHydratedConfigRef: { current: true },
        resumeUpdatedAtRef: { get current() { return getToken(); } },
        lastSavedConfigRef: { get current() { return getSavedSignature(); } },
        setSaveState: (state) => saveStates.push(state),
      },
      options: { authUserKey: 'owner-1' },
      saveCoordinator: coordinator,
      latestServerJDAnalysisRef: {
        get current() { return { resumeId: 'resume-1', payload: getServerJD() }; },
      },
      latestEffectiveConfigSnapshotRef: { current: config },
      loadJDAnalysisCache: getPendingCache,
    }),
  };
};

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const createHarness = async (persist) => {
  const { createResumeConfigSaveCoordinator } = await importCoordinator();
  let resumeId = 'resume-1';
  let expectedUpdatedAt = 'version-1';
  let lastSavedSignature = JSON.stringify({ value: 'saved' });
  let hydrated = true;
  let canPersist = true;
  const calls = [];
  const coordinator = createResumeConfigSaveCoordinator({
    getResumeId: () => resumeId,
    getExpectedUpdatedAt: () => expectedUpdatedAt,
    getLastSavedSignature: () => lastSavedSignature,
    isHydrated: () => hydrated,
    assertCanPersist: () => {
      if (!canPersist) throw new Error('persistence blocked');
    },
    persist: async (resumeId, config, expected) => {
      calls.push({ resumeId, config, expected });
      return persist(config, expected);
    },
    onSaveStart: () => undefined,
    onSaveSuccess: (_resumeId, result, signature) => {
      expectedUpdatedAt = result.updated_at;
      lastSavedSignature = signature;
    },
  });
  return {
    coordinator,
    calls,
    setResumeId: (nextResumeId) => {
      resumeId = nextResumeId;
    },
    setHydrated: (nextHydrated) => {
      hydrated = nextHydrated;
    },
    setCanPersist: (nextCanPersist) => {
      canPersist = nextCanPersist;
    },
  };
};

test('forceVersionCheck validates an unchanged config instead of returning early', async () => {
  const harness = await createHarness(async () => ({ updated_at: 'version-2' }));

  await harness.coordinator.save(
    { value: 'saved' },
    { forceVersionCheck: true }
  );

  assert.deepEqual(harness.calls, [{
    resumeId: 'resume-1',
    config: { value: 'saved' },
    expected: 'version-1',
  }]);
});

test('a flush waits for an identical in-flight autosave without issuing a duplicate PATCH', async () => {
  const first = deferred();
  const harness = await createHarness(() => first.promise);
  const config = { value: 'next' };

  const autoSave = harness.coordinator.save(config);
  await Promise.resolve();
  await Promise.resolve();
  const flush = harness.coordinator.save(config, { forceVersionCheck: true });
  first.resolve({ updated_at: 'version-2' });

  await Promise.all([autoSave, flush]);
  assert.equal(harness.calls.length, 1);
  assert.equal(harness.calls[0].expected, 'version-1');
});

test('a newer flush runs after autosave and uses the returned concurrency token', async () => {
  const first = deferred();
  let callCount = 0;
  const harness = await createHarness(async () => {
    callCount += 1;
    return callCount === 1
      ? first.promise
      : { updated_at: 'version-3' };
  });

  const autoSave = harness.coordinator.save({ value: 'debounced' });
  await Promise.resolve();
  await Promise.resolve();
  const flush = harness.coordinator.save(
    { value: 'latest' },
    { forceVersionCheck: true }
  );
  first.resolve({ updated_at: 'version-2' });

  await Promise.all([autoSave, flush]);
  assert.deepEqual(harness.calls.map((call) => call.expected), [
    'version-1',
    'version-2',
  ]);
});

test('a queued save rechecks the persistence gate when it begins executing', async () => {
  const first = deferred();
  const harness = await createHarness(() => first.promise);

  const firstSave = harness.coordinator.save({ value: 'first' });
  await Promise.resolve();
  await Promise.resolve();
  const queuedSave = harness.coordinator.save({ value: 'queued' });
  harness.setCanPersist(false);
  first.reject(new Error('version conflict'));

  await assert.rejects(firstSave, /version conflict/);
  await assert.rejects(queuedSave, /persistence blocked/);

  assert.equal(harness.calls.length, 1);
  assert.deepEqual(harness.calls[0].config, { value: 'first' });
});

test('a save pending for another resume cannot satisfy the current resume version barrier', async () => {
  const first = deferred();
  let callCount = 0;
  const harness = await createHarness(async () => {
    callCount += 1;
    return callCount === 1
      ? first.promise
      : { updated_at: 'resume-2-version-2' };
  });

  const oldResumeSave = harness.coordinator.save({ value: 'old-resume-change' });
  await Promise.resolve();
  await Promise.resolve();
  harness.setResumeId('resume-2');
  const currentBarrier = harness.coordinator.save(
    { value: 'saved' },
    { forceVersionCheck: true }
  );
  first.resolve({ updated_at: 'resume-1-version-2' });

  const [oldReceipt, currentReceipt] = await Promise.all([oldResumeSave, currentBarrier]);
  assert.equal(oldReceipt, undefined);
  assert.deepEqual(currentReceipt, {
    resumeId: 'resume-2',
    configSignature: JSON.stringify({ value: 'saved' }),
  });
  assert.equal(harness.calls.length, 2);
  assert.equal(harness.calls[1].resumeId, 'resume-2');
});

test('drain waits for an in-flight save and hydration blocks its stale success callback', async () => {
  const first = deferred();
  const harness = await createHarness(() => first.promise);

  const save = harness.coordinator.save({ value: 'next' });
  await Promise.resolve();
  await Promise.resolve();
  harness.setHydrated(false);
  let drained = false;
  const drain = harness.coordinator.drain().then(() => {
    drained = true;
  });

  await Promise.resolve();
  assert.equal(drained, false);
  first.resolve({ updated_at: 'version-2' });
  const [receipt] = await Promise.all([save, drain]);
  assert.equal(receipt, undefined);

  harness.setHydrated(true);
  await harness.coordinator.save(
    { value: 'saved' },
    { forceVersionCheck: true }
  );
  assert.equal(harness.calls[1].expected, 'version-1');
});

test('an older save acknowledgement advances the version without replacing a newer local config', async () => {
  const { createResumeConfigSaveCoordinator } = await importCoordinator();
  const { mergeResumeSaveResultIntoDetail } = await importSaveResultUtils();
  const first = deferred();
  const configs = {
    backend: { jdAnalysis: { jdText: 'backend' } },
    first: { jdAnalysis: { jdText: 'first local edit' } },
    latest: { jdAnalysis: { jdText: 'latest local edit' } },
  };
  let latestConfig = configs.first;
  let expectedUpdatedAt = 'version-1';
  let lastSavedSignature = JSON.stringify(configs.backend);
  let detail = {
    resume: {
      id: 'resume-1',
      user_id: 'user-1',
      title: 'Resume',
      config: configs.backend,
      created_at: 'version-1',
      updated_at: 'version-1',
    },
    experiences: [],
  };
  const calls = [];
  const coordinator = createResumeConfigSaveCoordinator({
    getResumeId: () => 'resume-1',
    getExpectedUpdatedAt: () => expectedUpdatedAt,
    getLastSavedSignature: () => lastSavedSignature,
    isHydrated: () => true,
    persist: async (_resumeId, config, expected) => {
      calls.push({ config, expected });
      if (calls.length === 1) return first.promise;
      return { ...detail.resume, config, updated_at: 'version-3' };
    },
    onSaveStart: () => undefined,
    onSaveSuccess: (_resumeId, result, signature) => {
      expectedUpdatedAt = result.updated_at;
      detail = mergeResumeSaveResultIntoDetail(detail, result, {
        savedConfigSignature: signature,
        latestConfigSignature: JSON.stringify(latestConfig),
      });
      lastSavedSignature = signature;
    },
  });

  const firstSave = coordinator.save(configs.first);
  await Promise.resolve();
  await Promise.resolve();
  latestConfig = configs.latest;
  first.resolve({
    ...detail.resume,
    config: configs.first,
    updated_at: 'version-2',
  });
  await firstSave;

  assert.deepEqual(detail.resume.config, configs.backend);
  assert.equal(detail.resume.updated_at, 'version-2');
  assert.equal(lastSavedSignature, JSON.stringify(configs.first));

  await coordinator.save(configs.latest);

  assert.deepEqual(calls.map((call) => call.expected), ['version-1', 'version-2']);
  assert.deepEqual(detail.resume.config, configs.latest);
  assert.equal(detail.resume.updated_at, 'version-3');
});

test('a current save acknowledgement still adopts the returned config', async () => {
  const { mergeResumeSaveResultIntoDetail } = await importSaveResultUtils();
  const backendConfig = { jdAnalysis: { jdText: 'backend' } };
  const savedConfig = { jdAnalysis: { jdText: 'saved' } };
  const detail = {
    resume: {
      id: 'resume-1',
      user_id: 'user-1',
      title: 'Resume',
      config: backendConfig,
      created_at: 'version-1',
      updated_at: 'version-1',
    },
    experiences: [],
  };

  const merged = mergeResumeSaveResultIntoDetail(
    detail,
    { ...detail.resume, config: savedConfig, updated_at: 'version-2' },
    {
      savedConfigSignature: JSON.stringify(savedConfig),
      latestConfigSignature: JSON.stringify(savedConfig),
    }
  );

  assert.deepEqual(merged.resume.config, savedConfig);
  assert.equal(merged.resume.updated_at, 'version-2');
});

test('a pending JD cache protects a newer local payload before the latest config ref catches up', async () => {
  const { mergeResumeSaveResultIntoDetail } = await importSaveResultUtils();
  const backendJD = {
    jdText: 'backend',
    experienceSignature: 'backend-signature',
    result: { match_score: 10 },
    itemSignatures: { experiences: {}, certifications: {}, skills: {} },
    inputMode: 'text',
    updatedAt: 'version-1',
  };
  const firstJD = {
    ...backendJD,
    jdText: 'first local edit',
    experienceSignature: 'first-signature',
    updatedAt: 'version-2',
  };
  const latestJD = {
    ...backendJD,
    jdText: 'latest local edit',
    experienceSignature: 'latest-signature',
    updatedAt: 'version-3',
  };
  const backendConfig = { jdAnalysis: backendJD };
  const firstConfig = { jdAnalysis: firstJD };
  const detail = {
    resume: {
      id: 'resume-1',
      user_id: 'user-1',
      title: 'Resume',
      config: backendConfig,
      created_at: 'version-1',
      updated_at: 'version-1',
    },
    experiences: [],
  };

  const merged = mergeResumeSaveResultIntoDetail(
    detail,
    { ...detail.resume, config: firstConfig, updated_at: 'version-2' },
    {
      savedConfigSignature: JSON.stringify(firstConfig),
      latestConfigSignature: JSON.stringify(firstConfig),
      pendingJDAnalysisCache: {
        payload: latestJD,
        pendingSync: true,
        basePersistedFingerprint: JSON.stringify(backendJD),
      },
      savedJDAnalysis: firstJD,
    }
  );

  assert.deepEqual(merged.resume.config, firstConfig);
  assert.equal(merged.resume.updated_at, 'version-2');
});

test('a stale save acknowledgement advances JD authority before a newer pending cache is resolved', async () => {
  const { mergeResumeSaveResultIntoDetail } = await importSaveResultUtils();
  const {
    buildJDAnalysisPersistenceFingerprint,
    graftJDAnalysisAuthority,
    resolveJDAnalysisForConfigSnapshot,
    selectPreferredPersistedJDAnalysis,
  } = await importJDAnalysisStorage();
  const baseJD = {
    jdText: 'B0',
    experienceSignature: 'B0-signature',
    result: { match_score: 10 },
    itemSignatures: { experiences: {}, certifications: {}, skills: {} },
    inputMode: 'text',
    updatedAt: 'version-1',
  };
  const savedJD = {
    ...baseJD,
    jdText: 'P1',
    experienceSignature: 'P1-signature',
    updatedAt: 'version-2',
  };
  const pendingJD = {
    ...baseJD,
    jdText: 'P2',
    experienceSignature: 'P2-signature',
    updatedAt: 'version-3',
  };
  const pendingCache = {
    payload: pendingJD,
    pendingSync: true,
    basePersistedFingerprint: buildJDAnalysisPersistenceFingerprint(baseJD),
  };
  const draftConfig = { personalSummary: 'keep this unsaved draft', jdAnalysis: pendingJD };
  const latestConfigSnapshot = {
    personalSummary: 'newer ordinary draft',
    jdAnalysis: pendingJD,
  };
  const detail = {
    resume: {
      id: 'resume-1',
      user_id: 'user-1',
      title: 'Resume',
      config: draftConfig,
      created_at: 'version-1',
      updated_at: 'version-1',
    },
    experiences: [],
  };

  const merged = mergeResumeSaveResultIntoDetail(
    detail,
    { ...detail.resume, config: { jdAnalysis: savedJD }, updated_at: 'version-2' },
    {
      savedConfigSignature: JSON.stringify({ jdAnalysis: savedJD }),
      latestConfigSignature: JSON.stringify(latestConfigSnapshot),
      latestConfigSnapshot,
      pendingJDAnalysisCache: pendingCache,
      savedJDAnalysis: savedJD,
    }
  );

  assert.equal(merged.resume.config.personalSummary, 'newer ordinary draft');
  assert.deepEqual(merged.resume.config.jdAnalysis, savedJD);
  const decision = selectPreferredPersistedJDAnalysis(
    merged.resume.config.jdAnalysis,
    pendingCache
  );
  assert.equal(decision.kind, 'pending_conflict');
  assert.deepEqual(
    graftJDAnalysisAuthority({ personalSummary: 'next draft', jdAnalysis: pendingJD },
      resolveJDAnalysisForConfigSnapshot(merged.resume.config.jdAnalysis, pendingCache)),
    { personalSummary: 'next draft', jdAnalysis: savedJD }
  );
});

test('a JD snapshot queued before an earlier acknowledgement is re-resolved when it executes', async () => {
  const { createResumeConfigSaveCoordinator } = await importCoordinator();
  const {
    buildJDAnalysisPersistenceFingerprint,
    graftJDAnalysisAuthority,
    resolveJDAnalysisForConfigSnapshot,
    selectPreferredPersistedJDAnalysis,
  } = await importJDAnalysisStorage();
  const firstResponse = deferred();
  const baseJD = {
    jdText: 'B0',
    experienceSignature: 'B0-signature',
    result: { match_score: 10 },
    itemSignatures: { experiences: {}, certifications: {}, skills: {} },
    inputMode: 'text',
    updatedAt: 'version-1',
  };
  const firstJD = {
    ...baseJD,
    jdText: 'P1',
    experienceSignature: 'P1-signature',
    updatedAt: 'version-2',
  };
  const secondJD = {
    ...baseJD,
    jdText: 'P2',
    experienceSignature: 'P2-signature',
    updatedAt: 'version-3',
  };
  let pendingCache = {
    payload: firstJD,
    pendingSync: true,
    basePersistedFingerprint: buildJDAnalysisPersistenceFingerprint(baseJD),
  };
  let serverJD = baseJD;
  let expectedUpdatedAt = 'resume-version-1';
  let lastSavedSignature = JSON.stringify({ jdAnalysis: baseJD });
  const calls = [];
  const coordinator = createResumeConfigSaveCoordinator({
    getResumeId: () => 'resume-1',
    getExpectedUpdatedAt: () => expectedUpdatedAt,
    getLastSavedSignature: () => lastSavedSignature,
    isHydrated: () => true,
    prepareConfig: (_resumeId, config) => graftJDAnalysisAuthority(
      config,
      resolveJDAnalysisForConfigSnapshot(serverJD, pendingCache),
    ),
    persist: async (_resumeId, config, expected) => {
      calls.push({ config, expected });
      if (calls.length > 1) {
        throw new Error('queued P2 must not reach persistence');
      }
      return firstResponse.promise;
    },
    onSaveStart: () => undefined,
    onSaveSuccess: (_resumeId, result, signature) => {
      serverJD = result.config.jdAnalysis;
      expectedUpdatedAt = result.updated_at;
      lastSavedSignature = signature;
    },
  });

  const firstSave = coordinator.save({ jdAnalysis: firstJD });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(calls.length, 1);
  pendingCache = {
    payload: secondJD,
    pendingSync: true,
    basePersistedFingerprint: buildJDAnalysisPersistenceFingerprint(baseJD),
  };
  const boundary = await createSaveBoundaryHarness({
    coordinator,
    getServerJD: () => serverJD,
    getPendingCache: () => pendingCache,
    getToken: () => expectedUpdatedAt,
    getSavedSignature: () => lastSavedSignature,
    config: { jdAnalysis: secondJD },
  });
  const queuedSecondSave = boundary.saveResumeConfig({ jdAnalysis: secondJD });
  firstResponse.resolve({
    id: 'resume-1',
    config: { jdAnalysis: firstJD },
    updated_at: 'resume-version-2',
  });
  const [, committedToken] = await Promise.all([firstSave, queuedSecondSave]);

  assert.equal(committedToken, 'resume-version-2');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    config: { jdAnalysis: firstJD },
    expected: 'resume-version-1',
  });
  assert.equal(
    selectPreferredPersistedJDAnalysis(serverJD, pendingCache).kind,
    'pending_conflict',
  );
  assert.equal(pendingCache.payload, secondJD);
});

test('a queued ordinary edit persists with the latest JD authority and version token', async () => {
  const { createResumeConfigSaveCoordinator } = await importCoordinator();
  const {
    buildJDAnalysisPersistenceFingerprint,
    graftJDAnalysisAuthority,
    resolveJDAnalysisForConfigSnapshot,
    selectPreferredPersistedJDAnalysis,
  } = await importJDAnalysisStorage();
  const firstResponse = deferred();
  const baseJD = {
    jdText: 'B0',
    experienceSignature: 'B0-signature',
    result: { match_score: 10 },
    itemSignatures: { experiences: {}, certifications: {}, skills: {} },
    inputMode: 'text',
    updatedAt: 'version-1',
  };
  const firstJD = {
    ...baseJD,
    jdText: 'P1',
    experienceSignature: 'P1-signature',
    updatedAt: 'version-2',
  };
  const secondJD = {
    ...baseJD,
    jdText: 'P2',
    experienceSignature: 'P2-signature',
    updatedAt: 'version-3',
  };
  let pendingCache = {
    payload: firstJD,
    pendingSync: true,
    basePersistedFingerprint: buildJDAnalysisPersistenceFingerprint(baseJD),
  };
  let serverJD = baseJD;
  let expectedUpdatedAt = 'resume-version-1';
  let lastSavedSignature = JSON.stringify({ jdAnalysis: baseJD });
  const calls = [];
  const successSignatures = [];
  const coordinator = createResumeConfigSaveCoordinator({
    getResumeId: () => 'resume-1',
    getExpectedUpdatedAt: () => expectedUpdatedAt,
    getLastSavedSignature: () => lastSavedSignature,
    isHydrated: () => true,
    prepareConfig: (_resumeId, config) => graftJDAnalysisAuthority(
      config,
      resolveJDAnalysisForConfigSnapshot(serverJD, pendingCache),
    ),
    persist: async (_resumeId, config, expected) => {
      calls.push({ config, expected });
      if (calls.length === 1) return firstResponse.promise;
      return {
        id: 'resume-1',
        config,
        updated_at: 'resume-version-3',
      };
    },
    onSaveStart: () => undefined,
    onSaveSuccess: (_resumeId, result, signature) => {
      serverJD = result.config.jdAnalysis;
      expectedUpdatedAt = result.updated_at;
      lastSavedSignature = signature;
      successSignatures.push(signature);
    },
  });

  const firstSave = coordinator.save({ jdAnalysis: firstJD });
  await Promise.resolve();
  await Promise.resolve();
  pendingCache = {
    payload: secondJD,
    pendingSync: true,
    basePersistedFingerprint: buildJDAnalysisPersistenceFingerprint(baseJD),
  };
  const queuedConfig = {
    personalSummary: 'new ordinary draft',
    jdAnalysis: secondJD,
  };
  const boundary = await createSaveBoundaryHarness({
    coordinator,
    getServerJD: () => serverJD,
    getPendingCache: () => pendingCache,
    getToken: () => expectedUpdatedAt,
    getSavedSignature: () => lastSavedSignature,
    config: queuedConfig,
  });
  const queuedSecondSave = boundary.flushResumeConfig();
  firstResponse.resolve({
    id: 'resume-1',
    config: { jdAnalysis: firstJD },
    updated_at: 'resume-version-2',
  });
  const [, committedToken] = await Promise.all([firstSave, queuedSecondSave]);

  assert.equal(committedToken, 'resume-version-3');
  assert.deepEqual(boundary.saveStates, []);
  const preparedSecondConfig = {
    personalSummary: 'new ordinary draft',
    jdAnalysis: firstJD,
  };
  assert.deepEqual(calls, [
    { config: { jdAnalysis: firstJD }, expected: 'resume-version-1' },
    { config: preparedSecondConfig, expected: 'resume-version-2' },
  ]);
  assert.equal(successSignatures[1], JSON.stringify(preparedSecondConfig));
  assert.notEqual(successSignatures[1], JSON.stringify(queuedConfig));
  assert.equal(
    selectPreferredPersistedJDAnalysis(serverJD, pendingCache).kind,
    'pending_conflict',
  );
  assert.equal(pendingCache.payload, secondJD);
});

test('a stale save acknowledgement can atomically clear JD authority while keeping ordinary drafts', async () => {
  const { mergeResumeSaveResultIntoDetail } = await importSaveResultUtils();
  const draftJD = { jdText: 'local draft' };
  const detail = {
    resume: {
      id: 'resume-1',
      user_id: 'user-1',
      title: 'Resume',
      config: { personalSummary: 'keep this draft', jdAnalysis: draftJD },
      created_at: 'version-1',
      updated_at: 'version-1',
    },
    experiences: [],
  };

  const merged = mergeResumeSaveResultIntoDetail(
    detail,
    { ...detail.resume, config: {}, updated_at: 'version-2' },
    {
      savedConfigSignature: JSON.stringify({}),
      latestConfigSignature: JSON.stringify({ personalSummary: 'newer draft', jdAnalysis: draftJD }),
      savedJDAnalysis: null,
    }
  );

  assert.deepEqual(merged.resume.config, { personalSummary: 'keep this draft' });
});

test('save acknowledgements snapshot mutable authorities before the React state updater', () => {
  const source = readFileSync('hooks/useResumeData.ts', 'utf8');
  const callback = source.match(
    /onSaveSuccess: \(_resumeId, updatedResume, configSignature\) => \{[\s\S]*?state\.setLastSavedAt/,
  )?.[0] ?? '';
  const setterIndex = callback.indexOf('state.setResumeDetail');

  assert.ok(setterIndex > 0);
  assert.ok(callback.indexOf('loadJDAnalysisCache(options.authUserKey, _resumeId)') < setterIndex);
  assert.ok(callback.indexOf('normalizeJDAnalysisPersistence(') < setterIndex);
  assert.ok(callback.indexOf('latestServerJDAnalysisRef.current =') < setterIndex);
  assert.ok(callback.indexOf('latestEffectiveConfigSnapshotRef.current') < setterIndex);
  const mergeCall = callback.match(
    /mergeResumeSaveResultIntoDetail\([\s\S]*?\n\s*\}\s*\n\s*\)\)/,
  )?.[0] ?? '';
  assert.match(mergeCall, /savedConfigSignature: configSignature/);
  assert.match(mergeCall, /latestConfigSignature,/);
  assert.match(mergeCall, /latestConfigSnapshot,/);
  assert.match(mergeCall, /pendingJDAnalysisCache,/);
  assert.match(mergeCall, /savedJDAnalysis,/);
  assert.match(source, /prepareConfig: \(resumeId, config\) => \{[\s\S]*?latestServerJDAnalysisRef\.current[\s\S]*?resolveJDAnalysisForConfigSnapshot/);
  assert.doesNotMatch(
    callback.slice(setterIndex),
    /loadJDAnalysisCache|normalizeJDAnalysisPersistence|latestEffectiveConfigSnapshotRef\.current/,
  );
});
