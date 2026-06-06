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
  buildAssistantTextMessage,
  buildOptimisticAssistantUserMessage,
  prepareAssistantSendPayload,
  type AssistantSendPayload,
} from './messageSendUtils';
import { resolveAssistantStreamThought } from './streamUtils';

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
      skillId,
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
    setSendingCount((count) => count + 1);
    if (selectedSessionIdRef.current === sessionId) {
      setActiveThought('');
      setLastAssistantSkillId(null);
      markMessagesMutated();
      setMessages((prev) => [...prev, optimisticUserMessage]);
      setInputValue((prev) => (prev.trim() === trimmedMessage ? '' : prev));
      setSelectedExperiences([]);
      persistDraftSelectedResume(sessionId, null);
      setSelectedResume(null);
    }
    try {
      const result = await aiService.sendAssistantMessage(
        sessionId,
        {
          userMessage: effectiveMessage,
          displayMessage: trimmedMessage,
          mode,
          skillId,
          attachments: attachments.map((attachment) => attachment.file),
          selectedExperiences: selectedExperienceItems,
          selectedResume: selectedResumeItem,
        },
        (event: AssistantStreamEvent) => {
          if (selectedSessionIdRef.current !== sessionId) {
            return;
          }
          if (event.type !== 'thought' && event.type !== 'progress') {
            return;
          }
          const headline = resolveAssistantStreamThought(event);
          setActiveThought((current) => {
            if (!headline.trim()) {
              return current;
            }
            if (!current) {
              return headline;
            }
            const segments = current.split('\n');
            if (segments[segments.length - 1] === headline) {
              return current;
            }
            return `${current}\n${headline}`;
          });
        },
      );
      if (options?.shouldAbort?.()) {
        return;
      }
      persistSessionSnapshot(sessionId, result.title, result.draftCard ?? null);
      if (selectedSessionIdRef.current === sessionId) {
        if (result.assistantText.trim()) {
          markMessagesMutated();
          setMessages((prev) => [...prev, buildAssistantTextMessage(
            result.assistantText,
            skillId,
            result.suggestedFollowups,
            new Date().toISOString(),
            Math.random(),
          )]);
        }
        setActiveThought('');
        setLastAssistantSkillId(skillId);
        clearComposerAttachmentsIfMatches(attachments);
        setSelectedExperiences([]);
        setActiveComposerSkillId(null);
        persistDraftSelectedResume(sessionId, null);
        setSelectedResume(null);
        void loadSessionDetail(sessionId);
      }
    } catch (sendError) {
      console.error('[AIAssistant] Failed to send message:', sendError);
      if (selectedSessionIdRef.current === sessionId) {
        setActiveThought('');
        markMessagesMutated();
        setMessages((prev) => prev.filter((message) => message.id !== optimisticMessageId));
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
