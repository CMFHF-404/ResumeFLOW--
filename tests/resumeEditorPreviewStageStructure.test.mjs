import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('ResumeEditor delegates editor preview shell to ResumeEditorPreviewStage', () => {
  const editor = read('views/ResumeEditor/index.tsx');
  const workspace = read('views/ResumeEditor/components/ResumeEditorDesktopWorkspace.tsx');
  const stage = read('views/ResumeEditor/components/ResumeEditorPreviewStage.tsx');

  assert.match(editor, /ResumeEditorDesktopWorkspace/);
  assert.doesNotMatch(editor, /import ResumePreview from '\.\/components\/ResumePreview'/);
  assert.doesNotMatch(editor, /<ResumePreview\s/);
  assert.match(editor, /useResumeEditorPreviewWorkspaceProps/);
  assert.match(editor, /previewProps=\{editorPreviewProps\}/);

  assert.match(workspace, /import ResumeEditorPreviewStage from '\.\/ResumeEditorPreviewStage'/);
  assert.match(workspace, /<ResumeEditorPreviewStage/);
  assert.match(workspace, /previewProps=\{previewProps\}/);

  assert.match(stage, /import ResumePreview, \{ type ResumePreviewProps \} from '\.\/ResumePreview'/);
  assert.match(stage, /previewProps: ResumePreviewProps/);
  assert.match(stage, /flex flex-1 flex-col min-w-0 overflow-visible pb-20 md:min-h-0 md:overflow-hidden md:pb-0/);
  assert.match(stage, /<ResumeEditorLayoutAdjustPanel \{\.\.\.layoutAdjustProps\} \/>/);
  assert.match(stage, /<ResumePreview \{\.\.\.previewProps\} \/>/);
});
