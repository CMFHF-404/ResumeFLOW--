import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';

const source = () => readFileSync('components/RichTextEditor.tsx', 'utf8');

const importRichTextEditorModule = async () => {
  const result = await build({
    entryPoints: ['components/RichTextEditor.tsx'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const encoded = Buffer.from(result.outputFiles[0].text).toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
};

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

test('plain bullet cues keep focused blank lines to a single caret row', async () => {
  const { resolvePlainLineBulletCueIndices } = await importRichTextEditorModule();

  assert.deepEqual(
    resolvePlainLineBulletCueIndices(['第一行', '第二行', '', ''], false, 3),
    [0, 1],
    'closed cards should only show cues for non-empty text rows'
  );
  assert.deepEqual(
    resolvePlainLineBulletCueIndices(['第一行', '第二行', '', ''], true, 3),
    [0, 1, 3],
    'focused cards should add only the current blank caret row'
  );
  assert.deepEqual(
    resolvePlainLineBulletCueIndices(['第一行', '', '第二行'], true, 1),
    [0, 1, 2],
    'a blank caret row between filled rows should get one cue without adding other blanks'
  );
  assert.deepEqual(
    resolvePlainLineBulletCueIndices(['第一行'], true, 0),
    [0],
    'caret on an already visible text row must not duplicate its cue'
  );
});

test('caret top measurement is limited to blank caret rows', () => {
  const richTextEditorSource = source();

  assert.match(
    richTextEditorSource,
    /includeCaretLine &&\s*caretLineIndex !== null &&\s*cueLineIndexSet\.has\(caretLineIndex\) &&\s*!\(lines\[caretLineIndex\] \?\? ''\)\.trim\(\)/
  );
});
