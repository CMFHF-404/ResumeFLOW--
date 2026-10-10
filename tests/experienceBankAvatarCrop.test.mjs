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

test('portrait crop backups preserve the original and unrelated profile extras', async () => {
  const { resolveAvatarCropSource, withAvatarCrop, withoutAvatar, AVATAR_OUTPUT_WIDTH, AVATAR_OUTPUT_HEIGHT } = await loadAvatarImageUtils();
  assert.equal(AVATAR_OUTPUT_WIDTH / AVATAR_OUTPUT_HEIGHT, 3 / 4);
  const original = { private_note: 'keep', avatar_data_url: 'legacy-square' };
  assert.equal(resolveAvatarCropSource(original, 'legacy-square'), 'legacy-square');
  const firstCrop = withAvatarCrop(original, 'full-portrait', 'portrait-crop');
  assert.equal(firstCrop.private_note, 'keep');
  assert.equal(resolveAvatarCropSource(firstCrop, firstCrop.avatar_data_url), 'full-portrait');
  const secondCrop = withAvatarCrop(firstCrop, resolveAvatarCropSource(firstCrop, firstCrop.avatar_data_url), 'recrop');
  assert.equal(secondCrop.avatar_original_data_url, 'full-portrait');
  assert.deepEqual(withoutAvatar(secondCrop), { private_note: 'keep' });
  assert.deepEqual(original, { private_note: 'keep', avatar_data_url: 'legacy-square' });
});

test('bounded original backups do not need browser image processing', async () => {
  const { prepareAvatarOriginalForSave } = await loadAvatarImageUtils();
  const source = 'data:image/png;base64,small-existing-original';
  assert.equal(await prepareAvatarOriginalForSave(source), source);
});

test('an account switch during original compression prevents the profile patch', async (t) => {
  const imageStarted = createDeferred();
  const previousImage = globalThis.Image;
  const previousDocument = globalThis.document;
  let finishImage;
  let writes = 0;
  class FakeImage {
    naturalWidth = 1500;
    naturalHeight = 2000;
    set src(_value) {
      finishImage = () => this.onload();
      imageStarted.resolve();
    }
  }
  globalThis.Image = FakeImage;
  globalThis.document = {
    createElement: () => ({
      getContext: () => ({ fillRect() {}, drawImage() {} }),
      toDataURL: () => 'data:image/jpeg;base64,compressed',
    }),
  };
  globalThis.__profileAuthKey = 'user-a';
  globalThis.__profilePatch = async () => { writes += 1; throw new Error('unexpected write'); };
  t.after(() => {
    globalThis.Image = previousImage;
    globalThis.document = previousDocument;
    delete globalThis.__profileAuthKey;
    delete globalThis.__profilePatch;
  });
  const { profileService } = await loadProfileServiceWithMocks();
  const input = { extra_json: { avatar_original_data_url: 'a'.repeat(1_500_000) } };
  const saving = profileService.updateProfile(input, { expectedAuthCacheKey: 'user-a' });
  await imageStarted.promise;
  globalThis.__profileAuthKey = 'user-b';
  finishImage();
  await assert.rejects(saving, { name: 'AuthContextChangedError' });
  assert.equal(writes, 0);
  assert.equal(input.extra_json.avatar_original_data_url.length, 1_500_000);
});

test('profile reads preserve legacy photos without image processing or implicit writes', async (t) => {
  const profile = {
    user_id: 'user-a', updated_at: '2026-10-10T10:00:00Z',
    extra_json: { avatar_data_url: 'legacy-portrait', private_note: 'keep' },
  };
  const pending = createDeferred();
  let reads = 0;
  let writes = 0;
  globalThis.__profileAuthKey = 'user-a';
  globalThis.__profileGet = async () => { reads += 1; return pending.promise; };
  globalThis.__profilePatch = async () => { writes += 1; throw new Error('unexpected write'); };
  globalThis.__normalizeProfileAvatar = () => { throw new Error('unexpected image processing'); };
  t.after(() => {
    for (const key of ['__profileAuthKey', '__profileGet', '__profilePatch', '__normalizeProfileAvatar']) delete globalThis[key];
  });
  const { profileService } = await loadProfileServiceWithMocks();
  const first = profileService.getProfile();
  const concurrent = profileService.getProfile();
  pending.resolve({ data: profile });
  assert.deepEqual(await Promise.all([first, concurrent]), [profile, profile]);
  assert.equal(await profileService.getProfile(), profile);
  assert.equal(reads, 1);
  assert.equal(await profileService.getProfile({ force: true }), profile);
  assert.equal(reads, 2);
  assert.equal(writes, 0);
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

test('a late profile response from the previous account is discarded', async (t) => {
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
