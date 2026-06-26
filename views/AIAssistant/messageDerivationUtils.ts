import type {
  AssistantDraftApplyNavigation,
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

export type DerivedDraftMessageItem = Omit<AssistantDraftMessageItem, 'onJumpToEditor' | 'onViewAppliedDraft'>;

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

const normalizeDraftApplyNavigation = (value: unknown): AssistantDraftApplyNavigation | undefined => {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const candidate = value as Record<string, unknown>;
  const targetView = candidate.targetView;
  if (targetView !== 'experience_bank' && targetView !== 'resume_editor') {
    return undefined;
  }
  const navigation: AssistantDraftApplyNavigation = { targetView };
  if (typeof candidate.targetId === 'string' && candidate.targetId.trim()) {
    navigation.targetId = candidate.targetId.trim();
  }
  if (typeof candidate.resumeId === 'string' && candidate.resumeId.trim()) {
    navigation.resumeId = candidate.resumeId.trim();
  }
  if (
    candidate.category === 'work'
    || candidate.category === 'project'
    || candidate.category === 'education'
  ) {
    navigation.category = candidate.category;
  }
  return navigation;
};

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
      navigation: normalizeDraftApplyNavigation(message.content_json?.apply_navigation),
    }];
  })
);
