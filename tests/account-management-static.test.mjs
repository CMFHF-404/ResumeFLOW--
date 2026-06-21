import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('account management uses hosted Logto Account Center without a second API resource', () => {
  const sidebar = read('components/GlobalSidebar.tsx');
  const app = read('App.tsx');
  const authGuard = read('components/AuthGuard.tsx');
  const service = read('services/logtoAccountService.ts');
  const index = read('index.tsx');
  const dockerfile = read('Dockerfile');
  const viteEnv = read('vite-env.d.ts');
  const envExample = read('.env.example');

  assert.match(sidebar, /VITE_LOGTO_ACCOUNT_CENTER_URL/);
  assert.match(sidebar, /window\.open\(accountCenterUrl,\s*'_blank',\s*'noopener,noreferrer'\)/);
  assert.doesNotMatch(sidebar, /window\.location\.assign\(accountCenterUrl\)/);
  assert.match(sidebar, /账号管理/);
  assert.doesNotMatch(sidebar, /onOpenAccountManagement/);

  assert.doesNotMatch(app, /AccountManagementModal/);
  assert.doesNotMatch(app, /isAccountManagementOpen/);
  assert.doesNotMatch(app, /ACCOUNT_MANAGEMENT_OPEN_STORAGE_KEY/);

  assert.doesNotMatch(index, /VITE_LOGTO_RESOURCE/);
  assert.doesNotMatch(index, /\bresources\s*:/);
  assert.match(authGuard, /\bgetIdToken\b/);
  assert.match(authGuard, /\bgetAccessToken\b/);
  assert.match(authGuard, /\bclearAccessToken\b/);
  assert.match(authGuard, /createLogtoAuthSessionRefresher\(\s*clearAccessTokenRef\.current,\s*getAccessTokenRef\.current\s*\)/);
  assert.doesNotMatch(authGuard, /VITE_LOGTO_RESOURCE/);

  assert.doesNotMatch(dockerfile, /VITE_LOGTO_RESOURCE/);
  assert.match(dockerfile, /VITE_LOGTO_ACCOUNT_CENTER_URL/);

  assert.match(viteEnv, /VITE_LOGTO_ACCOUNT_CENTER_URL/);
  assert.doesNotMatch(viteEnv, /VITE_LOGTO_ACCOUNT_API_RESOURCE/);
  assert.doesNotMatch(viteEnv, /VITE_LOGTO_RESOURCE/);
  assert.match(envExample, /VITE_LOGTO_ACCOUNT_CENTER_URL/);
  assert.doesNotMatch(envExample, /VITE_LOGTO_ACCOUNT_API_RESOURCE/);
  assert.doesNotMatch(envExample, /VITE_LOGTO_RESOURCE/);

  assert.doesNotMatch(service, /VITE_LOGTO_ACCOUNT_API_RESOURCE/);
  assert.doesNotMatch(service, /\/my-account/);
  assert.doesNotMatch(service, /\/verifications\//);
  assert.doesNotMatch(service, /resolveLogtoAccountApiResource/);
  assert.match(service, /export type LogtoAccountIdentifierType = 'email' \| 'phone'/);
  assert.match(service, /return `86\$\{nationalPhone\}`/);
  assert.match(service, /digits\.startsWith\('86'\) \? digits\.slice\(2\) : digits/);
});

test('auth guard blocks protected app while the Logto session is unauthenticated', () => {
  const authGuard = read('components/AuthGuard.tsx');

  assert.match(authGuard, /auth_guard_unauthenticated/);
  assert.match(authGuard, /onClick=\{handleUnauthenticatedSignIn\}/);
  assert.match(
    authGuard,
    /if \(!isAuthenticated\) \{[\s\S]+return <>\{children\}<\/>;/
  );
});
