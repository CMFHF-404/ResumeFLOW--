import {
    useCallback,
    useLayoutEffect,
    useRef,
    type Dispatch,
    type SetStateAction,
} from 'react';
import { useAuthOwnerOperationGuard } from '../../../hooks/useAuthOwnerOperationGuard';
import { isAuthContextChangedError } from '../../../services/apiClient';
import {
    resumeService,
    type Resume as ResumeRecord,
    type ResumeDetail,
} from '../../../services/resumeService';
import { UNTITLED_RESUME_TITLE } from '../../../constants/resumeConstants';
import {
    isDefaultResumeTitle,
    normalizeResumeTitle,
} from '../autoNameUtils';

type UseResumeNameUpdateParams = {
    authUserKey: string | null;
    resumeId: string | null;
    resumeName: string;
    resumeDetail: ResumeDetail | null;
    setResumeName: Dispatch<SetStateAction<string>>;
    applyResumeDetail: (detail: ResumeDetail | null) => void;
    updateDashboardCache: (updated: ResumeRecord) => void;
    showToastError: (message: string, duration?: number) => void;
    showToastSuccess: (message: string, duration?: number) => void;
};

export const useResumeNameUpdate = ({
    authUserKey,
    resumeId,
    resumeName,
    resumeDetail,
    setResumeName,
    applyResumeDetail,
    updateDashboardCache,
    showToastError,
    showToastSuccess,
}: UseResumeNameUpdateParams) => {
    const ownerGuard = useAuthOwnerOperationGuard(authUserKey);
    const isUpdatingResumeNameRef = useRef(false);
    const activeUpdateRef = useRef<symbol | null>(null);

    useLayoutEffect(() => {
        activeUpdateRef.current = null;
        isUpdatingResumeNameRef.current = false;
    }, [authUserKey]);

    const applyResumeNameUpdate = useCallback(
        async (nextName: string, options?: { silent?: boolean }) => {
            const normalized = normalizeResumeTitle(nextName);
            if (!normalized || normalized === resumeName) {
                return;
            }
            if (isUpdatingResumeNameRef.current) {
                return;
            }
            const previousName = resumeName;
            if (!resumeId) {
                setResumeName(normalized);
                return;
            }
            const requestId = Symbol('update-resume-name');
            activeUpdateRef.current = requestId;
            isUpdatingResumeNameRef.current = true;
            let operation: Awaited<ReturnType<typeof ownerGuard.beginOperation>> | null = null;
            try {
                operation = await ownerGuard.beginOperation();
                if (activeUpdateRef.current !== requestId) {
                    return;
                }
                setResumeName(normalized);
                const updated = await resumeService.update(
                    resumeId,
                    { title: normalized },
                    { expectedAuthCacheKey: operation.expectedAuthCacheKey },
                );
                await ownerGuard.assertOperationCurrent(operation);
                if (activeUpdateRef.current !== requestId) {
                    return;
                }
                const updatedTitle = normalizeResumeTitle(updated.title || normalized);
                setResumeName(updatedTitle || UNTITLED_RESUME_TITLE);
                if (resumeDetail) {
                    applyResumeDetail({
                        ...resumeDetail,
                        resume: {
                            ...resumeDetail.resume,
                            ...updated,
                            title: updatedTitle || UNTITLED_RESUME_TITLE,
                        },
                    });
                }
                updateDashboardCache(updated);
                if (!options?.silent) {
                    showToastSuccess('简历名称已更新');
                }
            } catch (error) {
                if (
                    !isAuthContextChangedError(error)
                    && operation
                    && ownerGuard.isOperationCurrent(operation)
                    && activeUpdateRef.current === requestId
                ) {
                    console.error('[ResumeEditor] 更新简历名称失败:', error);
                    setResumeName(previousName);
                    if (!options?.silent) {
                        showToastError('简历名称更新失败');
                    }
                }
            } finally {
                if (activeUpdateRef.current === requestId) {
                    activeUpdateRef.current = null;
                    isUpdatingResumeNameRef.current = false;
                }
            }
        },
        [
            applyResumeDetail,
            ownerGuard,
            resumeDetail,
            resumeId,
            resumeName,
            setResumeName,
            showToastError,
            showToastSuccess,
            updateDashboardCache,
        ]
    );

    const canAutoNameResume = useCallback(
        (name: string) => {
            const normalized = normalizeResumeTitle(name);
            return !normalized || isDefaultResumeTitle(normalized);
        },
        []
    );

    const handleResumeNameChange = useCallback((name: string) => {
        void applyResumeNameUpdate(name);
    }, [applyResumeNameUpdate]);

    return {
        applyResumeNameUpdate,
        canAutoNameResume,
        handleResumeNameChange,
    };
};
