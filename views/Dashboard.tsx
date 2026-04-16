import React, { useMemo, useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react';
import { Plus, LayoutGrid, List, FileText, MoreHorizontal, Trash2, Copy, Edit2, Eye, PencilLine, UploadCloud, CheckSquare, Square, Check, X, LogIn, Bot, Sparkles } from 'lucide-react';
import { useLogto } from '@logto/react';
import { Resume, ViewState } from '../types';
import { resolveAuthUserKeyFromActiveSession } from '../services/apiClient';
import { resumeService } from '../services/resumeService';
import { profileService } from '../services/profileService';
import { useProfile } from '../hooks/useProfile';
import { resolveDisplayName } from '../utils/profileDisplay';
import { clearActiveResumeId, getActiveResumeId, setActiveResumeId } from './resumeStorage';
import {
  mapResumeToDashboard,
  mapResumesToDashboard,
  resolveDashboardResumeLocalMatchRate,
} from '../utils/dashboardResumeMapper';
import { DEFAULT_RESUME_TITLE } from '../constants/resumeConstants';
import ConfirmDialog from '../components/ConfirmDialog';
import { ToastContainer, useToast } from '../components/Toast';
import RenameResumeDialog from './Dashboard/components/RenameResumeDialog';
import ResumePreviewModal from './Dashboard/components/ResumePreviewModal';
import { trackResumeDuplicated } from '../utils/analyticsTracker';
import { formatRelativeTime } from '../utils/timeUtils';
import UnAuthPrompt from '../components/UnAuthPrompt';
import { buildPreferredResumeCreateConfig } from './resumeTemplateStorage';
import type { AssistantLaunchRequest } from './AIAssistant';

interface DashboardProps {
  setView: (view: ViewState, options?: { shouldOpenResumeUpload?: boolean }) => void;
  cachedResumes?: Resume[]; // 从 App 传入的缓存数据
  cachedResumesOwnerKey?: string | null;
  authUserKey?: string | null;
  onResumesUpdate?: (resumes: Resume[]) => void; // 更新缓存的回调
  onLaunchAssistant?: (request: AssistantLaunchRequest) => void;
}

const DELETE_CONFIRM_TITLE = '删除简历';
const BULK_DELETE_CONFIRM_TITLE = '批量删除简历';
const DELETE_CONFIRM_LABEL = '删除';
const DELETE_CANCEL_LABEL = '取消';
const COPY_SUFFIX = ' (副本)';
const VIEW_MODE_STORAGE_KEY = 'yuanzijianli.dashboardViewMode';
const DEFAULT_WELCOME_NAME = '即刻开始';
const MOBILE_LONG_PRESS_DURATION = 450;
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
const COPY_TOAST_MESSAGES = {
  loading: '正在创建副本...',
  success: '副本已创建',
  error: '创建副本失败，请重试',
} as const;
const RENAME_TOAST_MESSAGES = {
  loading: '正在更新名称...',
  success: '名称已更新',
  error: '重命名失败，请重试',
} as const;
const DROPDOWN_WIDTH = 192;
const DROPDOWN_OFFSET = 4;
const DROPDOWN_VIEWPORT_PADDING = 8;
// 首次定位时的预估高度，实际渲染后会用真实高度校正，避免菜单被视口裁切。
const DROPDOWN_ESTIMATED_HEIGHT = 200;

type DropdownAnchor = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

type DropdownPosition = {
  top: number;
  left: number;
};

const buildDropdownAnchor = (rect: DOMRect): DropdownAnchor => ({
  top: rect.top,
  right: rect.right,
  bottom: rect.bottom,
  left: rect.left,
});

const clampNumber = (value: number, min: number, max: number) => {
  return Math.min(Math.max(value, min), max);
};

const resolveDropdownPosition = (
  anchor: DropdownAnchor,
  menuSize: { width: number; height: number }
): DropdownPosition => {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const menuWidth = menuSize.width || DROPDOWN_WIDTH;
  const menuHeight = menuSize.height || DROPDOWN_ESTIMATED_HEIGHT;
  const spaceBelow = viewportHeight - anchor.bottom;
  const spaceAbove = anchor.top;
  const shouldOpenUp = spaceBelow < menuHeight + DROPDOWN_OFFSET && spaceAbove > spaceBelow;
  const maxTop = Math.max(DROPDOWN_VIEWPORT_PADDING, viewportHeight - menuHeight - DROPDOWN_VIEWPORT_PADDING);
  const maxLeft = Math.max(DROPDOWN_VIEWPORT_PADDING, viewportWidth - menuWidth - DROPDOWN_VIEWPORT_PADDING);
  const top = shouldOpenUp
    ? clampNumber(
      anchor.top - menuHeight - DROPDOWN_OFFSET,
      DROPDOWN_VIEWPORT_PADDING,
      maxTop
    )
    : clampNumber(
      anchor.bottom + DROPDOWN_OFFSET,
      DROPDOWN_VIEWPORT_PADDING,
      maxTop
    );
  const idealLeft = anchor.right - menuWidth;
  const left = clampNumber(
    idealLeft,
    DROPDOWN_VIEWPORT_PADDING,
    maxLeft
  );
  return { top, left };
};

const resolveStoredViewMode = (value: string | null): 'grid' | 'list' => {
  return value === 'list' ? 'list' : 'grid';
};

const mergeMatchRatesIntoResumes = (items: Resume[]) => {
  let changed = false;
  const next = items.map((resume) => {
    const localMatchRate = resolveDashboardResumeLocalMatchRate(resume.id);
    const matchRate = typeof localMatchRate === 'number' ? localMatchRate : resume.matchRate;
    const status = (matchRate > 0 ? 'final' : 'draft') as Resume['status'];
    if (resume.matchRate === matchRate && resume.status === status) {
      return resume;
    }
    changed = true;
    return { ...resume, matchRate, status };
  });
  return changed ? next : items;
};

const areResumeListsEqual = (prev: Resume[], next: Resume[]) => {
  if (prev === next) {
    return true;
  }
  if (prev.length !== next.length) {
    return false;
  }
  return prev.every((item, index) => {
    const other = next[index];
    return item.id === other.id
      && item.name === other.name
      && item.targetRole === other.targetRole
      && item.matchRate === other.matchRate
      && item.createdAt === other.createdAt
      && item.lastModified === other.lastModified
      && item.status === other.status
      && item.type === other.type;
  });
};

const Dashboard: React.FC<DashboardProps> = ({
  setView,
  cachedResumes = [],
  cachedResumesOwnerKey = null,
  authUserKey = null,
  onResumesUpdate,
  onLaunchAssistant,
}) => {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  const { profile: userProfile } = useProfile();
  const { signIn, isAuthenticated } = useLogto();
  const isCacheOwnerMatched = Boolean(
    cachedResumesOwnerKey && authUserKey && cachedResumesOwnerKey === authUserKey
  );
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(() =>
    resolveStoredViewMode(localStorage.getItem(VIEW_MODE_STORAGE_KEY))
  );
  const [resumes, setResumes] = useState<Resume[]>(() =>
    isCacheOwnerMatched ? cachedResumes : []
  );
  const [isLoading, setIsLoading] = useState(!isCacheOwnerMatched);
  const [error, setError] = useState<string | null>(null);
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const [dropdownAnchor, setDropdownAnchor] = useState<DropdownAnchor | null>(null);
  const [dropdownPos, setDropdownPos] = useState<DropdownPosition | null>(null);
  const [isCreatingResume, setIsCreatingResume] = useState(false);
  const [isDeletingResume, setIsDeletingResume] = useState(false);
  const [isCopyingResume, setIsCopyingResume] = useState(false);
  const [isRenamingResume, setIsRenamingResume] = useState(false);
  const [isBatchEditMode, setIsBatchEditMode] = useState(false);
  const [selectedResumeIds, setSelectedResumeIds] = useState<string[]>([]);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [batchDeleteTargetIds, setBatchDeleteTargetIds] = useState<string[]>([]);
  const [renameTargetId, setRenameTargetId] = useState<string | null>(null);
  const [previewTargetId, setPreviewTargetId] = useState<string | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressTriggeredRef = useRef(false);
  const welcomeName = resolveDisplayName(userProfile?.full_name, DEFAULT_WELCOME_NAME);
  const {
    toasts,
    loading: showToastLoading,
    updateToast,
    closeToast,
  } = useToast();

  // 使用 ref 存储回调，避免 useEffect 依赖项变化导致重复执行
  const onResumesUpdateRef = useRef(onResumesUpdate);

  // 同步最新的回调函数到 ref
  useEffect(() => {
    onResumesUpdateRef.current = onResumesUpdate;
  }, [onResumesUpdate]);

  useEffect(() => {
    if (!isCacheOwnerMatched) {
      return;
    }
    if (cachedResumes.length === 0) {
      setResumes((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    const hydrated = mergeMatchRatesIntoResumes(cachedResumes);
    setResumes((prev) => (areResumeListsEqual(prev, hydrated) ? prev : hydrated));
  }, [cachedResumes, isCacheOwnerMatched]);

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



  const lastSyncedResumesRef = useRef<Resume[] | null>(null);
  useEffect(() => {
    const handler = onResumesUpdateRef.current;
    if (!handler || lastSyncedResumesRef.current === resumes) {
      return;
    }
    lastSyncedResumesRef.current = resumes;
    handler(resumes);
  }, [resumes]);

  const fetchDashboardResumes = useCallback(async (options?: { force?: boolean }) => {
    const data = await resumeService.list(options);
    return mapResumesToDashboard(data);
  }, []);

  const loadKey = authUserKey ?? 'unknown';
  const lastLoadKeyRef = useRef<string | null>(null);
  const loadResumes = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      console.log('[Dashboard] 开始加载简历列表...');
      const mappedResumes = await fetchDashboardResumes({ force: true });
      console.log(`[Dashboard] 加载成功，共 ${mappedResumes.length} 份简历`);
      setResumes(mappedResumes);
    } catch (err) {
      console.error('Failed to load resumes:', err);
      setError('加载简历列表失败,请稍后重试');
    } finally {
      setIsLoading(false);
    }
  }, [fetchDashboardResumes]);

  // 从后端加载简历列表（用户切换时强制刷新）
  useEffect(() => {
    if (lastLoadKeyRef.current === loadKey) {
      return;
    }
    lastLoadKeyRef.current = loadKey;
    if (!isCacheOwnerMatched) {
      setResumes([]);
    }
    void loadResumes();
  }, [isCacheOwnerMatched, loadKey, loadResumes]);



  const effectiveViewMode = isMobile ? 'list' : viewMode;
  const selectedResumeIdSet = useMemo(() => new Set(selectedResumeIds), [selectedResumeIds]);
  const selectedCount = selectedResumeIds.length;
  const allSelected = resumes.length > 0 && selectedCount === resumes.length;
  const pendingDeleteIds = useMemo(() => {
    if (batchDeleteTargetIds.length > 0) {
      return batchDeleteTargetIds;
    }
    return deleteTargetId ? [deleteTargetId] : [];
  }, [batchDeleteTargetIds, deleteTargetId]);
  const isBatchDeleting = pendingDeleteIds.length > 1;

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const openResume = (id: string) => {
    setActiveResumeId(id);
    setView(ViewState.EDITOR);
  };

  const handleCreateResume = async () => {
    if (isCreatingResume) {
      return;
    }
    try {
      setIsCreatingResume(true);
      const profileForCreate = userProfile
        ?? await profileService.getProfile().catch(() => profileService.peekProfileForCurrentUser());
      const ownerId = profileForCreate?.user_id ?? authUserKey ?? await resolveAuthUserKeyFromActiveSession();
      const created = await resumeService.create({
        title: DEFAULT_RESUME_TITLE,
        config: buildPreferredResumeCreateConfig(
          profileForCreate?.extra_json,
          ownerId
        ),
      });
      const newResume = mapResumeToDashboard(created);
      setResumes((prev) => {
        return [newResume, ...prev];
      });
      setActiveResumeId(created.id);
      setView(ViewState.EDITOR);
    } catch (error) {
      console.error('[Dashboard] 创建简历失败:', error);
    } finally {
      setIsCreatingResume(false);
    }
  };

  const closeDropdown = useCallback(() => {
    setOpenDropdownId(null);
    setDropdownPos(null);
    setDropdownAnchor(null);
  }, []);

  const exitBatchEditMode = useCallback(() => {
    clearLongPressTimer();
    longPressTriggeredRef.current = false;
    setIsBatchEditMode(false);
    setSelectedResumeIds([]);
  }, [clearLongPressTimer]);

  const enterBatchEditMode = useCallback((initialId?: string) => {
    closeDropdown();
    setIsBatchEditMode(true);
    setSelectedResumeIds(initialId ? [initialId] : []);
  }, [closeDropdown]);

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
      toggleResumeSelection(id);
      return;
    }
    openResume(id);
  }, [isBatchEditMode, toggleResumeSelection]);

  const handleSelectionIndicatorClick = useCallback((id: string, event: React.MouseEvent) => {
    event.stopPropagation();
    toggleResumeSelection(id);
  }, [toggleResumeSelection]);

  const handleSelectAllToggle = useCallback(() => {
    setSelectedResumeIds((prev) => (
      prev.length === resumes.length ? [] : resumes.map((resume) => resume.id)
    ));
  }, [resumes]);

  const handleBatchDeleteRequest = useCallback(() => {
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
  }, [closeDropdown, selectedResumeIds, showToastLoading, updateToast]);

  const syncDropdownPosition = useCallback((anchor: DropdownAnchor) => {
    if (!dropdownRef.current) {
      return;
    }
    const rect = dropdownRef.current.getBoundingClientRect();
    const nextPos = resolveDropdownPosition(anchor, { width: rect.width, height: rect.height });
    setDropdownPos((prev) => {
      if (prev && prev.top === nextPos.top && prev.left === nextPos.left) {
        return prev;
      }
      return nextPos;
    });
  }, []);

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
    const anchor = buildDropdownAnchor(rect);
    setOpenDropdownId(id);
    setDropdownAnchor(anchor);
    setDropdownPos(resolveDropdownPosition(anchor, { width: DROPDOWN_WIDTH, height: DROPDOWN_ESTIMATED_HEIGHT }));
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setBatchDeleteTargetIds([]);
    setDeleteTargetId(id);
    closeDropdown();
  };

  const duplicateResume = async (id: string, sourceName: string) => {
    const toastId = showToastLoading(COPY_TOAST_MESSAGES.loading);
    const startedAt = Date.now();
    try {
      setIsCopyingResume(true);
      const duplicated = await resumeService.duplicate(id, { title: `${sourceName}${COPY_SUFFIX}` });
      const nextResume = mapResumeToDashboard(duplicated);
      setResumes((prev) => {
        return [nextResume, ...prev];
      });
      trackResumeDuplicated({
        source: 'dashboard',
        action: 'success',
        sourceResumeId: id,
        duplicatedResumeId: duplicated.id,
        durationMs: Date.now() - startedAt,
      });
      updateToast(toastId, { message: COPY_TOAST_MESSAGES.success, type: 'success', duration: 2000 });
    } catch (error) {
      console.error('[Dashboard] 创建副本失败:', error);
      trackResumeDuplicated({
        source: 'dashboard',
        action: 'error',
        sourceResumeId: id,
        durationMs: Date.now() - startedAt,
      });
      updateToast(toastId, { message: COPY_TOAST_MESSAGES.error, type: 'error', duration: 3000 });
    } finally {
      setIsCopyingResume(false);
    }
  };

  const handleCopy = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
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
    closeDropdown();
    setRenameTargetId(id);
  };

  const handlePreview = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    closeDropdown();
    setPreviewTargetId(id);
  };

  const handleConfirmRename = async (nextName: string) => {
    if (!renameTargetId || isRenamingResume) {
      return;
    }
    const currentName = resumes.find((resume) => resume.id === renameTargetId)?.name ?? '';
    if (nextName === currentName) {
      setRenameTargetId(null);
      return;
    }
    const toastId = showToastLoading(RENAME_TOAST_MESSAGES.loading);
    try {
      setIsRenamingResume(true);
      const updated = await resumeService.update(renameTargetId, { title: nextName });
      setResumes((prev) => {
        const next = prev.map((resume) =>
          resume.id === updated.id
            ? {
              ...resume,
              name: updated.title,
              lastModified: formatRelativeTime(updated.updated_at),
            }
            : resume
        );
        return next;
      });
      setRenameTargetId(null);
      updateToast(toastId, { message: RENAME_TOAST_MESSAGES.success, type: 'success', duration: 2000 });
    } catch (error) {
      console.error('[Dashboard] 重命名简历失败:', error);
      updateToast(toastId, { message: RENAME_TOAST_MESSAGES.error, type: 'error', duration: 3000 });
    } finally {
      setIsRenamingResume(false);
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
      console.log('[Dashboard] 删除请求完成，准备刷新列表:', targetIds);
      setDeleteTargetId(null);
      setBatchDeleteTargetIds([]);
      let refreshedResumes: Resume[] | null = null;
      try {
        refreshedResumes = await fetchDashboardResumes({ force: true });
        setResumes(refreshedResumes);
      } catch (refreshError) {
        console.error('[Dashboard] 删除后刷新列表失败:', refreshError);
        if (deletedIds.length > 0) {
          setResumes((prev) => prev.filter((resume) => !deletedIds.includes(resume.id)));
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
        setSelectedResumeIds((prev) => prev.filter((id) => !deletedIds.includes(id)));
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
      setSelectedResumeIds((prev) => prev.filter((id) => !confirmedDeletedIds.includes(id)));
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

  useLayoutEffect(() => {
    if (!openDropdownId || !dropdownAnchor) {
      return;
    }
    syncDropdownPosition(dropdownAnchor);
  }, [dropdownAnchor, openDropdownId, syncDropdownPosition]);

  useEffect(() => {
    if (!openDropdownId || !dropdownAnchor) {
      return;
    }
    const handleResize = () => syncDropdownPosition(dropdownAnchor);
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [dropdownAnchor, openDropdownId, syncDropdownPosition]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      // If clicking outside the dropdown menu
      const target = event.target as Element;
      if (!target.closest('.dropdown-menu') && !target.closest('.dropdown-trigger')) {
        closeDropdown();
      }
    };
    const handleScroll = () => closeDropdown();
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('scroll', handleScroll, true); // Close on scroll
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [closeDropdown]);

  useEffect(() => {
    setSelectedResumeIds((prev) => {
      const next = prev.filter((id) => resumes.some((resume) => resume.id === id));
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
  }, [onLaunchAssistant]);

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-gray-50 dark:bg-gray-900/50">
      {/* Header */}
      <header className="hidden border-b border-border-light bg-surface-light px-4 py-3 shrink-0 dark:border-border-dark dark:bg-surface-dark md:block md:px-8">
        <div className="flex flex-col gap-3 md:h-10 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-3 md:gap-4">
          <div className="flex items-center gap-2 text-primary hover:opacity-80 transition-opacity cursor-pointer">
            <FileText className="w-8 h-8" />
            <span className="font-bold text-lg tracking-tight text-gray-900 dark:text-white md:text-xl">原子简历</span>
          </div>
          <div className="hidden h-6 w-px bg-border-light dark:bg-border-dark md:block"></div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-gray-500 sm:text-sm">仪表盘 / Dashboard</span>
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
                    onClick={() => signIn(import.meta.env.VITE_LOGTO_REDIRECT_URI || window.location.href)}
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

            <div className="flex items-center gap-4">
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
              <button
                onClick={handleCreateResume}
                disabled={isCreatingResume}
                className={`hidden items-center gap-2 bg-primary hover:bg-primary-dark text-white px-6 py-3 rounded-xl text-base font-semibold transition-all shadow-lg shadow-primary/20 hover:shadow-primary/40 transform hover:-translate-y-0.5 disabled:opacity-60 disabled:hover:shadow-primary/20 disabled:transform-none md:flex ${isBatchEditMode ? 'md:hidden' : ''}`}
              >
                <Plus className="w-5 h-5" />
                {isCreatingResume ? '创建中...' : '创建新简历'}
              </button>
            </div>
          </div>

          {isBatchEditMode && resumes.length > 0 && (
            <div className="rounded-2xl border border-primary/15 bg-white/95 p-4 shadow-sm backdrop-blur dark:border-primary/20 dark:bg-surface-dark/95">
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
                      className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                      type="button"
                    >
                      {allSelected ? '取消全选' : '全选'}
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
                    className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                    type="button"
                  >
                    {allSelected ? '取消全选' : '全选'}
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

          {effectiveViewMode === 'grid' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
              {resumes.map(resume => (
                <div
                  key={resume.id}
                  onClick={() => handleResumeCardClick(resume.id)}
                  className={`group bg-white dark:bg-surface-dark rounded-2xl border overflow-hidden transition-all duration-300 flex flex-col relative cursor-pointer ${selectedResumeIdSet.has(resume.id)
                    ? 'border-primary/60 shadow-xl shadow-primary/10 ring-2 ring-primary/20 dark:border-primary/50'
                    : 'border-gray-200 hover:shadow-xl hover:border-primary/30 dark:border-gray-700'
                    }`}
                >
                  {isBatchEditMode && (
                    <button
                      className={`absolute left-4 top-4 z-20 flex h-9 w-9 items-center justify-center rounded-full border shadow-sm transition-all ${selectedResumeIdSet.has(resume.id)
                        ? 'border-primary bg-primary text-white'
                        : 'border-white/80 bg-white/90 text-gray-400 dark:border-gray-600 dark:bg-gray-800/90 dark:text-gray-500'
                        }`}
                      onClick={(event) => handleSelectionIndicatorClick(resume.id, event)}
                      type="button"
                    >
                      {selectedResumeIdSet.has(resume.id) ? <Check className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                    </button>
                  )}
                  <div className="aspect-[210/297] bg-gray-100 dark:bg-gray-900 relative p-6 overflow-hidden border-b border-gray-100 dark:border-gray-800">
                    <div className="w-full h-full bg-white dark:bg-gray-800 shadow-sm p-3 md:p-4 transform group-hover:scale-[1.02] transition-transform duration-500 origin-top opacity-90 flex flex-col gap-2">
                      {/* Mini Resume Visuals */}
                      <div className="h-3 w-1/3 bg-gray-200 dark:bg-gray-700 rounded-sm mb-2"></div>
                      <div className="h-1.5 w-full bg-gray-100 dark:bg-gray-700 rounded-sm"></div>
                      <div className="h-1.5 w-5/6 bg-gray-100 dark:bg-gray-700 rounded-sm"></div>
                      <div className="h-1.5 w-full bg-gray-100 dark:bg-gray-700 rounded-sm"></div>
                      <div className="h-2 w-1/4 bg-gray-200 dark:bg-gray-700 rounded-sm mt-2 mb-1"></div>
                      <div className="space-y-1">
                        <div className="h-1 w-full bg-gray-100 dark:bg-gray-700 rounded-sm"></div>
                        <div className="h-1 w-11/12 bg-gray-100 dark:bg-gray-700 rounded-sm"></div>
                        <div className="h-1 w-full bg-gray-100 dark:bg-gray-700 rounded-sm"></div>
                      </div>
                    </div>
                    {!isBatchEditMode && (
                      <div className="absolute inset-0 bg-gray-900/5 dark:bg-gray-900/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                        <button
                          className="pointer-events-auto flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-white/90 dark:bg-gray-800/90 text-gray-900 dark:text-white rounded-full shadow-lg hover:shadow-xl transition-shadow"
                          onClick={(e) => handlePreview(resume.id, e)}
                        >
                          <Eye className="w-4 h-4" />
                          预览
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="p-5 flex-1 flex flex-col">
                    <div className="flex justify-between items-start mb-1">
                      <h3 className="font-bold text-gray-900 dark:text-white truncate pr-2 text-lg">{resume.name}</h3>
                    </div>
                    {resume.matchRate > 0 && (
                      <div className="mb-4">
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
                  className="group flex flex-col items-center justify-center h-full min-h-[400px] rounded-2xl border-2 border-dashed border-gray-200 dark:border-gray-700 hover:border-primary/50 hover:bg-primary/5 transition-all duration-300 disabled:opacity-60 disabled:hover:bg-transparent disabled:hover:border-gray-200"
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
                    {resumes.map(resume => (
                      <tr
                        key={resume.id}
                        className={`group transition-colors cursor-pointer ${selectedResumeIdSet.has(resume.id)
                          ? 'bg-primary/5 dark:bg-primary/10'
                          : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
                          }`}
                        onClick={() => handleResumeCardClick(resume.id)}
                      >
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-4">
                            {isBatchEditMode && (
                              <button
                                className={`flex h-8 w-8 items-center justify-center rounded-lg border transition-colors ${selectedResumeIdSet.has(resume.id)
                                  ? 'border-primary bg-primary text-white'
                                  : 'border-gray-200 bg-white text-gray-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-500'
                                  }`}
                                onClick={(event) => handleSelectionIndicatorClick(resume.id, event)}
                                type="button"
                              >
                                {selectedResumeIdSet.has(resume.id) ? <Check className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                              </button>
                            )}
                            <div className="p-2.5 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 rounded-lg shrink-0">
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
                {resumes.map((resume) => (
                  <div
                    key={resume.id}
                    className={`rounded-2xl border bg-white p-4 shadow-sm transition-colors dark:bg-surface-dark touch-manipulation select-none ${selectedResumeIdSet.has(resume.id)
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
                          className={`flex h-9 w-9 items-center justify-center rounded-xl border transition-colors ${selectedResumeIdSet.has(resume.id)
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
