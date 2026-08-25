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
