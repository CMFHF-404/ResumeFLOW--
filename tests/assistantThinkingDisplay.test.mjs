import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const readSource = (path) => readFileSync(path, 'utf8');

test('assistant messages render persisted thinking summaries from content_json', () => {
  const assistantSource = readSource('views/AIAssistant.tsx');
  const conversationViewportSource = readSource('views/AIAssistant/AssistantConversationViewport.tsx');
  const messageItemSource = readSource('views/AIAssistant/MessageItem.tsx');

  assert.match(
    assistantSource,
    /AssistantConversationViewport/,
    'AIAssistant should delegate message rendering to AssistantConversationViewport',
  );
  assert.match(
    conversationViewportSource,
    /content_json\?\.thinking/,
    'AssistantConversationViewport should read persisted thinking summaries from message content',
  );
  assert.match(
    conversationViewportSource,
    /thinking=\{!isUser \? thinking : undefined\}/,
    'AssistantConversationViewport should pass assistant thinking summaries to MessageItem',
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
  assert.match(
    readSource('views/AIAssistant/streamUtils.ts'),
    /resolveThoughtDisplayEvent/,
    'Assistant stream should use the shared thought display resolver',
  );
  assert.doesNotMatch(
    sendingSource,
    /setActiveThought\(\(current\) =>[\s\S]*streamedThoughtText\s*=/,
    'Assistant stream must not mutate persisted thinking text inside a React state updater',
  );
});

test('assistant text stream state is advanced outside React state updaters', () => {
  const sendingSource = readSource('views/AIAssistant/useAssistantMessageSending.ts');

  assert.match(
    sendingSource,
    /reduceAssistantTextStreamEvent/,
    'Assistant text stream should calculate the next stream state before updating React messages',
  );
  assert.doesNotMatch(
    sendingSource,
    /setMessages\(\(prev\) => \{[\s\S]*assistantTextStreamState(?:Ref)?(?:\.current)?\s*=/,
    'Assistant text stream state must not be mutated inside a React state updater',
  );
});

test('newly created assistant sessions skip the first selection reset while sending', () => {
  const controllerSource = readSource('views/AIAssistant/useAssistantSessionController.ts');

  assert.match(
    controllerSource,
    /skipNextSelectionResetSessionIdsRef/,
    'controller should track created sessions whose first selection effect must not clear optimistic messages',
  );
  assert.match(
    controllerSource,
    /skipNextSelectionResetSessionIdsRef\.current\.add\(created\.id\)/,
    'created selected sessions should be marked before setSelectedSessionId runs',
  );
  assert.match(
    controllerSource,
    /skipNextSelectionResetSessionIdsRef\.current\.delete\(selectedSessionId\)[\s\S]*return;/,
    'the first selected-session effect for a created session should skip the message reset and detail load',
  );
});
