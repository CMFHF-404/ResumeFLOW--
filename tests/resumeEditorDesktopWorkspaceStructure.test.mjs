import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('ResumeEditor delegates desktop sidebar and preview workspace shell', () => {
  const editor = read('views/ResumeEditor/index.tsx');
  const workspace = read('views/ResumeEditor/components/ResumeEditorDesktopWorkspace.tsx');

  assert.match(editor, /ResumeEditorDesktopWorkspace/);
  assert.match(editor, /sidebarProps=\{commonEditorSidebarProps\}/);
  assert.match(editor, /layoutAdjustProps=\{layoutAdjustProps\}/);
  assert.match(editor, /previewProps=\{editorPreviewProps\}/);
  assert.doesNotMatch(editor, /SIDEBAR_WIDTH_CLASS/);
  assert.doesNotMatch(editor, /hidden md:flex md:h-full md:min-h-0 md:shrink-0 md:overflow-hidden/);
  assert.doesNotMatch(editor, /<EditorSidebar\s/);

  assert.match(workspace, /import \{ SIDEBAR_WIDTH_CLASS \} from '\.\.\/constants'/);
  assert.match(workspace, /import EditorSidebar, \{ type EditorSidebarProps \} from '\.\/EditorSidebar'/);
  assert.match(workspace, /import ResumeEditorPreviewStage from '\.\/ResumeEditorPreviewStage'/);
  assert.match(workspace, /sidebarProps: Omit<EditorSidebarProps, 'layoutMode' \| 'showJDPanel'>/);
  assert.match(workspace, /flex flex-1 flex-col overflow-visible md:min-h-0 md:overflow-hidden md:flex-row/);
  assert.match(workspace, /hidden md:flex md:h-full md:min-h-0 md:shrink-0 md:overflow-hidden \$\{SIDEBAR_WIDTH_CLASS\}/);
  assert.match(workspace, /<EditorSidebar \{\.\.\.sidebarProps\} \/>/);
  assert.match(workspace, /<ResumeEditorPreviewStage/);
  assert.match(workspace, /layoutAdjustProps=\{layoutAdjustProps\}/);
  assert.match(workspace, /previewProps=\{previewProps\}/);
  assert.doesNotMatch(workspace, /layoutMode="drawer"/);
  assert.doesNotMatch(workspace, /showJDPanel=\{false\}/);
});
