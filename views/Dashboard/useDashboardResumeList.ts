import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type SetStateAction,
} from 'react';
import type { Resume } from '../../types';
import { ViewState } from '../../types';
import { devLog } from '../../services/devLogger';
import { profileService, type Profile } from '../../services/profileService';
import {
  assertResumeAuthContext,
  captureResumeAuthCacheKey,
  isResumeVersionConflict,
  resumeService,
} from '../../services/resumeService';
import type { ToastConfig } from '../../components/Toast';
import { DEFAULT_RESUME_TITLE } from '../../constants/resumeConstants';
import { trackResumeDuplicated } from '../../utils/analyticsTracker';
import {
  mapResumeToDashboard,
  mapResumesToDashboard,
} from '../../utils/dashboardResumeMapper';
import { setActiveResumeId } from '../../services/resumeStorage';
import { buildPreferredResumeCreateConfig } from '../../services/resumeTemplateStorage';
import {
  areResumeListsEqual,
  mergeDashboardResumeServerUpdate,
  mergeEvaluationScoresIntoResumes,
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
  closeToast: (id: string) => void;
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

type DashboardResumeListRequestOptions = {
  force?: boolean;
  expectedAuthCacheKey?: string;
};

const canCommitOwnerOperation = async (
  expectedAuthCacheKey: string,
  requestGeneration: number,
  generationRef: { current: number },
) => {
  if (generationRef.current !== requestGeneration) {
    return false;
  }
  try {
    await assertResumeAuthContext(expectedAuthCacheKey);
  } catch {
    return false;
  }
  return generationRef.current === requestGeneration;
};

const isResolvedAuthenticatedOwner = (
  isAuthenticated: boolean,
  ownerKey: string | null,
): ownerKey is string => (
  isAuthenticated
  && typeof ownerKey === 'string'
  && ownerKey.trim().length > 0
  && ownerKey !== 'anonymous'
);

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
  closeToast,
}: UseDashboardResumeListOptions) => {
  const hasResolvedAuthOwner = isResolvedAuthenticatedOwner(isAuthenticated, authUserKey);
  const isCacheOwnerMatched = Boolean(
    hasResolvedAuthOwner
    && cachedResumesOwnerKey
    && cachedResumesOwnerKey === authUserKey
  );
  const [resumes, setResumes] = useState<Resume[]>(() =>
    isCacheOwnerMatched ? cachedResumes : []
  );
  const [resumesOwnerKey, setResumesOwnerKey] = useState<string | null>(() =>
    isCacheOwnerMatched ? authUserKey : null
  );
  const [isLoading, setIsLoading] = useState(isAuthenticated && !isCacheOwnerMatched);
  const [error, setError] = useState<string | null>(null);
  const [isCreatingResume, setIsCreatingResume] = useState(false);
  const [isCopyingResume, setIsCopyingResume] = useState(false);
  const [isRenamingResume, setIsRenamingResume] = useState(false);
  const onResumesUpdateRef = useRef(onResumesUpdate);
  const lastSyncedResumesRef = useRef<Resume[] | null>(null);
  const lastLoadKeyRef = useRef<string | null>(null);
  const loadRequestGenerationRef = useRef(0);
  const createRequestGenerationRef = useRef(0);
  const copyRequestGenerationRef = useRef(0);
  const renameRequestGenerationRef = useRef(0);
  const committedAuthUserKeyRef = useRef(authUserKey);
  const createOperationOwnerRef = useRef<string | null>(null);
  const copyOperationOwnerRef = useRef<string | null>(null);
  const renameOperationOwnerRef = useRef<string | null>(null);
  const copyToastIdRef = useRef<string | null>(null);
  const renameToastIdRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    if (committedAuthUserKeyRef.current === authUserKey) {
      return;
    }
    committedAuthUserKeyRef.current = authUserKey;
    loadRequestGenerationRef.current += 1;
    createRequestGenerationRef.current += 1;
    copyRequestGenerationRef.current += 1;
    renameRequestGenerationRef.current += 1;
  }, [authUserKey]);

  const visibleResumes = useMemo(
    () => hasResolvedAuthOwner && resumesOwnerKey === authUserKey ? resumes : [],
    [authUserKey, hasResolvedAuthOwner, resumes, resumesOwnerKey],
  );
  const setOwnerScopedResumes = useCallback((update: SetStateAction<Resume[]>) => {
    if (!hasResolvedAuthOwner) {
      return;
    }
    setResumesOwnerKey(authUserKey);
    setResumes(update);
  }, [authUserKey, hasResolvedAuthOwner]);

  useEffect(() => {
    onResumesUpdateRef.current = onResumesUpdate;
  }, [onResumesUpdate]);

  useEffect(() => {
    if (!hasResolvedAuthOwner) {
      setResumes([]);
      setError(null);
    }
    setResumesOwnerKey((currentOwnerKey) => (
      hasResolvedAuthOwner && currentOwnerKey === authUserKey ? currentOwnerKey : null
    ));
    if (createOperationOwnerRef.current !== authUserKey) {
      setIsCreatingResume(false);
    }
    if (copyOperationOwnerRef.current !== authUserKey) {
      setIsCopyingResume(false);
      if (copyToastIdRef.current) {
        closeToast(copyToastIdRef.current);
        copyToastIdRef.current = null;
      }
    }
    if (renameOperationOwnerRef.current !== authUserKey) {
      setIsRenamingResume(false);
      if (renameToastIdRef.current) {
        closeToast(renameToastIdRef.current);
        renameToastIdRef.current = null;
      }
    }
  }, [authUserKey, closeToast, hasResolvedAuthOwner]);

  useEffect(() => {
    if (!isCacheOwnerMatched) {
      return;
    }
    if (cachedResumes.length === 0) {
      setResumesOwnerKey(authUserKey);
      setResumes((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    const hydrated = mergeMatchRatesIntoResumes(
      mergeEvaluationScoresIntoResumes(cachedResumes, authUserKey),
      authUserKey,
    );
    setResumesOwnerKey(authUserKey);
    setResumes((prev) => (areResumeListsEqual(prev, hydrated) ? prev : hydrated));
  }, [authUserKey, cachedResumes, isCacheOwnerMatched]);

  useEffect(() => {
    const handler = onResumesUpdateRef.current;
    if (!handler || lastSyncedResumesRef.current === visibleResumes) {
      return;
    }
    lastSyncedResumesRef.current = visibleResumes;
    handler(visibleResumes);
  }, [visibleResumes]);

  const fetchDashboardResumes = useCallback(async (
    options?: DashboardResumeListRequestOptions
  ) => {
    if (!options?.expectedAuthCacheKey && !hasResolvedAuthOwner) {
      throw new Error('Authenticated resume owner is not resolved');
    }
    const expectedAuthCacheKey = options?.expectedAuthCacheKey
      ?? await captureResumeAuthCacheKey(authUserKey);
    await assertResumeAuthContext(expectedAuthCacheKey);
    const data = await resumeService.list({
      force: options?.force,
      expectedAuthCacheKey,
    });
    await assertResumeAuthContext(expectedAuthCacheKey);
    return mapResumesToDashboard(data, expectedAuthCacheKey);
  }, [authUserKey, hasResolvedAuthOwner]);

  const loadResumes = useCallback(async () => {
    if (!isAuthenticated) {
      loadRequestGenerationRef.current += 1;
      setResumesOwnerKey(null);
      setResumes([]);
      setError(null);
      setIsLoading(false);
      return;
    }
    if (!hasResolvedAuthOwner) {
      loadRequestGenerationRef.current += 1;
      setResumesOwnerKey(null);
      setResumes([]);
      setError(null);
      setIsLoading(true);
      return;
    }
    let expectedAuthCacheKey: string;
    try {
      expectedAuthCacheKey = await captureResumeAuthCacheKey(authUserKey);
    } catch {
      return;
    }
    const requestGeneration = (loadRequestGenerationRef.current += 1);
    try {
      setIsLoading(true);
      setError(null);
      devLog('[Dashboard] 开始加载简历列表...');
      const mappedResumes = await fetchDashboardResumes({
        force: true,
        expectedAuthCacheKey,
      });
      if (!await canCommitOwnerOperation(
        expectedAuthCacheKey,
        requestGeneration,
        loadRequestGenerationRef,
      )) {
        return;
      }
      devLog(`[Dashboard] 加载成功，共 ${mappedResumes.length} 份简历`);
      setResumesOwnerKey(expectedAuthCacheKey);
      setResumes(mappedResumes);
    } catch (err) {
      if (!await canCommitOwnerOperation(
        expectedAuthCacheKey,
        requestGeneration,
        loadRequestGenerationRef,
      )) {
        return;
      }
      console.error('Failed to load resumes:', err);
      setError('加载简历列表失败,请稍后重试');
    } finally {
      if (await canCommitOwnerOperation(
        expectedAuthCacheKey,
        requestGeneration,
        loadRequestGenerationRef,
      )) {
        setIsLoading(false);
      }
    }
  }, [authUserKey, fetchDashboardResumes, hasResolvedAuthOwner, isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) {
      loadRequestGenerationRef.current += 1;
      lastLoadKeyRef.current = 'guest';
      setResumesOwnerKey(null);
      setResumes([]);
      setError(null);
      setIsLoading(false);
      return;
    }
    if (!hasResolvedAuthOwner) {
      loadRequestGenerationRef.current += 1;
      lastLoadKeyRef.current = 'owner-pending';
      setResumesOwnerKey(null);
      setResumes([]);
      setError(null);
      setIsLoading(true);
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
  }, [authUserKey, hasResolvedAuthOwner, isAuthenticated, isCacheOwnerMatched, loadResumes]);

  const createResume = useCallback(async () => {
    if (!isAuthenticated) {
      void onRequireAuth();
      return;
    }
    if (!hasResolvedAuthOwner) {
      return;
    }
    if (isCreatingResume && createOperationOwnerRef.current === authUserKey) {
      return;
    }
    let expectedAuthCacheKey: string;
    try {
      expectedAuthCacheKey = await captureResumeAuthCacheKey(authUserKey);
    } catch (error) {
      console.error('[Dashboard] 登录账号已切换，取消创建简历:', error);
      return;
    }
    const requestGeneration = (createRequestGenerationRef.current += 1);
    createOperationOwnerRef.current = expectedAuthCacheKey;
    try {
      setIsCreatingResume(true);
      let profileForCreate = userProfile ?? null;
      if (!profileForCreate) {
        try {
          profileForCreate = await profileService.getProfile({ expectedAuthCacheKey });
        } catch {
          await assertResumeAuthContext(expectedAuthCacheKey);
          profileForCreate = await profileService.peekProfileForCurrentUser({
            expectedAuthCacheKey,
          });
          await assertResumeAuthContext(expectedAuthCacheKey);
        }
      }
      const createPayload = {
        title: DEFAULT_RESUME_TITLE,
        config: buildPreferredResumeCreateConfig(
          profileForCreate?.extra_json,
          profileForCreate?.user_id ?? expectedAuthCacheKey
        ),
      };
      if (!await canCommitOwnerOperation(
        expectedAuthCacheKey,
        requestGeneration,
        createRequestGenerationRef,
      )) {
        return;
      }
      const created = await resumeService.create(createPayload, { expectedAuthCacheKey });
      if (!await canCommitOwnerOperation(
        expectedAuthCacheKey,
        requestGeneration,
        createRequestGenerationRef,
      )) {
        return;
      }
      const newResume = mapResumeToDashboard(created, expectedAuthCacheKey);
      setResumesOwnerKey(expectedAuthCacheKey);
      setResumes((prev) => [newResume, ...prev]);
      setActiveResumeId(expectedAuthCacheKey, created.id);
      setView(ViewState.EDITOR);
    } catch (error) {
      if (await canCommitOwnerOperation(
        expectedAuthCacheKey,
        requestGeneration,
        createRequestGenerationRef,
      )) {
        console.error('[Dashboard] 创建简历失败:', error);
      }
    } finally {
      if (await canCommitOwnerOperation(
        expectedAuthCacheKey,
        requestGeneration,
        createRequestGenerationRef,
      )) {
        setIsCreatingResume(false);
        createOperationOwnerRef.current = null;
      }
    }
  }, [authUserKey, hasResolvedAuthOwner, isAuthenticated, isCreatingResume, onRequireAuth, setView, userProfile]);

  const duplicateResume = useCallback(async (id: string, sourceName: string) => {
    if (!isAuthenticated) {
      void onRequireAuth();
      return;
    }
    if (!hasResolvedAuthOwner) {
      return;
    }
    if (isCopyingResume && copyOperationOwnerRef.current === authUserKey) {
      return;
    }
    let expectedAuthCacheKey: string;
    try {
      expectedAuthCacheKey = await captureResumeAuthCacheKey(authUserKey);
    } catch {
      return;
    }
    const requestGeneration = (copyRequestGenerationRef.current += 1);
    copyOperationOwnerRef.current = expectedAuthCacheKey;
    const toastId = showToastLoading(COPY_TOAST_MESSAGES.loading);
    copyToastIdRef.current = toastId;
    const startedAt = Date.now();
    try {
      setIsCopyingResume(true);
      const duplicated = await resumeService.duplicate(
        id,
        { title: `${sourceName}${COPY_SUFFIX}` },
        { expectedAuthCacheKey },
      );
      if (!await canCommitOwnerOperation(
        expectedAuthCacheKey,
        requestGeneration,
        copyRequestGenerationRef,
      )) {
        return;
      }
      const nextResume = mapResumeToDashboard(duplicated, expectedAuthCacheKey);
      setResumesOwnerKey(expectedAuthCacheKey);
      setResumes((prev) => [nextResume, ...prev]);
      trackResumeDuplicated({
        source: 'dashboard',
        action: 'success',
        sourceResumeId: id,
        duplicatedResumeId: duplicated.id,
        durationMs: Date.now() - startedAt,
      });
      copyToastIdRef.current = null;
      updateToast(toastId, { message: COPY_TOAST_MESSAGES.success, type: 'success', duration: 2000 });
    } catch (error) {
      if (!await canCommitOwnerOperation(
        expectedAuthCacheKey,
        requestGeneration,
        copyRequestGenerationRef,
      )) {
        return;
      }
      console.error('[Dashboard] 创建副本失败:', error);
      trackResumeDuplicated({
        source: 'dashboard',
        action: 'error',
        sourceResumeId: id,
        durationMs: Date.now() - startedAt,
      });
      copyToastIdRef.current = null;
      updateToast(toastId, { message: COPY_TOAST_MESSAGES.error, type: 'error', duration: 3000 });
    } finally {
      if (await canCommitOwnerOperation(
        expectedAuthCacheKey,
        requestGeneration,
        copyRequestGenerationRef,
      )) {
        setIsCopyingResume(false);
        copyOperationOwnerRef.current = null;
      } else {
        closeToast(toastId);
      }
    }
  }, [authUserKey, closeToast, hasResolvedAuthOwner, isAuthenticated, isCopyingResume, onRequireAuth, showToastLoading, updateToast]);

  const renameResume = useCallback(async (
    resumeId: string | null,
    nextName: string
  ): Promise<RenameResumeResult> => {
    if (!isAuthenticated) {
      void onRequireAuth();
      return 'busy';
    }
    if (!hasResolvedAuthOwner) {
      return 'busy';
    }
    if (!resumeId) {
      return 'missing';
    }
    if (isRenamingResume && renameOperationOwnerRef.current === authUserKey) {
      return 'busy';
    }
    let expectedAuthCacheKey: string;
    try {
      expectedAuthCacheKey = await captureResumeAuthCacheKey(authUserKey);
    } catch {
      return 'error';
    }
    const requestGeneration = (renameRequestGenerationRef.current += 1);
    renameOperationOwnerRef.current = expectedAuthCacheKey;
    const currentName = visibleResumes.find((resume) => resume.id === resumeId)?.name ?? '';
    if (nextName === currentName) {
      renameOperationOwnerRef.current = null;
      return 'unchanged';
    }
    const toastId = showToastLoading(RENAME_TOAST_MESSAGES.loading);
    renameToastIdRef.current = toastId;
    try {
      setIsRenamingResume(true);
      const updated = await resumeService.update(
        resumeId,
        { title: nextName },
        { expectedAuthCacheKey },
      );
      if (!await canCommitOwnerOperation(
        expectedAuthCacheKey,
        requestGeneration,
        renameRequestGenerationRef,
      )) {
        return 'error';
      }
      setResumesOwnerKey(expectedAuthCacheKey);
      setResumes((prev) => prev.map((resume) =>
        resume.id === updated.id
          ? mergeDashboardResumeServerUpdate(resume, updated)
          : resume
      ));
      renameToastIdRef.current = null;
      updateToast(toastId, { message: RENAME_TOAST_MESSAGES.success, type: 'success', duration: 2000 });
      return 'renamed';
    } catch (error) {
      if (!await canCommitOwnerOperation(
        expectedAuthCacheKey,
        requestGeneration,
        renameRequestGenerationRef,
      )) {
        return 'error';
      }
      console.error('[Dashboard] 重命名简历失败:', error);
      if (isResumeVersionConflict(error)) {
        try {
          const refreshedResumes = await fetchDashboardResumes({
            force: true,
            expectedAuthCacheKey,
          });
          if (!await canCommitOwnerOperation(
            expectedAuthCacheKey,
            requestGeneration,
            renameRequestGenerationRef,
          )) {
            return 'error';
          }
          setResumesOwnerKey(expectedAuthCacheKey);
          setResumes(refreshedResumes);
        } catch (refreshError) {
          if (!await canCommitOwnerOperation(
            expectedAuthCacheKey,
            requestGeneration,
            renameRequestGenerationRef,
          )) {
            return 'error';
          }
          console.error('[Dashboard] 重命名冲突后刷新列表失败:', refreshError);
        }
      }
      renameToastIdRef.current = null;
      updateToast(toastId, { message: RENAME_TOAST_MESSAGES.error, type: 'error', duration: 3000 });
      return 'error';
    } finally {
      if (await canCommitOwnerOperation(
        expectedAuthCacheKey,
        requestGeneration,
        renameRequestGenerationRef,
      )) {
        setIsRenamingResume(false);
        renameOperationOwnerRef.current = null;
      } else {
        closeToast(toastId);
      }
    }
  }, [authUserKey, closeToast, fetchDashboardResumes, hasResolvedAuthOwner, isAuthenticated, isRenamingResume, onRequireAuth, showToastLoading, updateToast, visibleResumes]);

  return {
    resumes: visibleResumes,
    setResumes: setOwnerScopedResumes,
    isLoading: hasResolvedAuthOwner && resumesOwnerKey === authUserKey
      ? isLoading
      : isAuthenticated,
    error: hasResolvedAuthOwner && resumesOwnerKey === authUserKey ? error : null,
    isCreatingResume: hasResolvedAuthOwner
      && isCreatingResume
      && createOperationOwnerRef.current === authUserKey,
    isCopyingResume: hasResolvedAuthOwner
      && isCopyingResume
      && copyOperationOwnerRef.current === authUserKey,
    isRenamingResume: hasResolvedAuthOwner
      && isRenamingResume
      && renameOperationOwnerRef.current === authUserKey,
    fetchDashboardResumes,
    createResume,
    duplicateResume,
    renameResume,
  };
};
