import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const importController = async () => {
  const result = await build({
    entryPoints: ['components/paymentOrderRequestController.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}#${Math.random()}`);
};

test('load invalidation aborts stale work without releasing a newer request', async () => {
  const { createPaymentOrderRequestController } = await importController();
  const controller = createPaymentOrderRequestController();

  controller.recordLoadedCount(40);
  const stale = controller.beginLoad({ append: false, replayLoadedDepth: true }, 20);
  assert.ok(stale);
  assert.equal(stale.mode, 'replace');
  assert.equal(stale.cursor, null);
  assert.equal(stale.replayPageDepth, 2);
  assert.equal(controller.isLoadCurrent(stale), true);
  assert.equal(controller.beginLoad({ append: false, replayLoadedDepth: false }, 20), null);

  controller.invalidateLoads();
  assert.equal(stale.abortController.signal.aborted, true);
  assert.equal(controller.isLoadCurrent(stale), false);

  const current = controller.beginLoad({ append: false, replayLoadedDepth: false }, 20);
  assert.ok(current);
  assert.ok(current.generation > stale.generation);
  assert.equal(controller.finishLoad(stale), null);
  assert.equal(controller.beginLoad({ append: false, replayLoadedDepth: false }, 20), null);
  assert.equal(controller.finishLoad(current), 'replace');

  const next = controller.beginLoad({ append: false, replayLoadedDepth: false }, 20);
  assert.ok(next);
  assert.equal(controller.finishLoad(next), 'replace');
});

test('append reuses the current generation and requires a recorded cursor', async () => {
  const { createPaymentOrderRequestController } = await importController();
  const controller = createPaymentOrderRequestController();

  assert.equal(controller.beginLoad({ append: true, replayLoadedDepth: false }, 20), null);

  const initial = controller.beginLoad({ append: false, replayLoadedDepth: false }, 20);
  assert.ok(initial);
  controller.recordLoadedCount(20);
  controller.recordNextCursor('cursor-20');
  assert.equal(controller.finishLoad(initial), 'replace');

  const append = controller.beginLoad({ append: true, replayLoadedDepth: false }, 20);
  assert.ok(append);
  assert.equal(append.mode, 'append');
  assert.equal(append.cursor, 'cursor-20');
  assert.equal(append.generation, initial.generation);
  assert.equal(append.replayPageDepth, 1);
  assert.equal(controller.beginLoad({ append: true, replayLoadedDepth: false }, 20), null);
  assert.equal(controller.finishLoad(append), 'append');

  controller.recordNextCursor(null);
  assert.equal(controller.beginLoad({ append: true, replayLoadedDepth: false }, 20), null);
});

test('load invalidation preserves pagination depth and cursor state', async () => {
  const { createPaymentOrderRequestController } = await importController();
  const controller = createPaymentOrderRequestController();

  controller.recordLoadedCount(41);
  controller.recordNextCursor('cursor-41');
  controller.invalidateLoads();

  const append = controller.beginLoad({ append: true, replayLoadedDepth: false }, 20);
  assert.ok(append);
  assert.equal(append.cursor, 'cursor-41');
  assert.equal(controller.finishLoad(append), 'append');

  const refresh = controller.beginLoad({ append: false, replayLoadedDepth: true }, 20);
  assert.ok(refresh);
  assert.equal(refresh.cursor, null);
  assert.equal(refresh.replayPageDepth, 3);
  assert.equal(controller.finishLoad(refresh), 'replace');
});

test('an action locks other actions and invalidates in-flight list requests', async () => {
  const { createPaymentOrderRequestController } = await importController();
  const controller = createPaymentOrderRequestController();

  const load = controller.beginLoad({ append: false, replayLoadedDepth: false }, 20);
  assert.ok(load);
  const action = controller.beginAction();
  assert.ok(action);
  assert.equal(load.abortController.signal.aborted, true);
  assert.equal(controller.isLoadCurrent(load), false);
  assert.equal(controller.finishLoad(load), null);
  assert.equal(controller.isActionCurrent(action), true);
  assert.equal(controller.beginAction(), null);
  assert.equal(controller.beginLoad({ append: false, replayLoadedDepth: false }, 20), null);

  assert.equal(controller.finishAction(action), true);
  assert.equal(controller.isActionCurrent(action), false);
  const nextLoad = controller.beginLoad({ append: false, replayLoadedDepth: false }, 20);
  assert.ok(nextLoad);
  assert.equal(controller.finishLoad(nextLoad), 'replace');
});

test('invalidated and stale action completions cannot release a newer action', async () => {
  const { createPaymentOrderRequestController } = await importController();
  const controller = createPaymentOrderRequestController();

  const stale = controller.beginAction();
  assert.ok(stale);
  controller.invalidateAction();
  assert.equal(stale.abortController.signal.aborted, true);
  assert.equal(controller.isActionCurrent(stale), false);
  assert.equal(controller.finishAction(stale), false);

  const current = controller.beginAction();
  assert.ok(current);
  assert.ok(current.generation > stale.generation);
  assert.equal(controller.finishAction(stale), false);
  assert.equal(controller.isActionCurrent(current), true);
  assert.equal(controller.beginAction(), null);
  assert.equal(controller.finishAction(current), true);
});
