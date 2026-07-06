import { useCallback, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';

import {
  aiService,
  type AssistantDraftCard,
  type AssistantMessage,
  type AssistantMode,
  type AssistantSelectedExperience,
  type AssistantSelectedResume,
  type AssistantSkillId,
  type AssistantStreamEvent,
} from '../../services/aiService';
import type { AssistantComposerAttachment } from './attachmentUtils';
import {
  applyAssistantTextStreamTransition,
  buildAssistantTextMessage,
  buildOptimisticAssistantUserMessage,
  prepareAssistantSendPayload,
  reduceAssistantTextStreamEvent,
  reduceAssistantThoughtStreamState,
  replaceAssistantTextStreamMessage,
  type AssistantSendPayload,
  type AssistantTextStreamState,
} from './messageSendUtils';

const ASSISTANT_SEND_ERROR_FALLBACK = 'AI 助理回复失败，请稍后重试';

const resolveAssistantSendErrorMessage = (sendError: unknown) => {
  if (sendError instanceof Error && sendError.message.trim()) {
    return sendError.message.trim();
  }
  if (typeof sendError === 'string' && sendError.trim()) {
    return sendError.trim();
  }
  return ASSISTANT_SEND_ERROR_FALLBACK;
};

type UseAssistantMessageSendingParams = {
  selectedSessionIdRef: MutableRefObject<string | null>;
  setMessages: Dispatch<SetStateAction<AssistantMessage[]>>;
  setInputValue: Dispatch<SetStateAction<string>>;
  setActiveThought: Dispatch<SetStateAction<string>>;
  setLastAssistantSkillId: Dispatch<SetStateAction<AssistantSkillId | null>>;
  setActiveComposerSkillId: Dispatch<SetStateAction<AssistantSkillId | null>>;
  setSelectedExperiences: Dispatch<SetStateAction<AssistantSelectedExperience[]>>;
  setSelectedResume: Dispatch<SetStateAction<AssistantSelectedResume | null>>;
  persistDraftSelectedResume: (sessionId: string | null | undefined, resume: AssistantSelectedResume | null) => void;
  persistSessionSnapshot: (sessionId: string, title?: string, draftCard?: AssistantDraftCard | null) => void;
  markMessagesMutated: () => number;
  clearComposerAttachmentsIfMatches: (attachments: AssistantComposerAttachment[]) => void;
  restoreComposerAttachmentsIfEmpty: (attachments: AssistantComposerAttachment[]) => void;
  loadSessionDetail: (sessionId: string) => Promise<void>;
  error: (message: string, duration?: number) => void;
};

export const useAssistantMessageSending = ({
  selectedSessionIdRef,
  setMessages,
  setInputValue,
  setActiveThought,
  setLastAssistantSkillId,
  setActiveComposerSkillId,
  setSelectedExperiences,
  setSelectedResume,
  persistDraftSelectedResume,
  persistSessionSnapshot,
  markMessagesMutated,
  clearComposerAttachmentsIfMatches,
  restoreComposerAttachmentsIfEmpty,
  loadSessionDetail,
  error,
}: UseAssistantMessageSendingParams) => {
  const [sendingCount, setSendingCount] = useState(0);
  const isSending = sendingCount > 0;

  const sendMessage = useCallback(async (
    sessionId: string,
    payload: AssistantSendPayload,
    mode?: AssistantMode,
    options?: { shouldAbort?: () => boolean },
  ) => {
    const preparedPayload = prepareAssistantSendPayload(payload);
    if (!preparedPayload) {
      return;
    }
    const {
      trimmedMessage,
      effectiveMessage,
      displayMessage,
      skillId,
      enableThinking,
      attachments,
      selectedExperienceItems,
      selectedResumeItem,
    } = preparedPayload;
    const now = new Date().toISOString();
    const optimisticUserMessage = buildOptimisticAssistantUserMessage(
      preparedPayload,
      now,
      Math.random(),
    );
    const optimisticMessageId = optimisticUserMessage.id;
    let thoughtStreamState = {
      activeThought: '',
      streamedThoughtText: '',
    };
    let assistantTextStreamState: AssistantTextStreamState = {
      temporaryMessageId: null,
      streamedText: '',
    };
    setSendingCount((count) => count + 1);
    if (selectedSessionIdRef.current === sessionId) {
      setActiveThought('');
      setLastAssistantSkillId(null);
      markMessagesMutated();
      setMessages((prev) => [...prev, optimisticUserMessage]);
      setInputValue((prev) => (prev.trim() === trimmedMessage ? '' : prev));
      setSelectedExperiences([]);
    }
    try {
      const result = await aiService.sendAssistantMessage(
        sessionId,
        {
          userMessage: effectiveMessage,
          displayMessage,
          mode,
          skillId,
          enableThinking,
          attachments: attachments.map((attachment) => attachment.file),
          selectedExperiences: selectedExperienceItems,
          selectedResume: selectedResumeItem,
        },
        (event: AssistantStreamEvent) => {
          if (selectedSessionIdRef.current !== sessionId) {
            return;
          }
          if (event.type === 'assistant_delta' || event.type === 'assistant_text_reset') {
            const transition = reduceAssistantTextStreamEvent(
              assistantTextStreamState,
              event,
              {
                skillId,
                now: new Date().toISOString(),
                randomValue: Math.random(),
              },
            );
            assistantTextStreamState = transition.state;
            if (transition.mutated) {
              markMessagesMutated();
              setMessages((prev) => applyAssistantTextStreamTransition(prev, transition));
            }
            return;
          }
          if (event.type === 'thought' || event.type === 'progress' || event.type === 'thought_reset' || event.type === 'thought_status') {
            thoughtStreamState = reduceAssistantThoughtStreamState(
              thoughtStreamState,
              event,
              enableThinking,
            );
            setActiveThought(thoughtStreamState.activeThought);
          }
        },
      );
      if (options?.shouldAbort?.()) {
        return;
      }
      persistSessionSnapshot(sessionId, result.title, result.draftCard ?? null);
      if (selectedSessionIdRef.current === sessionId) {
        const finalAssistantMessage = result.assistantText.trim()
          ? buildAssistantTextMessage(
            result.assistantText,
            skillId,
            result.suggestedFollowups,
            new Date().toISOString(),
            Math.random(),
            thoughtStreamState.streamedThoughtText,
          )
          : null;
        const streamStateBeforeFinal = assistantTextStreamState;
        assistantTextStreamState = {
          temporaryMessageId: null,
          streamedText: '',
        };
        markMessagesMutated();
        setMessages((prev) => replaceAssistantTextStreamMessage(
          prev,
          streamStateBeforeFinal,
          finalAssistantMessage,
        ).messages);
        setActiveThought('');
        setLastAssistantSkillId(skillId);
        clearComposerAttachmentsIfMatches(attachments);
        setSelectedExperiences([]);
        setActiveComposerSkillId(null);
        void loadSessionDetail(sessionId);
      }
    } catch (sendError) {
      console.error('[AIAssistant] Failed to send message:', sendError);
      if (selectedSessionIdRef.current === sessionId) {
        const temporaryMessageId = assistantTextStreamState.temporaryMessageId;
        assistantTextStreamState = {
          temporaryMessageId: null,
          streamedText: '',
        };
        setActiveThought('');
        markMessagesMutated();
        setMessages((prev) => prev.filter((message) => (
          message.id !== optimisticMessageId
          && message.id !== temporaryMessageId
        )));
        setInputValue((current) => (current.trim() ? current : trimmedMessage));
        restoreComposerAttachmentsIfEmpty(attachments);
        setSelectedExperiences((current) => (current.length > 0 ? current : selectedExperienceItems));
        persistDraftSelectedResume(sessionId, selectedResumeItem);
        setSelectedResume((current) => current ?? selectedResumeItem);
      }
      error(resolveAssistantSendErrorMessage(sendError), 6000);
    } finally {
      setSendingCount((count) => Math.max(0, count - 1));
    }
  }, [
    clearComposerAttachmentsIfMatches,
    error,
    loadSessionDetail,
    markMessagesMutated,
    persistDraftSelectedResume,
    persistSessionSnapshot,
    restoreComposerAttachmentsIfEmpty,
    selectedSessionIdRef,
    setActiveComposerSkillId,
    setActiveThought,
    setInputValue,
    setLastAssistantSkillId,
    setMessages,
    setSelectedExperiences,
    setSelectedResume,
  ]);

  return {
    isSending,
    sendMessage,
  };
};
