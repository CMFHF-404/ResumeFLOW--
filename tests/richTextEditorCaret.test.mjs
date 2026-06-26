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

const importRichTextUtilsModule = async () => {
  const result = await build({
    entryPoints: ['utils/richText.ts'],
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

test('mobile selection toolbar anchors below the editor instead of the selection range', async () => {
  const { resolveRichTextToolbarState } = await importRichTextEditorModule();

  const state = resolveRichTextToolbarState(
    { bottom: 650, left: 96, top: 620, width: 280 },
    { bottom: 608, left: 60, top: 454, width: 768 },
    { width: 599, isCoarsePointer: true }
  );

  assert.equal(state.placement, 'editor-bottom');
  assert.equal(state.x, 444);
  assert.equal(state.y, 616);
});

test('selection toolbar hides ordered list sorting action', () => {
  const richTextEditorSource = source();
  const toolbarButtonsBlock = richTextEditorSource.match(/const toolbarButtons = useMemo\(\(\) => \{[\s\S]*?\}, \[applyList/)?.[0] ?? '';

  assert.doesNotMatch(toolbarButtonsBlock, /id: 'ordered-list'/);
  assert.doesNotMatch(toolbarButtonsBlock, /label: '1\.'/);
  assert.doesNotMatch(toolbarButtonsBlock, /applyList\('insertOrderedList'\)/);
});

test('mobile selection toolbar does not reserve editor space', () => {
  const richTextEditorSource = source();

  assert.match(richTextEditorSource, /top-full/);
  assert.doesNotMatch(richTextEditorSource, /paddingTop/);
  assert.doesNotMatch(richTextEditorSource, /style=\{editorStyle\}/);
});

test('caret top measurement is limited to blank caret rows', () => {
  const richTextEditorSource = source();

  assert.match(
    richTextEditorSource,
    /includeCaretLine &&\s*caretLineIndex !== null &&\s*cueLineIndexSet\.has\(caretLineIndex\) &&\s*!\(lines\[caretLineIndex\] \?\? ''\)\.trim\(\)/
  );
});

test('line bullet cues refresh after late layout and font changes', () => {
  const richTextEditorSource = source();

  assert.match(
    richTextEditorSource,
    /document\.fonts\?\.ready/,
    'plain line bullet cues should remeasure after web fonts settle'
  );
  assert.match(
    richTextEditorSource,
    /new ResizeObserver/,
    'plain line bullet cues should remeasure when the editor dimensions change'
  );
});

test('clipboard paste prefers sanitized rich html and copy exposes html plus plain text', () => {
  const richTextEditorSource = source();

  assert.match(richTextEditorSource, /event\.clipboardData\.getData\('text\/html'\)/);
  assert.match(richTextEditorSource, /event\.clipboardData\.getData\('text\/plain'\)/);
  assert.match(richTextEditorSource, /resolveClipboardPasteHtml\(html, text\)/);
  assert.match(richTextEditorSource, /insertClipboardContent\(editor, resolveClipboardPasteHtml\(html, text\)\)/);
  assert.match(richTextEditorSource, /event\.clipboardData\.setData\('text\/html', html\)/);
  assert.match(richTextEditorSource, /event\.clipboardData\.setData\('text\/plain', stripRichTextToText\(html\)\)/);
  assert.match(richTextEditorSource, /onCopy=\{readOnly \? undefined : handleCopy\}/);
});

test('clipboard paste uses native insertion so browser undo can revert the paste', () => {
  const richTextEditorSource = source();
  const clipboardInsertBlock = richTextEditorSource.match(/const insertClipboardContent = [\s\S]*?\n\};/)?.[0] ?? '';

  assert.match(clipboardInsertBlock, /document\.execCommand\('insertHTML', false, html\)/);
  assert.doesNotMatch(clipboardInsertBlock, /range\.deleteContents\(\)/);
  assert.doesNotMatch(clipboardInsertBlock, /range\.insertNode\(/);
});

test('rich text sanitizer recognizes clipboard inline font styles', async () => {
  const { resolveRichTextInlineStyleTags } = await importRichTextUtilsModule();

  assert.deepEqual(
    resolveRichTextInlineStyleTags({
      fontWeight: '700',
      fontStyle: 'italic',
      textDecoration: '',
      textDecorationLine: 'underline',
    }),
    ['b', 'i', 'u']
  );
  assert.deepEqual(
    resolveRichTextInlineStyleTags({
      fontWeight: '400',
      fontStyle: 'normal',
      textDecoration: 'none',
      textDecorationLine: '',
    }),
    []
  );
});

test('clipboard paste html drops only synthetic boundary block line breaks', async () => {
  const {
    buildPlainTextPasteHtml,
    normalizeClipboardPlainTextForPaste,
    resolveClipboardPasteHtml,
    resolveSanitizedClipboardPasteHtml,
    trimSyntheticClipboardBoundaryLineBreaks,
  } = await importRichTextUtilsModule();

  assert.equal(normalizeClipboardPlainTextForPaste('普通文本\r\n'), '普通文本');
  assert.equal(normalizeClipboardPlainTextForPaste('\n普通文本\n\n'), '普通文本');
  assert.equal(normalizeClipboardPlainTextForPaste('第一行\r\n第二行\r\n'), '第一行\n第二行');
  assert.equal(
    trimSyntheticClipboardBoundaryLineBreaks(
      '<a href="https://example.com" target="_blank" rel="noreferrer">原子简历</a><br>',
      '原子简历'
    ),
    '<a href="https://example.com" target="_blank" rel="noreferrer">原子简历</a>'
  );
  assert.equal(
    trimSyntheticClipboardBoundaryLineBreaks('第一行<br>第二行<br>', '第一行\n第二行'),
    '第一行<br>第二行'
  );
  assert.equal(
    trimSyntheticClipboardBoundaryLineBreaks('第一行<br>第二行<br><br>', '第一行\n第二行'),
    '第一行<br>第二行'
  );
  assert.equal(
    trimSyntheticClipboardBoundaryLineBreaks('第一行<br>第二行', '第一行\n第二行'),
    '第一行<br>第二行'
  );
  assert.equal(
    trimSyntheticClipboardBoundaryLineBreaks('第一行<br>', '第一行\n'),
    '第一行'
  );
  assert.equal(
    resolveSanitizedClipboardPasteHtml('普通文本', '普通文本'),
    ''
  );
  assert.equal(
    resolveSanitizedClipboardPasteHtml('<a href="https://example.com" target="_blank" rel="noreferrer">原子简历</a><br>', '原子简历'),
    '<a href="https://example.com" target="_blank" rel="noreferrer">原子简历</a>'
  );
  assert.equal(
    resolveSanitizedClipboardPasteHtml('第一行<br>第二行<br>', '第一行\n第二行'),
    '第一行<br>第二行'
  );
  assert.equal(
    resolveSanitizedClipboardPasteHtml('<a href="https://example.com" target="_blank" rel="noreferrer">原子简历</a><br>', '原子简历\n'),
    '<a href="https://example.com" target="_blank" rel="noreferrer">原子简历</a>'
  );
  assert.equal(
    resolveSanitizedClipboardPasteHtml('<br><b>行动</b><br>', '\n行动\n'),
    '<b>行动</b>'
  );
  assert.equal(
    resolveSanitizedClipboardPasteHtml('<br>行动<br>', '\n行动\n'),
    ''
  );
  assert.equal(
    buildPlainTextPasteHtml('第一行\n第二行 & <tag>'),
    '第一行<br>第二行 &amp; &lt;tag&gt;'
  );
  assert.equal(
    resolveClipboardPasteHtml('', '\n行动\n'),
    '行动'
  );
  assert.equal(
    resolveClipboardPasteHtml('', '<script>alert(1)</script>\n'),
    '&lt;script&gt;alert(1)&lt;/script&gt;'
  );
});
