import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import {
  UploadCloud,
  Download,
  Briefcase,
  FolderKanban,
  Wrench,
  Bot,
  Sparkles,
  User,
  Mail,
  Phone,
  MapPin,
  Link as LinkIcon,
  FileText,
  Wand2,
} from 'lucide-react';
import { ImageCropModal, ProfileAvatarZone } from '../components/ImageCropModal';
import ResumeUploadModal from '../components/ResumeUploadModal';
import { ToastContainer, useToast } from '../components/Toast';
import UnAuthPrompt from '../components/UnAuthPrompt';
import { devLog } from '../services/devLogger';
import type { Profile } from '../services/profileService';
import type { AssistantDraftApplyNavigation } from '../services/aiService';
import { experienceService } from '../services/experienceService';
import { useEducationManager } from '../hooks/useEducationManager';
import EducationSection from './EducationSection';
import ExperienceSection from './ExperienceSection';
import CertificationSection from './CertificationSection';
import SkillsSection from './SkillsSection';
import AIAssistant from './AIAssistant';
import type { AssistantLaunchRequest } from './AIAssistant/types';
import { useExperienceBankProfile } from './ExperienceBank/useExperienceBankProfile';
import { buildExperienceBankSummaryPayload } from './ExperienceBank/summaryPayloadUtils';
import {
  readPendingAssistantLaunch,
  readPendingResumeUpload,
  writePendingAssistantLaunch,
  writePendingResumeUpload,
} from './ExperienceBank/pendingActionStorage';
import {
  loadExperienceBankExportSnapshot,
  loadExperienceBankValidationSnapshot,
} from './ExperienceBank/exportSnapshotLoaders';
import { useExperienceBankPdfExport } from './ExperienceBank/useExperienceBankPdfExport';

type ExperienceBankFocusRequest = {
  requestId: number;
  category?: AssistantDraftApplyNavigation['category'];
  targetId?: string;
};

const EXPERIENCE_BANK_ASSISTANT_SIDEBAR_WIDTH = '390px';
const EXPERIENCE_BANK_DESKTOP_ASSISTANT_MEDIA_QUERY = '(min-width: 768px)';

const buildExperienceBankAssistantRequest = (): AssistantLaunchRequest => ({
  context: {
    mode: 'general',
    entrySource: 'direct',
    title: '经历库 · AI 助手',
    contextJson: {
      origin: 'experience_bank_header',
    },
  },
});

const buildEmptyStateAssistantRequest = (): AssistantLaunchRequest => ({
  context: {
    mode: 'general',
    entrySource: 'experience_bank',
    title: '经历库 · AI 从 0 到 1 写简历',
    contextJson: {
      origin: 'experience_bank_empty_state',
    },
  },
  initialUserMessage: '我还没有现成简历，请作为简历教练一步步引导我从 0 到 1 梳理教育、项目、实习或工作经历，并最终帮我产出可录入经历库和继续编辑简历的内容。',
});

interface ExperienceBankProps {
  isAuthenticated: boolean;
  onRequireAuth: () => void | Promise<void>;
  cachedProfile?: Profile;
  onProfileUpdate?: (data: Profile) => void;
  shouldOpenResumeUpload?: boolean; // 是否自动打开简历上传弹窗
  onLaunchAssistant?: (request: AssistantLaunchRequest) => void;
  onOpenAssistantSession?: (sessionId: string) => void;
  onJumpToResumeEditor?: (resumeId?: string, targetId?: string) => void;
  focusRequest?: ExperienceBankFocusRequest | null;
}

const ExperienceBank: React.FC<ExperienceBankProps> = ({
  isAuthenticated,
  onRequireAuth,
  cachedProfile,
  onProfileUpdate,
  shouldOpenResumeUpload = false,
  onLaunchAssistant,
  onOpenAssistantSession,
  onJumpToResumeEditor,
  focusRequest,
}) => {
  const [isResumeModalOpen, setIsResumeModalOpen] = useState(false);
  const [isAssistantSidebarOpen, setIsAssistantSidebarOpen] = useState(false);
  const [assistantSidebarLaunchRequest, setAssistantSidebarLaunchRequest] = useState<AssistantLaunchRequest | null>(null);
  const [assistantFocusRequest, setAssistantFocusRequest] = useState<ExperienceBankFocusRequest | null>(null);
  const assistantSidebarLaunchRequestIdRef = useRef(0);
  const assistantFocusRequestIdRef = useRef(focusRequest?.requestId ?? 0);

  const handleSignIn = useCallback(async () => {
    await onRequireAuth();
  }, [onRequireAuth]);

  const handleImportResumeClick = useCallback(async () => {
    if (!isAuthenticated) {
      writePendingResumeUpload(true);
      await handleSignIn();
      return;
    }
    writePendingResumeUpload(false);
    setIsResumeModalOpen(true);
  }, [handleSignIn, isAuthenticated]);

  const handleLaunchExperienceBankAssistant = useCallback((request: AssistantLaunchRequest) => {
    const shouldOpenSidebar = typeof window !== 'undefined'
      && window.matchMedia(EXPERIENCE_BANK_DESKTOP_ASSISTANT_MEDIA_QUERY).matches;

    if (!shouldOpenSidebar) {
      onLaunchAssistant?.(request);
      return;
    }

    assistantSidebarLaunchRequestIdRef.current += 1;
    setAssistantSidebarLaunchRequest({
      ...request,
      requestId: `experience-bank-sidebar-launch-${assistantSidebarLaunchRequestIdRef.current}`,
    });
    setIsAssistantSidebarOpen(true);
  }, [onLaunchAssistant]);

  const handleCloseAssistantSidebar = useCallback(() => {
    setAssistantSidebarLaunchRequest(null);
    setIsAssistantSidebarOpen(false);
  }, []);

  const handleLaunchHeaderAssistant = useCallback(() => {
    if (isAssistantSidebarOpen) {
      handleCloseAssistantSidebar();
      return;
    }
    handleLaunchExperienceBankAssistant(buildExperienceBankAssistantRequest());
  }, [handleCloseAssistantSidebar, handleLaunchExperienceBankAssistant, isAssistantSidebarOpen]);

  const launchEmptyStateAssistant = useCallback(() => {
    handleLaunchExperienceBankAssistant(buildEmptyStateAssistantRequest());
  }, [handleLaunchExperienceBankAssistant]);

  const handleConsumeAssistantSidebarLaunchRequest = useCallback((requestId?: string) => {
    setAssistantSidebarLaunchRequest((current) => {
      if (!current) {
        return current;
      }
      if (requestId && current.requestId !== requestId) {
        return current;
      }
      return null;
    });
  }, []);

  const { toasts, success, error: toastError, info, loading, updateToast, closeToast } = useToast();
  const [experienceRefreshSignal, setExperienceRefreshSignal] = useState(0);
  const [workExperienceCount, setWorkExperienceCount] = useState<number | null>(() => {
    if (!isAuthenticated) {
      return 0;
    }
    const cached = experienceService.peekList('work');
    return cached ? cached.length : null;
  });
  const [projectExperienceCount, setProjectExperienceCount] = useState<number | null>(() => {
    if (!isAuthenticated) {
      return 0;
    }
    const cached = experienceService.peekList('project');
    return cached ? cached.length : null;
  });
  const [educationExperienceCount, setEducationExperienceCount] = useState<number | null>(() => {
    if (!isAuthenticated) {
      return 0;
    }
    const cached = experienceService.peekList('education');
    return cached ? cached.length : null;
  });

  const toastApi = useMemo(
    () => ({ success, error: toastError, info, loading, updateToast }),
    [success, toastError, info, loading, updateToast]
  );

  const education = useEducationManager(toastApi, { isAuthenticated, onRequireAuth: handleSignIn });
  const { refreshEducation } = education;
  const effectiveFocusRequest = assistantFocusRequest
    && (!focusRequest || assistantFocusRequest.requestId >= focusRequest.requestId)
    ? assistantFocusRequest
    : focusRequest;

  const handleAssistantJumpToExperienceBank = useCallback((
    category?: AssistantDraftApplyNavigation['category'],
    targetId?: string
  ) => {
    assistantFocusRequestIdRef.current = Math.max(
      assistantFocusRequestIdRef.current,
      focusRequest?.requestId ?? 0
    ) + 1;
    setAssistantFocusRequest({
      requestId: assistantFocusRequestIdRef.current,
      category,
      targetId,
    });
  }, [focusRequest]);

  const handleAssistantDraftAppliedNavigation = useCallback((
    navigation: AssistantDraftApplyNavigation | null | undefined
  ) => {
    if (!navigation || navigation.targetView === 'experience_bank') {
      handleAssistantJumpToExperienceBank(navigation?.category, navigation?.targetId);
    }
  }, [handleAssistantJumpToExperienceBank]);

  const handleExpandAssistantSidebar = useCallback((sessionId?: string | null) => {
    if (sessionId && onOpenAssistantSession) {
      onOpenAssistantSession(sessionId);
      return;
    }
    onLaunchAssistant?.(buildExperienceBankAssistantRequest());
  }, [onLaunchAssistant, onOpenAssistantSession]);

  const {
    isLoadingProfile,
    isSavingProfile,
    isEditingProfile,
    name,
    email,
    phone,
    location,
    link,
    summary,
    summaryText,
    summaryPreview,
    isSummaryExpanded,
    setIsSummaryExpanded,
    avatarDataUrl,
    isCropModalOpen,
    pendingImageSrc,
    avatarFileInputRef,
    isGeneratingSummary,
    isAvatarInteractionEnabled,
    buildCurrentProfileDraftSnapshot,
    handleEditProfile,
    handleCancelProfile,
    handleSaveProfile,
    handleResumeImported: handleProfileResumeImported,
    handleGenerateSummary,
    handleSummaryChange,
    handleNameChange,
    handleEmailChange,
    handlePhoneChange,
    handleLocationChange,
    handleLinkChange,
    handleAvatarUploadClick,
    handleFileSelected,
    handleCropConfirm,
    handleAvatarDelete,
    handleCropCancel,
  } = useExperienceBankProfile({
    isAuthenticated,
    onRequireAuth: handleSignIn,
    cachedProfile,
    onProfileUpdate,
    refreshEducation,
    loadExportSnapshot: loadExperienceBankExportSnapshot,
    loadValidationSnapshot: loadExperienceBankValidationSnapshot,
    buildSummaryPayload: buildExperienceBankSummaryPayload,
    success,
    toastError,
    loading,
    updateToast,
    closeToast,
  });

  const {
    isExportingPdf,
    handleExportAll,
  } = useExperienceBankPdfExport({
    buildCurrentProfileDraftSnapshot,
    loading,
    updateToast,
  });

  const handleExportAllClick = useCallback(() => {
    if (!isAuthenticated) {
      void handleSignIn();
      return;
    }
    void handleExportAll();
  }, [handleExportAll, handleSignIn, isAuthenticated]);

  const handleResumeImported = useCallback(async (
    ...args: Parameters<typeof handleProfileResumeImported>
  ) => {
    setExperienceRefreshSignal((prev) => prev + 1);
    await handleProfileResumeImported(...args);
  }, [handleProfileResumeImported]);

  useEffect(() => {
    if (shouldOpenResumeUpload) {
      devLog('[ExperienceBank] 自动打开简历上传弹窗');
      void handleImportResumeClick();
    }
  }, [handleImportResumeClick, shouldOpenResumeUpload]);

  useEffect(() => {
    if (!effectiveFocusRequest) {
      return;
    }
    setExperienceRefreshSignal((prev) => prev + 1);
    if (effectiveFocusRequest.category === 'education') {
      void refreshEducation();
    }
  }, [effectiveFocusRequest, refreshEducation]);

  useEffect(() => {
    if (!isAuthenticated || !readPendingResumeUpload()) {
      return;
    }
    devLog('[ExperienceBank] 恢复待执行的简历导入动作');
    writePendingResumeUpload(false);
    setIsResumeModalOpen(true);
  }, [isAuthenticated]);

  const handleLaunchEmptyStateAssistant = useCallback(async () => {
    if (!isAuthenticated) {
      writePendingAssistantLaunch(true);
      await handleSignIn();
      return;
    }
    writePendingAssistantLaunch(false);
    launchEmptyStateAssistant();
  }, [handleSignIn, isAuthenticated, launchEmptyStateAssistant]);

  useEffect(() => {
    if (!isAuthenticated || !readPendingAssistantLaunch()) {
      return;
    }
    devLog('[ExperienceBank] 恢复待执行的 AI 助手启动动作');
    writePendingAssistantLaunch(false);
    launchEmptyStateAssistant();
  }, [isAuthenticated, launchEmptyStateAssistant]);

  const isExperienceBankEmpty = workExperienceCount === 0
    && projectExperienceCount === 0
    && educationExperienceCount === 0;
  const assistantHeaderButtonLabel = isAssistantSidebarOpen ? '关闭 AI 助手' : '打开 AI 助手';

  return (
    <div className="flex-1 flex h-full min-h-0 overflow-hidden bg-gray-50 dark:bg-gray-900/50">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <header className="hidden bg-surface-light dark:bg-surface-dark border-b border-border-light dark:border-border-dark px-4 py-3 shrink-0 z-20 md:block md:px-8">
        <div className="flex flex-col gap-3 md:h-10 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-3 md:gap-4">
          <div className="flex items-center gap-2 text-primary hover:opacity-80 transition-opacity cursor-pointer">
            <img
              src="/logo-mark-128.png"
              alt="原子简历 favicon"
              className="h-8 w-8 object-contain"
            />
            <span className="font-bold text-lg tracking-tight text-gray-900 dark:text-white md:text-xl">原子简历</span>
          </div>
          <div className="hidden h-6 w-px bg-border-light dark:bg-border-dark md:block"></div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-gray-500 sm:text-sm">经历库</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 md:justify-end md:gap-4">
          <UnAuthPrompt />
          <button
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-emerald-100 bg-emerald-50 text-emerald-700 transition-colors hover:border-emerald-200 hover:bg-emerald-100 hover:text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300 dark:hover:bg-emerald-900/40"
            onClick={() => void handleLaunchHeaderAssistant()}
            title={assistantHeaderButtonLabel}
            aria-label={assistantHeaderButtonLabel}
            type="button"
          >
            <Bot className="h-4 w-4" />
            <span className="sr-only">{assistantHeaderButtonLabel}</span>
          </button>
          <button
            className="flex items-center gap-2 rounded-lg border border-transparent px-3 py-2 text-xs font-medium text-gray-600 transition-colors hover:border-gray-200 hover:bg-gray-100 dark:text-gray-300 dark:hover:border-gray-700 dark:hover:bg-gray-800 sm:px-4 sm:text-sm"
            onClick={handleImportResumeClick}
            type="button"
          >
            <UploadCloud className="w-4 h-4" />
            导入简历
          </button>
          <button
            className="flex items-center gap-2 rounded-lg border border-transparent px-3 py-2 text-xs font-medium text-gray-600 transition-colors hover:border-gray-200 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60 dark:text-gray-300 dark:hover:border-gray-700 dark:hover:bg-gray-800 sm:px-4 sm:text-sm"
            onClick={handleExportAllClick}
            disabled={isExportingPdf || isLoadingProfile}
            type="button"
          >
            <Download className="w-4 h-4" />
            {isExportingPdf ? '导出中...' : '导出全部'}
          </button>
        </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-4 scroll-smooth md:p-8">
        <div className="max-w-5xl mx-auto space-y-12 pb-20">
          <div className="flex items-center gap-2 md:hidden">
            <button
              className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-surface-dark dark:text-gray-200 dark:hover:bg-gray-800"
              onClick={handleImportResumeClick}
              type="button"
            >
              <UploadCloud className="h-4 w-4" />
              导入简历
            </button>
            <button
              className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-surface-dark dark:text-gray-200 dark:hover:bg-gray-800"
              onClick={handleExportAllClick}
              disabled={isExportingPdf || isLoadingProfile}
              type="button"
            >
              <Download className="h-4 w-4" />
              {isExportingPdf ? '导出中...' : '导出全部'}
            </button>
          </div>

          {isExperienceBankEmpty && (
            <section className="rounded-2xl border-2 border-dashed border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50 p-6 shadow-sm dark:border-blue-800 dark:from-blue-900/20 dark:to-indigo-900/20">
              <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
                <div className="flex-1">
                  <h2 className="mb-2 flex items-center gap-2 text-lg font-bold text-gray-900 dark:text-white">
                    <UploadCloud className="h-6 w-6 text-primary" />
                    快速开始，从导入简历开始
                  </h2>
                  <div className="space-y-2 text-sm text-gray-600 dark:text-gray-400">
                    <p>
                      当前经历库还没有内容，导入您的简历可快速构建工作、项目和教育经历。
                    </p>
                    <p className="flex items-start gap-2 text-gray-500 dark:text-gray-300">
                      <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500" />
                      <span>如果您还没有简历，也可以借助 AI 助手从 0 到 1 梳理经历、撰写简历。</span>
                    </p>
                  </div>
                </div>
                <div className="flex w-full flex-col gap-3 md:w-auto md:min-w-[220px]">
                  <button
                    className="flex items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-primary px-6 py-3 font-semibold text-white shadow-lg transition-all hover:-translate-y-0.5 hover:bg-primary-dark hover:shadow-xl"
                    onClick={handleImportResumeClick}
                    type="button"
                  >
                    <UploadCloud className="h-5 w-5" />
                    导入简历
                  </button>
                  <button
                    className="flex items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-indigo-200 bg-white/90 px-6 py-3 font-semibold text-indigo-600 transition-all hover:border-indigo-300 hover:bg-indigo-50 dark:border-indigo-700/70 dark:bg-slate-900/40 dark:text-indigo-300 dark:hover:bg-indigo-900/20"
                    onClick={() => void handleLaunchEmptyStateAssistant()}
                    type="button"
                  >
                    <Bot className="h-5 w-5" />
                    AI 助手写简历
                  </button>
                </div>
              </div>
            </section>
          )}

          {/* Personal Info Section */}
          <section className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <User className="w-5 h-5 text-indigo-500" />
                个人信息
                <span className="text-sm font-normal text-gray-400 ml-2">Personal Info</span>
              </h2>
              <div>
                {!isEditingProfile ? (
                  <button
                    onClick={handleEditProfile}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-primary bg-primary/10 rounded-lg hover:bg-primary/20 transition-colors"
                    disabled={isLoadingProfile}
                  >
                    <Wrench className="w-4 h-4" />
                    编辑
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleCancelProfile}
                      className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-300 dark:hover:text-white dark:hover:bg-gray-800 rounded-lg transition-colors"
                      disabled={isSavingProfile}
                    >
                      取消
                    </button>
                    <button
                      onClick={handleSaveProfile}
                      className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-dark transition-colors disabled:opacity-50"
                      disabled={isSavingProfile}
                    >
                      {isSavingProfile ? '保存中...' : '保存'}
                    </button>
                  </div>
                )}
              </div>
            </div>
            {/* 隐藏 file input，由头像区点击触发 */}
            <input
              ref={avatarFileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              disabled={!isAvatarInteractionEnabled}
              onChange={handleFileSelected}
            />
            <div className="bg-white dark:bg-surface-dark rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-sm">
              {/*
                布局策略：
                - PC (md+)：flex-row，头像固定列在左，字段网格在右
                - Mobile：头像浮在右上角，姓名/电话在左侧纵向排列，与头像平行
              */}
              <div className="flex gap-5 md:gap-6">

                {/* PC端头像（md+ 显示，左侧固定列） */}
                <div className="hidden md:flex md:shrink-0 md:flex-col md:items-center md:pt-1">
                  <ProfileAvatarZone
                    avatarDataUrl={avatarDataUrl}
                    isClickable={isAvatarInteractionEnabled}
                    size="md"
                    onUploadClick={handleAvatarUploadClick}
                  />
                </div>

                {/* 右侧（或全宽）信息区 */}
                <div className="flex-1 min-w-0">

                  {/* ── 移动端首行：姓名/电话（左）+ 头像（右）────────────── */}
                  <div className="flex items-start gap-3 mb-5 md:hidden">
                    <div className="flex-1 min-w-0 space-y-5">
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                          <User className="w-3 h-3" /> 姓名
                        </label>
                        <input
                          className="fluid-input text-lg font-bold text-gray-900 dark:text-white w-full disabled:bg-transparent disabled:border-transparent disabled:p-0"
                          value={name}
                          onChange={(e) => handleNameChange(e.target.value)}
                          disabled={!isEditingProfile || isLoadingProfile}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                          <Phone className="w-3 h-3" /> 电话
                        </label>
                        <input
                          className="fluid-input text-base text-gray-700 dark:text-gray-300 w-full disabled:bg-transparent disabled:border-transparent disabled:p-0"
                          value={phone}
                          onChange={(e) => handlePhoneChange(e.target.value)}
                          disabled={!isEditingProfile || isLoadingProfile}
                        />
                      </div>
                    </div>
                    <div className="shrink-0 mt-1">
                      <ProfileAvatarZone
                        avatarDataUrl={avatarDataUrl}
                        isClickable={isAvatarInteractionEnabled}
                        size="sm"
                        onUploadClick={handleAvatarUploadClick}
                      />
                    </div>
                  </div>

                  {/*
                    ── 字段网格 ─────────────────────────────────────────────
                    Mobile (grid-cols-1) 显示顺序（通过 order）：
                      姓名（hidden md:block → mobile不渲染）
                      电话（mobile 已在上方单独渲染）
                      邮箱 order-1  → 排第1
                      地点 order-2  → 排第2
                      链接 order-3  → 排第3
                    PC (md+) 所有 order 重置为 0，按 DOM 顺序流动
                  */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">

                    {/* 姓名 - 仅 PC（mobile 已在上方单独渲染） */}
                    <div className="hidden md:block space-y-1">
                      <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                        <User className="w-3 h-3" /> 姓名
                      </label>
                      <input
                        className="fluid-input text-lg font-bold text-gray-900 dark:text-white w-full disabled:bg-transparent disabled:border-transparent disabled:p-0"
                        value={name}
                        onChange={(e) => handleNameChange(e.target.value)}
                        disabled={!isEditingProfile || isLoadingProfile}
                      />
                    </div>

                    {/* 邮箱 - mobile 排第1，PC 正常流 */}
                    <div className="order-1 md:order-none space-y-1">
                      <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                        <Mail className="w-3 h-3" /> 邮箱
                      </label>
                      <input
                        className="fluid-input text-base text-gray-700 dark:text-gray-300 w-full disabled:bg-transparent disabled:border-transparent disabled:p-0"
                        value={email}
                        onChange={(e) => handleEmailChange(e.target.value)}
                        disabled={!isEditingProfile || isLoadingProfile}
                      />
                    </div>

                    {/* 电话 - 仅 PC（mobile 已在上方与头像平行显示） */}
                    <div className="hidden md:block md:order-none space-y-1">
                      <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                        <Phone className="w-3 h-3" /> 电话
                      </label>
                      <input
                        className="fluid-input text-base text-gray-700 dark:text-gray-300 w-full disabled:bg-transparent disabled:border-transparent disabled:p-0"
                        value={phone}
                        onChange={(e) => handlePhoneChange(e.target.value)}
                        disabled={!isEditingProfile || isLoadingProfile}
                      />
                    </div>

                    {/* 地点 */}
                    <div className="order-2 md:order-none space-y-1">
                      <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                        <MapPin className="w-3 h-3" /> 地点
                      </label>
                      <input
                        className="fluid-input text-base text-gray-700 dark:text-gray-300 w-full disabled:bg-transparent disabled:border-transparent disabled:p-0"
                        value={location}
                        onChange={(e) => handleLocationChange(e.target.value)}
                        disabled={!isEditingProfile || isLoadingProfile}
                      />
                    </div>

                    {/* 链接 */}
                    <div className="order-3 md:order-none md:col-span-2 space-y-1">
                      <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                        <LinkIcon className="w-3 h-3" /> 链接 (LinkedIn/Portfolio)
                      </label>
                      <input
                        className="fluid-input text-base text-gray-700 dark:text-gray-300 w-full disabled:bg-transparent disabled:border-transparent disabled:p-0"
                        value={link}
                        onChange={(e) => handleLinkChange(e.target.value)}
                        disabled={!isEditingProfile || isLoadingProfile}
                      />
                    </div>

                  </div>
                </div>
              </div>
              <div className="mt-6 border-t border-gray-100 pt-5 dark:border-gray-700">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-gray-400">
                      <FileText className="h-3.5 w-3.5 text-gray-400" />
                      个人评价
                    </label>
                    <p className="mt-1 text-xs text-gray-400">适用于简历“自我评价”部分的总结内容。</p>
                  </div>
                  {isEditingProfile && (
                    <button
                      type="button"
                      onClick={() => void handleGenerateSummary()}
                      disabled={isGeneratingSummary || isLoadingProfile}
                      className="inline-flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/10 px-3 py-2 text-xs font-medium text-primary transition-colors hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Wand2 className={`h-4 w-4 ${isGeneratingSummary ? 'animate-spin' : ''}`} />
                      {isGeneratingSummary ? '生成中...' : 'AI 一键生成'}
                    </button>
                  )}
                </div>
                {isEditingProfile ? (
                  <textarea
                    className="min-h-[132px] w-full resize-y rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm leading-6 text-gray-700 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15 dark:border-gray-700 dark:bg-surface-dark dark:text-gray-300"
                    value={summary}
                    onChange={(e) => handleSummaryChange(e.target.value)}
                    disabled={isLoadingProfile}
                    placeholder="填写适合展示在简历中的个人评价，或AI自动基于个人经历生成。"
                  />
                ) : (
                  <div
                    className={`rounded-lg border border-gray-100 bg-gray-50/70 px-4 py-3 text-sm leading-8 text-gray-700 dark:border-gray-700 dark:bg-gray-800/50 dark:text-gray-300 ${
                      summaryText ? '' : 'min-h-[132px]'
                    }`}
                  >
                    {summaryText ? (
                      <p className="whitespace-pre-wrap break-words">
                        {isSummaryExpanded || !summaryPreview.isTruncated
                          ? summaryText
                          : summaryPreview.text}
                        {summaryPreview.isTruncated ? (
                          <button
                            type="button"
                            onClick={() => setIsSummaryExpanded((prev) => !prev)}
                            className="ml-2 inline text-primary hover:text-primary/80"
                          >
                            {isSummaryExpanded ? '收起' : '查看更多'}
                          </button>
                        ) : null}
                      </p>
                    ) : (
                      <p className="text-gray-400 dark:text-gray-500">
                        填写适合展示在简历中的个人评价，或AI自动基于个人经历生成。
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </section>

          <ExperienceSection
            category="work"
            title="工作经历"
            subtitle="Work Experience"
            icon={<Briefcase className="w-5 h-5 text-primary" />}
            labels={{
              orgLabel: '公司名称',
              titleLabel: '担任职位',
              orgPlaceholder: '输入公司名称',
              titlePlaceholder: '输入职位名称',
              summaryPlaceholder: '点击展开编辑工作经历...',
            }}
            addButtonLabel="新增工作经历"
            emptyTitleError="职位名称不能为空"
            deleteConfirmText="确定要删除这条工作经历吗？"
            defaultOrg="新公司"
            defaultTitle="新职位"
            refreshSignal={experienceRefreshSignal}
            toast={toastApi}
            isAuthenticated={isAuthenticated}
            onRequireAuth={handleSignIn}
            onLaunchAssistant={handleLaunchExperienceBankAssistant}
            onCountChange={setWorkExperienceCount}
            focusRequest={effectiveFocusRequest?.category === 'work' ? effectiveFocusRequest : null}
          />

          <ExperienceSection
            category="project"
            title="项目经历"
            subtitle="Project Experience"
            icon={<FolderKanban className="w-5 h-5 text-indigo-500" />}
            labels={{
              orgLabel: '项目名称',
              titleLabel: '担任角色',
              orgPlaceholder: '输入项目名称',
              titlePlaceholder: '输入角色名称',
              summaryPlaceholder: '点击展开编辑项目经历...',
            }}
            addButtonLabel="新增项目经历"
            emptyTitleError="角色名称不能为空"
            titleRequired={false}
            deleteConfirmText="确定要删除这条项目经历吗？"
            defaultOrg="新项目"
            defaultTitle="新角色"
            refreshSignal={experienceRefreshSignal}
            toast={toastApi}
            isAuthenticated={isAuthenticated}
            onRequireAuth={handleSignIn}
            themeColor="indigo"
            onLaunchAssistant={handleLaunchExperienceBankAssistant}
            onCountChange={setProjectExperienceCount}
            focusRequest={effectiveFocusRequest?.category === 'project' ? effectiveFocusRequest : null}
          />

          <EducationSection
            model={education}
            onCountChange={setEducationExperienceCount}
            focusRequest={effectiveFocusRequest?.category === 'education' ? effectiveFocusRequest : null}
          />

          <CertificationSection
            refreshSignal={experienceRefreshSignal}
            toast={toastApi}
            isAuthenticated={isAuthenticated}
            onRequireAuth={handleSignIn}
          />

          <SkillsSection
            refreshSignal={experienceRefreshSignal}
            toast={toastApi}
            isAuthenticated={isAuthenticated}
            onRequireAuth={handleSignIn}
          />

        </div>
      </main>

      <ResumeUploadModal
        isOpen={isResumeModalOpen}
        onClose={() => setIsResumeModalOpen(false)}
        onImported={handleResumeImported}
        profileSnapshot={{
          name,
          email,
          phone,
          location,
        }}
        toast={toastApi}
      />

      {/* 图片裁剪弹窗 */}
      <ImageCropModal
        imageSrc={isCropModalOpen ? pendingImageSrc : null}
        hasExistingAvatar={!!avatarDataUrl}
        onConfirm={handleCropConfirm}
        onCancel={handleCropCancel}
        onDelete={handleAvatarDelete}
      />

      <ToastContainer toasts={toasts} onClose={closeToast} />
      </div>
      <div
        data-experience-bank-assistant-sidebar
        className={[
          'hidden md:flex md:h-full md:min-h-0 md:shrink-0 md:overflow-hidden',
          'border-border-light dark:border-border-dark transition-all duration-300 ease-in-out',
          isAssistantSidebarOpen
            ? 'w-[390px] opacity-100 md:border-l shadow-[0_18px_60px_-36px_rgba(15,23,42,0.55)]'
            : 'w-0 opacity-0 md:border-l-0 pointer-events-none',
        ].join(' ')}
        style={{
          width: isAssistantSidebarOpen ? EXPERIENCE_BANK_ASSISTANT_SIDEBAR_WIDTH : 0,
          opacity: isAssistantSidebarOpen ? 1 : 0,
          flexShrink: 0,
        }}
      >
        <div className="h-full shrink-0" style={{ width: EXPERIENCE_BANK_ASSISTANT_SIDEBAR_WIDTH }}>
          {isAssistantSidebarOpen ? (
            <AIAssistant
              surface="sidebar"
              pendingLaunchRequest={assistantSidebarLaunchRequest}
              onConsumeLaunchRequest={handleConsumeAssistantSidebarLaunchRequest}
              onClose={handleCloseAssistantSidebar}
              onExpandToFullPage={handleExpandAssistantSidebar}
              onJumpToResumeEditor={onJumpToResumeEditor}
              onJumpToExperienceBank={handleAssistantJumpToExperienceBank}
              onAppliedDraftNavigation={handleAssistantDraftAppliedNavigation}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default ExperienceBank;
