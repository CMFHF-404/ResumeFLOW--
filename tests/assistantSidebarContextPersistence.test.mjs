import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const sliceBetween = (source, startPattern, endPattern) => {
  const start = source.search(startPattern);
  assert.ok(start >= 0, `missing start pattern ${startPattern}`);
  const rest = source.slice(start);
  const end = rest.search(endPattern);
  assert.ok(end >= 0, `missing end pattern ${endPattern}`);
  return rest.slice(0, end);
};

test('assistant sends keep selected resume context attached to the active sidebar conversation', () => {
  const sendingHook = read('views/AIAssistant/useAssistantMessageSending.ts');

  const optimisticUpdateBlock = sliceBetween(
    sendingHook,
    /setMessages\(\(prev\) => \[\.\.\.prev, optimisticUserMessage\]\);/,
    /\n\s*try \{/,
  );
  assert.doesNotMatch(optimisticUpdateBlock, /persistDraftSelectedResume\(sessionId,\s*null\)/);
  assert.doesNotMatch(optimisticUpdateBlock, /setSelectedResume\(null\)/);

  const successfulSendBlock = sliceBetween(
    sendingHook,
    /persistSessionSnapshot\(sessionId, result\.title, result\.draftCard \?\? null\);/,
    /\n\s*\} catch \(sendError\) \{/,
  );
  assert.doesNotMatch(successfulSendBlock, /persistDraftSelectedResume\(sessionId,\s*null\)/);
  assert.doesNotMatch(successfulSendBlock, /setSelectedResume\(null\)/);
  assert.match(sendingHook, /persistDraftSelectedResume\(sessionId, selectedResumeItem\)/);
  assert.match(sendingHook, /setSelectedResume\(\(current\) => current \?\? selectedResumeItem\)/);
});

test('sidebar new chat starts with the current editor-selected resume context', () => {
  const assistant = read('views/AIAssistant.tsx');
  const historyHook = read('views/AIAssistant/useAssistantHistoryActions.ts');
  const sidebarNewChatBlock = sliceBetween(
    assistant,
    /const handleSidebarNewChat = useCallback\(\(\) => \{/,
    /\n\s*\}, \[handleNewChat/,
  );

  assert.match(assistant, /const implicitLiveSelectedResume = useMemo/);
  assert.match(assistant, /normalizeSelectedResume\(liveSelectedResume\)/);
  assert.match(assistant, /const markImplicitCurrentResume = /);
  assert.match(assistant, /contextSource: 'implicit_current_resume'/);
  assert.match(sidebarNewChatBlock, /selectedResumeDraft: implicitLiveSelectedResume/);
  assert.match(
    sidebarNewChatBlock,
    /void handleNewChat\('general', \{\s*selectedResumeDraft: implicitLiveSelectedResume,\s*\}\)/,
  );
  assert.match(historyHook, /selectedResumeDraft\?: AssistantSelectedResume \| null/);
  assert.match(historyHook, /selectedResumeDraft: options\?\.selectedResumeDraft \?\? null/);
});
