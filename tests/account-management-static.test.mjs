import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('account management feature is wired through sidebar, app shell, service, and env', () => {
  const sidebar = read('components/GlobalSidebar.tsx');
  const app = read('App.tsx');
  const service = read('services/logtoAccountService.ts');
  const modal = read('components/AccountManagementModal.tsx');
  const viteEnv = read('vite-env.d.ts');
  const envExample = read('.env.example');

  assert.match(sidebar, /onOpenAccountManagement/);
  assert.match(sidebar, /账号管理/);
  assert.match(app, /AccountManagementModal/);
  assert.match(app, /isAccountManagementOpen/);

  for (const method of [
    'getAccountProfile',
    'verifyIdentityByPassword',
    'sendVerificationCode',
    'verifyCode',
    'updatePrimaryEmail',
    'updatePrimaryPhone',
    'updatePassword',
  ]) {
    assert.match(service, new RegExp(`\\b${method}\\b`));
  }

  assert.match(service, /logto-verification-id/);
  assert.match(service, /VITE_LOGTO_ACCOUNT_API_RESOURCE/);
  assert.match(modal, /getAccessToken\(resource\)/);
  assert.match(service, /\/my-account\/primary-phone'[\s\S]*method:\s*'POST'/);
  assert.match(service, /body:\s*jsonBody\(\{\s*phone,\s*newIdentifierVerificationRecordId,\s*\}\)/);
  assert.match(modal, /当前密码/);
  assert.match(modal, /验证码/);
  assert.match(modal, /更换邮箱/);
  assert.match(modal, /更换手机号|绑定手机号/);
  assert.match(modal, /更改密码/);
  assert.match(viteEnv, /VITE_LOGTO_ACCOUNT_API_RESOURCE/);
  assert.match(envExample, /VITE_LOGTO_ACCOUNT_API_RESOURCE/);
});
