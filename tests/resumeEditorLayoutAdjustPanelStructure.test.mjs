import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('ResumeEditor delegates layout adjust toolbar configuration to ResumeEditorLayoutAdjustPanel', () => {
  const editor = read('views/ResumeEditor/index.tsx');
  const workspace = read('views/ResumeEditor/components/ResumeEditorDesktopWorkspace.tsx');
  const stage = read('views/ResumeEditor/components/ResumeEditorPreviewStage.tsx');
  const panel = read('views/ResumeEditor/components/ResumeEditorLayoutAdjustPanel.tsx');

  assert.match(editor, /ResumeEditorDesktopWorkspace/);
  assert.match(editor, /useResumeEditorPreviewWorkspaceProps/);
  assert.match(editor, /layoutAdjustProps=\{layoutAdjustProps\}/);
  assert.doesNotMatch(editor, /lineHeightOptions=\{LINE_HEIGHT_OPTIONS\}/);
  assert.doesNotMatch(editor, /themeColorOptions=\{RESUME_THEME_COLOR_PRESETS\}/);
  assert.doesNotMatch(editor, /lineHeightSlider=\{\{/);
  assert.doesNotMatch(editor, /itemSpacingSlider=\{\{/);

  assert.match(workspace, /import ResumeEditorPreviewStage/);
  assert.match(workspace, /layoutAdjustProps=\{layoutAdjustProps\}/);

  assert.match(stage, /import ResumeEditorLayoutAdjustPanel/);
  assert.match(stage, /layoutAdjustProps: React\.ComponentProps<typeof ResumeEditorLayoutAdjustPanel>/);
  assert.match(stage, /<ResumeEditorLayoutAdjustPanel \{\.\.\.layoutAdjustProps\} \/>/);

  assert.match(panel, /import LayoutAdjustToolbar/);
  assert.match(panel, /if \(!isOpen\) \{\s*return null;\s*\}/);
  assert.match(panel, /lineHeightOptions=\{LINE_HEIGHT_OPTIONS\}/);
  assert.match(panel, /fontSizeOptions=\{FONT_SIZE_OPTIONS\}/);
  assert.match(panel, /topPaddingOptions=\{TOP_PADDING_SELECT_OPTIONS\}/);
  assert.match(panel, /sectionSpacingOptions=\{SECTION_SPACING_OPTIONS\}/);
  assert.match(panel, /itemSpacingOptions=\{ITEM_SPACING_SELECT_OPTIONS\}/);
  assert.match(panel, /themeColorOptions=\{RESUME_THEME_COLOR_PRESETS\}/);
  assert.match(panel, /lineHeightSlider=\{\{\s*min: LINE_HEIGHT_MIN,\s*max: LINE_HEIGHT_MAX,\s*step: LINE_HEIGHT_STEP,\s*\}\}/);
  assert.match(panel, /fontSizeSlider=\{\{\s*min: FONT_SIZE_MIN,\s*max: FONT_SIZE_MAX,\s*step: FONT_SIZE_STEP,\s*\}\}/);
  assert.match(panel, /topPaddingSlider=\{\{\s*min: TOP_PADDING_MIN_PX,\s*max: TOP_PADDING_SLIDER_MAX,\s*step: SMART_PAGE_TOP_PADDING_STEP_PX,\s*\}\}/);
  assert.match(panel, /sectionSpacingSlider=\{\{\s*min: 2,\s*max: 12,\s*step: 1,\s*\}\}/);
  assert.match(panel, /itemSpacingSlider=\{\{\s*min: SMART_PAGE_ITEM_SPACING_MIN,\s*max: MAX_ITEM_SPACING_EM,\s*step: SMART_PAGE_ITEM_SPACING_STEP,\s*\}\}/);
});
