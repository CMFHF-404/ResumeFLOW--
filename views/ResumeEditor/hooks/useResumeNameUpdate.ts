import { useCallback, useRef, type Dispatch, type SetStateAction } from 'react';
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
    resumeId,
    resumeName,
    resumeDetail,
    setResumeName,
    applyResumeDetail,
    updateDashboardCache,
    showToastError,
    showToastSuccess,
}: UseResumeNameUpdateParams) => {
    const isUpdatingResumeNameRef = useRef(false);

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
            setResumeName(normalized);
            if (!resumeId) {
                return;
            }
            isUpdatingResumeNameRef.current = true;
            try {
                const updated = await resumeService.update(resumeId, { title: normalized });
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
                console.error('[ResumeEditor] 更新简历名称失败:', error);
                setResumeName(previousName);
                if (!options?.silent) {
                    showToastError('简历名称更新失败');
                }
            } finally {
                isUpdatingResumeNameRef.current = false;
            }
        },
        [
            applyResumeDetail,
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
