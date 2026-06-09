import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('AIAssistant delegates composer resize tracking to a focused hook', () => {
  const assistant = read('views/AIAssistant.tsx');
  const hook = read('views/AIAssistant/useAssistantComposerResize.ts');

  assert.match(assistant, /from '\.\/AIAssistant\/useAssistantComposerResize'/);
  assert.match(assistant, /useAssistantComposerResize\(\)/);
  assert.match(assistant, /ref=\{messageViewportRef\}/);
  assert.match(assistant, /ref=\{composerContainerRef\}/);
  assert.match(assistant, /paddingBottom: `\$\{composerReservedHeight\}px`/);
  assert.match(assistant, /scrollToBottom\(\)/);
  assert.doesNotMatch(assistant, /computeComposerReservedHeight/);
  assert.doesNotMatch(assistant, /ResizeObserver/);
  assert.doesNotMatch(assistant, /composerHeightRef/);

  assert.match(hook, /computeComposerReservedHeight/);
  assert.match(hook, /const \[composerReservedHeight, setComposerReservedHeight\] = useState\(160\)/);
  assert.match(hook, /messageViewportRef = useRef<HTMLDivElement \| null>\(null\)/);
  assert.match(hook, /composerContainerRef = useRef<HTMLDivElement \| null>\(null\)/);
  assert.match(hook, /const syncComposerResize = \(\) =>/);
  assert.match(hook, /ResizeObserver/);
  assert.match(hook, /window\.addEventListener\('resize', syncComposerResize\)/);
  assert.match(hook, /requestAnimationFrame/);
  assert.match(hook, /scrollToBottom/);
});
