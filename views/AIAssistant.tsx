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
  Trash2,
  Edit2,
} from 'lucide-react';
import UnAuthPrompt from '../components/UnAuthPrompt';
import { ToastContainer, useToast } from '../components/Toast';
import ConfirmDialog from '../components/ConfirmDialog';
import { MAX_ASSISTANT_SELECTED_EXPERIENCES, aiService, type AssistantDraftCard, type AssistantEntryContext, type AssistantMessage, type AssistantMode, type AssistantSelectedExperience, type AssistantSession, type AssistantStreamEvent } from '../services/aiService';
import { experienceService, type ExperienceListItem } from '../services/experienceService';
import { resumeService } from '../services/resumeService';
import { formatRelativeTime } from '../utils/timeUtils';
import { extractThoughtHeadline } from '../utils/aiThought';
import { stripRichTextToText } from '../utils/richText';

import { AssistantDraftCardView } from './AIAssistant/AssistantDraftCardView';
import ExperiencePicker from './AIAssistant/ExperiencePicker';
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
  draftInput?: string;
  onDraftInputChange?: (value: string) => void;
};

type AssistantAttachmentPreview = {
  name: string;
  type?: string;
  sizeLabel?: string;
  previewUrl?: string | null;
};

type AssistantComposerAttachment = AssistantAttachmentPreview & {
  file: File;
  selectionId: string;
};

const SELECTED_EXPERIENCE_TEXT_LIMIT = 300;
const SELECTED_EXPERIENCE_SUMMARY_LIMIT = 300;
const SELECTED_EXPERIENCE_STAR_LIMIT = 500;

const clipSelectedExperienceText = (value: string, limit: number) => {
  const normalized = value.trim();
  if (!normalized) {
    return '';
  }
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, limit).trimEnd()}...`;
};

const buildSelectedExperienceSummary = (item: ExperienceListItem) => {
  const latest = item.latest_version;
  const summary = clipSelectedExperienceText(
    stripRichTextToText(latest?.summary || ''),
    SELECTED_EXPERIENCE_SUMMARY_LIMIT,
  );
  if (summary) {
    return summary;
  }
  const star = latest?.star || {};
  return (
    clipSelectedExperienceText(
      stripRichTextToText(typeof star.s === 'string' ? star.s : ''),
      SELECTED_EXPERIENCE_STAR_LIMIT,
    )
    || clipSelectedExperienceText(
      stripRichTextToText(typeof star.a === 'string' ? star.a : ''),
      SELECTED_EXPERIENCE_STAR_LIMIT,
    )
    || ''
  );
};

const buildSelectedExperience = (item: ExperienceListItem): AssistantSelectedExperience => {
  const latest = item.latest_version;
  const star = latest?.star || {};
  return {
    masterId: item.master.id,
    category: item.master.category,
    org: clipSelectedExperienceText(latest?.org || '', SELECTED_EXPERIENCE_TEXT_LIMIT),
    title: clipSelectedExperienceText(latest?.title || '', SELECTED_EXPERIENCE_TEXT_LIMIT),
    startDate: clipSelectedExperienceText(latest?.start_date || '', SELECTED_EXPERIENCE_TEXT_LIMIT),
    endDate: clipSelectedExperienceText(latest?.end_date || '', SELECTED_EXPERIENCE_TEXT_LIMIT),
    isCurrent: Boolean(latest?.is_current),
    summary: buildSelectedExperienceSummary(item),
    star: {
      s: clipSelectedExperienceText(
        stripRichTextToText(typeof star.s === 'string' ? star.s : ''),
        SELECTED_EXPERIENCE_STAR_LIMIT,
      ),
      t: clipSelectedExperienceText(
        stripRichTextToText(typeof star.t === 'string' ? star.t : ''),
        SELECTED_EXPERIENCE_STAR_LIMIT,
      ),
      a: clipSelectedExperienceText(
        stripRichTextToText(typeof star.a === 'string' ? star.a : ''),
        SELECTED_EXPERIENCE_STAR_LIMIT,
      ),
      r: clipSelectedExperienceText(
        stripRichTextToText(typeof star.r === 'string' ? star.r : ''),
        SELECTED_EXPERIENCE_STAR_LIMIT,
      ),
    },
  };
};

const EXPERIENCE_CATEGORY_SET = new Set<AssistantSelectedExperience['category']>([
  'work',
  'project',
  'education',
]);

const normalizeSelectedExperienceText = (value: unknown, limit = SELECTED_EXPERIENCE_TEXT_LIMIT): string => {
  if (typeof value !== 'string') {
    return '';
  }
  return clipSelectedExperienceText(value, limit);
};

const normalizeSelectedExperienceStar = (value: unknown): AssistantSelectedExperience['star'] | undefined => {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const rawStar = value as Record<string, unknown>;
  const star = {
    s: normalizeSelectedExperienceText(rawStar.s, SELECTED_EXPERIENCE_STAR_LIMIT),
    t: normalizeSelectedExperienceText(rawStar.t, SELECTED_EXPERIENCE_STAR_LIMIT),
    a: normalizeSelectedExperienceText(rawStar.a, SELECTED_EXPERIENCE_STAR_LIMIT),
    r: normalizeSelectedExperienceText(rawStar.r, SELECTED_EXPERIENCE_STAR_LIMIT),
  };
  if (!star.s && !star.t && !star.a && !star.r) {
    return undefined;
  }
  return star;
};

const createAttachmentSelectionId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const isSameComposerAttachment = (
  left: AssistantComposerAttachment | null | undefined,
  right: AssistantComposerAttachment | null | undefined,
) => {
  if (!left || !right) {
    return false;
  }
  return left.selectionId === right.selectionId;
};

const MODE_META: Record<AssistantMode, { label: string; hint: string; icon: React.ReactNode }> = {
  general: {
    label: '综合助理',
    hint: '同一条对话里自由整理经历、证书与技能',
    icon: (
      <div className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-600 dark:text-emerald-400">
        <Bot className="h-3.5 w-3.5" />
      </div>
    ),
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

const formatFileSize = (size: number) => {
  if (!Number.isFinite(size) || size <= 0) {
    return '';
  }
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

const resolveAssistantStreamThought = (event: AssistantStreamEvent) => {
  if (event.type === 'thought') {
    return extractThoughtHeadline(event.summary) || event.summary;
  }
  if (event.type === 'progress') {
    return event.title?.trim() || '';
  }
  return '';
};

const readMessageAttachmentPreview = (message: AssistantMessage): AssistantAttachmentPreview | null => {
  const rawAttachment = message.content_json?.attachment;
  if (!rawAttachment || typeof rawAttachment !== 'object') {
    return null;
  }
  // 断言为字典类型以便安全读取各字段（content_json 是非结构化 JSON）
  const attachment = rawAttachment as Record<string, unknown>;
  const name = typeof attachment['name'] === 'string' ? attachment['name'].trim() : '';
  if (!name) {
    return null;
  }
  return {
    name,
    type: typeof attachment['type'] === 'string'
      ? attachment['type']
      : typeof attachment['contentType'] === 'string'
        ? attachment['contentType']
        : undefined,
    sizeLabel: typeof attachment['sizeLabel'] === 'string' ? attachment['sizeLabel'] : undefined,
  };
};

const readMessageSelectedExperiences = (message: AssistantMessage): AssistantSelectedExperience[] => {
  const rawSelections = message.content_json?.selected_experiences;
  if (!Array.isArray(rawSelections)) {
    return [];
  }
  return rawSelections.flatMap((item) => {
    if (!item || typeof item !== 'object') {
      return [];
    }
    const candidate = item as Record<string, unknown>;
    const masterId = normalizeSelectedExperienceText(candidate.masterId);
    const category = candidate.category;
    if (!masterId || typeof category !== 'string' || !EXPERIENCE_CATEGORY_SET.has(category as AssistantSelectedExperience['category'])) {
      return [];
    }
    const normalized: AssistantSelectedExperience = {
      masterId,
      category: category as AssistantSelectedExperience['category'],
      org: normalizeSelectedExperienceText(candidate.org),
      title: normalizeSelectedExperienceText(candidate.title),
      startDate: normalizeSelectedExperienceText(candidate.startDate),
      endDate: normalizeSelectedExperienceText(candidate.endDate),
      isCurrent: Boolean(candidate.isCurrent),
      summary: normalizeSelectedExperienceText(candidate.summary, SELECTED_EXPERIENCE_SUMMARY_LIMIT) || undefined,
      star: normalizeSelectedExperienceStar(candidate.star),
    };
    return [normalized];
  });
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
  draftInput = '',
  onDraftInputChange,
}) => {
  const { isAuthenticated } = useLogto();
  const { toasts, success, error, loading, updateToast, closeToast } = useToast();
  const [sessions, setSessions] = useState<AssistantSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [sendingCount, setSendingCount] = useState(0);
  const [inputValue, setInputValue] = useState(draftInput);
  const [activeThought, setActiveThought] = useState<string>('');
  const [appliedMessageIds, setAppliedMessageIds] = useState<Set<string>>(new Set());
  const [applyingMessageIds, setApplyingMessageIds] = useState<Set<string>>(new Set());
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [isDeletingSession, setIsDeletingSession] = useState(false);
  const [composerAttachment, setComposerAttachment] = useState<AssistantComposerAttachment | null>(null);
  const [selectedExperiences, setSelectedExperiences] = useState<AssistantSelectedExperience[]>([]);
  const [pickerExperiences, setPickerExperiences] = useState<AssistantSelectedExperience[]>([]);
  const [isExperiencePickerOpen, setIsExperiencePickerOpen] = useState(false);
  const [isLoadingPickerExperiences, setIsLoadingPickerExperiences] = useState(false);
  const messageViewportRef = useRef<HTMLDivElement | null>(null);
  const composerContainerRef = useRef<HTMLDivElement | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const composerAttachmentRef = useRef<AssistantComposerAttachment | null>(null);
  const applyHandlerMapRef = useRef<Map<string, AssistantApplyDraftHandler>>(new Map());
  const callbackOnlySessionIdsRef = useRef<Set<string>>(new Set());
  const selectedSessionIdRef = useRef<string | null>(null);
  const preserveComposerAttachmentOnNextSelectionRef = useRef(false);
  const detailRequestIdRef = useRef(0);
  const sessionsRef = useRef<AssistantSession[]>([]);
  const sessionMutationSeqsRef = useRef<Map<string, number>>(new Map());
  const deletedSessionSeqsRef = useRef<Map<string, number>>(new Map());
  const sessionMutationCounterRef = useRef(0);
  const messageMutationSeqRef = useRef(0);
  const [composerViewportOffset, setComposerViewportOffset] = useState(220);
  const lastMirroredDraftInputRef = useRef(draftInput);

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

  const markMessagesMutated = useCallback(() => {
    messageMutationSeqRef.current += 1;
    return messageMutationSeqRef.current;
  }, []);

  const clearComposerAttachment = useCallback(() => {
    setComposerAttachment((current) => {
      if (current?.previewUrl) {
        URL.revokeObjectURL(current.previewUrl);
      }
      return null;
    });
    if (attachmentInputRef.current) {
      attachmentInputRef.current.value = '';
    }
  }, []);

  const clearSelectedExperiences = useCallback(() => {
    setSelectedExperiences([]);
  }, []);

  const clearComposerAttachmentIfMatches = useCallback((target: AssistantComposerAttachment | null) => {
    if (!target || !isSameComposerAttachment(composerAttachmentRef.current, target)) {
      return;
    }
    clearComposerAttachment();
  }, [clearComposerAttachment]);

  const handleAttachmentSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    setComposerAttachment((current) => {
      if (current?.previewUrl) {
        URL.revokeObjectURL(current.previewUrl);
      }
      return {
        file,
        selectionId: createAttachmentSelectionId(),
        name: file.name,
        type: file.type || '附件',
        sizeLabel: formatFileSize(file.size),
        previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
      };
    });
    if (event.target) {
      event.target.value = '';
    }
  }, []);

  const openAttachmentPicker = useCallback(() => {
    attachmentInputRef.current?.click();
  }, []);

  const openExperiencePicker = useCallback(async () => {
    setIsExperiencePickerOpen(true);
    if (isLoadingPickerExperiences) {
      return;
    }
    setIsLoadingPickerExperiences(true);
    try {
      const [work, project, education] = await Promise.all([
        experienceService.listAll('work'),
        experienceService.listAll('project'),
        experienceService.listAll('education'),
      ]);
      setPickerExperiences([...work, ...project, ...education].map(buildSelectedExperience));
    } catch (loadError) {
      console.error('[AIAssistant] Failed to load experiences for picker:', loadError);
      error('加载经历列表失败，请稍后重试');
    } finally {
      setIsLoadingPickerExperiences(false);
    }
  }, [error, isLoadingPickerExperiences]);

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
    const mutationSeqAtStart = sessionMutationCounterRef.current;
    const messageMutationAtStart = messageMutationSeqRef.current;
    setIsLoadingDetail(true);
    try {
      const detail = await aiService.getAssistantSession(sessionId);
      if (detailRequestIdRef.current !== requestId || selectedSessionIdRef.current !== sessionId) {
        return;
      }
      if (messageMutationSeqRef.current > messageMutationAtStart) {
        return;
      }
      setMessages(detail.messages);
      setAppliedMessageIds(new Set(detail.messages.filter(isDraftMessageApplied).map((message) => message.id)));
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
  }, [error, scrollToBottom, setSessionsState]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    if (!selectedSessionId || !isAuthenticated) {
      clearComposerAttachment();
      clearSelectedExperiences();
      preserveComposerAttachmentOnNextSelectionRef.current = false;
      markMessagesMutated();
      setMessages([]);
      setAppliedMessageIds(new Set());
      setActiveThought('');
      return;
    }
    const preserveComposerAttachment = preserveComposerAttachmentOnNextSelectionRef.current;
    preserveComposerAttachmentOnNextSelectionRef.current = false;
    if (!preserveComposerAttachment) {
      clearComposerAttachment();
    }
    markMessagesMutated();
    setMessages([]);
    setAppliedMessageIds(new Set());
    setActiveThought('');
    void loadSessionDetail(selectedSessionId);
  }, [clearComposerAttachment, clearSelectedExperiences, isAuthenticated, loadSessionDetail, markMessagesMutated, selectedSessionId]);

  useEffect(() => {
    selectedSessionIdRef.current = selectedSessionId;
  }, [selectedSessionId]);

  useEffect(() => {
    composerAttachmentRef.current = composerAttachment;
  }, [composerAttachment]);

  useEffect(() => {
    if (draftInput === lastMirroredDraftInputRef.current) {
      return;
    }
    lastMirroredDraftInputRef.current = draftInput;
    setInputValue(draftInput);
  }, [draftInput]);

  useEffect(() => {
    lastMirroredDraftInputRef.current = inputValue;
    onDraftInputChange?.(inputValue);
  }, [inputValue, onDraftInputChange]);

  useEffect(() => {
    const composer = composerContainerRef.current;
    if (!composer) {
      return;
    }

    const syncComposerOffset = () => {
      setComposerViewportOffset(composer.offsetHeight);
    };

    syncComposerOffset();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', syncComposerOffset);
      return () => window.removeEventListener('resize', syncComposerOffset);
    }

    const observer = new ResizeObserver(() => {
      syncComposerOffset();
    });
    observer.observe(composer);
    window.addEventListener('resize', syncComposerOffset);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', syncComposerOffset);
    };
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, activeThought, scrollToBottom]);

  useEffect(() => () => {
    if (composerAttachment?.previewUrl) {
      URL.revokeObjectURL(composerAttachment.previewUrl);
    }
  }, [composerAttachment]);

  const commitCreatedSession = useCallback((
    created: AssistantSession,
    options?: { selectSession?: boolean; preserveAttachment?: boolean },
  ) => {
    markSessionMutated(created.id);
    setSessionsState((prev) => mergeAssistantSessions(prev, [created]));
    if (options?.selectSession === false) {
      return;
    }
    preserveComposerAttachmentOnNextSelectionRef.current = Boolean(options?.preserveAttachment);
    if (!options?.preserveAttachment) {
      clearComposerAttachment();
    }
    clearSelectedExperiences();
    selectedSessionIdRef.current = created.id;
    setSelectedSessionId(created.id);
    markMessagesMutated();
    setMessages([]);
    setInputValue('');
  }, [clearComposerAttachment, clearSelectedExperiences, markMessagesMutated, markSessionMutated, setSessionsState]);

  const cleanupSupersededSession = useCallback(async (sessionId: string) => {
    applyHandlerMapRef.current.delete(sessionId);
    callbackOnlySessionIdsRef.current.delete(sessionId);
    markSessionDeleted(sessionId);
    setSessionsState((prev) => prev.filter((session) => session.id !== sessionId));
    const wasSelected = selectedSessionIdRef.current === sessionId;
    if (wasSelected) {
      clearComposerAttachment();
      clearSelectedExperiences();
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
  }, [clearComposerAttachment, clearSelectedExperiences, markMessagesMutated, markSessionDeleted, setSessionsState]);

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
    options?: { seedInput?: boolean; preserveAttachment?: boolean },
  ) => {
    const created = await createSessionRecord(context);
    commitCreatedSession(created, {
      preserveAttachment: options?.preserveAttachment,
    });
    void loadSessions();
    return created;
  }, [commitCreatedSession, createSessionRecord, loadSessions]);

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
    payload: {
      userMessage: string;
      attachment?: AssistantComposerAttachment | null;
      selectedExperiences?: AssistantSelectedExperience[];
    },
    mode?: AssistantMode,
    options?: { shouldAbort?: () => boolean },
  ) => {
    const trimmedMessage = payload.userMessage.trim();
    const attachment = payload.attachment ?? null;
    const selectedExperienceItems = payload.selectedExperiences ?? [];
    if (!trimmedMessage && !attachment && selectedExperienceItems.length === 0) {
      return;
    }
    const effectiveMessage = trimmedMessage
      || (attachment
        ? '请先阅读我上传的附件，并帮我整理其中的信息。'
        : '请优先参考我选中的经历，并结合当前上下文给出针对性的整理与建议。');
    const now = new Date().toISOString();
    const optimisticMessageId = `local-user-${now}-${Math.random()}`;
    const optimisticUserMessage: AssistantMessage = {
      id: optimisticMessageId,
      role: 'user',
      message_type: 'user_text',
      content_json: {
        text: trimmedMessage,
        ...(attachment ? {
          attachment: {
            name: attachment.name,
            type: attachment.type,
            sizeLabel: attachment.sizeLabel,
          },
        } : {}),
        ...(selectedExperienceItems.length > 0 ? {
          selected_experiences: selectedExperienceItems,
        } : {}),
      },
      created_at: now,
    };
    setSendingCount((count) => count + 1);
    if (selectedSessionIdRef.current === sessionId) {
      setActiveThought('');
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
          displayMessage: trimmedMessage,
          mode,
          attachment: attachment?.file ?? null,
          selectedExperiences: selectedExperienceItems,
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
        }
      );
      if (options?.shouldAbort?.()) {
        return;
      }
      persistSessionSnapshot(sessionId, result.title, result.draftCard ?? null);
      if (selectedSessionIdRef.current === sessionId) {
        if (result.assistantText.trim()) {
          markMessagesMutated();
          setMessages((prev) => [
            ...prev,
            {
              id: `local-assistant-${new Date().toISOString()}-${Math.random()}`,
              role: 'assistant',
              message_type: 'assistant_text',
              content_json: { text: result.assistantText },
              created_at: new Date().toISOString(),
            },
          ]);
        }
        setActiveThought('');
        clearComposerAttachmentIfMatches(attachment);
        setSelectedExperiences([]);
        void loadSessionDetail(sessionId);
      }
    } catch (sendError) {
      console.error('[AIAssistant] Failed to send message:', sendError);
      if (selectedSessionIdRef.current === sessionId) {
        setActiveThought('');
        markMessagesMutated();
        setMessages((prev) => prev.filter((message) => message.id !== optimisticMessageId));
        setInputValue((current) => (current.trim() ? current : trimmedMessage));
        setSelectedExperiences((current) => (current.length > 0 ? current : selectedExperienceItems));
      }
      error('AI 助理回复失败，请稍后重试');
    } finally {
      setSendingCount((count) => Math.max(0, count - 1));
    }
  }, [clearComposerAttachmentIfMatches, error, loadSessionDetail, markMessagesMutated, persistSessionSnapshot]);

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
        commitCreatedSession(created, { selectSession: true });
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
            { userMessage: pendingLaunchRequest.initialUserMessage },
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
    if (!nextInput && !composerAttachment && selectedExperiences.length === 0) {
      return;
    }
    let activeSessionId = selectedSessionId;
    let activeMode: AssistantMode | undefined = selectedSession?.mode;
    if (!activeSessionId) {
      const created = await handleCreateSession(undefined, {
        seedInput: false,
        preserveAttachment: Boolean(composerAttachment),
      });
      activeSessionId = created.id;
      activeMode = created.mode;
    }
    if (!activeSessionId) {
      return;
    }
    await sendMessage(
      activeSessionId,
      {
        userMessage: nextInput,
        attachment: composerAttachment,
        selectedExperiences,
      },
      activeMode,
    );
  }, [composerAttachment, handleCreateSession, inputValue, selectedExperiences, selectedSession?.mode, selectedSessionId, sendMessage]);

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
      if (
        card.type === 'experience'
        && selectedSession.entry_source === 'resume_editor'
      ) {
        const contextMasterId = readContextString(selectedSession.context_json ?? {}, 'masterId');
        const targetMasterId = typeof card.data.targetMasterId === 'string' && card.data.targetMasterId.trim()
          ? card.data.targetMasterId.trim()
          : null;
        if (contextMasterId && targetMasterId && targetMasterId !== contextMasterId) {
          throw new Error('AI 草稿目标经历与当前编辑上下文不一致，请重新生成或回到对应经历中处理。');
        }
      }
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
  }, [applyingMessageIds, appliedMessageIds, error, markMessagesMutated, markSessionMutated, selectedSession, setSessionsState, success]);

  const handleNewChat = useCallback(async (mode: AssistantMode = 'general') => {
    try {
      const session = await handleCreateSession({ mode, entrySource: 'direct' });
      setSelectedSessionId(session.id);
    } catch (createError) {
      console.error('[AIAssistant] Failed to create session:', createError);
      error('创建新会话失败，请稍后重试');
    }
  }, [error, handleCreateSession]);

  const handleDeleteSession = useCallback((e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    setDeleteConfirmId(sessionId);
  }, []);

  const executeDeleteSession = useCallback(async () => {
    if (!deleteConfirmId) return;
    const deletedSession = sessionsRef.current.find((session) => session.id === deleteConfirmId) ?? null;
    const wasSelected = selectedSessionIdRef.current === deleteConfirmId;
    setIsDeletingSession(true);
    markSessionDeleted(deleteConfirmId);
    setSessionsState((prev) => prev.filter(s => s.id !== deleteConfirmId));
    if (wasSelected) {
      clearComposerAttachment();
      selectedSessionIdRef.current = null;
      setSelectedSessionId(null);
      markMessagesMutated();
      setMessages([]);
      setAppliedMessageIds(new Set());
      setActiveThought('');
    }
    try {
      await aiService.deleteAssistantSession(deleteConfirmId);
      success('会话已删除');
    } catch {
      deletedSessionSeqsRef.current.delete(deleteConfirmId);
      sessionMutationSeqsRef.current.delete(deleteConfirmId);
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
  }, [clearComposerAttachment, deleteConfirmId, error, markMessagesMutated, markSessionDeleted, setSessionsState, success]);

  const handleRenameSession = useCallback(async (e: React.MouseEvent, session: AssistantSession) => {
    e.stopPropagation();
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

  const historyEmpty = !isLoadingSessions && sessions.length === 0;

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden bg-slate-50">
      <ToastContainer toasts={toasts} onClose={closeToast} />
      <ConfirmDialog
        isOpen={deleteConfirmId !== null}
        title="删除对话"
        description="确定要删除这个对话吗？历史记录将无法恢复。"
        confirmLabel="删除"
        onConfirm={() => void executeDeleteSession()}
        onCancel={() => setDeleteConfirmId(null)}
        isConfirming={isDeletingSession}
      />
      <ExperiencePicker
        isOpen={isExperiencePickerOpen}
        items={pickerExperiences}
        selectedIds={selectedExperiences.map((item) => item.masterId)}
        isLoading={isLoadingPickerExperiences}
        onClose={() => setIsExperiencePickerOpen(false)}
        onConfirm={(masterIds) => {
          const cappedMasterIds = masterIds.slice(0, MAX_ASSISTANT_SELECTED_EXPERIENCES);
          setSelectedExperiences(pickerExperiences.filter((item) => cappedMasterIds.includes(item.masterId)));
          setIsExperiencePickerOpen(false);
        }}
      />
      {!isAuthenticated ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="w-full max-w-3xl rounded-[32px] border border-white/70 bg-white/80 p-10 shadow-[0_24px_80px_-36px_rgba(15,23,42,0.45)] backdrop-blur">
            <div className="mx-auto max-w-2xl text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-slate-900 text-white shadow-lg">
                <Bot className="h-8 w-8" />
              </div>
              <h1 className="mt-6 text-3xl font-semibold tracking-tight text-slate-900">AI 助理</h1>
              <p className="mt-3 text-sm leading-7 text-slate-600">
                这里会一步步追问你的经历、证书和技能，并默认参考你的经历库，优先建议复用或优化已有内容。
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
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
              {historyEmpty ? (
                <div className="rounded-3xl border border-dashed border-white/12 px-4 py-6 text-center text-sm leading-6 text-slate-400">
                  还没有历史会话。新建一个对话，AI 助理就会开始帮你整理素材。
                </div>
              ) : (
                <div className="space-y-2">
                  {sessions.map((session) => (
                    <div
                      key={session.id}
                      className={`group relative flex w-full items-center justify-between rounded-xl px-4 py-3 text-left transition ${selectedSessionId === session.id ? 'bg-white text-slate-950 shadow-lg' : 'bg-white/[0.04] text-slate-100 hover:bg-white/[0.08]'}`}
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedSessionId(session.id)}
                        className="flex-1 truncate text-sm font-semibold text-left outline-none pr-8"
                        title={session.title}
                      >
                        {session.title}
                      </button>
                      <div className="absolute right-3 flex items-center gap-1 md:pointer-events-none md:opacity-0 md:transition md:group-hover:pointer-events-auto md:group-hover:opacity-100 md:group-focus-within:pointer-events-auto md:group-focus-within:opacity-100">
                        <button
                          type="button"
                          onClick={(e) => void handleRenameSession(e, session)}
                          className={`p-1.5 rounded-md transition ${selectedSessionId === session.id ? 'text-slate-400 hover:bg-slate-100 hover:text-slate-600' : 'text-slate-400 hover:bg-white/20 hover:text-white'}`}
                          title="重命名对话"
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => void handleDeleteSession(e, session.id)}
                          className={`p-1.5 rounded-md transition ${selectedSessionId === session.id ? 'text-slate-400 hover:bg-red-50 hover:text-red-500' : 'text-slate-400 hover:bg-red-500/20 hover:text-red-400'}`}
                          title="删除对话"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </aside>

          <main className="relative flex min-h-0 flex-1 flex-col">
            <div className="border-b border-slate-200 bg-white px-4 py-3 md:hidden">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[11px] uppercase tracking-[0.26em] text-emerald-600">AI Assistant</div>
                  <div className="truncate text-sm font-semibold text-slate-900">
                    {selectedSession ? selectedSession.title : 'AI 助理'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void handleNewChat('general')}
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-700 transition hover:border-slate-300 hover:text-slate-900"
                  title="新建综合会话"
                >
                  <MessageSquarePlus className="h-4 w-4" />
                </button>
              </div>
              {sessions.length > 0 ? (
                <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                  {sessions.map((session) => (
                    <div
                      key={session.id}
                      className={`flex shrink-0 items-center gap-1 rounded-full border px-3 py-2 text-sm transition ${
                        selectedSessionId === session.id
                          ? 'border-slate-900 bg-slate-900 text-white'
                          : 'border-slate-200 bg-slate-50 text-slate-700'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedSessionId(session.id)}
                        className="max-w-[140px] truncate text-left"
                        title={session.title}
                      >
                        {session.title}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => void handleRenameSession(e, session)}
                        className={`rounded-full p-1 transition ${
                          selectedSessionId === session.id
                            ? 'text-white/80 hover:bg-white/15 hover:text-white'
                            : 'text-slate-400 hover:bg-slate-200 hover:text-slate-700'
                        }`}
                        title="重命名对话"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => void handleDeleteSession(e, session.id)}
                        className={`rounded-full p-1 transition ${
                          selectedSessionId === session.id
                            ? 'text-white/80 hover:bg-white/15 hover:text-white'
                            : 'text-slate-400 hover:bg-red-50 hover:text-red-500'
                        }`}
                        title="删除对话"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
            <div
              ref={messageViewportRef}
              className="flex-1 overflow-y-auto px-4 pt-6 md:px-7"
              style={{ paddingBottom: composerViewportOffset }}
            >
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
                          你可以让我帮你把混乱的经历梳成 STAR，也可以整理证书与技能。AI 会默认参考你的经历库，优先建议复用或优化已有内容，最后输出一张可确认录入的结构化卡片。
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mx-auto flex max-w-3xl flex-col pt-4 pb-8">
                  {messages.map((message) => {
                    if (message.message_type === 'draft_card') {
                      const draftCard = message.content_json as unknown as AssistantDraftCard;
                      return (
                        <div key={message.id} className="w-full self-center flex justify-center mb-6">
                           <div className="flex-1 max-w-2xl">
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
                    const attachment = readMessageAttachmentPreview(message);
                    const selectedExperiencePreviews = readMessageSelectedExperiences(message);
                    return (
                      <MessageItem
                        key={message.id}
                        isUser={isUser}
                        content={text}
                        attachment={attachment}
                        selectedExperiences={selectedExperiencePreviews}
                      />
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

            <div
              ref={composerContainerRef}
              className="absolute inset-x-0 bottom-0 px-4 pb-6 pt-10 md:px-7 bg-gradient-to-t from-slate-50/95 via-slate-50/80 to-transparent pointer-events-none"
            >
              <div className="pointer-events-auto">
                <input
                  ref={attachmentInputRef}
                  type="file"
                  className="hidden"
                  accept=".pdf,.docx,.jpg,.jpeg,.png,.webp"
                  onChange={handleAttachmentSelect}
                />
                <ChatInputBox
                  value={inputValue}
                  onChange={setInputValue}
                  onSubmit={() => void handleSubmit()}
                  isSending={isSending}
                  placeholder={selectedSession ? '继续描述细节或调整内容...' : '例如：我想整理一段校园运营经历，但现在内容很乱。'}
                  plusActions={[
                    { key: 'pick-experience', label: '选择经历', onClick: () => void openExperiencePicker() },
                    { key: 'upload-attachment', label: '上传附件', onClick: openAttachmentPicker },
                  ]}
                  attachmentPreview={composerAttachment}
                  onRemoveAttachment={clearComposerAttachment}
                  selectedExperiences={selectedExperiences}
                  onRemoveSelectedExperience={(masterId) => {
                    setSelectedExperiences((current) => current.filter((item) => item.masterId !== masterId));
                  }}
                />
              </div>
            </div>
          </main>
        </>
      )}
    </div>
  );
};

export default AIAssistant;
