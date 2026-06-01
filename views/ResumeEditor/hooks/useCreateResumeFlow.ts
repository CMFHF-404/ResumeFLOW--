import { useCallback } from 'react';
import type { ToastConfig } from '../../../components/Toast';
import { resolveAuthUserKeyFromActiveSession } from '../../../services/apiClient';
import { profileService } from '../../../services/profileService';
import { resumeService, type Resume as ResumeRecord } from '../../../services/resumeService';
import { UNTITLED_RESUME_TITLE } from '../../../constants/resumeConstants';
import type {
    ProfileSyncMode,
    ResumeEditorConfig,
    ResumeEditorProfile,
} from '../../../types/resume';
import { buildPreferredResumeCreateConfig } from '../../resumeTemplateStorage';
import type { DashboardResumesSyncResult } from './useDashboardResumeSync';

type CreateResumeFlowResult =
    | { status: 'success'; resumeId: string }
    | { status: 'warning'; stage: 'sync'; resumeId: string; error: unknown }
    | { status: 'partial'; stage: 'load'; resumeId: string; error?: unknown }
    | { status: 'failed'; stage: 'create'; error: unknown };

type ReloadResumeContextResult =
    | {
        status: 'success';
        resumeId: string;
        context: {
            profile: ResumeEditorProfile;
            profileSyncMode: ProfileSyncMode;
        };
    }
    | {
        status: 'failed';
        reason: string;
        requestedId: string | null;
        error?: unknown;
    };

type UpdateToast = (id: string, updates: Partial<Omit<ToastConfig, 'id'>>) => void;

type UseCreateResumeFlowParams = {
    authUserKey: string | null;
    resumeId: string | null;
    isCreatingResume: boolean;
    isLoadingResume: boolean;
    buildCommittedResumeConfigSnapshot: () => ResumeEditorConfig;
    clearSuppressedAutoSave: () => void;
    flushResumeConfig: (configOverride?: ResumeEditorConfig) => Promise<void>;
    refreshDashboardResumesFromServer: () => Promise<DashboardResumesSyncResult>;
    reloadResumeContext: (resumeId?: string | null) => Promise<ReloadResumeContextResult>;
    resetEditorTransientState: (
        nextProfile: ResumeEditorProfile,
        nextProfileSyncMode: ProfileSyncMode
    ) => void;
    setIsCreatingResume: (value: boolean) => void;
    setResumeName: (value: string) => void;
    showToastError: (message: string, duration?: number) => string;
    showToastInfo: (message: string, duration?: number) => string;
    showToastLoading: (message: string) => string;
    suppressAutoSaveForConfig: (config: ResumeEditorConfig) => void;
    updateToast: UpdateToast;
};

export const useCreateResumeFlow = ({
    authUserKey,
    resumeId,
    isCreatingResume,
    isLoadingResume,
    buildCommittedResumeConfigSnapshot,
    clearSuppressedAutoSave,
    flushResumeConfig,
    refreshDashboardResumesFromServer,
    reloadResumeContext,
    resetEditorTransientState,
    setIsCreatingResume,
    setResumeName,
    showToastError,
    showToastInfo,
    showToastLoading,
    suppressAutoSaveForConfig,
    updateToast,
}: UseCreateResumeFlowParams) => {
    const runCreateResumeFlow = useCallback(async (): Promise<CreateResumeFlowResult> => {
        let nextResume: ResumeRecord;
        if (resumeId) {
            await flushResumeConfig(buildCommittedResumeConfigSnapshot());
        }
        try {
            const profileForCreate = await profileService
                .getProfile()
                .catch(() => profileService.peekProfileForCurrentUser());
            const ownerId = profileForCreate?.user_id
                ?? authUserKey
                ?? await resolveAuthUserKeyFromActiveSession();
            nextResume = await resumeService.create({
                title: UNTITLED_RESUME_TITLE,
                config: buildPreferredResumeCreateConfig(
                    profileForCreate?.extra_json,
                    ownerId
                ),
            });
        } catch (error) {
            console.error('[ResumeEditor] 创建空白简历失败:', error);
            return {
                status: 'failed',
                stage: 'create',
                error,
            };
        }

        const reloadResult = await reloadResumeContext(nextResume.id);
        if (reloadResult.status !== 'success') {
            await refreshDashboardResumesFromServer();
            return {
                status: 'partial',
                stage: 'load',
                resumeId: nextResume.id,
                error: reloadResult.error,
            };
        }

        setResumeName(UNTITLED_RESUME_TITLE);
        resetEditorTransientState(
            reloadResult.context.profile,
            reloadResult.context.profileSyncMode
        );

        const syncResult = await refreshDashboardResumesFromServer();
        if (syncResult.status === 'failed') {
            return {
                status: 'warning',
                stage: 'sync',
                resumeId: nextResume.id,
                error: syncResult.error,
            };
        }

        return {
            status: 'success',
            resumeId: nextResume.id,
        };
    }, [
        authUserKey,
        buildCommittedResumeConfigSnapshot,
        flushResumeConfig,
        refreshDashboardResumesFromServer,
        reloadResumeContext,
        resetEditorTransientState,
        resumeId,
        setResumeName,
    ]);

    return useCallback(async () => {
        if (isCreatingResume) {
            return;
        }
        if (isLoadingResume) {
            showToastError('当前简历尚未加载完成，请稍后再试');
            return;
        }
        const toastId = showToastLoading('正在创建并切换简历...');
        setIsCreatingResume(true);
        suppressAutoSaveForConfig(buildCommittedResumeConfigSnapshot());

        try {
            const result = await runCreateResumeFlow();
            if (result.status === 'success') {
                updateToast(toastId, {
                    message: '新简历已创建并切换',
                    type: 'success',
                    duration: 3000,
                });
                return;
            }
            if (result.status === 'warning') {
                updateToast(toastId, {
                    message: '新简历已创建并切换',
                    type: 'success',
                    duration: 3000,
                });
                showToastInfo('简历列表同步失败，请稍后刷新仪表盘');
                return;
            }
            if (result.status === 'partial') {
                updateToast(toastId, {
                    message: '新简历已创建，但未完成切换，请从仪表盘打开',
                    type: 'error',
                    duration: 4000,
                });
                return;
            }
            updateToast(toastId, {
                message: '创建新简历失败，请稍后重试',
                type: 'error',
                duration: 4000,
            });
        } catch (error) {
            console.error('[ResumeEditor] 创建简历流程异常:', error);
            updateToast(toastId, {
                message: '创建新简历失败，请稍后重试',
                type: 'error',
                duration: 4000,
            });
        } finally {
            clearSuppressedAutoSave();
            setIsCreatingResume(false);
        }
    }, [
        buildCommittedResumeConfigSnapshot,
        clearSuppressedAutoSave,
        isCreatingResume,
        isLoadingResume,
        runCreateResumeFlow,
        setIsCreatingResume,
        showToastError,
        showToastInfo,
        showToastLoading,
        suppressAutoSaveForConfig,
        updateToast,
    ]);
};
