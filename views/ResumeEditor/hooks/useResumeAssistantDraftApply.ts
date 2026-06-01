import { useCallback, type Dispatch, type SetStateAction } from 'react';
import type { AssistantDraftCard } from '../../../services/aiService';
import { certificationsService, type Certification as CertificationRecord } from '../../../services/certificationsService';
import { experienceService, type ExperienceDetail, type ExperienceListItem } from '../../../services/experienceService';
import {
    resumeService,
    type ResumeDetail,
    type ResumeExperienceItem,
} from '../../../services/resumeService';
import { skillsService } from '../../../services/skillsService';
import type {
    CertificationView,
    EducationView,
    SkillGroupView,
} from '../../../types/resume';
import { normalizeAssistantDraftCard } from '../../../utils/assistantDraft';
import type { AssistantDraftApplyMeta } from '../../AIAssistant/types';
import {
    buildCertificationView,
    buildEducationVersionPayload,
    buildEducationView,
    buildResumeExperienceMap,
    buildSkillGroups,
    compareCertificationByDateDesc,
} from '../helpers';
import {
    buildAssistantEducationDraft,
    buildAssistantExperienceAssemblyOverride,
    buildAssistantExperienceCreateVersionPayload,
} from '../assistantApplyUtils';
import {
    buildAssistantSkillDraftKey,
    findExistingSkillForAssistantDraft,
    type AssistantSkillDraftPayload,
} from '../assistantSkillDraftUtils';

type UseResumeAssistantDraftApplyParams = {
    resumeId: string | null;
    educationSourceMap: Map<string, ExperienceListItem>;
    setEducationSourceMap: Dispatch<SetStateAction<Map<string, ExperienceListItem>>>;
    setEducations: Dispatch<SetStateAction<EducationView[]>>;
    setSelectedEduIds: Dispatch<SetStateAction<Set<string>>>;
    setCertifications: Dispatch<SetStateAction<CertificationView[]>>;
    setCertificationSourceMap: Dispatch<SetStateAction<Map<string, CertificationRecord>>>;
    setSelectedCertIds: Dispatch<SetStateAction<Set<string>>>;
    setSkillGroups: Dispatch<SetStateAction<SkillGroupView[]>>;
    setSelectedSkillIds: Dispatch<SetStateAction<Set<string>>>;
    setSelectedExpIds: Dispatch<SetStateAction<Set<string>>>;
    setResumeExperienceMap: (nextMap: Map<string, ResumeExperienceItem>) => void;
    applyResumeDetail: (detail: ResumeDetail | null) => void;
    ensureFloatingPolishResumeLink: (masterId: string, versionId?: string) => Promise<string | null>;
};

export const useResumeAssistantDraftApply = ({
    resumeId,
    educationSourceMap,
    setEducationSourceMap,
    setEducations,
    setSelectedEduIds,
    setCertifications,
    setCertificationSourceMap,
    setSelectedCertIds,
    setSkillGroups,
    setSelectedSkillIds,
    setSelectedExpIds,
    setResumeExperienceMap,
    applyResumeDetail,
    ensureFloatingPolishResumeLink,
}: UseResumeAssistantDraftApplyParams) => {
    const applyEducationAssistantDetail = useCallback((
        detail: ExperienceDetail,
        options?: { replacedId?: string }
    ) => {
        const nextItem: ExperienceListItem = {
            master: detail.master,
            latest_version: detail.latest_version,
        };
        const nextView = buildEducationView(nextItem);
        setEducationSourceMap((prev) => {
            const next = new Map(prev);
            if (options?.replacedId && options.replacedId !== detail.master.id) {
                next.delete(options.replacedId);
            }
            next.set(detail.master.id, nextItem);
            return next;
        });
        setEducations((prev) => {
            const matchId = options?.replacedId ?? detail.master.id;
            const targetIndex = prev.findIndex((item) => item.id === matchId || item.id === detail.master.id);
            const next = prev.filter((item) => item.id !== detail.master.id && item.id !== options?.replacedId);
            if (targetIndex >= 0) {
                next.splice(targetIndex, 0, nextView);
                return next;
            }
            return [...next, nextView];
        });
        setSelectedEduIds((prev) => {
            const next = new Set(prev);
            if (options?.replacedId && options.replacedId !== detail.master.id) {
                next.delete(options.replacedId);
            }
            next.add(detail.master.id);
            return next;
        });
    }, [setEducationSourceMap, setEducations, setSelectedEduIds]);

    return useCallback(async (
        draftCard: AssistantDraftCard,
        _meta: AssistantDraftApplyMeta
    ) => {
        const normalizedDraftCard = normalizeAssistantDraftCard(draftCard);

        if (normalizedDraftCard.type === 'certification') {
            const record = await certificationsService.create({
                name: normalizedDraftCard.data.name.trim(),
                issuer: normalizedDraftCard.data.issuer.trim() || undefined,
                issue_date: normalizedDraftCard.data.issueDate.trim() || undefined,
                expiry_date: normalizedDraftCard.data.expiryDate.trim() || undefined,
                credential_id: normalizedDraftCard.data.credentialId.trim() || undefined,
                credential_url: normalizedDraftCard.data.credentialUrl.trim() || undefined,
                description: normalizedDraftCard.data.description.trim() || undefined,
            });
            const nextCertifications = await certificationsService.list({ force: true });
            setCertifications(nextCertifications.map(buildCertificationView).sort(compareCertificationByDateDesc));
            setCertificationSourceMap(new Map(nextCertifications.map((item) => [item.id, item])));
            setSelectedCertIds((prev) => {
                const next = new Set(prev);
                next.add(record.id);
                return next;
            });
            return true;
        }

        if (normalizedDraftCard.type === 'skill_group') {
            const category = normalizedDraftCard.data.category.trim() || undefined;
            const skillPayloads = Array.from(
                normalizedDraftCard.data.skills.reduce((map, item) => {
                    const name = item.name.trim();
                    const key = buildAssistantSkillDraftKey(name, category);
                    if (!name) {
                        return map;
                    }
                    map.set(key, {
                        name,
                        category,
                        targetUserSkillId: item.targetUserSkillId?.trim() || undefined,
                    });
                    return map;
                }, new Map<string, AssistantSkillDraftPayload>())
                    .values()
            );
            if (skillPayloads.length === 0) {
                throw new Error('缺少技能名称，无法录入技能组');
            }
            const existingSkills = await skillsService.list({ force: true });
            const appliedSkills = await Promise.all(
                skillPayloads.map((payload) => {
                    const existing = findExistingSkillForAssistantDraft(existingSkills, payload);
                    if (existing) {
                        return skillsService.update(existing.id, {
                            name: payload.name,
                            category: payload.category,
                        });
                    }
                    return skillsService.create({
                        name: payload.name,
                        category: payload.category,
                    });
                })
            );
            const nextSkills = await skillsService.list({ force: true });
            setSkillGroups(buildSkillGroups(nextSkills));
            setSelectedSkillIds((prev) => {
                const next = new Set(prev);
                appliedSkills.forEach((item) => next.add(item.id));
                return next;
            });
            return true;
        }

        if (normalizedDraftCard.type === 'experience' && normalizedDraftCard.data.category === 'education') {
            const targetMasterId = normalizedDraftCard.data.targetMasterId?.trim() || null;
            const educationDraft = buildAssistantEducationDraft(normalizedDraftCard.data);
            if (!educationDraft.major) {
                throw new Error('缺少教育标题，无法录入教育经历');
            }
            const sourceItem = targetMasterId
                ? (
                    educationSourceMap.get(targetMasterId)
                    ?? (() => {
                        throw new Error('缺少教育经历源数据');
                    })()
                )
                : null;
            const payload = buildEducationVersionPayload(sourceItem, educationDraft);
            const detail = targetMasterId
                ? await experienceService.update(targetMasterId, { version: payload })
                : await experienceService.create({
                    category: 'education',
                    version: payload,
                });
            applyEducationAssistantDetail(detail);
            return true;
        }

        if (normalizedDraftCard.type !== 'experience' || !resumeId) {
            return false;
        }

        const title = normalizedDraftCard.data.title.trim();
        if (!title) {
            throw new Error('缺少经历标题，无法回填到当前简历');
        }

        const resolveTargetLinkId = async () => {
            const targetMasterId = normalizedDraftCard.data.targetMasterId?.trim();
            if (targetMasterId) {
                const targetDetail = await experienceService.get(targetMasterId);
                const linkId = await ensureFloatingPolishResumeLink(
                    targetMasterId,
                    targetDetail.latest_version?.id
                );
                if (!linkId) {
                    throw new Error('无法创建目标经历与当前简历的关联');
                }
                return { masterId: targetMasterId, linkId };
            }

            const created = await experienceService.create({
                category: normalizedDraftCard.data.category,
                version: buildAssistantExperienceCreateVersionPayload(normalizedDraftCard.data, title),
            });
            const createdMasterId = created.master.id;
            const linkId = await ensureFloatingPolishResumeLink(
                createdMasterId,
                created.latest_version?.id
            );
            if (!linkId) {
                throw new Error('无法将新经历添加到当前简历');
            }
            return { masterId: createdMasterId, linkId };
        };

        const { masterId, linkId } = await resolveTargetLinkId();
        const detail = await resumeService.updateAssembly(resumeId, {
            operations: [
                {
                    op: 'override',
                    resume_experience_id: linkId,
                    ...buildAssistantExperienceAssemblyOverride(normalizedDraftCard.data, title),
                },
            ],
        });
        const nextMap = buildResumeExperienceMap(detail);
        applyResumeDetail(detail);
        setResumeExperienceMap(nextMap);
        if (normalizedDraftCard.data.category === 'education') {
            setSelectedEduIds((prev) => {
                const next = new Set(prev);
                next.add(masterId);
                return next;
            });
        } else {
            setSelectedExpIds((prev) => {
                const next = new Set(prev);
                next.add(masterId);
                return next;
            });
        }
        return true;
    }, [
        applyEducationAssistantDetail,
        applyResumeDetail,
        educationSourceMap,
        ensureFloatingPolishResumeLink,
        resumeId,
        setCertificationSourceMap,
        setCertifications,
        setResumeExperienceMap,
        setSelectedCertIds,
        setSelectedEduIds,
        setSelectedExpIds,
        setSelectedSkillIds,
        setSkillGroups,
    ]);
};
