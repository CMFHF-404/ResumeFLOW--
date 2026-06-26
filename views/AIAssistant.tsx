import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLogto } from '@logto/react';
import {
  Bot,
  PanelLeft,
} from 'lucide-react';
import UnAuthPrompt from '../components/UnAuthPrompt';
import { ToastContainer, useToast } from '../components/Toast';
import ConfirmDialog from '../components/ConfirmDialog';
import { MAX_ASSISTANT_SELECTED_EXPERIENCES, type AssistantDraftApplyNavigation, type AssistantMode, type AssistantSelectedExperience, type AssistantSelectedResume, type AssistantSkillId } from '../services/aiService';
import { formatRelativeTime } from '../utils/timeUtils';
import {
  readPendingAssistantManualSaveDrafts,
} from './assistantManualSaveStorage';

import { AssistantDesktopDraftPanel, AssistantMobileDraftTray } from './AIAssistant/AssistantDraftPanel';
import { AssistantHistoryPanel } from './AIAssistant/AssistantHistoryPanel';
import { AssistantSkillPresetPanel } from './AIAssistant/AssistantSkillPresetPanel';
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
  attachDraftJumpHandlers,
} from './AIAssistant/draftJumpUtils';
import { useAssistantComposerResize } from './AIAssistant/useAssistantComposerResize';
import type {
  AssistantLaunchRequest,
} from './AIAssistant/types';

type AIAssistantProps = {
  pendingLaunchRequest?: AssistantLaunchRequest | null;
  onConsumeLaunchRequest?: (requestId?: string) => void;
  onJumpToResumeEditor?: (resumeId?: string, targetId?: string) => void;
  onJumpToExperienceBank?: (category?: AssistantDraftApplyNavigation['category'], targetId?: string) => void;
  draftInput?: string;
  onDraftInputChange?: (value: string) => void;
};

const AIAssistant: React.FC<AIAssistantProps> = ({
  pendingLaunchRequest,
  onConsumeLaunchRequest,
  onJumpToResumeEditor,
  onJumpToExperienceBank,
  draftInput = '',
  onDraftInputChange,
}) => {
  const { isAuthenticated } = useLogto();
  const { toasts, success, error, loading, updateToast, closeToast } = useToast();
  const [inputValue, setInputValue] = useState(draftInput);
  const [activeComposerSkillId, setActiveComposerSkillId] = useState<AssistantSkillId | null>(null);
  const [lastAssistantSkillId, setLastAssistantSkillId] = useState<AssistantSkillId | null>(null);
  const [activeThought, setActiveThought] = useState<string>('');
  const [draftDeepThinkingEnabled, setDraftDeepThinkingEnabled] = useState(false);
  const [deepThinkingBySessionId, setDeepThinkingBySessionId] = useState<Record<string, boolean>>({});
  const [applyingMessageIds, setApplyingMessageIds] = useState<Set<string>>(new Set());
  const [manualSaveMessageIds, setManualSaveMessageIds] = useState<Set<string>>(new Set());
  const [selectedResume, setSelectedResume] = useState<AssistantSelectedResume | null>(null);
  const [selectedExperiences, setSelectedExperiences] = useState<AssistantSelectedExperience[]>([]);
  const [isMobileHistoryOpen, setIsMobileHistoryOpen] = useState(false);
  const [isDesktopHistoryCollapsed, setIsDesktopHistoryCollapsed] = useState(false);
  const {
    messageViewportRef,
    composerContainerRef,
    composerReservedHeight,
    scrollToBottom,
  } = useAssistantComposerResize();
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

  const lastMirroredDraftInputRef = useRef(draftInput);

  const clearSelectedExperiences = useCallback(() => {
    setSelectedExperiences([]);
  }, []);

  const clearSelectedResume = useCallback(() => {
    setSelectedResume(null);
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
  const isDeepThinkingEnabled = selectedSessionId
    ? Boolean(deepThinkingBySessionId[selectedSessionId])
    : draftDeepThinkingEnabled;
  const handleDeepThinkingChange = useCallback((enabled: boolean) => {
    if (selectedSessionId) {
      setDeepThinkingBySessionId((current) => ({
        ...current,
        [selectedSessionId]: enabled,
      }));
      return;
    }
    setDraftDeepThinkingEnabled(enabled);
  }, [selectedSessionId]);
  const draftMessageItems = useMemo<AssistantDraftMessageItem[]>(() => (
    attachDraftJumpHandlers(
      deriveDraftMessageItems(messages, selectedSession, callbackOnlySessionIdsRef.current),
      {
        selectedSession,
        onJumpToResumeEditor,
        onJumpToExperienceBank,
        markManualSaveMessage: (messageId) => {
          setManualSaveMessageIds((prev) => new Set(prev).add(messageId));
        },
        notifyError: (message) => error(message, 6000),
      }
    )
  ), [callbackOnlySessionIdsRef, error, messages, onJumpToExperienceBank, onJumpToResumeEditor, selectedSession]);
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
    const enableThinking = isDeepThinkingEnabled;
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
      setDeepThinkingBySessionId((current) => ({
        ...current,
        [created.id]: enableThinking,
      }));
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
        enableThinking,
        attachments: composerAttachments,
        selectedExperiences,
        selectedResume,
      },
      activeMode,
    );
  }, [activeComposerSkillId, composerAttachments, handleCreateSession, inputValue, isDeepThinkingEnabled, selectedExperiences, selectedResume, selectedSession?.mode, selectedSessionId, sendMessage]);

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
                <AssistantSkillPresetPanel
                  activeSkillId={activeComposerSkillId}
                  onSelectPreset={handleSelectSkillPreset}
                />
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
                  isDeepThinkingEnabled={isDeepThinkingEnabled}
                  onDeepThinkingChange={handleDeepThinkingChange}
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
