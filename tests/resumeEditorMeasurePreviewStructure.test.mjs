import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('ResumeEditor delegates hidden measurement preview to ResumeEditorMeasurePreview', () => {
  const editor = read('views/ResumeEditor/index.tsx');
  const measurePreview = read('views/ResumeEditor/components/ResumeEditorMeasurePreview.tsx');

  assert.match(editor, /ResumeEditorMeasurePreview/);
  assert.match(editor, /useResumeEditorPreviewWorkspaceProps/);
  assert.match(editor, /const sharedPreviewProps/);
  assert.match(editor, /onNavigateTab: handlePreviewNavigateTab/);
  assert.match(editor, /<ResumeEditorMeasurePreview \{\.\.\.measurePreviewProps\} \/>/);
  assert.doesNotMatch(editor, /previewScope: 'editor'/);
  assert.doesNotMatch(editor, /fixed left-\[-200vw\]/);
  assert.doesNotMatch(editor, /previewScope="measure"/);

  assert.match(measurePreview, /fixed left-\[-200vw\] top-0 w-screen md:w-\[calc\(100vw-600px\)\] pointer-events-none opacity-0/);
  assert.match(measurePreview, /aria-hidden="true"/);
  assert.match(measurePreview, /previewScope="measure"/);
  assert.match(measurePreview, /readOnly/);
  assert.match(measurePreview, /isDragging=\{false\}/);
  assert.match(measurePreview, /draggedItemKey=\{null\}/);
  assert.match(measurePreview, /draggedSectionId=\{null\}/);
  assert.match(measurePreview, /onNavigateTab=\{props\.onNavigateTab\}|onNavigateTab=\{onNavigateTab\}/);
  assert.match(measurePreview, /onSectionDragStart=\{noop\}/);
  assert.match(measurePreview, /onSectionDragHover=\{noop\}/);
  assert.match(measurePreview, /onSectionDrop=\{noop\}/);
  assert.match(measurePreview, /onTouchSectionDragStart=\{noop\}/);
  assert.match(measurePreview, /onItemDragStart=\{noop\}/);
  assert.match(measurePreview, /onItemDragHover=\{noop\}/);
  assert.match(measurePreview, /onItemDrop=\{noop\}/);
  assert.match(measurePreview, /onTouchItemDragStart=\{noop\}/);
  assert.match(measurePreview, /onTouchDragEnd=\{noop\}/);
  assert.match(measurePreview, /onTouchDragCancel=\{noop\}/);
  assert.match(measurePreview, /onDragEnd=\{noop\}/);
  assert.match(measurePreview, /onEditExperience=\{noop\}/);
  assert.match(measurePreview, /onEditCertification=\{noop\}/);
  assert.match(measurePreview, /onEditSkill=\{noop\}/);
});
