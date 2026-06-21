import { useCallback, useEffect, useRef, useState } from 'react';
import type { Resume } from '../../types';
import { ViewState } from '../../types';
import { resolveAuthUserKeyFromActiveSession } from '../../services/apiClient';
import { devLog } from '../../services/devLogger';
import { profileService, type Profile } from '../../services/profileService';
import { resumeService } from '../../services/resumeService';
import type { ToastConfig } from '../../components/Toast';
import { DEFAULT_RESUME_TITLE } from '../../constants/resumeConstants';
import { trackResumeDuplicated } from '../../utils/analyticsTracker';
import {
  mapResumeToDashboard,
  mapResumesToDashboard,
} from '../../utils/dashboardResumeMapper';
import { setActiveResumeId } from '../resumeStorage';
import { buildPreferredResumeCreateConfig } from '../resumeTemplateStorage';
import {
  areResumeListsEqual,
  mergeDashboardResumeServerUpdate,
  mergeMatchRatesIntoResumes,
} from './dashboardUtils';

type UpdateToast = (id: string, updates: Partial<Omit<ToastConfig, 'id'>>) => void;

type UseDashboardResumeListOptions = {
  cachedResumes: Resume[];
  cachedResumesOwnerKey: string | null;
  authUserKey: string | null;
  isAuthenticated: boolean;
  onRequireAuth: () => void | Promise<void>;
  userProfile?: Profile | null;
  setView: (view: ViewState, options?: { shouldOpenResumeUpload?: boolean }) => void;
  onResumesUpdate?: (resumes: Resume[]) => void;
  showToastLoading: (message: string) => string;
  updateToast: UpdateToast;
};

export type RenameResumeResult = 'renamed' | 'unchanged' | 'missing' | 'busy' | 'error';

const COPY_SUFFIX = ' (副本)';
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

export const useDashboardResumeList = ({
  cachedResumes,
  cachedResumesOwnerKey,
  authUserKey,
  isAuthenticated,
  onRequireAuth,
  userProfile,
  setView,
  onResumesUpdate,
  showToastLoading,
  updateToast,
}: UseDashboardResumeListOptions) => {
  const isCacheOwnerMatched = Boolean(
    cachedResumesOwnerKey && authUserKey && cachedResumesOwnerKey === authUserKey
  );
  const [resumes, setResumes] = useState<Resume[]>(() =>
    isCacheOwnerMatched ? cachedResumes : []
  );
  const [isLoading, setIsLoading] = useState(isAuthenticated && !isCacheOwnerMatched);
  const [error, setError] = useState<string | null>(null);
  const [isCreatingResume, setIsCreatingResume] = useState(false);
  const [isCopyingResume, setIsCopyingResume] = useState(false);
  const [isRenamingResume, setIsRenamingResume] = useState(false);
  const onResumesUpdateRef = useRef(onResumesUpdate);
  const lastSyncedResumesRef = useRef<Resume[] | null>(null);
  const lastLoadKeyRef = useRef<string | null>(null);

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

  const loadResumes = useCallback(async () => {
    if (!isAuthenticated) {
      setResumes([]);
      setError(null);
      setIsLoading(false);
      return;
    }
    try {
      setIsLoading(true);
      setError(null);
      devLog('[Dashboard] 开始加载简历列表...');
      const mappedResumes = await fetchDashboardResumes({ force: true });
      devLog(`[Dashboard] 加载成功，共 ${mappedResumes.length} 份简历`);
      setResumes(mappedResumes);
    } catch (err) {
      console.error('Failed to load resumes:', err);
      setError('加载简历列表失败,请稍后重试');
    } finally {
      setIsLoading(false);
    }
  }, [fetchDashboardResumes, isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) {
      lastLoadKeyRef.current = 'guest';
      setResumes([]);
      setError(null);
      setIsLoading(false);
      return;
    }
    const loadKey = authUserKey ?? 'unknown';
    if (lastLoadKeyRef.current === loadKey) {
      return;
    }
    lastLoadKeyRef.current = loadKey;
    if (!isCacheOwnerMatched) {
      setResumes([]);
    }
    void loadResumes();
  }, [authUserKey, isAuthenticated, isCacheOwnerMatched, loadResumes]);

  const createResume = useCallback(async () => {
    if (!isAuthenticated) {
      void onRequireAuth();
      return;
    }
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
      setResumes((prev) => [newResume, ...prev]);
      setActiveResumeId(created.id);
      setView(ViewState.EDITOR);
    } catch (error) {
      console.error('[Dashboard] 创建简历失败:', error);
    } finally {
      setIsCreatingResume(false);
    }
  }, [authUserKey, isAuthenticated, isCreatingResume, onRequireAuth, setView, userProfile]);

  const duplicateResume = useCallback(async (id: string, sourceName: string) => {
    if (!isAuthenticated) {
      void onRequireAuth();
      return;
    }
    if (isCopyingResume) {
      return;
    }
    const toastId = showToastLoading(COPY_TOAST_MESSAGES.loading);
    const startedAt = Date.now();
    try {
      setIsCopyingResume(true);
      const duplicated = await resumeService.duplicate(id, { title: `${sourceName}${COPY_SUFFIX}` });
      const nextResume = mapResumeToDashboard(duplicated);
      setResumes((prev) => [nextResume, ...prev]);
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
  }, [isAuthenticated, isCopyingResume, onRequireAuth, showToastLoading, updateToast]);

  const renameResume = useCallback(async (
    resumeId: string | null,
    nextName: string
  ): Promise<RenameResumeResult> => {
    if (!isAuthenticated) {
      void onRequireAuth();
      return 'busy';
    }
    if (!resumeId) {
      return 'missing';
    }
    if (isRenamingResume) {
      return 'busy';
    }
    const currentName = resumes.find((resume) => resume.id === resumeId)?.name ?? '';
    if (nextName === currentName) {
      return 'unchanged';
    }
    const toastId = showToastLoading(RENAME_TOAST_MESSAGES.loading);
    try {
      setIsRenamingResume(true);
      const updated = await resumeService.update(resumeId, { title: nextName });
      setResumes((prev) => prev.map((resume) =>
        resume.id === updated.id
          ? mergeDashboardResumeServerUpdate(resume, updated)
          : resume
      ));
      updateToast(toastId, { message: RENAME_TOAST_MESSAGES.success, type: 'success', duration: 2000 });
      return 'renamed';
    } catch (error) {
      console.error('[Dashboard] 重命名简历失败:', error);
      updateToast(toastId, { message: RENAME_TOAST_MESSAGES.error, type: 'error', duration: 3000 });
      return 'error';
    } finally {
      setIsRenamingResume(false);
    }
  }, [isAuthenticated, isRenamingResume, onRequireAuth, resumes, showToastLoading, updateToast]);

  return {
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
  };
};
