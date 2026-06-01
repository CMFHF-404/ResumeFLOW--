import type {
    ExperienceEditDraft,
    StarFieldKey,
    StarFields,
} from '../../types/resume';

export const STAR_FIELD_KEYS: StarFieldKey[] = ['s', 't', 'a', 'r'];

export const hasStarFieldsChange = (base: StarFields, next: StarFields) =>
    STAR_FIELD_KEYS.some((key) => base[key] !== next[key]);

export const resolveStarPayload = (
    draft: ExperienceEditDraft,
    sourceStar: Record<string, any> | undefined,
    mergeStarFieldsWithSource: (draft: StarFields, sourceStar?: Record<string, any>) => StarFields,
    options?: { hasStarOverride?: boolean }
) => {
    if (draft.starTouched || options?.hasStarOverride) {
        return draft.star;
    }
    return mergeStarFieldsWithSource(draft.star, sourceStar);
};
