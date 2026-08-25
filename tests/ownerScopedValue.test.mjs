import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';

const importOwnerScopedValue = async () => {
  const result = await build({
    entryPoints: ['utils/ownerScopedValue.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}#${Math.random()}`);
};

test('an A cache is never visible or recommitted after the active owner becomes B', async () => {
  const { bindOwnerScopedValue, readOwnerScopedValue } = await importOwnerScopedValue();
  const accountAProfile = { user_id: 'owner-a', full_name: 'Account A' };
  const accountACache = bindOwnerScopedValue(
    'owner-a',
    'owner-a',
    accountAProfile.user_id,
    accountAProfile,
  );

  assert.deepEqual(readOwnerScopedValue('owner-a', accountACache), accountAProfile);
  assert.equal(readOwnerScopedValue('owner-b', accountACache), null);
  assert.equal(
    bindOwnerScopedValue('owner-b', 'owner-a', accountAProfile.user_id, accountAProfile),
    null,
  );
  assert.equal(readOwnerScopedValue('owner-b', accountACache), null);
});

test('cancelled and cross-owner async operations fail closed before storage commits', async () => {
  const { isOwnerOperationCurrent } = await importOwnerScopedValue();

  assert.equal(isOwnerOperationCurrent(false, 'owner-a', 'owner-a'), true);
  assert.equal(isOwnerOperationCurrent(true, 'owner-a', 'owner-a'), false);
  assert.equal(isOwnerOperationCurrent(false, 'owner-b', 'owner-a'), false);
  assert.equal(isOwnerOperationCurrent(false, null, 'owner-a'), false);
});

test('App and ExperienceBank apply owner guards at every sensitive cache and storage seam', () => {
  const app = readFileSync('App.tsx', 'utf8');
  const experienceProfile = readFileSync(
    'views/ExperienceBank/useExperienceBankProfile.ts',
    'utf8',
  );

  assert.match(app, /OwnerScopedValue<Profile>/);
  assert.match(app, /OwnerScopedValue<TokenQuotaSummary>/);
  assert.match(app, /cachedProfile=\{visibleProfileCache\}/);
  assert.match(app, /quotaSummary=\{visibleQuotaSummary\}/);
  assert.match(app, /summary=\{visibleQuotaSummary\}/);
  assert.match(app, /onSummaryChange=\{handleQuotaSummaryChange\}/);
  assert.match(experienceProfile, /cachedProfile\.user_id !== authUserKey/);
  assert.match(experienceProfile, /expectedAuthCacheKey/);
  assert.match(experienceProfile, /resumeService\.list\(\{[\s\S]*?expectedAuthCacheKey/);
  assert.match(
    experienceProfile,
    /if \(!await canCommit\(\)\) return;\s*setActiveResumeId\(expectedAuthCacheKey, firstResume\.id\)/,
  );
});
