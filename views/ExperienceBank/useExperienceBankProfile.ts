import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ToastConfig } from '../../components/Toast';
import type { GeneratePersonalSummaryParams } from '../../services/aiService';
import { devLog } from '../../services/devLogger';
import type { ParsedPersonalInfo, ParsedPersonalInfoSelection } from '../../services/parserService';
import { type Profile, profileService } from '../../services/profileService';
import type { ExperienceBankPdfRenderSnapshot } from '../../types/experienceBankExport';
import { mergeLinkedInLink } from '../profileUtils';
import {
  buildDraftProfileSnapshot as buildProfileDraftSnapshot,
  buildProfileFormSnapshot,
  buildRecoveredProfileFormSnapshot,
  createProfileDraftOverrides,
} from './profileDraftUtils';
import { useExperienceBankSummaryGeneration } from './useExperienceBankSummaryGeneration';

const PROFILE_REQUEST_RESET_DELAY_MS = 300;
const SUMMARY_PREVIEW_CHAR_LIMIT = 100;

type ToastFn = (message: string, duration?: number) => string;
type LoadingToastFn = (message: string) => string;
type UpdateToastFn = (id: string, updates: Partial<Omit<ToastConfig, 'id'>>) => void;

type UseExperienceBankProfileParams = {
  cachedProfile?: Profile | null;
  onProfileUpdate?: (data: Profile) => void;
  refreshEducation: () => Promise<unknown>;
  loadExportSnapshot: () => Promise<ExperienceBankPdfRenderSnapshot>;
  loadValidationSnapshot: () => Promise<ExperienceBankPdfRenderSnapshot | null>;
  buildSummaryPayload: (
    profile: Profile | null,
    snapshot: ExperienceBankPdfRenderSnapshot,
  ) => GeneratePersonalSummaryParams;
  success: ToastFn;
  toastError: ToastFn;
  loading: LoadingToastFn;
  updateToast: UpdateToastFn;
  closeToast: (id: string) => void;
};

const buildSummaryPreview = (value: string, limit: number) => {
  const normalized = value.trim();
  const characters = Array.from(normalized);

  if (characters.length <= limit) {
    return {
      text: normalized,
      isTruncated: false,
    };
  }

  return {
    text: `${characters.slice(0, limit).join('')}...`,
    isTruncated: true,
  };
};

const resolveNextProfilePatch = (
  parsedPersonalInfo?: ParsedPersonalInfo,
  currentProfile?: {
    name: string;
    email: string;
    phone: string;
    location: string;
  },
  selection?: ParsedPersonalInfoSelection,
) => {
  if (!parsedPersonalInfo) {
    return null;
  }
  const nextFullName = parsedPersonalInfo.full_name?.trim();
  const nextEmail = parsedPersonalInfo.email?.trim();
  const nextPhone = parsedPersonalInfo.phone?.trim();
  const nextLocation = parsedPersonalInfo.location?.trim();
  const patch: {
    full_name?: string;
    email?: string;
    phone?: string;
    location?: string;
  } = {};
  const shouldApply = (key: keyof ParsedPersonalInfoSelection, currentValue?: string) => {
    if (selection) {
      return selection[key];
    }
    return !currentValue?.trim();
  };
  if (nextFullName && shouldApply('full_name', currentProfile?.name)) {
    patch.full_name = nextFullName;
  }
  if (nextEmail && shouldApply('email', currentProfile?.email)) {
    patch.email = nextEmail;
  }
  if (nextPhone && shouldApply('phone', currentProfile?.phone)) {
    patch.phone = nextPhone;
  }
  if (nextLocation && shouldApply('location', currentProfile?.location)) {
    patch.location = nextLocation;
  }
  return Object.keys(patch).length ? patch : null;
};

const buildProfileSnapshot = (profile: Profile) => ({
  name: profile.full_name || '',
  email: profile.email || '',
  phone: profile.phone || '',
  location: profile.location || '',
});

export const useExperienceBankProfile = ({
  cachedProfile,
  onProfileUpdate,
  refreshEducation,
  loadExportSnapshot,
  loadValidationSnapshot,
  buildSummaryPayload,
  success,
  toastError,
  loading,
  updateToast,
  closeToast,
}: UseExperienceBankProfileParams) => {
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [originalProfile, setOriginalProfile] = useState({
    name: '',
    email: '',
    phone: '',
    location: '',
    link: '',
    summary: '',
    avatarDataUrl: null as string | null,
    extraJson: {} as Record<string, any>,
  });
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [location, setLocation] = useState('');
  const [link, setLink] = useState('');
  const [summary, setSummary] = useState('');
  const [profileSocialLinks, setProfileSocialLinks] = useState<Record<string, any>>({});
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(null);
  const [profileExtraJson, setProfileExtraJson] = useState<Record<string, any>>({});
  const [isCropModalOpen, setIsCropModalOpen] = useState(false);
  const [pendingImageSrc, setPendingImageSrc] = useState<string | null>(null);
  const avatarFileInputRef = useRef<HTMLInputElement>(null);
  const [isSummaryExpanded, setIsSummaryExpanded] = useState(false);
  const isLoadingProfileRef = useRef(false);
  const hasHydratedProfileRef = useRef(false);
  const profileDraftOverridesRef = useRef(createProfileDraftOverrides());
  const latestDraftProfileRef = useRef({
    name: '',
    email: '',
    phone: '',
    location: '',
    link: '',
    summary: '',
    profileSocialLinks: {} as Record<string, any>,
  });
  const onProfileUpdateRef = useRef(onProfileUpdate);

  latestDraftProfileRef.current = {
    name,
    email,
    phone,
    location,
    link,
    summary,
    profileSocialLinks,
  };

  const summaryText = useMemo(() => summary.trim(), [summary]);
  const summaryPreview = useMemo(
    () => buildSummaryPreview(summaryText, SUMMARY_PREVIEW_CHAR_LIMIT),
    [summaryText],
  );

  useEffect(() => {
    setIsSummaryExpanded(false);
  }, [summaryText, isEditingProfile]);

  const buildCurrentProfileDraftSnapshot = useCallback((profile: Profile | null): Profile | null => {
    return buildProfileDraftSnapshot(profile, {
      hasHydratedProfile: hasHydratedProfileRef.current,
      overrides: profileDraftOverridesRef.current,
      currentDraft: latestDraftProfileRef.current,
    });
  }, []);

  const markProfileFieldDraftTouched = useCallback((
    field: keyof typeof profileDraftOverridesRef.current,
  ) => {
    profileDraftOverridesRef.current[field] = true;
  }, []);

  const markSummaryDraftTouched = useCallback(() => {
    markProfileFieldDraftTouched('summary');
  }, [markProfileFieldDraftTouched]);

  const resetProfileDraftOverrides = useCallback(() => {
    profileDraftOverridesRef.current = createProfileDraftOverrides();
  }, []);

  const applyProfileSnapshot = useCallback((profile: Profile) => {
    const snapshot = buildProfileFormSnapshot(profile);
    resetProfileDraftOverrides();
    setName(snapshot.name);
    setEmail(snapshot.email);
    setPhone(snapshot.phone);
    setLocation(snapshot.location);
    setLink(snapshot.link);
    setSummary(snapshot.summary);
    setProfileSocialLinks(snapshot.profileSocialLinks);
    setAvatarDataUrl(snapshot.avatarDataUrl);
    setProfileExtraJson(snapshot.extraJson);
    setOriginalProfile(snapshot.originalProfile);
  }, [resetProfileDraftOverrides]);

  const mergeRecoveredProfileIntoDraft = useCallback((profile: Profile) => {
    const snapshot = buildRecoveredProfileFormSnapshot(profile, {
      overrides: profileDraftOverridesRef.current,
      currentDraft: latestDraftProfileRef.current,
    });
    setName(snapshot.name);
    setEmail(snapshot.email);
    setPhone(snapshot.phone);
    setLocation(snapshot.location);
    setLink(snapshot.link);
    setSummary(snapshot.summary);
    setProfileSocialLinks(snapshot.profileSocialLinks);
    setOriginalProfile(snapshot.originalProfile);
  }, []);

  useEffect(() => {
    onProfileUpdateRef.current = onProfileUpdate;
  }, [onProfileUpdate]);

  useEffect(() => {
    if (!cachedProfile) {
      return;
    }
    applyProfileSnapshot(cachedProfile);
    hasHydratedProfileRef.current = true;
    setIsLoadingProfile(false);
  }, [cachedProfile, applyProfileSnapshot]);

  useEffect(() => {
    const loadProfile = async () => {
      if (isLoadingProfileRef.current) {
        devLog('[ExperienceBank] 请求防抖：跳过重复请求');
        return;
      }

      try {
        isLoadingProfileRef.current = true;
        if (!hasHydratedProfileRef.current) {
          setIsLoadingProfile(true);
        }
        devLog('[ExperienceBank] 开始加载个人资料...');
        const profile = await profileService.getProfile();

        applyProfileSnapshot(profile);
        hasHydratedProfileRef.current = true;
        devLog('[ExperienceBank] 加载成功');
        onProfileUpdateRef.current?.(profile);
      } catch (error) {
        console.error('Failed to load profile:', error);
      } finally {
        setIsLoadingProfile(false);
        setTimeout(() => {
          isLoadingProfileRef.current = false;
        }, PROFILE_REQUEST_RESET_DELAY_MS);
      }
    };

    void loadProfile();
  }, [applyProfileSnapshot]);

  const handleEditProfile = useCallback(() => {
    if (isLoadingProfile) {
      return;
    }
    setOriginalProfile({
      name,
      email,
      phone,
      location,
      link,
      summary,
      avatarDataUrl,
      extraJson: profileExtraJson,
    });
    setIsEditingProfile(true);
  }, [avatarDataUrl, email, isLoadingProfile, link, location, name, phone, profileExtraJson, summary]);

  const {
    isGeneratingSummary,
    cancelSummaryGeneration,
    handleGenerateSummary,
    handleSummaryChange,
  } = useExperienceBankSummaryGeneration({
    isLoadingProfile,
    isEditingProfile,
    hasHydratedProfileRef,
    setIsEditingProfile,
    setSummary,
    loadExportSnapshot,
    loadValidationSnapshot,
    buildSummaryPayload,
    buildCurrentProfileDraftSnapshot,
    mergeRecoveredProfileIntoDraft,
    markSummaryDraftTouched,
    toastError,
    loading,
    updateToast,
    closeToast,
  });

  const handleCancelProfile = useCallback(() => {
    cancelSummaryGeneration({ bumpDraftVersion: true });
    resetProfileDraftOverrides();
    setName(originalProfile.name);
    setEmail(originalProfile.email);
    setPhone(originalProfile.phone);
    setLocation(originalProfile.location);
    setLink(originalProfile.link);
    setSummary(originalProfile.summary);
    setAvatarDataUrl(originalProfile.avatarDataUrl);
    setProfileExtraJson(originalProfile.extraJson);
    setIsEditingProfile(false);
  }, [cancelSummaryGeneration, originalProfile, resetProfileDraftOverrides]);

  const handleSaveProfile = useCallback(async () => {
    try {
      cancelSummaryGeneration();
      setIsSavingProfile(true);
      const nextSocialLinks = mergeLinkedInLink(profileSocialLinks, link);
      const nextExtraJson = { ...profileExtraJson };
      if (avatarDataUrl) {
        nextExtraJson.avatar_data_url = avatarDataUrl;
      } else {
        delete nextExtraJson.avatar_data_url;
      }
      const updated = await profileService.updateProfile({
        full_name: name,
        email,
        phone,
        location,
        summary,
        social_links: nextSocialLinks,
        extra_json: nextExtraJson,
      });
      applyProfileSnapshot(updated);
      setIsEditingProfile(false);
      onProfileUpdateRef.current?.(updated);
      success('个人信息保存成功');
    } catch (error) {
      console.error('Failed to save profile:', error);
      toastError('个人信息保存失败');
    } finally {
      setIsSavingProfile(false);
    }
  }, [
    applyProfileSnapshot,
    avatarDataUrl,
    cancelSummaryGeneration,
    email,
    link,
    location,
    name,
    phone,
    profileExtraJson,
    profileSocialLinks,
    success,
    summary,
    toastError,
  ]);

  const resolveCurrentProfileSnapshot = useCallback(async () => {
    if (hasHydratedProfileRef.current && !isLoadingProfile) {
      return { name, email, phone, location };
    }
    try {
      const latestProfile = await profileService.getProfile({ force: true });
      applyProfileSnapshot(latestProfile);
      hasHydratedProfileRef.current = true;
      return buildProfileSnapshot(latestProfile);
    } catch (error) {
      console.error('[ExperienceBank] 刷新个人资料失败:', error);
      return null;
    }
  }, [applyProfileSnapshot, email, isLoadingProfile, location, name, phone]);

  const handleResumeImported = useCallback(async (
    parsedPersonalInfo?: ParsedPersonalInfo,
    personalInfoSelection?: ParsedPersonalInfoSelection,
  ) => {
    const currentProfile = await resolveCurrentProfileSnapshot();
    if (!currentProfile) {
      await refreshEducation();
      return false;
    }
    const profilePatch = resolveNextProfilePatch(
      parsedPersonalInfo,
      currentProfile,
      personalInfoSelection,
    );
    if (profilePatch) {
      try {
        const updatedProfile = await profileService.updateProfile(profilePatch);
        applyProfileSnapshot(updatedProfile);
        onProfileUpdateRef.current?.(updatedProfile);
      } catch (error) {
        console.error('[ExperienceBank] 个人信息自动回填失败:', error);
      }
    }
    await refreshEducation();
    return true;
  }, [applyProfileSnapshot, refreshEducation, resolveCurrentProfileSnapshot]);

  const handleNameChange = useCallback((value: string) => {
    markProfileFieldDraftTouched('name');
    setName(value);
  }, [markProfileFieldDraftTouched]);

  const handleEmailChange = useCallback((value: string) => {
    markProfileFieldDraftTouched('email');
    setEmail(value);
  }, [markProfileFieldDraftTouched]);

  const handlePhoneChange = useCallback((value: string) => {
    markProfileFieldDraftTouched('phone');
    setPhone(value);
  }, [markProfileFieldDraftTouched]);

  const handleLocationChange = useCallback((value: string) => {
    markProfileFieldDraftTouched('location');
    setLocation(value);
  }, [markProfileFieldDraftTouched]);

  const handleLinkChange = useCallback((value: string) => {
    markProfileFieldDraftTouched('link');
    setLink(value);
  }, [markProfileFieldDraftTouched]);

  const isAvatarInteractionEnabled = !isLoadingProfile && !isSavingProfile;

  const handleAvatarUploadClick = useCallback(() => {
    if (!isAvatarInteractionEnabled) {
      return;
    }
    avatarFileInputRef.current?.click();
  }, [isAvatarInteractionEnabled]);

  const handleFileSelected = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      const src = loadEvent.target?.result as string;
      setPendingImageSrc(src);
      setIsCropModalOpen(true);
    };
    reader.readAsDataURL(file);
    event.target.value = '';
  }, []);

  const handleCropConfirm = useCallback((cropDataUrl: string) => {
    setAvatarDataUrl(cropDataUrl);
    setIsCropModalOpen(false);
    setPendingImageSrc(null);
    if (!isEditingProfile) {
      setIsEditingProfile(true);
    }
  }, [isEditingProfile]);

  const handleAvatarDelete = useCallback(() => {
    setAvatarDataUrl(null);
    setIsCropModalOpen(false);
    setPendingImageSrc(null);
    if (!isEditingProfile) {
      setIsEditingProfile(true);
    }
  }, [isEditingProfile]);

  const handleCropCancel = useCallback(() => {
    setIsCropModalOpen(false);
    setPendingImageSrc(null);
  }, []);

  return {
    isLoadingProfile,
    isSavingProfile,
    isEditingProfile,
    name,
    email,
    phone,
    location,
    link,
    summary,
    summaryText,
    summaryPreview,
    isSummaryExpanded,
    setIsSummaryExpanded,
    avatarDataUrl,
    isCropModalOpen,
    pendingImageSrc,
    avatarFileInputRef,
    isGeneratingSummary,
    isAvatarInteractionEnabled,
    buildCurrentProfileDraftSnapshot,
    handleEditProfile,
    handleCancelProfile,
    handleSaveProfile,
    handleResumeImported,
    handleGenerateSummary,
    handleSummaryChange,
    handleNameChange,
    handleEmailChange,
    handlePhoneChange,
    handleLocationChange,
    handleLinkChange,
    handleAvatarUploadClick,
    handleFileSelected,
    handleCropConfirm,
    handleAvatarDelete,
    handleCropCancel,
  };
};
