import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Plus, LayoutGrid, List, FileText, MoreHorizontal, Moon, Sun, Bell, Trash2, Copy, Edit2, LayoutTemplate, Eye, PencilLine } from 'lucide-react';
import { Resume, ViewState } from '../types';
import { resumeService } from '../services/resumeService';
import { useProfile } from '../hooks/useProfile';
import { resolveDisplayName } from '../utils/profileDisplay';
import { clearActiveResumeId, getActiveResumeId, setActiveResumeId } from './resumeStorage';
import { formatRelativeTime } from '../utils/timeUtils';
import { clampMatchScore } from '../utils/resumeHelpers';
import { DEFAULT_RESUME_TITLE } from '../constants/resumeConstants';
import ConfirmDialog from '../components/ConfirmDialog';
import { ToastContainer, useToast } from '../components/Toast';
import RenameResumeDialog from './Dashboard/components/RenameResumeDialog';
import ResumePreviewModal from './Dashboard/components/ResumePreviewModal';
import { loadJDAnalysisCache } from './jdAnalysisStorage';

interface DashboardProps {
  setView: (view: ViewState) => void;
  cachedResumes?: Resume[]; // 从 App 传入的缓存数据
  onResumesUpdate?: (resumes: Resume[]) => void; // 更新缓存的回调
}

const DELETE_CONFIRM_TITLE = '删除简历';
const DELETE_CONFIRM_LABEL = '删除';
const DELETE_CANCEL_LABEL = '取消';
const COPY_SUFFIX = ' (副本)';
const VIEW_MODE_STORAGE_KEY = 'resumeFlow.dashboardViewMode';
const DEFAULT_WELCOME_NAME = '即刻开始';
const DEFAULT_MATCH_RATE = 0;
const DELETE_TOAST_MESSAGES = {
  loading: '正在删除简历...',
  success: '删除成功',
  error: '删除失败，请重试',
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

const resolveStoredViewMode = (value: string | null): 'grid' | 'list' => {
  return value === 'list' ? 'list' : 'grid';
};

const resolveResumeMatchRate = (resumeId: string) => {
  const cached = loadJDAnalysisCache(resumeId);
  const score = clampMatchScore(cached?.result?.matchPercentage);
  return typeof score === 'number' ? score : DEFAULT_MATCH_RATE;
};

const mergeMatchRatesIntoResumes = (items: Resume[]) => {
  let changed = false;
  const next = items.map((resume) => {
    const matchRate = resolveResumeMatchRate(resume.id);
    if (resume.matchRate === matchRate) {
      return resume;
    }
    changed = true;
    return { ...resume, matchRate };
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
      && item.lastModified === other.lastModified
      && item.status === other.status
      && item.type === other.type;
  });
};

const mapResumeToDashboard = (resume: {
  id: string;
  title: string;
  target_role?: string;
  updated_at: string;
}): Resume => ({
  id: resume.id,
  name: resume.title,
  targetRole: resume.target_role || '通用',
  matchRate: resolveResumeMatchRate(resume.id),
  lastModified: formatRelativeTime(resume.updated_at),
  status: 'draft',
  type: 'general',
});

type ResumeRecord = Parameters<typeof mapResumeToDashboard>[0];

const mapResumesToDashboard = (resumes: ResumeRecord[]) => resumes.map(mapResumeToDashboard);

const Dashboard: React.FC<DashboardProps> = ({ setView, cachedResumes = [], onResumesUpdate }) => {
  const [isDarkMode, setIsDarkMode] = useState(false);
  const { profile: userProfile } = useProfile();
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(() =>
    resolveStoredViewMode(localStorage.getItem(VIEW_MODE_STORAGE_KEY))
  );
  const [resumes, setResumes] = useState<Resume[]>(cachedResumes);
  const [isLoading, setIsLoading] = useState(cachedResumes.length === 0);
  const [error, setError] = useState<string | null>(null);
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number, left: number } | null>(null);
  const [isCreatingResume, setIsCreatingResume] = useState(false);
  const [isDeletingResume, setIsDeletingResume] = useState(false);
  const [isCopyingResume, setIsCopyingResume] = useState(false);
  const [isRenamingResume, setIsRenamingResume] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [renameTargetId, setRenameTargetId] = useState<string | null>(null);
  const [previewTargetId, setPreviewTargetId] = useState<string | null>(null);
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
    if (cachedResumes.length === 0) {
      setResumes((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    const hydrated = mergeMatchRatesIntoResumes(cachedResumes);
    setResumes((prev) => (areResumeListsEqual(prev, hydrated) ? prev : hydrated));
  }, [cachedResumes]);

  useEffect(() => {
    localStorage.setItem(VIEW_MODE_STORAGE_KEY, viewMode);
  }, [viewMode]);

  const lastSyncedResumesRef = useRef<Resume[] | null>(null);
  useEffect(() => {
    const handler = onResumesUpdateRef.current;
    if (!handler || lastSyncedResumesRef.current === resumes) {
      return;
    }
    lastSyncedResumesRef.current = resumes;
    handler(resumes);
  }, [resumes]);

  const fetchDashboardResumes = async (options?: { force?: boolean }) => {
    const data = await resumeService.list(options);
    return mapResumesToDashboard(data);
  };

  // 从后端加载简历列表
  useEffect(() => {
    const loadResumes = async () => {
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
    };

    // 只在组件挂载时执行一次，如果有缓存数据则直接使用
    if (resumes.length === 0) {
      loadResumes();
    } else {
      console.log('[Dashboard] 已有数据，跳过加载');
    }
  }, []); // ✅ 空依赖数组，只在挂载时执行一次

  const toggleTheme = () => {
    setIsDarkMode(!isDarkMode);
    document.documentElement.classList.toggle('dark');
  };

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
      const created = await resumeService.create({ title: DEFAULT_RESUME_TITLE });
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

  const handleDropdownClick = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (openDropdownId === id) {
      setOpenDropdownId(null);
      setDropdownPos(null);
    } else {
      const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
      setOpenDropdownId(id);
      // Position the fixed dropdown near the button
      setDropdownPos({
        top: rect.bottom + window.scrollY + 4,
        left: rect.right - 192 + window.scrollX // 192px is w-48
      });
    }
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteTargetId(id);
    setOpenDropdownId(null);
  };

  const duplicateResume = async (id: string, sourceName: string) => {
    const toastId = showToastLoading(COPY_TOAST_MESSAGES.loading);
    try {
      setIsCopyingResume(true);
      const duplicated = await resumeService.duplicate(id, { title: `${sourceName}${COPY_SUFFIX}` });
      const nextResume = mapResumeToDashboard(duplicated);
      setResumes((prev) => {
        return [nextResume, ...prev];
      });
      updateToast(toastId, { message: COPY_TOAST_MESSAGES.success, type: 'success', duration: 2000 });
    } catch (error) {
      console.error('[Dashboard] 创建副本失败:', error);
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
    setOpenDropdownId(null);
    const source = resumes.find(r => r.id === id);
    if (!source) {
      return;
    }
    void duplicateResume(id, source.name);
  };

  const handleRename = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setOpenDropdownId(null);
    setRenameTargetId(id);
  };

  const handlePreview = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setOpenDropdownId(null);
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

  const deleteTarget = useMemo(
    () => resumes.find((resume) => resume.id === deleteTargetId) ?? null,
    [deleteTargetId, resumes]
  );
  const renameTarget = useMemo(
    () => resumes.find((resume) => resume.id === renameTargetId) ?? null,
    [renameTargetId, resumes]
  );
  const previewTarget = useMemo(
    () => resumes.find((resume) => resume.id === previewTargetId) ?? null,
    [previewTargetId, resumes]
  );

  const handleConfirmDelete = async () => {
    if (!deleteTargetId || isDeletingResume) {
      return;
    }
    const targetId = deleteTargetId;
    const toastId = showToastLoading(DELETE_TOAST_MESSAGES.loading);
    try {
      setIsDeletingResume(true);
      await resumeService.remove(targetId);
      resumeService.clearListCache();
      console.log('[Dashboard] 删除请求完成，准备刷新列表:', targetId);
      if (getActiveResumeId() === targetId) {
        clearActiveResumeId();
      }
      setDeleteTargetId(null);
      if (renameTargetId === targetId) {
        setRenameTargetId(null);
      }
      if (previewTargetId === targetId) {
        setPreviewTargetId(null);
      }
      let refreshedResumes: Resume[] | null = null;
      try {
        refreshedResumes = await fetchDashboardResumes({ force: true });
        setResumes(refreshedResumes);
      } catch (refreshError) {
        console.error('[Dashboard] 删除后刷新列表失败:', refreshError);
        setResumes((prev) => prev.filter((resume) => resume.id !== targetId));
        updateToast(toastId, { message: DELETE_VERIFY_MESSAGES.syncFailed, type: 'error', duration: 3000 });
        return;
      }
      const stillExists = refreshedResumes.some((resume) => resume.id === targetId);
      if (stillExists) {
        console.warn('[Dashboard] 删除后列表仍包含该简历，请检查后端删除逻辑:', targetId);
      }
      updateToast(toastId, {
        message: stillExists ? DELETE_VERIFY_MESSAGES.notRemoved : DELETE_TOAST_MESSAGES.success,
        type: stillExists ? 'error' : 'success',
        duration: stillExists ? 3000 : 2000,
      });
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
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      // If clicking outside the dropdown menu
      const target = event.target as Element;
      if (!target.closest('.dropdown-menu') && !target.closest('.dropdown-trigger')) {
        setOpenDropdownId(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('scroll', () => setOpenDropdownId(null), true); // Close on scroll
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('scroll', () => setOpenDropdownId(null), true);
    };
  }, []);

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-gray-50 dark:bg-gray-900/50">
      {/* Header */}
      <header className="h-16 bg-surface-light dark:bg-surface-dark border-b border-border-light dark:border-border-dark flex items-center justify-between px-8 shrink-0">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-primary hover:opacity-80 transition-opacity cursor-pointer">
            <FileText className="w-8 h-8" />
            <span className="font-bold text-xl tracking-tight text-gray-900 dark:text-white">ResumeFLOW</span>
          </div>
          <div className="h-6 w-px bg-border-light dark:bg-border-dark"></div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-500">仪表盘 / Dashboard</span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <button
            className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400 transition-colors"
            onClick={toggleTheme}
          >
            {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>
          <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-gray-500">
            <Bell className="w-4 h-4" />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-8">
        <div className="max-w-7xl mx-auto space-y-10">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">欢迎回来，{welcomeName}</h1>
              <p className="text-gray-500 dark:text-gray-400 flex items-center gap-2">
                <span className="inline-block w-2 h-2 rounded-full bg-emerald-500"></span>
                你已创建了 <span className="font-bold text-gray-900 dark:text-white">{resumes.length}</span> 份简历。
              </p>
            </div>

            <div className="flex items-center gap-4">
              <div className="hidden sm:flex items-center bg-white dark:bg-surface-dark border border-gray-200 dark:border-gray-700 rounded-lg p-1 shadow-sm">
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
              <button
                onClick={handleCreateResume}
                disabled={isCreatingResume}
                className="flex items-center gap-2 bg-primary hover:bg-primary-dark text-white px-6 py-3 rounded-xl text-base font-semibold transition-all shadow-lg shadow-primary/20 hover:shadow-primary/40 transform hover:-translate-y-0.5 disabled:opacity-60 disabled:hover:shadow-primary/20 disabled:transform-none"
              >
                <Plus className="w-5 h-5" />
                {isCreatingResume ? '创建中...' : '创建新简历'}
              </button>
            </div>
          </div>

          {viewMode === 'grid' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
              {resumes.map(resume => (
                <div key={resume.id} onClick={() => openResume(resume.id)} className="group bg-white dark:bg-surface-dark rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden hover:shadow-xl hover:border-primary/30 transition-all duration-300 flex flex-col relative cursor-pointer">
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
                    <div className="absolute inset-0 bg-gray-900/5 dark:bg-gray-900/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                      <button
                        className="pointer-events-auto flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-white/90 dark:bg-gray-800/90 text-gray-900 dark:text-white rounded-full shadow-lg hover:shadow-xl transition-shadow"
                        onClick={(e) => handlePreview(resume.id, e)}
                      >
                        <Eye className="w-4 h-4" />
                        预览
                      </button>
                    </div>
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
                      <div className="relative">
                        <button
                          className="p-1.5 text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors dropdown-trigger"
                          onClick={(e) => handleDropdownClick(e, resume.id)}
                        >
                          <MoreHorizontal className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
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
            </div>
          ) : (
            <div className="bg-white dark:bg-surface-dark rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden shadow-sm min-h-[500px]">
              <div className="overflow-x-auto">
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
                      <tr key={resume.id} className="group hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors cursor-pointer" onClick={() => openResume(resume.id)}>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-4">
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
                          <div className="flex items-center justify-end gap-3">
                            <button
                              className="p-1.5 text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors dropdown-trigger"
                              onClick={(e) => handleDropdownClick(e, resume.id)}
                            >
                              <MoreHorizontal className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Global Portal-like Dropdown */}
      {openDropdownId && dropdownPos && (
        <div
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
        isOpen={Boolean(deleteTargetId)}
        title={DELETE_CONFIRM_TITLE}
        description={
          deleteTarget
            ? `确定删除简历「${deleteTarget.name}」吗？此操作无法撤销。`
            : '确定删除该简历吗？此操作无法撤销。'
        }
        confirmLabel={DELETE_CONFIRM_LABEL}
        cancelLabel={DELETE_CANCEL_LABEL}
        onConfirm={handleConfirmDelete}
        onCancel={handleCancelDelete}
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
