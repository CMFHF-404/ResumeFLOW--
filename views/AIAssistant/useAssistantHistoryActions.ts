import { useCallback, useState, type Dispatch, type MouseEvent, type MutableRefObject, type SetStateAction } from 'react';

import { aiService, type AssistantEntryContext, type AssistantMode, type AssistantMessage, type AssistantSelectedResume, type AssistantSession, type AssistantSkillId } from '../../services/aiService';
import { clearPendingAssistantManualSaveDraft } from '../assistantManualSaveStorage';
import type { AssistantLaunchRequest } from './types';
import { mergeAssistantSessions, sortSessionsByUpdatedAt } from './sessionUtils';

type CreateSession = (
  context?: AssistantEntryContext,
  options?: { selectedResumeDraft?: AssistantSelectedResume | null },
) => Promise<AssistantSession>;

type UseAssistantHistoryActionsParams = {
  draftLaunchRequestRef: MutableRefObject<AssistantLaunchRequest | null>;
  suppressAutoSelectSessionRef: MutableRefObject<boolean>;
  selectedSessionIdRef: MutableRefObject<string | null>;
  sessionsRef: MutableRefObject<AssistantSession[]>;
  draftSelectedResumeBySessionRef: MutableRefObject<Map<string, AssistantSelectedResume>>;
  deletedSessionSeqsRef: MutableRefObject<Map<string, number>>;
  sessionMutationSeqsRef: MutableRefObject<Map<string, number>>;
  handleCreateSession: CreateSession;
  setActiveComposerSkillId: Dispatch<SetStateAction<AssistantSkillId | null>>;
  setLastAssistantSkillId: Dispatch<SetStateAction<AssistantSkillId | null>>;
  setIsMobileHistoryOpen: Dispatch<SetStateAction<boolean>>;
  setSelectedSessionId: Dispatch<SetStateAction<string | null>>;
  setMessages: Dispatch<SetStateAction<AssistantMessage[]>>;
  setAppliedMessageIds: Dispatch<SetStateAction<Set<string>>>;
  setActiveThought: Dispatch<SetStateAction<string>>;
  clearComposerAttachments: () => void;
  clearSelectedResume: () => void;
  markMessagesMutated: () => number;
  markSessionDeleted: (sessionId: string) => void;
  markSessionMutated: (sessionId: string) => void;
  setSessionsState: (updater: SetStateAction<AssistantSession[]>) => void;
  error: (message: string, duration?: number) => void;
  success: (message: string, duration?: number) => void;
};

export const useAssistantHistoryActions = ({
  draftLaunchRequestRef,
  suppressAutoSelectSessionRef,
  selectedSessionIdRef,
  sessionsRef,
  draftSelectedResumeBySessionRef,
  deletedSessionSeqsRef,
  sessionMutationSeqsRef,
  handleCreateSession,
  setActiveComposerSkillId,
  setLastAssistantSkillId,
  setIsMobileHistoryOpen,
  setSelectedSessionId,
  setMessages,
  setAppliedMessageIds,
  setActiveThought,
  clearComposerAttachments,
  clearSelectedResume,
  markMessagesMutated,
  markSessionDeleted,
  markSessionMutated,
  setSessionsState,
  error,
  success,
}: UseAssistantHistoryActionsParams) => {
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [isDeletingSession, setIsDeletingSession] = useState(false);

  const handleNewChat = useCallback(async (
    mode: AssistantMode = 'general',
    options?: { selectedResumeDraft?: AssistantSelectedResume | null },
  ) => {
    try {
      draftLaunchRequestRef.current = null;
      suppressAutoSelectSessionRef.current = false;
      setActiveComposerSkillId(null);
      setLastAssistantSkillId(null);
      const session = await handleCreateSession(
        { mode, entrySource: 'direct' },
        { selectedResumeDraft: options?.selectedResumeDraft ?? null },
      );
      setSelectedSessionId(session.id);
      setIsMobileHistoryOpen(false);
    } catch (createError) {
      console.error('[AIAssistant] Failed to create session:', createError);
      error('创建新会话失败，请稍后重试');
    }
  }, [
    draftLaunchRequestRef,
    error,
    handleCreateSession,
    setActiveComposerSkillId,
    setIsMobileHistoryOpen,
    setLastAssistantSkillId,
    setSelectedSessionId,
    suppressAutoSelectSessionRef,
  ]);

  const handleSelectSession = useCallback((sessionId: string) => {
    draftLaunchRequestRef.current = null;
    suppressAutoSelectSessionRef.current = false;
    setActiveComposerSkillId(null);
    setLastAssistantSkillId(null);
    setSelectedSessionId(sessionId);
    setIsMobileHistoryOpen(false);
  }, [
    draftLaunchRequestRef,
    setActiveComposerSkillId,
    setIsMobileHistoryOpen,
    setLastAssistantSkillId,
    setSelectedSessionId,
    suppressAutoSelectSessionRef,
  ]);

  const handleDeleteSession = useCallback((event: MouseEvent, sessionId: string) => {
    event.stopPropagation();
    setDeleteConfirmId(sessionId);
  }, []);

  const executeDeleteSession = useCallback(async () => {
    if (!deleteConfirmId) return;
    const deletedSession = sessionsRef.current.find((session) => session.id === deleteConfirmId) ?? null;
    const deletedDraftSelectedResume = draftSelectedResumeBySessionRef.current.get(deleteConfirmId) ?? null;
    const wasSelected = selectedSessionIdRef.current === deleteConfirmId;
    setIsDeletingSession(true);
    markSessionDeleted(deleteConfirmId);
    setSessionsState((prev) => prev.filter((session) => session.id !== deleteConfirmId));
    draftSelectedResumeBySessionRef.current.delete(deleteConfirmId);
    if (wasSelected) {
      clearComposerAttachments();
      clearSelectedResume();
      selectedSessionIdRef.current = null;
      setSelectedSessionId(null);
      markMessagesMutated();
      setMessages([]);
      setAppliedMessageIds(new Set());
      setActiveThought('');
    }
    try {
      await aiService.deleteAssistantSession(deleteConfirmId);
      clearPendingAssistantManualSaveDraft({ sessionId: deleteConfirmId });
      success('会话已删除');
    } catch {
      deletedSessionSeqsRef.current.delete(deleteConfirmId);
      sessionMutationSeqsRef.current.delete(deleteConfirmId);
      if (deletedDraftSelectedResume) {
        draftSelectedResumeBySessionRef.current.set(deleteConfirmId, deletedDraftSelectedResume);
      }
      if (deletedSession) {
        setSessionsState((prev) => mergeAssistantSessions(prev, [deletedSession]));
        if (wasSelected) {
          selectedSessionIdRef.current = deleteConfirmId;
          setSelectedSessionId(deleteConfirmId);
        }
      }
      error('删除会话失败');
    } finally {
      setIsDeletingSession(false);
      setDeleteConfirmId(null);
    }
  }, [
    clearComposerAttachments,
    clearSelectedResume,
    deleteConfirmId,
    deletedSessionSeqsRef,
    draftSelectedResumeBySessionRef,
    error,
    markMessagesMutated,
    markSessionDeleted,
    selectedSessionIdRef,
    sessionMutationSeqsRef,
    sessionsRef,
    setActiveThought,
    setAppliedMessageIds,
    setMessages,
    setSelectedSessionId,
    setSessionsState,
    success,
  ]);

  const handleRenameSession = useCallback(async (event: MouseEvent, session: Pick<AssistantSession, 'id' | 'title'>) => {
    event.stopPropagation();
    const newTitle = window.prompt('输入新的会话名称：', session.title);
    const trimmedTitle = newTitle?.trim();
    if (!trimmedTitle || trimmedTitle === session.title) return;
    try {
      markSessionMutated(session.id);
      await aiService.updateAssistantSession(session.id, { title: trimmedTitle });
      setSessionsState((prev) => sortSessionsByUpdatedAt(prev.map((item) => (
        item.id === session.id
          ? { ...item, title: trimmedTitle, updated_at: new Date().toISOString() }
          : item
      ))));
      success('重命名成功');
    } catch {
      error('重命名失败');
    }
  }, [error, markSessionMutated, setSessionsState, success]);

  return {
    deleteConfirmId,
    setDeleteConfirmId,
    isDeletingSession,
    handleNewChat,
    handleSelectSession,
    handleDeleteSession,
    executeDeleteSession,
    handleRenameSession,
  };
};
