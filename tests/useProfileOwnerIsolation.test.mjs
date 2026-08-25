import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';

const importProfileLoadGuard = async () => {
  const result = await build({
    entryPoints: ['hooks/profileLoadGuard.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const source = result.outputFiles[0].text;
  const encoded = Buffer.from(source).toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
};

const deferred = () => {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

test('profile load guard rejects a previous account response that settles after an owner switch', async () => {
  const { createProfileLoadGuard } = await importProfileLoadGuard();
  const guard = createProfileLoadGuard();
  const accountAResponse = deferred();
  const appliedProfiles = [];

  guard.transitionOwner('account-a');
  const accountARequest = guard.beginRequest('account-a');
  assert.ok(accountARequest);

  const settleAccountA = accountAResponse.promise.then((profile) => {
    if (guard.isCurrent(accountARequest)) {
      appliedProfiles.push(profile);
    }
  });

  guard.transitionOwner('account-b');
  const accountBRequest = guard.beginRequest('account-b');
  assert.ok(accountBRequest);
  accountAResponse.resolve({ user_id: 'account-a' });
  await settleAccountA;

  assert.deepEqual(appliedProfiles, []);
  assert.equal(guard.isCurrent(accountARequest), false);
  assert.equal(guard.isCurrent(accountBRequest), true);
});

test('profile load guard fails closed for anonymous and superseded requests', async () => {
  const { createProfileLoadGuard } = await importProfileLoadGuard();
  const guard = createProfileLoadGuard();

  assert.equal(guard.beginRequest('account-a'), null);
  guard.transitionOwner('account-a');
  const firstRequest = guard.beginRequest('account-a');
  const secondRequest = guard.beginRequest('account-a');

  assert.ok(firstRequest);
  assert.ok(secondRequest);
  assert.equal(guard.isCurrent(firstRequest), false);
  assert.equal(guard.isCurrent(secondRequest), true);

  guard.transitionOwner(null);
  assert.equal(guard.isCurrent(secondRequest), false);
  assert.equal(guard.beginRequest('account-a'), null);
});

test('useProfile scopes visible state and async commits to the authenticated owner', () => {
  const source = readFileSync('hooks/useProfile.ts', 'utf8');

  assert.match(source, /const authUserKey = useAuthUserKey\(\)/);
  assert.match(source, /const activeOwnerKey = isAuthenticated \? authUserKey : null/);
  assert.match(source, /loadGuardRef\.current\.transitionOwner\(activeOwnerKey\)/);
  assert.match(source, /loadGuardRef\.current\.isCurrent\(request\)/);
  assert.match(source, /expectedAuthCacheKey: requestedOwnerKey/);
  assert.match(source, /viewState\.ownerKey === activeOwnerKey/);
  assert.match(source, /profile: isViewStateCurrent \? viewState\.profile : null/);
});
