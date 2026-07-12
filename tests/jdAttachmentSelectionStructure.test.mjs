import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('JD attachment preparation and latest-selection authority stay centralized', () => {
  const attachmentUtils = read('utils/jdAttachment.ts');
  const analysisHook = read('hooks/useJDAnalysis.ts');
  const editor = read('views/ResumeEditor/index.tsx');
  const uploader = read('views/ResumeEditor/components/JDAttachmentUploader.tsx');
  const mobileHeader = read('views/ResumeEditor/components/MobileEditorHeader.tsx');
  const analysisPanel = read('views/ResumeEditor/components/JDAnalysisPanel.tsx');

  assert.match(attachmentUtils, /export const prepareJDAttachmentFile/);
  assert.match(attachmentUtils, /createJDAttachmentSelectionController/);
  assert.match(analysisHook, /createJDAttachmentSelectionController\(commitJdFile\)/);
  assert.match(analysisHook, /selectFile: selectJdFile/);
  assert.match(analysisHook, /clearFile: clearJdFile/);
  assert.match(analysisHook, /invalidatePending: invalidatePendingJdFileSelection/);
  assert.match(analysisHook, /waitForPendingSelection: waitForPendingJdFileSelection/);
  assert.match(
    analysisHook,
    /await waitForPendingJdFileSelection\(\);[\s\S]*const snapshot = buildAnalyzeSnapshot\(\);/,
  );
  assert.match(analysisHook, /analyzeRequestRef/);
  assert.match(editor, /onFileSelect: selectJdFile/);
  assert.match(editor, /onFileClear: clearJdFile/);
  assert.match(editor, /onFileSelect=\{selectJdFile\}/);
  assert.match(editor, /onFileClear=\{clearJdFile\}/);

  assert.match(uploader, /onFileSelect: \(file: File\) => Promise<void>/);
  assert.match(uploader, /void onFileSelect\(selected\)/);
  assert.doesNotMatch(uploader, /createJDAttachmentSelectionController/);
  assert.doesNotMatch(uploader, /useJDAttachmentFileSelection/);
  assert.doesNotMatch(uploader, /await prepareJDAttachmentFile/);

  for (const parent of [mobileHeader, analysisPanel]) {
    assert.match(parent, /onFileSelect: \(file: File\) => Promise<void>/);
    assert.match(parent, /onFileClear: \(\) => void/);
    assert.match(parent, /onFileSelect=\{onFileSelect\}/);
    assert.match(parent, /onClear=\{onFileClear\}/);
    assert.doesNotMatch(parent, /useJDAttachmentFileSelection/);
    assert.doesNotMatch(parent, /SelectionVersionRef/);
  }

  assert.match(uploader, /from '\.\.\/\.\.\/\.\.\/utils\/jdAttachment'/);
  assert.match(uploader, /prepareJDAttachmentFile/);
});
