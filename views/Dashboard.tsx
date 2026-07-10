import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { Plus, LayoutGrid, List, FileText, MoreHorizontal, Trash2, Copy, Edit2, Eye, PencilLine, UploadCloud, CheckSquare, Square, Check, X, LogIn, Bot, Sparkles, Search, SlidersHorizontal, RotateCcw } from 'lucide-react';
import { Resume, ViewState } from '../types';
import { devLog } from '../services/devLogger';
import { resumeService } from '../services/resumeService';
import { useProfile } from '../hooks/useProfile';
import { resolveDisplayName } from '../utils/profileDisplay';
import { clearActiveResumeId, getActiveResumeId, setActiveResumeId } from './resumeStorage';
import {
  filterSelectedDashboardResumeIds,
  getVisibleDashboardResumes,
  filterExistingResumeIds,
  removeResumeIds,
} from './Dashboard/dashboardUtils';
import type {
  DashboardMatchFilter,
  DashboardSortMode,
  DashboardTimeFilter,
} from './Dashboard/dashboardUtils';
import { useDashboardResumeList } from './Dashboard/useDashboardResumeList';
import { useDashboardDropdown } from './Dashboard/useDashboardDropdown';
import ConfirmDialog from '../components/ConfirmDialog';
import { ToastContainer, useToast } from '../components/Toast';
import RenameResumeDialog from './Dashboard/components/RenameResumeDialog';
import ResumePreviewModal from './Dashboard/components/ResumePreviewModal';
import DashboardResumeThumbnail from './Dashboard/components/DashboardResumeThumbnail';
import UnAuthPrompt from '../components/UnAuthPrompt';
import type { AssistantLaunchRequest } from './AIAssistant/types';
import { useDashboardResumePreviewCache } from './Dashboard/useDashboardResumePreviewCache';

interface DashboardProps {
  setView: (view: ViewState, options?: { shouldOpenResumeUpload?: boolean }) => void;
  cachedResumes?: Resume[]; // 从 App 传入的缓存数据
  cachedResumesOwnerKey?: string | null;
  authUserKey?: string | null;
  isAuthenticated: boolean;
  onRequireAuth: () => void | Promise<void>;
  onResumesUpdate?: (resumes: Resume[]) => void; // 更新缓存的回调
  onLaunchAssistant?: (request: AssistantLaunchRequest) => void;
  onOpenAgentPluginConfig?: () => void;
}

const DELETE_CONFIRM_TITLE = '删除简历';
const BULK_DELETE_CONFIRM_TITLE = '批量删除简历';
const DELETE_CONFIRM_LABEL = '删除';
const DELETE_CANCEL_LABEL = '取消';
const VIEW_MODE_STORAGE_KEY = 'yuanzijianli.dashboardViewMode';
const DEFAULT_WELCOME_NAME = '即刻开始';
const MOBILE_LONG_PRESS_DURATION = 450;
const BATCH_EDIT_MOTION_DURATION = 220;
type BatchEditMotion = 'idle' | 'entering' | 'exiting';
const DEFAULT_SORT_MODE: DashboardSortMode = 'created-desc';
const DEFAULT_TIME_FILTER: DashboardTimeFilter = { preset: 'all', startDate: '', endDate: '' };
const DEFAULT_MATCH_FILTER: DashboardMatchFilter = { preset: 'all', min: '', max: '' };
const DELETE_TOAST_MESSAGES = {
  loading: '正在删除简历...',
  success: '删除成功',
  error: '删除失败，请重试',
} as const;
const BATCH_DELETE_TOAST_MESSAGES = {
  loading: '正在删除所选简历...',
  empty: '请先选择要删除的简历',
} as const;
const DELETE_VERIFY_MESSAGES = {
  notRemoved: '删除未生效，已重新同步列表',
  syncFailed: '删除完成，但同步列表失败，请稍后重试',
} as const;

const resolveStoredViewMode = (value: string | null): 'grid' | 'list' => {
  return value === 'list' ? 'list' : 'grid';
};

const Dashboard: React.FC<DashboardProps> = ({
  setView,
  cachedResumes = [],
  cachedResumesOwnerKey = null,
  authUserKey = null,
  isAuthenticated,
  onRequireAuth,
  onResumesUpdate,
  onLaunchAssistant,
}) => {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  const { profile: userProfile } = useProfile();
  const handleSignIn = useCallback(async () => {
    await onRequireAuth();
  }, [onRequireAuth]);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(() =>
    resolveStoredViewMode(localStorage.getItem(VIEW_MODE_STORAGE_KEY))
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [sortMode, setSortMode] = useState<DashboardSortMode>(DEFAULT_SORT_MODE);
  const [timeFilter, setTimeFilter] = useState<DashboardTimeFilter>(DEFAULT_TIME_FILTER);
  const [matchFilter, setMatchFilter] = useState<DashboardMatchFilter>(DEFAULT_MATCH_FILTER);
  const [isFilterToolbarOpen, setIsFilterToolbarOpen] = useState(false);
  const [isDeletingResume, setIsDeletingResume] = useState(false);
  const [isBatchEditMode, setIsBatchEditMode] = useState(false);
  const [batchEditMotion, setBatchEditMotion] = useState<BatchEditMotion>('idle');
  const [selectedResumeIds, setSelectedResumeIds] = useState<string[]>([]);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [batchDeleteTargetIds, setBatchDeleteTargetIds] = useState<string[]>([]);
  const [renameTargetId, setRenameTargetId] = useState<string | null>(null);
  const [previewTargetId, setPreviewTargetId] = useState<string | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressTriggeredRef = useRef(false);
  const batchEditMotionTimerRef = useRef<number | null>(null);
  const {
    closeDropdown,
    dropdownPos,
    dropdownRef,
    openDropdown,
    openDropdownId,
  } = useDashboardDropdown();
  const welcomeName = resolveDisplayName(userProfile?.full_name, DEFAULT_WELCOME_NAME);
  const {
    toasts,
    loading: showToastLoading,
    updateToast,
    closeToast,
  } = useToast();
  const {
    resumes,
    setResumes,
    isLoading,
    error,
    isCreatingResume,
    isCopyingResume,
    isRenamingResume,
    fetchDashboardResumes,
    createResume,
    duplicateResume,
    renameResume,
  } = useDashboardResumeList({
    cachedResumes,
    cachedResumesOwnerKey,
    authUserKey,
    isAuthenticated,
    onRequireAuth: handleSignIn,
    userProfile,
    setView,
    onResumesUpdate,
    showToastLoading,
    updateToast,
  });
  const resumePreviewCache = useDashboardResumePreviewCache({
    isAuthenticated,
    authUserKey,
  });

  useEffect(() => {
    localStorage.setItem(VIEW_MODE_STORAGE_KEY, viewMode);
  }, [viewMode]);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 767px)');
    const handleChange = (event: MediaQueryListEvent) => {
      setIsMobile(event.matches);
    };
    setIsMobile(mediaQuery.matches);
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }
    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, []);
  const effectiveViewMode = isMobile ? 'list' : viewMode;
  const visibleResumes = useMemo(
    () => getVisibleDashboardResumes(resumes, {
      searchQuery,
      sortMode,
      timeFilter,
      matchFilter,
    }),
    [matchFilter, resumes, searchQuery, sortMode, timeFilter]
  );
  const selectedResumeIdSet = useMemo(() => new Set(selectedResumeIds), [selectedResumeIds]);
  const selectedCount = selectedResumeIds.length;
  const allVisibleSelected = visibleResumes.length > 0
    && visibleResumes.every((resume) => selectedResumeIdSet.has(resume.id));
  const hasActiveFilters = searchQuery.trim() !== ''
    || sortMode !== DEFAULT_SORT_MODE
    || timeFilter.preset !== DEFAULT_TIME_FILTER.preset
    || (timeFilter.preset === 'custom' && timeFilter.startDate !== '')
    || (timeFilter.preset === 'custom' && timeFilter.endDate !== '')
    || matchFilter.preset !== DEFAULT_MATCH_FILTER.preset
    || (matchFilter.preset === 'custom' && matchFilter.min !== '')
    || (matchFilter.preset === 'custom' && matchFilter.max !== '');
  const hasEmptyFilterResult = resumes.length > 0 && visibleResumes.length === 0 && hasActiveFilters;
  const pendingDeleteIds = useMemo(() => {
    if (batchDeleteTargetIds.length > 0) {
      return batchDeleteTargetIds;
    }
    return deleteTargetId ? [deleteTargetId] : [];
  }, [batchDeleteTargetIds, deleteTargetId]);
  const isBatchDeleting = pendingDeleteIds.length > 1;
  const batchEditCardMotionClass = isBatchEditMode ? 'dashboard-batch-card' : '';
  const batchEditSelectionMotionClass = batchEditMotion === 'entering'
    ? 'dashboard-batch-selection-enter'
    : batchEditMotion === 'exiting'
      ? 'dashboard-batch-selection-exit'
      : '';
  const batchEditToolbarMotionClass = batchEditMotion === 'entering'
    ? 'dashboard-batch-toolbar-enter'
    : batchEditMotion === 'exiting'
      ? 'dashboard-batch-toolbar-exit'
      : '';

  useEffect(() => {
    if (!isBatchEditMode || selectedResumeIds.length === 0) {
      return;
    }
    setSelectedResumeIds((prev) => {
      const next = filterSelectedDashboardResumeIds(prev, visibleResumes);
      return next.length === prev.length ? prev : next;
    });
  }, [isBatchEditMode, selectedResumeIds.length, visibleResumes]);

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const clearBatchEditMotionTimer = useCallback(() => {
    if (batchEditMotionTimerRef.current !== null) {
      window.clearTimeout(batchEditMotionTimerRef.current);
      batchEditMotionTimerRef.current = null;
    }
  }, []);

  useEffect(() => () => clearBatchEditMotionTimer(), [clearBatchEditMotionTimer]);

  const openResume = (id: string) => {
    if (!isAuthenticated) {
      void handleSignIn();
      return;
    }
    setActiveResumeId(id);
    setView(ViewState.EDITOR);
  };

  const handleCreateResume = () => {
    void createResume();
  };

  const exitBatchEditMode = useCallback(() => {
    if (!isBatchEditMode || batchEditMotion !== 'idle') {
      return;
    }
    clearLongPressTimer();
    longPressTriggeredRef.current = false;
    clearBatchEditMotionTimer();
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setIsBatchEditMode(false);
      setSelectedResumeIds([]);
      setBatchEditMotion('idle');
      return;
    }
    setBatchEditMotion('exiting');
    batchEditMotionTimerRef.current = window.setTimeout(() => {
      batchEditMotionTimerRef.current = null;
      setIsBatchEditMode(false);
      setSelectedResumeIds([]);
      setBatchEditMotion('idle');
    }, BATCH_EDIT_MOTION_DURATION);
  }, [batchEditMotion, clearBatchEditMotionTimer, clearLongPressTimer, isBatchEditMode]);

  const enterBatchEditMode = useCallback((initialId?: string) => {
    if (batchEditMotion !== 'idle') {
      return;
    }
    closeDropdown();
    clearBatchEditMotionTimer();
    setIsBatchEditMode(true);
    setSelectedResumeIds(initialId ? [initialId] : []);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }
    setBatchEditMotion('entering');
    batchEditMotionTimerRef.current = window.setTimeout(() => {
      batchEditMotionTimerRef.current = null;
      setBatchEditMotion('idle');
    }, BATCH_EDIT_MOTION_DURATION);
  }, [batchEditMotion, clearBatchEditMotionTimer, closeDropdown]);

  const toggleResumeSelection = useCallback((id: string) => {
    setSelectedResumeIds((prev) => (
      prev.includes(id)
        ? prev.filter((item) => item !== id)
        : [...prev, id]
    ));
  }, []);

  const handleResumeCardClick = useCallback((id: string) => {
    if (longPressTriggeredRef.current) {
      longPressTriggeredRef.current = false;
      return;
    }
    if (isBatchEditMode) {
      if (batchEditMotion === 'exiting') {
        return;
      }
      toggleResumeSelection(id);
      return;
    }
    openResume(id);
  }, [batchEditMotion, isBatchEditMode, toggleResumeSelection]);

  const handleSelectionIndicatorClick = useCallback((id: string, event: React.MouseEvent) => {
    event.stopPropagation();
    if (batchEditMotion === 'exiting') {
      return;
    }
    toggleResumeSelection(id);
  }, [batchEditMotion, toggleResumeSelection]);

  const handleSelectAllToggle = useCallback(() => {
    if (batchEditMotion === 'exiting') {
      return;
    }
    setSelectedResumeIds(() => (
      allVisibleSelected ? [] : visibleResumes.map((resume) => resume.id)
    ));
  }, [allVisibleSelected, batchEditMotion, visibleResumes]);

  const handleClearSearchFilters = useCallback(() => {
    setSearchQuery('');
    setSortMode(DEFAULT_SORT_MODE);
    setTimeFilter(DEFAULT_TIME_FILTER);
    setMatchFilter(DEFAULT_MATCH_FILTER);
  }, []);

  const handleBatchDeleteRequest = useCallback(() => {
    if (batchEditMotion === 'exiting') {
      return;
    }
    if (!isAuthenticated) {
      void handleSignIn();
      return;
    }
    if (selectedResumeIds.length === 0) {
      const toastId = showToastLoading(BATCH_DELETE_TOAST_MESSAGES.empty);
      updateToast(toastId, {
        message: BATCH_DELETE_TOAST_MESSAGES.empty,
        type: 'error',
        duration: 2000,
      });
      return;
    }
    closeDropdown();
    setDeleteTargetId(null);
    setBatchDeleteTargetIds(selectedResumeIds);
  }, [batchEditMotion, closeDropdown, handleSignIn, isAuthenticated, selectedResumeIds, showToastLoading, updateToast]);

  const handleDropdownClick = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (isBatchEditMode) {
      return;
    }
    if (openDropdownId === id) {
      closeDropdown();
      return;
    }
    const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
    openDropdown(id, rect);
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isAuthenticated) {
      void handleSignIn();
      return;
    }
    setBatchDeleteTargetIds([]);
    setDeleteTargetId(id);
    closeDropdown();
  };

  const handleCopy = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isAuthenticated) {
      void handleSignIn();
      return;
    }
    if (isCopyingResume) {
      return;
    }
    closeDropdown();
    const source = resumes.find(r => r.id === id);
    if (!source) {
      return;
    }
    void duplicateResume(id, source.name);
  };

  const handleRename = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isAuthenticated) {
      void handleSignIn();
      return;
    }
    closeDropdown();
    setRenameTargetId(id);
  };

  const handlePreview = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isAuthenticated) {
      void handleSignIn();
      return;
    }
    closeDropdown();
    setPreviewTargetId(id);
  };

  const handleConfirmRename = async (nextName: string) => {
    const result = await renameResume(renameTargetId, nextName);
    if (result === 'renamed' || result === 'unchanged') {
      setRenameTargetId(null);
    }
  };

  const handleCancelRename = () => {
    if (isRenamingResume) {
      return;
    }
    setRenameTargetId(null);
  };

  const handleClosePreview = () => {
    setPreviewTargetId(null);
  };

  const deleteTargets = useMemo(
    () => resumes.filter((resume) => pendingDeleteIds.includes(resume.id)),
    [pendingDeleteIds, resumes]
  );
  const deleteTarget = deleteTargets[0] ?? null;
  const renameTarget = useMemo(
    () => resumes.find((resume) => resume.id === renameTargetId) ?? null,
    [renameTargetId, resumes]
  );
  const previewTarget = useMemo(
    () => resumes.find((resume) => resume.id === previewTargetId) ?? null,
    [previewTargetId, resumes]
  );

  const handleConfirmDelete = async () => {
    if (pendingDeleteIds.length === 0 || isDeletingResume) {
      return;
    }
    const targetIds = pendingDeleteIds;
    const activeResumeId = getActiveResumeId();
    const toastId = showToastLoading(
      targetIds.length > 1 ? BATCH_DELETE_TOAST_MESSAGES.loading : DELETE_TOAST_MESSAGES.loading
    );
    try {
      setIsDeletingResume(true);
      const deleteResults = await Promise.allSettled(
        targetIds.map(async (targetId) => {
          await resumeService.remove(targetId);
          return targetId;
        })
      );
      const deletedIds = deleteResults.flatMap((result, index) => (
        result.status === 'fulfilled' ? [targetIds[index]] : []
      ));
      const failedIds = deleteResults.flatMap((result, index) => (
        result.status === 'rejected' ? [targetIds[index]] : []
      ));
      resumeService.clearListCache();
      devLog('[Dashboard] 删除请求完成，准备刷新列表:', targetIds);
      setDeleteTargetId(null);
      setBatchDeleteTargetIds([]);
      let refreshedResumes: Resume[] | null = null;
      try {
        refreshedResumes = await fetchDashboardResumes({ force: true });
        setResumes(refreshedResumes);
      } catch (refreshError) {
        console.error('[Dashboard] 删除后刷新列表失败:', refreshError);
        if (deletedIds.length > 0) {
          setResumes((prev) => removeResumeIds(prev, deletedIds));
        }
        if (activeResumeId && deletedIds.includes(activeResumeId)) {
          clearActiveResumeId();
        }
        if (renameTargetId && deletedIds.includes(renameTargetId)) {
          setRenameTargetId(null);
        }
        if (previewTargetId && deletedIds.includes(previewTargetId)) {
          setPreviewTargetId(null);
        }
        setSelectedResumeIds((prev) => filterExistingResumeIds(prev, removeResumeIds(resumes, deletedIds)));
        updateToast(toastId, {
          message: failedIds.length > 0
            ? `已删除 ${deletedIds.length} 份，${failedIds.length} 份删除失败`
            : DELETE_VERIFY_MESSAGES.syncFailed,
          type: 'error',
          duration: 3000,
        });
        return;
      }
      const remainingIds = refreshedResumes
        .filter((resume) => targetIds.includes(resume.id))
        .map((resume) => resume.id);
      if (remainingIds.length > 0) {
        console.warn('[Dashboard] 删除后列表仍包含部分简历，请检查后端删除逻辑:', remainingIds);
      }
      const confirmedDeletedIds = targetIds.filter((id) => !remainingIds.includes(id));
      if (activeResumeId && confirmedDeletedIds.includes(activeResumeId)) {
        clearActiveResumeId();
      }
      if (renameTargetId && confirmedDeletedIds.includes(renameTargetId)) {
        setRenameTargetId(null);
      }
      if (previewTargetId && confirmedDeletedIds.includes(previewTargetId)) {
        setPreviewTargetId(null);
      }
      setSelectedResumeIds((prev) => filterExistingResumeIds(prev, removeResumeIds(resumes, confirmedDeletedIds)));
      const unresolvedCount = remainingIds.length;
      updateToast(toastId, {
        message: unresolvedCount > 0
          ? (
            targetIds.length > 1
              ? `已删除 ${Math.max(targetIds.length - unresolvedCount, 0)} 份，${unresolvedCount} 份删除失败`
              : DELETE_VERIFY_MESSAGES.notRemoved
          )
          : (
            targetIds.length > 1
              ? `已删除 ${targetIds.length} 份简历`
              : DELETE_TOAST_MESSAGES.success
          ),
        type: unresolvedCount > 0 ? 'error' : 'success',
        duration: unresolvedCount > 0 ? 3000 : 2000,
      });
      if (targetIds.length > 1 && refreshedResumes.length === 0) {
        exitBatchEditMode();
      }
    } catch (error) {
      console.error('[Dashboard] 删除简历失败:', error);
      updateToast(toastId, { message: DELETE_TOAST_MESSAGES.error, type: 'error', duration: 3000 });
    } finally {
      setIsDeletingResume(false);
    }
  };

  const handleCancelDelete = () => {
    if (isDeletingResume) {
      return;
    }
    setDeleteTargetId(null);
    setBatchDeleteTargetIds([]);
  };

  useEffect(() => {
    setSelectedResumeIds((prev) => {
      const next = filterExistingResumeIds(prev, resumes);
      return next.length === prev.length ? prev : next;
    });
  }, [resumes]);

  useEffect(() => {
    if (isBatchEditMode && resumes.length === 0) {
      exitBatchEditMode();
    }
  }, [exitBatchEditMode, isBatchEditMode, resumes.length]);

  useEffect(() => {
    if (isBatchEditMode) {
      closeDropdown();
    }
  }, [closeDropdown, isBatchEditMode]);

  useEffect(() => {
    return () => {
      clearLongPressTimer();
    };
  }, [clearLongPressTimer]);

  const handleMobileLongPressStart = (id: string) => {
    if (!isMobile || isBatchEditMode) {
      return;
    }
    clearLongPressTimer();
    longPressTriggeredRef.current = false;
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTriggeredRef.current = true;
      enterBatchEditMode(id);
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate(20);
      }
    }, MOBILE_LONG_PRESS_DURATION);
  };

  const handleMobileLongPressCancel = () => {
    clearLongPressTimer();
  };

  const handleLaunchResumeAssistant = useCallback(() => {
    if (!isAuthenticated) {
      void handleSignIn();
      return;
    }
    if (!onLaunchAssistant) {
      return;
    }

    onLaunchAssistant({
      context: {
        mode: 'general',
        entrySource: 'direct',
        title: 'AI 助手 · 从 0 到 1 写简历',
        contextJson: {
          origin: 'dashboard_empty_state',
        },
      },
      initialUserMessage: '我还没有现成简历，请作为简历教练一步步引导我从 0 到 1 梳理经历、提炼亮点，并最终产出一份可继续编辑的简历内容。',
    });
  }, [handleSignIn, isAuthenticated, onLaunchAssistant]);

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-gray-50 dark:bg-gray-900/50">
      {/* Header */}
      <header className="hidden border-b border-border-light bg-surface-light px-4 py-3 shrink-0 dark:border-border-dark dark:bg-surface-dark md:block md:px-8">
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
            <span className="text-xs font-medium text-gray-500 sm:text-sm">我的简历</span>
          </div>
        </div>
        <div className="flex items-center justify-between gap-4 md:justify-end">
          <UnAuthPrompt />
        </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-4 md:p-8">
        <div className="max-w-7xl mx-auto space-y-6 md:space-y-10">
          {/* 推广卡片：当没有简历时显示 */}
          {resumes.length === 0 && (
            isAuthenticated ? (
              <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-xl border-2 border-dashed border-blue-200 dark:border-blue-800 p-6 shadow-sm">
                <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                  <div className="flex-1">
                    <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2 flex items-center gap-2">
                      <UploadCloud className="w-6 h-6 text-primary" />
                      快速开始，从导入简历开始
                    </h3>
                    <div className="space-y-2 text-sm text-gray-600 dark:text-gray-400">
                      <p>
                        暂无经历数据，导入您的简历可快速构建经历库，让原子简历为您智能分析和优化。
                      </p>
                      <p className="flex items-start gap-2 text-gray-500 dark:text-gray-300">
                        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500" />
                        <span>如果您还没有简历，也可以借助 AI 助手从 0 到 1 梳理经历、撰写简历。</span>
                      </p>
                    </div>
                  </div>
                  <div className="flex w-full flex-col gap-3 md:w-auto md:min-w-[220px]">
                    <button
                      onClick={() => setView(ViewState.EXPERIENCE_BANK, { shouldOpenResumeUpload: true })}
                      className="flex items-center justify-center gap-2 bg-primary hover:bg-primary-dark text-white px-6 py-3 rounded-xl font-semibold transition-all shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 whitespace-nowrap"
                    >
                      <UploadCloud className="w-5 h-5" />
                      导入简历
                    </button>
                    <button
                      onClick={handleLaunchResumeAssistant}
                      className="flex items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-white/90 px-6 py-3 font-semibold text-indigo-600 transition-all hover:border-indigo-300 hover:bg-indigo-50 dark:border-indigo-700/70 dark:bg-slate-900/40 dark:text-indigo-300 dark:hover:bg-indigo-900/20 whitespace-nowrap"
                      type="button"
                    >
                      <Bot className="h-5 w-5" />
                      AI 助手写简历
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20 rounded-xl border border-amber-200 dark:border-amber-800/50 p-6 shadow-sm">
                <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                  <div className="flex-1">
                    <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2 flex items-center gap-2">
                      <FileText className="w-6 h-6 text-amber-600 dark:text-amber-500" />
                      解锁全部功能，从登录开始
                    </h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      您还未登录。立即登录即可创建、管理简历，并享受智能简历工厂的完整功能。
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      void handleSignIn();
                    }}
                    className="flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white px-6 py-3 rounded-xl font-semibold transition-all shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 whitespace-nowrap"
                  >
                    <LogIn className="w-5 h-5 -scale-x-100" />
                    立即登录
                  </button>
                </div>
              </div>
            )
          )}
          <div className="flex flex-col justify-between gap-3 md:flex-row md:items-end md:gap-4">
            <div className="flex items-start justify-between gap-4 md:block">
              <div>
                <h1 className="mb-2 text-2xl font-bold text-gray-900 dark:text-white md:text-3xl">欢迎回来，{welcomeName}</h1>
                <p className="text-gray-500 dark:text-gray-400 flex items-center gap-2">
                  <span className="inline-block w-2 h-2 rounded-full bg-emerald-500"></span>
                  你已创建了 <span className="font-bold text-gray-900 dark:text-white">{resumes.length}</span> 份简历。
                </p>
                {!isBatchEditMode && isMobile && resumes.length > 0 && (
                  <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">长按卡片可进入批量编辑</p>
                )}
              </div>
              {isBatchEditMode ? (
                <button
                  onClick={exitBatchEditMode}
                  className="flex shrink-0 items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-gray-700 shadow-sm transition-all hover:bg-gray-50 dark:border-gray-700 dark:bg-surface-dark dark:text-gray-200 dark:hover:bg-gray-800 md:hidden"
                >
                  <X className="h-4 w-4" />
                  完成
                </button>
              ) : (
                <button
                  onClick={handleCreateResume}
                  disabled={isCreatingResume}
                  className="flex shrink-0 items-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-primary/20 transition-all disabled:opacity-60 md:hidden"
                >
                  <Plus className="h-4 w-4" />
                  {isCreatingResume ? '创建中...' : '创建新简历'}
                </button>
              )}
            </div>

            <div className="dashboard-header-actions flex w-full flex-col gap-3 md:w-auto md:flex-row md:items-center md:justify-end md:gap-4">
              {resumes.length > 0 && (
                <div
                  className="relative flex w-full items-center gap-2 md:w-[360px] lg:w-[440px]"
                  data-dashboard-search="top"
                >
                  <label className="relative min-w-0 flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                    <input
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder="搜索简历名称"
                      className="h-11 w-full rounded-xl border border-gray-200 bg-white pl-10 pr-3 text-sm font-medium text-gray-900 shadow-sm outline-none transition-colors placeholder:text-gray-400 focus:border-primary dark:border-gray-700 dark:bg-surface-dark dark:text-white dark:focus:border-primary"
                      type="search"
                    />
                  </label>
                  <button
                    aria-expanded={isFilterToolbarOpen}
                    aria-label="筛选简历"
                    onClick={() => setIsFilterToolbarOpen((prev) => !prev)}
                    className={`inline-flex h-11 shrink-0 items-center gap-2 rounded-xl border px-3 text-sm font-semibold shadow-sm transition-colors ${isFilterToolbarOpen || hasActiveFilters
                      ? 'border-primary/30 bg-primary/10 text-primary dark:border-primary/40 dark:bg-primary/15 dark:text-primary-light'
                      : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-surface-dark dark:text-gray-300 dark:hover:bg-gray-800'
                      }`}
                    type="button"
                  >
                    <SlidersHorizontal className="h-4 w-4" />
                    <span className="hidden sm:inline">筛选</span>
                  </button>
                  {isFilterToolbarOpen && (
                    <div
                      className="absolute right-0 top-full z-40 mt-3 w-[min(92vw,360px)] rounded-2xl border border-gray-200 bg-white p-4 text-left shadow-2xl shadow-gray-900/15 dark:border-gray-700 dark:bg-surface-dark dark:shadow-black/30"
                      data-dashboard-filter-popover="advanced"
                    >
                      <div className="flex flex-col gap-3">
                        <label className="flex flex-col gap-1 text-xs font-semibold text-gray-500 dark:text-gray-400">
                          排序
                          <select
                            value={sortMode}
                            onChange={(event) => setSortMode(event.target.value as DashboardSortMode)}
                            className="h-11 rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm font-semibold text-gray-900 outline-none focus:border-primary dark:border-gray-700 dark:bg-gray-900/50 dark:text-white"
                          >
                            <option value="created-desc">创建时间：新到旧</option>
                            <option value="created-asc">创建时间：旧到新</option>
                            <option value="updated-desc">最近修改：新到旧</option>
                            <option value="match-desc">匹配度：高到低</option>
                            <option value="match-asc">匹配度：低到高</option>
                          </select>
                        </label>
                        <label className="flex flex-col gap-1 text-xs font-semibold text-gray-500 dark:text-gray-400">
                          创建时间
                          <select
                            value={timeFilter.preset}
                            onChange={(event) => setTimeFilter((prev) => ({
                              ...prev,
                              preset: event.target.value as DashboardTimeFilter['preset'],
                            }))}
                            className="h-11 rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm font-semibold text-gray-900 outline-none focus:border-primary dark:border-gray-700 dark:bg-gray-900/50 dark:text-white"
                          >
                            <option value="all">全部时间</option>
                            <option value="7d">近7天</option>
                            <option value="30d">近30天</option>
                            <option value="90d">近90天</option>
                            <option value="custom">自定义</option>
                          </select>
                        </label>
                        {timeFilter.preset === 'custom' && (
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <label className="flex flex-col gap-1 text-xs font-semibold text-gray-500 dark:text-gray-400">
                              开始日期
                              <input
                                value={timeFilter.startDate}
                                onChange={(event) => setTimeFilter((prev) => ({
                                  ...prev,
                                  startDate: event.target.value,
                                }))}
                                className="h-10 rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm font-semibold text-gray-900 outline-none focus:border-primary dark:border-gray-700 dark:bg-gray-900/50 dark:text-white"
                                type="date"
                              />
                            </label>
                            <label className="flex flex-col gap-1 text-xs font-semibold text-gray-500 dark:text-gray-400">
                              结束日期
                              <input
                                value={timeFilter.endDate}
                                onChange={(event) => setTimeFilter((prev) => ({
                                  ...prev,
                                  endDate: event.target.value,
                                }))}
                                className="h-10 rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm font-semibold text-gray-900 outline-none focus:border-primary dark:border-gray-700 dark:bg-gray-900/50 dark:text-white"
                                type="date"
                              />
                            </label>
                          </div>
                        )}
                        <label className="flex flex-col gap-1 text-xs font-semibold text-gray-500 dark:text-gray-400">
                          匹配度
                          <select
                            value={matchFilter.preset}
                            onChange={(event) => setMatchFilter((prev) => ({
                              ...prev,
                              preset: event.target.value as DashboardMatchFilter['preset'],
                            }))}
                            className="h-11 rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm font-semibold text-gray-900 outline-none focus:border-primary dark:border-gray-700 dark:bg-gray-900/50 dark:text-white"
                          >
                            <option value="all">全部匹配度</option>
                            <option value="scored">有匹配度</option>
                            <option value="80">80%以上</option>
                            <option value="90">90%以上</option>
                            <option value="custom">自定义</option>
                          </select>
                        </label>
                        {matchFilter.preset === 'custom' && (
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <label className="flex flex-col gap-1 text-xs font-semibold text-gray-500 dark:text-gray-400">
                              最低匹配度
                              <input
                                value={matchFilter.min}
                                onChange={(event) => setMatchFilter((prev) => ({
                                  ...prev,
                                  min: event.target.value,
                                }))}
                                className="h-10 rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm font-semibold text-gray-900 outline-none focus:border-primary dark:border-gray-700 dark:bg-gray-900/50 dark:text-white"
                                inputMode="numeric"
                                max="100"
                                min="0"
                                placeholder="0"
                                type="number"
                              />
                            </label>
                            <label className="flex flex-col gap-1 text-xs font-semibold text-gray-500 dark:text-gray-400">
                              最高匹配度
                              <input
                                value={matchFilter.max}
                                onChange={(event) => setMatchFilter((prev) => ({
                                  ...prev,
                                  max: event.target.value,
                                }))}
                                className="h-10 rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm font-semibold text-gray-900 outline-none focus:border-primary dark:border-gray-700 dark:bg-gray-900/50 dark:text-white"
                                inputMode="numeric"
                                max="100"
                                min="0"
                                placeholder="100"
                                type="number"
                              />
                            </label>
                          </div>
                        )}
                        <div className="flex items-center justify-between gap-3 border-t border-gray-100 pt-3 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
                          <span className="inline-flex items-center gap-2">
                            <SlidersHorizontal className="h-4 w-4" />
                            显示 {visibleResumes.length} / {resumes.length} 份
                          </span>
                          {hasActiveFilters && (
                            <button
                              onClick={handleClearSearchFilters}
                              className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                              type="button"
                            >
                              <RotateCcw className="h-4 w-4" />
                              清空
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
              <div className="hidden md:flex items-center bg-white dark:bg-surface-dark border border-gray-200 dark:border-gray-700 rounded-lg p-1 shadow-sm">
                <button
                  onClick={() => setViewMode('grid')}
                  className={`p-2 rounded-md transition-all ${viewMode === 'grid' ? 'bg-gray-100 dark:bg-gray-700 text-primary dark:text-white shadow-sm ring-1 ring-black/5 dark:ring-white/10' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                >
                  <LayoutGrid className="w-5 h-5" />
                </button>
                <button
                  onClick={() => setViewMode('list')}
                  className={`p-2 rounded-md transition-all ${viewMode === 'list' ? 'bg-gray-100 dark:bg-gray-700 text-primary dark:text-white shadow-sm ring-1 ring-black/5 dark:ring-white/10' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                >
                  <List className="w-5 h-5" />
                </button>
              </div>
              {resumes.length > 0 && (
                <button
                  onClick={isBatchEditMode ? exitBatchEditMode : () => enterBatchEditMode()}
                  className={`hidden items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition-all md:flex ${isBatchEditMode
                    ? 'border border-gray-200 bg-white text-gray-700 shadow-sm hover:bg-gray-50 dark:border-gray-700 dark:bg-surface-dark dark:text-gray-200 dark:hover:bg-gray-800'
                    : 'border border-primary/20 bg-primary/10 text-primary shadow-sm hover:bg-primary/15 dark:border-primary/30 dark:bg-primary/10 dark:text-primary-light'
                    }`}
                  type="button"
                >
                  {isBatchEditMode ? <X className="h-4 w-4" /> : <CheckSquare className="h-4 w-4" />}
                  {isBatchEditMode ? '退出批量编辑' : '批量编辑'}
                </button>
              )}
              <div
                aria-hidden={isBatchEditMode}
                className={`dashboard-create-resume-action hidden md:block ${isBatchEditMode ? 'dashboard-create-resume-action-hidden' : ''}`}
              >
                <button
                  onClick={handleCreateResume}
                  disabled={isCreatingResume}
                  tabIndex={isBatchEditMode ? -1 : undefined}
                  className="flex items-center gap-2 whitespace-nowrap rounded-xl bg-primary px-6 py-3 text-base font-semibold text-white shadow-lg shadow-primary/20 transition-colors hover:bg-primary-dark disabled:opacity-60"
                >
                  <Plus className="w-5 h-5" />
                  {isCreatingResume ? '创建中...' : '创建新简历'}
                </button>
              </div>
            </div>
          </div>

          {isBatchEditMode && resumes.length > 0 && (
            <div className={`dashboard-batch-toolbar rounded-2xl border border-primary/15 bg-white/95 p-4 shadow-sm backdrop-blur dark:border-primary/20 dark:bg-surface-dark/95 ${batchEditToolbarMotionClass}`}>
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary dark:bg-primary/15">
                    <CheckSquare className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-gray-900 dark:text-white">批量编辑中</div>
                    <div className="text-sm text-gray-500 dark:text-gray-400">已选择 {selectedCount} 份简历</div>
                  </div>
                  <div className="flex items-center gap-2 md:hidden">
                    <button
                      onClick={handleSelectAllToggle}
                      disabled={visibleResumes.length === 0}
                      className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                      type="button"
                    >
                      {allVisibleSelected ? '取消全选' : '全选'}
                    </button>
                    <button
                      onClick={handleBatchDeleteRequest}
                      disabled={selectedCount === 0 || isDeletingResume}
                      className="rounded-xl bg-red-600 px-3 py-2 text-sm font-medium text-white shadow-lg shadow-red-500/20 transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                      type="button"
                    >
                      删除
                    </button>
                  </div>
                </div>
                <div className="hidden items-center gap-2 md:flex">
                  <button
                    onClick={handleSelectAllToggle}
                    disabled={visibleResumes.length === 0}
                    className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                    type="button"
                  >
                    {allVisibleSelected ? '取消全选' : '全选'}
                  </button>
                  <button
                    onClick={handleBatchDeleteRequest}
                    disabled={selectedCount === 0 || isDeletingResume}
                    className="rounded-xl bg-red-600 px-3 py-2 text-sm font-medium text-white shadow-lg shadow-red-500/20 transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                    type="button"
                  >
                    删除
                  </button>
                </div>
              </div>
            </div>
          )}

          {hasEmptyFilterResult ? (
            <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-12 text-center shadow-sm dark:border-gray-700 dark:bg-surface-dark">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Search className="h-5 w-5" />
              </div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">没有找到匹配的简历</h3>
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">调整名称、时间或匹配度条件后再试。</p>
              <button
                onClick={handleClearSearchFilters}
                className="mt-5 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-primary/20 transition-colors hover:bg-primary-dark"
                type="button"
              >
                <RotateCcw className="h-4 w-4" />
                清空筛选
              </button>
            </div>
          ) : effectiveViewMode === 'grid' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
              {visibleResumes.map(resume => (
                <div
                  key={resume.id}
                  onClick={() => handleResumeCardClick(resume.id)}
                  className={`dashboard-resume-card group relative flex cursor-pointer flex-col overflow-hidden rounded-xl border bg-white transition-[border-color,box-shadow] duration-200 dark:bg-surface-dark ${batchEditCardMotionClass} ${selectedResumeIdSet.has(resume.id)
                    ? 'border-primary/60 shadow-xl shadow-primary/10 ring-2 ring-primary/20 dark:border-primary/50'
                    : 'border-gray-200 hover:shadow-xl hover:border-primary/30 dark:border-gray-700'
                    }`}
                >
                  {isBatchEditMode && (
                    <button
                      aria-label={`${selectedResumeIdSet.has(resume.id) ? '取消选择' : '选择'} ${resume.name}`}
                      className={`dashboard-batch-selection-control absolute left-4 top-4 z-20 flex h-9 w-9 items-center justify-center rounded-full border shadow-sm transition-all ${batchEditSelectionMotionClass} ${selectedResumeIdSet.has(resume.id)
                        ? 'border-primary bg-primary text-white'
                        : 'border-white/80 bg-white/90 text-gray-400 dark:border-gray-600 dark:bg-gray-800/90 dark:text-gray-500'
                        }`}
                      onClick={(event) => handleSelectionIndicatorClick(resume.id, event)}
                      type="button"
                    >
                      {selectedResumeIdSet.has(resume.id) ? <Check className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                    </button>
                  )}
                  <div className="aspect-[210/297] bg-gray-100 dark:bg-gray-900 relative overflow-hidden border-b border-gray-100 dark:border-gray-800">
                    <DashboardResumeThumbnail
                      resume={resume}
                      variant="grid"
                      entry={resumePreviewCache.getPreviewEntry(resume)}
                      isBatchEditMode={isBatchEditMode}
                      onEnsurePreview={resumePreviewCache.ensurePreview}
                      onPreview={(e) => handlePreview(resume.id, e)}
                      className="absolute inset-0"
                    />
                  </div>
                  <div className="p-4 flex-1 flex flex-col">
                    <div className="flex justify-between items-start mb-1">
                      <h3 className="font-bold text-gray-900 dark:text-white truncate pr-2 text-base">{resume.name}</h3>
                    </div>
                    {resume.matchRate > 0 && (
                      <div className="mb-3">
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400 font-bold border border-emerald-200 dark:border-emerald-500/20">
                          匹配度: {resume.matchRate}%
                        </span>
                      </div>
                    )}
                    <div className="mt-auto pt-4 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between relative">
                      <span className="text-xs text-gray-400 font-medium">{resume.lastModified}</span>
                      {isBatchEditMode ? (
                        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${selectedResumeIdSet.has(resume.id)
                          ? 'bg-primary/10 text-primary dark:bg-primary/15'
                          : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                          }`}
                        >
                          {selectedResumeIdSet.has(resume.id) ? '已选择' : '点击选择'}
                        </span>
                      ) : (
                        <div className="relative">
                          <button
                            className="p-1.5 text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors dropdown-trigger"
                            onClick={(e) => handleDropdownClick(e, resume.id)}
                          >
                            <MoreHorizontal className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              {!isBatchEditMode && (
                <button
                  onClick={handleCreateResume}
                  disabled={isCreatingResume}
                  className="group flex flex-col items-center justify-center h-full min-h-[360px] rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-700 hover:border-primary/50 hover:bg-primary/5 transition-all duration-300 disabled:opacity-60 disabled:hover:bg-transparent disabled:hover:border-gray-200"
                >
                  <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-gray-400 group-hover:text-primary group-hover:bg-white dark:group-hover:bg-gray-700 shadow-sm transition-colors mb-4">
                    <Plus className="w-8 h-8" />
                  </div>
                  <h3 className="font-semibold text-gray-500 dark:text-gray-400 group-hover:text-primary transition-colors">创建新简历</h3>
                  <p className="text-xs text-gray-400 mt-2">从空白开始或使用模版</p>
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="hidden min-h-[500px] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-surface-dark md:block">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/50 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      <th className="px-6 py-4">简历名称</th>
                      <th className="px-6 py-4 w-40">匹配度</th>
                      <th className="px-6 py-4 w-40">最后修改</th>
                      <th className="px-6 py-4 w-32 text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {visibleResumes.map(resume => (
                      <tr
                        key={resume.id}
                        className={`group cursor-pointer transition-colors ${batchEditCardMotionClass} ${selectedResumeIdSet.has(resume.id)
                          ? 'bg-primary/5 dark:bg-primary/10'
                          : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
                          }`}
                        onClick={() => handleResumeCardClick(resume.id)}
                      >
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-4">
                            {isBatchEditMode && (
                              <button
                                aria-label={`${selectedResumeIdSet.has(resume.id) ? '取消选择' : '选择'} ${resume.name}`}
                                className={`dashboard-batch-selection-control flex h-8 w-8 items-center justify-center rounded-lg border transition-colors ${batchEditSelectionMotionClass} ${selectedResumeIdSet.has(resume.id)
                                  ? 'border-primary bg-primary text-white'
                                  : 'border-gray-200 bg-white text-gray-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-500'
                                  }`}
                                onClick={(event) => handleSelectionIndicatorClick(resume.id, event)}
                                type="button"
                              >
                                {selectedResumeIdSet.has(resume.id) ? <Check className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                              </button>
                            )}
                            <div className="shrink-0 rounded-lg bg-indigo-50 p-2.5 text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-400">
                              <FileText className="w-5 h-5" />
                            </div>
                            <h3 className="font-bold text-gray-900 dark:text-white text-base leading-tight">{resume.name}</h3>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          {resume.matchRate > 0 ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400 text-xs font-bold border border-emerald-200 dark:border-emerald-500/20 whitespace-nowrap">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                              {resume.matchRate}%
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-100 text-gray-600 dark:bg-gray-700/50 dark:text-gray-400 text-xs font-bold border border-gray-200 dark:border-gray-700 whitespace-nowrap">
                              草稿
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-sm font-medium text-gray-600 dark:text-gray-300">
                          {resume.lastModified}
                        </td>
                        <td className="px-6 py-4 text-right">
                          {isBatchEditMode ? (
                            <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${selectedResumeIdSet.has(resume.id)
                              ? 'bg-primary/10 text-primary dark:bg-primary/15'
                              : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                              }`}
                            >
                              {selectedResumeIdSet.has(resume.id) ? '已选' : '未选'}
                            </span>
                          ) : (
                            <div className="flex items-center justify-end gap-3">
                              <button
                                className="p-1.5 text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors dropdown-trigger"
                                onClick={(e) => handleDropdownClick(e, resume.id)}
                              >
                                <MoreHorizontal className="w-4 h-4" />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="space-y-3 md:hidden">
                {visibleResumes.map((resume) => (
                  <div
                    key={resume.id}
                    className={`dashboard-batch-card-mobile rounded-2xl border bg-white p-4 shadow-sm transition-colors dark:bg-surface-dark touch-manipulation select-none ${batchEditCardMotionClass} ${selectedResumeIdSet.has(resume.id)
                      ? 'border-primary/60 bg-primary/5 dark:border-primary/50 dark:bg-primary/10'
                      : 'border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800/40'
                      }`}
                    onClick={() => handleResumeCardClick(resume.id)}
                    onContextMenu={(event) => {
                      if (isMobile) {
                        event.preventDefault();
                      }
                    }}
                    onTouchStart={() => handleMobileLongPressStart(resume.id)}
                    onTouchMove={handleMobileLongPressCancel}
                    onTouchEnd={handleMobileLongPressCancel}
                    onTouchCancel={handleMobileLongPressCancel}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-base font-bold text-gray-900 dark:text-white">
                          {resume.name}
                        </h3>
                        <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                          <div>
                            <div className="text-gray-400">匹配度</div>
                            <div className={`mt-1 font-semibold ${resume.matchRate > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-900 dark:text-white'}`}>
                              {resume.matchRate > 0 ? `${resume.matchRate}%` : '草稿'}
                            </div>
                          </div>
                          <div>
                            <div className="text-gray-400">创建时间</div>
                            <div className="mt-1 font-semibold text-gray-900 dark:text-white">
                              {resume.createdAt}
                            </div>
                          </div>
                        </div>
                      </div>
                      {isBatchEditMode ? (
                        <button
                          aria-label={`${selectedResumeIdSet.has(resume.id) ? '取消选择' : '选择'} ${resume.name}`}
                          className={`dashboard-batch-selection-control flex h-9 w-9 items-center justify-center rounded-xl border transition-colors ${batchEditSelectionMotionClass} ${selectedResumeIdSet.has(resume.id)
                            ? 'border-primary bg-primary text-white'
                            : 'border-gray-200 bg-white text-gray-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-500'
                            }`}
                          onClick={(event) => handleSelectionIndicatorClick(resume.id, event)}
                          type="button"
                        >
                          {selectedResumeIdSet.has(resume.id) ? <Check className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                        </button>
                      ) : (
                        <button
                          className="dropdown-trigger rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-gray-700 dark:hover:text-white"
                          onClick={(e) => handleDropdownClick(e, resume.id)}
                          type="button"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </main>

      {/* Global Portal-like Dropdown */}
      {openDropdownId && dropdownPos && (
        <div
          ref={dropdownRef}
          className="dropdown-menu fixed w-48 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 py-1 z-[9999]"
          style={{ top: dropdownPos.top, left: dropdownPos.left }}
        >
          <button
            onClick={() => {
              if (openDropdownId) {
                openResume(openDropdownId);
              }
            }}
            className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2"
          >
            <Edit2 className="w-4 h-4" /> 编辑
          </button>
          <button
            onClick={(e) => {
              if (openDropdownId) {
                handlePreview(openDropdownId, e);
              }
            }}
            className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2"
          >
            <Eye className="w-4 h-4" /> 预览
          </button>
          <button
            onClick={(e) => {
              if (openDropdownId) {
                handleRename(openDropdownId, e);
              }
            }}
            className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2"
          >
            <PencilLine className="w-4 h-4" /> 重命名
          </button>
          <button onClick={(e) => handleCopy(openDropdownId, e)} className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2">
            <Copy className="w-4 h-4" /> 创建副本
          </button>
          <div className="h-px bg-gray-100 dark:bg-gray-700 my-1"></div>
          <button onClick={(e) => handleDelete(openDropdownId, e)} className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2">
            <Trash2 className="w-4 h-4" /> 删除
          </button>
        </div>
      )}
      <ConfirmDialog
        isOpen={pendingDeleteIds.length > 0}
        title={isBatchDeleting ? BULK_DELETE_CONFIRM_TITLE : DELETE_CONFIRM_TITLE}
        description={
          isBatchDeleting
            ? `确定删除已选择的 ${pendingDeleteIds.length} 份简历吗？此操作无法撤销。`
            : (
              deleteTarget
                ? `确定删除简历「${deleteTarget.name}」吗？此操作无法撤销。`
                : '确定删除该简历吗？此操作无法撤销。'
            )
        }
        confirmLabel={DELETE_CONFIRM_LABEL}
        cancelLabel={DELETE_CANCEL_LABEL}
        onConfirm={handleConfirmDelete}
        onCancel={handleCancelDelete}
        isConfirming={isDeletingResume}
      />
      <RenameResumeDialog
        isOpen={Boolean(renameTargetId && renameTarget)}
        initialName={renameTarget?.name ?? ''}
        isSaving={isRenamingResume}
        onConfirm={handleConfirmRename}
        onCancel={handleCancelRename}
      />
      <ResumePreviewModal
        isOpen={Boolean(previewTargetId && previewTarget)}
        resumeId={previewTarget?.id ?? null}
        resumeName={previewTarget?.name}
        onClose={handleClosePreview}
      />
      <ToastContainer toasts={toasts} onClose={closeToast} />
    </div>
  );
};

export default Dashboard;
