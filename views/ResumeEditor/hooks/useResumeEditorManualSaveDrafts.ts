import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { ExperienceEditDraft, ResumeExperienceView } from '../../../types/resume';
import {
    clearPendingAssistantManualSaveDraft,
    type PendingAssistantManualSaveDraft,
    readPendingAssistantManualSaveDrafts,
} from '../../assistantManualSaveStorage';
import {
    applyAssistantExperienceDraftToEditingDraft,
    buildPendingAssistantManualSaveDraftKey,
} from '../assistantDraftApplyUtils';

type ResumeEditorManualDraftExperienceController = {
    editingExpId: string | null;
    editingDraft: ExperienceEditDraft | null;
    startEditingExperience: (experienceId: string) => void;
    setEditingDraft: Dispatch<SetStateAction<ExperienceEditDraft | null>>;
};

type UseResumeEditorManualSaveDraftsParams = {
    resumeId?: string;
    isLoadingExperiences: boolean;
    experienceItems: ResumeExperienceView[];
    experience: ResumeEditorManualDraftExperienceController;
    activeManualSaveDraftRef: MutableRefObject<PendingAssistantManualSaveDraft | null>;
    appliedManualSaveDraftKeyRef: MutableRefObject<string | null>;
};

export function selectResumeEditorManualSaveDrafts(
    drafts: PendingAssistantManualSaveDraft[],
    experienceItems: Pick<ResumeExperienceView, 'id'>[]
) {
    const resumeEditorDrafts = drafts.filter((draft) => draft.source === 'resume_editor');
    return resumeEditorDrafts.reduce<{
        pendingManualSaveDraft: PendingAssistantManualSaveDraft | null;
        staleManualSaveDrafts: PendingAssistantManualSaveDraft[];
    }>((result, draft) => {
        const targetExists = experienceItems.some((item) => item.id === draft.masterId);
        if (targetExists) {
            return result.pendingManualSaveDraft ? result : {
                ...result,
                pendingManualSaveDraft: draft,
            };
        }
        return {
            ...result,
            staleManualSaveDrafts: [...result.staleManualSaveDrafts, draft],
        };
    }, {
        pendingManualSaveDraft: null,
        staleManualSaveDrafts: [],
    });
}

export function resolveResumeEditorManualSaveDraftAction({
    pendingManualSaveDraft,
    draftKey,
    appliedManualSaveDraftKey,
    editingExpId,
    editingDraftMasterId,
}: {
    pendingManualSaveDraft: PendingAssistantManualSaveDraft;
    draftKey: string;
    appliedManualSaveDraftKey: string | null;
    editingExpId: string | null;
    editingDraftMasterId: string | null;
}): 'apply-draft' | 'skip' | 'start-editing' {
    if (editingExpId !== pendingManualSaveDraft.masterId) {
        return appliedManualSaveDraftKey === draftKey ? 'skip' : 'start-editing';
    }
    if (editingDraftMasterId !== pendingManualSaveDraft.masterId) {
        return 'skip';
    }
    if (appliedManualSaveDraftKey === draftKey) {
        return 'skip';
    }
    return 'apply-draft';
}

export function useResumeEditorManualSaveDrafts({
    resumeId,
    isLoadingExperiences,
    experienceItems,
    experience,
    activeManualSaveDraftRef,
    appliedManualSaveDraftKeyRef,
}: UseResumeEditorManualSaveDraftsParams) {
    useEffect(() => {
        if (!resumeId) {
            return;
        }
        if (isLoadingExperiences) {
            return;
        }
        const {
            pendingManualSaveDraft,
            staleManualSaveDrafts,
        } = selectResumeEditorManualSaveDrafts(
            readPendingAssistantManualSaveDrafts({ resumeId }),
            experienceItems
        );
        if (!pendingManualSaveDraft && staleManualSaveDrafts.length === 0) {
            activeManualSaveDraftRef.current = null;
            appliedManualSaveDraftKeyRef.current = null;
            return;
        }
        staleManualSaveDrafts.forEach((draft) => {
            clearPendingAssistantManualSaveDraft({
                sessionId: draft.sessionId,
                messageId: draft.messageId,
            });
        });
        if (!pendingManualSaveDraft) {
            activeManualSaveDraftRef.current = null;
            appliedManualSaveDraftKeyRef.current = null;
            return;
        }
        const draftKey = buildPendingAssistantManualSaveDraftKey(pendingManualSaveDraft);
        activeManualSaveDraftRef.current = pendingManualSaveDraft;
        const nextAction = resolveResumeEditorManualSaveDraftAction({
            pendingManualSaveDraft,
            draftKey,
            appliedManualSaveDraftKey: appliedManualSaveDraftKeyRef.current,
            editingExpId: experience.editingExpId,
            editingDraftMasterId: experience.editingDraft?.masterId ?? null,
        });
        if (nextAction === 'skip') {
            return;
        }
        if (nextAction === 'start-editing') {
            experience.startEditingExperience(pendingManualSaveDraft.masterId);
            return;
        }
        appliedManualSaveDraftKeyRef.current = draftKey;
        experience.setEditingDraft((prev) => {
            if (!prev || prev.masterId !== pendingManualSaveDraft.masterId) {
                return prev;
            }
            return applyAssistantExperienceDraftToEditingDraft(prev, pendingManualSaveDraft.draft);
        });
    }, [
        activeManualSaveDraftRef,
        appliedManualSaveDraftKeyRef,
        experience,
        experienceItems,
        isLoadingExperiences,
        resumeId,
    ]);
}
