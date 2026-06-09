import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('ResumeEditor delegates preview workspace prop assembly to a focused hook', () => {
  const editor = read('views/ResumeEditor/index.tsx');
  const hook = read('views/ResumeEditor/hooks/useResumeEditorPreviewWorkspaceProps.ts');

  assert.match(editor, /from '\.\/hooks\/useResumeEditorPreviewWorkspaceProps'/);
  assert.match(editor, /const sharedPreviewProps/);
  assert.match(editor, /useResumeEditorPreviewWorkspaceProps\(\{/);
  assert.match(editor, /layoutAdjustProps=\{layoutAdjustProps\}/);
  assert.match(editor, /previewProps=\{editorPreviewProps\}/);
  assert.match(editor, /<ResumeEditorMeasurePreview \{\.\.\.measurePreviewProps\} \/>/);
  assert.doesNotMatch(editor, /layoutAdjustProps=\{\{/);
  assert.doesNotMatch(editor, /previewProps=\{\{/);
  assert.doesNotMatch(editor, /previewScope: 'editor'/);

  assert.match(hook, /export type SharedResumePreviewProps/);
  assert.match(hook, /const layoutAdjustProps: ResumeEditorLayoutAdjustPanelProps = \{/);
  assert.match(hook, /isOpen: isLayoutAdjustToolbarOpen/);
  assert.match(hook, /onLineHeightChange/);
  assert.match(hook, /onThemeColorChange/);
  assert.match(hook, /const editorPreviewProps: ResumePreviewProps = \{/);
  assert.match(hook, /previewScope: 'editor'/);
  assert.match(hook, /showOverflowGuide: isPreviewOverflowing/);
  assert.match(hook, /overflowHighlightSectionIds: overflowingSectionIds/);
  assert.match(hook, /polishHighlightItemIds: floatingPolishHighlightItemIds/);
  assert.match(hook, /readOnly: isPreviewInteractionLocked/);
  assert.match(hook, /onSectionDragStart/);
  assert.match(hook, /onEditExperience/);
  assert.match(hook, /const measurePreviewProps: ResumeEditorMeasurePreviewProps = \{/);
  assert.match(hook, /previewRef: measurePreviewRef/);
  assert.match(hook, /lineHeight: measureLayout\.lineHeight/);
  assert.match(hook, /sectionSpacingClass: measureSectionSpacingClass/);
});
