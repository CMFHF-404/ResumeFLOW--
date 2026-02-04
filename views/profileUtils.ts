import type { Profile } from '../services/profileService';

export const LINKEDIN_LABEL = 'linkedin';

export type SocialLinkValue = string | { url: string; position?: number };

export const extractSocialLinkUrl = (value: SocialLinkValue): string => {
    if (!value) {
        return '';
    }
    if (typeof value === 'string') {
        return value;
    }
    if (typeof value === 'object' && typeof value.url === 'string') {
        return value.url;
    }
    return '';
};

export const resolveLinkedInLink = (profile: Profile): string => {
    const fromSocialLinks = extractSocialLinkUrl(profile.social_links?.[LINKEDIN_LABEL]);
    if (fromSocialLinks) {
        return fromSocialLinks;
    }
    const matched = (profile.links || []).find((item) => item.label === LINKEDIN_LABEL);
    return matched?.url || '';
};

export const mergeLinkedInLink = (
    socialLinks: Record<string, any> | undefined,
    link: string
): Record<string, any> => {
    const nextLinks = { ...(socialLinks || {}) };
    const trimmedLink = link.trim();
    if (!trimmedLink) {
        delete nextLinks[LINKEDIN_LABEL];
        return nextLinks;
    }
    const existing = nextLinks[LINKEDIN_LABEL] as SocialLinkValue;
    if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
        const position = typeof existing.position === 'number' ? existing.position : 0;
        nextLinks[LINKEDIN_LABEL] = {
            ...existing,
            url: trimmedLink,
            position,
        };
        return nextLinks;
    }
    nextLinks[LINKEDIN_LABEL] = trimmedLink;
    return nextLinks;
};
