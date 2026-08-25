import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import { build } from 'esbuild';

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const createToken = (owner) => {
  const payload = Buffer.from(JSON.stringify({
    sub: owner,
    exp: Math.floor(Date.now() / 1000) + 3600,
  })).toString('base64url');
  return `header.${payload}.signature`;
};

const importAuthTokenProvider = async () => {
  const result = await build({
    entryPoints: ['services/authTokenProvider.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const encoded = Buffer.from(result.outputFiles[0].text).toString('base64');
  return import(`data:text/javascript;base64,${encoded}#${Date.now()}-${Math.random()}`);
};

test('session epoch changes on provider/session owner transitions but not same-owner refresh', async () => {
  const provider = await importAuthTokenProvider();
  const tokenA = createToken('owner-a');
  provider.setAuthTokenProvider(async () => tokenA);
  const installed = provider.readAuthSessionSnapshot();
  assert.equal(installed.ownerKey, null);

  assert.equal(await provider.requestAuthToken(), tokenA);
  const established = provider.readAuthSessionSnapshot();
  assert.equal(established.ownerKey, 'owner-a');
  assert.ok(established.epoch > installed.epoch);

  assert.equal(await provider.requestAuthToken(), tokenA);
  assert.deepEqual(provider.readAuthSessionSnapshot(), established);

  provider.clearAuthTokenProvider();
  const cleared = provider.readAuthSessionSnapshot();
  assert.equal(cleared.ownerKey, null);
  assert.ok(cleared.epoch > established.epoch);

  provider.setAuthTokenProvider(async () => tokenA);
  const sameOwnerReloginInstalled = provider.readAuthSessionSnapshot();
  assert.ok(sameOwnerReloginInstalled.epoch > cleared.epoch);
  assert.equal(await provider.requestAuthToken(), tokenA);
  const sameOwnerReloginEstablished = provider.readAuthSessionSnapshot();
  assert.equal(sameOwnerReloginEstablished.ownerKey, 'owner-a');
  assert.ok(sameOwnerReloginEstablished.epoch > sameOwnerReloginInstalled.epoch);
});

test('a later account token wins and an older delayed token cannot roll session state back', async () => {
  const provider = await importAuthTokenProvider();
  const accountA = deferred();
  const accountB = deferred();
  const requests = [accountA.promise, accountB.promise];
  provider.setAuthTokenProvider(() => requests.shift());

  const pendingA = provider.requestAuthToken();
  const pendingB = provider.requestAuthToken();
  accountB.resolve(createToken('owner-b'));
  assert.equal(await pendingB, createToken('owner-b'));
  const accountBSnapshot = provider.readAuthSessionSnapshot();
  assert.equal(accountBSnapshot.ownerKey, 'owner-b');

  accountA.resolve(createToken('owner-a'));
  assert.equal(await pendingA, null);
  assert.deepEqual(provider.readAuthSessionSnapshot(), accountBSnapshot);
});

test('an authoritative owner switch invalidates an older token promise before it can restore that owner', async () => {
  const provider = await importAuthTokenProvider();
  const accountA = deferred();
  provider.setAuthTokenProvider(() => accountA.promise);
  provider.setAuthSessionOwner('owner-a');

  const pendingA = provider.requestAuthToken();
  provider.setAuthSessionOwner('owner-b');
  const accountBSnapshot = provider.readAuthSessionSnapshot();
  accountA.resolve(createToken('owner-a'));

  assert.equal(await pendingA, null);
  assert.deepEqual(provider.readAuthSessionSnapshot(), accountBSnapshot);
});

test('session subscriptions publish stable snapshots only for real authority transitions', async () => {
  const provider = await importAuthTokenProvider();
  const snapshots = [];
  const unsubscribe = provider.subscribeAuthSession(() => {
    snapshots.push(provider.readAuthSessionSnapshot());
  });

  const initial = provider.readAuthSessionSnapshot();
  provider.setAuthSessionOwner(null);
  assert.equal(provider.readAuthSessionSnapshot(), initial);
  assert.equal(snapshots.length, 0);

  provider.setAuthSessionOwner('owner-a');
  const ownerA = provider.readAuthSessionSnapshot();
  assert.notEqual(ownerA, initial);
  assert.deepEqual(snapshots, [ownerA]);

  provider.setAuthSessionOwner('owner-a');
  assert.equal(provider.readAuthSessionSnapshot(), ownerA);
  assert.equal(snapshots.length, 1);

  unsubscribe();
  provider.setAuthSessionOwner('owner-b');
  assert.equal(snapshots.length, 1);
});

test('a transient null token preserves an already established owner', async () => {
  const provider = await importAuthTokenProvider();
  const tokenA = createToken('owner-a');
  const tokens = [tokenA, null];
  provider.setAuthTokenProvider(async () => tokens.shift() ?? null);

  assert.equal(await provider.requestAuthToken(), tokenA);
  const established = provider.readAuthSessionSnapshot();
  assert.equal(established.ownerKey, 'owner-a');

  assert.equal(await provider.requestAuthToken(), null);
  assert.equal(provider.readAuthSessionSnapshot(), established);
});

test('fresh account claims fail closed until the matching token confirms the new owner', async () => {
  const provider = await importAuthTokenProvider();
  const tokenA = createToken('owner-a');
  const tokenB = createToken('owner-b');
  let activeToken = tokenA;
  provider.setAuthTokenProvider(async () => activeToken);

  assert.equal(await provider.requestAuthToken(), tokenA);
  provider.setAuthSessionOwnerFromClaims('owner-a', undefined);
  const ownerASnapshot = provider.readAuthSessionSnapshot();
  assert.equal(ownerASnapshot.ownerKey, 'owner-a');

  provider.setAuthSessionOwnerFromClaims('owner-b', 'owner-a');
  const pendingSnapshot = provider.readAuthSessionSnapshot();
  assert.equal(pendingSnapshot.ownerKey, null);
  assert.ok(pendingSnapshot.epoch > ownerASnapshot.epoch);

  assert.equal(await provider.requestAuthToken(), null);
  assert.deepEqual(provider.readAuthSessionSnapshot(), pendingSnapshot);

  activeToken = tokenB;
  assert.equal(await provider.requestAuthToken(), tokenB);
  const ownerBSnapshot = provider.readAuthSessionSnapshot();
  assert.equal(ownerBSnapshot.ownerKey, 'owner-b');
  assert.ok(ownerBSnapshot.epoch > pendingSnapshot.epoch);
});

test('unchanged stale claims cannot displace a token-confirmed account', async () => {
  const provider = await importAuthTokenProvider();
  const tokenB = createToken('owner-b');
  provider.setAuthTokenProvider(async () => tokenB);
  provider.setAuthSessionOwnerFromClaims('owner-a', undefined);
  assert.equal(await provider.requestAuthToken(), tokenB);
  const ownerBSnapshot = provider.readAuthSessionSnapshot();

  provider.setAuthSessionOwnerFromClaims('owner-a', 'owner-a');
  assert.deepEqual(provider.readAuthSessionSnapshot(), ownerBSnapshot);
});
