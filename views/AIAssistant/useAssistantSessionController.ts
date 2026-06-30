import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

import {
  aiService,
  type AssistantDraftCard,
  type AssistantEntryContext,
  type AssistantMessage,
  type AssistantSelectedResume,
  type AssistantSession,
  type AssistantSkillId,
} from '../../services/aiService';
import { normalizeAssistantDraftCard } from '../../utils/assistantDraft';
import { useAssistantSessionLoading } from './useAssistantSessionLoading';
import {
  mergeAssistantSessions,
  sortSessionsByUpdatedAt,
} from './sessionUtils';
import type { AssistantApplyDraftHandler, AssistantLaunchRequest } from './types';

type UseAssistantSessionControllerParams = {
  isAuthenticated: boolean;
  clearComposerAttachments: () => void;
  clearSelectedExperiences: () => void;
  clearSelectedResume: () => void;
  setInputValue: Dispatch<SetStateAction<string>>;
  setActiveThought: Dispatch<SetStateAction<string>>;
  setLastAssistantSkillId: Dispatch<SetStateAction<AssistantSkillId | null>>;
  setSelectedResume: Dispatch<SetStateAction<AssistantSelectedResume | null>>;
  scrollToBottom: () => void;
  error: (message: string, duration?: number) => void;
};

export const useAssistantSessionController = ({
  isAuthenticated,
  clearComposerAttachments,
  clearSelectedExperiences,
  clearSelectedResume,
  setInputValue,
  setActiveThought,
  setLastAssistantSkillId,
  setSelectedResume,
  scrollToBottom,
  error,
}: UseAssistantSessionControllerParams) => {
  const [sessions, setSessions] = useState<AssistantSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [appliedMessageIds, setAppliedMessageIds] = useState<Set<string>>(new Set());

  const applyHandlerMapRef = useRef<Map<string, AssistantApplyDraftHandler>>(new Map());
  const callbackOnlySessionIdsRef = useRef<Set<string>>(new Set());
  const selectedSessionIdRef = useRef<string | null>(null);
  const preserveComposerAttachmentOnNextSelectionRef = useRef(false);
  const draftSelectedResumeBySessionRef = useRef<Map<string, AssistantSelectedResume>>(new Map());
  const draftLaunchRequestRef = useRef<AssistantLaunchRequest | null>(null);
  const sessionsRef = useRef<AssistantSession[]>([]);
  const sessionMutationSeqsRef = useRef<Map<string, number>>(new Map());
  const deletedSessionSeqsRef = useRef<Map<string, number>>(new Map());
  const sessionMutationCounterRef = useRef(0);
  const messageMutationSeqRef = useRef(0);
  const suppressAutoSelectSessionRef = useRef(false);
  const skipNextSelectionResetSessionIdsRef = useRef<Set<string>>(new Set());

  const selectedSession = useMemo(
    () => sessions.find((item) => item.id === selectedSessionId) ?? null,
    [selectedSessionId, sessions],
  );

  const markSessionMutated = useCallback((sessionId: string) => {
    const nextSeq = sessionMutationCounterRef.current + 1;
    sessionMutationCounterRef.current = nextSeq;
    sessionMutationSeqsRef.current.set(sessionId, nextSeq);
    deletedSessionSeqsRef.current.delete(sessionId);
  }, []);

  const markSessionDeleted = useCallback((sessionId: string) => {
    const nextSeq = sessionMutationCounterRef.current + 1;
    sessionMutationCounterRef.current = nextSeq;
    sessionMutationSeqsRef.current.set(sessionId, nextSeq);
    deletedSessionSeqsRef.current.set(sessionId, nextSeq);
  }, []);

  const markMessagesMutated = useCallback(() => {
    messageMutationSeqRef.current += 1;
    return messageMutationSeqRef.current;
  }, []);

  const setSessionsState = useCallback((updater: SetStateAction<AssistantSession[]>) => {
    const next = typeof updater === 'function'
      ? (updater as (value: AssistantSession[]) => AssistantSession[])(sessionsRef.current)
      : updater;
    sessionsRef.current = next;
    setSessions(next);
  }, []);

  const resetForDraftLaunch = useCallback((
    launchRequest: AssistantLaunchRequest,
    nextSelectedResume: AssistantSelectedResume | null,
  ) => {
    draftLaunchRequestRef.current = launchRequest;
    selectedSessionIdRef.current = null;
    setSelectedSessionId(null);
    clearComposerAttachments();
    clearSelectedExperiences();
    markMessagesMutated();
    setMessages([]);
    setAppliedMessageIds(new Set());
    setActiveThought('');
    setSelectedResume(nextSelectedResume);
    setInputValue('');
  }, [
    clearComposerAttachments,
    clearSelectedExperiences,
    markMessagesMutated,
    setActiveThought,
    setInputValue,
    setSelectedResume,
  ]);

  const persistDraftSelectedResume = useCallback((
    sessionId: string | null | undefined,
    resume: AssistantSelectedResume | null,
  ) => {
    if (!sessionId) {
      return;
    }
    if (resume) {
      draftSelectedResumeBySessionRef.current.set(sessionId, resume);
      return;
    }
    draftSelectedResumeBySessionRef.current.delete(sessionId);
  }, []);

  const {
    isLoadingSessions,
    isLoadingDetail,
    loadSessions,
    loadSessionDetail,
  } = useAssistantSessionLoading({
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
    clearSelectedResume,
    scrollToBottom,
    error,
  });

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    if (!isAuthenticated) {
      draftLaunchRequestRef.current = null;
      suppressAutoSelectSessionRef.current = false;
      clearComposerAttachments();
      clearSelectedExperiences();
      clearSelectedResume();
      preserveComposerAttachmentOnNextSelectionRef.current = false;
      markMessagesMutated();
      setMessages([]);
      setAppliedMessageIds(new Set());
      setActiveThought('');
      setLastAssistantSkillId(null);
      return;
    }
    if (!selectedSessionId) {
      clearComposerAttachments();
      clearSelectedExperiences();
      if (!suppressAutoSelectSessionRef.current) {
        clearSelectedResume();
      }
      preserveComposerAttachmentOnNextSelectionRef.current = false;
      markMessagesMutated();
      setMessages([]);
      setAppliedMessageIds(new Set());
      setActiveThought('');
      setLastAssistantSkillId(null);
      return;
    }
    if (skipNextSelectionResetSessionIdsRef.current.delete(selectedSessionId)) {
      preserveComposerAttachmentOnNextSelectionRef.current = false;
      setActiveThought('');
      setLastAssistantSkillId(null);
      return;
    }
    const preserveComposerAttachment = preserveComposerAttachmentOnNextSelectionRef.current;
    preserveComposerAttachmentOnNextSelectionRef.current = false;
    if (!preserveComposerAttachment) {
      clearComposerAttachments();
    }
    const draftSelectedResume = draftSelectedResumeBySessionRef.current.get(selectedSessionId) ?? null;
    if (!draftSelectedResume) {
      clearSelectedResume();
    } else {
      setSelectedResume(draftSelectedResume);
    }
    markMessagesMutated();
    setMessages([]);
    setAppliedMessageIds(new Set());
    setActiveThought('');
    setLastAssistantSkillId(null);
    void loadSessionDetail(selectedSessionId);
  }, [
    clearComposerAttachments,
    clearSelectedExperiences,
    clearSelectedResume,
    isAuthenticated,
    loadSessionDetail,
    markMessagesMutated,
    selectedSessionId,
    setActiveThought,
    setLastAssistantSkillId,
    setSelectedResume,
  ]);

  useEffect(() => {
    selectedSessionIdRef.current = selectedSessionId;
    if (selectedSessionId) {
      suppressAutoSelectSessionRef.current = false;
    }
  }, [selectedSessionId]);

  const commitCreatedSession = useCallback((
    created: AssistantSession,
    options?: { selectSession?: boolean; preserveAttachment?: boolean; selectedResumeDraft?: AssistantSelectedResume | null },
  ) => {
    suppressAutoSelectSessionRef.current = false;
    draftLaunchRequestRef.current = null;
    markSessionMutated(created.id);
    setSessionsState((prev) => mergeAssistantSessions(prev, [created]));
    if (options?.selectSession === false) {
      return;
    }
    preserveComposerAttachmentOnNextSelectionRef.current = Boolean(options?.preserveAttachment);
    persistDraftSelectedResume(created.id, options?.selectedResumeDraft ?? null);
    if (!options?.preserveAttachment) {
      clearComposerAttachments();
    }
    setSelectedResume(options?.selectedResumeDraft ?? null);
    clearSelectedExperiences();
    selectedSessionIdRef.current = created.id;
    skipNextSelectionResetSessionIdsRef.current.add(created.id);
    setSelectedSessionId(created.id);
    markMessagesMutated();
    setMessages([]);
    setInputValue('');
  }, [
    clearComposerAttachments,
    clearSelectedExperiences,
    markMessagesMutated,
    markSessionMutated,
    persistDraftSelectedResume,
    setInputValue,
    setSelectedResume,
    setSessionsState,
  ]);

  const cleanupSupersededSession = useCallback(async (sessionId: string) => {
    applyHandlerMapRef.current.delete(sessionId);
    callbackOnlySessionIdsRef.current.delete(sessionId);
    draftSelectedResumeBySessionRef.current.delete(sessionId);
    markSessionDeleted(sessionId);
    setSessionsState((prev) => prev.filter((session) => session.id !== sessionId));
    const wasSelected = selectedSessionIdRef.current === sessionId;
    if (wasSelected) {
      clearComposerAttachments();
      clearSelectedExperiences();
      clearSelectedResume();
      selectedSessionIdRef.current = null;
      setSelectedSessionId((current) => (current === sessionId ? null : current));
      markMessagesMutated();
      setMessages([]);
      setAppliedMessageIds(new Set());
      setActiveThought('');
      setInputValue('');
    }
    try {
      await aiService.deleteAssistantSession(sessionId);
    } catch (cleanupError) {
      console.warn('[AIAssistant] Failed to cleanup superseded launch session:', cleanupError);
    }
  }, [
    clearComposerAttachments,
    clearSelectedExperiences,
    clearSelectedResume,
    markMessagesMutated,
    markSessionDeleted,
    setActiveThought,
    setInputValue,
    setSessionsState,
  ]);

  const createSessionRecord = useCallback(async (
    context?: AssistantEntryContext,
    options?: { callbackOnly?: boolean },
  ) => {
    const mode = context?.mode ?? 'general';
    const contextJson = {
      ...(context?.contextJson ?? {}),
      ...(options?.callbackOnly ? { assistantApplyMode: 'manual_save' } : {}),
    };
    return aiService.createAssistantSession({
      mode,
      title: context?.title,
      entrySource: context?.entrySource ?? 'direct',
      contextJson,
    });
  }, []);

  const handleCreateSession = useCallback(async (
    context?: AssistantEntryContext,
    options?: { seedInput?: boolean; preserveAttachment?: boolean; selectedResumeDraft?: AssistantSelectedResume | null; callbackOnly?: boolean },
  ) => {
    const created = await createSessionRecord(context, { callbackOnly: options?.callbackOnly });
    commitCreatedSession(created, {
      preserveAttachment: options?.preserveAttachment,
      selectedResumeDraft: options?.selectedResumeDraft,
    });
    return created;
  }, [commitCreatedSession, createSessionRecord]);

  const persistSessionSnapshot = useCallback((sessionId: string, title?: string, draftCard?: AssistantDraftCard | null) => {
    markSessionMutated(sessionId);
    setSessionsState((prev) => {
      const normalizedDraftCard = draftCard && typeof draftCard === 'object'
        ? normalizeAssistantDraftCard(draftCard)
        : null;
      const nextPreview = normalizedDraftCard
        ? normalizedDraftCard as unknown as Record<string, unknown>
        : {};
      return sortSessionsByUpdatedAt(
        prev.map((item) => {
          if (item.id !== sessionId) {
            return item;
          }
          return {
            ...item,
            ...(title ? { title } : {}),
            latest_preview: nextPreview,
            updated_at: new Date().toISOString(),
          };
        }),
      );
    });
  }, [markSessionMutated, setSessionsState]);

  return {
    sessions,
    selectedSessionId,
    selectedSession,
    messages,
    setMessages,
    appliedMessageIds,
    setAppliedMessageIds,
    isLoadingSessions,
    isLoadingDetail,
    loadSessionDetail,
    selectedSessionIdRef,
    sessionsRef,
    suppressAutoSelectSessionRef,
    draftLaunchRequestRef,
    draftSelectedResumeBySessionRef,
    applyHandlerMapRef,
    callbackOnlySessionIdsRef,
    deletedSessionSeqsRef,
    sessionMutationSeqsRef,
    setSelectedSessionId,
    setSessionsState,
    markSessionMutated,
    markSessionDeleted,
    markMessagesMutated,
    resetForDraftLaunch,
    persistDraftSelectedResume,
    createSessionRecord,
    handleCreateSession,
    commitCreatedSession,
    cleanupSupersededSession,
    persistSessionSnapshot,
  };
};
