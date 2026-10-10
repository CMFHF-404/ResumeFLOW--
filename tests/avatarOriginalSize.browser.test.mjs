import assert from 'node:assert/strict';
import { randomFillSync } from 'node:crypto';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import sharp from 'sharp';

test('large originals fit the profile request budget and retain the whole recrop source', async () => {
  const { outputFiles } = await build({
    stdin: {
      contents: `
        import { profileService } from './services/profileService';
        import { resolveAvatarCropSource, MAX_AVATAR_ORIGINAL_DATA_URL_LENGTH } from './services/avatarImage';
        window.saveProfile = profileService.updateProfile;
        window.recropSource = resolveAvatarCropSource;
        window.backupLimit = MAX_AVATAR_ORIGINAL_DATA_URL_LENGTH;
        window.owner = 'user-a';
        window.patchCalls = [];
        window.revisionBumps = 0;
      `,
      loader: 'ts',
      resolveDir: process.cwd(),
    },
    bundle: true, write: false, platform: 'browser', format: 'iife',
    plugins: [{ name: 'profile-transport', setup(builder) {
      builder.onResolve({ filter: /^\.\/apiClient$/ }, () => ({ path: 'api', namespace: 'fixture' }));
      builder.onResolve({ filter: /^\.\/resumePreviewDataRevision$/ }, () => ({ path: 'revision', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
        contents: path === 'revision'
          ? 'export const bumpResumePreviewDataRevision = () => { window.revisionBumps += 1; };'
          : `
            export class AuthContextChangedError extends Error {}
            export const assertAuthCacheKey = async owner => {
              if (owner !== window.owner) throw new AuthContextChangedError();
            };
            export const captureAuthCacheKey = async expected => {
              const owner = expected ?? window.owner;
              await assertAuthCacheKey(owner);
              return owner;
            };
            export default { patch: async (url, payload, options) => {
              await assertAuthCacheKey(options.expectedAuthCacheKey);
              window.patchCalls.push({url, payload, options});
              return {data: {...payload, user_id: window.owner, updated_at: '2026-10-10T00:00:00Z'}};
            } };
          `,
        loader: 'js',
      }));
    } }],
  });
  const width = 1500;
  const height = 2000;
  const pixels = randomFillSync(Buffer.alloc(width * height * 3));
  for (let pixel = 0; pixel < width * 60; pixel += 1) {
    pixels[pixel * 3] = 255;
    pixels[pixel * 3 + 1] = 0;
    pixels[pixel * 3 + 2] = 0;
    const bottom = width * (height - 60) + pixel;
    pixels[bottom * 3] = 0;
    pixels[bottom * 3 + 1] = 0;
    pixels[bottom * 3 + 2] = 255;
  }
  const original = await sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer();
  const source = 'data:image/png;base64,' + original.toString('base64');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><body></body>');
    await page.addScriptTag({ content: outputFiles[0].text });
    const result = await page.evaluate(async source => {
      const image = new Image(); image.src = source; await image.decode();
      const crop = document.createElement('canvas'); crop.width = 384; crop.height = 512;
      crop.getContext('2d').drawImage(image, 0, 0, 384, 512);
      const croppedSource = crop.toDataURL('image/jpeg', 0.85);
      const extras = { private_note: 'keep', resume_template_presets: {minimal: {theme: 'blue'}},
        avatar_data_url: croppedSource, avatar_original_data_url: source };
      const input = { full_name: 'Example', expected_updated_at: '2026-10-09T00:00:00Z', extra_json: extras };
      const saved = await window.saveProfile(input, { expectedAuthCacheKey: 'user-a' });
      const first = window.patchCalls[0];
      const backup = window.recropSource(saved.extra_json, croppedSource);
      const prepared = new Image(); prepared.src = backup; await prepared.decode();
      const canvas = document.createElement('canvas');
      canvas.width = prepared.naturalWidth; canvas.height = prepared.naturalHeight;
      const context = canvas.getContext('2d'); context.drawImage(prepared, 0, 0);
      const top = [...context.getImageData(Math.floor(canvas.width / 2), 5, 1, 1).data];
      const bottom = [...context.getImageData(Math.floor(canvas.width / 2), canvas.height - 6, 1, 1).data];
      await window.saveProfile({ ...input, extra_json: saved.extra_json }, { expectedAuthCacheKey: 'user-a' });
      let invalidImageError = '';
      try {
        await window.saveProfile({ extra_json: {
          avatar_original_data_url: 'data:image/png;base64,' + 'A'.repeat(1_500_000),
        } }, { expectedAuthCacheKey: 'user-a' });
      } catch (error) {
        invalidImageError = error.message;
      }
      return {
        originalRequestBytes: new TextEncoder().encode(JSON.stringify(input)).length,
        preparedRequestBytes: new TextEncoder().encode(JSON.stringify(first.payload)).length,
        backupLength: backup.length, backupLimit: window.backupLimit,
        width: canvas.width, height: canvas.height, top, bottom,
        extrasPreserved: first.payload.extra_json.private_note === extras.private_note
          && JSON.stringify(first.payload.extra_json.resume_template_presets) === JSON.stringify(extras.resume_template_presets),
        cropPreserved: first.payload.extra_json.avatar_data_url === croppedSource,
        inputUnchanged: input.extra_json === extras && extras.avatar_original_data_url === source,
        owner: first.options.expectedAuthCacheKey, url: first.url,
        fullName: first.payload.full_name, expectedUpdatedAt: first.payload.expected_updated_at,
        backupStable: window.patchCalls[1].payload.extra_json.avatar_original_data_url === backup,
        writes: window.patchCalls.length, revisionBumps: window.revisionBumps, invalidImageError,
      };
    }, source);
    assert.ok(result.originalRequestBytes > 10 * 1024 * 1024, 'reproduces the original nginx request failure');
    assert.ok(result.preparedRequestBytes < 2 * 1024 * 1024, 'leaves room for the other profile fields');
    assert.ok(result.backupLength <= result.backupLimit);
    assert.ok(Math.max(result.width, result.height) <= 2048);
    assert.ok(Math.abs(result.width / result.height - width / height) < 0.002, 'keeps the full source aspect ratio');
    assert.ok(result.top[0] > 240 && result.top[1] < 15 && result.top[2] < 15, 'retains the top edge');
    assert.ok(result.bottom[2] > 240 && result.bottom[0] < 15 && result.bottom[1] < 15, 'retains the bottom edge');
    assert.equal(result.extrasPreserved, true);
    assert.equal(result.cropPreserved, true);
    assert.equal(result.inputUnchanged, true);
    assert.equal(result.backupStable, true, 'subsequent saves do not recompress a bounded backup');
    assert.equal(result.owner, 'user-a');
    assert.equal(result.url, '/profile');
    assert.equal(result.fullName, 'Example');
    assert.equal(result.expectedUpdatedAt, '2026-10-09T00:00:00Z');
    assert.equal(result.writes, 2);
    assert.equal(result.revisionBumps, 2);
    assert.match(result.invalidImageError, /头像原图加载失败/, 'failed compression never sends the oversized backup');
    process.stdout.write(`Original profile request ${result.originalRequestBytes} bytes; prepared request ${result.preparedRequestBytes} bytes.\n`);
  } finally {
    await browser.close();
  }
});
