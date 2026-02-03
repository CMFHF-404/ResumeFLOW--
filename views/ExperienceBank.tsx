
import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { UploadCloud, Download, Moon, Sun, Briefcase, Plus, ChevronUp, ChevronDown, Trash2, GraduationCap, FolderKanban, Wrench, User, Mail, Phone, MapPin, Link as LinkIcon, X, LayoutTemplate, Award } from 'lucide-react';
import MonthPicker from '../components/MonthPicker';
import ResumeUploadModal from '../components/ResumeUploadModal';
import { Profile, profileService } from '../services/profileService';
import { experienceService, ExperienceListItem } from '../services/experienceService';
import { skillsService, UserSkill } from '../services/skillsService';
import { certificationsService, Certification as CertificationRecord, CertificationUpdatePayload } from '../services/certificationsService';
import ConfirmDialog from '../components/ConfirmDialog';
import { ToastContainer, useToast } from '../components/Toast';
import ExperienceSection from './ExperienceSection';
import { convertDateToISO, getTodayLocalISODate, parseYearMonthValue, resolveCardMotionClass, runDedupedRefresh } from './experienceUtils';

const LINKEDIN_LABEL = "linkedin";
const PROFILE_REQUEST_RESET_DELAY_MS = 300;
const EDUCATION_DEFAULT_ORG = "新学校";
const EDUCATION_DEFAULT_TITLE = "新专业";
const CERT_DEFAULT_NAME = "新证书";
const CERT_DEFAULT_ISSUER = "颁发机构";
// 用于在 description 中保存匹配度，避免破坏后端结构
const CERT_META_PREFIX = "__rf_cert_meta__:";

const EDU_TOAST_MESSAGES = {
  createLoading: "正在创建教育经历...",
  createSuccess: "教育经历创建成功",
  createError: "创建教育经历失败，请重试",
  saveLoading: "正在保存教育经历...",
  saveSuccess: "教育经历保存成功",
  saveError: "保存失败，请重试",
  deleteLoading: "正在删除教育经历...",
  deleteSuccess: "教育经历删除成功",
  deleteError: "删除失败，请重试",
};

const SKILL_TOAST_MESSAGES = {
  createLoading: "正在添加技能...",
  createSuccess: "技能添加成功",
  createError: "添加技能失败，请重试",
  deleteLoading: "正在删除技能...",
  deleteSuccess: "技能删除成功",
  deleteError: "删除失败，请重试",
};

const DEFAULT_SKILL_CATEGORY = "未分类";

const SKILL_CATEGORY_TOAST_MESSAGES = {
  renameLoading: "正在更新技能分类...",
  renameSuccess: "分类更新成功",
  renameError: "分类更新失败，请重试",
};

const SKILL_CATEGORY_VALIDATION_MESSAGES = {
  emptyName: "分类名称不能为空",
  nameExists: "该分类已存在",
};

const CERT_TOAST_MESSAGES = {
  createLoading: "正在创建证书...",
  createSuccess: "证书创建成功",
  createError: "创建证书失败，请重试",
  saveLoading: "正在保存证书...",
  saveSuccess: "证书保存成功",
  saveError: "保存失败，请重重试",
  deleteLoading: "正在删除证书...",
  deleteSuccess: "证书删除成功",
  deleteError: "删除失败，请重试",
};

type SocialLinkValue = string | { url?: string; position?: number } | null | undefined;

type EduCardData = {
  school: string;
  major: string;
  degree: string;
  startDate: string;
  endDate: string;
  gpa: string;
  courses: string;
};

type CertificationCardData = {
  name: string;
  issuer: string;
  date: string;
  matchRate: number;
};

const createEmptyEduCardData = (): EduCardData => ({
  school: "",
  major: "",
  degree: "",
  startDate: "",
  endDate: "",
  gpa: "",
  courses: "",
});

const resolveStarText = (star: Record<string, any> | undefined, key: string): string => {
  if (!star) {
    return "";
  }
  const value = star[key];
  if (Array.isArray(value)) {
    return value.join("、");
  }
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
};

const buildEduCardData = (item: ExperienceListItem): EduCardData => {
  const latest = item.latest_version;
  const star = latest?.star || {};
  return {
    school: latest?.org || "",
    major: latest?.title || "",
    degree: resolveStarText(star, "degree"),
    startDate: latest?.start_date || "",
    endDate: latest?.end_date || "",
    gpa: resolveStarText(star, "gpa"),
    courses: resolveStarText(star, "courses"),
  };
};

const cloneEduCardData = (data: EduCardData) => JSON.parse(JSON.stringify(data));

const buildEduStarPayload = (data: EduCardData): Record<string, any> => {
  const star: Record<string, any> = {};
  const degree = data.degree.trim();
  const gpa = data.gpa.trim();
  const courses = data.courses.trim();
  if (degree) {
    star.degree = degree;
  }
  if (gpa) {
    star.gpa = gpa;
  }
  if (courses) {
    star.courses = courses;
  }
  return star;
};

const parseCertificationMatchRate = (description?: string): number => {
  if (!description || !description.startsWith(CERT_META_PREFIX)) {
    return 0;
  }
  try {
    const raw = description.slice(CERT_META_PREFIX.length);
    const parsed = JSON.parse(raw);
    const value = Number(parsed?.matchRate);
    if (!Number.isFinite(value)) {
      return 0;
    }
    return Math.min(100, Math.max(0, Math.round(value)));
  } catch {
    return 0;
  }
};

const buildCertificationMetaDescription = (matchRate: number) => {
  return `${CERT_META_PREFIX}${JSON.stringify({ matchRate })}`;
};

const canPersistCertificationMeta = (description?: string) => {
  return !description || description.startsWith(CERT_META_PREFIX);
};

const buildCertificationCardData = (cert: CertificationRecord): CertificationCardData => ({
  name: cert.name || "",
  issuer: cert.issuer || "",
  date: cert.issue_date || "",
  matchRate: parseCertificationMatchRate(cert.description),
});

const cloneCertificationCardData = (data: CertificationCardData) => JSON.parse(JSON.stringify(data));

const normalizeCertificationData = (data: CertificationCardData): CertificationCardData => ({
  name: data.name.trim(),
  issuer: data.issuer.trim(),
  date: data.date.trim(),
  matchRate: Math.min(100, Math.max(0, Math.round(data.matchRate || 0))),
});

const buildCertificationPayload = (
  data: CertificationCardData,
  description?: string
): CertificationUpdatePayload => ({
  name: data.name,
  issuer: data.issuer || undefined,
  issue_date: convertDateToISO(data.date),
  description,
});

const normalizeSkillName = (name: string) => name.trim().toLowerCase();

const normalizeCategoryName = (name: string) => name.trim();

const normalizeCategoryKey = (name: string) => normalizeCategoryName(name);

const resolveSkillCategoryName = (category?: string) => {
  const trimmed = (category || "").trim();
  return trimmed || DEFAULT_SKILL_CATEGORY;
};

const buildGroupedSkills = (items: UserSkill[]) => {
  return items.reduce((acc, skill) => {
    const category = resolveSkillCategoryName(skill.category);
    if (!acc[category]) {
      acc[category] = [];
    }
    acc[category].push(skill);
    return acc;
  }, {} as Record<string, UserSkill[]>);
};

// 保持技能分类的展示顺序：按技能首次出现顺序，其次是手动添加的空分类
const buildSkillCategoryOrder = (items: UserSkill[], extraCategories: string[]) => {
  const order: string[] = [];
  const seen = new Set<string>();
  const append = (name: string) => {
    const key = normalizeCategoryKey(name);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    order.push(name);
  };
  items.forEach((skill) => append(resolveSkillCategoryName(skill.category)));
  extraCategories.forEach((name) => append(normalizeCategoryName(name)));
  return order;
};

const resolveSkillCategoryPayload = (categoryName: string) => {
  const key = normalizeCategoryKey(categoryName);
  if (key === normalizeCategoryKey(DEFAULT_SKILL_CATEGORY)) {
    return undefined;
  }
  return categoryName;
};

const renameCategoryList = (categories: string[], oldKey: string, nextName: string) => {
  const result: string[] = [];
  const seen = new Set<string>();
  categories.forEach((name) => {
    const next = normalizeCategoryKey(name) === oldKey ? nextName : name;
    const nextKey = normalizeCategoryKey(next);
    if (seen.has(nextKey)) {
      return;
    }
    seen.add(nextKey);
    result.push(next);
  });
  return result;
};

const createEmptyCertificationCardData = (): CertificationCardData => ({
  name: "",
  issuer: "",
  date: "",
  matchRate: 0,
});


const extractSocialLinkUrl = (value: SocialLinkValue): string => {
  if (!value) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "object" && typeof value.url === "string") {
    return value.url;
  }
  return "";
};

const resolveLinkedInLink = (profile: Profile): string => {
  const fromSocialLinks = extractSocialLinkUrl(profile.social_links?.[LINKEDIN_LABEL]);
  if (fromSocialLinks) {
    return fromSocialLinks;
  }
  const matched = (profile.links || []).find((item) => item.label === LINKEDIN_LABEL);
  return matched?.url || "";
};

const mergeLinkedInLink = (
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
  if (existing && typeof existing === "object" && !Array.isArray(existing)) {
    const position = typeof existing.position === "number" ? existing.position : 0;
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

interface ExperienceBankProps {
  cachedProfile?: any;
  onProfileUpdate?: (data: any) => void;
}

const ExperienceBank: React.FC<ExperienceBankProps> = ({ cachedProfile, onProfileUpdate }) => {
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
  // 防止重复加载的Refs
  const hasLoadedEduRef = useRef(false);
  const hasLoadedSkillsRef = useRef(false);
  const hasLoadedCertsRef = useRef(false);

  // 使用 ref 存储回调，避免 useEffect 依赖项变化导致重复执行
  const onProfileUpdateRef = useRef(onProfileUpdate);

  // 用于滚动定位的 Refs
  const eduCardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const certCardRefs = useRef<Map<string, HTMLDivElement>>(new Map());

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
      } catch (error) {
        console.error('Failed to load profile:', error);
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

  // 加载教育经历列表
  useEffect(() => {
    const loadEducationExperiences = async () => {
      if (hasLoadedEduRef.current) return;
      try {
        if (!initialEducationRef.current?.length) {
          setIsLoadingEdu(true);
        }
        console.log('[ExperienceBank] 开始加载教育经历...');
        hasLoadedEduRef.current = true;
        const data = await experienceService.list('education');
        setEducations(data);
        console.log(`[ExperienceBank] 教育经历加载成功，共 ${data.length} 条`);
      } catch (error) {
        console.error('Failed to load education experiences:', error);
        hasLoadedEduRef.current = false;
      } finally {
        setIsLoadingEdu(false);
      }
    };
    loadEducationExperiences();
  }, []);

  // 加载技能列表
  useEffect(() => {
    const loadSkills = async () => {
      if (hasLoadedSkillsRef.current) return;
      try {
        setIsLoadingSkills(true);
        console.log('[ExperienceBank] 开始加载技能列表...');
        hasLoadedSkillsRef.current = true;
        const data = await skillsService.list();
        setSkills(data);
        console.log(`[ExperienceBank] 技能加载成功，共 ${data.length} 条`);
      } catch (error) {
        console.error('Failed to load skills:', error);
        hasLoadedSkillsRef.current = false;
      } finally {
        setIsLoadingSkills(false);
      }
    };
    loadSkills();
  }, []);

  // 加载证书列表
  useEffect(() => {
    const loadCertifications = async () => {
      if (hasLoadedCertsRef.current) return;
      try {
        setIsLoadingCertifications(true);
        console.log('[ExperienceBank] 开始加载证书列表...');
        hasLoadedCertsRef.current = true;
        const data = await certificationsService.list();
        setCertifications(data);
        console.log(`[ExperienceBank] 证书加载成功，共 ${data.length} 条`);
      } catch (error) {
        console.error('Failed to load certifications:', error);
        hasLoadedCertsRef.current = false;
      } finally {
        setIsLoadingCertifications(false);
      }
    };
    loadCertifications();
  }, []);

  // 开始编辑
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

  // 取消编辑 - 恢复原始数据
  const handleCancelProfile = () => {
    setName(originalProfile.name);
    setEmail(originalProfile.email);
    setPhone(originalProfile.phone);
    setLocation(originalProfile.location);
    setLink(originalProfile.link);
    setIsEditingProfile(false);
  };

  // 保存个人资料
  const handleSaveProfile = async () => {
    try {
      setIsSavingProfile(true);
      const nextSocialLinks = mergeLinkedInLink(profileSocialLinks, link);
      await profileService.updateProfile({
        full_name: name,
        email,
        phone,
        location,
        social_links: nextSocialLinks,
      });
      setProfileSocialLinks(nextSocialLinks);
      setIsEditingProfile(false);
      // TODO: 显示成功提示
    } catch (error) {
      console.error('Failed to save profile:', error);
      // TODO: 显示错误提示
    } finally {
      setIsSavingProfile(false);
    }
  };



  // Toast 状态管理
  const { toasts, success, error, loading, updateToast, closeToast } = useToast();

  const [experienceRefreshSignal, setExperienceRefreshSignal] = useState(0);
  const [deletingItem, setDeletingItem] = useState<{ id: string; type: 'edu' | 'cert' } | null>(null);

  // Skills State
  const [skills, setSkills] = useState<UserSkill[]>([]);
  const [isLoadingSkills, setIsLoadingSkills] = useState(true);
  const [isCreatingSkill, setIsCreatingSkill] = useState(false);
  const [pendingCategoryName, setPendingCategoryName] = useState("");
  const [customSkillCategories, setCustomSkillCategories] = useState<string[]>([]);
  const [categoryDrafts, setCategoryDrafts] = useState<Record<string, string>>({});
  const [skillDrafts, setSkillDrafts] = useState<Record<string, string>>({});
  const eduRefreshInFlightRef = useRef<Promise<ExperienceListItem[]> | null>(null);
  const skillsRefreshInFlightRef = useRef<Promise<UserSkill[]> | null>(null);
  const certsRefreshInFlightRef = useRef<Promise<CertificationRecord[]> | null>(null);

  // Education State
  const initialEducationRef = useRef<ExperienceListItem[] | null>(
    experienceService.peekList('education')
  );
  const [educations, setEducations] = useState<ExperienceListItem[]>(
    () => initialEducationRef.current ?? []
  );
  const [isLoadingEdu, setIsLoadingEdu] = useState(
    () => !initialEducationRef.current
  );
  // Unifying state: Multi-card expansion
  const [expandedEduCards, setExpandedEduCards] = useState<Set<string>>(new Set());
  const [collapsingEduCards, setCollapsingEduCards] = useState<Set<string>>(new Set());

  // const [editingEduId, setEditingEduId] = useState<string | null>(null); // Deprecated in favor of expandedEduCards
  const [eduData, setEduData] = useState<Map<string, EduCardData>>(new Map());
  const [originalEduData, setOriginalEduData] = useState<Map<string, EduCardData>>(new Map());
  const [modifiedEduCards, setModifiedEduCards] = useState<Set<string>>(new Set());
  const [savingEduIds, setSavingEduIds] = useState<Set<string>>(new Set());
  const [isCreatingEdu, setIsCreatingEdu] = useState(false);

  // Education Handlers
  const normalizeEduData = (data: EduCardData): EduCardData => ({
    school: data.school.trim(),
    major: data.major.trim(),
    degree: data.degree.trim(),
    startDate: data.startDate.trim(),
    endDate: data.endDate.trim(),
    gpa: data.gpa.trim(),
    courses: data.courses.trim(),
  });

  const buildEduVersionPayload = (data: EduCardData) => ({
    title: data.major,
    org: data.school || undefined,
    start_date: convertDateToISO(data.startDate),
    end_date: convertDateToISO(data.endDate),
    star: buildEduStarPayload(data),
  });



  const refreshEducationExperiences = useCallback(async () => {
    return runDedupedRefresh(eduRefreshInFlightRef, async () => {
      const data = await experienceService.list('education', { force: true });
      setEducations(data);
      return data;
    });
  }, []);

  const ensureEduCardState = (eduId: string, seedData?: EduCardData) => {
    if (eduData.has(eduId)) {
      return;
    }
    const item = seedData ? null : educations.find((edu) => edu.master.id === eduId);
    const data = seedData || (item ? buildEduCardData(item) : createEmptyEduCardData());
    setEduData((prev) => new Map(prev).set(eduId, data));
    setOriginalEduData((prev) => new Map(prev).set(eduId, cloneEduCardData(data)));
  };

  const updateEduField = (eduId: string, field: keyof EduCardData, value: string) => {
    const current = eduData.get(eduId) || createEmptyEduCardData();
    const nextData = { ...current, [field]: value };
    setEduData((prev) => new Map(prev).set(eduId, nextData));
    const original = originalEduData.get(eduId);
    const isModified = original ? JSON.stringify(nextData) !== JSON.stringify(original) : true;
    setModifiedEduCards((prev) => {
      const next = new Set(prev);
      if (isModified) {
        next.add(eduId);
      } else {
        next.delete(eduId);
      }
      return next;
    });
  };

  const handleAddEdu = async () => {
    if (isCreatingEdu) {
      return;
    }
    let toastId: string | null = null;
    try {
      setIsCreatingEdu(true);
      toastId = loading(EDU_TOAST_MESSAGES.createLoading);
      const newEducation = await experienceService.create({
        category: 'education',
        version: {
          title: EDUCATION_DEFAULT_TITLE,
          org: EDUCATION_DEFAULT_ORG,
          start_date: getTodayLocalISODate(),
          star: {},
        },
      });

      const initialData = buildEduCardData(newEducation);
      setEducations((prev) => [newEducation, ...prev]);
      setEduData((prev) => new Map(prev).set(newEducation.master.id, initialData));
      setOriginalEduData((prev) => new Map(prev).set(newEducation.master.id, cloneEduCardData(initialData)));
      setModifiedEduCards((prev) => {
        const next = new Set(prev);
        next.delete(newEducation.master.id);
        return next;
      });
      // Actually we should toggle it expanded
      toggleEduCard(newEducation.master.id, initialData);

      if (toastId) {
        updateToast(toastId, { message: EDU_TOAST_MESSAGES.createSuccess, type: 'success', duration: 3000 });
      } else {
        success(EDU_TOAST_MESSAGES.createSuccess);
      }

      refreshEducationExperiences().catch((err) => {
        console.error('[ExperienceBank] 刷新教育经历失败:', err);
      });
    } catch (err) {
      console.error('Failed to create education experience:', err);
      if (toastId) {
        updateToast(toastId, { message: EDU_TOAST_MESSAGES.createError, type: 'error', duration: 3000 });
      } else {
        error(EDU_TOAST_MESSAGES.createError);
      }
    } finally {
      setIsCreatingEdu(false);
    }
  };

  const handleSaveEdu = async (eduId: string) => {
    const data = eduData.get(eduId);
    if (!data) {
      return;
    }
    const normalized = normalizeEduData(data);
    if (!normalized.school || !normalized.major) {
      error('学校和专业不能为空');
      return;
    }

    let toastId: string | null = null;
    try {
      setSavingEduIds((prev) => {
        const next = new Set(prev);
        next.add(eduId);
        return next;
      });
      toastId = loading(EDU_TOAST_MESSAGES.saveLoading);
      const versionPayload = buildEduVersionPayload(normalized);
      await experienceService.update(eduId, { version: versionPayload });

      setEduData((prev) => new Map(prev).set(eduId, normalized));
      setOriginalEduData((prev) => new Map(prev).set(eduId, cloneEduCardData(normalized)));
      setModifiedEduCards((prev) => {
        const next = new Set(prev);
        next.delete(eduId);
        return next;
      });

      setEducations((prev) => prev.map((item) => {
        if (item.master.id !== eduId) {
          return item;
        }
        return {
          ...item,
          latest_version: {
            ...(item.latest_version || {}),
            title: versionPayload.title,
            org: versionPayload.org,
            start_date: versionPayload.start_date,
            end_date: versionPayload.end_date,
            star: versionPayload.star,
          } as any,
        };
      }));

      if (toastId) {
        updateToast(toastId, { message: EDU_TOAST_MESSAGES.saveSuccess, type: 'success', duration: 3000 });
      } else {
        success(EDU_TOAST_MESSAGES.saveSuccess);
      }
      toggleEduCard(eduId);

      refreshEducationExperiences().catch((err) => {
        console.error('[ExperienceBank] 刷新教育经历失败:', err);
      });

      // Auto-collapse after save if needed, or keep expanded. Work Experience keeps expanded.
      // We assume user wants to stay there.
    } catch (err) {
      console.error('Failed to save education experience:', err);
      if (toastId) {
        updateToast(toastId, { message: EDU_TOAST_MESSAGES.saveError, type: 'error', duration: 3000 });
      } else {
        error(EDU_TOAST_MESSAGES.saveError);
      }
    } finally {
      setSavingEduIds((prev) => {
        const next = new Set(prev);
        next.delete(eduId);
        return next;
      });
    }
  };

  // Replaced by toggleEduCard, but kept for compatibility if passed as prop (though not used)
  // Or simply delete if unused. It was used in the old list item onClick.
  // We will now use toggleEduCard directly in the render loop.
  const handleEditEdu = (edu: ExperienceListItem) => {
    toggleEduCard(edu.master.id);
  };

  const handleDeleteEdu = async (eduId: string) => {
    let toastId: string | null = null;
    try {
      if (savingEduIds.has(eduId)) {
        return;
      }
      toastId = loading(EDU_TOAST_MESSAGES.deleteLoading);

      setEducations((prev) => prev.filter((edu) => edu.master.id !== eduId));
      setEduData((prev) => {
        const next = new Map(prev);
        next.delete(eduId);
        return next;
      });
      setOriginalEduData((prev) => {
        const next = new Map(prev);
        next.delete(eduId);
        return next;
      });
      setModifiedEduCards((prev) => {
        const next = new Set(prev);
        next.delete(eduId);
        return next;
      });

      await experienceService.delete(eduId);

      if (toastId) {
        updateToast(toastId, { message: EDU_TOAST_MESSAGES.deleteSuccess, type: 'success', duration: 3000 });
      } else {
        success(EDU_TOAST_MESSAGES.deleteSuccess);
      }

      refreshEducationExperiences().catch((err) => {
        console.error('[ExperienceBank] 刷新教育经历失败:', err);
      });
    } catch (err) {
      console.error('Failed to delete education experience:', err);
      if (toastId) {
        updateToast(toastId, { message: EDU_TOAST_MESSAGES.deleteError, type: 'error', duration: 3000 });
      } else {
        error(EDU_TOAST_MESSAGES.deleteError);
      }
      refreshEducationExperiences().catch((err2) => {
        console.error('[ExperienceBank] 恢复教育经历失败:', err2);
      });
    }
  };

  const handleCancelEditEdu = (eduId: string) => {
    const original = originalEduData.get(eduId);
    if (original) {
      setEduData((prev) => new Map(prev).set(eduId, cloneEduCardData(original)));
    }
    setModifiedEduCards((prev) => {
      const next = new Set(prev);
      next.delete(eduId);
      return next;
    });
  };

  // Certifications State
  const [certifications, setCertifications] = useState<CertificationRecord[]>([]);
  const [isLoadingCertifications, setIsLoadingCertifications] = useState(true);

  // Unifying state
  const [expandedCertCards, setExpandedCertCards] = useState<Set<string>>(new Set());
  const [collapsingCertCards, setCollapsingCertCards] = useState<Set<string>>(new Set());

  // const [editingCertId, setEditingCertId] = useState<string | null>(null); // Deprecated
  const [certData, setCertData] = useState<Map<string, CertificationCardData>>(new Map());
  const [originalCertData, setOriginalCertData] = useState<Map<string, CertificationCardData>>(new Map());
  const [modifiedCertCards, setModifiedCertCards] = useState<Set<string>>(new Set());
  const [savingCertIds, setSavingCertIds] = useState<Set<string>>(new Set());
  const [isCreatingCert, setIsCreatingCert] = useState(false);

  const toggleTheme = () => {
    setIsDarkMode(!isDarkMode);
    document.documentElement.classList.toggle('dark');
  };

  const handleResumeImported = useCallback(async () => {
    setExperienceRefreshSignal((prev) => prev + 1);
    await refreshEducationExperiences();
  }, [refreshEducationExperiences]);


  // 切换教育卡片展开/折叠
  const toggleEduCard = (cardId: string, seedData?: EduCardData) => {
    const newExpanded = new Set(expandedEduCards);
    if (newExpanded.has(cardId)) {
      // Collapse
      const newCollapsing = new Set(collapsingEduCards);
      newCollapsing.add(cardId);
      setCollapsingEduCards(newCollapsing);
      newExpanded.delete(cardId);

      setTimeout(() => {
        setCollapsingEduCards(prev => {
          const next = new Set(prev);
          next.delete(cardId);
          return next;
        });
        // Center after collapse
        setTimeout(() => {
          const element = eduCardRefs.current.get(cardId);
          if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }, 50);
      }, 300);
    } else {
      // Expand
      newExpanded.add(cardId);
      ensureEduCardState(cardId, seedData); // Ensure data is initialized

      // Center after expand
      setTimeout(() => {
        const element = eduCardRefs.current.get(cardId);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 100);
    }
    setExpandedEduCards(newExpanded);
  };

  // 切换证书卡片展开/折叠
  const toggleCertCard = (cardId: string, seedData?: CertificationCardData) => {
    const newExpanded = new Set(expandedCertCards);
    if (newExpanded.has(cardId)) {
      // Collapse
      const newCollapsing = new Set(collapsingCertCards);
      newCollapsing.add(cardId);
      setCollapsingCertCards(newCollapsing);
      newExpanded.delete(cardId);

      setTimeout(() => {
        setCollapsingCertCards(prev => {
          const next = new Set(prev);
          next.delete(cardId);
          return next;
        });
        // Center after collapse
        setTimeout(() => {
          const element = certCardRefs.current.get(cardId);
          if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }, 50);
      }, 300);
    } else {
      newExpanded.add(cardId);
      ensureCertCardState(cardId, seedData);

      setTimeout(() => {
        const element = certCardRefs.current.get(cardId);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 100);
    }
    setExpandedCertCards(newExpanded);
  };

  const refreshSkills = async () => {
    return runDedupedRefresh(skillsRefreshInFlightRef, async () => {
      const data = await skillsService.list({ force: true });
      setSkills(data);
      return data;
    });
  };

  const refreshCertifications = async () => {
    return runDedupedRefresh(certsRefreshInFlightRef, async () => {
      const data = await certificationsService.list({ force: true });
      setCertifications(data);
      return data;
    });
  };

  const groupedSkills = useMemo(() => buildGroupedSkills(skills), [skills]);
  const skillCategoryOrder = useMemo(
    () => buildSkillCategoryOrder(skills, customSkillCategories),
    [skills, customSkillCategories]
  );
  const groupedCategoryKeys = useMemo(
    () => new Set(Object.keys(groupedSkills).map(normalizeCategoryKey)),
    [groupedSkills]
  );

  useEffect(() => {
    setCustomSkillCategories((prev) => {
      if (!prev.length) {
        return prev;
      }
      const next = prev.filter((category) => !groupedCategoryKeys.has(normalizeCategoryKey(category)));
      return next.length === prev.length ? prev : next;
    });
  }, [groupedCategoryKeys]);

  const getCategoryDraftValue = (category: string) => {
    const key = normalizeCategoryKey(category);
    return categoryDrafts[key] ?? category;
  };

  const updateCategoryDraftValue = (category: string, value: string) => {
    const key = normalizeCategoryKey(category);
    setCategoryDrafts((prev) => ({ ...prev, [key]: value }));
  };

  const clearCategoryDraftValue = (categoryKey: string) => {
    setCategoryDrafts((prev) => {
      if (!(categoryKey in prev)) {
        return prev;
      }
      const next = { ...prev };
      delete next[categoryKey];
      return next;
    });
  };

  const getSkillDraftValue = (category: string) => {
    const key = normalizeCategoryKey(category);
    return skillDrafts[key] ?? "";
  };

  const updateSkillDraftValue = (category: string, value: string) => {
    const key = normalizeCategoryKey(category);
    setSkillDrafts((prev) => ({ ...prev, [key]: value }));
  };

  const clearSkillDraftValue = (category: string) => {
    const key = normalizeCategoryKey(category);
    setSkillDrafts((prev) => {
      if (!(key in prev)) {
        return prev;
      }
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const isCategoryNameTaken = (name: string, excludeKey?: string) => {
    const key = normalizeCategoryKey(name);
    if (excludeKey && key === excludeKey) {
      return false;
    }
    return skillCategoryOrder.some((category) => normalizeCategoryKey(category) === key);
  };

  const resolveCertificationDescription = (certId: string, matchRate: number) => {
    const existing = certifications.find((cert) => cert.id === certId)?.description;
    if (!canPersistCertificationMeta(existing)) {
      return undefined;
    }
    return buildCertificationMetaDescription(matchRate);
  };

  const handleAddCategory = () => {
    const trimmed = normalizeCategoryName(pendingCategoryName);
    if (!trimmed) {
      error(SKILL_CATEGORY_VALIDATION_MESSAGES.emptyName);
      return;
    }
    if (isCategoryNameTaken(trimmed)) {
      error(SKILL_CATEGORY_VALIDATION_MESSAGES.nameExists);
      return;
    }
    setCustomSkillCategories((prev) => [...prev, trimmed]);
    setPendingCategoryName("");
  };

  const handleAddSkillToCategory = async (category: string) => {
    if (isCreatingSkill || isLoadingSkills) {
      return;
    }
    const draftValue = getSkillDraftValue(category);
    const trimmed = draftValue.trim();
    if (!trimmed) {
      return;
    }
    const exists = skills.some(
      (skill) => normalizeSkillName(skill.name) === normalizeSkillName(trimmed)
    );
    if (exists) {
      error('该技能已存在');
      return;
    }

    let toastId: string | null = null;
    try {
      setIsCreatingSkill(true);
      toastId = loading(SKILL_TOAST_MESSAGES.createLoading);
      const payloadCategory = resolveSkillCategoryPayload(category);
      const created = await skillsService.create({
        name: trimmed,
        ...(payloadCategory ? { category: payloadCategory } : {}),
      });
      setSkills((prev) => [created, ...prev]);
      clearSkillDraftValue(category);
      if (toastId) {
        updateToast(toastId, { message: SKILL_TOAST_MESSAGES.createSuccess, type: 'success', duration: 3000 });
      } else {
        success(SKILL_TOAST_MESSAGES.createSuccess);
      }
      refreshSkills().catch((err) => {
        console.error('[ExperienceBank] 刷新技能失败:', err);
      });
    } catch (err) {
      console.error('Failed to create skill:', err);
      if (toastId) {
        updateToast(toastId, { message: SKILL_TOAST_MESSAGES.createError, type: 'error', duration: 3000 });
      } else {
        error(SKILL_TOAST_MESSAGES.createError);
      }
    } finally {
      setIsCreatingSkill(false);
    }
  };

  const handleRenameCategory = async (category: string, draftValue: string) => {
    const categoryKey = normalizeCategoryKey(category);
    const nextName = normalizeCategoryName(draftValue);
    if (!nextName) {
      error(SKILL_CATEGORY_VALIDATION_MESSAGES.emptyName);
      clearCategoryDraftValue(categoryKey);
      return;
    }
    if (normalizeCategoryKey(nextName) === categoryKey) {
      clearCategoryDraftValue(categoryKey);
      return;
    }
    if (isCategoryNameTaken(nextName, categoryKey)) {
      error(SKILL_CATEGORY_VALIDATION_MESSAGES.nameExists);
      clearCategoryDraftValue(categoryKey);
      return;
    }

    const skillsInCategory = groupedSkills[category] ?? [];
    if (!skillsInCategory.length) {
      setCustomSkillCategories((prev) => renameCategoryList(prev, categoryKey, nextName));
      clearCategoryDraftValue(categoryKey);
      return;
    }

    let toastId: string | null = null;
    try {
      toastId = loading(SKILL_CATEGORY_TOAST_MESSAGES.renameLoading);
      await Promise.all(
        skillsInCategory.map((skill) => skillsService.update(skill.id, { category: nextName }))
      );
      setSkills((prev) =>
        prev.map((skill) => {
          const currentCategory = resolveSkillCategoryName(skill.category);
          if (normalizeCategoryKey(currentCategory) !== categoryKey) {
            return skill;
          }
          return { ...skill, category: nextName };
        })
      );
      setCustomSkillCategories((prev) => renameCategoryList(prev, categoryKey, nextName));
      clearCategoryDraftValue(categoryKey);
      if (toastId) {
        updateToast(toastId, { message: SKILL_CATEGORY_TOAST_MESSAGES.renameSuccess, type: 'success', duration: 3000 });
      } else {
        success(SKILL_CATEGORY_TOAST_MESSAGES.renameSuccess);
      }
      refreshSkills().catch((err) => {
        console.error('[ExperienceBank] 刷新技能失败:', err);
      });
    } catch (err) {
      console.error('Failed to rename skill category:', err);
      if (toastId) {
        updateToast(toastId, { message: SKILL_CATEGORY_TOAST_MESSAGES.renameError, type: 'error', duration: 3000 });
      } else {
        error(SKILL_CATEGORY_TOAST_MESSAGES.renameError);
      }
      clearCategoryDraftValue(categoryKey);
      refreshSkills().catch((err2) => {
        console.error('[ExperienceBank] 恢复技能分类失败:', err2);
      });
    }
  };

  const handleDeleteSkill = async (skillId: string) => {
    let toastId: string | null = null;
    try {
      toastId = loading(SKILL_TOAST_MESSAGES.deleteLoading);
      setSkills((prev) => prev.filter((skill) => skill.id !== skillId));
      await skillsService.delete(skillId);
      if (toastId) {
        updateToast(toastId, { message: SKILL_TOAST_MESSAGES.deleteSuccess, type: 'success', duration: 3000 });
      } else {
        success(SKILL_TOAST_MESSAGES.deleteSuccess);
      }
      refreshSkills().catch((err) => {
        console.error('[ExperienceBank] 刷新技能失败:', err);
      });
    } catch (err) {
      console.error('Failed to delete skill:', err);
      if (toastId) {
        updateToast(toastId, { message: SKILL_TOAST_MESSAGES.deleteError, type: 'error', duration: 3000 });
      } else {
        error(SKILL_TOAST_MESSAGES.deleteError);
      }
      refreshSkills().catch((err2) => {
        console.error('[ExperienceBank] 恢复技能失败:', err2);
      });
    }
  };

  // 统一删除确认处理
  const handleConfirmDelete = async () => {
    if (!deletingItem) return;

    const { id, type } = deletingItem;
    if (type === 'edu') {
      await handleDeleteEdu(id);
    } else if (type === 'cert') {
      await handleDeleteCert(id);
    }
    setDeletingItem(null);
  };

  const requestDelete = (id: string, type: 'edu' | 'cert') => {
    setDeletingItem({ id, type });
    // Auto-center the card being deleted to ensure context
    // Determine which ref map to use
    let refMap;
    if (type === 'edu') refMap = eduCardRefs;
    else if (type === 'cert') refMap = certCardRefs;

    if (refMap?.current) {
      const element = refMap.current.get(id);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  };

  const ensureCertCardState = (certId: string, seedData?: CertificationCardData) => {
    if (certData.has(certId)) {
      return;
    }
    const item = seedData ? null : certifications.find((cert) => cert.id === certId);
    const data = seedData || (item ? buildCertificationCardData(item) : createEmptyCertificationCardData());
    setCertData((prev) => new Map(prev).set(certId, data));
    setOriginalCertData((prev) => new Map(prev).set(certId, cloneCertificationCardData(data)));
  };

  const updateCertField = (certId: string, field: keyof CertificationCardData, value: string | number) => {
    const current = certData.get(certId) || createEmptyCertificationCardData();
    const nextData = { ...current, [field]: value };
    setCertData((prev) => new Map(prev).set(certId, nextData));
    const original = originalCertData.get(certId);
    const isModified = original ? JSON.stringify(nextData) !== JSON.stringify(original) : true;
    setModifiedCertCards((prev) => {
      const next = new Set(prev);
      if (isModified) {
        next.add(certId);
      } else {
        next.delete(certId);
      }
      return next;
    });
  };

  const handleAddCert = async () => {
    if (isCreatingCert) {
      return;
    }
    let toastId: string | null = null;
    try {
      setIsCreatingCert(true);
      toastId = loading(CERT_TOAST_MESSAGES.createLoading);
      const newCert = await certificationsService.create({
        name: CERT_DEFAULT_NAME,
        issuer: CERT_DEFAULT_ISSUER,
        issue_date: getTodayLocalISODate(),
        description: buildCertificationMetaDescription(0),
      });

      const initialData = buildCertificationCardData(newCert);
      setCertifications((prev) => [newCert, ...prev]);
      setCertData((prev) => new Map(prev).set(newCert.id, initialData));
      setOriginalCertData((prev) => new Map(prev).set(newCert.id, cloneCertificationCardData(initialData)));
      setModifiedCertCards((prev) => {
        const next = new Set(prev);
        next.delete(newCert.id);
        return next;
      });
      toggleCertCard(newCert.id, initialData);

      if (toastId) {
        updateToast(toastId, { message: CERT_TOAST_MESSAGES.createSuccess, type: 'success', duration: 3000 });
      } else {
        success(CERT_TOAST_MESSAGES.createSuccess);
      }

      refreshCertifications().catch((err) => {
        console.error('[ExperienceBank] 刷新证书失败:', err);
      });
    } catch (err) {
      console.error('Failed to create certification:', err);
      if (toastId) {
        updateToast(toastId, { message: CERT_TOAST_MESSAGES.createError, type: 'error', duration: 3000 });
      } else {
        error(CERT_TOAST_MESSAGES.createError);
      }
    } finally {
      setIsCreatingCert(false);
    }
  };

  const handleSaveCert = async (certId: string) => {
    const data = certData.get(certId);
    if (!data) {
      return;
    }
    const normalized = normalizeCertificationData(data);
    if (!normalized.name || !normalized.issuer) {
      error('证书名称和颁发机构不能为空');
      return;
    }

    let toastId: string | null = null;
    try {
      setSavingCertIds((prev) => {
        const next = new Set(prev);
        next.add(certId);
        return next;
      });
      toastId = loading(CERT_TOAST_MESSAGES.saveLoading);
      const description = resolveCertificationDescription(certId, normalized.matchRate);
      const payload = buildCertificationPayload(normalized, description);
      await certificationsService.update(certId, payload);

      setCertData((prev) => new Map(prev).set(certId, normalized));
      setOriginalCertData((prev) => new Map(prev).set(certId, cloneCertificationCardData(normalized)));
      setModifiedCertCards((prev) => {
        const next = new Set(prev);
        next.delete(certId);
        return next;
      });

      setCertifications((prev) => prev.map((item) => {
        if (item.id !== certId) {
          return item;
        }
        return {
          ...item,
          name: payload.name,
          issuer: payload.issuer,
          issue_date: payload.issue_date ?? item.issue_date,
          description: payload.description ?? item.description,
        };
      }));

      if (toastId) {
        updateToast(toastId, { message: CERT_TOAST_MESSAGES.saveSuccess, type: 'success', duration: 3000 });
      } else {
        success(CERT_TOAST_MESSAGES.saveSuccess);
      }
      toggleCertCard(certId);

      refreshCertifications().catch((err) => {
        console.error('[ExperienceBank] 刷新证书失败:', err);
      });

      // Auto-collapse after save if needed
    } catch (err) {
      console.error('Failed to save certification:', err);
      if (toastId) {
        updateToast(toastId, { message: CERT_TOAST_MESSAGES.saveError, type: 'error', duration: 3000 });
      } else {
        error(CERT_TOAST_MESSAGES.saveError);
      }
    } finally {
      setSavingCertIds((prev) => {
        const next = new Set(prev);
        next.delete(certId);
        return next;
      });
    }
  };

  const handleEditCert = (cert: CertificationRecord) => {
    toggleCertCard(cert.id);
  };

  const handleDeleteCert = async (id: string) => {
    let toastId: string | null = null;
    try {
      if (savingCertIds.has(id)) {
        return;
      }
      toastId = loading(CERT_TOAST_MESSAGES.deleteLoading);

      setCertifications((prev) => prev.filter((cert) => cert.id !== id));
      setCertData((prev) => {
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
      setOriginalCertData((prev) => {
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
      setModifiedCertCards((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });

      await certificationsService.delete(id);

      if (toastId) {
        updateToast(toastId, { message: CERT_TOAST_MESSAGES.deleteSuccess, type: 'success', duration: 3000 });
      } else {
        success(CERT_TOAST_MESSAGES.deleteSuccess);
      }

      refreshCertifications().catch((err) => {
        console.error('[ExperienceBank] 刷新证书失败:', err);
      });
    } catch (err) {
      console.error('Failed to delete certification:', err);
      if (toastId) {
        updateToast(toastId, { message: CERT_TOAST_MESSAGES.deleteError, type: 'error', duration: 3000 });
      } else {
        error(CERT_TOAST_MESSAGES.deleteError);
      }
      refreshCertifications().catch((err2) => {
        console.error('[ExperienceBank] 恢复证书失败:', err2);
      });
    }
  };

  const handleCancelEditCert = (certId: string) => {
    const original = originalCertData.get(certId);
    if (original) {
      setCertData((prev) => new Map(prev).set(certId, cloneCertificationCardData(original)));
    }
    setModifiedCertCards((prev) => {
      const next = new Set(prev);
      next.delete(certId);
      return next;
    });
  };

  const editingCertData = null; // Deprecated
  const editingCertRecord = null; // Deprecated
  const isCertMatchRateEditable = false; // Deprecated or needs refactor
  const isCertModified = false; // Deprecated

  const sortedEducations = React.useMemo(() => {
    return [...educations].sort((a, b) => {
      const dateA = a.latest_version?.start_date;
      const dateB = b.latest_version?.start_date;
      const valA = parseYearMonthValue(dateA) ?? -1;
      const valB = parseYearMonthValue(dateB) ?? -1;
      return valB - valA;
    });
  }, [educations]);

  const sortedCertifications = React.useMemo(() => {
    return [...certifications].sort((a, b) => {
      const dateA = a.issue_date;
      const dateB = b.issue_date;
      const valA = parseYearMonthValue(dateA) ?? -1;
      const valB = parseYearMonthValue(dateB) ?? -1;
      return valB - valA;
    });
  }, [certifications]);

  const deleteConfirmMessage = deletingItem
    ? deletingItem.type === 'edu'
      ? '确定要删除这条教育经历吗？'
      : '确定要删除这条证书资质吗？'
    : '';

  const toastApi = useMemo(
    () => ({ success, error, loading, updateToast }),
    [success, error, loading, updateToast]
  );

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-gray-50 dark:bg-gray-900/50">
      <header className="h-16 bg-surface-light dark:bg-surface-dark border-b border-border-light dark:border-border-dark flex items-center justify-between px-8 shrink-0 z-20">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-primary hover:opacity-80 transition-opacity cursor-pointer">
            <LayoutTemplate className="w-8 h-8" />
            <span className="font-bold text-xl tracking-tight text-gray-900 dark:text-white">Elephant</span>
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
          <button className="hidden md:flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors border border-transparent hover:border-gray-200 dark:hover:border-gray-700">
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

          {/* Education Section */}
          <section className="space-y-6 pt-6 border-t border-gray-200 dark:border-gray-800">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <GraduationCap className="w-5 h-5 text-sky-500" />
                教育经历
                <span className="text-sm font-normal text-gray-400 ml-2">Education</span>
              </h2>
              <span className="text-xs font-mono text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">
                {isLoadingEdu ? '加载中...' : `${educations.length} items`}
              </span>
            </div>

            <button
              onClick={handleAddEdu}
              disabled={isLoadingEdu || isCreatingEdu}
              className="w-full group border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-xl p-4 flex items-center justify-center gap-2 text-gray-500 hover:text-sky-600 hover:border-sky-500 hover:bg-sky-50 dark:hover:bg-sky-900/10 transition-all duration-300 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <div className="p-1 rounded-full bg-gray-200 dark:bg-gray-800 group-hover:bg-white group-hover:text-sky-600 transition-colors">
                <Plus className="w-5 h-5" />
              </div>
              <span className="font-medium">新增教育经历</span>
            </button>

            {/* Education List Items */}
            {sortedEducations.map((edu) => {
              const eduId = edu.master.id;
              const isExpanded = expandedEduCards.has(eduId);
              const isCollapsing = collapsingEduCards.has(eduId);
              const showExpanded = isExpanded || isCollapsing;
              const isModified = modifiedEduCards.has(eduId);
              const data = eduData.get(eduId) || buildEduCardData(edu);
              const dateLabel = [data.startDate, data.endDate].filter(Boolean).join(' - ');

              return (
                <div
                  key={eduId}
                  ref={(el) => {
                    if (el) eduCardRefs.current.set(eduId, el);
                    else eduCardRefs.current.delete(eduId);
                  }}
                  className="bg-white dark:bg-surface-dark rounded-xl border border-sky-500/30 shadow-sm hover:shadow-md transition-all duration-300 overflow-hidden"
                >
                  {!showExpanded ? (
                    // Collapsed State
                    <div
                      className="p-5 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                      onClick={() => toggleEduCard(eduId)}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-3 mb-1">
                            <h3 className="font-bold text-gray-900 dark:text-white truncate">
                              {data.school || '未填写学校'}
                            </h3>
                            <span className="text-gray-300 dark:text-gray-600">|</span>
                            <span className="text-gray-700 dark:text-gray-300 font-medium truncate">
                              {data.major || '未填写专业'}
                            </span>
                          </div>
                          {data.degree ? (
                            <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
                              {data.degree}
                            </p>
                          ) : null}
                          {dateLabel ? (
                            <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
                              {dateLabel}
                            </p>
                          ) : null}
                        </div>
                        <div className="text-right shrink-0 flex items-center gap-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              requestDelete(eduId, 'edu');
                            }}
                            className="text-gray-400 hover:text-red-500 transition-colors p-1 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                            title="删除"
                            disabled={savingEduIds.has(eduId)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                          <ChevronDown className="w-5 h-5 text-gray-400" />
                        </div>
                      </div>
                    </div>
                  ) : (
                    // Expanded State
                    <div className={resolveCardMotionClass(isCollapsing)}>
                      <div className="p-6 border-b border-gray-50 dark:border-gray-800/50">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="md:col-span-2">
                            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1 block">学校名称</label>
                            <input
                              className="fluid-input text-lg font-bold text-gray-900 dark:text-white placeholder-gray-300 w-full"
                              placeholder="例如: 清华大学"
                              value={data.school}
                              onChange={(e) => updateEduField(eduId, "school", e.target.value)}
                            />
                          </div>
                          <div>
                            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1 block">专业名称</label>
                            <input
                              className="fluid-input text-base text-gray-700 dark:text-gray-300 placeholder-gray-300 w-full"
                              placeholder="例如: 计算机科学与技术"
                              value={data.major}
                              onChange={(e) => updateEduField(eduId, "major", e.target.value)}
                            />
                          </div>
                          <div>
                            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1 block">学位/学历</label>
                            <input
                              className="fluid-input text-base text-gray-700 dark:text-gray-300 placeholder-gray-300 w-full"
                              placeholder="例如: 本科 / 硕士"
                              value={data.degree}
                              onChange={(e) => updateEduField(eduId, "degree", e.target.value)}
                            />
                          </div>
                          <div>
                            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1 block">开始时间</label>
                            <div className="h-[46px]">
                              <MonthPicker
                                value={data.startDate}
                                onChange={(val) => updateEduField(eduId, "startDate", val)}
                                placeholder="开始时间"
                                className="w-full h-full"
                              />
                            </div>
                          </div>
                          <div>
                            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1 block">结束时间</label>
                            <div className="h-[46px]">
                              <MonthPicker
                                value={data.endDate}
                                onChange={(val) => updateEduField(eduId, "endDate", val)}
                                placeholder="结束时间"
                                className="w-full h-full"
                              />
                            </div>
                          </div>
                          <div>
                            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1 block">GPA</label>
                            <input
                              className="fluid-input text-base text-gray-700 dark:text-gray-300 placeholder-gray-300 w-full"
                              placeholder="例如: 3.8/4.0"
                              value={data.gpa}
                              onChange={(e) => updateEduField(eduId, "gpa", e.target.value)}
                            />
                          </div>
                          <div>
                            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1 block">核心课程</label>
                            <input
                              className="fluid-input text-base text-gray-700 dark:text-gray-300 placeholder-gray-300 w-full"
                              placeholder="例如: 数据结构、操作系统"
                              value={data.courses}
                              onChange={(e) => updateEduField(eduId, "courses", e.target.value)}
                            />
                          </div>
                        </div>
                      </div>

                      <div className="bg-gray-50 dark:bg-gray-800/50 px-6 py-3 border-t border-gray-100 dark:border-gray-800 flex items-center justify-end">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => requestDelete(eduId, 'edu')}
                            className="text-gray-400 hover:text-red-500 transition-colors p-2 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg mr-2"
                            title="删除"
                            disabled={savingEduIds.has(eduId)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>

                          {isModified ? (
                            <>
                              <button
                                onClick={() => handleCancelEditEdu(eduId)}
                                className="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white transition-colors text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
                                disabled={savingEduIds.has(eduId)}
                              >
                                取消
                              </button>
                              <button
                                onClick={() => handleSaveEdu(eduId)}
                                className="flex items-center gap-2 text-sm font-medium text-white bg-primary hover:bg-sky-700 px-6 py-2 rounded-lg transition-colors shadow-sm shadow-sky-500/20 disabled:opacity-50"
                                disabled={savingEduIds.has(eduId)}
                              >
                                {savingEduIds.has(eduId) ? '保存中...' : '保存'}
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => toggleEduCard(eduId)}
                              className="flex items-center gap-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white px-4 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                            >
                              折叠
                              <ChevronUp className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </section>

          {/* Certifications Section */}
          <section className="space-y-6 pt-6 border-t border-gray-200 dark:border-gray-800">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <Award className="w-5 h-5 text-amber-500" />
                证书资质
                <span className="text-sm font-normal text-gray-400 ml-2">Certifications</span>
              </h2>
              <span className="text-xs font-mono text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">
                {isLoadingCertifications ? '加载中...' : `${certifications.length} items`}
              </span>
            </div>

            <button
              onClick={handleAddCert}
              disabled={isLoadingCertifications || isCreatingCert}
              className="w-full group border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-xl p-4 flex items-center justify-center gap-2 text-gray-500 hover:text-amber-600 hover:border-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/10 transition-all duration-300 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <div className="p-1 rounded-full bg-gray-200 dark:bg-gray-800 group-hover:bg-white group-hover:text-amber-600 transition-colors">
                <Plus className="w-5 h-5" />
              </div>
              <span className="font-medium">新增证书资质</span>
            </button>

            {/* Cert List Items */}
            {sortedCertifications.map((cert) => {
              const certId = cert.id;
              const isExpanded = expandedCertCards.has(certId);
              const isCollapsing = collapsingCertCards.has(certId);
              const showExpanded = isExpanded || isCollapsing;
              const isModified = modifiedCertCards.has(certId);
              const isMatchRateEditable = canPersistCertificationMeta(cert.description);
              const data = certData.get(certId) || buildCertificationCardData(cert);

              return (
                <div
                  key={certId}
                  ref={(el) => {
                    if (el) certCardRefs.current.set(certId, el);
                    else certCardRefs.current.delete(certId);
                  }}
                  className="bg-white dark:bg-surface-dark rounded-xl border border-amber-500/30 shadow-sm hover:shadow-md transition-all duration-300 overflow-hidden"
                >
                  {!showExpanded ? (
                    // Collapsed State
                    <div className="p-5 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors" onClick={() => toggleCertCard(certId)}>
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-3 mb-1">
                            <h3 className="font-bold text-gray-900 dark:text-white truncate">{data.name}</h3>
                            <span className="text-gray-300 dark:text-gray-600">|</span>
                            <span className="text-gray-700 dark:text-gray-300 font-medium">{data.issuer}</span>
                          </div>
                          <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
                            {data.date}
                          </p>
                        </div>
                        <div className="text-right shrink-0 flex items-center gap-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              requestDelete(certId, 'cert');
                            }}
                            className="text-gray-400 hover:text-red-500 transition-colors p-1 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                            title="删除"
                            disabled={savingCertIds.has(certId)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                          <ChevronDown className="w-5 h-5 text-gray-400" />
                        </div>
                      </div>
                    </div>
                  ) : (
                    // Expanded State
                    <div className={resolveCardMotionClass(isCollapsing)}>
                      <div className="p-6 border-b border-gray-50 dark:border-gray-800/50">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="md:col-span-2">
                            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1 block">证书名称</label>
                            <input
                              className="fluid-input text-lg font-bold text-gray-900 dark:text-white placeholder-gray-300 w-full"
                              placeholder="例如: PMP 项目管理专业人士"
                              value={data.name}
                              onChange={(e) => updateCertField(certId, "name", e.target.value)}
                            />
                          </div>
                          <div>
                            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1 block">颁发机构</label>
                            <input
                              className="fluid-input text-base text-gray-700 dark:text-gray-300 placeholder-gray-300 w-full"
                              placeholder="例如: PMI"
                              value={data.issuer}
                              onChange={(e) => updateCertField(certId, "issuer", e.target.value)}
                            />
                          </div>
                          <div>
                            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1 block">获得时间</label>
                            <div className="h-[46px]">
                              <MonthPicker
                                value={data.date}
                                onChange={(val) => updateCertField(certId, "date", val)}
                                placeholder="获得时间"
                                className="w-full h-full"
                              />
                            </div>
                          </div>

                        </div>
                      </div>

                      <div className="bg-gray-50 dark:bg-gray-800/50 px-6 py-3 border-t border-gray-100 dark:border-gray-800 flex items-center justify-end">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => requestDelete(certId, 'cert')}
                            className="text-gray-400 hover:text-red-500 transition-colors p-2 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg mr-2"
                            title="删除"
                            disabled={savingCertIds.has(certId)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>

                          {isModified ? (
                            <>
                              <button
                                onClick={() => handleCancelEditCert(certId)}
                                className="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white transition-colors text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
                                disabled={savingCertIds.has(certId)}
                              >
                                取消
                              </button>
                              <button
                                onClick={() => handleSaveCert(certId)}
                                className="flex items-center gap-2 text-sm font-medium text-white bg-purple-600 hover:bg-amber-700 px-6 py-2 rounded-lg transition-colors shadow-sm shadow-amber-500/20 disabled:opacity-50"
                                disabled={savingCertIds.has(certId)}
                              >
                                {savingCertIds.has(certId) ? '保存中...' : '保存'}
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => toggleCertCard(certId)}
                              className="flex items-center gap-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white px-4 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                            >
                              折叠
                              <ChevronUp className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </section>

          {/* Skills Section */}
          <section className="space-y-6 pt-6 border-t border-gray-200 dark:border-gray-800">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <Wrench className="w-5 h-5 text-rose-500" />
                专业技能
                <span className="text-sm font-normal text-gray-400 ml-2">Skills</span>
              </h2>
            </div>
            <div className="bg-white dark:bg-surface-dark rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-sm">
              <div className="space-y-6">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <h4 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">技能分类 / Skill Type</h4>
                  <div className="flex gap-2 max-w-sm">
                    <input
                      className="fluid-input text-sm"
                      placeholder="新增分类 (Add Category)"
                      value={pendingCategoryName}
                      onChange={(e) => setPendingCategoryName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleAddCategory()}
                      disabled={isLoadingSkills}
                    />
                    <button
                      onClick={handleAddCategory}
                      className="p-2 text-primary hover:bg-primary/10 rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                      disabled={isLoadingSkills}
                      title="添加分类"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {skillCategoryOrder.length === 0 ? (
                  <div className="text-sm text-gray-400">暂无技能分类，请先添加。</div>
                ) : (
                  <div className="space-y-4">
                    {skillCategoryOrder.map((category) => {
                      const categorySkills = groupedSkills[category] ?? [];
                      const skillDraft = getSkillDraftValue(category);
                      const categoryDraft = getCategoryDraftValue(category);
                      return (
                        <div
                          key={category}
                          className="rounded-lg border border-gray-100 dark:border-gray-700/60 p-4 bg-gray-50/40 dark:bg-gray-800/30"
                        >
                          <div className="flex items-center justify-between gap-3 mb-3">
                            <input
                              className="text-sm font-semibold text-gray-600 dark:text-gray-200 uppercase tracking-wider bg-transparent border-b border-transparent focus:border-gray-300 dark:focus:border-gray-600 outline-none"
                              value={categoryDraft}
                              onChange={(e) => updateCategoryDraftValue(category, e.target.value)}
                              onBlur={(e) => handleRenameCategory(category, e.currentTarget.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.currentTarget.blur();
                                }
                              }}
                              disabled={isLoadingSkills}
                            />
                            <span className="text-xs text-gray-400">{categorySkills.length} 个技能</span>
                          </div>

                          <div className="flex flex-wrap gap-2 mb-4">
                            {categorySkills.length ? (
                              categorySkills.map((skill) => (
                                <span
                                  key={skill.id}
                                  className="group px-3 py-1.5 rounded-full bg-white/80 dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors cursor-default flex items-center gap-1"
                                >
                                  {skill.name}
                                  <button
                                    onClick={() => handleDeleteSkill(skill.id)}
                                    className="hidden group-hover:block hover:text-red-500 transition-colors"
                                  >
                                    <X className="w-3 h-4" />
                                  </button>
                                </span>
                              ))
                            ) : (
                              <span className="text-xs text-gray-400">暂无技能</span>
                            )}
                          </div>

                          <div className="flex gap-2 max-w-sm">
                            <input
                              className="fluid-input text-sm"
                              placeholder="添加技能 (Add Skill)"
                              value={skillDraft}
                              onChange={(e) => updateSkillDraftValue(category, e.target.value)}
                              onKeyDown={(e) => e.key === 'Enter' && handleAddSkillToCategory(category)}
                              disabled={isLoadingSkills || isCreatingSkill}
                            />
                            <button
                              onClick={() => handleAddSkillToCategory(category)}
                              className="p-2 text-primary hover:bg-primary/10 rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                              disabled={isLoadingSkills || isCreatingSkill}
                              title="添加技能"
                            >
                              <Plus className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </section>

        </div>
      </main>

      <ConfirmDialog
        isOpen={Boolean(deletingItem)}
        title="确认删除"
        description={
          <>
            {deleteConfirmMessage}
            <br />
            此操作无法撤销。
          </>
        }
        onCancel={() => setDeletingItem(null)}
        onConfirm={handleConfirmDelete}
      />

      <ResumeUploadModal
        isOpen={isResumeModalOpen}
        onClose={() => setIsResumeModalOpen(false)}
        onImported={handleResumeImported}
        toast={{ success, error, loading, updateToast }}
      />

      {/* Toast 提示容器 */}
      <ToastContainer toasts={toasts} onClose={closeToast} />
    </div>
  );
};

export default ExperienceBank;
