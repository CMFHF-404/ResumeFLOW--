import { useCallback } from 'react';
import {
    resumeService,
    type ResumeDetail,
    type ResumeExperienceItem,
} from '../../../services/resumeService';
import type { ExperienceListItem } from '../../../services/experienceService';
import { mergeStarFieldsWithSource } from '../../../utils/resumeHelpers';
import { buildResumeExperienceMap, resolveExperienceDatePayload } from '../helpers';
import type { FloatingExperiencePolishSessionItem } from './useFloatingExperiencePolishSession';
import { useAuthOwnerOperationGuard } from '../../../hooks/useAuthOwnerOperationGuard';
import { AuthContextChangedError } from '../../../services/apiClient';
import { ensureResumeExperienceLinks } from './resumeExperienceLinkPersistence';

type UseFloatingPolishResumePersistenceParams = {
    authUserKey: string | null;
    resumeId: string | null;
    resumeExperienceMap: Map<string, ResumeExperienceItem>;
    experienceSourceMap: Map<string, ExperienceListItem>;
    applyResumeDetail: (detail: ResumeDetail | null) => void;
    setResumeExperienceMap: (nextMap: Map<string, ResumeExperienceItem>) => void;
};

export const useFloatingPolishResumePersistence = ({
    authUserKey,
    resumeId,
    resumeExperienceMap,
    experienceSourceMap,
    applyResumeDetail,
    setResumeExperienceMap,
}: UseFloatingPolishResumePersistenceParams) => {
    const ownerGuard = useAuthOwnerOperationGuard(authUserKey);
    const ensureFloatingPolishResumeLink = useCallback(async (
        masterId: string,
        versionId?: string,
        options?: { expectedAuthCacheKey: string },
    ) => {
        const operation = await ownerGuard.beginOperation();
        if (options && options.expectedAuthCacheKey !== operation.expectedAuthCacheKey) {
            throw new AuthContextChangedError();
        }
        if (!resumeId) {
            return null;
        }
        const existing = resumeExperienceMap.get(masterId);
        if (existing?.id) {
            return existing.id;
        }
        if (!versionId) {
            return null;
        }
        const { nextMap } = await ensureResumeExperienceLinks({
            resumeId,
            candidates: [{ masterId, versionId }],
            resumeExperienceMap,
            expectedAuthCacheKey: operation.expectedAuthCacheKey,
            assertOwnerCurrent: () => ownerGuard.assertOperationCurrent(operation),
            persistAssembly: (targetResumeId, payload, persistOptions) => resumeService.updateAssembly(
                targetResumeId,
                payload,
                persistOptions,
            ),
            applyResumeDetail,
            setResumeExperienceMap,
        });
        return nextMap.get(masterId)?.id ?? null;
    }, [applyResumeDetail, ownerGuard, resumeExperienceMap, resumeId, setResumeExperienceMap]);

    const ensureFloatingPolishResumeLinks = useCallback(async (
        sessionItems: FloatingExperiencePolishSessionItem[],
        options?: { expectedAuthCacheKey: string },
    ) => {
        const operation = await ownerGuard.beginOperation();
        if (options && options.expectedAuthCacheKey !== operation.expectedAuthCacheKey) {
            throw new AuthContextChangedError();
        }
        if (!resumeId) {
            throw new Error('当前简历不存在');
        }
        const { nextMap, addedLinkIds } = await ensureResumeExperienceLinks({
            resumeId,
            candidates: sessionItems.map((item) => ({
                masterId: item.targetId,
                versionId: item.afterItem.experienceVersionId,
            })),
            resumeExperienceMap,
            expectedAuthCacheKey: operation.expectedAuthCacheKey,
            assertOwnerCurrent: () => ownerGuard.assertOperationCurrent(operation),
            persistAssembly: (targetResumeId, payload, persistOptions) => resumeService.updateAssembly(
                targetResumeId,
                payload,
                persistOptions,
            ),
            applyResumeDetail,
            setResumeExperienceMap,
        });
        return {
            nextMap,
            addedLinkIds,
        };
    }, [applyResumeDetail, ownerGuard, resumeExperienceMap, resumeId, setResumeExperienceMap]);

    const rollbackFloatingPolishResumeLinks = useCallback(async (
        linkIds: string[],
        options?: { expectedAuthCacheKey: string },
    ) => {
        const operation = await ownerGuard.beginOperation();
        if (options && options.expectedAuthCacheKey !== operation.expectedAuthCacheKey) {
            throw new AuthContextChangedError();
        }
        if (!resumeId || !linkIds.length) {
            return;
        }
        const detail = await resumeService.updateAssembly(resumeId, {
            operations: linkIds.map((linkId) => ({
                op: 'remove',
                resume_experience_id: linkId,
            })),
        }, { expectedAuthCacheKey: operation.expectedAuthCacheKey });
        await ownerGuard.assertOperationCurrent(operation);
        const nextMap = buildResumeExperienceMap(detail);
        applyResumeDetail(detail);
        setResumeExperienceMap(nextMap);
    }, [applyResumeDetail, ownerGuard, resumeId, setResumeExperienceMap]);

    const buildExperiencePolishOverrideOperation = useCallback((
        sessionItem: FloatingExperiencePolishSessionItem,
        linkMap: Map<string, ResumeExperienceItem> = resumeExperienceMap
    ) => {
        const targetId = sessionItem.targetId;
        const currentItem = sessionItem.afterItem;
        const draft = sessionItem.afterDraft;
        const resumeItem = linkMap.get(targetId);
        const hasStarOverride = Boolean(
            resumeItem?.overrides_json
            && Object.prototype.hasOwnProperty.call(resumeItem.overrides_json, 'star')
        );
        const sourceStar = experienceSourceMap.get(targetId)?.latest_version?.star;
        const resolvedStar = (
            draft.starTouched || hasStarOverride
                ? draft.star
                : mergeStarFieldsWithSource(draft.star, sourceStar)
        );
        const linkId = resumeItem?.id;
        if (!linkId) {
            throw new Error('无法创建简历经历关联');
        }

        const dates = resolveExperienceDatePayload(draft, {
            start_date: currentItem.startDate,
            end_date: currentItem.endDate,
            is_current: currentItem.isCurrent,
        });
        const overrides: Record<string, unknown> = {
            star: resolvedStar,
            is_current: dates.isCurrent,
        };
        if (dates.startDate) {
            overrides.start_date = dates.startDate;
        }
        if (dates.endDate) {
            overrides.end_date = dates.endDate;
        }
        const title = draft.title.trim();
        const org = draft.company.trim();
        if (title) {
            overrides.title = title;
        }
        if (org) {
            overrides.org = org;
        }

        return {
            op: 'override',
            resume_experience_id: linkId,
            overrides_json: overrides,
        };
    }, [experienceSourceMap, resumeExperienceMap]);

    return {
        ensureFloatingPolishResumeLink,
        ensureFloatingPolishResumeLinks,
        rollbackFloatingPolishResumeLinks,
        buildExperiencePolishOverrideOperation,
    };
};
