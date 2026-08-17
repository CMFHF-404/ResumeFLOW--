import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const importController = async () => {
  const result = await build({
    entryPoints: ['components/paymentCheckoutSubmissionController.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}#${Math.random()}`);
};

test('watchdog recovery preserves the order for a later persisted page return', async () => {
  const { createPaymentCheckoutSubmissionController } = await importController();
  const controller = createPaymentCheckoutSubmissionController();
  const submission = controller.beginSubmission('order-1');

  assert.equal(controller.shouldRecoverFromWatchdog(submission), true);
  controller.markPageHidden();
  assert.equal(controller.shouldRecoverFromWatchdog(submission), false);
  assert.equal(controller.consumePersistedPageShow(), 'order-1');
  assert.equal(controller.consumePersistedPageShow(), null);
});

test('pagehide before the watchdog suppresses UI recovery without losing return sync', async () => {
  const { createPaymentCheckoutSubmissionController } = await importController();
  const controller = createPaymentCheckoutSubmissionController();
  const submission = controller.beginSubmission('order-1');

  controller.markPageHidden();

  assert.equal(controller.shouldRecoverFromWatchdog(submission), false);
  assert.equal(controller.consumePersistedPageShow(), 'order-1');
});

test('a new submission makes an older watchdog token harmless', async () => {
  const { createPaymentCheckoutSubmissionController } = await importController();
  const controller = createPaymentCheckoutSubmissionController();
  const first = controller.beginSubmission('order-1');
  const second = controller.beginSubmission('order-2');

  assert.equal(controller.shouldRecoverFromWatchdog(first), false);
  assert.equal(controller.shouldRecoverFromWatchdog(second), true);
  assert.equal(controller.consumePersistedPageShow(), 'order-2');
});

test('invalidation removes all late watchdog and page-return work', async () => {
  const { createPaymentCheckoutSubmissionController } = await importController();
  const controller = createPaymentCheckoutSubmissionController();
  const submission = controller.beginSubmission('order-1');

  controller.invalidate();
  controller.markPageHidden();

  assert.equal(controller.shouldRecoverFromWatchdog(submission), false);
  assert.equal(controller.consumePersistedPageShow(), null);
});
