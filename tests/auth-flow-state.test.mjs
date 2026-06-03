import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';

const importTypeScriptModule = async (path) => {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
};

test('auth flow suppresses stale login-required events after user logout', async () => {
  const {
    markUserSignInStarted,
    markUserSignOutStarted,
    shouldAutoSignInForLoginRequired,
  } = await importTypeScriptModule('services/authFlowState.ts');

  markUserSignInStarted();
  assert.equal(
    shouldAutoSignInForLoginRequired({
      reason: 'unauthorized',
      isAuthenticated: false,
      isLoading: false,
      isSigningIn: false,
      now: 1_000,
    }),
    false,
    'background read 401 should not auto-login an already signed-out user'
  );

  assert.equal(
    shouldAutoSignInForLoginRequired({
      reason: 'write-operation',
      isAuthenticated: false,
      isLoading: false,
      isSigningIn: false,
      now: 1_000,
    }),
    true,
    'explicit unauthenticated write operations can still start login'
  );

  assert.equal(
    shouldAutoSignInForLoginRequired({
      reason: 'unauthorized',
      isAuthenticated: true,
      isLoading: false,
      isSigningIn: false,
      now: 1_000,
    }),
    true,
    'expired authenticated sessions should still force reauth'
  );

  markUserSignOutStarted(10_000);
  assert.equal(
    shouldAutoSignInForLoginRequired({
      reason: 'unauthorized-write',
      isAuthenticated: true,
      isLoading: false,
      isSigningIn: false,
      now: 11_000,
    }),
    false,
    'stale login-required events are ignored while user sign-out is settling'
  );

  assert.equal(
    shouldAutoSignInForLoginRequired({
      reason: 'unauthorized-write',
      isAuthenticated: true,
      isLoading: false,
      isSigningIn: false,
      now: 26_000,
    }),
    true,
    'force reauth resumes after the sign-out suppression window'
  );
});
