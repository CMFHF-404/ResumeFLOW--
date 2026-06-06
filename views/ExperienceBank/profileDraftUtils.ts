import type { Profile } from '../../services/profileService';
import { mergeLinkedInLink, resolveLinkedInLink } from '../profileUtils';

export type ProfileDraftOverrides = {
  name: boolean;
  email: boolean;
  phone: boolean;
  location: boolean;
  link: boolean;
  summary: boolean;
};

export type ProfileDraftFields = {
  name: string;
  email: string;
  phone: string;
  location: string;
  link: string;
  summary: string;
  profileSocialLinks: Record<string, any>;
};

export type ProfileOriginalSnapshot = Omit<ProfileDraftFields, 'profileSocialLinks'> & {
  avatarDataUrl: string | null;
  extraJson: Record<string, any>;
};

export type ProfileFormSnapshot = ProfileDraftFields & {
  avatarDataUrl: string | null;
  extraJson: Record<string, any>;
  originalProfile: ProfileOriginalSnapshot;
};

export const createProfileDraftOverrides = (): ProfileDraftOverrides => ({
  name: false,
  email: false,
  phone: false,
  location: false,
  link: false,
  summary: false,
});

export const hasProfileDraftOverride = (overrides: ProfileDraftOverrides) => (
  Object.values(overrides).some(Boolean)
);

const readProfileExtraJson = (profile: Profile): Record<string, any> => profile.extra_json || {};

const readProfileAvatarDataUrl = (profile: Profile) => {
  const extraJson = readProfileExtraJson(profile);
  return typeof extraJson.avatar_data_url === 'string' ? extraJson.avatar_data_url : null;
};

export const buildProfileOriginalSnapshot = (profile: Profile): ProfileOriginalSnapshot => {
  const resolvedLink = resolveLinkedInLink(profile);
  const extraJson = readProfileExtraJson(profile);
  return {
    name: profile.full_name || '',
    email: profile.email || '',
    phone: profile.phone || '',
    location: profile.location || '',
    link: resolvedLink,
    summary: profile.summary || '',
    avatarDataUrl: readProfileAvatarDataUrl(profile),
    extraJson,
  };
};

export const buildProfileFormSnapshot = (profile: Profile): ProfileFormSnapshot => {
  const originalProfile = buildProfileOriginalSnapshot(profile);
  return {
    name: originalProfile.name,
    email: originalProfile.email,
    phone: originalProfile.phone,
    location: originalProfile.location,
    link: originalProfile.link,
    summary: originalProfile.summary,
    profileSocialLinks: { ...(profile.social_links || {}) },
    avatarDataUrl: originalProfile.avatarDataUrl,
    extraJson: originalProfile.extraJson,
    originalProfile,
  };
};

export const buildDraftProfileSnapshot = (
  profile: Profile | null,
  params: {
    hasHydratedProfile: boolean;
    overrides: ProfileDraftOverrides;
    currentDraft: ProfileDraftFields;
  },
): Profile | null => {
  if (!profile) {
    return null;
  }
  if (!params.hasHydratedProfile && !hasProfileDraftOverride(params.overrides)) {
    return profile;
  }
  const { currentDraft, overrides } = params;
  return {
    ...profile,
    full_name: overrides.name ? currentDraft.name : profile.full_name,
    email: overrides.email ? currentDraft.email : profile.email,
    phone: overrides.phone ? currentDraft.phone : profile.phone,
    location: overrides.location ? currentDraft.location : profile.location,
    summary: overrides.summary ? currentDraft.summary : profile.summary,
    social_links: overrides.link
      ? mergeLinkedInLink(profile.social_links || currentDraft.profileSocialLinks, currentDraft.link)
      : profile.social_links,
  };
};

export const buildRecoveredProfileFormSnapshot = (
  profile: Profile,
  params: {
    overrides: ProfileDraftOverrides;
    currentDraft: ProfileDraftFields;
  },
): ProfileFormSnapshot => {
  const base = buildProfileFormSnapshot(profile);
  const { currentDraft, overrides } = params;
  return {
    ...base,
    name: overrides.name ? currentDraft.name : base.name,
    email: overrides.email ? currentDraft.email : base.email,
    phone: overrides.phone ? currentDraft.phone : base.phone,
    location: overrides.location ? currentDraft.location : base.location,
    link: overrides.link ? currentDraft.link : base.link,
    summary: overrides.summary ? currentDraft.summary : base.summary,
    profileSocialLinks: overrides.link
      ? mergeLinkedInLink(profile.social_links || currentDraft.profileSocialLinks, currentDraft.link)
      : base.profileSocialLinks,
  };
};
