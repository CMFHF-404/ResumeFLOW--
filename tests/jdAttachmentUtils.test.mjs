import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import { build } from 'esbuild';

const importJDAttachmentUtils = async () => {
  const result = await build({
    entryPoints: ['utils/jdAttachment.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const encoded = Buffer.from(result.outputFiles[0].text).toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
};

test('JD attachment utilities preserve accepted-file and non-image preparation behavior', async () => {
  const {
    JD_ATTACHMENT_ACCEPT,
    isAcceptedJDAttachmentFile,
    isJDAttachmentImageFile,
    prepareJDAttachmentFile,
  } = await importJDAttachmentUtils();
  const pdf = new File(['pdf'], 'target-role.pdf', { type: 'application/pdf' });
  const extensionOnlyDocx = new File(['docx'], 'target-role.DOCX');
  const extensionOnlyImage = new File(['image'], 'target-role.PNG');
  const unsupported = new File(['text'], 'target-role.txt', { type: 'text/plain' });

  assert.equal(JD_ATTACHMENT_ACCEPT, '.jpg,.jpeg,.png,.webp,.pdf,.docx');
  assert.equal(isAcceptedJDAttachmentFile(pdf), true);
  assert.equal(isAcceptedJDAttachmentFile(extensionOnlyDocx), true);
  assert.equal(isJDAttachmentImageFile(extensionOnlyImage), true);
  assert.equal(isAcceptedJDAttachmentFile(unsupported), false);
  assert.equal(await prepareJDAttachmentFile(pdf), pdf);
  assert.equal(await prepareJDAttachmentFile(unsupported), null);
});

test('JD attachment selection controller enforces latest-wins and invalidation', async () => {
  const { createJDAttachmentSelectionController } = await importJDAttachmentUtils();
  const deferred = () => {
    let resolve;
    const promise = new Promise((nextResolve) => {
      resolve = nextResolve;
    });
    return { promise, resolve };
  };
  const pendingByName = new Map();
  const prepareFile = (file) => {
    const pending = deferred();
    pendingByName.set(file.name, pending);
    return pending.promise;
  };
  const changes = [];
  const controller = createJDAttachmentSelectionController(
    (file) => changes.push(file),
    prepareFile,
  );
  const first = new File(['first'], 'first.png', { type: 'image/png' });
  const second = new File(['second'], 'second.png', { type: 'image/png' });
  const firstPrepared = new File(['first-ready'], 'first.jpg', { type: 'image/jpeg' });
  const secondPrepared = new File(['second-ready'], 'second.jpg', { type: 'image/jpeg' });

  const firstRequest = controller.selectFile(first);
  let pendingWaitResolved = false;
  const pendingWait = controller.waitForPendingSelection().then((result) => {
    pendingWaitResolved = true;
    return result;
  });
  const secondRequest = controller.selectFile(second);
  pendingByName.get(first.name).resolve(firstPrepared);
  await firstRequest;
  assert.equal(pendingWaitResolved, false);
  pendingByName.get(second.name).resolve(secondPrepared);
  await secondRequest;
  assert.equal(await pendingWait, true);
  assert.deepEqual(changes, [secondPrepared]);

  const cleared = new File(['cleared'], 'cleared.png', { type: 'image/png' });
  const clearedPrepared = new File(['cleared-ready'], 'cleared.jpg', { type: 'image/jpeg' });
  const clearedRequest = controller.selectFile(cleared);
  controller.clearFile();
  pendingByName.get(cleared.name).resolve(clearedPrepared);
  await clearedRequest;
  assert.deepEqual(changes, [secondPrepared, null]);

  const invalidated = new File(['invalidated'], 'invalidated.png', { type: 'image/png' });
  const invalidatedRequest = controller.selectFile(invalidated);
  const invalidatedWait = controller.waitForPendingSelection();
  controller.invalidatePending();
  assert.equal(await invalidatedWait, false);
  pendingByName.get(invalidated.name).resolve(invalidated);
  await invalidatedRequest;
  assert.deepEqual(changes, [secondPrepared, null]);
});

test('analysis snapshot waits for the pending attachment instead of reading the old file', async () => {
  const { createJDAttachmentSelectionController } = await importJDAttachmentUtils();
  let resolvePreparation;
  const oldFile = new File(['old'], 'old.pdf', { type: 'application/pdf' });
  const nextFile = new File(['next'], 'next.png', { type: 'image/png' });
  const preparedFile = new File(['prepared'], 'next.jpg', { type: 'image/jpeg' });
  let currentFile = oldFile;
  const controller = createJDAttachmentSelectionController(
    (file) => {
      currentFile = file;
    },
    () => new Promise((resolve) => {
      resolvePreparation = resolve;
    }),
  );

  const selection = controller.selectFile(nextFile);
  const captureAnalyzeInput = (async () => {
    const prepared = await controller.waitForPendingSelection();
    return prepared ? currentFile : null;
  })();

  assert.equal(currentFile, oldFile);
  resolvePreparation(preparedFile);
  await selection;
  assert.equal(await captureAnalyzeInput, preparedFile);
});
