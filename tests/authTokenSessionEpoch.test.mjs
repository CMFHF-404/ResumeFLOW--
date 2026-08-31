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

test('invalid-grant errors stay fail-closed for ordinary callers and reach owner verification', async () => {
  const provider = await importAuthTokenProvider();
  const invalidGrant = Object.assign(
    new Error('Authorization request is invalid'),
    { code: 'oidc.invalid_grant' },
  );
  let providerRequests = 0;
  provider.setAuthTokenProvider(async () => {
    providerRequests += 1;
    throw invalidGrant;
  });

  assert.equal(await provider.requestAuthToken(), null);
  await assert.rejects(
    provider.probeAuthTokenForVerification(),
    (error) => error === invalidGrant,
  );
  assert.equal(await provider.requestAuthToken(), null);
  assert.equal(providerRequests, 1, 'a terminal session error suppresses later provider calls');
  assert.equal(provider.readAuthSessionSnapshot().ownerKey, null);

  const recoveredToken = createToken('owner-a');
  provider.setAuthTokenProvider(async () => recoveredToken);
  assert.equal(await provider.requestAuthToken(), recoveredToken);
});

test('a swallowed Logto invalid-grant can mark the session before another provider call', async () => {
  const provider = await importAuthTokenProvider();
  let providerRequests = 0;
  provider.setAuthTokenProvider(async () => {
    providerRequests += 1;
    return null;
  });
  const invalidGrant = Object.assign(new Error('invalid grant'), {
    code: 'oidc.invalid_grant',
  });

  assert.equal(provider.markAuthSessionInvalid(invalidGrant), true);
  assert.equal(await provider.requestAuthToken(), null);
  await assert.rejects(
    provider.probeAuthTokenForVerification(),
    (error) => error === invalidGrant,
  );
  assert.equal(providerRequests, 0);
  assert.equal(provider.markAuthSessionInvalid(new Error('network unavailable')), false);
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
  assert.equal(await provider.requestAuthToken(), null);
  const ownerBProbe = await provider.probeAuthTokenForVerification();
  assert.equal(ownerBProbe.ownerKey, 'owner-b');
  assert.equal(ownerBProbe.publish('owner-b'), true);
  const ownerBSnapshot = provider.readAuthSessionSnapshot();
  assert.equal(ownerBSnapshot.ownerKey, 'owner-b');
  assert.ok(ownerBSnapshot.epoch > pendingSnapshot.epoch);
});

test('verification probes keep pending claims hidden until an atomic matching publish', async () => {
  const provider = await importAuthTokenProvider();
  const tokenA = createToken('owner-a');
  const tokenB = createToken('owner-b');
  let activeToken = tokenA;
  provider.setAuthTokenProvider(async () => activeToken);
  await provider.requestAuthToken();

  const publishedOwners = [provider.readAuthSessionSnapshot().ownerKey];
  const unsubscribe = provider.subscribeAuthSession(() => {
    publishedOwners.push(provider.readAuthSessionSnapshot().ownerKey);
  });

  try {
    provider.setAuthSessionPendingClaimsOwner('owner-b');
    assert.equal(provider.readAuthSessionSnapshot().ownerKey, null);
    assert.equal(await provider.requestAuthToken(), null, 'ordinary stale A token must stay blocked');

    for (let index = 0; index < 2; index += 1) {
      const staleProbe = await provider.probeAuthTokenForVerification();
      assert.equal(staleProbe.ownerKey, 'owner-a');
      assert.equal(staleProbe.publish('owner-b'), false);
      assert.equal(provider.readAuthSessionSnapshot().ownerKey, null);
    }

    activeToken = tokenB;
    assert.equal(
      await provider.requestAuthToken(),
      null,
      'even a matching ordinary B token must wait for atomic proof publication',
    );
    assert.equal(provider.readAuthSessionSnapshot().ownerKey, null);
    const matchingProbe = await provider.probeAuthTokenForVerification();
    assert.equal(matchingProbe.ownerKey, 'owner-b');
    assert.equal(provider.readAuthSessionSnapshot().ownerKey, null);
    assert.equal(matchingProbe.publish('owner-b'), true);
    assert.equal(provider.readAuthSessionSnapshot().ownerKey, 'owner-b');
    assert.deepEqual(
      publishedOwners.filter((owner, index) => index === 0 || owner !== publishedOwners[index - 1]),
      ['owner-a', null, 'owner-b'],
    );
  } finally {
    unsubscribe();
  }
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
