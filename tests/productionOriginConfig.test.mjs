import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  requireLogtoAppId,
  requireLogtoRedirectUri,
  requireExactHttpsOrigin,
  requireHttpsUrl,
  requireProductionApiBaseUrl,
  serializeProductionOrigins,
  validateProductionOrigins,
} from '../tools/validate-production-origins.mjs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('production browser endpoints accept the same-origin API mount and exact HTTPS origins', () => {
  const env = {
    VITE_API_BASE_URL: '/api',
    VITE_FRONTEND_ORIGIN: 'https://app.example.com',
    VITE_LOGTO_ENDPOINT: 'https://tenant.logto.app',
    VITE_LOGTO_APP_ID: 'resume-flow-spa',
    VITE_LOGTO_REDIRECT_URI: 'https://app.example.com/callback',
    VITE_LOGTO_ACCOUNT_CENTER_URL: 'https://tenant.logto.app/account',
    YIFUT_BASE_URL: 'https://payments.example.com',
  };

  assert.doesNotThrow(() => validateProductionOrigins(env));
  assert.equal(requireProductionApiBaseUrl('/api'), '/api');
  for (const invalid of [
    '/api/',
    'api',
    '//api',
    '/api;connect-src *',
    'https://api.example.com',
  ]) {
    assert.throws(
      () => requireProductionApiBaseUrl(invalid),
      /must be exactly \/api/,
    );
  }
  for (const invalid of [
    'http://api.example.com',
    'https://api.example.com/path',
    'https://user@api.example.com',
    'https://bad..api.example.com',
    'https://-bad.api.example.com',
    'https://api.example.com:0',
    'https://api.example.com; script-src *',
    ' https://api.example.com',
  ]) {
    assert.throws(
      () => requireExactHttpsOrigin('TEST_ORIGIN', invalid),
      /exact HTTPS origin/,
    );
  }
});

test('development proxy has an independent local upstream while production browser requests stay on /api', () => {
  const viteConfig = read('vite.config.ts');
  const frontendEnv = read('.env.example');
  const backendEnv = read('backend/.env.example');
  const readme = read('README.md');

  assert.match(frontendEnv, /^VITE_API_BASE_URL=\/api$/m);
  assert.match(frontendEnv, /^VITE_DEV_API_PROXY_TARGET=http:\/\/localhost:8000$/m);
  assert.match(viteConfig, /const devApiProxyTarget = env\.VITE_DEV_API_PROXY_TARGET \|\| 'http:\/\/localhost:8000';/);
  assert.match(viteConfig, /target: devApiProxyTarget,/);
  assert.doesNotMatch(viteConfig, /target: env\.VITE_API_BASE_URL/);
  assert.match(readme, /VITE_DEV_API_PROXY_TARGET/);
  assert.match(
    backendEnv,
    /^CORS_ALLOW_ORIGINS=http:\/\/localhost:5173\r?\nFRONTEND_ORIGIN=http:\/\/localhost:5173$/m,
  );
});

test('Logto app identity and callback are build-manifested and pinned to the public frontend origin', () => {
  const frontendOrigin = 'https://app.example.com';
  const validEnv = {
    VITE_API_BASE_URL: '/api',
    VITE_FRONTEND_ORIGIN: frontendOrigin,
    VITE_LOGTO_ENDPOINT: 'https://tenant.logto.app',
    VITE_LOGTO_APP_ID: 'resume-flow-spa',
    VITE_LOGTO_REDIRECT_URI: `${frontendOrigin}/callback`,
    VITE_LOGTO_ACCOUNT_CENTER_URL: 'https://tenant.logto.app/account',
    YIFUT_BASE_URL: 'https://payments.example.com',
  };

  assert.equal(requireLogtoAppId(validEnv.VITE_LOGTO_APP_ID), validEnv.VITE_LOGTO_APP_ID);
  assert.equal(
    requireLogtoRedirectUri(validEnv.VITE_LOGTO_REDIRECT_URI, frontendOrigin),
    validEnv.VITE_LOGTO_REDIRECT_URI,
  );
  assert.equal(
    requireHttpsUrl(
      'VITE_LOGTO_ACCOUNT_CENTER_URL',
      validEnv.VITE_LOGTO_ACCOUNT_CENTER_URL,
    ),
    validEnv.VITE_LOGTO_ACCOUNT_CENTER_URL,
  );
  assert.match(serializeProductionOrigins(validEnv), /^VITE_LOGTO_APP_ID=resume-flow-spa$/m);
  assert.match(serializeProductionOrigins(validEnv), /^VITE_LOGTO_REDIRECT_URI=https:\/\/app\.example\.com\/callback$/m);
  assert.match(
    serializeProductionOrigins(validEnv),
    /^VITE_LOGTO_ACCOUNT_CENTER_URL=https:\/\/tenant\.logto\.app\/account$/m,
  );

  for (const invalidAppId of ['', ' app-id', 'app id', 'app=id']) {
    assert.throws(() => requireLogtoAppId(invalidAppId), /VITE_LOGTO_APP_ID/);
  }
  for (const invalidRedirect of [
    'http://app.example.com/callback',
    'https://app.example.com/callback?next=/',
    'https://app.example.com/callback#fragment',
    'https://user@app.example.com/callback',
    'https://app.example.com/other',
    'https://other.example.com/callback',
  ]) {
    assert.throws(
      () => requireLogtoRedirectUri(invalidRedirect, frontendOrigin),
      /VITE_LOGTO_REDIRECT_URI must exactly equal/,
    );
  }
  for (const invalidAccountCenterUrl of [
    '',
    'http://tenant.logto.app/account',
    'javascript:alert(1)',
    'https://user@tenant.logto.app/account',
  ]) {
    assert.throws(
      () => requireHttpsUrl(
        'VITE_LOGTO_ACCOUNT_CENTER_URL',
        invalidAccountCenterUrl,
      ),
      /VITE_LOGTO_ACCOUNT_CENTER_URL must be an HTTPS URL/,
    );
  }

  const dockerfile = read('Dockerfile');
  const entrypoint = read('tools/validate-production-origins.sh');
  assert.match(dockerfile, /ARG VITE_FRONTEND_ORIGIN/);
  assert.match(dockerfile, /ARG VITE_LOGTO_APP_ID/);
  assert.match(dockerfile, /ARG VITE_LOGTO_REDIRECT_URI/);
  assert.match(dockerfile, /VITE_LOGTO_APP_ID=\$VITE_LOGTO_APP_ID/);
  assert.match(dockerfile, /VITE_LOGTO_REDIRECT_URI=\$VITE_LOGTO_REDIRECT_URI/);
  assert.match(
    dockerfile,
    /FROM nginx:[\s\S]*ARG VITE_LOGTO_ACCOUNT_CENTER_URL[\s\S]*VITE_LOGTO_ACCOUNT_CENTER_URL=\$VITE_LOGTO_ACCOUNT_CENTER_URL/,
  );
  assert.match(entrypoint, /VITE_LOGTO_APP_ID/);
  assert.match(entrypoint, /VITE_LOGTO_REDIRECT_URI/);
  assert.match(entrypoint, /VITE_LOGTO_ACCOUNT_CENTER_URL/);
});

test('frontend CSP and backend checkout share YIFUT_BASE_URL authority', () => {
  const nginx = read('nginx.conf');
  const dockerfile = read('Dockerfile');
  const backendConfig = read('backend/app/config.py');
  const viteConfig = read('vite.config.ts');

  assert.match(nginx, /form-action 'self' \$\{YIFUT_BASE_URL\}/);
  assert.match(dockerfile, /ARG YIFUT_BASE_URL=https:\/\/www\.yifut\.com/);
  assert.match(dockerfile, /--write-manifest=\/app\/built-origins\.env/);
  assert.match(dockerfile, /COPY --from=builder --chmod=444 \/app\/built-origins\.env \/etc\/resumeflow\/built-origins\.env/);
  assert.match(backendConfig, /_require_exact_https_origin\([\s\S]*ENV_YIFUT_BASE_URL/);
  assert.match(
    viteConfig,
    /env\.YIFUT_BASE_URL \|\| 'https:\/\/www\.yifut\.com'/,
  );
  assert.match(backendConfig, /DEFAULT_YIFUT_BASE_URL = "https:\/\/www\.yifut\.com"/);
});

test('Nginx entrypoint rejects invalid or drifted runtime origins before envsubst', (t) => {
  const scriptPath = fileURLToPath(new URL('../tools/validate-production-origins.sh', import.meta.url));
  const tempDirectory = mkdtempSync(join(tmpdir(), 'resumeflow-built-origins-'));
  t.after(() => rmSync(tempDirectory, { recursive: true, force: true }));
  const manifestPath = join(tempDirectory, 'built-origins.env');
  const validEnv = {
    ...process.env,
    VITE_API_BASE_URL: '/api',
    VITE_FRONTEND_ORIGIN: 'https://app.example.com',
    VITE_LOGTO_ENDPOINT: 'https://tenant.logto.app',
    VITE_LOGTO_APP_ID: 'resume-flow-spa',
    VITE_LOGTO_REDIRECT_URI: 'https://app.example.com/callback',
    VITE_LOGTO_ACCOUNT_CENTER_URL: 'https://tenant.logto.app/account',
    YIFUT_BASE_URL: 'https://payments.example.com:8443',
  };
  writeFileSync(manifestPath, serializeProductionOrigins(validEnv), 'utf8');

  const runValidator = (env = validEnv, path = manifestPath) => spawnSync('sh', [scriptPath, path], {
    env,
    encoding: 'utf8',
  });

  const valid = runValidator();
  assert.equal(valid.status, 0, valid.stderr);

  for (const [name, differentOrigin] of [
    ['VITE_API_BASE_URL', 'https://other-api.example.com'],
    ['VITE_FRONTEND_ORIGIN', 'https://other-app.example.com'],
    ['VITE_LOGTO_ENDPOINT', 'https://other-tenant.logto.app'],
    ['VITE_LOGTO_APP_ID', 'other-resume-flow-spa'],
    ['VITE_LOGTO_REDIRECT_URI', 'https://other-app.example.com/callback'],
    ['VITE_LOGTO_ACCOUNT_CENTER_URL', 'https://other.logto.app/account'],
    ['YIFUT_BASE_URL', 'https://other-payments.example.com'],
  ]) {
    const result = runValidator({ ...validEnv, [name]: differentOrigin });
    assert.notEqual(result.status, 0, `legal runtime drift should fail closed: ${name}`);
    assert.match(
      result.stderr,
      name === 'VITE_API_BASE_URL'
        ? /Invalid VITE_API_BASE_URL: expected exactly \/api/
        : name === 'VITE_LOGTO_REDIRECT_URI'
          ? /Invalid VITE_LOGTO_REDIRECT_URI: expected VITE_FRONTEND_ORIGIN\/callback/
        : new RegExp(`Invalid ${name}: runtime origin does not match`),
    );
  }

  for (const invalid of [
    'https:',
    'https://payments.example.com/path',
    'https://payments.example.com;form-action *',
    'https://user@payments.example.com',
    'http://payments.example.com',
    'https://payments.example.com:99999',
  ]) {
    const result = runValidator({ ...validEnv, YIFUT_BASE_URL: invalid });
    assert.notEqual(result.status, 0, `runtime override should fail closed: ${invalid}`);
    assert.match(result.stderr, /Invalid YIFUT_BASE_URL/);
  }

  const originalManifest = serializeProductionOrigins(validEnv);
  for (const tampered of [
    originalManifest.replace('YIFUT_BASE_URL=', 'UNEXPECTED_ORIGIN='),
    `${originalManifest}YIFUT_BASE_URL=https://payments.example.com:8443\n`,
    originalManifest.replace('VITE_API_BASE_URL=/api', 'VITE_API_BASE_URL=/api/'),
  ]) {
    writeFileSync(manifestPath, tampered, 'utf8');
    const result = runValidator();
    assert.notEqual(result.status, 0, 'tampered manifest should fail closed');
    assert.match(
      result.stderr,
      /Invalid built origin manifest|expected exactly \/api|expected an exact HTTPS origin/,
    );
  }
});
