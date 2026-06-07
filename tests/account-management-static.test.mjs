import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('account management feature is wired through sidebar, app shell, service, and env', () => {
  const sidebar = read('components/GlobalSidebar.tsx');
  const app = read('App.tsx');
  const service = read('services/logtoAccountService.ts');
  const modal = read('components/AccountManagementModal.tsx');
  const index = read('index.tsx');
  const viteEnv = read('vite-env.d.ts');
  const envExample = read('.env.example');

  assert.match(sidebar, /onOpenAccountManagement/);
  assert.match(sidebar, /账号管理/);
  assert.match(app, /AccountManagementModal/);
  assert.match(app, /isAccountManagementOpen/);
  assert.match(app, /ACCOUNT_MANAGEMENT_OPEN_STORAGE_KEY/);
  assert.match(app, /sessionStorage\.getItem\(ACCOUNT_MANAGEMENT_OPEN_STORAGE_KEY\)/);
  assert.match(app, /sessionStorage\.setItem\(ACCOUNT_MANAGEMENT_OPEN_STORAGE_KEY,\s*'true'\)/);
  assert.match(app, /sessionStorage\.removeItem\(ACCOUNT_MANAGEMENT_OPEN_STORAGE_KEY\)/);

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
  assert.match(modal, /return getAccessToken\(\);/);
  assert.doesNotMatch(modal, /getAccessToken\(resource\)/);
  assert.match(service, /const token = await tokenGetter\(\);/);
  assert.doesNotMatch(service, /tokenGetter\(resolveLogtoAccountApiResource\(\)\)/);
  assert.match(index, /const logtoResources = \[\s*import\.meta\.env\.VITE_LOGTO_RESOURCE,\s*\]/);
  assert.doesNotMatch(index, /VITE_LOGTO_ACCOUNT_API_RESOURCE[\s\S]*resources: logtoResources/);
  assert.match(modal, /dispatchLoginRequired/);
  assert.match(modal, /isAuthExpiredError/);
  assert.match(modal, /onClose\(\);[\s\S]*dispatchLoginRequired\('unauthorized'\)/);
  assert.match(service, /\/my-account\/primary-phone'[\s\S]*method:\s*'POST'/);
  assert.match(service, /apiClient\.post\('\/account\/verification-code-cooldown'/);
  assert.match(service, /apiClient\.delete\('\/account\/verification-code-cooldown'/);
  assert.match(service, /await reserveVerificationCodeCooldown\(normalizedIdentifier\)/);
  assert.match(service, /await releaseVerificationCodeCooldown\(normalizedIdentifier\)/);
  assert.match(service, /return `86\$\{nationalPhone\}`/);
  assert.match(service, /normalizedPhone\.startsWith\('86'\) \? normalizedPhone\.slice\(2\) : normalizedPhone/);
  assert.match(modal, /error\.status === 429/);
  assert.match(service, /body:\s*jsonBody\(\{\s*phone:\s*normalizedPhone,\s*newIdentifierVerificationRecordId,\s*\}\)/);
  assert.match(modal, /verificationCodeCooldowns/);
  assert.match(modal, /codeRequestInFlightRef/);
  assert.match(modal, /IDENTITY_VERIFICATION_CACHE_TTL_MS = 10 \* 60 \* 1000/);
  assert.match(modal, /sessionStorage\.setItem/);
  assert.match(modal, /sessionStorage\.getItem/);
  assert.match(modal, /ACCOUNT_MANAGEMENT_DRAFT_STORAGE_KEY/);
  assert.match(modal, /newEmailRecord/);
  assert.match(modal, /newPhoneRecord/);
  assert.match(modal, /newEmailVerifiedRecord/);
  assert.match(modal, /newPhoneVerifiedRecord/);
  assert.match(modal, /const emailVerificationRecord = newEmailVerifiedRecord \?\? await logtoAccountService\.verifyCode/);
  assert.match(modal, /const phoneVerificationRecord = newPhoneVerifiedRecord \?\? await logtoAccountService\.verifyCode/);
  assert.match(modal, /getCachedIdentityVerification\(account\)/);
  assert.match(modal, /cachedIdentityVerification \? 'update' : 'verify'/);
  assert.match(modal, /updateEmailWithCode/);
  assert.match(modal, /updatePhoneWithCode/);
  assert.doesNotMatch(modal, /请先获取新邮箱验证码/);
  assert.doesNotMatch(modal, /请先获取新手机号验证码/);
  assert.doesNotMatch(modal, /验证邮箱/);
  assert.doesNotMatch(modal, /验证手机号/);
  assert.match(modal, /请稍后再试/);
  assert.match(modal, /秒后重试/);
  assert.match(modal, /当前密码/);
  assert.match(modal, /验证码/);
  assert.match(modal, /选择要更新的信息/);
  assert.match(modal, /二次验证/);
  assert.match(modal, /也可使用验证码/);
  assert.doesNotMatch(modal, /验证码备选/);
  assert.doesNotMatch(modal, /id="identity-code-value"/);
  assert.doesNotMatch(modal, />当前邮箱<\/option>/);
  assert.doesNotMatch(modal, />当前手机号<\/option>/);
  assert.match(modal, /absolute right-1 top-1\/2/);
  assert.match(modal, /\$\{PRIMARY_BUTTON_CLASS\} h-\[42px\] self-end/);
  assert.match(modal, /sm:grid-cols-\[minmax\(0,1fr\)_auto\][\s\S]*data-testid="identity-password-row"[\s\S]*\$\{PRIMARY_BUTTON_CLASS\} h-\[42px\] self-end[\s\S]*CheckCircle2 className="h-4 w-4"/);
  assert.doesNotMatch(modal, /identity-password' \? <Spinner \/> : <ShieldCheck/);
  assert.match(modal, /选择更新项/);
  assert.match(modal, /填写并更新/);
  assert.doesNotMatch(modal, /刷新账号信息/);
  assert.doesNotMatch(modal, /先选目标，再完成验证/);
  assert.doesNotMatch(modal, /邮箱、手机号和密码都需要先通过二次验证/);
  assert.match(modal, /更换邮箱/);
  assert.match(modal, /更换手机号|绑定手机号/);
  assert.match(modal, /更改密码/);
  assert.match(modal, /确认更新/);
  assert.doesNotMatch(modal, /确认更新邮箱/);
  assert.doesNotMatch(modal, /确认更新手机号/);
  assert.match(modal, /确认更新密码/);
  assert.match(viteEnv, /VITE_LOGTO_ACCOUNT_API_RESOURCE/);
  assert.match(envExample, /VITE_LOGTO_ACCOUNT_API_RESOURCE/);
});
