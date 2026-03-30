import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import {
  UploadCloud,
  Download,
  Briefcase,
  FolderKanban,
  Wrench,
  User,
  Mail,
  Phone,
  MapPin,
  Link as LinkIcon,
  FileText,
  Wand2,
} from 'lucide-react';
import { useLogto } from '@logto/react';
import ResumeUploadModal from '../components/ResumeUploadModal';
import { ToastContainer, useToast } from '../components/Toast';
import UnAuthPrompt from '../components/UnAuthPrompt';
import { exportService } from '../services/exportService';
import { aiService } from '../services/aiService';
import { Profile, profileService } from '../services/profileService';
import type { Certification } from '../services/certificationsService';
import { certificationsService } from '../services/certificationsService';
import type { ExperienceListItem } from '../services/experienceService';
import { experienceService } from '../services/experienceService';
import type { UserSkill } from '../services/skillsService';
import { skillsService } from '../services/skillsService';
import { useEducationManager } from '../hooks/useEducationManager';
import EducationSection from './EducationSection';
import ExperienceSection from './ExperienceSection';
import CertificationSection from './CertificationSection';
import SkillsSection from './SkillsSection';
import { mergeLinkedInLink, resolveLinkedInLink } from './profileUtils';
import type { ExperienceBankPdfRenderSnapshot } from '../types/experienceBankExport';
import {
  buildExperienceBankExportDateLabel,
  buildExperienceBankExportTitle,
} from '../utils/exportFilename';
import { buildExperienceBankPdfRenderSnapshot } from '../utils/experienceBankPdf';
import { downloadUrlFile } from '../utils/downloadUrlFile';
import type { ParsedPersonalInfo, ParsedPersonalInfoSelection } from '../services/parserService';
import { trackExperienceBankExported } from '../utils/analyticsTracker';
const PROFILE_REQUEST_RESET_DELAY_MS = 300;
const PENDING_RESUME_UPLOAD_KEY = 'yuanzijianli.pendingResumeUpload';

const readPendingResumeUpload = () => {
  if (typeof window === 'undefined') {
    return false;
  }
  try {
    return window.sessionStorage.getItem(PENDING_RESUME_UPLOAD_KEY) === '1';
  } catch (error) {
    return false;
  }
};

const writePendingResumeUpload = (shouldPersist: boolean) => {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    if (shouldPersist) {
      window.sessionStorage.setItem(PENDING_RESUME_UPLOAD_KEY, '1');
      return;
    }
    window.sessionStorage.removeItem(PENDING_RESUME_UPLOAD_KEY);
  } catch (error) {
    // ignore storage errors (private mode, etc.)
  }
};

const resolveNextProfilePatch = (
  parsedPersonalInfo?: ParsedPersonalInfo,
  currentProfile?: {
    name: string;
    email: string;
    phone: string;
    location: string;
  },
  selection?: ParsedPersonalInfoSelection
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

const sortById = <T extends { id: string }>(items: T[]) => (
  [...items].sort((left, right) => left.id.localeCompare(right.id))
);

const buildExperienceBankSummaryPayload = (
  profile: Profile | null,
  snapshot: ExperienceBankPdfRenderSnapshot
) => ({
  mode: 'bank' as const,
  profile: {
    name: profile?.full_name || '',
    email: profile?.email || '',
    phone: profile?.phone || '',
    location: profile?.location || '',
    linkedin: profile ? resolveLinkedInLink(profile) : '',
  },
  workExperiences: sortById(snapshot.workItems.map((item) => ({
    id: item.master.id,
    title: item.latest_version?.title || '',
    org: item.latest_version?.org || '',
    start_date: item.latest_version?.start_date,
    end_date: item.latest_version?.end_date,
    is_current: item.latest_version?.is_current ?? false,
    star: item.latest_version?.star || {},
    summary: item.latest_version?.summary || '',
  }))),
  projectExperiences: sortById(snapshot.projectItems.map((item) => ({
    id: item.master.id,
    title: item.latest_version?.title || '',
    org: item.latest_version?.org || '',
    start_date: item.latest_version?.start_date,
    end_date: item.latest_version?.end_date,
    is_current: item.latest_version?.is_current ?? false,
    star: item.latest_version?.star || {},
    summary: item.latest_version?.summary || '',
  }))),
  educationExperiences: sortById(snapshot.educationItems.map((item) => ({
    id: item.master.id,
    school: item.latest_version?.org || '',
    major: item.latest_version?.title || '',
    start_date: item.latest_version?.start_date,
    end_date: item.latest_version?.end_date,
    is_current: item.latest_version?.is_current ?? false,
    summary: item.latest_version?.summary || '',
    star: item.latest_version?.star || {},
  }))),
  certifications: sortById(snapshot.certifications.map((cert) => ({
    id: cert.id,
    name: cert.name,
    issuer: cert.issuer || '',
    issue_date: cert.issue_date || '',
  }))),
  skills: sortById(snapshot.skills.map((skill) => ({
    id: skill.id,
    name: skill.name,
    category: skill.category || '',
  }))),
});

const loadExperienceBankExportSnapshot = async (): Promise<ExperienceBankPdfRenderSnapshot> => {
  const [
    profile,
    workItems,
    projectItems,
    educationItems,
    certifications,
    skills,
  ] = await Promise.all([
    profileService.getProfile({ force: true }),
    experienceService.list('work', { force: true }),
    experienceService.list('project', { force: true }),
    experienceService.list('education', { force: true }),
    certificationsService.list({ force: true }),
    skillsService.list({ force: true }),
  ]);

  return {
    profile,
    workItems,
    projectItems,
    educationItems,
    certifications,
    skills,
  };
};

const loadExperienceBankValidationSnapshot = async (): Promise<ExperienceBankPdfRenderSnapshot | null> => {
  const [
    profile,
    workItems,
    projectItems,
    educationItems,
    certifications,
    skills,
  ] = await Promise.all([
    profileService.peekProfileForCurrentUser(),
    experienceService.peekListForCurrentUser('work', { allowStale: true }),
    experienceService.peekListForCurrentUser('project', { allowStale: true }),
    experienceService.peekListForCurrentUser('education', { allowStale: true }),
    certificationsService.peekListForCurrentUser({ allowStale: true }),
    skillsService.peekListForCurrentUser({ allowStale: true }),
  ]);

  if (!profile || !workItems || !projectItems || !educationItems || !certifications || !skills) {
    return null;
  }

  return {
    profile,
    workItems,
    projectItems,
    educationItems,
    certifications,
    skills,
  };
};
interface ExperienceBankProps {
  cachedProfile?: any;
  onProfileUpdate?: (data: any) => void;
  shouldOpenResumeUpload?: boolean; // 是否自动打开简历上传弹窗
}

const ExperienceBank: React.FC<ExperienceBankProps> = ({ cachedProfile, onProfileUpdate, shouldOpenResumeUpload = false }) => {
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isResumeModalOpen, setIsResumeModalOpen] = useState(false);
  const { isAuthenticated, signIn } = useLogto();

  const handleImportResumeClick = useCallback(async () => {
    if (!isAuthenticated) {
      writePendingResumeUpload(true);
      await signIn(import.meta.env.VITE_LOGTO_REDIRECT_URI || window.location.href);
      return;
    }
    writePendingResumeUpload(false);
    setIsResumeModalOpen(true);
  }, [isAuthenticated, signIn]);

  // Personal Info State
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [originalProfile, setOriginalProfile] = useState({
    name: "",
    email: "",
    phone: "",
    location: "",
    link: "",
    summary: "",
  });
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [location, setLocation] = useState("");
  const [link, setLink] = useState("");
  const [summary, setSummary] = useState("");
  const [profileSocialLinks, setProfileSocialLinks] = useState<Record<string, any>>({});
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const isLoadingProfileRef = useRef(false);
  const hasHydratedProfileRef = useRef(false);
  const summaryGenerationRequestIdRef = useRef(0);
  const summaryDraftVersionRef = useRef(0);
  const activeSummaryToastIdRef = useRef<string | null>(null);
  const profileDraftOverridesRef = useRef({
    name: false,
    email: false,
    phone: false,
    location: false,
    link: false,
    summary: false,
  });
  const latestDraftProfileRef = useRef({
    name: '',
    email: '',
    phone: '',
    location: '',
    link: '',
    summary: '',
    profileSocialLinks: {} as Record<string, any>,
  });

  latestDraftProfileRef.current = {
    name,
    email,
    phone,
    location,
    link,
    summary,
    profileSocialLinks,
  };

  const buildDraftProfileSnapshot = useCallback((profile: Profile | null): Profile | null => {
    if (!profile) {
      return null;
    }
    const overrides = profileDraftOverridesRef.current;
    const hasAnyOverride = Object.values(overrides).some(Boolean);
    if (!hasHydratedProfileRef.current && !hasAnyOverride) {
      return profile;
    }
    const currentDraft = latestDraftProfileRef.current;
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
  }, []);

  const markProfileFieldDraftTouched = useCallback((
    field: keyof typeof profileDraftOverridesRef.current
  ) => {
    profileDraftOverridesRef.current[field] = true;
  }, []);

  const resetProfileDraftOverrides = useCallback(() => {
    profileDraftOverridesRef.current = {
      name: false,
      email: false,
      phone: false,
      location: false,
      link: false,
      summary: false,
    };
  }, []);

  // 使用 ref 存储回调，避免 useEffect 依赖项变化导致重复执行
  const onProfileUpdateRef = useRef(onProfileUpdate);


  const applyProfileSnapshot = useCallback((profile: Profile) => {
    const resolvedLink = resolveLinkedInLink(profile);
    resetProfileDraftOverrides();
    setName(profile.full_name || "");
    setEmail(profile.email || "");
    setPhone(profile.phone || "");
    setLocation(profile.location || "");
    setLink(resolvedLink);
    setSummary(profile.summary || "");
    setProfileSocialLinks({ ...(profile.social_links || {}) });
    setOriginalProfile({
      name: profile.full_name || "",
      email: profile.email || "",
      phone: profile.phone || "",
      location: profile.location || "",
      link: resolvedLink,
      summary: profile.summary || "",
    });
  }, [resetProfileDraftOverrides]);

  const mergeRecoveredProfileIntoDraft = useCallback((profile: Profile) => {
    const overrides = profileDraftOverridesRef.current;
    const currentDraft = latestDraftProfileRef.current;
    const resolvedLink = resolveLinkedInLink(profile);
    const mergedSocialLinks = overrides.link
      ? mergeLinkedInLink(profile.social_links || currentDraft.profileSocialLinks, currentDraft.link)
      : { ...(profile.social_links || {}) };

    setName(overrides.name ? currentDraft.name : (profile.full_name || ""));
    setEmail(overrides.email ? currentDraft.email : (profile.email || ""));
    setPhone(overrides.phone ? currentDraft.phone : (profile.phone || ""));
    setLocation(overrides.location ? currentDraft.location : (profile.location || ""));
    setLink(overrides.link ? currentDraft.link : resolvedLink);
    setSummary(overrides.summary ? currentDraft.summary : (profile.summary || ""));
    setProfileSocialLinks(mergedSocialLinks);
    setOriginalProfile({
      name: profile.full_name || "",
      email: profile.email || "",
      phone: profile.phone || "",
      location: profile.location || "",
      link: resolvedLink,
      summary: profile.summary || "",
    });
  }, []);

  // 同步最新的回调函数到 ref
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

  // 加载个人资料
  useEffect(() => {
    const loadProfile = async () => {
      // 防抖：如果已有请求正在进行，直接返回
      if (isLoadingProfileRef.current) {
        console.log('[ExperienceBank] 请求防抖：跳过重复请求');
        return;
      }

      try {
        isLoadingProfileRef.current = true;
        if (!hasHydratedProfileRef.current) {
          setIsLoadingProfile(true);
        }
        console.log('[ExperienceBank] 开始加载个人资料...');

        // profileService 已有内置缓存机制，会自动处理缓存
        const profile = await profileService.getProfile();

        applyProfileSnapshot(profile);
        hasHydratedProfileRef.current = true;

        console.log('[ExperienceBank] 加载成功');

        // 使用 ref 调用回调，更新 App 级缓存
        if (onProfileUpdateRef.current) {
          onProfileUpdateRef.current(profile);
        }
      } catch (err) {
        console.error('Failed to load profile:', err);
      } finally {
        setIsLoadingProfile(false);
        // 延迟重置请求状态
        setTimeout(() => {
          isLoadingProfileRef.current = false;
        }, PROFILE_REQUEST_RESET_DELAY_MS);
      }
    };

    loadProfile();
  }, []); // ✅ 空依赖数组，只在挂载时执行一次

  // 检测是否需要自动打开简历上传弹窗
  useEffect(() => {
    if (shouldOpenResumeUpload) {
      console.log('[ExperienceBank] 自动打开简历上传弹窗');
      void handleImportResumeClick();
    }
  }, [handleImportResumeClick, shouldOpenResumeUpload]);

  useEffect(() => {
    if (!isAuthenticated || !readPendingResumeUpload()) {
      return;
    }
    console.log('[ExperienceBank] 恢复待执行的简历导入动作');
    writePendingResumeUpload(false);
    setIsResumeModalOpen(true);
  }, [isAuthenticated]);

  // 开始编辑个人信息
  const handleEditProfile = () => {
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
    });
    setIsEditingProfile(true);
  };

  // 取消编辑个人信息
  const handleCancelProfile = () => {
    summaryGenerationRequestIdRef.current += 1;
    if (activeSummaryToastIdRef.current) {
      closeToast(activeSummaryToastIdRef.current);
      activeSummaryToastIdRef.current = null;
    }
    setIsGeneratingSummary(false);
    summaryDraftVersionRef.current += 1;
    resetProfileDraftOverrides();
    setName(originalProfile.name);
    setEmail(originalProfile.email);
    setPhone(originalProfile.phone);
    setLocation(originalProfile.location);
    setLink(originalProfile.link);
    setSummary(originalProfile.summary);
    setIsEditingProfile(false);
  };

  // 保存个人信息
  const handleSaveProfile = async () => {
    try {
      summaryGenerationRequestIdRef.current += 1;
      if (activeSummaryToastIdRef.current) {
        closeToast(activeSummaryToastIdRef.current);
        activeSummaryToastIdRef.current = null;
      }
      setIsGeneratingSummary(false);
      setIsSavingProfile(true);
      const nextSocialLinks = mergeLinkedInLink(profileSocialLinks, link);
      const updated = await profileService.updateProfile({
        full_name: name,
        email,
        phone,
        location,
        summary,
        social_links: nextSocialLinks,
      });
      applyProfileSnapshot(updated);
      setIsEditingProfile(false);
      if (onProfileUpdateRef.current) {
        onProfileUpdateRef.current(updated);
      }
      success('个人信息保存成功');
    } catch (err) {
      console.error('Failed to save profile:', err);
      toastError('个人信息保存失败');
    } finally {
      setIsSavingProfile(false);
    }
  };

  // Toast 状态管理
  const { toasts, success, error: toastError, info, loading, updateToast, closeToast } = useToast();
  const [experienceRefreshSignal, setExperienceRefreshSignal] = useState(0);
  const [isExportingPdf, setIsExportingPdf] = useState(false);

  const toastApi = useMemo(
    () => ({ success, error: toastError, info, loading, updateToast }),
    [success, toastError, info, loading, updateToast]
  );

  const education = useEducationManager(toastApi);
  const { refreshEducation } = education;

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
    personalInfoSelection?: ParsedPersonalInfoSelection
  ) => {
    const currentProfile = await resolveCurrentProfileSnapshot();
    if (!currentProfile) {
      setExperienceRefreshSignal((prev) => prev + 1);
      await refreshEducation();
      return;
    }
    const profilePatch = resolveNextProfilePatch(
      parsedPersonalInfo,
      currentProfile,
      personalInfoSelection
    );
    if (profilePatch) {
      try {
        const updatedProfile = await profileService.updateProfile(profilePatch);
        applyProfileSnapshot(updatedProfile);
        if (onProfileUpdateRef.current) {
          onProfileUpdateRef.current(updatedProfile);
        }
      } catch (error) {
        console.error('[ExperienceBank] 个人信息自动回填失败:', error);
      }
    }
    setExperienceRefreshSignal((prev) => prev + 1);
    await refreshEducation();
  }, [applyProfileSnapshot, refreshEducation, resolveCurrentProfileSnapshot]);

  const handleExportAll = useCallback(async () => {
    if (isExportingPdf) {
      return;
    }

    const exportDate = new Date();
    const exportTitle = buildExperienceBankExportTitle(exportDate);
    const toastId = loading('正在生成 PDF...');
    setIsExportingPdf(true);

    try {
      const latestSnapshot = await loadExperienceBankExportSnapshot();
      const profileSnapshot = buildDraftProfileSnapshot(latestSnapshot.profile);
      const snapshot = buildExperienceBankPdfRenderSnapshot({
        ...latestSnapshot,
        profile: profileSnapshot,
        exportDateLabel: buildExperienceBankExportDateLabel(exportDate),
      });
      const { downloadUrl, fileName } = await exportService.createExperienceBankPdfDownloadLink(
        snapshot,
        exportTitle
      );
      await downloadUrlFile(downloadUrl, fileName);
      trackExperienceBankExported({
        workCount: snapshot.workItems.length,
        projectCount: snapshot.projectItems.length,
        educationCount: snapshot.educationItems.length,
        certificationCount: snapshot.certifications.length,
        skillCount: snapshot.skills.length,
      });
      updateToast(toastId, {
        message: 'PDF 已生成，开始下载。',
        type: 'success',
        duration: 3000,
      });
    } catch (error) {
      console.error('[ExperienceBank] 导出失败:', error);
      updateToast(toastId, {
        message: error instanceof Error ? error.message : '导出失败，请稍后重试',
        type: 'error',
      });
    } finally {
      setIsExportingPdf(false);
    }
  }, [buildDraftProfileSnapshot, isExportingPdf, loading, updateToast]);

  const handleGenerateSummary = useCallback(async () => {
    if (isGeneratingSummary || isLoadingProfile) {
      return;
    }

    setIsGeneratingSummary(true);
    const requestId = summaryGenerationRequestIdRef.current + 1;
    summaryGenerationRequestIdRef.current = requestId;
    const draftVersionAtStart = summaryDraftVersionRef.current;
    const isCurrentSummaryRequest = () => summaryGenerationRequestIdRef.current === requestId;
    let toastId: string | null = null;
    const releaseActiveSummaryToast = () => {
      if (toastId && activeSummaryToastIdRef.current === toastId) {
        activeSummaryToastIdRef.current = null;
      }
    };
    try {
      const latestSnapshot = await loadExperienceBankExportSnapshot();
      if (
        !isCurrentSummaryRequest()
        || summaryDraftVersionRef.current !== draftVersionAtStart
      ) {
        return;
      }
      mergeRecoveredProfileIntoDraft(latestSnapshot.profile);
      hasHydratedProfileRef.current = true;
      const hasContent = latestSnapshot.workItems.length > 0
        || latestSnapshot.projectItems.length > 0
        || latestSnapshot.educationItems.length > 0
        || latestSnapshot.certifications.length > 0
        || latestSnapshot.skills.length > 0;
      const profileSnapshot = buildDraftProfileSnapshot(latestSnapshot.profile);
      const existingSummary = profileSnapshot?.summary?.trim() || '';
      if (!hasContent) {
        toastError('请先完善经历库内容后再生成个人评价。');
        return;
      }
      if (existingSummary && typeof window !== 'undefined') {
        const shouldOverwrite = window.confirm('当前已有个人评价内容，是否用 AI 生成结果覆盖？');
        if (!shouldOverwrite) {
          return;
        }
      }

      toastId = loading('正在生成个人评价...');
      activeSummaryToastIdRef.current = toastId;
      if (!isEditingProfile) {
        setIsEditingProfile(true);
      }
      const requestPayload = buildExperienceBankSummaryPayload(profileSnapshot, latestSnapshot);
      const requestSignature = JSON.stringify(requestPayload);

      const response = await aiService.generatePersonalSummaryStream(requestPayload, (event) => {
        if (toastId && event.type === 'thought' && isCurrentSummaryRequest()) {
          updateToast(toastId, {
            message: event.summary,
            type: 'ai_thinking',
            duration: 0,
          });
        }
      });

      if (
        !isCurrentSummaryRequest()
        || summaryDraftVersionRef.current !== draftVersionAtStart
      ) {
        if (toastId) {
          closeToast(toastId);
        }
        releaseActiveSummaryToast();
        return;
      }
      const currentSnapshot = await loadExperienceBankValidationSnapshot();
      if (!currentSnapshot) {
        if (toastId) {
          closeToast(toastId);
        }
        releaseActiveSummaryToast();
        return;
      }
      const currentProfileSnapshot = buildDraftProfileSnapshot(currentSnapshot.profile);
      const currentSignature = JSON.stringify(
        buildExperienceBankSummaryPayload(currentProfileSnapshot, currentSnapshot)
      );
      if (
        !isCurrentSummaryRequest()
        || summaryDraftVersionRef.current !== draftVersionAtStart
        || currentSignature !== requestSignature
      ) {
        if (toastId) {
          closeToast(toastId);
        }
        releaseActiveSummaryToast();
        return;
      }
      markProfileFieldDraftTouched('summary');
      setSummary(response.summary);
      if (toastId) {
        updateToast(toastId, {
          message: '个人评价已生成',
          type: 'success',
          duration: 2500,
        });
      }
      releaseActiveSummaryToast();
    } catch (error) {
      if (!isCurrentSummaryRequest()) {
        if (toastId) {
          closeToast(toastId);
        }
        releaseActiveSummaryToast();
        return;
      }
      console.error('[ExperienceBank] 个人评价生成失败:', error);
      if (toastId) {
        updateToast(toastId, {
          message: error instanceof Error ? error.message : '个人评价生成失败，请稍后重试',
          type: 'error',
          duration: 3500,
        });
      } else {
        toastError(error instanceof Error ? error.message : '个人评价生成失败，请稍后重试');
      }
      releaseActiveSummaryToast();
    } finally {
      if (isCurrentSummaryRequest()) {
        setIsGeneratingSummary(false);
      }
    }
  }, [
    buildDraftProfileSnapshot,
    closeToast,
    email,
    isEditingProfile,
    isGeneratingSummary,
    isLoadingProfile,
    link,
    loading,
    location,
    mergeRecoveredProfileIntoDraft,
    name,
    phone,
    summary,
    toastError,
    updateToast,
  ]);

  const handleSummaryChange = useCallback((value: string) => {
    summaryDraftVersionRef.current += 1;
    markProfileFieldDraftTouched('summary');
    setSummary(value);
  }, [markProfileFieldDraftTouched]);

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

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-gray-50 dark:bg-gray-900/50">
      <header className="hidden bg-surface-light dark:bg-surface-dark border-b border-border-light dark:border-border-dark px-4 py-3 shrink-0 z-20 md:block md:px-8">
        <div className="flex flex-col gap-3 md:h-10 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-3 md:gap-4">
          <div className="flex items-center gap-2 text-primary hover:opacity-80 transition-opacity cursor-pointer">
            <FileText className="w-8 h-8" />
            <span className="font-bold text-lg tracking-tight text-gray-900 dark:text-white md:text-xl">原子简历</span>
          </div>
          <div className="hidden h-6 w-px bg-border-light dark:bg-border-dark md:block"></div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-gray-500 sm:text-sm">经历库 / Experience Bank</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 md:justify-end md:gap-4">
          <UnAuthPrompt />
          <button
            className="flex items-center gap-2 rounded-lg border border-transparent px-3 py-2 text-xs font-medium text-gray-600 transition-colors hover:border-gray-200 hover:bg-gray-100 dark:text-gray-300 dark:hover:border-gray-700 dark:hover:bg-gray-800 sm:px-4 sm:text-sm"
            onClick={handleImportResumeClick}
            type="button"
          >
            <UploadCloud className="w-4 h-4" />
            导入简历
          </button>
          <button
            className="flex items-center gap-2 rounded-lg border border-transparent px-3 py-2 text-xs font-medium text-gray-600 transition-colors hover:border-gray-200 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60 dark:text-gray-300 dark:hover:border-gray-700 dark:hover:bg-gray-800 sm:px-4 sm:text-sm"
            onClick={handleExportAll}
            disabled={isExportingPdf || isLoadingProfile}
            type="button"
          >
            <Download className="w-4 h-4" />
            {isExportingPdf ? '导出中...' : '导出全部'}
          </button>
        </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-4 scroll-smooth md:p-8">
        <div className="max-w-5xl mx-auto space-y-12 pb-20">
          <div className="flex items-center gap-2 md:hidden">
            <button
              className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-surface-dark dark:text-gray-200 dark:hover:bg-gray-800"
              onClick={handleImportResumeClick}
              type="button"
            >
              <UploadCloud className="h-4 w-4" />
              导入简历
            </button>
            <button
              className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-surface-dark dark:text-gray-200 dark:hover:bg-gray-800"
              onClick={handleExportAll}
              disabled={isExportingPdf || isLoadingProfile}
              type="button"
            >
              <Download className="h-4 w-4" />
              {isExportingPdf ? '导出中...' : '导出全部'}
            </button>
          </div>

          {/* Personal Info Section */}
          <section className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <User className="w-5 h-5 text-indigo-500" />
                个人信息
                <span className="text-sm font-normal text-gray-400 ml-2">Personal Info</span>
              </h2>
              <div>
                {!isEditingProfile ? (
                  <button
                    onClick={handleEditProfile}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-primary bg-primary/10 rounded-lg hover:bg-primary/20 transition-colors"
                    disabled={isLoadingProfile}
                  >
                    <Wrench className="w-4 h-4" />
                    编辑
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleCancelProfile}
                      className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-300 dark:hover:text-white dark:hover:bg-gray-800 rounded-lg transition-colors"
                      disabled={isSavingProfile}
                    >
                      取消
                    </button>
                    <button
                      onClick={handleSaveProfile}
                      className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-dark transition-colors disabled:opacity-50"
                      disabled={isSavingProfile}
                    >
                      {isSavingProfile ? '保存中...' : '保存'}
                    </button>
                  </div>
                )}
              </div>
            </div>
            <div className="bg-white dark:bg-surface-dark rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-sm">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1"><User className="w-3 h-3" /> 姓名</label>
                  <input
                    className="fluid-input text-lg font-bold text-gray-900 dark:text-white w-full disabled:bg-transparent disabled:border-transparent disabled:p-0"
                    value={name}
                    onChange={(e) => handleNameChange(e.target.value)}
                    disabled={!isEditingProfile || isLoadingProfile}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1"><Mail className="w-3 h-3" /> 邮箱</label>
                  <input
                    className="fluid-input text-base text-gray-700 dark:text-gray-300 w-full disabled:bg-transparent disabled:border-transparent disabled:p-0"
                    value={email}
                    onChange={(e) => handleEmailChange(e.target.value)}
                    disabled={!isEditingProfile || isLoadingProfile}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1"><Phone className="w-3 h-3" /> 电话</label>
                  <input
                    className="fluid-input text-base text-gray-700 dark:text-gray-300 w-full disabled:bg-transparent disabled:border-transparent disabled:p-0"
                    value={phone}
                    onChange={(e) => handlePhoneChange(e.target.value)}
                    disabled={!isEditingProfile || isLoadingProfile}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1"><MapPin className="w-3 h-3" /> 地点</label>
                  <input
                    className="fluid-input text-base text-gray-700 dark:text-gray-300 w-full disabled:bg-transparent disabled:border-transparent disabled:p-0"
                    value={location}
                    onChange={(e) => handleLocationChange(e.target.value)}
                    disabled={!isEditingProfile || isLoadingProfile}
                  />
                </div>
                <div className="space-y-1 md:col-span-2">
                  <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1"><LinkIcon className="w-3 h-3" /> 链接 (LinkedIn/Portfolio)</label>
                  <input
                    className="fluid-input text-base text-gray-700 dark:text-gray-300 w-full disabled:bg-transparent disabled:border-transparent disabled:p-0"
                    value={link}
                    onChange={(e) => handleLinkChange(e.target.value)}
                    disabled={!isEditingProfile || isLoadingProfile}
                  />
                </div>
              </div>
              <div className="mt-6 border-t border-gray-100 pt-5 dark:border-gray-700">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-gray-400">
                      <FileText className="h-3.5 w-3.5 text-gray-400" />
                      个人评价
                    </label>
                    <p className="mt-1 text-xs text-gray-400">适用于简历“自我评价”部分的总结内容。</p>
                  </div>
                  {isEditingProfile && (
                    <button
                      type="button"
                      onClick={() => void handleGenerateSummary()}
                      disabled={isGeneratingSummary || isLoadingProfile}
                      className="inline-flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/10 px-3 py-2 text-xs font-medium text-primary transition-colors hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Wand2 className={`h-4 w-4 ${isGeneratingSummary ? 'animate-spin' : ''}`} />
                      {isGeneratingSummary ? '生成中...' : 'AI 一键生成'}
                    </button>
                  )}
                </div>
                {isEditingProfile ? (
                  <textarea
                    className="min-h-[132px] w-full resize-y rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm leading-6 text-gray-700 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15 dark:border-gray-700 dark:bg-surface-dark dark:text-gray-300"
                    value={summary}
                    onChange={(e) => handleSummaryChange(e.target.value)}
                    disabled={isLoadingProfile}
                    placeholder="填写适合展示在简历中的个人评价，或AI自动基于个人经历生成。"
                  />
                ) : (
                  <div className="min-h-[132px] rounded-lg border border-gray-100 bg-gray-50/70 px-4 py-3 text-sm leading-8 text-gray-700 dark:border-gray-700 dark:bg-gray-800/50 dark:text-gray-300">
                    {summary.trim() ? (
                      <p className="whitespace-pre-wrap break-words">{summary.trim()}</p>
                    ) : (
                      <p className="text-gray-400 dark:text-gray-500">
                        填写适合展示在简历中的个人评价，或AI自动基于个人经历生成。
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </section>

          <ExperienceSection
            category="work"
            title="工作经历"
            subtitle="Work Experience"
            icon={<Briefcase className="w-5 h-5 text-primary" />}
            labels={{
              orgLabel: '公司名称',
              titleLabel: '担任职位',
              orgPlaceholder: '输入公司名称',
              titlePlaceholder: '输入职位名称',
              summaryPlaceholder: '点击展开编辑工作经历...',
            }}
            addButtonLabel="新增工作经历"
            emptyTitleError="职位名称不能为空"
            deleteConfirmText="确定要删除这条工作经历吗？"
            defaultOrg="新公司"
            defaultTitle="新职位"
            refreshSignal={experienceRefreshSignal}
            toast={toastApi}
          />

          <ExperienceSection
            category="project"
            title="项目经历"
            subtitle="Project Experience"
            icon={<FolderKanban className="w-5 h-5 text-indigo-500" />}
            labels={{
              orgLabel: '项目名称',
              titleLabel: '担任角色',
              orgPlaceholder: '输入项目名称',
              titlePlaceholder: '输入角色名称',
              summaryPlaceholder: '点击展开编辑项目经历...',
            }}
            addButtonLabel="新增项目经历"
            emptyTitleError="角色名称不能为空"
            deleteConfirmText="确定要删除这条项目经历吗？"
            defaultOrg="新项目"
            defaultTitle="新角色"
            refreshSignal={experienceRefreshSignal}
            toast={toastApi}
            themeColor="indigo"
          />

          <EducationSection model={education} />

          <CertificationSection refreshSignal={experienceRefreshSignal} toast={toastApi} />

          <SkillsSection refreshSignal={experienceRefreshSignal} toast={toastApi} />

        </div>
      </main>

      <ResumeUploadModal
        isOpen={isResumeModalOpen}
        onClose={() => setIsResumeModalOpen(false)}
        onImported={handleResumeImported}
        profileSnapshot={{
          name,
          email,
          phone,
          location,
        }}
        toast={toastApi}
      />

      <ToastContainer toasts={toasts} onClose={closeToast} />
    </div>
  );
};

export default ExperienceBank;
