import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('template presets persist and apply layout defaults', () => {
  const storage = read('views/resumeTemplateStorage.ts');
  const actions = read('views/ResumeEditor/hooks/useTemplatePresetActions.ts');
  const editor = read('views/ResumeEditor/index.tsx');

  assert.match(storage, /layoutDefaults\?: Partial<SmartPageLayout> \| null/);
  assert.match(storage, /layoutDefaults\?: SmartPageLayout/);
  assert.match(storage, /const normalizeLayoutDefaults/);
  assert.match(storage, /layoutDefaults: preset\.layoutDefaults \?\? existingPreset\?\.layoutDefaults/);
  assert.match(storage, /\.\.\.\(preset\?\.layoutDefaults \? \{ \.\.\.preset\.layoutDefaults \} : \{\}\)/);

  assert.match(actions, /layoutDefaults\?: SmartPageLayout/);
  assert.match(actions, /onApplyTemplateLayoutDefaults\?: \(layoutDefaults: SmartPageLayout\) => void/);
  assert.match(actions, /if \(preset\?\.layoutDefaults\) \{\s*onApplyTemplateLayoutDefaults\?\.\(preset\.layoutDefaults\);/);

  assert.match(editor, /const applyTemplateLayoutDefaults = useCallback/);
  assert.match(editor, /commitLayoutSnapshot\(buildLayoutSnapshot\(layoutDefaults, false\), \{ incrementVersion: true \}\)/);
  assert.match(editor, /layoutDefaults: currentLayoutDefaults/);
  assert.match(editor, /templatePresetMap\[resumeTemplateId\]\?\.layoutDefaults/);
  assert.match(editor, /onSaveCurrentTemplateDefault: handleSaveCurrentTemplateDefault/);
  assert.match(editor, /onRestoreDefault: handleRestoreTemplateDefault/);
});
