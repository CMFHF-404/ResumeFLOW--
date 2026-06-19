import { useCallback } from 'react';
import type { Resume as DashboardResume } from '../../../types';
import { resumeService, type Resume as ResumeRecord } from '../../../services/resumeService';
import { mapResumesToDashboard } from '../../../utils/dashboardResumeMapper';
import { mergeDashboardResumeServerUpdate } from '../../Dashboard/dashboardUtils';

export type DashboardResumesSyncResult =
    | { status: 'success' | 'skipped' }
    | { status: 'failed'; error: unknown };

type UseDashboardResumeSyncParams = {
    cachedResumes: DashboardResume[];
    isCacheOwnerMatched: boolean;
    onResumesUpdate?: (resumes: DashboardResume[]) => void;
};

export const useDashboardResumeSync = ({
    cachedResumes,
    isCacheOwnerMatched,
    onResumesUpdate,
}: UseDashboardResumeSyncParams) => {
    const updateDashboardCache = useCallback(
        (updated: ResumeRecord) => {
            if (!onResumesUpdate || cachedResumes.length === 0 || !isCacheOwnerMatched) {
                return;
            }
            const next = cachedResumes.map((resume) =>
                resume.id === updated.id
                    ? mergeDashboardResumeServerUpdate(resume, updated)
                    : resume
            );
            onResumesUpdate(next);
        },
        [cachedResumes, isCacheOwnerMatched, onResumesUpdate]
    );

    const refreshDashboardResumesFromServer = useCallback(async (): Promise<DashboardResumesSyncResult> => {
        if (!onResumesUpdate || !isCacheOwnerMatched) {
            return { status: 'skipped' };
        }
        try {
            const resumes = await resumeService.list({ force: true });
            onResumesUpdate(mapResumesToDashboard(resumes));
            return { status: 'success' };
        } catch (error) {
            console.error('[ResumeEditor] 刷新简历列表失败:', error);
            return { status: 'failed', error };
        }
    }, [isCacheOwnerMatched, onResumesUpdate]);

    return {
        refreshDashboardResumesFromServer,
        updateDashboardCache,
    };
};
