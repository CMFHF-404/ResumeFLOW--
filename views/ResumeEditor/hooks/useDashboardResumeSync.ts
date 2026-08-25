import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { isAuthContextChangedError } from '../../../services/apiClient';
import type { Resume as DashboardResume } from '../../../types';
import {
    assertResumeAuthContext,
    ResumeAuthContextChangedError,
    resumeService,
    type Resume as ResumeRecord,
} from '../../../services/resumeService';
import {
    mapResumesToDashboard,
    replaceDashboardResumeFromServer,
} from '../../../utils/dashboardResumeMapper';
import { readAuthSessionSnapshot } from '../../../services/authTokenProvider';

export type DashboardResumesSyncResult =
    | { status: 'success' | 'skipped' }
    | { status: 'failed'; error: unknown };

type UseDashboardResumeSyncParams = {
    authUserKey: string | null;
    cachedResumes: DashboardResume[];
    isCacheOwnerMatched: boolean;
    onResumesUpdate?: (resumes: DashboardResume[]) => void;
};

export const useDashboardResumeSync = ({
    authUserKey,
    cachedResumes,
    isCacheOwnerMatched,
    onResumesUpdate,
}: UseDashboardResumeSyncParams) => {
    const refreshGenerationRef = useRef(0);
    const committedOwnerRef = useRef(authUserKey);
    useLayoutEffect(() => {
        if (committedOwnerRef.current !== authUserKey) {
            committedOwnerRef.current = authUserKey;
            refreshGenerationRef.current += 1;
        }
    }, [authUserKey]);
    useEffect(() => () => {
        refreshGenerationRef.current += 1;
    }, []);

    const updateDashboardCache = useCallback(
        (updated: ResumeRecord) => {
            if (
                !authUserKey
                || committedOwnerRef.current !== authUserKey
                || readAuthSessionSnapshot().ownerKey !== authUserKey
                || !onResumesUpdate
                || cachedResumes.length === 0
                || !isCacheOwnerMatched
            ) {
                return;
            }
            const next = replaceDashboardResumeFromServer(cachedResumes, updated, authUserKey);
            onResumesUpdate(next);
        },
        [authUserKey, cachedResumes, isCacheOwnerMatched, onResumesUpdate]
    );

    const refreshDashboardResumesFromServer = useCallback(async (): Promise<DashboardResumesSyncResult> => {
        if (!authUserKey || !onResumesUpdate || !isCacheOwnerMatched) {
            return { status: 'skipped' };
        }
        const expectedAuthCacheKey = authUserKey;
        const generation = refreshGenerationRef.current + 1;
        refreshGenerationRef.current = generation;
        const isCurrent = () => (
            refreshGenerationRef.current === generation
            && committedOwnerRef.current === expectedAuthCacheKey
        );
        try {
            await assertResumeAuthContext(expectedAuthCacheKey);
            const resumes = await resumeService.list({
                force: true,
                expectedAuthCacheKey,
            });
            if (!isCurrent()) {
                return { status: 'skipped' };
            }
            await assertResumeAuthContext(expectedAuthCacheKey);
            if (!isCurrent()) {
                return { status: 'skipped' };
            }
            onResumesUpdate(mapResumesToDashboard(resumes, expectedAuthCacheKey));
            return { status: 'success' };
        } catch (error) {
            if (!isCurrent()) {
                return { status: 'skipped' };
            }
            if (error instanceof ResumeAuthContextChangedError || isAuthContextChangedError(error)) {
                return { status: 'skipped' };
            }
            console.error('[ResumeEditor] 刷新简历列表失败:', error);
            return { status: 'failed', error };
        }
    }, [authUserKey, isCacheOwnerMatched, onResumesUpdate]);

    return {
        refreshDashboardResumesFromServer,
        updateDashboardCache,
    };
};
