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

  assert.match(sidebar, /markUserSignOutStarted/);
  assert.match(sidebar, /markUserSignOutStarted\(\);[\s\S]*await signOut/);
  assert.match(sidebar, /markUserSignInStarted\(\);[\s\S]*await trackLoginStart\('sidebar'\)/);

  assert.match(authFlow, /USER_SIGN_OUT_SUPPRESSION_MS/);
  assert.match(authFlow, /reason\s*===\s*'unauthorized'\s*&&\s*!isAuthenticated/);
  assert.match(authFlow, /now\s*-\s*lastUserSignOutAt\s*<\s*USER_SIGN_OUT_SUPPRESSION_MS/);
});
