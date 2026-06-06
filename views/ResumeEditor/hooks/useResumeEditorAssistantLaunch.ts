import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';

import {
    type AssistantMessage,
    type AssistantSelectedResume,
} from '../../../services/aiService';
import type {
    ExperienceEditDraft,
    ResumeExperienceView,
} from '../../../types/resume';
import { buildSmartCompleteAssistantPrompt } from '../../../utils/assistantSmartCompletePrompt';
import { normalizeAssistantDraftCard } from '../../../utils/assistantDraft';
import type { AssistantLaunchRequest } from '../../AIAssistant/types';
import { applyAssistantExperienceDraftToDraft } from '../assistantApplyUtils';
import { buildExperienceEditDraft } from '../helpers';
import type {
    FloatingExperiencePolishSession,
    FloatingExperiencePolishSessionItem,
} from './useFloatingExperiencePolishSession';

type UseResumeEditorAssistantLaunchParams = {
    resumeId: string | null;
    resumeName: string;
    jdPolishContext: string;
    selectedResumeSnapshot: AssistantSelectedResume['snapshot'];
    onLaunchAssistant?: (request: AssistantLaunchRequest) => void;
    experience: {
        editingDraft: ExperienceEditDraft | null;
        setEditingDraft: Dispatch<SetStateAction<ExperienceEditDraft | null>>;
    };
    experienceItems: ResumeExperienceView[];
    activeFloatingPolishExperienceId: string | null;
    buildFloatingPolishSessionItem: (
        baseItem: ResumeExperienceView,
        nextDraft: ExperienceEditDraft,
        beforeDraft?: ExperienceEditDraft,
    ) => FloatingExperiencePolishSessionItem | null;
    applyFloatingPolishPreview: (
        mode: FloatingExperiencePolishSession['mode'],
        items: FloatingExperiencePolishSessionItem[],
        failedIds?: string[],
    ) => boolean;
    pendingAssistantApplyRef: MutableRefObject<Map<string, () => Promise<AssistantMessage>>>;
    trackedPendingAssistantApplyRef: MutableRefObject<Set<string>>;
    setExperiencePolishPreview: Dispatch<SetStateAction<unknown>>;
    handleApplyResumeAssistantDraft: NonNullable<AssistantLaunchRequest['applyDraftHandler']>;
};

export const useResumeEditorAssistantLaunch = ({
    resumeId,
    resumeName,
    jdPolishContext,
    selectedResumeSnapshot,
    onLaunchAssistant,
    experience,
    experienceItems,
    activeFloatingPolishExperienceId,
    buildFloatingPolishSessionItem,
    applyFloatingPolishPreview,
    pendingAssistantApplyRef,
    trackedPendingAssistantApplyRef,
    setExperiencePolishPreview,
    handleApplyResumeAssistantDraft,
}: UseResumeEditorAssistantLaunchParams) => {
    const handleOpenExperienceAssistant = useCallback(() => {
        if (!experience.editingDraft || !onLaunchAssistant) {
            return;
        }
        const draft = experience.editingDraft;
        onLaunchAssistant({
            context: {
                mode: 'experience',
                entrySource: 'resume_editor',
                title: `${draft.company || '未命名经历'} · 智能补全`,
                contextJson: {
                    resumeId,
                    masterId: draft.masterId,
                    category: draft.category,
                    company: draft.company,
                    title: draft.title,
                    startDate: draft.startDate,
                    endDate: draft.endDate,
                    isCurrent: draft.isCurrent,
                    star: draft.star,
                    jdText: jdPolishContext,
                },
            },
            initialSkillId: 'experience_completion',
            initialUserMessage: buildSmartCompleteAssistantPrompt({
                jdText: jdPolishContext,
                org: draft.company,
                title: draft.title,
                startDate: draft.startDate,
                endDate: draft.endDate,
                isCurrent: draft.isCurrent,
                star: draft.star,
            }),
            applyDraftHandler: async (draftCard, meta) => {
                const normalizedDraftCard = normalizeAssistantDraftCard(draftCard);
                if (normalizedDraftCard.type !== 'experience') {
                    return false;
                }
                pendingAssistantApplyRef.current.set(draft.masterId, meta.persistApplied);
                trackedPendingAssistantApplyRef.current.delete(draft.masterId);
                experience.setEditingDraft((prev) => {
                    if (!prev) {
                        return prev;
                    }
                    return applyAssistantExperienceDraftToDraft(prev, normalizedDraftCard.data);
                });
                setExperiencePolishPreview(null);
                return true;
            },
            callbackOnly: true,
        });
    }, [experience, jdPolishContext, onLaunchAssistant, pendingAssistantApplyRef, resumeId, setExperiencePolishPreview, trackedPendingAssistantApplyRef]);

    const handleOpenFloatingExperienceAssistant = useCallback(() => {
        if (!activeFloatingPolishExperienceId || !onLaunchAssistant) {
            return;
        }
        const currentItem = experienceItems.find((item) => item.id === activeFloatingPolishExperienceId);
        if (!currentItem) {
            return;
        }
        const draft = buildExperienceEditDraft(currentItem);
        onLaunchAssistant({
            context: {
                mode: 'experience',
                entrySource: 'resume_editor',
                title: `${draft.company || '未命名经历'} · 智能补全`,
                contextJson: {
                    resumeId,
                    masterId: draft.masterId,
                    category: draft.category,
                    company: draft.company,
                    title: draft.title,
                    startDate: draft.startDate,
                    endDate: draft.endDate,
                    isCurrent: draft.isCurrent,
                    star: draft.star,
                    jdText: jdPolishContext,
                },
            },
            initialSkillId: 'experience_completion',
            initialUserMessage: buildSmartCompleteAssistantPrompt({
                jdText: jdPolishContext,
                org: draft.company,
                title: draft.title,
                startDate: draft.startDate,
                endDate: draft.endDate,
                isCurrent: draft.isCurrent,
                star: draft.star,
            }),
            applyDraftHandler: async (draftCard) => {
                const normalizedDraftCard = normalizeAssistantDraftCard(draftCard);
                if (normalizedDraftCard.type !== 'experience') {
                    return false;
                }
                const nextDraft = applyAssistantExperienceDraftToDraft(draft, normalizedDraftCard.data);
                if (!activeFloatingPolishExperienceId) {
                    return false;
                }
                const currentItem = experienceItems.find((item) => item.id === activeFloatingPolishExperienceId);
                if (!currentItem) {
                    return false;
                }
                const sessionItem = buildFloatingPolishSessionItem(currentItem, nextDraft, draft);
                return sessionItem ? applyFloatingPolishPreview('single', [sessionItem]) : false;
            },
            callbackOnly: true,
        });
    }, [
        activeFloatingPolishExperienceId,
        applyFloatingPolishPreview,
        buildFloatingPolishSessionItem,
        experienceItems,
        jdPolishContext,
        onLaunchAssistant,
        resumeId,
    ]);

    const handleLaunchResumeAssistant = useCallback(() => {
        if (!resumeId || !onLaunchAssistant) {
            return;
        }
        onLaunchAssistant({
            context: {
                mode: 'general',
                entrySource: 'resume_editor',
                title: `${resumeName || '未命名简历'} · AI 助理`,
                contextJson: {
                    resumeId,
                },
            },
            prefillResume: {
                resumeId,
                resumeName: resumeName || '未命名简历',
                snapshot: selectedResumeSnapshot,
                ...(jdPolishContext ? { jdContext: jdPolishContext } : {}),
            },
            applyDraftHandler: handleApplyResumeAssistantDraft,
        });
    }, [handleApplyResumeAssistantDraft, jdPolishContext, onLaunchAssistant, resumeId, resumeName, selectedResumeSnapshot]);

    return {
        handleOpenExperienceAssistant,
        handleOpenFloatingExperienceAssistant,
        handleLaunchResumeAssistant,
    };
};
