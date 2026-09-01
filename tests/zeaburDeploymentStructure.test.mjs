import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Zeabur deploys the production frontend through the root Dockerfile', () => {
  const config = JSON.parse(read('zbpack.json'));
  const dockerfile = read('Dockerfile');

  assert.deepEqual(config, {
    dockerfile: {
      path: 'Dockerfile',
    },
  });
  assert.match(dockerfile, /RUN[\s\S]*npm run build/);
  assert.match(dockerfile, /COPY --from=builder \/app\/dist \/usr\/share\/nginx\/html/);
  assert.match(
    dockerfile,
    /FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS builder/,
  );
  assert.match(
    dockerfile,
    /FROM nginx:1\.27-alpine@sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10/,
  );
});

test('backend container uses readiness, rather than liveness, as its deployment health gate', () => {
  const dockerfile = read('backend/Dockerfile');
  const prestart = read('backend/prestart.sh');
  const readme = read('README.md');

  assert.match(
    dockerfile,
    /HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 CMD python -c "[^"]*127\.0\.0\.1:8000\/ready[^"]*"/,
  );
  assert.match(dockerfile, /RESUMEFLOW_DEPLOYMENT_MODE=production/);
  assert.match(dockerfile, /touch \/app\/\.resumeflow-production-image/);
  assert.match(dockerfile, /FRONTEND_LOGTO_ENDPOINT,[\s\S]*FRONTEND_LOGTO_APP_ID,[\s\S]*FRONTEND_LOGTO_REDIRECT_URI/);
  assert.match(prestart, /\[ -f \/app\/\.resumeflow-production-image \]/);
  assert.match(prestart, /export RESUMEFLOW_DEPLOYMENT_MODE=production/);
  assert.ok(
    prestart.indexOf("python -c 'from app.config import load_settings; load_settings()'")
      < prestart.indexOf('python app/init_db.py'),
    'public frontend auth config must be validated before database initialization',
  );
  assert.match(readme, /Zeabur[\s\S]*\/ready/);
});
