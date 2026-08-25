import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('production entrypoint bundles Tailwind locally and contains no third-party or inline scripts', () => {
  const html = read('index.html');
  const entry = read('index.tsx');
  const tailwindConfig = read('tailwind.config.cjs');
  const postcssConfig = read('postcss.config.cjs');
  const packageJson = JSON.parse(read('package.json'));

  assert.doesNotMatch(html, /cdn\.tailwindcss\.com|esm\.sh|VITE_UMAMI|type="importmap"/);
  assert.equal((html.match(/<script\b/g) ?? []).length, 1);
  assert.match(html, /<script type="module" src="\/index\.tsx"><\/script>/);
  assert.match(entry, /import '\.\/styles\/tailwind\.css';/);
  assert.match(tailwindConfig, /dynamicThemeColors/);
  for (const color of ['blue', 'orange', 'amber', 'emerald', 'indigo', 'rose']) {
    assert.match(tailwindConfig, new RegExp(`'${color}'`));
  }
  assert.match(postcssConfig, /tailwindcss/);
  for (const dependency of [
    'tailwindcss',
    'postcss',
    'autoprefixer',
    '@tailwindcss/forms',
    '@tailwindcss/typography',
    '@tailwindcss/container-queries',
  ]) {
    assert.ok(packageJson.devDependencies[dependency], `${dependency} must be a local build dependency`);
  }
});

test('Nginx protects both HTML and immutable assets with the production security headers', () => {
  const nginx = read('nginx.conf');
  const dockerfile = read('Dockerfile');

  const csp = "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' ${VITE_API_BASE_URL} ${VITE_LOGTO_ENDPOINT}; form-action 'self' ${YIFUT_BASE_URL}; frame-src 'none'; worker-src 'self' blob:";
  assert.equal((nginx.match(new RegExp(csp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length, 2);
  assert.doesNotMatch(nginx, /connect-src[^;]*\bhttps:/);
  assert.doesNotMatch(nginx, /form-action[^;]*https:\/\//);
  assert.match(nginx, /location \/assets\/[\s\S]*?add_header Content-Security-Policy/);
  assert.match(nginx, /X-Content-Type-Options "nosniff"/);
  assert.match(nginx, /Referrer-Policy "strict-origin-when-cross-origin"/);
  assert.match(nginx, /Permissions-Policy "camera=\(\), microphone=\(\), geolocation=\(\)"/);
  assert.match(nginx, /X-Frame-Options "DENY"/);
  assert.doesNotMatch(dockerfile, /VITE_UMAMI/);
  assert.match(dockerfile, /node tools\/validate-production-origins\.mjs/);
  assert.match(dockerfile, /COPY --chmod=755 tools\/validate-production-origins\.sh \/docker-entrypoint\.d\/15-validate-production-origins\.sh/);
  assert.match(dockerfile, /COPY --from=builder --chmod=444 \/app\/built-origins\.env \/etc\/resumeflow\/built-origins\.env/);
  assert.match(dockerfile, /NGINX_ENVSUBST_FILTER='BACKEND_UPSTREAM\|VITE_API_BASE_URL\|VITE_LOGTO_ENDPOINT\|YIFUT_BASE_URL'/);
  assert.match(dockerfile, /npm run build/);
});
