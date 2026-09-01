import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('logout suppresses stale automatic login-required redirects', () => {
  const authGuard = read('components/AuthGuard.tsx');
  const sidebar = read('components/GlobalSidebar.tsx');
  const authFlow = read('services/authFlowState.ts');

  assert.match(authGuard, /shouldAutoSignInForLoginRequired/);
  assert.match(authGuard, /isSigningIn:\s*isSigningInRef\.current/);
  assert.match(authGuard, /markUserSignInStarted\(\)/);
  assert.match(authGuard, /isAuthSessionInvalidError\(error\)/);
  assert.match(
    authGuard,
    /handleAuthFailure\(\{[\s\S]*code: 'session_invalid'[\s\S]*isCurrentSession: isAuthSessionSnapshotCurrent\(session\)/,
  );
  assert.match(authGuard, /hasQueuedInvalidSessionReauthRef\.current/);
  assert.match(authGuard, /markAuthSessionInvalid\(authError\)/);
  assert.match(
    authGuard,
    /if \(shouldForceReauth\)[\s\S]*await clearAllTokensRef\.current\?\.\(\);[\s\S]*await signIn/,
  );
  assert.match(authGuard, /subscribeAuthRecoveryIssue\(setRecoveryIssue\)/);
  assert.match(authGuard, /手动重新登录/);

  assert.match(sidebar, /markUserSignOutStarted/);
  assert.match(sidebar, /markUserSignOutStarted\(\);[\s\S]*await signOut/);
  assert.match(sidebar, /markUserSignInStarted\(\);[\s\S]*await trackLoginStart\('sidebar'\)/);

  assert.match(authFlow, /USER_SIGN_OUT_SUPPRESSION_MS/);
  assert.match(authFlow, /reason\s*===\s*'unauthorized'\s*&&\s*!isAuthenticated/);
  assert.match(authFlow, /now\s*-\s*lastUserSignOutAt\s*<\s*USER_SIGN_OUT_SUPPRESSION_MS/);
});
