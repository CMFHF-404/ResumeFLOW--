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

type UseFloatingPolishResumePersistenceParams = {
    resumeId: string | null;
    resumeExperienceMap: Map<string, ResumeExperienceItem>;
    experienceSourceMap: Map<string, ExperienceListItem>;
    applyResumeDetail: (detail: ResumeDetail | null) => void;
    setResumeExperienceMap: (nextMap: Map<string, ResumeExperienceItem>) => void;
};

export const useFloatingPolishResumePersistence = ({
    resumeId,
    resumeExperienceMap,
    experienceSourceMap,
    applyResumeDetail,
    setResumeExperienceMap,
}: UseFloatingPolishResumePersistenceParams) => {
    const ensureFloatingPolishResumeLink = useCallback(async (
        masterId: string,
        versionId?: string
    ) => {
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
        const detail = await resumeService.updateAssembly(resumeId, {
            operations: [
                {
                    op: 'add',
                    experience_version_id: versionId,
                },
            ],
        });
        const nextMap = buildResumeExperienceMap(detail);
        applyResumeDetail(detail);
        setResumeExperienceMap(nextMap);
        return nextMap.get(masterId)?.id ?? null;
    }, [applyResumeDetail, resumeExperienceMap, resumeId, setResumeExperienceMap]);

    const ensureFloatingPolishResumeLinks = useCallback(async (
        sessionItems: FloatingExperiencePolishSessionItem[]
    ) => {
        if (!resumeId) {
            throw new Error('当前简历不存在');
        }
        const pendingAddMap = new Map<string, string>();
        sessionItems.forEach((item) => {
            if (resumeExperienceMap.get(item.targetId)?.id) {
                return;
            }
            const versionId = item.afterItem.experienceVersionId;
            if (versionId) {
                pendingAddMap.set(item.targetId, versionId);
            }
        });
        if (!pendingAddMap.size) {
            return {
                nextMap: resumeExperienceMap,
                addedLinkIds: [] as string[],
            };
        }

        const detail = await resumeService.updateAssembly(resumeId, {
            operations: Array.from(pendingAddMap.values()).map((versionId) => ({
                op: 'add',
                experience_version_id: versionId,
            })),
        });
        const nextMap = buildResumeExperienceMap(detail);
        const addedLinkIds = Array.from(pendingAddMap.keys())
            .map((targetId) => nextMap.get(targetId)?.id ?? null)
            .filter((linkId): linkId is string => Boolean(linkId));
        applyResumeDetail(detail);
        setResumeExperienceMap(nextMap);
        return {
            nextMap,
            addedLinkIds,
        };
    }, [applyResumeDetail, resumeExperienceMap, resumeId, setResumeExperienceMap]);

    const rollbackFloatingPolishResumeLinks = useCallback(async (linkIds: string[]) => {
        if (!resumeId || !linkIds.length) {
            return;
        }
        const detail = await resumeService.updateAssembly(resumeId, {
            operations: linkIds.map((linkId) => ({
                op: 'remove',
                resume_experience_id: linkId,
            })),
        });
        const nextMap = buildResumeExperienceMap(detail);
        applyResumeDetail(detail);
        setResumeExperienceMap(nextMap);
    }, [applyResumeDetail, resumeId, setResumeExperienceMap]);

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
