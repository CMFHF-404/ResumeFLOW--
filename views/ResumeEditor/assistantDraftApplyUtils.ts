import type { ExperienceEditDraft } from '../../types/resume';
import type { PendingAssistantManualSaveDraft } from '../assistantManualSaveStorage';

export const applyAssistantExperienceDraftToEditingDraft = (
    draft: ExperienceEditDraft,
    assistantDraft: {
        org: string;
        title: string;
        startDate: string;
        endDate: string;
        isCurrent?: boolean;
        star: {
            s: string;
            t: string;
            a: string;
            r: string;
        };
    }
): ExperienceEditDraft => {
    const nextDraft: ExperienceEditDraft = {
        ...draft,
        company: assistantDraft.org,
        title: assistantDraft.title,
        startDate: assistantDraft.startDate || '',
        endDate: assistantDraft.isCurrent ? '' : (assistantDraft.endDate || ''),
        isCurrent: Boolean(assistantDraft.isCurrent),
        star: {
            s: assistantDraft.star.s,
            t: assistantDraft.star.t,
            a: assistantDraft.star.a,
            r: assistantDraft.star.r,
        },
        starTouched: true,
    };
    return (
        nextDraft.company === draft.company
        && nextDraft.title === draft.title
        && nextDraft.startDate === draft.startDate
        && nextDraft.endDate === draft.endDate
        && nextDraft.isCurrent === draft.isCurrent
        && nextDraft.star.s === draft.star.s
        && nextDraft.star.t === draft.star.t
        && nextDraft.star.a === draft.star.a
        && nextDraft.star.r === draft.star.r
        && nextDraft.starTouched === draft.starTouched
    )
        ? draft
        : nextDraft;
};

export const buildPendingAssistantManualSaveDraftKey = (
    draft: Pick<PendingAssistantManualSaveDraft, 'sessionId' | 'messageId' | 'resumeId' | 'masterId' | 'createdAt'>
) => [
    draft.sessionId,
    draft.messageId,
    draft.resumeId,
    draft.masterId,
    String(draft.createdAt),
].join(':');
