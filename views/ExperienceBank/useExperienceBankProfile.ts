import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ToastConfig } from '../../components/Toast';
import type { GeneratePersonalSummaryParams } from '../../services/aiService';
import { devLog } from '../../services/devLogger';
import type { ParsedPersonalInfo, ParsedPersonalInfoSelection } from '../../services/parserService';
import { type Profile, profileService } from '../../services/profileService';
import {
  assertAuthCacheKey,
  isAuthContextChangedError,
  type AuthOwnerOptions,
} from '../../services/apiClient';
import {
  assertResumeAuthContext,
  isResumeVersionConflict,
  resumeService,
  waitForResumeMutations,
  type Resume as ResumeRecord,
} from '../../services/resumeService';
import { isOwnerOperationCurrent } from '../../utils/ownerScopedValue';
import type { ExperienceBankPdfRenderSnapshot } from '../../types/experienceBankExport';
import { mergeLinkedInLink } from '../profileUtils';
import { getActiveResumeId, setActiveResumeId } from '../../services/resumeStorage';
import {
  buildDraftProfileSnapshot as buildProfileDraftSnapshot,
  buildProfileFormSnapshot,
  buildRecoveredProfileFormSnapshot,
  createProfileDraftOverrides,
} from './profileDraftUtils';
import { useExperienceBankSummaryGeneration } from './useExperienceBankSummaryGeneration';
import { updateResumeTargetRoleWithConflictRetry } from './targetRoleUpdate';
import { useAuthOwnerOperationGuard } from '../../hooks/useAuthOwnerOperationGuard';

const PROFILE_REQUEST_RESET_DELAY_MS = 300;
const SUMMARY_PREVIEW_CHAR_LIMIT = 100;
const TARGET_ROLE_UPDATE_DEPENDENCIES = {
  update: resumeService.update,
  get: resumeService.get,
  waitForMutations: waitForResumeMutations,
  isConflict: isResumeVersionConflict,
};

type ToastFn = (message: string, duration?: number) => string;
type LoadingToastFn = (message: string) => string;
type UpdateToastFn = (id: string, updates: Partial<Omit<ToastConfig, 'id'>>) => void;

type UseExperienceBankProfileParams = {
  authUserKey: string | null;
  isAuthenticated: boolean;
  onRequireAuth: () => void | Promise<void>;
  cachedProfile?: Profile | null;
  onProfileUpdate?: (data: Profile) => void;
  onResumeUpdate?: (data: ResumeRecord) => void;
  refreshEducation: (options?: AuthOwnerOptions) => Promise<unknown>;
  loadExportSnapshot: (expectedAuthCacheKey: string) => Promise<ExperienceBankPdfRenderSnapshot>;
  loadValidationSnapshot: (expectedAuthCacheKey: string) => Promise<ExperienceBankPdfRenderSnapshot | null>;
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
  authUserKey,
  isAuthenticated,
  onRequireAuth,
  cachedProfile,
  onProfileUpdate,
  onResumeUpdate,
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
  const ownerGuard = useAuthOwnerOperationGuard(authUserKey);
  const [isLoadingProfile, setIsLoadingProfile] = useState(isAuthenticated);
  const [isLoadingTargetRole, setIsLoadingTargetRole] = useState(isAuthenticated);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [activeResumeId, setActiveResumeIdState] = useState<string | null>(null);
  const [targetRole, setTargetRole] = useState('');
  const [originalTargetRole, setOriginalTargetRole] = useState('');
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
  const onResumeUpdateRef = useRef(onResumeUpdate);
  const activeProfileSaveRef = useRef<symbol | null>(null);

  useLayoutEffect(() => {
    latestDraftProfileRef.current = {
      name,
      email,
      phone,
      location,
      link,
      summary,
      profileSocialLinks,
    };
  }, [email, link, location, name, phone, profileSocialLinks, summary]);

  useLayoutEffect(() => {
    activeProfileSaveRef.current = null;
    setIsSavingProfile(false);
  }, [authUserKey]);

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
    onResumeUpdateRef.current = onResumeUpdate;
  }, [onResumeUpdate]);

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }
    if (
      !cachedProfile
      || !authUserKey
      || cachedProfile.user_id !== authUserKey
    ) {
      return;
    }
    applyProfileSnapshot(cachedProfile);
    hasHydratedProfileRef.current = true;
    setIsLoadingProfile(false);
  }, [authUserKey, cachedProfile, applyProfileSnapshot, isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated || !authUserKey || authUserKey === 'anonymous') {
      setActiveResumeIdState(null);
      setTargetRole('');
      setOriginalTargetRole('');
      setIsLoadingTargetRole(isAuthenticated);
      return;
    }
    const expectedAuthCacheKey = authUserKey;
    let isCancelled = false;
    const canCommit = async () => {
      if (!isOwnerOperationCurrent(
        isCancelled,
        authUserKey,
        expectedAuthCacheKey,
      )) {
        return false;
      }
      try {
        await assertResumeAuthContext(expectedAuthCacheKey);
      } catch {
        return false;
      }
      return isOwnerOperationCurrent(
        isCancelled,
        authUserKey,
        expectedAuthCacheKey,
      );
    };
    const loadTargetRole = async () => {
      setIsLoadingTargetRole(true);
      try {
        if (!await canCommit()) return;
        let resumeId = getActiveResumeId(expectedAuthCacheKey);
        let resolvedTargetRole = '';
        if (resumeId) {
          try {
          const detail = await resumeService.get(resumeId, { expectedAuthCacheKey });
            if (!await canCommit()) return;
            resolvedTargetRole = detail.resume.target_role?.trim() ?? '';
          } catch (error) {
            if (!await canCommit()) return;
            const status = typeof error === 'object' && error
              ? (error as { response?: { status?: number } }).response?.status
              : undefined;
            if (status !== 404) {
              throw error;
            }
            resumeId = null;
          }
        }
        if (!resumeId) {
          const resumes = await resumeService.list({
            force: true,
            expectedAuthCacheKey,
          });
          if (!await canCommit()) return;
          const firstResume = resumes[0];
          if (firstResume) {
            resumeId = firstResume.id;
            resolvedTargetRole = firstResume.target_role?.trim() ?? '';
            if (!await canCommit()) return;
            setActiveResumeId(expectedAuthCacheKey, firstResume.id);
          }
        }
        if (!await canCommit()) return;
        setActiveResumeIdState(resumeId);
        setTargetRole(resolvedTargetRole);
        setOriginalTargetRole(resolvedTargetRole);
      } catch (error) {
        console.error('[ExperienceBank] 加载意向岗位失败:', error);
        if (await canCommit()) {
          setActiveResumeIdState(null);
          setTargetRole('');
          setOriginalTargetRole('');
        }
      } finally {
        if (await canCommit()) {
          setIsLoadingTargetRole(false);
        }
      }
    };
    void loadTargetRole();
    return () => {
      isCancelled = true;
    };
  }, [authUserKey, isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated || !authUserKey || authUserKey === 'anonymous') {
      hasHydratedProfileRef.current = false;
      isLoadingProfileRef.current = false;
      setIsLoadingProfile(isAuthenticated);
      return;
    }
    const expectedAuthCacheKey = authUserKey;
    let isCancelled = false;
    let resetTimer: ReturnType<typeof setTimeout> | null = null;
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
        const profile = await profileService.getProfile({ expectedAuthCacheKey });
        if (
          isCancelled
          || profile.user_id !== expectedAuthCacheKey
        ) {
          return;
        }

        applyProfileSnapshot(profile);
        hasHydratedProfileRef.current = true;
        devLog('[ExperienceBank] 加载成功');
        onProfileUpdateRef.current?.(profile);
      } catch (error) {
        if (!isCancelled) {
          console.error('Failed to load profile:', error);
        }
      } finally {
        if (!isCancelled) {
          setIsLoadingProfile(false);
          resetTimer = setTimeout(() => {
            isLoadingProfileRef.current = false;
          }, PROFILE_REQUEST_RESET_DELAY_MS);
        }
      }
    };

    void loadProfile();
    return () => {
      isCancelled = true;
      if (resetTimer) clearTimeout(resetTimer);
      isLoadingProfileRef.current = false;
    };
  }, [applyProfileSnapshot, authUserKey, isAuthenticated]);

  const handleEditProfile = useCallback(() => {
    if (!isAuthenticated) {
      void onRequireAuth();
      return;
    }
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
    setOriginalTargetRole(targetRole);
    setIsEditingProfile(true);
  }, [avatarDataUrl, email, isAuthenticated, isLoadingProfile, link, location, name, onRequireAuth, phone, profileExtraJson, summary, targetRole]);

  const {
    isGeneratingSummary,
    cancelSummaryGeneration,
    handleGenerateSummary: runGenerateSummary,
    handleSummaryChange,
  } = useExperienceBankSummaryGeneration({
    authUserKey,
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

  const handleGenerateSummary = useCallback(async () => {
    if (!isAuthenticated) {
      await onRequireAuth();
      return;
    }
    await runGenerateSummary();
  }, [isAuthenticated, onRequireAuth, runGenerateSummary]);

  const handleCancelProfile = useCallback(() => {
    cancelSummaryGeneration({ bumpDraftVersion: true });
    resetProfileDraftOverrides();
    setName(originalProfile.name);
    setEmail(originalProfile.email);
    setPhone(originalProfile.phone);
    setLocation(originalProfile.location);
    setLink(originalProfile.link);
    setTargetRole(originalTargetRole);
    setSummary(originalProfile.summary);
    setAvatarDataUrl(originalProfile.avatarDataUrl);
    setProfileExtraJson(originalProfile.extraJson);
    setIsEditingProfile(false);
  }, [cancelSummaryGeneration, originalProfile, originalTargetRole, resetProfileDraftOverrides]);

  const handleSaveProfile = useCallback(async () => {
    if (!isAuthenticated) {
      await onRequireAuth();
      return;
    }
    let profileSaved = false;
    const requestId = Symbol('experience-bank-profile-save');
    activeProfileSaveRef.current = requestId;
    let operation: Awaited<ReturnType<typeof ownerGuard.beginOperation>> | null = null;
    try {
      cancelSummaryGeneration();
      setIsSavingProfile(true);
      operation = await ownerGuard.beginOperation();
      if (activeProfileSaveRef.current !== requestId) {
        return;
      }
      const nextSocialLinks = mergeLinkedInLink(profileSocialLinks, link);
      const nextExtraJson = { ...profileExtraJson };
      if (avatarDataUrl) {
        nextExtraJson.avatar_data_url = avatarDataUrl;
      } else {
        delete nextExtraJson.avatar_data_url;
      }
      const updated = await profileService.updateProfile(
        {
          full_name: name,
          email,
          phone,
          location,
          summary,
          social_links: nextSocialLinks,
          extra_json: nextExtraJson,
        },
        { expectedAuthCacheKey: operation.expectedAuthCacheKey },
      );
      await ownerGuard.assertOperationCurrent(operation);
      applyProfileSnapshot(updated);
      profileSaved = true;
      onProfileUpdateRef.current?.(updated);
      const normalizedTargetRole = targetRole.trim();
      if (activeResumeId && normalizedTargetRole !== originalTargetRole.trim()) {
        const updatedResume = await updateResumeTargetRoleWithConflictRetry(
          activeResumeId,
          normalizedTargetRole,
          TARGET_ROLE_UPDATE_DEPENDENCIES,
          { expectedAuthCacheKey: operation.expectedAuthCacheKey },
        );
        await ownerGuard.assertOperationCurrent(operation);
        const savedTargetRole = updatedResume.target_role?.trim() ?? normalizedTargetRole;
        setTargetRole(savedTargetRole);
        setOriginalTargetRole(savedTargetRole);
        onResumeUpdateRef.current?.(updatedResume);
      } else {
        setTargetRole(normalizedTargetRole);
        setOriginalTargetRole(normalizedTargetRole);
      }
      setIsEditingProfile(false);
      success('个人信息保存成功');
    } catch (error) {
      if (
        !isAuthContextChangedError(error)
        && operation
        && ownerGuard.isOperationCurrent(operation)
        && activeProfileSaveRef.current === requestId
      ) {
        console.error('Failed to save profile:', error);
        toastError(profileSaved
          ? '个人信息已保存，但意向岗位保存失败'
          : '个人信息保存失败');
      }
    } finally {
      if (activeProfileSaveRef.current === requestId) {
        activeProfileSaveRef.current = null;
        setIsSavingProfile(false);
      }
    }
  }, [
    applyProfileSnapshot,
    activeResumeId,
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
    isAuthenticated,
    onRequireAuth,
    ownerGuard,
    originalTargetRole,
    targetRole,
  ]);

  const resolveCurrentProfileSnapshot = useCallback(async (
    expectedAuthCacheKey: string,
  ) => {
    if (!isAuthenticated || authUserKey !== expectedAuthCacheKey) {
      return null;
    }
    await assertAuthCacheKey(expectedAuthCacheKey);
    if (hasHydratedProfileRef.current && !isLoadingProfile) {
      return { name, email, phone, location };
    }
    try {
      const latestProfile = await profileService.getProfile({
        force: true,
        expectedAuthCacheKey,
      });
      await assertAuthCacheKey(expectedAuthCacheKey);
      applyProfileSnapshot(latestProfile);
      hasHydratedProfileRef.current = true;
      return buildProfileSnapshot(latestProfile);
    } catch (error) {
      if (isAuthContextChangedError(error)) {
        throw error;
      }
      console.error('[ExperienceBank] 刷新个人资料失败:', error);
      return null;
    }
  }, [
    applyProfileSnapshot,
    authUserKey,
    email,
    isAuthenticated,
    isLoadingProfile,
    location,
    name,
    phone,
  ]);

  const handleResumeImported = useCallback(async (
    parsedPersonalInfo?: ParsedPersonalInfo,
    personalInfoSelection?: ParsedPersonalInfoSelection,
    options?: AuthOwnerOptions,
  ) => {
    const expectedAuthCacheKey = options?.expectedAuthCacheKey ?? authUserKey;
    if (!expectedAuthCacheKey || expectedAuthCacheKey === 'anonymous') {
      return false;
    }
    await assertAuthCacheKey(expectedAuthCacheKey);
    const currentProfile = await resolveCurrentProfileSnapshot(expectedAuthCacheKey);
    if (!currentProfile) {
      await refreshEducation({ expectedAuthCacheKey });
      await assertAuthCacheKey(expectedAuthCacheKey);
      return false;
    }
    const profilePatch = resolveNextProfilePatch(
      parsedPersonalInfo,
      currentProfile,
      personalInfoSelection,
    );
    if (profilePatch) {
      try {
        const updatedProfile = await profileService.updateProfile(profilePatch, {
          expectedAuthCacheKey,
        });
        await assertAuthCacheKey(expectedAuthCacheKey);
        applyProfileSnapshot(updatedProfile);
        onProfileUpdateRef.current?.(updatedProfile);
      } catch (error) {
        if (isAuthContextChangedError(error)) {
          throw error;
        }
        console.error('[ExperienceBank] 个人信息自动回填失败:', error);
      }
    }
    await refreshEducation({ expectedAuthCacheKey });
    await assertAuthCacheKey(expectedAuthCacheKey);
    return true;
  }, [
    applyProfileSnapshot,
    authUserKey,
    refreshEducation,
    resolveCurrentProfileSnapshot,
  ]);

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

  const handleTargetRoleChange = useCallback((value: string) => {
    setTargetRole(value);
  }, []);

  const handleLinkChange = useCallback((value: string) => {
    markProfileFieldDraftTouched('link');
    setLink(value);
  }, [markProfileFieldDraftTouched]);

  const isAvatarInteractionEnabled = isAuthenticated && !isLoadingProfile && !isSavingProfile;

  const handleAvatarUploadClick = useCallback(() => {
    if (!isAuthenticated) {
      void onRequireAuth();
      return;
    }
    if (!isAvatarInteractionEnabled) {
      return;
    }
    avatarFileInputRef.current?.click();
  }, [isAuthenticated, isAvatarInteractionEnabled, onRequireAuth]);

  const handleFileSelected = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    if (!isAuthenticated) {
      event.target.value = '';
      void onRequireAuth();
      return;
    }
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
  }, [isAuthenticated, onRequireAuth]);

  const handleCropConfirm = useCallback((cropDataUrl: string) => {
    if (!isAuthenticated) {
      void onRequireAuth();
      return;
    }
    setAvatarDataUrl(cropDataUrl);
    setIsCropModalOpen(false);
    setPendingImageSrc(null);
    if (!isEditingProfile) {
      setIsEditingProfile(true);
    }
  }, [isAuthenticated, isEditingProfile, onRequireAuth]);

  const handleAvatarDelete = useCallback(() => {
    if (!isAuthenticated) {
      void onRequireAuth();
      return;
    }
    setAvatarDataUrl(null);
    setIsCropModalOpen(false);
    setPendingImageSrc(null);
    if (!isEditingProfile) {
      setIsEditingProfile(true);
    }
  }, [isAuthenticated, isEditingProfile, onRequireAuth]);

  const handleCropCancel = useCallback(() => {
    setIsCropModalOpen(false);
    setPendingImageSrc(null);
  }, []);

  return {
    isLoadingProfile,
    isLoadingTargetRole,
    isSavingProfile,
    isEditingProfile,
    activeResumeId,
    name,
    email,
    phone,
    location,
    targetRole,
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
    handleTargetRoleChange,
    handleLinkChange,
    handleAvatarUploadClick,
    handleFileSelected,
    handleCropConfirm,
    handleAvatarDelete,
    handleCropCancel,
  };
};
