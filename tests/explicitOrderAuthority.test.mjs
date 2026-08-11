import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';

const importExplicitOrder = async () => {
  const result = await build({
    entryPoints: ['utils/explicitOrder.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const encoded = Buffer.from(result.outputFiles[0].text).toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
};

test('shared explicit-order authority preserves configured order and fallback identity', async () => {
  const { applyExplicitOrder } = await importExplicitOrder();
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  assert.equal(applyExplicitOrder(items, (item) => item.id), items);
  assert.deepEqual(
    applyExplicitOrder(items, (item) => item.id, ['c', 'missing', 'a', 'c']).map((item) => item.id),
    ['c', 'a', 'b'],
  );
});

test('editor and dashboard import the same explicit-order authority', () => {
  const editorSource = readFileSync('hooks/useResumeDataAppliers.ts', 'utf8');
  const dashboardSource = readFileSync('views/Dashboard/resumePreviewState.ts', 'utf8');

  assert.match(editorSource, /import \{ applyExplicitOrder \} from '\.\.\/utils\/explicitOrder';/);
  assert.match(editorSource, /export \{ applyExplicitOrder \} from '\.\.\/utils\/explicitOrder';/);
  assert.match(dashboardSource, /import \{ applyExplicitOrder \} from '\.\.\/\.\.\/utils\/explicitOrder';/);
  assert.doesNotMatch(editorSource, /(?:export )?const applyExplicitOrder\s*=/);
  assert.doesNotMatch(dashboardSource, /(?:export )?const applyExplicitOrder\s*=/);
});
