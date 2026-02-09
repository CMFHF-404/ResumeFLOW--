import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import {
  UploadCloud,
  Download,
  Moon,
  Sun,
  Briefcase,
  FolderKanban,
  Wrench,
  User,
  Mail,
  Phone,
  MapPin,
  Link as LinkIcon,
  FileText,
} from 'lucide-react';
import ResumeUploadModal from '../components/ResumeUploadModal';
import PrintPortal from '../components/PrintPortal';
import { ToastContainer, useToast } from '../components/Toast';
import { Profile, profileService } from '../services/profileService';
import type { Certification } from '../services/certificationsService';
import { certificationsService } from '../services/certificationsService';
import type { ExperienceListItem } from '../services/experienceService';
import { experienceService } from '../services/experienceService';
import type { UserSkill } from '../services/skillsService';
import { skillsService } from '../services/skillsService';
import { useEducationManager } from '../hooks/useEducationManager';
import { usePrintJob } from '../hooks/usePrintJob';
import EducationSection from './EducationSection';
import ExperienceSection from './ExperienceSection';
import CertificationSection from './CertificationSection';
import SkillsSection from './SkillsSection';
import { mergeLinkedInLink, resolveLinkedInLink } from './profileUtils';
import ExperienceBankPrint from './ExperienceBankPrint';
import { buildExperienceBankExportTitle } from '../utils/exportFilename';
import type { ParsedPersonalInfo, ParsedPersonalInfoSelection } from '../services/parserService';
const PROFILE_REQUEST_RESET_DELAY_MS = 300;

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

type ExperienceBankExportSnapshot = {
  profile: Profile;
  workItems: ExperienceListItem[];
  projectItems: ExperienceListItem[];
  educationItems: ExperienceListItem[];
  certifications: Certification[];
  skills: UserSkill[];
};

const loadExperienceBankExportSnapshot = async (): Promise<ExperienceBankExportSnapshot> => {
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
interface ExperienceBankProps {
  cachedProfile?: any;
  onProfileUpdate?: (data: any) => void;
  shouldOpenResumeUpload?: boolean; // 是否自动打开简历上传弹窗
}

const ExperienceBank: React.FC<ExperienceBankProps> = ({ cachedProfile, onProfileUpdate, shouldOpenResumeUpload = false }) => {
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isResumeModalOpen, setIsResumeModalOpen] = useState(false);

  // Personal Info State
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [originalProfile, setOriginalProfile] = useState({
    name: "",
    email: "",
    phone: "",
    location: "",
    link: ""
  });
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [location, setLocation] = useState("");
  const [link, setLink] = useState("");
  const [profileSocialLinks, setProfileSocialLinks] = useState<Record<string, any>>({});

  // 请求防抖：使用 ref 追踪请求状态
  const isLoadingProfileRef = useRef(false);
  const hasHydratedProfileRef = useRef(false);

  // 使用 ref 存储回调，避免 useEffect 依赖项变化导致重复执行
  const onProfileUpdateRef = useRef(onProfileUpdate);


  const applyProfileSnapshot = useCallback((profile: Profile) => {
    const resolvedLink = resolveLinkedInLink(profile);
    setName(profile.full_name || "");
    setEmail(profile.email || "");
    setPhone(profile.phone || "");
    setLocation(profile.location || "");
    setLink(resolvedLink);
    setProfileSocialLinks({ ...(profile.social_links || {}) });
    setOriginalProfile({
      name: profile.full_name || "",
      email: profile.email || "",
      phone: profile.phone || "",
      location: profile.location || "",
      link: resolvedLink,
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
      setIsResumeModalOpen(true);
    }
  }, [shouldOpenResumeUpload]);

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
      link
    });
    setIsEditingProfile(true);
  };

  // 取消编辑个人信息
  const handleCancelProfile = () => {
    setName(originalProfile.name);
    setEmail(originalProfile.email);
    setPhone(originalProfile.phone);
    setLocation(originalProfile.location);
    setLink(originalProfile.link);
    setIsEditingProfile(false);
  };

  // 保存个人信息
  const handleSaveProfile = async () => {
    try {
      setIsSavingProfile(true);
      const nextSocialLinks = mergeLinkedInLink(profileSocialLinks, link);
      const updated = await profileService.updateProfile({
        full_name: name,
        email,
        phone,
        location,
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
  const { printContent, isPrinting, startPrint } = usePrintJob();

  const toastApi = useMemo(
    () => ({ success, error: toastError, info, loading, updateToast }),
    [success, toastError, info, loading, updateToast]
  );

  const education = useEducationManager(toastApi);
  const { refreshEducation } = education;

  const toggleTheme = () => {
    setIsDarkMode(!isDarkMode);
    document.documentElement.classList.toggle('dark');
  };

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
    if (isPrinting) {
      return;
    }
    const toastId = loading('正在准备导出...');
    try {
      const snapshot = await loadExperienceBankExportSnapshot();
      startPrint({
        title: buildExperienceBankExportTitle(),
        content: <ExperienceBankPrint {...snapshot} />,
      });
      updateToast(toastId, {
        message: '导出窗口已打开',
        type: 'success',
        duration: 1500,
      });
    } catch (error) {
      console.error('[ExperienceBank] 导出失败:', error);
      updateToast(toastId, {
        message: '导出失败，请稍后重试',
        type: 'error',
      });
    }
  }, [isPrinting, loading, startPrint, updateToast]);

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-gray-50 dark:bg-gray-900/50">
      <header className="h-16 bg-surface-light dark:bg-surface-dark border-b border-border-light dark:border-border-dark flex items-center justify-between px-8 shrink-0 z-20">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-primary hover:opacity-80 transition-opacity cursor-pointer">
            <FileText className="w-8 h-8" />
            <span className="font-bold text-xl tracking-tight text-gray-900 dark:text-white">ResumeFLOW</span>
          </div>
          <div className="h-6 w-px bg-border-light dark:bg-border-dark"></div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-500">经历库 / Experience Bank</span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <button
            className="hidden md:flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors border border-transparent hover:border-gray-200 dark:hover:border-gray-700"
            onClick={() => setIsResumeModalOpen(true)}
            type="button"
          >
            <UploadCloud className="w-4 h-4" />
            导入简历
          </button>
          <button
            className="hidden md:flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors border border-transparent hover:border-gray-200 dark:hover:border-gray-700 disabled:opacity-60 disabled:cursor-not-allowed"
            onClick={handleExportAll}
            disabled={isPrinting}
            type="button"
          >
            <Download className="w-4 h-4" />
            导出全部
          </button>
          <div className="w-px h-6 bg-gray-200 dark:bg-gray-700 mx-2"></div>
          <button className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400 transition-colors" onClick={toggleTheme}>
            {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-8 scroll-smooth">
        <div className="max-w-5xl mx-auto space-y-12 pb-20">

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
                    onChange={(e) => setName(e.target.value)}
                    disabled={!isEditingProfile || isLoadingProfile}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1"><Mail className="w-3 h-3" /> 邮箱</label>
                  <input
                    className="fluid-input text-base text-gray-700 dark:text-gray-300 w-full disabled:bg-transparent disabled:border-transparent disabled:p-0"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={!isEditingProfile || isLoadingProfile}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1"><Phone className="w-3 h-3" /> 电话</label>
                  <input
                    className="fluid-input text-base text-gray-700 dark:text-gray-300 w-full disabled:bg-transparent disabled:border-transparent disabled:p-0"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    disabled={!isEditingProfile || isLoadingProfile}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1"><MapPin className="w-3 h-3" /> 地点</label>
                  <input
                    className="fluid-input text-base text-gray-700 dark:text-gray-300 w-full disabled:bg-transparent disabled:border-transparent disabled:p-0"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    disabled={!isEditingProfile || isLoadingProfile}
                  />
                </div>
                <div className="space-y-1 md:col-span-2">
                  <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1"><LinkIcon className="w-3 h-3" /> 链接 (LinkedIn/Portfolio)</label>
                  <input
                    className="fluid-input text-base text-gray-700 dark:text-gray-300 w-full disabled:bg-transparent disabled:border-transparent disabled:p-0"
                    value={link}
                    onChange={(e) => setLink(e.target.value)}
                    disabled={!isEditingProfile || isLoadingProfile}
                  />
                </div>
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

      <PrintPortal isActive={Boolean(printContent)}>
        {printContent}
      </PrintPortal>

      <ToastContainer toasts={toasts} onClose={closeToast} />
    </div>
  );
};

export default ExperienceBank;
