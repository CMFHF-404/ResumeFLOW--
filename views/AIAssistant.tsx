import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLogto } from '@logto/react';
import {
  Bot,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  FileBadge2,
  Lightbulb,
  MessageSquarePlus,
  PanelLeft,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  Sparkles,
  Wrench,
  Trash2,
  Edit2,
  X,
} from 'lucide-react';
import UnAuthPrompt from '../components/UnAuthPrompt';
import { ToastContainer, useToast } from '../components/Toast';
import ConfirmDialog from '../components/ConfirmDialog';
import { MAX_ASSISTANT_SELECTED_EXPERIENCES, aiService, type AssistantDraftCard, type AssistantEntryContext, type AssistantMessage, type AssistantMode, type AssistantSelectedExperience, type AssistantSelectedResume, type AssistantSession, type AssistantSkillId, type AssistantStreamEvent, type AssistantSuggestedFollowup } from '../services/aiService';
import { certificationsService } from '../services/certificationsService';
import { experienceService } from '../services/experienceService';
import { resumeService } from '../services/resumeService';
import { skillsService } from '../services/skillsService';
import { buildSelectedResumeFromResources } from '../utils/assistantResumeContext';
import { normalizeAssistantDraftCard } from '../utils/assistantDraft';
import { normalizeDateInput } from '../utils/dateUtils';
import { formatRelativeTime } from '../utils/timeUtils';
import { extractThoughtHeadline } from '../utils/aiThought';
import { trackAiAssistantDraftApplied } from '../utils/analyticsTracker';
import {
  clearPendingAssistantManualSaveDraft,
  readPendingAssistantManualSaveDrafts,
  writePendingAssistantManualSaveDraft,
} from './assistantManualSaveStorage';

import { AssistantDraftCardView } from './AIAssistant/AssistantDraftCardView';
import ExperiencePicker from './AIAssistant/ExperiencePicker';
import ResumePicker, { type ResumePickerItem } from './AIAssistant/ResumePicker';
import { MessageItem, ActiveThoughtBlock } from './AIAssistant/MessageItem';
import { ChatInputBox } from './AIAssistant/ChatInputBox';
import {
  ASSISTANT_ATTACHMENT_ACCEPT_ATTR,
  buildAttachmentFileKey,
  buildComposerAttachment,
  isAcceptedAssistantAttachmentFile,
  isSameComposerAttachmentList,
  normalizeIncomingAttachmentFile,
  readMessageAttachmentPreviews,
  type AssistantComposerAttachment,
} from './AIAssistant/attachmentUtils';
import {
  buildFallbackSuggestedFollowups,
  buildSelectedExperience,
  hasResumeJDContext,
  normalizeAssistantSuggestedFollowups,
  normalizeSelectedResume,
  readMessageSelectedExperiences,
  readMessageSelectedResume,
} from './AIAssistant/selectionUtils';
import {
  groupDraftItems,
  isDraftMessageApplied,
  isPendingLatestPreview,
  isSameDraftCard,
  mergeAssistantSessions,
  reconcileAssistantSessions,
  sortSessionsByUpdatedAt,
  type AssistantDraftGroup,
  type AssistantDraftMessageItem,
} from './AIAssistant/sessionUtils';
import type {
  AssistantApplyDraftHandler,
  AssistantLaunchRequest,
} from './AIAssistant/types';

type AIAssistantProps = {
  pendingLaunchRequest?: AssistantLaunchRequest | null;
  onConsumeLaunchRequest?: (requestId?: string) => void;
  onJumpToResumeEditor?: (resumeId?: string) => void;
  draftInput?: string;
  onDraftInputChange?: (value: string) => void;
};

const COMPOSER_OVERLAY_MIN_CLEARANCE = 72;
const COMPOSER_OVERLAY_VISIBLE_OVERLAP = 36;

const ASSISTANT_SKILL_PRESETS: Array<{
  id: AssistantSkillId;
  title: string;
  prompt: string;
  Icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    id: 'star_guidance',
    title: 'STAR 引导助手',
    prompt: '请用 STAR 引导我补全这段经历，先追问缺失信息，不要急着生成成稿。',
    Icon: Sparkles,
  },
  {
    id: 'experience_completion',
    title: '智能补全',
    prompt: '请按智能补全模式诊断选中经历是否足够支撑目标 JD；证据不足时只追问当前经历内可补充事实，0-3 个问题，不要询问其他项目、课程项目、个人练习或非本项目案例。',
    Icon: Wrench,
  },
  {
    id: 'mock_interview',
    title: '模拟面试教练',
    prompt: '请结合我选择的简历/JD，模拟面试官追问，并指出我的回答如何更贴合岗位价值。',
    Icon: Lightbulb,
  },
];

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

const clipLogText = (value: unknown, limit = 240) => {
  if (typeof value !== 'string') {
    return value;
  }
  return value.length > limit ? `${value.slice(0, limit)}...` : value;
};

const readErrorDetail = (payload: unknown): string | null => {
  if (typeof payload === 'string' && payload.trim()) {
    return payload.trim();
  }
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const record = payload as { detail?: unknown; message?: unknown; error?: unknown };
  const detail = record.detail ?? record.message ?? record.error;
  if (typeof detail === 'string' && detail.trim()) {
    return detail.trim();
  }
  if (Array.isArray(detail) || (detail && typeof detail === 'object')) {
    try {
      return JSON.stringify(detail);
    } catch {
      return String(detail);
    }
  }
  return null;
};

const extractApplyErrorDetails = (applyError: unknown) => {
  const maybeError = applyError as {
    message?: unknown;
    code?: unknown;
    response?: { status?: number; data?: unknown };
    config?: { method?: string; url?: string };
  };
  const status = maybeError.response?.status;
  const detail = readErrorDetail(maybeError.response?.data);
  const message = typeof maybeError.message === 'string' ? maybeError.message : null;
  const userMessage = detail || (status ? `HTTP ${status}` : null) || message || '未知错误';
  return {
    userMessage,
    status,
    detail: clipLogText(detail),
    message: clipLogText(message),
    code: typeof maybeError.code === 'string' ? maybeError.code : undefined,
    method: maybeError.config?.method,
    url: maybeError.config?.url,
    responseData: maybeError.response?.data,
  };
};

const summarizeDraftForLog = (card: AssistantDraftCard) => {
  if (card.type !== 'experience') {
    return {
      type: card.type,
      status: card.status,
      hasSummary: Boolean(card.summary?.trim()),
    };
  }
  return {
    type: card.type,
    status: card.status,
    hasSummary: Boolean(card.summary?.trim()),
    category: card.data.category,
    hasTargetMasterId: Boolean(card.data.targetMasterId?.trim()),
    hasOrg: Boolean(card.data.org.trim()),
    hasTitle: Boolean(card.data.title.trim()),
    hasStartDate: Boolean(card.data.startDate.trim()),
    hasEndDate: Boolean(card.data.endDate.trim()),
    isCurrent: card.data.isCurrent,
  };
};

const isPersistedCallbackOnlySession = (session: AssistantSession | null) => {
  if (!session) {
    return false;
  }
  const applyMode = readContextString(session.context_json ?? {}, 'assistantApplyMode');
  if (applyMode === 'manual_save') {
    return true;
  }
  return session.entry_source === 'resume_editor'
    && Boolean(readContextString(session.context_json ?? {}, 'masterId'));
};

const computeComposerReservedHeight = (composerHeight: number) => {
  if (!Number.isFinite(composerHeight) || composerHeight <= 0) {
    return 160;
  }
  return Math.max(composerHeight - COMPOSER_OVERLAY_VISIBLE_OVERLAP, COMPOSER_OVERLAY_MIN_CLEARANCE);
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
    overrides.start_date = normalizeDateInput(draft.startDate) ?? draft.startDate.trim();
  }
  if (!draft.isCurrent && draft.endDate.trim()) {
    overrides.end_date = normalizeDateInput(draft.endDate) ?? draft.endDate.trim();
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
    start_date: normalizeDateInput(draft.startDate) || undefined,
    end_date: draft.isCurrent ? undefined : (normalizeDateInput(draft.endDate) || undefined),
    is_current: Boolean(draft.isCurrent),
    summary: fallback?.summary,
    highlights: fallback?.highlights ?? [],
    tags: fallback?.tags ?? [],
    star: draft.star,
  };
};

const AIAssistant: React.FC<AIAssistantProps> = ({
  pendingLaunchRequest,
  onConsumeLaunchRequest,
  onJumpToResumeEditor,
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
  const [activeComposerSkillId, setActiveComposerSkillId] = useState<AssistantSkillId | null>(null);
  const [lastAssistantSkillId, setLastAssistantSkillId] = useState<AssistantSkillId | null>(null);
  const [activeThought, setActiveThought] = useState<string>('');
  const [appliedMessageIds, setAppliedMessageIds] = useState<Set<string>>(new Set());
  const [applyingMessageIds, setApplyingMessageIds] = useState<Set<string>>(new Set());
  const [manualSaveMessageIds, setManualSaveMessageIds] = useState<Set<string>>(new Set());
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [isDeletingSession, setIsDeletingSession] = useState(false);
  const [composerAttachments, setComposerAttachments] = useState<AssistantComposerAttachment[]>([]);
  const [selectedResume, setSelectedResume] = useState<AssistantSelectedResume | null>(null);
  const [selectedExperiences, setSelectedExperiences] = useState<AssistantSelectedExperience[]>([]);
  const [pickerExperiences, setPickerExperiences] = useState<AssistantSelectedExperience[]>([]);
  const [isExperiencePickerOpen, setIsExperiencePickerOpen] = useState(false);
  const [isLoadingPickerExperiences, setIsLoadingPickerExperiences] = useState(false);
  const [pickerResumes, setPickerResumes] = useState<ResumePickerItem[]>([]);
  const [isResumePickerOpen, setIsResumePickerOpen] = useState(false);
  const [isLoadingPickerResumes, setIsLoadingPickerResumes] = useState(false);
  const [isApplyingPickerResume, setIsApplyingPickerResume] = useState(false);
  const [isMobileHistoryOpen, setIsMobileHistoryOpen] = useState(false);
  const [isDesktopHistoryCollapsed, setIsDesktopHistoryCollapsed] = useState(false);
  const [isDraftPanelOpen, setIsDraftPanelOpen] = useState(true);
  const [isMobileDraftTrayOpen, setIsMobileDraftTrayOpen] = useState(false);
  const [desktopDraftVersionByGroupId, setDesktopDraftVersionByGroupId] = useState<Record<string, number>>({});
  const [mobileDraftVersionByGroupId, setMobileDraftVersionByGroupId] = useState<Record<string, number>>({});
  const [draftExpandedByGroupId, setDraftExpandedByGroupId] = useState<Record<string, boolean>>({});
  const [composerReservedHeight, setComposerReservedHeight] = useState(160);
  const messageViewportRef = useRef<HTMLDivElement | null>(null);
  const composerContainerRef = useRef<HTMLDivElement | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const composerAttachmentsRef = useRef<AssistantComposerAttachment[]>([]);
  const applyHandlerMapRef = useRef<Map<string, AssistantApplyDraftHandler>>(new Map());
  const callbackOnlySessionIdsRef = useRef<Set<string>>(new Set());
  const selectedSessionIdRef = useRef<string | null>(null);
  const preserveComposerAttachmentOnNextSelectionRef = useRef(false);
  const draftSelectedResumeBySessionRef = useRef<Map<string, AssistantSelectedResume>>(new Map());
  const draftLaunchRequestRef = useRef<AssistantLaunchRequest | null>(null);
  const detailRequestIdRef = useRef(0);
  const sessionsRef = useRef<AssistantSession[]>([]);
  const sessionMutationSeqsRef = useRef<Map<string, number>>(new Map());
  const deletedSessionSeqsRef = useRef<Map<string, number>>(new Map());
  const sessionMutationCounterRef = useRef(0);
  const messageMutationSeqRef = useRef(0);
  const suppressAutoSelectSessionRef = useRef(false);
  const previousDraftCountRef = useRef(0);
  const autoOpenedDraftSessionIdsRef = useRef<Set<string>>(new Set());

  if (pendingLaunchRequest?.prefillResume && !pendingLaunchRequest.initialUserMessage) {
    suppressAutoSelectSessionRef.current = true;
  }
  const composerHeightRef = useRef<number | null>(null);
  const lastMirroredDraftInputRef = useRef(draftInput);

  const selectedSession = useMemo(
    () => sessions.find((item) => item.id === selectedSessionId) ?? null,
    [selectedSessionId, sessions]
  );
  const latestSuggestedFollowups = useMemo(() => {
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
  }, [messages]);
  const selectedSessionIsCallbackOnly = useMemo(
    () => (
      selectedSession
        ? callbackOnlySessionIdsRef.current.has(selectedSession.id) || isPersistedCallbackOnlySession(selectedSession)
        : false
    ),
    [selectedSession]
  );
  const draftMessageItems = useMemo<AssistantDraftMessageItem[]>(() => (
    messages.flatMap((message) => {
      if (message.message_type !== 'draft_card') {
        return [];
      }
      const card = normalizeAssistantDraftCard(message.content_json as unknown as AssistantDraftCard);
      const isManualSaveMode = (
        selectedSessionIsCallbackOnly
        && selectedSession?.entry_source === 'resume_editor'
        && card.type === 'experience'
      );
      const onJumpToEditor = isManualSaveMode
        ? () => {
          const context = selectedSession?.context_json ?? {};
          const resumeId = readContextString(context, 'resumeId');
          const masterId =
            readContextString(context, 'masterId')
            || (card.type === 'experience' && typeof card.data.targetMasterId === 'string' && card.data.targetMasterId.trim()
              ? card.data.targetMasterId.trim()
              : null);
          if (resumeId && masterId && card.type === 'experience') {
            writePendingAssistantManualSaveDraft({
              source: 'resume_editor',
              sessionId: selectedSession?.id ?? '',
              messageId: message.id,
              resumeId,
              masterId,
              draft: card.data,
              createdAt: Date.now(),
            });
            setManualSaveMessageIds((prev) => new Set(prev).add(message.id));
          }
          onJumpToResumeEditor?.(resumeId ?? undefined);
        }
        : undefined;
      return [{ message, card, isManualSaveMode, onJumpToEditor }];
    })
  ), [messages, onJumpToResumeEditor, selectedSession, selectedSessionIsCallbackOnly]);
  const draftGroups = useMemo(
    () => groupDraftItems(draftMessageItems),
    [draftMessageItems]
  );
  const draftCardCount = draftGroups.length;
  const isSending = sendingCount > 0;
  const shouldShowSkillPresetPanel = !isLoadingSessions
    && !isLoadingDetail
    && messages.length === 0
    && !activeThought
    && !isSending;

  useEffect(() => {
    const previousDraftCount = previousDraftCountRef.current;
    const draftSessionKey = selectedSessionId ?? '__pending__';
    const hasAutoOpened = autoOpenedDraftSessionIdsRef.current.has(draftSessionKey);
    if (draftCardCount === 1 && previousDraftCount === 0 && !hasAutoOpened) {
      setIsDraftPanelOpen(true);
      setIsMobileDraftTrayOpen(true);
      autoOpenedDraftSessionIdsRef.current.add(draftSessionKey);
    }
    previousDraftCountRef.current = draftCardCount;
  }, [draftCardCount, selectedSessionId]);

  useEffect(() => {
    const groupIds = new Set(draftGroups.map((group) => group.id));
    setDesktopDraftVersionByGroupId((current) => {
      let hasChange = false;
      const next: Record<string, number> = {};
      draftGroups.forEach((group) => {
        const fallbackIndex = group.items.length - 1;
        next[group.id] = fallbackIndex;
        if (current[group.id] !== fallbackIndex) {
          hasChange = true;
        }
      });
      Object.keys(current).forEach((id) => {
        if (!groupIds.has(id)) {
          hasChange = true;
        }
      });
      return hasChange ? next : current;
    });
    setMobileDraftVersionByGroupId((current) => {
      let hasChange = false;
      const next: Record<string, number> = {};
      draftGroups.forEach((group) => {
        const fallbackIndex = group.items.length - 1;
        next[group.id] = fallbackIndex;
        if (current[group.id] !== fallbackIndex) {
          hasChange = true;
        }
      });
      Object.keys(current).forEach((id) => {
        if (!groupIds.has(id)) {
          hasChange = true;
        }
      });
      return hasChange ? next : current;
    });
    setDraftExpandedByGroupId((current) => {
      let hasChange = false;
      const next: Record<string, boolean> = {};
      Object.entries(current).forEach(([id, expanded]) => {
        if (groupIds.has(id)) {
          next[id] = expanded;
        } else {
          hasChange = true;
        }
      });
      return hasChange ? next : current;
    });
  }, [draftGroups]);

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

  const revokeComposerAttachmentPreviews = useCallback((attachments: AssistantComposerAttachment[]) => {
    attachments.forEach((attachment) => {
      if (attachment.previewUrl) {
        URL.revokeObjectURL(attachment.previewUrl);
      }
    });
  }, []);

  const clearComposerAttachments = useCallback(() => {
    setComposerAttachments((current) => {
      revokeComposerAttachmentPreviews(current);
      return [];
    });
    if (attachmentInputRef.current) {
      attachmentInputRef.current.value = '';
    }
  }, [revokeComposerAttachmentPreviews]);

  const clearSelectedExperiences = useCallback(() => {
    setSelectedExperiences([]);
  }, []);

  const clearSelectedResume = useCallback(() => {
    setSelectedResume(null);
  }, []);

  const persistDraftSelectedResume = useCallback((sessionId: string | null | undefined, resume: AssistantSelectedResume | null) => {
    if (!sessionId) {
      return;
    }
    if (resume) {
      draftSelectedResumeBySessionRef.current.set(sessionId, resume);
      return;
    }
    draftSelectedResumeBySessionRef.current.delete(sessionId);
  }, []);

  const clearComposerAttachmentsIfMatches = useCallback((target: AssistantComposerAttachment[]) => {
    if (!target.length || !isSameComposerAttachmentList(composerAttachmentsRef.current, target)) {
      return;
    }
    clearComposerAttachments();
  }, [clearComposerAttachments]);

  const appendComposerAttachments = useCallback((incomingFiles: File[], source: 'picker' | 'drop' | 'paste' = 'picker') => {
    if (incomingFiles.length === 0) {
      return;
    }

    const rejectedFiles = incomingFiles.filter((file) => !isAcceptedAssistantAttachmentFile(file));
    if (rejectedFiles.length > 0) {
      error('仅支持上传图片、PDF 或 DOCX 附件');
    }

    const normalizedFiles = incomingFiles
      .filter((file) => isAcceptedAssistantAttachmentFile(file))
      .map((file) => normalizeIncomingAttachmentFile(file, source === 'paste' ? '粘贴图片' : '附件'));

    if (normalizedFiles.length === 0) {
      return;
    }

    setComposerAttachments((current) => {
      const existingKeys = new Set(current.map((attachment) => buildAttachmentFileKey(attachment.file)));
      const nextAttachments = normalizedFiles
        .filter((file) => {
          const fileKey = buildAttachmentFileKey(file);
          if (existingKeys.has(fileKey)) {
            return false;
          }
          existingKeys.add(fileKey);
          return true;
        })
        .map((file) => buildComposerAttachment(file));

      return nextAttachments.length > 0 ? [...current, ...nextAttachments] : current;
    });

    if (attachmentInputRef.current) {
      attachmentInputRef.current.value = '';
    }
  }, [error]);

  const removeComposerAttachment = useCallback((attachmentId: string) => {
    setComposerAttachments((current) => {
      const target = current.find((item) => item.id === attachmentId);
      if (!target) {
        return current;
      }
      if (target.previewUrl) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return current.filter((item) => item.id !== attachmentId);
    });
  }, []);

  const handleAttachmentSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files ? Array.from(event.target.files) : [];
    if (files.length === 0) {
      return;
    }
    appendComposerAttachments(files, 'picker');
    if (event.target) {
      event.target.value = '';
    }
  }, [appendComposerAttachments]);

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

  const openResumePicker = useCallback(async () => {
    setIsResumePickerOpen(true);
    if (isLoadingPickerResumes) {
      return;
    }
    setIsLoadingPickerResumes(true);
    try {
      const rows = await resumeService.list();
      setPickerResumes(rows.map((item) => ({
        id: item.id,
        title: item.title || '未命名简历',
        targetRole: item.target_role || '',
        updatedAt: item.updated_at,
        hasJD: hasResumeJDContext(item),
      })));
    } catch (loadError) {
      console.error('[AIAssistant] Failed to load resumes for picker:', loadError);
      error('加载简历列表失败，请稍后重试');
    } finally {
      setIsLoadingPickerResumes(false);
    }
  }, [error, isLoadingPickerResumes]);

  const handleConfirmSelectedResume = useCallback(async (resumeId: string) => {
    setIsApplyingPickerResume(true);
    try {
      const resumes = pickerResumes.length > 0 ? pickerResumes : (await resumeService.list()).map((item) => ({
        id: item.id,
        title: item.title || '未命名简历',
        targetRole: item.target_role || '',
        updatedAt: item.updated_at,
        hasJD: hasResumeJDContext(item),
      }));
      if (pickerResumes.length === 0) {
        setPickerResumes(resumes);
      }
      const resumeList = await resumeService.list();
      const selectedResumeRecord = resumeList.find((item) => item.id === resumeId);
      if (!selectedResumeRecord) {
        throw new Error('resume_not_found');
      }
      const [detail, educations, certifications, skills] = await Promise.all([
        resumeService.get(resumeId),
        experienceService.listAll('education'),
        certificationsService.list(),
        skillsService.list(),
      ]);
      const nextSelectedResume = normalizeSelectedResume(
        buildSelectedResumeFromResources(selectedResumeRecord, detail, educations, certifications, skills),
      );
      if (!selectedSessionIdRef.current) {
        suppressAutoSelectSessionRef.current = true;
        const draftLaunchRequest = draftLaunchRequestRef.current;
        if (draftLaunchRequest && nextSelectedResume) {
          draftLaunchRequestRef.current = {
            ...draftLaunchRequest,
            prefillResume: nextSelectedResume,
          };
        }
      }
      setSelectedResume(nextSelectedResume);
      persistDraftSelectedResume(selectedSessionIdRef.current, nextSelectedResume);
      setIsResumePickerOpen(false);
    } catch (applyError) {
      console.error('[AIAssistant] Failed to attach selected resume:', applyError);
      error('带入简历失败，请稍后重试');
    } finally {
      setIsApplyingPickerResume(false);
    }
  }, [error, pickerResumes, persistDraftSelectedResume]);

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
      clearSelectedResume();
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
  }, [clearSelectedResume, error, isAuthenticated, setSessionsState]);

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
  }, [clearComposerAttachments, clearSelectedExperiences, clearSelectedResume, isAuthenticated, loadSessionDetail, markMessagesMutated, selectedSessionId]);

  useEffect(() => {
    selectedSessionIdRef.current = selectedSessionId;
    if (selectedSessionId) {
      suppressAutoSelectSessionRef.current = false;
    }
  }, [selectedSessionId]);

  useEffect(() => {
    if (!isAuthenticated) {
      setIsMobileHistoryOpen(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    composerAttachmentsRef.current = composerAttachments;
  }, [composerAttachments]);

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
    const viewport = messageViewportRef.current;
    if (!composer || !viewport) {
      return;
    }

    const syncComposerResize = () => {
      const previousHeight = composerHeightRef.current;
      const nextHeight = composer.offsetHeight;
      composerHeightRef.current = nextHeight;
      const nextReservedHeight = computeComposerReservedHeight(nextHeight);
      setComposerReservedHeight((current) => (current === nextReservedHeight ? current : nextReservedHeight));

      if (previousHeight === null || nextHeight === previousHeight) {
        return;
      }

      const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
      const growthAllowance = Math.max(24, nextHeight - previousHeight + 24);
      if (distanceFromBottom <= growthAllowance) {
        requestAnimationFrame(() => {
          scrollToBottom();
        });
      }
    };

    syncComposerResize();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', syncComposerResize);
      return () => window.removeEventListener('resize', syncComposerResize);
    }

    const observer = new ResizeObserver(() => {
      syncComposerResize();
    });
    observer.observe(composer);
    window.addEventListener('resize', syncComposerResize);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', syncComposerResize);
    };
  }, [scrollToBottom]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, activeThought, scrollToBottom]);

  useEffect(() => {
    if (!selectedSessionId) {
      setManualSaveMessageIds(new Set());
      return;
    }
    const pendingManualSaveDrafts = readPendingAssistantManualSaveDrafts({ sessionId: selectedSessionId });
    setManualSaveMessageIds(new Set(pendingManualSaveDrafts.map((draft) => draft.messageId)));
  }, [messages, selectedSessionId]);

  useEffect(() => () => {
    revokeComposerAttachmentPreviews(composerAttachmentsRef.current);
  }, [revokeComposerAttachmentPreviews]);

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
    setSelectedSessionId(created.id);
    markMessagesMutated();
    setMessages([]);
    setInputValue('');
  }, [clearComposerAttachments, clearSelectedExperiences, markMessagesMutated, markSessionMutated, persistDraftSelectedResume, setSessionsState]);

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
  }, [clearComposerAttachments, clearSelectedExperiences, clearSelectedResume, markMessagesMutated, markSessionDeleted, setSessionsState]);

  const createSessionRecord = useCallback(async (context?: AssistantEntryContext, options?: { callbackOnly?: boolean }) => {
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
        })
      );
    });
  }, [markSessionMutated, setSessionsState]);

  const sendMessage = useCallback(async (
    sessionId: string,
    payload: {
      userMessage: string;
      skillId?: AssistantSkillId | null;
      attachments?: AssistantComposerAttachment[];
      selectedExperiences?: AssistantSelectedExperience[];
      selectedResume?: AssistantSelectedResume | null;
    },
    mode?: AssistantMode,
    options?: { shouldAbort?: () => boolean },
  ) => {
    const trimmedMessage = payload.userMessage.trim();
    const skillId = payload.skillId ?? null;
    const attachments = payload.attachments ?? [];
    const selectedExperienceItems = payload.selectedExperiences ?? [];
    const selectedResumeItem = payload.selectedResume ?? null;
    if (!trimmedMessage && attachments.length === 0 && selectedExperienceItems.length === 0 && !selectedResumeItem) {
      return;
    }
    const effectiveMessage = trimmedMessage
      || (attachments.length > 0
        ? attachments.length > 1
          ? '请先阅读我上传的这些附件，并帮我整理其中的关键信息。'
          : '请先阅读我上传的附件，并帮我整理其中的信息。'
        : selectedResumeItem
          ? '请结合我选择的简历和对应 JD，给出针对性的简历修改建议，并可按需生成模拟面试题。'
          : '请优先参考我选中的经历，并结合当前上下文给出针对性的整理与建议。');
    const now = new Date().toISOString();
    const optimisticMessageId = `local-user-${now}-${Math.random()}`;
    const optimisticUserMessage: AssistantMessage = {
      id: optimisticMessageId,
      role: 'user',
      message_type: 'user_text',
      content_json: {
        text: trimmedMessage,
        ...(attachments.length > 0 ? {
          attachment: {
            id: attachments[0].id,
            name: attachments[0].name,
            type: attachments[0].type,
            sizeLabel: attachments[0].sizeLabel,
          },
          ...(attachments.length > 1 ? {
            attachments: attachments.map((attachment) => ({
              id: attachment.id,
              name: attachment.name,
              type: attachment.type,
              sizeLabel: attachment.sizeLabel,
            })),
          } : {}),
        } : {}),
        ...(selectedExperienceItems.length > 0 ? {
          selected_experiences: selectedExperienceItems,
        } : {}),
        ...(selectedResumeItem ? {
          selected_resume: selectedResumeItem,
        } : {}),
        ...(skillId ? { skill_id: skillId } : {}),
      },
      created_at: now,
    };
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
              content_json: {
                text: result.assistantText,
                ...(skillId ? { skill_id: skillId } : {}),
                ...(result.suggestedFollowups?.length ? { suggestedFollowups: result.suggestedFollowups } : {}),
              },
              created_at: new Date().toISOString(),
            },
          ]);
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
        setComposerAttachments((current) => {
          if (current.length > 0) {
            return current;
          }
          return attachments;
        });
        setSelectedExperiences((current) => (current.length > 0 ? current : selectedExperienceItems));
        persistDraftSelectedResume(sessionId, selectedResumeItem);
        setSelectedResume((current) => current ?? selectedResumeItem);
      }
      error('AI 助理回复失败，请稍后重试');
    } finally {
      setSendingCount((count) => Math.max(0, count - 1));
    }
  }, [clearComposerAttachmentsIfMatches, error, loadSessionDetail, markMessagesMutated, persistDraftSelectedResume, persistSessionSnapshot]);

  useEffect(() => {
    if (!pendingLaunchRequest || !isAuthenticated) {
      return;
    }

    let cancelled = false;
    const bootstrap = async () => {
      try {
        const mode = pendingLaunchRequest.context.mode ?? 'general';
        const normalizedPrefillResume = normalizeSelectedResume(pendingLaunchRequest.prefillResume);
        if (!pendingLaunchRequest.initialUserMessage) {
          draftLaunchRequestRef.current = pendingLaunchRequest;
          selectedSessionIdRef.current = null;
          setSelectedSessionId(null);
          clearComposerAttachments();
          clearSelectedExperiences();
          markMessagesMutated();
          setMessages([]);
          setAppliedMessageIds(new Set());
          setActiveThought('');
          setSelectedResume(normalizedPrefillResume);
          setInputValue('');
          return;
        }
        const created = await createSessionRecord(pendingLaunchRequest.context, {
          callbackOnly: pendingLaunchRequest.callbackOnly,
        });
        if (cancelled) {
          await cleanupSupersededSession(created.id);
          return;
        }
        commitCreatedSession(created, {
          selectSession: true,
          selectedResumeDraft: normalizedPrefillResume,
        });
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
            {
              userMessage: pendingLaunchRequest.initialUserMessage,
              skillId: pendingLaunchRequest.initialSkillId ?? null,
              selectedResume: pendingLaunchRequest.prefillResume ?? null,
            },
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
  }, [clearComposerAttachments, clearSelectedExperiences, cleanupSupersededSession, commitCreatedSession, createSessionRecord, error, isAuthenticated, markMessagesMutated, onConsumeLaunchRequest, pendingLaunchRequest, sendMessage]);

  const handleSubmit = useCallback(async () => {
    const nextInput = inputValue.trim();
    if (!nextInput && composerAttachments.length === 0 && selectedExperiences.length === 0 && !selectedResume) {
      return;
    }
    let activeSessionId = selectedSessionId;
    let activeMode: AssistantMode | undefined = selectedSession?.mode;
    if (!activeSessionId) {
      const draftLaunchRequest = draftLaunchRequestRef.current;
      const created = await handleCreateSession(draftLaunchRequest?.context, {
        seedInput: false,
        preserveAttachment: composerAttachments.length > 0,
        selectedResumeDraft: selectedResume,
        callbackOnly: draftLaunchRequest?.callbackOnly,
      });
      if (draftLaunchRequest?.applyDraftHandler) {
        applyHandlerMapRef.current.set(created.id, draftLaunchRequest.applyDraftHandler);
      }
      if (draftLaunchRequest?.callbackOnly) {
        callbackOnlySessionIdsRef.current.add(created.id);
      }
      draftLaunchRequestRef.current = null;
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
        skillId: activeComposerSkillId,
        attachments: composerAttachments,
        selectedExperiences,
        selectedResume,
      },
      activeMode,
    );
  }, [activeComposerSkillId, composerAttachments, handleCreateSession, inputValue, selectedExperiences, selectedResume, selectedSession?.mode, selectedSessionId, sendMessage]);

  const handleSelectSkillPreset = useCallback((skillId: AssistantSkillId, prompt: string) => {
    setActiveComposerSkillId(skillId);
    setInputValue(prompt);
  }, []);

  const handleSelectSkillFollowup = useCallback((skillId: AssistantSkillId, prompt: string) => {
    setActiveComposerSkillId(skillId);
    setInputValue(prompt);
  }, []);

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
    const isResumeEditorManualSaveMode = (
      callbackOnly
      && normalizedCard.type === 'experience'
      && selectedSession.entry_source === 'resume_editor'
    );

    setApplyingMessageIds((prev) => new Set(prev).add(messageId));
    try {
      let applied = false;
      let appliedMessage: AssistantMessage | null = null;
      let shouldPersistAppliedMarker = true;
      let handledByCustomApply = false;
      if (
        normalizedCard.type === 'experience'
        && selectedSession.entry_source === 'resume_editor'
      ) {
        const contextMasterId = readContextString(selectedSession.context_json ?? {}, 'masterId');
        const targetMasterId = typeof normalizedCard.data.targetMasterId === 'string' && normalizedCard.data.targetMasterId.trim()
          ? normalizedCard.data.targetMasterId.trim()
          : null;
        if (contextMasterId && targetMasterId && targetMasterId !== contextMasterId) {
          throw new Error('AI 草稿目标经历与当前编辑上下文不一致，请重新生成或回到对应经历中处理。');
        }
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
        appliedMessage = await aiService.markAssistantMessageApplied(selectedSession.id, messageId);
        experienceService.clearListCache();
        applied = true;
      } else if (!handledByCustomApply && callbackOnly) {
        error('这个草稿需要在原编辑上下文中确认，请从对应入口重新打开会话。');
        return;
      } else if (!handledByCustomApply) {
        appliedMessage = await aiService.markAssistantMessageApplied(selectedSession.id, messageId);
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
            const context = selectedSession.context_json ?? {};
            const resumeId = readContextString(context, 'resumeId');
            const masterId =
              readContextString(context, 'masterId')
              || (typeof normalizedCard.data.targetMasterId === 'string' && normalizedCard.data.targetMasterId.trim()
                ? normalizedCard.data.targetMasterId.trim()
                : null);
            if (resumeId && masterId) {
              writePendingAssistantManualSaveDraft({
                source: 'resume_editor',
                sessionId: selectedSession.id,
                messageId,
                resumeId,
                masterId,
                draft: normalizedCard.data,
                createdAt: Date.now(),
              });
            }
            setManualSaveMessageIds((prev) => new Set(prev).add(messageId));
            success('草稿已同步到编辑区，请前往编辑区保存');
            return;
          }
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
  }, [applyingMessageIds, appliedMessageIds, error, markMessagesMutated, markSessionMutated, selectedSession, setSessionsState, success]);

  const handleNewChat = useCallback(async (mode: AssistantMode = 'general') => {
    try {
      draftLaunchRequestRef.current = null;
      suppressAutoSelectSessionRef.current = false;
      setActiveComposerSkillId(null);
      setLastAssistantSkillId(null);
      const session = await handleCreateSession({ mode, entrySource: 'direct' });
      setSelectedSessionId(session.id);
      setIsMobileHistoryOpen(false);
    } catch (createError) {
      console.error('[AIAssistant] Failed to create session:', createError);
      error('创建新会话失败，请稍后重试');
    }
  }, [error, handleCreateSession]);

  const handleSelectSession = useCallback((sessionId: string) => {
    draftLaunchRequestRef.current = null;
    suppressAutoSelectSessionRef.current = false;
    setActiveComposerSkillId(null);
    setLastAssistantSkillId(null);
    setSelectedSessionId(sessionId);
    setIsMobileHistoryOpen(false);
  }, []);

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
  }, [clearComposerAttachments, clearSelectedResume, deleteConfirmId, error, markMessagesMutated, markSessionDeleted, setSessionsState, success]);

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
  const visibleDraftGroups = draftGroups;
  const renderDraftGroup = (
    group: AssistantDraftGroup,
    index: number,
    surface: 'desktop' | 'mobile' = 'desktop',
  ) => {
    const latestVersionIndex = group.items.length - 1;
    const versionByGroupId = surface === 'mobile' ? mobileDraftVersionByGroupId : desktopDraftVersionByGroupId;
    const setVersionByGroupId = surface === 'mobile' ? setMobileDraftVersionByGroupId : setDesktopDraftVersionByGroupId;
    const versionIndex = Math.min(
      Math.max(versionByGroupId[group.id] ?? latestVersionIndex, 0),
      latestVersionIndex,
    );
    const item = group.items[versionIndex] ?? group.latestItem;
    const isExpanded = draftExpandedByGroupId[group.id] ?? index === 0;
    const setVersionIndex = (nextIndex: number) => {
      setVersionByGroupId((current) => ({
        ...current,
        [group.id]: Math.min(Math.max(nextIndex, 0), latestVersionIndex),
      }));
    };
    return (
      <div key={group.id} className="transition-all duration-300 ease-out">
        <div className="relative">
          {group.items.length > 1 ? (
            <div className="absolute right-4 top-5 z-10 flex items-center rounded-2xl bg-slate-100/95 p-1 shadow-sm backdrop-blur dark:bg-slate-900/95">
              <button
                type="button"
                onClick={() => setVersionIndex(versionIndex - 1)}
                disabled={versionIndex <= 0}
                className="inline-flex h-8 w-8 items-center justify-center rounded-xl text-slate-600 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800"
                title="上一版"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <div className="min-w-10 text-center text-xs font-semibold text-slate-600 dark:text-slate-300">
                {versionIndex + 1}/{group.items.length}
              </div>
              <button
                type="button"
                onClick={() => setVersionIndex(versionIndex + 1)}
                disabled={versionIndex >= latestVersionIndex}
                className="inline-flex h-8 w-8 items-center justify-center rounded-xl text-slate-600 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800"
                title="下一版"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          ) : null}
          <AssistantDraftCardView
            key={item.message.id}
            card={item.card}
            expanded={isExpanded}
            onExpandedChange={(expanded) => {
              setDraftExpandedByGroupId((current) => ({
                ...current,
                [group.id]: expanded,
              }));
            }}
            onApply={() => void handleApplyDraft(item.message.id, item.card)}
            disabled={appliedMessageIds.has(item.message.id) || manualSaveMessageIds.has(item.message.id)}
            isApplying={applyingMessageIds.has(item.message.id)}
            isManualSaveMode={item.isManualSaveMode}
            showManualSaveHint={manualSaveMessageIds.has(item.message.id)}
            onJumpToEditor={item.onJumpToEditor}
          />
        </div>
      </div>
    );
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden bg-slate-50 dark:bg-slate-950">
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
      <ResumePicker
        isOpen={isResumePickerOpen}
        items={pickerResumes}
        selectedId={selectedResume?.resumeId ?? null}
        isLoading={isLoadingPickerResumes}
        isApplying={isApplyingPickerResume}
        onClose={() => setIsResumePickerOpen(false)}
        onConfirm={(resumeId) => void handleConfirmSelectedResume(resumeId)}
      />
      {!isAuthenticated ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="w-full max-w-3xl rounded-[32px] border border-white/70 bg-white/80 p-10 shadow-[0_24px_80px_-36px_rgba(15,23,42,0.45)] backdrop-blur dark:border-slate-700 dark:bg-slate-950/90 dark:shadow-[0_28px_90px_-38px_rgba(2,6,23,0.95)]">
            <div className="mx-auto max-w-2xl text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-slate-900 text-white shadow-lg dark:bg-emerald-500/15 dark:text-emerald-300">
                <Bot className="h-8 w-8" />
              </div>
              <h1 className="mt-6 text-3xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">AI 助理</h1>
              <p className="mt-3 text-sm leading-7 text-slate-600 dark:text-slate-400">
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
          <aside
            className={`hidden shrink-0 border-r border-white/60 bg-slate-950 text-slate-100 shadow-[18px_0_50px_-34px_rgba(15,23,42,0.85)] transition-[width] duration-300 md:flex md:flex-col ${
              isDesktopHistoryCollapsed ? 'w-[68px]' : 'w-[320px]'
            }`}
          >
            {isDesktopHistoryCollapsed ? (
              <div className="flex min-h-0 flex-1 flex-col items-center gap-3 px-2 py-5">
                <button
                  type="button"
                  onClick={() => setIsDesktopHistoryCollapsed(false)}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-white/6 text-white transition hover:bg-white/12"
                  title="展开对话记录"
                >
                  <PanelLeftOpen className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  onClick={() => void handleNewChat('general')}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-white/6 text-white transition hover:bg-white/12"
                  title="新建综合会话"
                >
                  <MessageSquarePlus className="h-5 w-5" />
                </button>
              </div>
            ) : (
              <>
                <div className="border-b border-white/10 px-5 pb-5 pt-6">
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="text-xs uppercase tracking-[0.32em] text-emerald-300/80">AI Assistant</div>
                      <div className="mt-2 truncate text-xl font-semibold text-white">AI 助理</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void handleNewChat('general')}
                        className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-white/6 text-white transition hover:bg-white/12"
                        title="新建综合会话"
                      >
                        <MessageSquarePlus className="h-5 w-5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsDesktopHistoryCollapsed(true)}
                        className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-white/6 text-white transition hover:bg-white/12"
                        title="收起对话记录"
                      >
                        <PanelLeftClose className="h-5 w-5" />
                      </button>
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
                        <div
                          key={session.id}
                          className={`group relative flex w-full items-center justify-between rounded-xl px-4 py-3 text-left transition ${selectedSessionId === session.id ? 'bg-white text-slate-950 shadow-lg' : 'bg-white/[0.04] text-slate-100 hover:bg-white/[0.08]'}`}
                        >
                          <button
                            type="button"
                            onClick={() => setSelectedSessionId(session.id)}
                            className="flex-1 truncate text-left text-sm font-semibold outline-none pr-8"
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
              </>
            )}
          </aside>

          <>
            <button
              type="button"
              aria-label="关闭对话记录"
              onClick={() => setIsMobileHistoryOpen(false)}
              className={`fixed inset-0 z-[70] bg-slate-950/45 backdrop-blur-[1px] transition-opacity duration-300 md:hidden ${
                isMobileHistoryOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
              }`}
            />
            <aside
              className={`fixed inset-y-0 left-0 z-[71] flex w-[82vw] max-w-[320px] flex-col border-r border-white/12 bg-slate-950 text-slate-100 transition-all duration-300 ease-out md:hidden ${
                isMobileHistoryOpen
                  ? 'translate-x-0 opacity-100 shadow-[24px_0_70px_-28px_rgba(15,23,42,0.95)]'
                  : 'pointer-events-none -translate-x-[calc(100%+64px)] opacity-0 shadow-none'
              }`}
            >
              <div className="border-b border-white/10 px-4 pb-4 pt-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.28em] text-emerald-300/80">对话记录</div>
                    <div className="mt-2 text-lg font-semibold text-white">AI 助理</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsMobileHistoryOpen(false)}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/12 bg-white/6 text-white transition hover:bg-white/12"
                    title="关闭对话记录"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => void handleNewChat('general')}
                  className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-white shadow-[0_18px_40px_-28px_rgba(16,185,129,0.85)] transition hover:bg-emerald-400"
                >
                  <MessageSquarePlus className="h-4 w-4" />
                  新建对话
                </button>
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
                        className={`group relative flex w-full items-center justify-between rounded-2xl px-4 py-3 text-left transition ${
                          selectedSessionId === session.id
                            ? 'bg-white text-slate-950 shadow-lg'
                            : 'bg-white/[0.04] text-slate-100 hover:bg-white/[0.08]'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => handleSelectSession(session.id)}
                          className="flex-1 truncate pr-16 text-left text-sm font-semibold outline-none"
                          title={session.title}
                        >
                          {session.title}
                        </button>
                        <div className="absolute right-3 flex items-center gap-1">
                          <button
                            type="button"
                            onClick={(e) => void handleRenameSession(e, session)}
                            className={`rounded-md p-1.5 transition ${
                              selectedSessionId === session.id
                                ? 'text-slate-400 hover:bg-slate-100 hover:text-slate-600'
                                : 'text-slate-400 hover:bg-white/20 hover:text-white'
                            }`}
                            title="重命名对话"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => void handleDeleteSession(e, session.id)}
                            className={`rounded-md p-1.5 transition ${
                              selectedSessionId === session.id
                                ? 'text-slate-400 hover:bg-red-50 hover:text-red-500'
                                : 'text-slate-400 hover:bg-red-500/20 hover:text-red-400'
                            }`}
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
          </>

          <main className="relative flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="border-b border-slate-200/90 bg-white/95 px-3 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90 md:hidden">
              <div className="grid grid-cols-[40px_minmax(0,1fr)_40px] items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsMobileHistoryOpen(true)}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-700 transition hover:border-slate-300 hover:bg-white hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-800 dark:hover:text-white"
                  title="打开对话记录"
                >
                  <PanelLeft className="h-4 w-4" />
                </button>
                <div className="min-w-0 truncate text-center text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {selectedSession ? selectedSession.title : 'AI 助理'}
                </div>
                <div className="h-10 w-10" aria-hidden="true" />
              </div>
            </div>
            <div
              ref={messageViewportRef}
              className="min-w-0 flex-1 overflow-y-auto px-3 pt-4 sm:px-4 md:px-7 md:pt-6"
              style={{ paddingBottom: `${composerReservedHeight}px` }}
            >
              {shouldShowSkillPresetPanel ? (
                <div className="mx-auto mt-6 flex w-full max-w-3xl min-w-0 flex-col gap-6 md:mt-10">
                  <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:shadow-[0_20px_60px_-30px_rgba(2,6,23,0.95)] md:p-8">
                    <div className="flex items-start gap-4">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300">
                        <Bot className="h-6 w-6" />
                      </div>
                      <div>
                        <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-100">选择 AI 助手定位</h2>
                        <p className="mt-2 text-sm leading-7 text-slate-600 dark:text-slate-400">
                          先选一个工作方式，我会把对应提示放进输入框。你可以继续修改，再决定是否发送。
                        </p>
                      </div>
                    </div>
                    <div className="mt-6 grid gap-3 sm:grid-cols-3">
                      {ASSISTANT_SKILL_PRESETS.map(({ id, title, prompt, Icon }) => {
                        const isActive = activeComposerSkillId === id;
                        return (
                          <button
                            key={id}
                            type="button"
                            onClick={() => handleSelectSkillPreset(id, prompt)}
                            className={`min-h-[124px] rounded-2xl border px-4 py-4 text-left transition ${
                              isActive
                                ? 'border-emerald-300 bg-emerald-50 text-emerald-950 shadow-sm dark:border-emerald-500/60 dark:bg-emerald-950/35 dark:text-emerald-100'
                                : 'border-slate-200 bg-slate-50/80 text-slate-800 hover:border-slate-300 hover:bg-white dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100 dark:hover:border-slate-600 dark:hover:bg-slate-900'
                            }`}
                          >
                            <span className={`inline-flex h-9 w-9 items-center justify-center rounded-xl ${
                              isActive
                                ? 'bg-emerald-500 text-white'
                                : 'bg-white text-slate-500 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700'
                            }`}>
                              <Icon className="h-4 w-4" />
                            </span>
                            <span className="mt-3 block text-sm font-semibold leading-5">{title}</span>
                            <span className="mt-2 block text-xs leading-5 text-slate-500 dark:text-slate-400">
                              {prompt}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-col pb-4 pt-2 md:pt-4">
                  {messages.map((message) => {
                    if (message.message_type === 'draft_card') {
                      return null;
                    }
                    const isUser = message.role === 'user';
                    const text = typeof message.content_json?.text === 'string' ? message.content_json.text : '';
                    const attachments = readMessageAttachmentPreviews(message);
                    const selectedExperiencePreviews = readMessageSelectedExperiences(message);
                    const selectedResumePreview = readMessageSelectedResume(message);
                    return (
                      <MessageItem
                        key={message.id}
                        isUser={isUser}
                        content={text}
                        attachments={attachments}
                        selectedExperiences={selectedExperiencePreviews}
                        selectedResume={selectedResumePreview}
                      />
                    );
                  })}
                  {isLoadingDetail ? (
                    <div className="py-4 text-center text-sm text-slate-400 dark:text-slate-500">正在加载会话...</div>
                  ) : null}
                  {activeThought ? (
                     <ActiveThoughtBlock thought={activeThought} />
                  ) : null}
                  {!activeThought && latestSuggestedFollowups.length > 0 ? (
                    <div className="mb-6 flex flex-wrap justify-center gap-2">
                      {latestSuggestedFollowups.map((item) => (
                        <button
                          key={`${item.skillId}-${item.label}`}
                          type="button"
                          onClick={() => handleSelectSkillFollowup(item.skillId, item.prompt)}
                          className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm transition hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:text-white"
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              )}
            </div>

            <div
              ref={composerContainerRef}
              className="pointer-events-none absolute inset-x-0 bottom-0 z-20 overflow-visible px-3 pb-[calc(env(safe-area-inset-bottom,0px)+12px)] pt-4 md:px-7 md:pb-6 md:pt-5"
            >
              <div className="pointer-events-auto relative z-10 mx-auto w-full max-w-3xl">
                <input
                  ref={attachmentInputRef}
                  type="file"
                  className="hidden"
                  accept={ASSISTANT_ATTACHMENT_ACCEPT_ATTR}
                  multiple
                  onChange={handleAttachmentSelect}
                />
                {draftCardCount > 0 ? (
                  <div className="mb-2 md:hidden">
                    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white/95 shadow-[0_18px_50px_-34px_rgba(15,23,42,0.55)] backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
                      <button
                        type="button"
                        onClick={() => setIsMobileDraftTrayOpen((current) => !current)}
                        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                        title={isMobileDraftTrayOpen ? '收起草稿' : '展开草稿'}
                      >
                        <span className="inline-flex min-w-0 items-center gap-2">
                          <span className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">草稿</span>
                          <span className="inline-flex min-w-6 shrink-0 items-center justify-center rounded-full bg-emerald-50 px-2 text-xs font-semibold leading-6 text-emerald-700 ring-1 ring-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-500/20">
                            {draftCardCount}
                          </span>
                        </span>
                        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-200">
                          {isMobileDraftTrayOpen ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronUp className="h-4 w-4" />
                          )}
                        </span>
                      </button>
                      <div
                        className={`grid transition-all duration-300 ease-out ${
                          isMobileDraftTrayOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
                        }`}
                      >
                        <div className="min-h-0 overflow-hidden">
                          <div className="max-h-[44vh] space-y-3 overflow-y-auto border-t border-slate-100 px-3 pb-3 dark:border-slate-800">
                            {visibleDraftGroups.map((group, index) => renderDraftGroup(group, index, 'mobile'))}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}
                <ChatInputBox
                  value={inputValue}
                  onChange={setInputValue}
                  onSubmit={() => void handleSubmit()}
                  isSending={isSending}
                  placeholder={selectedSession ? '继续描述细节或调整内容...' : '例如：我想整理一段校园运营经历，但现在内容很乱。'}
                  plusActions={[
                    { key: 'pick-resume', label: '选择简历', onClick: () => void openResumePicker() },
                    { key: 'pick-experience', label: '选择经历', onClick: () => void openExperiencePicker() },
                    { key: 'upload-attachment', label: '上传附件', onClick: openAttachmentPicker },
                  ]}
                  attachments={composerAttachments}
                  onAddAttachments={(files) => appendComposerAttachments(files, 'drop')}
                  onRemoveAttachment={removeComposerAttachment}
                  selectedResume={selectedResume}
                  onRemoveSelectedResume={() => {
                    if (!selectedSessionIdRef.current) {
                      const draftLaunchRequest = draftLaunchRequestRef.current;
                      if (draftLaunchRequest) {
                        draftLaunchRequestRef.current = {
                          ...draftLaunchRequest,
                          prefillResume: null,
                        };
                      } else {
                        suppressAutoSelectSessionRef.current = false;
                      }
                    }
                    persistDraftSelectedResume(selectedSessionIdRef.current, null);
                    clearSelectedResume();
                  }}
                  selectedExperiences={selectedExperiences}
                  onRemoveSelectedExperience={(masterId) => {
                    setSelectedExperiences((current) => current.filter((item) => item.masterId !== masterId));
                  }}
                />
              </div>
            </div>
          </main>
          {draftCardCount > 0 && !isDraftPanelOpen ? (
            <button
              type="button"
              onClick={() => setIsDraftPanelOpen(true)}
              className="fixed right-5 top-5 z-40 hidden h-12 w-12 items-center justify-center rounded-2xl border border-slate-200 bg-white/95 text-slate-600 shadow-[0_18px_45px_-24px_rgba(15,23,42,0.45)] backdrop-blur transition hover:border-slate-300 hover:bg-white hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-slate-800 dark:hover:text-white md:inline-flex"
              title="展开草稿"
            >
              <FileBadge2 className="h-5 w-5" />
              <span className="absolute -right-1 -top-1 inline-flex min-w-5 items-center justify-center rounded-full bg-emerald-500 px-1.5 text-[11px] font-semibold leading-5 text-white">
                {draftCardCount}
              </span>
            </button>
          ) : null}
          {draftCardCount > 0 ? (
            <aside
              aria-hidden={!isDraftPanelOpen}
              className={`hidden shrink-0 overflow-hidden bg-white/95 text-slate-900 shadow-[-18px_0_50px_-36px_rgba(15,23,42,0.32)] transition-[width,opacity,transform,border-color] duration-300 ease-out dark:bg-slate-950/95 dark:text-slate-100 md:flex md:flex-col ${
                isDraftPanelOpen
                  ? 'w-[400px] translate-x-0 border-l border-slate-200/90 opacity-100 dark:border-slate-800'
                  : 'pointer-events-none w-0 translate-x-8 border-l-0 opacity-0'
              }`}
            >
              <div className="flex h-full w-[400px] min-w-[400px] flex-col">
                <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-4 dark:border-slate-800">
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-500">Drafts</div>
                    <div className="mt-1 truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                      草稿
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setIsDraftPanelOpen(false)}
                      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-600 transition hover:bg-slate-200 hover:text-slate-900 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                      title="收起草稿"
                    >
                      <PanelRightClose className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 pb-6 pt-1">
                  {visibleDraftGroups.map((group, index) => renderDraftGroup(group, index))}
                </div>
              </div>
            </aside>
          ) : null}
        </>
      )}
    </div>
  );
};

export default AIAssistant;
