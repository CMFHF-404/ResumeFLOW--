import { useCallback, useLayoutEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';

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
  mergeEarlierAssistantMessages,
  mergeEarlierAssistantSessions,
  mergeAssistantSessions,
  readAssistantSessionNextCursor,
  reconcileAssistantSessions,
} from './sessionUtils';
import { isAuthContextChangedError } from '../../services/apiClient';
import type { AssistantOwnerGuard, AssistantOwnerOperation } from './useAssistantOwnerGuard';

type SetSessionsState = (updater: SetStateAction<AssistantSession[]>) => void;

const ASSISTANT_SESSION_MESSAGE_PAGE_SIZE = 100;
const ASSISTANT_SESSION_LIST_PAGE_SIZE = 50;

type AssistantSessionListPaginationState = {
  generation: number;
  hasEarlierSessions: boolean;
  nextCursor: string | null;
  isLoadingEarlierSessions: boolean;
  earlierSessionsError: string | null;
};

const createAssistantSessionListPaginationState = (
  generation: number,
): AssistantSessionListPaginationState => ({
  generation,
  hasEarlierSessions: false,
  nextCursor: null,
  isLoadingEarlierSessions: false,
  earlierSessionsError: null,
});

type AssistantHistoryPaginationState = {
  sessionId: string | null;
  generation: number;
  hasEarlierMessages: boolean;
  nextCursor: string | null;
  isLoadingEarlierMessages: boolean;
  earlierMessagesError: string | null;
  storageProjectionTruncated: boolean;
};

const createAssistantHistoryPaginationState = (
  generation: number,
  sessionId: string | null = null,
): AssistantHistoryPaginationState => ({
  sessionId,
  generation,
  hasEarlierMessages: false,
  nextCursor: null,
  isLoadingEarlierMessages: false,
  earlierMessagesError: null,
  storageProjectionTruncated: false,
});

type UseAssistantSessionLoadingParams = {
  isAuthenticated: boolean;
  ownerGuard: AssistantOwnerGuard;
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
  ownerGuard,
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
  const earlierMessagesRequestIdRef = useRef(0);
  const earlierSessionsRequestIdRef = useRef(0);
  const sessionsRequestIdRef = useRef(0);
  const sessionListPaginationRef = useRef<AssistantSessionListPaginationState>(
    createAssistantSessionListPaginationState(0),
  );
  const historyPaginationRef = useRef<AssistantHistoryPaginationState>(
    createAssistantHistoryPaginationState(0),
  );
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [sessionListPagination, setSessionListPagination] = useState<AssistantSessionListPaginationState>(
    sessionListPaginationRef.current,
  );
  const [historyPagination, setHistoryPagination] = useState<AssistantHistoryPaginationState>(
    historyPaginationRef.current,
  );

  const setHistoryPaginationState = useCallback((
    updater: SetStateAction<AssistantHistoryPaginationState>,
  ) => {
    const next = typeof updater === 'function'
      ? (updater as (value: AssistantHistoryPaginationState) => AssistantHistoryPaginationState)(
          historyPaginationRef.current,
        )
      : updater;
    historyPaginationRef.current = next;
    setHistoryPagination(next);
  }, []);

  const setSessionListPaginationState = useCallback((
    updater: SetStateAction<AssistantSessionListPaginationState>,
  ) => {
    const next = typeof updater === 'function'
      ? (updater as (value: AssistantSessionListPaginationState) => AssistantSessionListPaginationState)(
          sessionListPaginationRef.current,
        )
      : updater;
    sessionListPaginationRef.current = next;
    setSessionListPagination(next);
  }, []);

  useLayoutEffect(() => {
    sessionsRequestIdRef.current += 1;
    earlierSessionsRequestIdRef.current += 1;
    detailRequestIdRef.current += 1;
    earlierMessagesRequestIdRef.current += 1;
    setHistoryPaginationState(createAssistantHistoryPaginationState(
      historyPaginationRef.current.generation + 1,
    ));
    setSessionListPaginationState(createAssistantSessionListPaginationState(
      sessionListPaginationRef.current.generation + 1,
    ));
    setIsLoadingSessions(false);
    setIsLoadingDetail(false);
  }, [
    ownerGuard.authUserKey,
    setHistoryPaginationState,
    setSessionListPaginationState,
  ]);

  const loadSessions = useCallback(async () => {
    if (!isAuthenticated) {
      setSessionsState([]);
      setSelectedSessionId(null);
      setMessages([]);
      clearSelectedResume();
      return;
    }
    const requestId = ++sessionsRequestIdRef.current;
    earlierSessionsRequestIdRef.current += 1;
    const paginationGeneration = sessionListPaginationRef.current.generation + 1;
    setSessionListPaginationState(createAssistantSessionListPaginationState(paginationGeneration));
    let operation: AssistantOwnerOperation | null = null;
    setIsLoadingSessions(true);
    try {
      operation = await ownerGuard.beginOperation();
      const mutationSeqAtStart = sessionMutationCounterRef.current;
      if (
        sessionsRequestIdRef.current !== requestId
        || sessionListPaginationRef.current.generation !== paginationGeneration
      ) {
        return;
      }
      const page = await aiService.listAssistantSessionsPage({
        limit: ASSISTANT_SESSION_LIST_PAGE_SIZE,
        expectedAuthCacheKey: operation.expectedAuthCacheKey,
      });
      const rows = assertAssistantSessionListResponse(page.sessions);
      await ownerGuard.assertOperationCurrent(operation);
      if (sessionsRequestIdRef.current !== requestId) {
        return;
      }
      const nextSessions = reconcileAssistantSessions(
        sessionsRef.current,
        rows,
        mutationSeqAtStart,
        sessionMutationSeqsRef.current,
        deletedSessionSeqsRef.current,
      );
      setSessionsState(nextSessions);
      setSessionListPaginationState({
        generation: paginationGeneration,
        hasEarlierSessions: page.truncated && page.nextCursor !== null,
        nextCursor: page.nextCursor,
        isLoadingEarlierSessions: false,
        earlierSessionsError: null,
      });
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
      if (
        sessionsRequestIdRef.current !== requestId
        || isAuthContextChangedError(loadError)
        || (operation && !ownerGuard.isOperationCurrent(operation))
      ) {
        return;
      }
      console.error('[AIAssistant] Failed to load sessions:', loadError);
      error('加载 AI 助理会话失败，请稍后重试');
    } finally {
      if (sessionsRequestIdRef.current === requestId) {
        setIsLoadingSessions(false);
      }
    }
  }, [
    clearSelectedResume,
    deletedSessionSeqsRef,
    error,
    isAuthenticated,
    ownerGuard,
    sessionMutationCounterRef,
    sessionMutationSeqsRef,
    sessionsRef,
    setMessages,
    setSelectedSessionId,
    setSessionListPaginationState,
    setSessionsState,
    suppressAutoSelectSessionRef,
  ]);

  const loadEarlierSessions = useCallback(async (): Promise<boolean> => {
    const paginationAtStart = sessionListPaginationRef.current;
    if (
      !isAuthenticated
      || !paginationAtStart.hasEarlierSessions
      || !paginationAtStart.nextCursor
      || paginationAtStart.isLoadingEarlierSessions
    ) {
      return false;
    }
    const requestId = ++earlierSessionsRequestIdRef.current;
    const paginationGeneration = paginationAtStart.generation;
    const before = paginationAtStart.nextCursor;
    const mutationSeqAtStart = sessionMutationCounterRef.current;
    let operation: AssistantOwnerOperation | null = null;
    setSessionListPaginationState((current) => (
      current.generation === paginationGeneration
        ? {
            ...current,
            isLoadingEarlierSessions: true,
            earlierSessionsError: null,
          }
        : current
    ));

    const isRequestCurrent = () => (
      earlierSessionsRequestIdRef.current === requestId
      && sessionListPaginationRef.current.generation === paginationGeneration
      && (!operation || ownerGuard.isOperationCurrent(operation))
    );

    try {
      operation = await ownerGuard.beginOperation();
      if (!isRequestCurrent()) {
        return false;
      }
      const page = await aiService.listAssistantSessionsPage({
        limit: ASSISTANT_SESSION_LIST_PAGE_SIZE,
        before,
        expectedAuthCacheKey: operation.expectedAuthCacheKey,
      });
      const rows = assertAssistantSessionListResponse(page.sessions);
      await ownerGuard.assertOperationCurrent(operation);
      if (!isRequestCurrent()) {
        return false;
      }
      setSessionsState((current) => mergeEarlierAssistantSessions(
        current,
        rows,
        mutationSeqAtStart,
        sessionMutationSeqsRef.current,
        deletedSessionSeqsRef.current,
      ));
      setSessionListPaginationState((current) => (
        current.generation === paginationGeneration
          ? {
              ...current,
              hasEarlierSessions: page.truncated && page.nextCursor !== null,
              nextCursor: page.nextCursor,
              isLoadingEarlierSessions: false,
              earlierSessionsError: null,
            }
          : current
      ));
      return true;
    } catch (loadError) {
      if (!isRequestCurrent() || isAuthContextChangedError(loadError)) {
        return false;
      }
      console.error('[AIAssistant] Failed to load earlier sessions:', loadError);
      setSessionListPaginationState((current) => (
        current.generation === paginationGeneration
          ? {
              ...current,
              isLoadingEarlierSessions: false,
              earlierSessionsError: '加载更早会话失败，请重试',
            }
          : current
      ));
      return false;
    } finally {
      if (isRequestCurrent()) {
        setSessionListPaginationState((current) => (
          current.generation === paginationGeneration
            ? { ...current, isLoadingEarlierSessions: false }
            : current
        ));
      }
    }
  }, [
    deletedSessionSeqsRef,
    isAuthenticated,
    ownerGuard,
    sessionMutationCounterRef,
    sessionMutationSeqsRef,
    setSessionListPaginationState,
    setSessionsState,
  ]);

  const loadSessionDetail = useCallback(async (sessionId: string) => {
    const requestId = ++detailRequestIdRef.current;
    earlierMessagesRequestIdRef.current += 1;
    const historyGeneration = historyPaginationRef.current.generation + 1;
    setHistoryPaginationState(createAssistantHistoryPaginationState(historyGeneration, sessionId));
    let operation: AssistantOwnerOperation | null = null;
    const mutationSeqAtStart = sessionMutationCounterRef.current;
    const messageMutationAtStart = messageMutationSeqRef.current;
    setIsLoadingDetail(true);
    try {
      operation = await ownerGuard.beginOperation();
      if (
        detailRequestIdRef.current !== requestId
        || selectedSessionIdRef.current !== sessionId
        || historyPaginationRef.current.generation !== historyGeneration
      ) {
        return;
      }
      const detail = assertAssistantSessionDetailResponse(await aiService.getAssistantSession(
        sessionId,
        {
          limit: ASSISTANT_SESSION_MESSAGE_PAGE_SIZE,
          expectedAuthCacheKey: operation.expectedAuthCacheKey,
        },
      ));
      await ownerGuard.assertOperationCurrent(operation);
      if (detailRequestIdRef.current !== requestId || selectedSessionIdRef.current !== sessionId) {
        return;
      }
      if (messageMutationSeqRef.current > messageMutationAtStart) {
        return;
      }
      const initialMessages = mergeEarlierAssistantMessages([], detail.messages);
      const restoredContext = deriveSelectedAssistantContextFromMessages(
        initialMessages,
        liveSelectedResumeRef.current,
      );
      setMessages(initialMessages);
      setAppliedMessageIds(new Set(initialMessages.filter(isDraftMessageApplied).map((message) => message.id)));
      const nextCursor = readAssistantSessionNextCursor(detail);
      setHistoryPaginationState({
        sessionId,
        generation: historyGeneration,
        hasEarlierMessages: detail.truncated === true && nextCursor !== null,
        nextCursor,
        isLoadingEarlierMessages: false,
        earlierMessagesError: null,
        storageProjectionTruncated: detail.storage_projection_truncated === true,
      });
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
      if (
        detailRequestIdRef.current !== requestId
        || selectedSessionIdRef.current !== sessionId
        || isAuthContextChangedError(loadError)
        || (operation && !ownerGuard.isOperationCurrent(operation))
      ) {
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
    ownerGuard,
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
    setHistoryPaginationState,
  ]);

  const loadEarlierMessages = useCallback(async (): Promise<boolean> => {
    const paginationAtStart = historyPaginationRef.current;
    const sessionId = selectedSessionIdRef.current;
    if (
      !sessionId
      || paginationAtStart.sessionId !== sessionId
      || !paginationAtStart.hasEarlierMessages
      || !paginationAtStart.nextCursor
      || paginationAtStart.isLoadingEarlierMessages
    ) {
      return false;
    }

    const requestId = ++earlierMessagesRequestIdRef.current;
    const historyGeneration = paginationAtStart.generation;
    const before = paginationAtStart.nextCursor;
    let operation: AssistantOwnerOperation | null = null;
    setHistoryPaginationState((current) => (
      current.sessionId === sessionId && current.generation === historyGeneration
        ? {
            ...current,
            isLoadingEarlierMessages: true,
            earlierMessagesError: null,
          }
        : current
    ));

    const isRequestCurrent = () => (
      earlierMessagesRequestIdRef.current === requestId
      && selectedSessionIdRef.current === sessionId
      && historyPaginationRef.current.sessionId === sessionId
      && historyPaginationRef.current.generation === historyGeneration
      && (!operation || ownerGuard.isOperationCurrent(operation))
    );

    try {
      operation = await ownerGuard.beginOperation();
      if (!isRequestCurrent()) {
        return false;
      }
      const detail = assertAssistantSessionDetailResponse(await aiService.getAssistantSession(
        sessionId,
        {
          limit: ASSISTANT_SESSION_MESSAGE_PAGE_SIZE,
          before,
          expectedAuthCacheKey: operation.expectedAuthCacheKey,
        },
      ));
      await ownerGuard.assertOperationCurrent(operation);
      if (!isRequestCurrent()) {
        return false;
      }
      setMessages((current) => mergeEarlierAssistantMessages(current, detail.messages));
      setAppliedMessageIds((current) => {
        const next = new Set(current);
        detail.messages.filter(isDraftMessageApplied).forEach((message) => next.add(message.id));
        return next;
      });
      const nextCursor = readAssistantSessionNextCursor(detail);
      setHistoryPaginationState((current) => (
        current.sessionId === sessionId && current.generation === historyGeneration
          ? {
              ...current,
              hasEarlierMessages: detail.truncated === true && nextCursor !== null,
              nextCursor,
              isLoadingEarlierMessages: false,
              earlierMessagesError: null,
              storageProjectionTruncated: (
                current.storageProjectionTruncated
                || detail.storage_projection_truncated === true
              ),
            }
          : current
      ));
      return true;
    } catch (loadError) {
      if (
        !isRequestCurrent()
        || isAuthContextChangedError(loadError)
      ) {
        return false;
      }
      console.error('[AIAssistant] Failed to load earlier messages:', loadError);
      setHistoryPaginationState((current) => (
        current.sessionId === sessionId && current.generation === historyGeneration
          ? {
              ...current,
              isLoadingEarlierMessages: false,
              earlierMessagesError: '加载更早消息失败，请重试',
            }
          : current
      ));
      return false;
    } finally {
      if (isRequestCurrent()) {
        setHistoryPaginationState((current) => (
          current.sessionId === sessionId && current.generation === historyGeneration
            ? { ...current, isLoadingEarlierMessages: false }
            : current
        ));
      }
    }
  }, [
    ownerGuard,
    selectedSessionIdRef,
    setAppliedMessageIds,
    setHistoryPaginationState,
    setMessages,
  ]);

  return {
    isLoadingSessions,
    isLoadingDetail,
    loadSessions,
    hasEarlierSessions: sessionListPagination.hasEarlierSessions,
    isLoadingEarlierSessions: sessionListPagination.isLoadingEarlierSessions,
    earlierSessionsError: sessionListPagination.earlierSessionsError,
    loadEarlierSessions,
    loadSessionDetail,
    historySessionId: historyPagination.sessionId,
    hasEarlierMessages: historyPagination.hasEarlierMessages,
    isLoadingEarlierMessages: historyPagination.isLoadingEarlierMessages,
    earlierMessagesError: historyPagination.earlierMessagesError,
    storageProjectionTruncated: historyPagination.storageProjectionTruncated,
    loadEarlierMessages,
  };
};
