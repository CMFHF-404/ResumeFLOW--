import type { ExperienceEditDraft, ResumeExperienceView } from '../../types/resume';
import { buildExperienceDate } from '../../utils/dateUtils';
import {
    isPresentLabel,
    resolveSafeDateRange,
} from './helpers';

export const buildExperienceViewFromDraft = (
    baseItem: ResumeExperienceView,
    draft: ExperienceEditDraft
): ResumeExperienceView => {
    const safeDates = resolveSafeDateRange(
        draft.startDate,
        draft.isCurrent ? '' : draft.endDate
    );
    const nextIsCurrent = draft.isCurrent ?? isPresentLabel(draft.endDate);
    return {
        ...baseItem,
        title: draft.title.trim() || baseItem.title,
        company: draft.company.trim() || baseItem.company,
        startDate: safeDates.start,
        endDate: nextIsCurrent ? '' : safeDates.end,
        isCurrent: nextIsCurrent,
        date: buildExperienceDate(
            safeDates.start,
            nextIsCurrent ? '' : safeDates.end,
            nextIsCurrent
        ),
        star: {
            s: draft.star.s,
            t: draft.star.t,
            a: draft.star.a,
            r: draft.star.r,
        },
    };
};
