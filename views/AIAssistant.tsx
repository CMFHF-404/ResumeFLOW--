import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLogto } from '@logto/react';
import {
  Bot,
  FileBadge2,
  Lightbulb,
  PanelLeft,
  Sparkles,
  Wrench,
} from 'lucide-react';
import UnAuthPrompt from '../components/UnAuthPrompt';
import { ToastContainer, useToast } from '../components/Toast';
import ConfirmDialog from '../components/ConfirmDialog';
import { MAX_ASSISTANT_SELECTED_EXPERIENCES, type AssistantMode, type AssistantSelectedExperience, type AssistantSelectedResume, type AssistantSkillId } from '../services/aiService';
import { formatRelativeTime } from '../utils/timeUtils';
import {
  readPendingAssistantManualSaveDrafts,
  writePendingAssistantManualSaveDraft,
} from './assistantManualSaveStorage';

import { AssistantDesktopDraftPanel, AssistantMobileDraftTray } from './AIAssistant/AssistantDraftPanel';
import { AssistantHistoryPanel } from './AIAssistant/AssistantHistoryPanel';
import ExperiencePicker from './AIAssistant/ExperiencePicker';
import ResumePicker from './AIAssistant/ResumePicker';
import { MessageItem, ActiveThoughtBlock } from './AIAssistant/MessageItem';
import { ChatInputBox } from './AIAssistant/ChatInputBox';
import {
  ASSISTANT_ATTACHMENT_ACCEPT_ATTR,
  readMessageAttachmentPreviews,
} from './AIAssistant/attachmentUtils';
import { useAssistantComposerAttachments } from './AIAssistant/useAssistantComposerAttachments';
import { useAssistantDraftApplyActions } from './AIAssistant/useAssistantDraftApplyActions';
import { useAssistantDraftPanelState } from './AIAssistant/useAssistantDraftPanelState';
import { useAssistantHistoryActions } from './AIAssistant/useAssistantHistoryActions';
import { useAssistantLaunchBootstrap } from './AIAssistant/useAssistantLaunchBootstrap';
import { useAssistantMessageSending } from './AIAssistant/useAssistantMessageSending';
import { useAssistantResourcePickers } from './AIAssistant/useAssistantResourcePickers';
import { useAssistantSessionController } from './AIAssistant/useAssistantSessionController';
import {
  readMessageSelectedExperiences,
  readMessageSelectedResume,
} from './AIAssistant/selectionUtils';
import {
  deriveDraftMessageItems,
  deriveLatestSuggestedFollowups,
} from './AIAssistant/messageDerivationUtils';
import {
  groupDraftItems,
  isPendingLatestPreview,
  type AssistantDraftMessageItem,
} from './AIAssistant/sessionUtils';
import {
  ASSISTANT_MODE_HINTS,
  readContextString,
  resolveSessionHint,
} from './AIAssistant/sessionContextUtils';
import {
  extractApplyErrorDetails,
} from './AIAssistant/logUtils';
import { computeComposerReservedHeight } from './AIAssistant/layoutUtils';
import {
  buildResumeEditorDraftJumpState,
} from './AIAssistant/draftApplyUtils';
import type {
  AssistantLaunchRequest,
} from './AIAssistant/types';

type AIAssistantProps = {
  pendingLaunchRequest?: AssistantLaunchRequest | null;
  onConsumeLaunchRequest?: (requestId?: string) => void;
  onJumpToResumeEditor?: (resumeId?: string) => void;
  draftInput?: string;
  onDraftInputChange?: (value: string) => void;
};

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
    hint: ASSISTANT_MODE_HINTS.general,
    icon: (
      <div className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-600 dark:text-emerald-400">
        <Bot className="h-3.5 w-3.5" />
      </div>
    ),
  },
  experience: {
    label: '经历整理',
    hint: ASSISTANT_MODE_HINTS.experience,
    icon: <Sparkles className="h-4 w-4" />,
  },
  certification: {
    label: '证书整理',
    hint: ASSISTANT_MODE_HINTS.certification,
    icon: <FileBadge2 className="h-4 w-4" />,
  },
  skill: {
    label: '技能整理',
    hint: ASSISTANT_MODE_HINTS.skill,
    icon: <Wrench className="h-4 w-4" />,
  },
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
  const [inputValue, setInputValue] = useState(draftInput);
  const [activeComposerSkillId, setActiveComposerSkillId] = useState<AssistantSkillId | null>(null);
  const [lastAssistantSkillId, setLastAssistantSkillId] = useState<AssistantSkillId | null>(null);
  const [activeThought, setActiveThought] = useState<string>('');
  const [applyingMessageIds, setApplyingMessageIds] = useState<Set<string>>(new Set());
  const [manualSaveMessageIds, setManualSaveMessageIds] = useState<Set<string>>(new Set());
  const [selectedResume, setSelectedResume] = useState<AssistantSelectedResume | null>(null);
  const [selectedExperiences, setSelectedExperiences] = useState<AssistantSelectedExperience[]>([]);
  const [isMobileHistoryOpen, setIsMobileHistoryOpen] = useState(false);
  const [isDesktopHistoryCollapsed, setIsDesktopHistoryCollapsed] = useState(false);
  const [composerReservedHeight, setComposerReservedHeight] = useState(160);
  const messageViewportRef = useRef<HTMLDivElement | null>(null);
  const composerContainerRef = useRef<HTMLDivElement | null>(null);
  const {
    composerAttachments,
    attachmentInputRef,
    clearComposerAttachments,
    clearComposerAttachmentsIfMatches,
    restoreComposerAttachmentsIfEmpty,
    appendComposerAttachments,
    removeComposerAttachment,
    handleAttachmentSelect,
    openAttachmentPicker,
  } = useAssistantComposerAttachments({ onError: error });

  const composerHeightRef = useRef<number | null>(null);
  const lastMirroredDraftInputRef = useRef(draftInput);

  const clearSelectedExperiences = useCallback(() => {
    setSelectedExperiences([]);
  }, []);

  const clearSelectedResume = useCallback(() => {
    setSelectedResume(null);
  }, []);

  const scrollToBottom = useCallback(() => {
    if (!messageViewportRef.current) {
      return;
    }
    messageViewportRef.current.scrollTop = messageViewportRef.current.scrollHeight;
  }, []);

  const {
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
  } = useAssistantSessionController({
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
  });

  const latestSuggestedFollowups = useMemo(() => {
    return deriveLatestSuggestedFollowups(messages);
  }, [messages]);
  const draftMessageItems = useMemo<AssistantDraftMessageItem[]>(() => (
    deriveDraftMessageItems(messages, selectedSession, callbackOnlySessionIdsRef.current).map((item) => {
      const { message, card, isManualSaveMode } = item;
      const onJumpToEditor = isManualSaveMode
        ? () => {
          const context = selectedSession?.context_json ?? {};
          const contextResumeId = readContextString(context, 'resumeId');
          if (card.type === 'experience') {
            try {
              const { resumeId, pendingManualSaveDraft } = buildResumeEditorDraftJumpState({
                sessionId: selectedSession?.id ?? '',
                messageId: message.id,
                context,
                draft: card.data,
                createdAt: Date.now(),
              });
              if (pendingManualSaveDraft) {
                writePendingAssistantManualSaveDraft(pendingManualSaveDraft);
                setManualSaveMessageIds((prev) => new Set(prev).add(message.id));
              }
              onJumpToResumeEditor?.(resumeId ?? undefined);
            } catch (jumpError) {
              const jumpErrorDetails = extractApplyErrorDetails(jumpError);
              error(`无法跳转到编辑区：${jumpErrorDetails.userMessage}`, 6000);
            }
            return;
          }
          onJumpToResumeEditor?.(contextResumeId ?? undefined);
        }
        : undefined;
      return { message, card, isManualSaveMode, onJumpToEditor };
    })
  ), [callbackOnlySessionIdsRef, error, messages, onJumpToResumeEditor, selectedSession]);
  const draftGroups = useMemo(
    () => groupDraftItems(draftMessageItems),
    [draftMessageItems]
  );
  const {
    draftCardCount,
    isDraftPanelOpen,
    setIsDraftPanelOpen,
    isMobileDraftTrayOpen,
    setIsMobileDraftTrayOpen,
    draftExpandedByGroupId,
    setDraftExpandedByGroupId,
    getDraftVersionState,
  } = useAssistantDraftPanelState(draftGroups, selectedSessionId);

  const {
    pickerExperiences,
    isExperiencePickerOpen,
    setIsExperiencePickerOpen,
    isLoadingPickerExperiences,
    openExperiencePicker,
    pickerResumes,
    isResumePickerOpen,
    setIsResumePickerOpen,
    isLoadingPickerResumes,
    isApplyingPickerResume,
    openResumePicker,
    handleConfirmSelectedResume,
  } = useAssistantResourcePickers({
    selectedSessionIdRef,
    suppressAutoSelectSessionRef,
    draftLaunchRequestRef,
    persistDraftSelectedResume,
    setSelectedResume,
    error,
  });

  useEffect(() => {
    if (!isAuthenticated) {
      setIsMobileHistoryOpen(false);
    }
  }, [isAuthenticated]);

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

  const {
    isSending,
    sendMessage,
  } = useAssistantMessageSending({
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
  });
  const shouldShowSkillPresetPanel = !isLoadingSessions
    && !isLoadingDetail
    && messages.length === 0
    && !activeThought
    && !isSending;

  useAssistantLaunchBootstrap({
    pendingLaunchRequest,
    isAuthenticated,
    suppressAutoSelectSessionRef,
    applyHandlerMapRef,
    callbackOnlySessionIdsRef,
    onConsumeLaunchRequest,
    createSessionRecord,
    commitCreatedSession,
    cleanupSupersededSession,
    sendMessage,
    resetForDraftLaunch,
    error,
  });

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

  const { handleApplyDraft } = useAssistantDraftApplyActions({
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
  });

  const {
    deleteConfirmId,
    setDeleteConfirmId,
    isDeletingSession,
    handleNewChat,
    handleSelectSession,
    handleDeleteSession,
    executeDeleteSession,
    handleRenameSession,
  } = useAssistantHistoryActions({
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
  });

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
          <AssistantHistoryPanel
            sessions={sessions}
            selectedSessionId={selectedSessionId}
            isDesktopHistoryCollapsed={isDesktopHistoryCollapsed}
            setIsDesktopHistoryCollapsed={setIsDesktopHistoryCollapsed}
            isMobileHistoryOpen={isMobileHistoryOpen}
            setIsMobileHistoryOpen={setIsMobileHistoryOpen}
            onNewChat={() => void handleNewChat('general')}
            onSelectDesktopSession={handleSelectSession}
            onSelectMobileSession={handleSelectSession}
            onRenameSession={(event, session) => void handleRenameSession(event, session)}
            onDeleteSession={(event, sessionId) => void handleDeleteSession(event, sessionId)}
          />

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
                <AssistantMobileDraftTray
                  draftGroups={draftGroups}
                  draftCardCount={draftCardCount}
                  isMobileDraftTrayOpen={isMobileDraftTrayOpen}
                  setIsMobileDraftTrayOpen={setIsMobileDraftTrayOpen}
                  draftExpandedByGroupId={draftExpandedByGroupId}
                  setDraftExpandedByGroupId={setDraftExpandedByGroupId}
                  getDraftVersionState={getDraftVersionState}
                  appliedMessageIds={appliedMessageIds}
                  manualSaveMessageIds={manualSaveMessageIds}
                  applyingMessageIds={applyingMessageIds}
                  onApplyDraft={(item) => void handleApplyDraft(item.message.id, item.card)}
                />
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
          <AssistantDesktopDraftPanel
            draftGroups={draftGroups}
            draftCardCount={draftCardCount}
            isDraftPanelOpen={isDraftPanelOpen}
            setIsDraftPanelOpen={setIsDraftPanelOpen}
            draftExpandedByGroupId={draftExpandedByGroupId}
            setDraftExpandedByGroupId={setDraftExpandedByGroupId}
            getDraftVersionState={getDraftVersionState}
            appliedMessageIds={appliedMessageIds}
            manualSaveMessageIds={manualSaveMessageIds}
            applyingMessageIds={applyingMessageIds}
            onApplyDraft={(item) => void handleApplyDraft(item.message.id, item.card)}
          />
        </>
      )}
    </div>
  );
};

export default AIAssistant;
