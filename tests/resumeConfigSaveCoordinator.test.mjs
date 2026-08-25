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

  await Promise.all([oldResumeSave, currentBarrier]);
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
  await Promise.all([save, drain]);

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

  assert.deepEqual(merged.resume.config, backendConfig);
  assert.equal(merged.resume.updated_at, 'version-2');
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
  assert.ok(callback.indexOf('latestEffectiveConfigSnapshotRef.current') < setterIndex);
  const mergeCall = callback.match(
    /mergeResumeSaveResultIntoDetail\([\s\S]*?\n\s*\}\s*\n\s*\)\)/,
  )?.[0] ?? '';
  assert.match(mergeCall, /savedConfigSignature: configSignature/);
  assert.match(mergeCall, /latestConfigSignature,/);
  assert.match(mergeCall, /pendingJDAnalysisCache,/);
  assert.match(mergeCall, /savedJDAnalysis,/);
  assert.doesNotMatch(
    callback.slice(setterIndex),
    /loadJDAnalysisCache|normalizeJDAnalysisPersistence|latestEffectiveConfigSnapshotRef\.current/,
  );
});
