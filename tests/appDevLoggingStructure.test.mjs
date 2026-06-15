import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('App shell routes development diagnostics through devLog', () => {
  const app = read('App.tsx');

  assert.match(app, /import \{ devLog \} from '\.\/services\/devLogger';/);
  assert.match(app, /devLog\('\[App\] 更新全局简历缓存，共'/);
  assert.match(app, /devLog\('\[App\] 更新经历库缓存'\)/);
  assert.doesNotMatch(app, /console\.log/);
});
