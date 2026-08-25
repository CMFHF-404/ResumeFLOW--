import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';

const rootDir = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const read = (path) => readFileSync(join(rootDir, path), 'utf8');
let profileServiceImportSequence = 0;

const createDeferred = () => {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const loadAvatarImageUtils = async () => {
  const result = await build({
    absWorkingDir: rootDir,
    entryPoints: ['services/avatarImage.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
  });
  const outputText = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
};

const loadProfileServiceWithMocks = async () => {
  const result = await build({
    absWorkingDir: rootDir,
    entryPoints: ['services/profileService.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    plugins: [
      {
        name: 'profile-service-test-stubs',
        setup(buildContext) {
          buildContext.onResolve({ filter: /^axios$/ }, () => ({
            path: 'axios-stub',
            namespace: 'stub',
          }));
          buildContext.onResolve({ filter: /^\.\/apiClient$/ }, () => ({
            path: 'api-client-stub',
            namespace: 'stub',
          }));
          buildContext.onResolve({ filter: /^\.\/avatarImage$/ }, () => ({
            path: 'avatar-image-stub',
            namespace: 'stub',
          }));
          buildContext.onResolve({ filter: /^\.\/resumePreviewDataRevision$/ }, () => ({
            path: 'preview-revision-stub',
            namespace: 'stub',
          }));
          buildContext.onLoad({ filter: /^axios-stub$/, namespace: 'stub' }, () => ({
            contents: `export default { isAxiosError: (error) => error?.isAxiosError === true };`,
            loader: 'js',
          }));
          buildContext.onLoad({ filter: /^api-client-stub$/, namespace: 'stub' }, () => ({
            contents: `
              export class AuthContextChangedError extends Error {
                constructor(message = 'Authentication context changed during operation') {
                  super(message);
                  this.name = 'AuthContextChangedError';
                }
              }
              export const isAuthContextChangedError = (error) => (
                error?.name === 'AuthContextChangedError'
              );
              export const captureAuthCacheKey = async (expected) => {
                const owner = expected ?? globalThis.__profileAuthKey;
                if (owner !== globalThis.__profileAuthKey) {
                  throw new AuthContextChangedError('Authentication context changed before profile update');
                }
                return owner;
              };
              export const assertAuthCacheKey = async (expected) => {
                if (expected !== globalThis.__profileAuthKey) {
                  throw new AuthContextChangedError();
                }
              };
              export default {
                get: (...args) => globalThis.__profileGet(...args),
                patch: (...args) => globalThis.__profilePatch(...args),
              };
            `,
            loader: 'js',
          }));
          buildContext.onLoad({ filter: /^avatar-image-stub$/, namespace: 'stub' }, () => ({
            contents: `
              export const normalizeAvatarImageToSquare = (source) => (
                globalThis.__normalizeProfileAvatar(source)
              );
            `,
            loader: 'js',
          }));
          buildContext.onLoad({ filter: /^preview-revision-stub$/, namespace: 'stub' }, () => ({
            contents: `
              export const bumpResumePreviewDataRevision = () => {
                globalThis.__profilePreviewRevisionBumps += 1;
              };
            `,
            loader: 'js',
          }));
        },
      },
    ],
  });
  const outputText = result.outputFiles[0].text;
  profileServiceImportSequence += 1;
  return import(
    `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}#profile-service-${profileServiceImportSequence}`
  );
};

test('Experience Bank avatar upload crops and stores a square image', () => {
  const cropSource = read('components/ImageCropModal.tsx');
  const profileSource = read('views/ExperienceBank/useExperienceBankProfile.ts');

  assert.match(cropSource, /const CROP_FRAME_WIDTH = 240;/);
  assert.match(cropSource, /const CROP_FRAME_HEIGHT = 240;/);
  assert.match(cropSource, /const OUTPUT_WIDTH = 512;/);
  assert.match(cropSource, /const OUTPUT_HEIGHT = 512;/);
  assert.match(cropSource, />\s*1 : 1\s*</);
  assert.match(cropSource, /sm: \{ width: 64, height: 64 \}/);
  assert.match(cropSource, /md: \{ width: 96, height: 96 \}/);
  assert.match(cropSource, /className="w-full h-full object-cover"/);

  assert.match(profileSource, /setPendingImageSrc\(src\);\s*setIsCropModalOpen\(true\);/);
  assert.match(profileSource, /handleCropConfirm[\s\S]*?setAvatarDataUrl\(cropDataUrl\);/);
});

test('legacy profile avatars are center-cropped once and persisted for every preview consumer', async () => {
  const { normalizeAvatarImageToSquare, resolveSquareCropBox } = await loadAvatarImageUtils();
  const profileServiceSource = read('services/profileService.ts');

  assert.deepEqual(resolveSquareCropBox(400, 600), {
    sourceX: 0,
    sourceY: 100,
    sourceSize: 400,
  });
  assert.deepEqual(resolveSquareCropBox(800, 400), {
    sourceX: 200,
    sourceY: 0,
    sourceSize: 400,
  });
  assert.equal(await normalizeAvatarImageToSquare('data:image/jpeg;base64,node-no-dom'), 'data:image/jpeg;base64,node-no-dom');

  assert.match(profileServiceSource, /normalizeAvatarImageToSquare\(candidateAvatarSource\)/);
  assert.match(profileServiceSource, /avatar_data_url: normalizedAvatar/);
  assert.match(profileServiceSource, /expected_updated_at: candidateProfile\.updated_at/);
  assert.match(profileServiceSource, /isProfileUpdateConflict\(error\)/);
  assert.match(profileServiceSource, /requestProfile\(ownerKeyAtStart\)/);
  assert.match(profileServiceSource, /cacheRevision !== cacheRevisionAtStart/);
  assert.match(profileServiceSource, /expectedAuthCacheKey: ownerKeyAtStart/);
  assert.match(profileServiceSource, /cacheRevision === cacheRevisionAtStart/);
  assert.match(profileServiceSource, /return normalizeAndPersistProfileAvatar\(cachedProfile\)/);
  assert.match(profileServiceSource, /return normalizeAndPersistProfileAvatar\(await inFlightProfileRequest\)/);
  assert.match(profileServiceSource, /return await normalizeAndPersistProfileAvatar\(await guardedPromise\)/);
  assert.match(profileServiceSource, /bumpResumePreviewDataRevision\(\)/);
});

test('profile writes are rejected when the authenticated account changes before dispatch', () => {
  const apiClientSource = read('services/apiClient.ts');
  const profileServiceSource = read('services/profileService.ts');
  const templateStorageSource = read('services/resumeTemplateStorage.ts');

  assert.match(apiClientSource, /config\.expectedAuthCacheKey !== activeAuthCacheKey/);
  assert.match(apiClientSource, /Authentication context changed before request dispatch/);
  assert.match(profileServiceSource, /const expectedOwnerKey = await captureAuthCacheKey\(options\?\.expectedAuthCacheKey\)/);
  assert.match(profileServiceSource, /await assertAuthCacheKey\(expectedOwnerKey\)/);
  assert.match(profileServiceSource, /expectedAuthCacheKey: expectedOwnerKey/);
  assert.match(profileServiceSource, /const pendingAvatarNormalization = inFlightAvatarNormalization/);
  assert.match(profileServiceSource, /ownerKeyAtStart !== activeOwnerKey/);
  assert.match(profileServiceSource, /await pendingAvatarNormalization/);
  assert.match(
    templateStorageSource,
    /getProfile\(\{\s*force: true,\s*expectedAuthCacheKey: ownerId,\s*\}\)/,
  );
  assert.match(
    templateStorageSource,
    /updateProfile\([\s\S]*?\{ expectedAuthCacheKey: ownerId \}\s*\)/,
  );
});

test('a completed account A profile read cannot continue into an account B patch', async (t) => {
  const accountAProfile = {
    user_id: 'user-a',
    extra_json: { private_note: 'account-a-only' },
    updated_at: '2026-08-24T10:00:00Z',
  };
  let accountBProfile = {
    user_id: 'user-b',
    extra_json: { private_note: 'account-b-only' },
    updated_at: '2026-08-24T10:01:00Z',
  };
  const patchCalls = [];
  globalThis.__profileAuthKey = 'user-a';
  globalThis.__profilePreviewRevisionBumps = 0;
  globalThis.__normalizeProfileAvatar = async (source) => source;
  globalThis.__profileGet = async (_url, config) => ({
    data: config?.expectedAuthCacheKey === 'user-a'
      ? accountAProfile
      : accountBProfile,
  });
  globalThis.__profilePatch = async (_url, payload, config) => {
    patchCalls.push({ payload, config });
    accountBProfile = {
      ...accountBProfile,
      extra_json: payload.extra_json,
    };
    return { data: accountBProfile };
  };
  t.after(() => {
    for (const key of [
      '__profileAuthKey',
      '__profilePreviewRevisionBumps',
      '__normalizeProfileAvatar',
      '__profileGet',
      '__profilePatch',
    ]) {
      delete globalThis[key];
    }
  });

  const { profileService } = await loadProfileServiceWithMocks();
  const loadedAccountA = await profileService.getProfile({
    force: true,
    expectedAuthCacheKey: 'user-a',
  });
  assert.equal(loadedAccountA.user_id, 'user-a');

  // Match the logout/account-switch path that clears A's cache before B is active.
  profileService.clearProfileCache();
  globalThis.__profileAuthKey = 'user-b';
  await assert.rejects(
    profileService.updateProfile(
      {
        extra_json: {
          ...loadedAccountA.extra_json,
          resumeTemplatePresets: { 'modern-slate': { themeColorPresetId: 'rose' } },
        },
      },
      { expectedAuthCacheKey: 'user-a' },
    ),
    /Authentication context changed before profile update/,
  );

  assert.equal(patchCalls.length, 0);
  assert.deepEqual(accountBProfile.extra_json, { private_note: 'account-b-only' });
});

test('a late profile response from the previous account is discarded before avatar migration', async (t) => {
  const accountARequest = createDeferred();
  const accountBRequest = createDeferred();
  const patchCalls = [];
  globalThis.__profileAuthKey = 'user-a';
  globalThis.__profilePreviewRevisionBumps = 0;
  globalThis.__normalizeProfileAvatar = async (source) => `square:${source}`;
  globalThis.__profileGet = async (_url, config) => (
    config?.expectedAuthCacheKey === 'user-a'
      ? accountARequest.promise
      : accountBRequest.promise
  );
  globalThis.__profilePatch = async (...args) => {
    patchCalls.push(args);
    return {
      data: {
        user_id: 'user-b',
        extra_json: args[1].extra_json,
        updated_at: '2026-08-01T10:02:00Z',
      },
    };
  };
  t.after(() => {
    for (const key of [
      '__profileAuthKey',
      '__profilePreviewRevisionBumps',
      '__normalizeProfileAvatar',
      '__profileGet',
      '__profilePatch',
    ]) {
      delete globalThis[key];
    }
  });

  const { profileService } = await loadProfileServiceWithMocks();
  const accountARead = profileService.getProfile({ force: true });
  await new Promise((resolve) => setImmediate(resolve));

  globalThis.__profileAuthKey = 'user-b';
  const accountBRead = profileService.getProfile({ force: true });
  await new Promise((resolve) => setImmediate(resolve));

  accountARequest.resolve({
    data: {
      user_id: 'user-a',
      extra_json: {
        avatar_data_url: 'portrait-a',
        private_note: 'account-a-only',
      },
      updated_at: '2026-08-01T10:00:00Z',
    },
  });

  await assert.rejects(
    accountARead,
    /Authentication context changed/,
  );
  assert.equal(patchCalls.length, 0);

  accountBRequest.resolve({
    data: {
      user_id: 'user-b',
      extra_json: {},
      updated_at: '2026-08-01T10:01:00Z',
    },
  });
  const accountBProfile = await accountBRead;
  assert.equal(accountBProfile.user_id, 'user-b');
});

test('avatar migration refetches and preserves newer profile extras after a 409', async (t) => {
  const oldProfile = {
    user_id: 'user-a',
    extra_json: {
      avatar_data_url: 'portrait-avatar',
      resume_template_presets: { 'modern-slate': { theme: 'slate' } },
    },
    updated_at: '2026-08-01T10:00:00Z',
  };
  const latestProfile = {
    ...oldProfile,
    extra_json: {
      avatar_data_url: 'portrait-avatar',
      resume_template_presets: { 'modern-slate': { theme: 'emerald' } },
    },
    updated_at: '2026-08-01T10:01:00Z',
  };
  const getResponses = [oldProfile, latestProfile];
  const patchPayloads = [];
  globalThis.__profileAuthKey = 'user-a';
  globalThis.__profilePreviewRevisionBumps = 0;
  globalThis.__normalizeProfileAvatar = async () => 'square-avatar';
  globalThis.__profileGet = async () => ({ data: getResponses.shift() });
  globalThis.__profilePatch = async (_url, payload) => {
    patchPayloads.push(payload);
    if (patchPayloads.length === 1) {
      const conflict = new Error('stale profile');
      conflict.isAxiosError = true;
      conflict.response = { status: 409 };
      throw conflict;
    }
    return {
      data: {
        ...latestProfile,
        extra_json: payload.extra_json,
        updated_at: '2026-08-01T10:02:00Z',
      },
    };
  };
  t.after(() => {
    for (const key of [
      '__profileAuthKey',
      '__profilePreviewRevisionBumps',
      '__normalizeProfileAvatar',
      '__profileGet',
      '__profilePatch',
    ]) {
      delete globalThis[key];
    }
  });

  const { profileService } = await loadProfileServiceWithMocks();
  const result = await profileService.getProfile({ force: true });

  assert.equal(patchPayloads.length, 2);
  assert.equal(patchPayloads[0].expected_updated_at, oldProfile.updated_at);
  assert.equal(patchPayloads[1].expected_updated_at, latestProfile.updated_at);
  assert.deepEqual(patchPayloads[1].extra_json.resume_template_presets, {
    'modern-slate': { theme: 'emerald' },
  });
  assert.equal(result.extra_json.avatar_data_url, 'square-avatar');
  assert.equal(globalThis.__profilePreviewRevisionBumps, 1);
});

test('legacy portrait pixels are rendered from the centered square crop', async (t) => {
  const { normalizeAvatarImageToSquare } = await loadAvatarImageUtils();
  const previousImage = globalThis.Image;
  const previousDocument = globalThis.document;
  const drawCalls = [];

  class FakeImage {
    naturalWidth = 400;
    naturalHeight = 600;

    set src(_value) {
      queueMicrotask(() => this.onload?.());
    }
  }

  globalThis.Image = FakeImage;
  globalThis.document = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({
        fillStyle: '',
        fillRect: (...args) => drawCalls.push(['fillRect', ...args]),
        drawImage: (...args) => drawCalls.push(['drawImage', ...args.slice(1)]),
      }),
      toDataURL: (type, quality) => `data:${type};quality=${quality}`,
    }),
  };
  t.after(() => {
    globalThis.Image = previousImage;
    globalThis.document = previousDocument;
  });

  const result = await normalizeAvatarImageToSquare('data:image/jpeg;base64,legacy');
  assert.equal(result, 'data:image/jpeg;quality=0.88');
  assert.deepEqual(drawCalls, [
    ['fillRect', 0, 0, 512, 512],
    ['drawImage', 0, 100, 400, 400, 0, 0, 512, 512],
  ]);
});
