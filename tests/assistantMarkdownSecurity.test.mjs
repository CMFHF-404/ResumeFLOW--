import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('assistant Markdown renderers discard Markdown image nodes without enabling raw HTML', () => {
  const messageItem = read('views/AIAssistant/MessageItem.tsx');
  const draftCard = read('views/AIAssistant/AssistantDraftCardView.tsx');

  assert.match(messageItem, /img:\s*\(\)\s*=>\s*null/);
  assert.match(draftCard, /img:\s*\(\)\s*=>\s*null/);
  assert.doesNotMatch(messageItem, /rehypeRaw/);
  assert.doesNotMatch(draftCard, /rehypeRaw/);
});
