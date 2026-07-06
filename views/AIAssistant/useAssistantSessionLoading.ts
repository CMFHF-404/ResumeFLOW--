import { useCallback, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';

import {
  aiService,
  type AssistantMessage,
  type AssistantSelectedExperience,
  type AssistantSelectedResume,
  type AssistantSession,
} from '../../services/aiService';
import {
  deriveSelectedAssistantContextFromMessages,
  type AssistantHydratedSessionContext,
} from './sessionContextUtils';
import {
  assertAssistantSessionDetailResponse,
  assertAssistantSessionListResponse,
  isDraftMessageApplied,
  mergeAssistantSessions,
  reconcileAssistantSessions,
} from './sessionUtils';

type SetSessionsState = (updater: SetStateAction<AssistantSession[]>) => void;

type UseAssistantSessionLoadingParams = {
  isAuthenticated: boolean;
  sessionsRef: MutableRefObject<AssistantSession[]>;
  selectedSessionIdRef: MutableRefObject<string | null>;
  suppressAutoSelectSessionRef: MutableRefObject<boolean>;
  sessionMutationCounterRef: MutableRefObject<number>;
  sessionMutationSeqsRef: MutableRefObject<Map<string, number>>;
  deletedSessionSeqsRef: MutableRefObject<Map<string, number>>;
  messageMutationSeqRef: MutableRefObject<number>;
  setSessionsState: SetSessionsState;
  setSelectedSessionId: Dispatch<SetStateAction<string | null>>;
  setMessages: Dispatch<SetStateAction<AssistantMessage[]>>;
  setAppliedMessageIds: Dispatch<SetStateAction<Set<string>>>;
  restoreSelectedResumeContext: (context: AssistantHydratedSessionContext) => void;
  setSelectedExperiences: Dispatch<SetStateAction<AssistantSelectedExperience[]>>;
  liveSelectedResumeRef: MutableRefObject<AssistantSelectedResume | null>;
  persistDraftSelectedResume: (sessionId: string | null | undefined, resume: AssistantSelectedResume | null) => void;
  clearSelectedResume: () => void;
  scrollToBottom: () => void;
  error: (message: string, duration?: number) => void;
};

export const useAssistantSessionLoading = ({
  isAuthenticated,
  sessionsRef,
  selectedSessionIdRef,
  suppressAutoSelectSessionRef,
  sessionMutationCounterRef,
  sessionMutationSeqsRef,
  deletedSessionSeqsRef,
  messageMutationSeqRef,
  setSessionsState,
  setSelectedSessionId,
  setMessages,
  setAppliedMessageIds,
  restoreSelectedResumeContext,
  setSelectedExperiences,
  liveSelectedResumeRef,
  persistDraftSelectedResume,
  clearSelectedResume,
  scrollToBottom,
  error,
}: UseAssistantSessionLoadingParams) => {
  const detailRequestIdRef = useRef(0);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);

  const loadSessions = useCallback(async () => {
    if (!isAuthenticated) {
      setSessionsState([]);
      setSelectedSessionId(null);
      setMessages([]);
      clearSelectedResume();
      return;
    }
    setIsLoadingSessions(true);
    try {
      const mutationSeqAtStart = sessionMutationCounterRef.current;
      const rows = assertAssistantSessionListResponse(await aiService.listAssistantSessions());
      const nextSessions = reconcileAssistantSessions(
        sessionsRef.current,
        rows,
        mutationSeqAtStart,
        sessionMutationSeqsRef.current,
        deletedSessionSeqsRef.current,
      );
      setSessionsState(nextSessions);
      setSelectedSessionId((current) => {
        if (current && nextSessions.some((session) => session.id === current)) {
          return current;
        }
        if (suppressAutoSelectSessionRef.current) {
          return null;
        }
        return nextSessions[0]?.id ?? null;
      });
    } catch (loadError) {
      console.error('[AIAssistant] Failed to load sessions:', loadError);
      error('加载 AI 助理会话失败，请稍后重试');
    } finally {
      setIsLoadingSessions(false);
    }
  }, [
    clearSelectedResume,
    deletedSessionSeqsRef,
    error,
    isAuthenticated,
    sessionMutationCounterRef,
    sessionMutationSeqsRef,
    sessionsRef,
    setMessages,
    setSelectedSessionId,
    setSessionsState,
    suppressAutoSelectSessionRef,
  ]);

  const loadSessionDetail = useCallback(async (sessionId: string) => {
    const requestId = ++detailRequestIdRef.current;
    const mutationSeqAtStart = sessionMutationCounterRef.current;
    const messageMutationAtStart = messageMutationSeqRef.current;
    setIsLoadingDetail(true);
    try {
      const detail = assertAssistantSessionDetailResponse(await aiService.getAssistantSession(sessionId));
      if (detailRequestIdRef.current !== requestId || selectedSessionIdRef.current !== sessionId) {
        return;
      }
      if (messageMutationSeqRef.current > messageMutationAtStart) {
        return;
      }
      const restoredContext = deriveSelectedAssistantContextFromMessages(
        detail.messages,
        liveSelectedResumeRef.current,
      );
      setMessages(detail.messages);
      setAppliedMessageIds(new Set(detail.messages.filter(isDraftMessageApplied).map((message) => message.id)));
      restoreSelectedResumeContext(restoredContext);
      setSelectedExperiences(restoredContext.selectedExperiences);
      persistDraftSelectedResume(sessionId, restoredContext.selectedResume);
      setSessionsState((prev) => {
        const localMutationSeq = sessionMutationSeqsRef.current.get(detail.session.id) ?? 0;
        const deletedSeq = deletedSessionSeqsRef.current.get(detail.session.id) ?? 0;
        if (deletedSeq > mutationSeqAtStart || localMutationSeq > mutationSeqAtStart) {
          return prev;
        }
        return mergeAssistantSessions(prev, [detail.session]);
      });
    } catch (loadError) {
      if (detailRequestIdRef.current !== requestId || selectedSessionIdRef.current !== sessionId) {
        return;
      }
      console.error('[AIAssistant] Failed to load session detail:', loadError);
      error('加载会话详情失败，请稍后重试');
    } finally {
      if (detailRequestIdRef.current === requestId) {
        setIsLoadingDetail(false);
        setTimeout(scrollToBottom, 20);
      }
    }
  }, [
    deletedSessionSeqsRef,
    error,
    messageMutationSeqRef,
    scrollToBottom,
    selectedSessionIdRef,
    sessionMutationCounterRef,
    sessionMutationSeqsRef,
    setAppliedMessageIds,
    setMessages,
    setSelectedExperiences,
    restoreSelectedResumeContext,
    setSessionsState,
    liveSelectedResumeRef,
    persistDraftSelectedResume,
  ]);

  return {
    isLoadingSessions,
    isLoadingDetail,
    loadSessions,
    loadSessionDetail,
  };
};
