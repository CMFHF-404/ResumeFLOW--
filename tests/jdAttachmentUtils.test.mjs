import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
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

const importJDAnalysisSignatureUtils = async () => {
  const result = await build({
    entryPoints: ['hooks/jdAnalysisSignatureUtils.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const encoded = Buffer.from(result.outputFiles[0].text).toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
};

const importJDAttachmentHookCallbacks = async () => {
  const source = readFileSync('hooks/useJDAnalysis.ts', 'utf8');
  const commitStart = source.indexOf('  const commitJdFile =');
  const commitEnd = source.indexOf('  const jdAttachmentSelection =', commitStart);
  const clearStart = source.indexOf('  const clearJdFile =');
  const clearEnd = source.indexOf('  const {', clearStart);
  assert.ok(commitStart >= 0 && commitEnd > commitStart);
  assert.ok(clearStart >= 0 && clearEnd > clearStart);
  const result = await build({
    stdin: {
      contents: `
        import { createJDAttachmentSelectionController } from './utils/jdAttachment';
        import {
          beginJDAttachmentReplacement, restoreJDAttachmentReplacement,
          resolveResumeEvaluationJDContext,
        } from './hooks/jdAnalysisSignatureUtils';
        export const createHarness = (original) => {
          const useCallback = (callback) => callback;
          const state = { ...original, file: null };
          const jdTextRef = { current: original.jdText };
          const jdFileRef = { current: null };
          const attachmentExtractedTextRef = { current: original.attachmentExtractedText };
          const restoredAttachmentContextRef = { current: original.restoredAttachmentContext };
          const pendingJdAttachmentReplacementRef = { current: null };
          const setJdText = (value) => { state.jdText = value; };
          const setJdFile = (value) => { state.file = value; };
          const setAttachmentExtractedText = (value) => { state.attachmentExtractedText = value; };
          const setRestoredAttachmentContext = (value) => { state.restoredAttachmentContext = value; };
          ${source.slice(commitStart, commitEnd)}
          const controller = createJDAttachmentSelectionController(commitJdFile, async (file) => file);
          const clearSelectedJdFile = controller.clearFile;
          ${source.slice(clearStart, clearEnd)}
          return {
            state,
            selectFile: controller.selectFile,
            clearFile: clearJdFile,
            editText(value) {
              setJdText(value);
              jdTextRef.current = value;
            },
            evaluationJDContext() {
              return resolveResumeEvaluationJDContext({
                jdText: state.jdText,
                inputMode: state.file || state.restoredAttachmentContext ? 'attachment' : 'text',
                attachmentExtractedText: state.attachmentExtractedText,
              });
            },
          };
        };
      `,
      loader: 'ts',
      resolveDir: process.cwd(),
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
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
  assert.equal(controller.hasPendingSelection(), true);
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
  assert.equal(controller.hasPendingSelection(), false);
  assert.deepEqual(changes, [secondPrepared]);

  const cleared = new File(['cleared'], 'cleared.png', { type: 'image/png' });
  const clearedPrepared = new File(['cleared-ready'], 'cleared.jpg', { type: 'image/jpeg' });
  const clearedRequest = controller.selectFile(cleared);
  assert.equal(controller.hasPendingSelection(), true);
  controller.clearFile();
  assert.equal(controller.hasPendingSelection(), false);
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

test('pending replacement commits the new file with only the prior user supplement', async () => {
  const { createJDAttachmentSelectionController } = await importJDAttachmentUtils();
  const {
    JD_ATTACHMENT_SUPPLEMENT_PREFIX,
    resolveReplacementJDAttachmentText,
  } = await importJDAnalysisSignatureUtils();
  let resolvePreparation;
  const previousExtractedText = 'Attachment A full JD';
  const state = {
    jdText: `${previousExtractedText}${JD_ATTACHMENT_SUPPLEMENT_PREFIX}User supplement`,
    attachmentExtractedText: previousExtractedText,
    file: new File(['a'], 'a.pdf', { type: 'application/pdf' }),
  };
  const nextFile = new File(['b'], 'b.png', { type: 'image/png' });
  const preparedFile = new File(['b-ready'], 'b.jpg', { type: 'image/jpeg' });
  const controller = createJDAttachmentSelectionController(
    (file) => {
      if (file) {
        state.jdText = resolveReplacementJDAttachmentText(
          state.jdText,
          state.attachmentExtractedText,
        );
        state.attachmentExtractedText = null;
      }
      state.file = file;
    },
    () => new Promise((resolve) => {
      resolvePreparation = resolve;
    }),
  );

  const selection = controller.selectFile(nextFile);
  const resumedSnapshot = (async () => {
    assert.equal(await controller.waitForPendingSelection(), true);
    return { ...state };
  })();
  resolvePreparation(preparedFile);
  await selection;

  assert.deepEqual(await resumedSnapshot, {
    jdText: 'User supplement',
    attachmentExtractedText: null,
    file: preparedFile,
  });
});

test('clearing an unanalyzed replacement restores the exact prior attachment provenance', async () => {
  const {
    beginJDAttachmentReplacement,
    restoreJDAttachmentReplacement,
  } = await importJDAnalysisSignatureUtils();
  const restoredAttachmentContext = {
    jdText: 'User supplement',
    jdInputSignature: 'restored-signature',
    attachmentName: 'missing.pdf',
    attachmentExtractedText: null,
  };
  const original = {
    jdText: 'User supplement',
    attachmentExtractedText: null,
    restoredAttachmentContext,
  };

  const replacement = beginJDAttachmentReplacement(original);
  assert.equal(replacement.jdText, 'User supplement');
  assert.equal(replacement.attachmentExtractedText, null);
  assert.equal(replacement.backup.restoredAttachmentContext, restoredAttachmentContext);
  assert.deepEqual(
    restoreJDAttachmentReplacement(replacement.backup),
    original,
  );

  const hook = readFileSync('hooks/useJDAnalysis.ts', 'utf8');
  assert.match(hook, /pendingJdAttachmentReplacementRef/);
  assert.match(hook, /restoreJDAttachmentReplacement/);
  assert.match(hook, /pendingJdAttachmentReplacementRef\.current = null[\s\S]*?promoteAttachmentToText/);
});

test('removing an attachment keeps manual text edits, including an explicit empty draft', async () => {
  const { createHarness } = await importJDAttachmentHookCallbacks();
  for (const editedText of ['New manually entered JD requirements', '']) {
    const harness = createHarness({
      jdText: 'Original JD text',
      attachmentExtractedText: null,
      restoredAttachmentContext: null,
    });
    await harness.selectFile(new File(['first'], 'first.pdf'));
    harness.editText(editedText);
    // Replacing the file again must not reset the original recovery boundary.
    await harness.selectFile(new File(['second'], 'second.pdf'));
    harness.clearFile();
    assert.equal(harness.state.file, null);
    assert.equal(harness.state.jdText, editedText);
    assert.equal(harness.evaluationJDContext().text, editedText);
  }
});

test('removing a replacement keeps edited supplements and the original attachment provenance', async () => {
  const { createHarness } = await importJDAttachmentHookCallbacks();
  const { JD_ATTACHMENT_SUPPLEMENT_PREFIX } = await importJDAnalysisSignatureUtils();
  for (const extractedText of [null, 'Recovered original attachment body']) {
    const originalContext = {
      jdText: 'Original supplement',
      jdInputSignature: 'original-attachment-signature',
      attachmentName: 'original.pdf',
      attachmentExtractedText: extractedText,
    };
    const harness = createHarness({
      jdText: originalContext.jdText,
      attachmentExtractedText: extractedText,
      restoredAttachmentContext: originalContext,
    });
    await harness.selectFile(new File(['replacement'], 'replacement.pdf'));
    harness.editText('Edited supplement');
    harness.clearFile();
    assert.equal(harness.state.jdText, 'Edited supplement');
    assert.equal(harness.state.attachmentExtractedText, extractedText);
    assert.deepEqual(harness.state.restoredAttachmentContext, originalContext);
    const evaluationContext = harness.evaluationJDContext();
    assert.equal(evaluationContext.hasMissingAttachmentText, extractedText === null);
    assert.equal(evaluationContext.text, extractedText
      ? `${extractedText}${JD_ATTACHMENT_SUPPLEMENT_PREFIX}Edited supplement`
      : '');
  }
});

test('removing an unedited replacement restores the complete prior derived JD text', async () => {
  const { createHarness } = await importJDAttachmentHookCallbacks();
  const { JD_ATTACHMENT_SUPPLEMENT_PREFIX } = await importJDAnalysisSignatureUtils();
  const original = {
    jdText: `Original attachment body${JD_ATTACHMENT_SUPPLEMENT_PREFIX}Original supplement`,
    attachmentExtractedText: 'Original attachment body',
    restoredAttachmentContext: null,
  };
  const harness = createHarness(original);
  await harness.selectFile(new File(['replacement'], 'replacement.pdf'));
  assert.equal(harness.state.jdText, 'Original supplement');
  harness.clearFile();
  assert.deepEqual(harness.state, { ...original, file: null });
});
