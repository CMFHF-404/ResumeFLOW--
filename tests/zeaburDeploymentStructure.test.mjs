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
});
