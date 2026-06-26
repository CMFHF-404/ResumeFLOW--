import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';

import {
  aiService,
  type AssistantDraftCard,
  type AssistantMessage,
  type AssistantMessageApplyResponse,
  type AssistantSession,
} from '../../services/aiService';
import { experienceService } from '../../services/experienceService';
import { resumeService } from '../../services/resumeService';
import { trackAiAssistantDraftApplied } from '../../utils/analyticsTracker';
import { isAssistantDraftCardDisplayable, normalizeAssistantDraftCard } from '../../utils/assistantDraft';
import { writePendingAssistantManualSaveDraft } from '../assistantManualSaveStorage';
import {
  assertResumeEditorDraftTargetMatches,
  buildResumeEditorDraftJumpState,
  buildResumeExperienceOverrideOperation,
} from './draftApplyUtils';
import {
  extractApplyErrorDetails,
  summarizeDraftForLog,
} from './logUtils';
import { isSameDraftCard } from './sessionUtils';
import {
  isPersistedCallbackOnlySession,
  readContextString,
} from './sessionContextUtils';
import type { AssistantApplyDraftHandler } from './types';

type UseAssistantDraftApplyActionsParams = {
  selectedSession: AssistantSession | null;
  applyingMessageIds: Set<string>;
  appliedMessageIds: Set<string>;
  manualSaveMessageIds: Set<string>;
  applyHandlerMapRef: MutableRefObject<Map<string, AssistantApplyDraftHandler>>;
  callbackOnlySessionIdsRef: MutableRefObject<Set<string>>;
  setApplyingMessageIds: Dispatch<SetStateAction<Set<string>>>;
  setAppliedMessageIds: Dispatch<SetStateAction<Set<string>>>;
  setManualSaveMessageIds: Dispatch<SetStateAction<Set<string>>>;
  setMessages: Dispatch<SetStateAction<AssistantMessage[]>>;
  setSessionsState: (updater: SetStateAction<AssistantSession[]>) => void;
  markMessagesMutated: () => number;
  markSessionMutated: (sessionId: string) => void;
  success: (message: string, duration?: number) => void;
  error: (message: string, duration?: number) => void;
};

export const useAssistantDraftApplyActions = ({
  selectedSession,
  applyingMessageIds,
  appliedMessageIds,
  manualSaveMessageIds,
  applyHandlerMapRef,
  callbackOnlySessionIdsRef,
  setApplyingMessageIds,
  setAppliedMessageIds,
  setManualSaveMessageIds,
  setMessages,
  setSessionsState,
  markMessagesMutated,
  markSessionMutated,
  success,
  error,
}: UseAssistantDraftApplyActionsParams) => {
  const handleApplyDraft = useCallback(async (messageId: string, card: AssistantDraftCard) => {
    if (!selectedSession) {
      return;
    }
    if (applyingMessageIds.has(messageId) || appliedMessageIds.has(messageId) || manualSaveMessageIds.has(messageId)) {
      return;
    }
    const applyHandler = applyHandlerMapRef.current.get(selectedSession.id);
    const callbackOnly = (
      callbackOnlySessionIdsRef.current.has(selectedSession.id)
      || isPersistedCallbackOnlySession(selectedSession)
    );
    const normalizedCard = normalizeAssistantDraftCard(card);
    if (!isAssistantDraftCardDisplayable(normalizedCard)) {
      error('这张草稿缺少可录入内容，请继续聊天补充后再确认。');
      return;
    }
    const isResumeEditorManualSaveMode = (
      callbackOnly
      && normalizedCard.type === 'experience'
      && selectedSession.entry_source === 'resume_editor'
    );

    setApplyingMessageIds((prev) => new Set(prev).add(messageId));
    try {
      let applied = false;
      let appliedMessage: AssistantMessage | null = null;
      let appliedResponse: AssistantMessageApplyResponse | null = null;
      let shouldPersistAppliedMarker = true;
      let handledByCustomApply = false;
      if (
        normalizedCard.type === 'experience'
        && selectedSession.entry_source === 'resume_editor'
      ) {
        assertResumeEditorDraftTargetMatches(selectedSession.context_json ?? {}, normalizedCard.data);
      }
      if (applyHandler) {
        applied = await applyHandler(normalizedCard, {
          sessionId: selectedSession.id,
          messageId,
          persistApplied: () => aiService.markAssistantMessageApplied(
            selectedSession.id,
            messageId,
            callbackOnly ? { skipApply: true } : undefined,
          ),
        });
        handledByCustomApply = applied;
        if (applied && callbackOnly) {
          shouldPersistAppliedMarker = false;
        }
      }
      if (!handledByCustomApply && isResumeEditorManualSaveMode) {
        applied = true;
        shouldPersistAppliedMarker = false;
      } else if (!handledByCustomApply && normalizedCard.type === 'experience' && selectedSession.entry_source === 'resume_editor') {
        const context = selectedSession.context_json ?? {};
        const resumeId = readContextString(context, 'resumeId');
        const masterId = readContextString(context, 'masterId');
        if (!resumeId || !masterId) {
          throw new Error('缺少简历上下文，无法确认这张经历卡片');
        }

        let detail = await resumeService.get(resumeId);
        let resumeItem = detail.experiences.find((item) => item.experience.master_experience_id === masterId);
        if (!resumeItem) {
          const experienceDetail = await experienceService.get(masterId);
          const latestVersionId = experienceDetail.latest_version?.id;
          if (!latestVersionId) {
            throw new Error('缺少经历版本信息，无法确认录入');
          }
          detail = await resumeService.updateAssembly(resumeId, {
            operations: [
              {
                op: 'add',
                experience_version_id: latestVersionId,
              },
            ],
          });
          resumeItem = detail.experiences.find((item) => item.experience.master_experience_id === masterId);
        }
        if (!resumeItem) {
          throw new Error('无法定位对应的简历经历项');
        }

        await resumeService.updateAssembly(resumeId, {
          operations: [
            {
              op: 'override',
              resume_experience_id: resumeItem.id,
              ...buildResumeExperienceOverrideOperation(normalizedCard.data),
            },
          ],
        });
        applied = true;
      } else if (!handledByCustomApply && normalizedCard.type === 'experience' && selectedSession.entry_source === 'experience_bank') {
        appliedResponse = await aiService.applyAssistantMessageDraft(selectedSession.id, messageId);
        appliedMessage = appliedResponse.message;
        experienceService.clearListCache();
        applied = true;
      } else if (!handledByCustomApply && callbackOnly) {
        error('这个草稿需要在原编辑上下文中确认，请从对应入口重新打开会话。');
        return;
      } else if (!handledByCustomApply) {
        appliedResponse = await aiService.applyAssistantMessageDraft(selectedSession.id, messageId);
        appliedMessage = appliedResponse.message;
        applied = true;
      }

      if (applied) {
        if (!callbackOnly) {
          trackAiAssistantDraftApplied({
            source: selectedSession.entry_source,
            cardType: normalizedCard.type,
            callbackOnly,
          });
        }
        if (!shouldPersistAppliedMarker) {
          if (normalizedCard.type === 'experience' && selectedSession.entry_source === 'resume_editor') {
            const { pendingManualSaveDraft } = buildResumeEditorDraftJumpState({
              sessionId: selectedSession.id,
              messageId,
              context: selectedSession.context_json ?? {},
              draft: normalizedCard.data,
              createdAt: Date.now(),
            });
            if (pendingManualSaveDraft) {
              writePendingAssistantManualSaveDraft(pendingManualSaveDraft);
            }
            setManualSaveMessageIds((prev) => new Set(prev).add(messageId));
            success('草稿已同步到编辑区，请前往编辑区保存');
            return;
          }
          success('草稿已回填到编辑区，保存后才会正式生效');
          return;
        }
        const updatedResponse = appliedResponse ?? (
          appliedMessage
            ? { message: appliedMessage, navigation: null }
            : await aiService.applyAssistantMessageDraft(selectedSession.id, messageId)
        );
        const updatedMessage = updatedResponse.message;
        if (updatedResponse.navigation?.targetView === 'experience_bank') {
          experienceService.clearListCache();
        }
        markMessagesMutated();
        setMessages((prev) => prev.map((message) => (
          message.id === messageId
            ? {
              ...message,
              content_json: updatedMessage.content_json,
            }
            : message
        )));
        setAppliedMessageIds((prev) => new Set(prev).add(messageId));
        markSessionMutated(selectedSession.id);
        setSessionsState((prev) => prev.map((session) => {
          if (session.id !== selectedSession.id || !isSameDraftCard(session.latest_preview, normalizedCard)) {
            return session;
          }
          return {
            ...session,
            latest_preview: updatedMessage.content_json,
          };
        }));
        success('草稿已确认录入');
      }
    } catch (applyError) {
      const applyErrorDetails = extractApplyErrorDetails(applyError);
      console.error('[AIAssistant] Failed to apply draft:', {
        sessionId: selectedSession.id,
        entrySource: selectedSession.entry_source,
        mode: selectedSession.mode,
        messageId,
        callbackOnly,
        hasCustomApplyHandler: Boolean(applyHandler),
        context: {
          masterId: readContextString(selectedSession.context_json ?? {}, 'masterId'),
          category: readContextString(selectedSession.context_json ?? {}, 'category'),
          assistantApplyMode: readContextString(selectedSession.context_json ?? {}, 'assistantApplyMode'),
        },
        draft: summarizeDraftForLog(normalizedCard),
        error: applyErrorDetails,
      }, applyError);
      error(`草稿录入失败：${applyErrorDetails.userMessage}`, 6000);
    } finally {
      setApplyingMessageIds((prev) => {
        const next = new Set(prev);
        next.delete(messageId);
        return next;
      });
    }
  }, [
    appliedMessageIds,
    applyingMessageIds,
    applyHandlerMapRef,
    callbackOnlySessionIdsRef,
    error,
    manualSaveMessageIds,
    markMessagesMutated,
    markSessionMutated,
    selectedSession,
    setAppliedMessageIds,
    setApplyingMessageIds,
    setManualSaveMessageIds,
    setMessages,
    setSessionsState,
    success,
  ]);

  return {
    handleApplyDraft,
  };
};
