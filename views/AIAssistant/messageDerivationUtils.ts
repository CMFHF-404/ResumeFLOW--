import type {
  AssistantDraftCard,
  AssistantMessage,
  AssistantSession,
  AssistantSuggestedFollowup,
} from '../../services/aiService';
import { isAssistantDraftCardDisplayable, normalizeAssistantDraftCard } from '../../utils/assistantDraft';
import {
  buildFallbackSuggestedFollowups,
  normalizeAssistantSuggestedFollowups,
} from './selectionUtils';
import type { AssistantDraftMessageItem } from './sessionUtils';
import { isPersistedCallbackOnlySession } from './sessionContextUtils';

export type DerivedDraftMessageItem = Omit<AssistantDraftMessageItem, 'onJumpToEditor'>;

export const deriveLatestSuggestedFollowups = (
  messages: AssistantMessage[],
): AssistantSuggestedFollowup[] => {
  let fallbackFollowups: AssistantSuggestedFollowup[] = [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== 'assistant' || message.message_type !== 'assistant_text') {
      continue;
    }
    const followups = normalizeAssistantSuggestedFollowups(message.content_json?.suggestedFollowups);
    if (followups.length > 0) {
      return followups;
    }
    if (fallbackFollowups.length === 0) {
      fallbackFollowups = buildFallbackSuggestedFollowups(message);
    }
  }
  return fallbackFollowups;
};

export const isResumeEditorManualSaveDraft = (
  session: AssistantSession | null,
  callbackOnlySessionIds: ReadonlySet<string>,
  card: AssistantDraftCard,
) => Boolean(
  session
  && card.type === 'experience'
  && session.entry_source === 'resume_editor'
  && (
    callbackOnlySessionIds.has(session.id)
    || isPersistedCallbackOnlySession(session)
  )
);

export const deriveDraftMessageItems = (
  messages: AssistantMessage[],
  selectedSession: AssistantSession | null,
  callbackOnlySessionIds: ReadonlySet<string>,
): DerivedDraftMessageItem[] => (
  messages.flatMap((message) => {
    if (message.message_type !== 'draft_card') {
      return [];
    }
    const card = normalizeAssistantDraftCard(message.content_json as unknown as AssistantDraftCard);
    if (!isAssistantDraftCardDisplayable(card)) {
      return [];
    }
    return [{
      message,
      card,
      isManualSaveMode: isResumeEditorManualSaveDraft(selectedSession, callbackOnlySessionIds, card),
    }];
  })
);
