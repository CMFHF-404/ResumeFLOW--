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
  requireExactHttpsOrigin,
  requireProductionApiBaseUrl,
  serializeProductionOrigins,
  validateProductionOrigins,
} from '../tools/validate-production-origins.mjs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('production browser endpoints accept the same-origin API mount and exact HTTPS origins', () => {
  const env = {
    VITE_API_BASE_URL: '/api',
    VITE_LOGTO_ENDPOINT: 'https://tenant.logto.app',
    YIFUT_BASE_URL: 'https://payments.example.com',
  };

  assert.doesNotThrow(() => validateProductionOrigins(env));
  assert.equal(requireProductionApiBaseUrl('/api'), '/api');
  assert.equal(
    requireProductionApiBaseUrl('https://api.example.com'),
    'https://api.example.com',
  );
  for (const invalid of ['/api/', 'api', '//api', '/api;connect-src *']) {
    assert.throws(
      () => requireProductionApiBaseUrl(invalid),
      /exact HTTPS origin/,
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
    VITE_LOGTO_ENDPOINT: 'https://tenant.logto.app',
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
    ['VITE_LOGTO_ENDPOINT', 'https://other-tenant.logto.app'],
    ['YIFUT_BASE_URL', 'https://other-payments.example.com'],
  ]) {
    const result = runValidator({ ...validEnv, [name]: differentOrigin });
    assert.notEqual(result.status, 0, `legal runtime drift should fail closed: ${name}`);
    assert.match(result.stderr, new RegExp(`Invalid ${name}: runtime origin does not match`));
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
      /Invalid built origin manifest|expected (?:\/api or )?an exact HTTPS origin/,
    );
  }
});
