import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLogto } from '@logto/react';
import {
  Bot,
  ChevronsUpDown,
  FileBadge2,
  Lightbulb,
  MessageSquarePlus,
  Sparkles,
  Wrench,
} from 'lucide-react';
import UnAuthPrompt from '../components/UnAuthPrompt';
import { ToastContainer, useToast } from '../components/Toast';
import { aiService, type AssistantDraftCard, type AssistantEntryContext, type AssistantMessage, type AssistantMode, type AssistantSession, type AssistantStreamEvent } from '../services/aiService';
import { experienceService } from '../services/experienceService';
import { resumeService } from '../services/resumeService';
import { formatRelativeTime } from '../utils/timeUtils';
import { extractThoughtHeadline } from '../utils/aiThought';

import { AssistantDraftCardView } from './AIAssistant/AssistantDraftCardView';
import { MessageItem, ActiveThoughtBlock } from './AIAssistant/MessageItem';
import { ChatInputBox } from './AIAssistant/ChatInputBox';

export type AssistantDraftApplyMeta = {
  sessionId: string;
  messageId: string;
  persistApplied: () => Promise<AssistantMessage>;
};

export type AssistantApplyDraftHandler = (
  draft: AssistantDraftCard,
  meta: AssistantDraftApplyMeta,
) => Promise<boolean>;

export type AssistantLaunchRequest = {
  requestId?: string;
  context: AssistantEntryContext;
  initialUserMessage?: string;
  applyDraftHandler?: AssistantApplyDraftHandler;
  callbackOnly?: boolean;
};

type AIAssistantProps = {
  pendingLaunchRequest?: AssistantLaunchRequest | null;
  onConsumeLaunchRequest?: (requestId?: string) => void;
};

const MODE_META: Record<AssistantMode, { label: string; hint: string; icon: React.ReactNode }> = {
  general: {
    label: '综合助理',
    hint: '同一条对话里自由整理经历、证书与技能',
    icon: <Bot className="h-4 w-4" />,
  },
  experience: {
    label: '经历整理',
    hint: '用 STAR 追问把经历梳成可录入卡片',
    icon: <Sparkles className="h-4 w-4" />,
  },
  certification: {
    label: '证书整理',
    hint: '把证书信息整理成统一录入格式',
    icon: <FileBadge2 className="h-4 w-4" />,
  },
  skill: {
    label: '技能整理',
    hint: '归类技能并沉淀成技能组卡片',
    icon: <Wrench className="h-4 w-4" />,
  },
};

const buildInitialPrompt = (mode: AssistantMode = 'general') => {
  if (mode === 'general') {
    return '请作为综合型简历助理和我对话。你可以帮我整理经历、证书、技能；如果信息不完整，请一步步追问我，最后输出可确认录入的卡片。';
  }
  if (mode === 'certification') {
    return '我想整理一张证书，请一步步问我并输出可确认的证书卡片。';
  }
  if (mode === 'skill') {
    return '我想整理技能，请先帮我分类，再输出可确认的技能组卡片。';
  }
  return '请像简历教练一样一步步追问我，把经历整理成 STAR 卡片。';
};

const resolveSessionHint = (session: AssistantSession | null) => {
  if (!session) {
    return '直接描述你的素材，AI 会自动识别是在整理经历、证书还是技能。';
  }
  if (session.entry_source === 'resume_editor') {
    return '当前会话来自简历工厂高级入口，但你仍然可以继续扩展到证书或技能。';
  }
  if (session.entry_source === 'experience_bank') {
    return '当前会话来自经历库高级入口，但你仍然可以继续扩展到证书或技能。';
  }
  return MODE_META[session.mode].hint;
};

const readContextString = (context: Record<string, unknown>, key: string) => {
  const value = context[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
};

const buildResumeExperienceOverrideOperation = (draft: Extract<AssistantDraftCard, { type: 'experience' }>['data']) => {
  const overrides: Record<string, unknown> = {
    star: draft.star,
    is_current: Boolean(draft.isCurrent),
  };
  const clearOverrideKeys = new Set<string>();
  if (draft.title.trim()) {
    overrides.title = draft.title.trim();
  }
  if (draft.org.trim()) {
    overrides.org = draft.org.trim();
  }
  if (draft.startDate.trim()) {
    overrides.start_date = draft.startDate.trim();
  }
  if (!draft.isCurrent && draft.endDate.trim()) {
    overrides.end_date = draft.endDate.trim();
  } else {
    clearOverrideKeys.add('end_date');
  }
  return {
    overrides_json: overrides,
    ...(clearOverrideKeys.size > 0 ? { clear_override_keys: Array.from(clearOverrideKeys) } : {}),
  };
};

const buildExperienceVersionPayload = (
  draft: Extract<AssistantDraftCard, { type: 'experience' }>['data'],
  fallback?: {
    title?: string;
    org?: string;
    location?: string;
    summary?: string;
    highlights?: string[];
    tags?: string[];
  }
) => {
  const resolvedTitle = draft.title.trim() || fallback?.title?.trim() || '';
  if (!resolvedTitle) {
    throw new Error('缺少经历标题，无法确认录入');
  }
  return {
    title: resolvedTitle,
    org: draft.org.trim() || fallback?.org,
    location: fallback?.location,
    start_date: draft.startDate.trim() || undefined,
    end_date: draft.isCurrent ? undefined : (draft.endDate.trim() || undefined),
    is_current: Boolean(draft.isCurrent),
    summary: fallback?.summary,
    highlights: fallback?.highlights ?? [],
    tags: fallback?.tags ?? [],
    star: draft.star,
  };
};

const isDraftMessageApplied = (message: AssistantMessage) => {
  if (message.message_type !== 'draft_card') {
    return false;
  }
  return typeof message.content_json?.applied_at === 'string' && message.content_json.applied_at.trim().length > 0;
};

const isPendingLatestPreview = (session: AssistantSession) => {
  const preview = session.latest_preview;
  if (!preview || typeof preview !== 'object') {
    return false;
  }
  if (typeof preview.type !== 'string' || !preview.type.trim()) {
    return false;
  }
  return !(typeof preview.applied_at === 'string' && preview.applied_at.trim().length > 0);
};

const isSameDraftCard = (preview: Record<string, unknown> | undefined, card: AssistantDraftCard) => {
  if (!preview || typeof preview !== 'object') {
    return false;
  }
  if (preview.type !== card.type) {
    return false;
  }
  try {
    return JSON.stringify(preview.data ?? null) === JSON.stringify(card.data);
  } catch (error) {
    return false;
  }
};

const sortSessionsByUpdatedAt = (items: AssistantSession[]) => {
  return [...items].sort(
    (left, right) => new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime()
  );
};

const mergeAssistantSessions = (
  current: AssistantSession[],
  incoming: AssistantSession[],
) => {
  const next = new Map<string, AssistantSession>();
  current.forEach((session) => {
    next.set(session.id, session);
  });
  incoming.forEach((session) => {
    next.set(session.id, session);
  });
  return sortSessionsByUpdatedAt(Array.from(next.values()));
};

const reconcileAssistantSessions = (
  current: AssistantSession[],
  incoming: AssistantSession[],
  mutationSeqAtStart: number,
  sessionMutationSeqs: Map<string, number>,
  deletedSessionSeqs: Map<string, number>,
) => {
  const incomingIds = new Set(incoming.map((session) => session.id));
  const next = new Map<string, AssistantSession>();

  current.forEach((session) => {
    const localMutationSeq = sessionMutationSeqs.get(session.id) ?? 0;
    if (!incomingIds.has(session.id) && localMutationSeq > mutationSeqAtStart) {
      next.set(session.id, session);
    }
  });

  incoming.forEach((session) => {
    const currentSession = current.find((item) => item.id === session.id);
    const localMutationSeq = sessionMutationSeqs.get(session.id) ?? 0;
    const deletedSeq = deletedSessionSeqs.get(session.id) ?? 0;
    if (deletedSeq > mutationSeqAtStart) {
      return;
    }
    if (currentSession && localMutationSeq > mutationSeqAtStart) {
      next.set(session.id, currentSession);
      return;
    }
    next.set(session.id, session);
  });

  return sortSessionsByUpdatedAt(Array.from(next.values()));
};



const AIAssistant: React.FC<AIAssistantProps> = ({
  pendingLaunchRequest,
  onConsumeLaunchRequest,
}) => {
  const { isAuthenticated } = useLogto();
  const { toasts, success, error, loading, updateToast, closeToast } = useToast();
  const [sessions, setSessions] = useState<AssistantSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [sendingCount, setSendingCount] = useState(0);
  const [inputValue, setInputValue] = useState('');
  const [activeThought, setActiveThought] = useState<string>('');
  const [appliedMessageIds, setAppliedMessageIds] = useState<Set<string>>(new Set());
  const [applyingMessageIds, setApplyingMessageIds] = useState<Set<string>>(new Set());
  const messageViewportRef = useRef<HTMLDivElement | null>(null);
  const applyHandlerMapRef = useRef<Map<string, AssistantApplyDraftHandler>>(new Map());
  const callbackOnlySessionIdsRef = useRef<Set<string>>(new Set());
  const selectedSessionIdRef = useRef<string | null>(null);
  const detailRequestIdRef = useRef(0);
  const sessionsRef = useRef<AssistantSession[]>([]);
  const sessionMutationSeqsRef = useRef<Map<string, number>>(new Map());
  const deletedSessionSeqsRef = useRef<Map<string, number>>(new Map());
  const sessionMutationCounterRef = useRef(0);

  const selectedSession = useMemo(
    () => sessions.find((item) => item.id === selectedSessionId) ?? null,
    [selectedSessionId, sessions]
  );
  const isSending = sendingCount > 0;

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

  const scrollToBottom = useCallback(() => {
    if (!messageViewportRef.current) {
      return;
    }
    messageViewportRef.current.scrollTop = messageViewportRef.current.scrollHeight;
  }, []);

  const setSessionsState = useCallback((updater: React.SetStateAction<AssistantSession[]>) => {
    const next = typeof updater === 'function'
      ? (updater as (value: AssistantSession[]) => AssistantSession[])(sessionsRef.current)
      : updater;
    sessionsRef.current = next;
    setSessions(next);
  }, []);

  const loadSessions = useCallback(async () => {
    if (!isAuthenticated) {
      setSessionsState([]);
      setSelectedSessionId(null);
      setMessages([]);
      return;
    }
    setIsLoadingSessions(true);
    try {
      const mutationSeqAtStart = sessionMutationCounterRef.current;
      const rows = await aiService.listAssistantSessions();
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
        return nextSessions[0]?.id ?? null;
      });
    } catch (loadError) {
      console.error('[AIAssistant] Failed to load sessions:', loadError);
      error('加载 AI 助理会话失败，请稍后重试');
    } finally {
      setIsLoadingSessions(false);
    }
  }, [error, isAuthenticated, setSessionsState]);

  const loadSessionDetail = useCallback(async (sessionId: string) => {
    const requestId = ++detailRequestIdRef.current;
    setIsLoadingDetail(true);
    try {
      const detail = await aiService.getAssistantSession(sessionId);
      if (detailRequestIdRef.current !== requestId || selectedSessionIdRef.current !== sessionId) {
        return;
      }
      setMessages(detail.messages);
      setAppliedMessageIds(new Set(detail.messages.filter(isDraftMessageApplied).map((message) => message.id)));
      setSessionsState((prev) => mergeAssistantSessions(prev, [detail.session]));
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
  }, [error, scrollToBottom, setSessionsState]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    if (!selectedSessionId || !isAuthenticated) {
      setMessages([]);
      setAppliedMessageIds(new Set());
      setActiveThought('');
      return;
    }
    setMessages([]);
    setAppliedMessageIds(new Set());
    setActiveThought('');
    void loadSessionDetail(selectedSessionId);
  }, [isAuthenticated, loadSessionDetail, selectedSessionId]);

  useEffect(() => {
    selectedSessionIdRef.current = selectedSessionId;
  }, [selectedSessionId]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, activeThought, scrollToBottom]);

  const commitCreatedSession = useCallback((
    created: AssistantSession,
    mode: AssistantMode,
    options?: { seedInput?: boolean; selectSession?: boolean },
  ) => {
    markSessionMutated(created.id);
    setSessionsState((prev) => mergeAssistantSessions(prev, [created]));
    if (options?.selectSession === false) {
      return;
    }
    selectedSessionIdRef.current = created.id;
    setSelectedSessionId(created.id);
    setMessages([]);
    setInputValue(options?.seedInput === false ? '' : buildInitialPrompt(mode));
  }, [markSessionMutated, setSessionsState]);

  const cleanupSupersededSession = useCallback(async (sessionId: string) => {
    applyHandlerMapRef.current.delete(sessionId);
    callbackOnlySessionIdsRef.current.delete(sessionId);
    markSessionDeleted(sessionId);
    setSessionsState((prev) => prev.filter((session) => session.id !== sessionId));
    const wasSelected = selectedSessionIdRef.current === sessionId;
    if (wasSelected) {
      selectedSessionIdRef.current = null;
      setSelectedSessionId((current) => (current === sessionId ? null : current));
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
  }, [markSessionDeleted, setSessionsState]);

  const createSessionRecord = useCallback(async (context?: AssistantEntryContext) => {
    const mode = context?.mode ?? 'general';
    return aiService.createAssistantSession({
      mode,
      title: context?.title,
      entrySource: context?.entrySource ?? 'direct',
      contextJson: context?.contextJson ?? {},
    });
  }, []);

  const handleCreateSession = useCallback(async (
    context?: AssistantEntryContext,
    options?: { seedInput?: boolean },
  ) => {
    const mode = context?.mode ?? 'general';
    const created = await createSessionRecord(context);
    commitCreatedSession(created, mode, { seedInput: options?.seedInput });
    return created;
  }, [commitCreatedSession, createSessionRecord]);

  const persistSessionSnapshot = useCallback((sessionId: string, title?: string, draftCard?: AssistantDraftCard | null) => {
    markSessionMutated(sessionId);
    setSessionsState((prev) => {
      const nextPreview = draftCard && typeof draftCard === 'object'
        ? draftCard as unknown as Record<string, unknown>
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
        })
      );
    });
  }, [markSessionMutated, setSessionsState]);

  const sendMessage = useCallback(async (
    sessionId: string,
    userMessage: string,
    mode?: AssistantMode,
    options?: { shouldAbort?: () => boolean },
  ) => {
    const trimmedMessage = userMessage.trim();
    if (!trimmedMessage) {
      return;
    }
    setSendingCount((count) => count + 1);
    if (selectedSessionIdRef.current === sessionId) {
      setActiveThought('');
    }
    try {
      const result = await aiService.sendAssistantMessage(
        sessionId,
        { userMessage: trimmedMessage, mode },
        (event: AssistantStreamEvent) => {
          if (event.type !== 'thought' || selectedSessionIdRef.current !== sessionId) {
            return;
          }
          const headline = extractThoughtHeadline(event.summary) || event.summary;
          setActiveThought(headline);
        }
      );
      const now = new Date().toISOString();
      const optimisticMessages: AssistantMessage[] = [
        {
          id: `local-user-${now}-${Math.random()}`,
          role: 'user',
          message_type: 'user_text',
          content_json: { text: trimmedMessage },
          created_at: now,
        },
        {
          id: `local-assistant-${now}-${Math.random()}`,
          role: 'assistant',
          message_type: 'assistant_text',
          content_json: { text: result.assistantText },
          created_at: now,
        },
      ];
      if (options?.shouldAbort?.()) {
        return;
      }
      persistSessionSnapshot(sessionId, result.title, result.draftCard ?? null);
      if (selectedSessionIdRef.current === sessionId) {
        setMessages((prev) => [...prev, ...optimisticMessages]);
        setInputValue((prev) => (prev.trim() === trimmedMessage ? '' : prev));
        setActiveThought('');
        setTimeout(() => void loadSessionDetail(sessionId), 100);
      }
    } catch (sendError) {
      console.error('[AIAssistant] Failed to send message:', sendError);
      if (selectedSessionIdRef.current === sessionId) {
        setActiveThought('');
      }
      error('AI 助理回复失败，请稍后重试');
    } finally {
      setSendingCount((count) => Math.max(0, count - 1));
    }
  }, [error, loadSessionDetail, persistSessionSnapshot]);

  useEffect(() => {
    if (!pendingLaunchRequest || !isAuthenticated) {
      return;
    }

    let cancelled = false;
    const bootstrap = async () => {
      try {
        const mode = pendingLaunchRequest.context.mode ?? 'general';
        const created = await createSessionRecord(pendingLaunchRequest.context);
        if (cancelled) {
          await cleanupSupersededSession(created.id);
          return;
        }
        commitCreatedSession(created, mode, { seedInput: !pendingLaunchRequest.initialUserMessage });
        if (cancelled) {
          await cleanupSupersededSession(created.id);
          return;
        }
        if (pendingLaunchRequest.applyDraftHandler) {
          applyHandlerMapRef.current.set(created.id, pendingLaunchRequest.applyDraftHandler);
        }
        if (pendingLaunchRequest.callbackOnly) {
          callbackOnlySessionIdsRef.current.add(created.id);
        }
        if (pendingLaunchRequest.initialUserMessage) {
          if (cancelled) {
            await cleanupSupersededSession(created.id);
            return;
          }
          await sendMessage(
            created.id,
            pendingLaunchRequest.initialUserMessage,
            pendingLaunchRequest.context.mode,
            { shouldAbort: () => cancelled },
          );
          if (cancelled) {
            await cleanupSupersededSession(created.id);
            return;
          }
        }
      } catch (launchError) {
        console.error('[AIAssistant] Failed to bootstrap launch request:', launchError);
        error('打开 AI 助理失败，请稍后重试');
      } finally {
        onConsumeLaunchRequest?.(pendingLaunchRequest.requestId);
      }
    };
    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [cleanupSupersededSession, commitCreatedSession, createSessionRecord, error, isAuthenticated, onConsumeLaunchRequest, pendingLaunchRequest, sendMessage]);

  const handleSubmit = useCallback(async () => {
    const nextInput = inputValue.trim();
    if (!nextInput) {
      return;
    }
    let activeSessionId = selectedSessionId;
    let activeMode: AssistantMode | undefined = selectedSession?.mode;
    if (!activeSessionId) {
      const created = await handleCreateSession(undefined, { seedInput: false });
      activeSessionId = created.id;
      activeMode = created.mode;
    }
    if (!activeSessionId) {
      return;
    }
    await sendMessage(activeSessionId, nextInput, activeMode);
  }, [handleCreateSession, inputValue, selectedSession?.mode, selectedSessionId, sendMessage]);

  const handleApplyDraft = useCallback(async (messageId: string, card: AssistantDraftCard) => {
    if (!selectedSession) {
      return;
    }
    if (applyingMessageIds.has(messageId) || appliedMessageIds.has(messageId)) {
      return;
    }
    const applyHandler = applyHandlerMapRef.current.get(selectedSession.id);
    const callbackOnly = callbackOnlySessionIdsRef.current.has(selectedSession.id);

    setApplyingMessageIds((prev) => new Set(prev).add(messageId));
    try {
      let applied = false;
      let appliedMessage: AssistantMessage | null = null;
      let shouldPersistAppliedMarker = true;
      if (applyHandler) {
        applied = await applyHandler(card, {
          sessionId: selectedSession.id,
          messageId,
          persistApplied: () => aiService.markAssistantMessageApplied(
            selectedSession.id,
            messageId,
            callbackOnly ? { skipApply: true } : undefined,
          ),
        });
        if (callbackOnly) {
          shouldPersistAppliedMarker = false;
        }
      } else if (card.type === 'experience' && selectedSession.entry_source === 'resume_editor') {
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
              ...buildResumeExperienceOverrideOperation(card.data),
            },
          ],
        });
        applied = true;
      } else if (card.type === 'experience' && selectedSession.entry_source === 'experience_bank') {
        appliedMessage = await aiService.markAssistantMessageApplied(selectedSession.id, messageId);
        applied = true;
      } else if (callbackOnly) {
        error('这个草稿需要在原编辑上下文中确认，请从对应入口重新打开会话。');
        return;
      } else {
        appliedMessage = await aiService.markAssistantMessageApplied(selectedSession.id, messageId);
        applied = true;
      }

      if (applied) {
        if (!shouldPersistAppliedMarker) {
          success('草稿已回填到编辑区，保存后才会正式生效');
          return;
        }
        const updatedMessage = appliedMessage ?? await aiService.markAssistantMessageApplied(selectedSession.id, messageId);
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
          if (session.id !== selectedSession.id || !isSameDraftCard(session.latest_preview, card)) {
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
      console.error('[AIAssistant] Failed to apply draft:', applyError);
      error('草稿录入失败，请稍后重试');
    } finally {
      setApplyingMessageIds((prev) => {
        const next = new Set(prev);
        next.delete(messageId);
        return next;
      });
    }
  }, [applyingMessageIds, appliedMessageIds, error, markSessionMutated, selectedSession, setSessionsState, success]);

  const handleNewChat = useCallback(async (mode: AssistantMode = 'general') => {
    try {
      const session = await handleCreateSession({ mode, entrySource: 'direct' });
      setSelectedSessionId(session.id);
    } catch (createError) {
      console.error('[AIAssistant] Failed to create session:', createError);
      error('创建新会话失败，请稍后重试');
    }
  }, [error, handleCreateSession]);

  const historyEmpty = !isLoadingSessions && sessions.length === 0;

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden bg-slate-50">
      <ToastContainer toasts={toasts} onClose={closeToast} />
      {!isAuthenticated ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="w-full max-w-3xl rounded-[32px] border border-white/70 bg-white/80 p-10 shadow-[0_24px_80px_-36px_rgba(15,23,42,0.45)] backdrop-blur">
            <div className="mx-auto max-w-2xl text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-slate-900 text-white shadow-lg">
                <Bot className="h-8 w-8" />
              </div>
              <h1 className="mt-6 text-3xl font-semibold tracking-tight text-slate-900">AI 助理</h1>
              <p className="mt-3 text-sm leading-7 text-slate-600">
                这里会一步步追问你的经历、证书和技能，再整理成可确认录入的结构化卡片。
              </p>
              <div className="mt-6 flex justify-center">
                <UnAuthPrompt />
              </div>
            </div>
          </div>
        </div>
      ) : (
        <>
          <aside className="hidden w-[320px] shrink-0 border-r border-white/60 bg-slate-950 text-slate-100 shadow-[18px_0_50px_-34px_rgba(15,23,42,0.85)] md:flex md:flex-col">
            <div className="border-b border-white/10 px-5 pb-5 pt-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-xs uppercase tracking-[0.32em] text-emerald-300/80">AI Assistant</div>
                  <div className="mt-2 text-xl font-semibold text-white">对话工作台</div>
                </div>
                <button
                  type="button"
                  onClick={() => void handleNewChat('general')}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/12 bg-white/6 text-white transition hover:bg-white/12"
                  title="新建综合会话"
                >
                  <MessageSquarePlus className="h-5 w-5" />
                </button>
              </div>
              <div className="mt-5 grid gap-3">
                <div className="rounded-2xl border border-white/8 bg-white/[0.04] px-4 py-4 text-left">
                  <div className="flex items-center gap-2 text-sm font-semibold text-white">
                    {MODE_META.general.icon}
                    {MODE_META.general.label}
                  </div>
                  <div className="mt-2 text-xs leading-5 text-slate-400">{MODE_META.general.hint}</div>
                  <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-300">
                    <span className="rounded-full bg-white/8 px-2.5 py-1">经历</span>
                    <span className="rounded-full bg-white/8 px-2.5 py-1">证书</span>
                    <span className="rounded-full bg-white/8 px-2.5 py-1">技能</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
              {historyEmpty ? (
                <div className="rounded-3xl border border-dashed border-white/12 px-4 py-6 text-center text-sm leading-6 text-slate-400">
                  还没有历史会话。新建一个对话，AI 助理就会开始帮你整理素材。
                </div>
              ) : (
                <div className="space-y-2">
                  {sessions.map((session) => (
                    <button
                      key={session.id}
                      type="button"
                      onClick={() => setSelectedSessionId(session.id)}
                      className={`w-full rounded-3xl px-4 py-4 text-left transition ${selectedSessionId === session.id ? 'bg-white text-slate-950 shadow-lg' : 'bg-white/[0.04] text-slate-100 hover:bg-white/[0.08]'}`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="truncate text-sm font-semibold">{session.title}</div>
                        <div className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${selectedSessionId === session.id ? 'bg-slate-950 text-white' : 'bg-white/10 text-emerald-300'}`}>
                          {MODE_META[session.mode]?.label ?? MODE_META.general.label}
                        </div>
                      </div>
                      <div className={`mt-2 line-clamp-2 text-xs leading-5 ${selectedSessionId === session.id ? 'text-slate-500' : 'text-slate-400'}`}>
                        {resolveSessionHint(session)}
                      </div>
                      <div className={`mt-3 flex items-center justify-between text-[11px] ${selectedSessionId === session.id ? 'text-slate-400' : 'text-slate-500'}`}>
                        <span>{formatRelativeTime(session.updated_at)}</span>
                        <span>{isPendingLatestPreview(session) ? '有草稿' : '进行中'}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </aside>

          <main className="flex min-h-0 flex-1 flex-col">
            <div className="border-b border-slate-200 bg-white px-4 py-4 md:px-7">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.26em] text-emerald-700">
                    <Lightbulb className="h-3.5 w-3.5" />
                    Guided Drafting
                  </div>
                  <h1 className="mt-3 text-2xl font-semibold tracking-tight text-slate-900">
                    {selectedSession ? selectedSession.title : 'AI 助理'}
                  </h1>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    {selectedSession ? resolveSessionHint(selectedSession) : '选择一个会话，或者新建一个综合整理任务。'}
                  </p>
                </div>
                <div className="flex items-center gap-2 self-start md:self-auto">
                  <button
                    type="button"
                    onClick={() => void handleNewChat('general')}
                    className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-900"
                  >
                    <MessageSquarePlus className="h-4 w-4" />
                    新对话
                  </button>
                </div>
              </div>
            </div>

            <div ref={messageViewportRef} className="flex-1 overflow-y-auto px-4 py-6 md:px-7">
              {!selectedSessionId && !isLoadingSessions ? (
                <div className="mx-auto flex max-w-3xl flex-col gap-6 mt-10">
                  <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
                    <div className="flex items-start gap-4">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                        <Bot className="h-6 w-6" />
                      </div>
                      <div>
                        <h2 className="text-xl font-semibold text-slate-800">开始一个整理任务</h2>
                        <p className="mt-2 text-sm leading-7 text-slate-600">
                          你可以让我帮你把混乱的经历梳成 STAR，也可以整理证书与技能，最后输出一张可确认录入的特殊卡片。
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mx-auto flex max-w-4xl flex-col pt-4 pb-8">
                  {messages.map((message) => {
                    if (message.message_type === 'draft_card') {
                      const draftCard = message.content_json as unknown as AssistantDraftCard;
                      return (
                        <div key={message.id} className="max-w-[95%] self-start flex justify-start mb-6">
                           <div className="mr-4 w-8 shrink-0"></div>
                           <div className="flex-1">
                             <AssistantDraftCardView
                               card={draftCard}
                               onApply={() => void handleApplyDraft(message.id, draftCard)}
                               disabled={appliedMessageIds.has(message.id)}
                               isApplying={applyingMessageIds.has(message.id)}
                             />
                           </div>
                        </div>
                      );
                    }
                    const isUser = message.role === 'user';
                    const text = typeof message.content_json?.text === 'string' ? message.content_json.text : '';
                    return (
                      <MessageItem key={message.id} isUser={isUser} content={text} />
                    );
                  })}
                  {isLoadingDetail ? (
                    <div className="text-center py-4 text-sm text-slate-400">正在加载会话...</div>
                  ) : null}
                  {activeThought ? (
                     <ActiveThoughtBlock thought={activeThought} />
                  ) : null}
                </div>
              )}
            </div>

            <div className="px-4 pb-6 pt-2 md:px-7">
              <ChatInputBox
                  value={inputValue}
                  onChange={setInputValue}
                  onSubmit={() => void handleSubmit()}
                  isSending={isSending}
                  placeholder={selectedSession ? '继续描述细节或调整内容...' : '例如：我想整理一段校园运营经历，但现在内容很乱。'}
                  quickActions={[
                    { label: '引导式追问', onClick: () => setInputValue((v) => v + '引导式追问') },
                    { label: 'STAR 整理', onClick: () => setInputValue((v) => v + 'STAR 整理') },
                  ]}
               />
            </div>
          </main>
        </>
      )}
    </div>
  );
};

export default AIAssistant;
