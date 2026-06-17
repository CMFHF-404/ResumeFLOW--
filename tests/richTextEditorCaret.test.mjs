import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = () => readFileSync('components/RichTextEditor.tsx', 'utf8');

test('plain Enter saves the inserted line break before selection state updates', () => {
  const richTextEditorSource = source();

  assert.match(
    richTextEditorSource,
    /if \(triggerKey === ENTER_KEY\) \{\s*if \(isInList\) \{\s*return;\s*\}\s*event\.preventDefault\(\);\s*document\.execCommand\('insertLineBreak'\);\s*saveContent\(\);\s*updateSelectionState\(\);\s*\}/
  );
});

test('focused editor still accepts external value updates that are not local echoes', () => {
  const richTextEditorSource = source();

  assert.match(
    richTextEditorSource,
    /if \(isFocused && sanitized === lastLocalValueRef\.current\) \{\s*return;\s*\}/
  );
  assert.match(
    richTextEditorSource,
    /if \(editor\.innerHTML !== sanitized\) \{\s*editor\.innerHTML = sanitized;\s*lastLocalValueRef\.current = null;\s*\}/
  );
  assert.match(
    richTextEditorSource,
    /lastLocalValueRef\.current = sanitized;[\s\S]*onChange\(sanitized\);/
  );
  assert.match(
    richTextEditorSource,
    /useEditorSync\(editorRef, value, isFocused, lastLocalValueRef\);/
  );
});
