import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const readSource = (path) => readFileSync(path, 'utf8');

test('assistant messages render persisted thinking summaries from content_json', () => {
  const assistantSource = readSource('views/AIAssistant.tsx');
  const messageItemSource = readSource('views/AIAssistant/MessageItem.tsx');

  assert.match(
    assistantSource,
    /content_json\?\.thinking/,
    'AIAssistant should read persisted thinking summaries from message content',
  );
  assert.match(
    assistantSource,
    /thinking=\{!isUser \? thinking : undefined\}/,
    'AIAssistant should pass assistant thinking summaries to MessageItem',
  );
  assert.match(
    messageItemSource,
    /thinking\?: string/,
    'MessageItem should accept persisted thinking summaries',
  );
  assert.match(
    messageItemSource,
    /CompletedThoughtBlock/,
    'MessageItem should render completed thinking summaries separately from active streaming state',
  );
});

test('assistant stream stores thinking state outside React state updaters', () => {
  const sendingSource = readSource('views/AIAssistant/useAssistantMessageSending.ts');

  assert.match(
    sendingSource,
    /let thoughtStreamState = \{\s*activeThought: '',\s*streamedThoughtText: '',\s*\};/,
    'Assistant stream should keep a synchronous local thought state for final optimistic messages',
  );
  assert.match(
    sendingSource,
    /thoughtStreamState = reduceAssistantThoughtStreamState\(\s*thoughtStreamState,\s*event,\s*enableThinking,\s*\);[\s\S]*setActiveThought\(thoughtStreamState\.activeThought\);/,
    'Assistant stream should update the local state before touching React state',
  );
  assert.doesNotMatch(
    sendingSource,
    /setActiveThought\(\(current\) =>[\s\S]*streamedThoughtText\s*=/,
    'Assistant stream must not mutate persisted thinking text inside a React state updater',
  );
});
