import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Database, UploadCloud, Download, Moon, Sun, Briefcase, Plus, Sparkles, ChevronUp, ChevronDown, Trash2, GraduationCap, FolderKanban, Wrench, User, Mail, Phone, MapPin, Link as LinkIcon, X, LayoutTemplate, Award } from 'lucide-react';
import { aiService } from '../services/aiService';
import { Profile, profileService } from '../services/profileService';
import { experienceService, ExperienceListItem } from '../services/experienceService';
import { skillsService, UserSkill } from '../services/skillsService';
import { certificationsService, Certification as CertificationRecord, CertificationUpdatePayload } from '../services/certificationsService';
import { ToastContainer, useToast } from '../components/Toast';

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

const CERT_TOAST_MESSAGES = {
  createLoading: "正在创建证书...",
  createSuccess: "证书创建成功",
  createError: "创建证书失败，请重试",
  saveLoading: "正在保存证书...",
  saveSuccess: "证书保存成功",
  saveError: "保存失败，请重试",
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

const buildWorkCardData = (item: ExperienceListItem) => ({
  org: item.latest_version?.org || "",
  title: item.latest_version?.title || "",
  start_date: item.latest_version?.start_date || "",
  end_date: item.latest_version?.end_date || "",
  star: item.latest_version?.star || { s: "", t: "", a: "", r: "" }
});

const cloneWorkCardData = (data: any) => JSON.parse(JSON.stringify(data));

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

const createEmptyCertificationCardData = (): CertificationCardData => ({
  name: "",
  issuer: "",
  date: "",
  matchRate: 0,
});

/**
 * 将日期字符串从前端格式（YYYY.MM 或 YYYY-MM）转换为后端期望的 ISO 日期格式（YYYY-MM-DD）
 * @param dateStr 日期字符串，例如 "2017.09" 或 "2017-09"
 * @returns ISO 格式的日期字符串，例如 "2017-09-01"，如果为空则返回 undefined
 */
const convertDateToISO = (dateStr: string | undefined): string | undefined => {
  if (!dateStr || !dateStr.trim()) {
    return undefined;
  }

  const trimmed = dateStr.trim();

  // 如果已经是 YYYY-MM-DD 格式，直接返回
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  // 将 YYYY.MM 或 YYYY-MM 格式转换为 YYYY-MM-DD
  const parts = trimmed.split(/[.\-]/);
  if (parts.length >= 2) {
    const year = parts[0].padStart(4, '0');
    const month = parts[1].padStart(2, '0');
    // 默认使用每月的第一天
    return `${year}-${month}-01`;
  }

  // 如果只有年份
  if (parts.length === 1 && parts[0].length === 4) {
    return `${parts[0]}-01-01`;
  }

  return undefined;
};

const getTodayLocalISODate = (): string => {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const runDedupedRefresh = async <T,>(
  inFlightRef: React.MutableRefObject<Promise<T> | null>,
  task: () => Promise<T>
): Promise<T> => {
  if (inFlightRef.current) {
    return inFlightRef.current;
  }
  let request: Promise<T>;
  request = task().finally(() => {
    if (inFlightRef.current === request) {
      inFlightRef.current = null;
    }
  });
  inFlightRef.current = request;
  return request;
};

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
  const hasLoadedWorkRef = useRef(false);
  const hasLoadedEduRef = useRef(false);
  const hasLoadedSkillsRef = useRef(false);
  const hasLoadedCertsRef = useRef(false);

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

  // 加载工作经历列表
  useEffect(() => {
    const loadWorkExperiences = async () => {
      if (hasLoadedWorkRef.current) return;
      try {
        if (!initialWorkExperiencesRef.current?.length) {
          setIsLoadingWork(true);
        }
        console.log('[ExperienceBank] 开始加载工作经历...');
        hasLoadedWorkRef.current = true;
        const data = await experienceService.list('work');
        setWorkExperiences(data);
        console.log(`[ExperienceBank] 加载成功，共 ${data.length} 条工作经历`);
      } catch (error) {
        console.error('Failed to load work experiences:', error);
        hasLoadedWorkRef.current = false; // 失败允许重试
      } finally {
        setIsLoadingWork(false);
      }
    };
    loadWorkExperiences();
  }, []);

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

  // Work Experience State
  const initialWorkExperiencesRef = useRef<ExperienceListItem[] | null>(
    experienceService.peekList('work')
  );
  const [workExperiences, setWorkExperiences] = useState<ExperienceListItem[]>(
    () => initialWorkExperiencesRef.current ?? []
  );
  const [isLoadingWork, setIsLoadingWork] = useState(
    () => !initialWorkExperiencesRef.current
  );
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  const [modifiedCards, setModifiedCards] = useState<Set<string>>(new Set());
  const [cardData, setCardData] = useState<Map<string, any>>(new Map());
  const [originalCardData, setOriginalCardData] = useState<Map<string, any>>(new Map());
  const [deletingCardId, setDeletingCardId] = useState<string | null>(null);
  const [isPolishing, setIsPolishing] = useState(false);
  const [savingCardId, setSavingCardId] = useState<string | null>(null);

  // Skills State
  const [skills, setSkills] = useState<UserSkill[]>([]);
  const [isLoadingSkills, setIsLoadingSkills] = useState(true);
  const [isCreatingSkill, setIsCreatingSkill] = useState(false);
  const [newSkill, setNewSkill] = useState("");
  const workRefreshInFlightRef = useRef<Promise<ExperienceListItem[]> | null>(null);
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
  const [editingEduId, setEditingEduId] = useState<string | null>(null);
  const [eduData, setEduData] = useState<Map<string, EduCardData>>(new Map());
  const [originalEduData, setOriginalEduData] = useState<Map<string, EduCardData>>(new Map());
  const [modifiedEduCards, setModifiedEduCards] = useState<Set<string>>(new Set());
  const [savingEduId, setSavingEduId] = useState<string | null>(null);
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
      setEditingEduId(newEducation.master.id);

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

  const handleSaveEdu = async () => {
    if (!editingEduId) {
      return;
    }
    const data = eduData.get(editingEduId);
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
      setSavingEduId(editingEduId);
      toastId = loading(EDU_TOAST_MESSAGES.saveLoading);
      const versionPayload = buildEduVersionPayload(normalized);
      await experienceService.update(editingEduId, { version: versionPayload });

      setEduData((prev) => new Map(prev).set(editingEduId, normalized));
      setOriginalEduData((prev) => new Map(prev).set(editingEduId, cloneEduCardData(normalized)));
      setModifiedEduCards((prev) => {
        const next = new Set(prev);
        next.delete(editingEduId);
        return next;
      });

      setEducations((prev) => prev.map((item) => {
        if (item.master.id !== editingEduId) {
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

      refreshEducationExperiences().catch((err) => {
        console.error('[ExperienceBank] 刷新教育经历失败:', err);
      });

      setEditingEduId(null);
    } catch (err) {
      console.error('Failed to save education experience:', err);
      if (toastId) {
        updateToast(toastId, { message: EDU_TOAST_MESSAGES.saveError, type: 'error', duration: 3000 });
      } else {
        error(EDU_TOAST_MESSAGES.saveError);
      }
    } finally {
      setSavingEduId(null);
    }
  };

  const handleEditEdu = (edu: ExperienceListItem) => {
    const eduId = edu.master.id;
    ensureEduCardState(eduId, buildEduCardData(edu));
    setEditingEduId(eduId);
  };

  const handleDeleteEdu = async (eduId: string) => {
    let toastId: string | null = null;
    try {
      setEditingEduId(null);
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

  const handleCancelEditEdu = () => {
    if (editingEduId) {
      const original = originalEduData.get(editingEduId);
      if (original) {
        setEduData((prev) => new Map(prev).set(editingEduId, cloneEduCardData(original)));
      }
      setModifiedEduCards((prev) => {
        const next = new Set(prev);
        next.delete(editingEduId);
        return next;
      });
    }
    setEditingEduId(null);
  };

  // Certifications State
  const [certifications, setCertifications] = useState<CertificationRecord[]>([]);
  const [isLoadingCertifications, setIsLoadingCertifications] = useState(true);
  const [editingCertId, setEditingCertId] = useState<string | null>(null);
  const [certData, setCertData] = useState<Map<string, CertificationCardData>>(new Map());
  const [originalCertData, setOriginalCertData] = useState<Map<string, CertificationCardData>>(new Map());
  const [modifiedCertCards, setModifiedCertCards] = useState<Set<string>>(new Set());
  const [savingCertId, setSavingCertId] = useState<string | null>(null);
  const [isCreatingCert, setIsCreatingCert] = useState(false);

  const toggleTheme = () => {
    setIsDarkMode(!isDarkMode);
    document.documentElement.classList.toggle('dark');
  };

  const refreshWorkExperiences = useCallback(async () => {
    return runDedupedRefresh(workRefreshInFlightRef, async () => {
      const data = await experienceService.list('work', { force: true });
      setWorkExperiences(data);
      return data;
    });
  }, []);

  // ============= 新的工作经历卡片管理 Handlers =============
  // 切换卡片展开/折叠状态
  const toggleCard = (cardId: string) => {
    const newExpanded = new Set(expandedCards);
    if (newExpanded.has(cardId)) {
      newExpanded.delete(cardId);
    } else {
      newExpanded.add(cardId);
      // 展开时初始化卡片数据
      const item = workExperiences.find(e => e.master.id === cardId);
      if (item && !cardData.has(cardId)) {
        const initialData = buildWorkCardData(item);
        setCardData(new Map(cardData).set(cardId, initialData));
        setOriginalCardData(new Map(originalCardData).set(cardId, cloneWorkCardData(initialData)));
      }
    }
    setExpandedCards(newExpanded);
  };

  // 更新卡片字段值
  const updateCardField = (cardId: string, field: string, value: any) => {
    const newData = new Map(cardData);
    const current: any = newData.get(cardId) || {};

    if (field.startsWith('star.')) {
      const starField = field.split('.')[1];
      current.star = { ...(current.star || {}), [starField]: value };
    } else {
      current[field] = value;
    }

    newData.set(cardId, current);
    setCardData(newData);

    // 检测是否修改
    const original = originalCardData.get(cardId);
    const isModified = original && JSON.stringify(current) !== JSON.stringify(original);
    const newModified = new Set(modifiedCards);
    if (isModified) {
      newModified.add(cardId);
    } else {
      newModified.delete(cardId);
    }
    setModifiedCards(newModified);
  };

  // 保存卡片
  const handleSaveCard = async (cardId: string) => {
    let toastId: string | null = null;
    try {
      const data = cardData.get(cardId);
      if (!data) return;

      // 验证必填字段
      if (!data.title || !data.title.trim()) {
        error('职位名称不能为空');
        return;
      }

      // 设置保存中状态
      setSavingCardId(cardId);

      // 1. 立即乐观更新本地状态 (UI Instant Update)
      // 更新原始基准数据
      setOriginalCardData(prev => new Map(prev).set(cardId, cloneWorkCardData(data)));

      // 清除修改标记
      const newModified = new Set(modifiedCards);
      newModified.delete(cardId);
      setModifiedCards(newModified);

      // 立即更新列表视图 (Optimistic Update)
      setWorkExperiences((prev) => prev.map((item) => {
        if (item.master.id === cardId) {
          return {
            ...item,
            latest_version: {
              ...(item.latest_version || {}),
              title: data.title,
              org: data.org,
              start_date: convertDateToISO(data.start_date),
              end_date: convertDateToISO(data.end_date),
              star: data.star
            } as any
          };
        }
        return item;
      }));

      // 显示成功消息 (Optimistic Success)
      console.log('[ExperienceBank] 乐观更新UI完成');
      toastId = loading('正在同步...'); // 这里给一个轻微的反馈，或者直接success

      // 2. 转换数据格式
      const versionPayload = {
        title: data.title,
        org: data.org || undefined,
        start_date: convertDateToISO(data.start_date),
        end_date: convertDateToISO(data.end_date),
        star: data.star || {},
      };

      // 3. 后台发送保存请求 (Background Sync)
      // 注意：这里仍然 await update 以确保数据持久化成功，但UI已经更新了
      await experienceService.update(cardId, { version: versionPayload });

      if (toastId) updateToast(toastId, { message: '已保存', type: 'success', duration: 2000 });
      else success('已保存');

      // 4. 后台静默刷新列表 (Eventual Consistency)
      // 不阻塞用户操作，静默同步最新状态（如服务端生成的字段）
      refreshWorkExperiences().then((updatedList) => {
        // 同步更新 cardData (防止服务端有数据处理)
        const updatedItem = updatedList.find(item => item.master.id === cardId);
        if (updatedItem) {
          const freshData = buildWorkCardData(updatedItem);
          // 注意：如果用户在保存后又立即编辑了，这里不能盲目覆盖，需要判断
          // 简单起见，如果当前没有处于被修改状态，则同步
          setModifiedCards(currentModified => {
            if (!currentModified.has(cardId)) {
              setCardData(prev => new Map(prev).set(cardId, freshData));
              setOriginalCardData(prev => new Map(prev).set(cardId, cloneWorkCardData(freshData)));
            }
            return currentModified;
          });
        }
      }).catch((err) => {
        console.error('[ExperienceBank] 刷新工作经历失败:', err);
      });

    } catch (err) {
      console.error('Failed to save work experience:', err);
      // 回滚状态（如果需要复杂回滚，这里暂时简单提示错误，实际场景可能需要恢复 originalCardData）
      if (toastId) updateToast(toastId, { message: '保存同步失败，请重试', type: 'error', duration: 3000 });
      else error('保存同步失败，请重试');
    } finally {
      setSavingCardId(null);
    }
  };

  // 取消修改
  const handleCancelCard = (cardId: string) => {
    const original = originalCardData.get(cardId);
    if (original) {
      setCardData(new Map(cardData).set(cardId, cloneWorkCardData(original)));
    }
    const newModified = new Set(modifiedCards);
    newModified.delete(cardId);
    setModifiedCards(newModified);
  };

  // 删除卡片
  const handleDeleteCard = async (cardId: string) => {
    let toastId: string | null = null;
    try {
      setDeletingCardId(null);

      // 1. 立即乐观更新 (UI Instant Removal)
      setWorkExperiences(prev => prev.filter(item => item.master.id !== cardId));

      // 清理相关状态
      setExpandedCards(prev => {
        const next = new Set(prev);
        next.delete(cardId);
        return next;
      });
      setCardData(prev => {
        const next = new Map(prev);
        next.delete(cardId);
        return next;
      });
      setModifiedCards(prev => {
        const next = new Set(prev);
        next.delete(cardId);
        return next;
      });

      console.log('[ExperienceBank] 乐观删除完成');

      // 2. 后台发送删除请求
      await experienceService.delete(cardId);

      success('已删除');

      // 3. 后台静默刷新 (已移除，防止死锁)
      // experienceService.list('work', { force: true }).catch(console.error);

    } catch (err) {
      console.error('Failed to delete work experience:', err);
      error('删除同步失败，正在恢复列表...');
      // 失败回滚：重新拉取列表
      try {
        await refreshWorkExperiences();
      } catch (refreshError) {
        console.error('[ExperienceBank] 恢复工作经历失败:', refreshError);
      }
    }
  };

  // 新增工作经历
  const handleAddNewWork = async () => {
    let toastId: string | null = null;
    try {
      toastId = loading('正在创建...');

      // 1. 发送创建请求 (Wait for ID, but skip list refresh)
      const newWork = await experienceService.create({
        category: 'work',
        version: {
          title: "新职位",
          org: "新公司",
          start_date: getTodayLocalISODate(),
          star: { s: "", t: "", a: "", r: "" }
        }
      });

      // 2. 立即使用返回的新项更新列表 (Semi-Optimistic)
      // 不等待 experienceService.list()，直接利用 newWork
      setWorkExperiences(prev => [newWork, ...prev]);

      // 3. 初始化卡片状态并展开
      const initialData = buildWorkCardData(newWork);
      setCardData(prev => new Map(prev).set(newWork.master.id, initialData));
      setOriginalCardData(prev => new Map(prev).set(newWork.master.id, cloneWorkCardData(initialData)));
      setExpandedCards(prev => {
        const next = new Set(prev);
        next.add(newWork.master.id);
        return next;
      });

      if (toastId) updateToast(toastId, { message: '已创建', type: 'success', duration: 2000 });
      else success('已创建');

      // 4. 后台静默刷新确保一致性 (已移除，防止死锁)
      // experienceService.list('work', { force: true }).then(...).catch(console.error);

    } catch (err) {
      console.error('Failed to create work experience:', err);
      if (toastId) updateToast(toastId, { message: '创建失败', type: 'error', duration: 3000 });
      else error('创建失败');
    }
  };

  // AI润色卡片
  const handlePolishCard = async (cardId: string) => {
    const data = cardData.get(cardId);
    if (!data) return;

    setIsPolishing(true);
    try {
      const response = await aiService.polishExperience({
        content: {
          company: data.org || "",
          role: data.title || "",
          s: data.star?.s || "",
          t: data.star?.t || "",
          a: data.star?.a || "",
          r: data.star?.r || "",
        },
      });

      // 更新卡片数据
      const newStar = { ...data.star };
      if (response.s) newStar.s = response.s;
      if (response.t) newStar.t = response.t;
      if (response.a) newStar.a = response.a;
      if (response.r) newStar.r = response.r;

      updateCardField(cardId, 'star', newStar);
    } catch (error) {
      console.error("Failed to polish experience", error);
    } finally {
      setIsPolishing(false);
    }
  };
  // ============= 新的工作经历卡片管理 Handlers 结束 =============


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

  const resolveCertificationDescription = (certId: string, matchRate: number) => {
    const existing = certifications.find((cert) => cert.id === certId)?.description;
    if (!canPersistCertificationMeta(existing)) {
      return undefined;
    }
    return buildCertificationMetaDescription(matchRate);
  };

  const handleAddSkill = async () => {
    if (isCreatingSkill || isLoadingSkills) {
      return;
    }
    const trimmed = newSkill.trim();
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
      const created = await skillsService.create({ name: trimmed });
      setSkills((prev) => [created, ...prev]);
      setNewSkill("");
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
      setEditingCertId(newCert.id);

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

  const handleSaveCert = async () => {
    if (!editingCertId) {
      return;
    }
    const data = certData.get(editingCertId);
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
      setSavingCertId(editingCertId);
      toastId = loading(CERT_TOAST_MESSAGES.saveLoading);
      const description = resolveCertificationDescription(editingCertId, normalized.matchRate);
      const payload = buildCertificationPayload(normalized, description);
      await certificationsService.update(editingCertId, payload);

      setCertData((prev) => new Map(prev).set(editingCertId, normalized));
      setOriginalCertData((prev) => new Map(prev).set(editingCertId, cloneCertificationCardData(normalized)));
      setModifiedCertCards((prev) => {
        const next = new Set(prev);
        next.delete(editingCertId);
        return next;
      });

      setCertifications((prev) => prev.map((item) => {
        if (item.id !== editingCertId) {
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

      refreshCertifications().catch((err) => {
        console.error('[ExperienceBank] 刷新证书失败:', err);
      });

      setEditingCertId(null);
    } catch (err) {
      console.error('Failed to save certification:', err);
      if (toastId) {
        updateToast(toastId, { message: CERT_TOAST_MESSAGES.saveError, type: 'error', duration: 3000 });
      } else {
        error(CERT_TOAST_MESSAGES.saveError);
      }
    } finally {
      setSavingCertId(null);
    }
  };

  const handleEditCert = (cert: CertificationRecord) => {
    ensureCertCardState(cert.id, buildCertificationCardData(cert));
    setEditingCertId(cert.id);
  };

  const handleDeleteCert = async (id: string) => {
    let toastId: string | null = null;
    try {
      setEditingCertId(null);
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

  const handleCancelEditCert = () => {
    if (editingCertId) {
      const original = originalCertData.get(editingCertId);
      if (original) {
        setCertData((prev) => new Map(prev).set(editingCertId, cloneCertificationCardData(original)));
      }
      setModifiedCertCards((prev) => {
        const next = new Set(prev);
        next.delete(editingCertId);
        return next;
      });
    }
    setEditingCertId(null);
  };

  const editingEduData = editingEduId
    ? (eduData.get(editingEduId) || createEmptyEduCardData())
    : null;
  const isEduModified = editingEduId ? modifiedEduCards.has(editingEduId) : false;
  const editingCertData = editingCertId
    ? (certData.get(editingCertId) || createEmptyCertificationCardData())
    : null;
  const editingCertRecord = editingCertId
    ? certifications.find((cert) => cert.id === editingCertId)
    : null;
  const isCertMatchRateEditable = editingCertId
    ? canPersistCertificationMeta(editingCertRecord?.description)
    : false;
  const isCertModified = editingCertId ? modifiedCertCards.has(editingCertId) : false;

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
          <button className="hidden md:flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors border border-transparent hover:border-gray-200 dark:hover:border-gray-700">
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

          {/* ============= 新的工作经历UI(多卡片) ============= */}
          {/* Work Experience Section */}
          <section className="space-y-6 pt-6 border-t border-gray-200 dark:border-gray-800">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <Briefcase className="w-5 h-5 text-primary" />
                工作经历
                <span className="text-sm font-normal text-gray-400 ml-2">Work Experience</span>
              </h2>
              <span className="text-xs font-mono text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">
                {isLoadingWork ? 'Loading...' : `${workExperiences.length} items`}
              </span>
            </div>

            <button
              onClick={handleAddNewWork}
              className="w-full group border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-xl p-4 flex items-center justify-center gap-2 text-gray-500 hover:text-primary hover:border-primary hover:bg-primary/5 transition-all duration-300"
            >
              <div className="p-1 rounded-full bg-gray-200 dark:bg-gray-800 group-hover:bg-white group-hover:text-primary transition-colors">
                <Plus className="w-5 h-5" />
              </div>
              <span className="font-medium">新增工作经历</span>
            </button>

            {/* 工作经历卡片列表 */}
            {workExperiences.map((item) => {
              const cardId = item.master.id;
              const isExpanded = expandedCards.has(cardId);
              const isModified = modifiedCards.has(cardId);
              const data = cardData.get(cardId) || buildWorkCardData(item);

              return (
                <div key={cardId} className="bg-white dark:bg-surface-dark rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm hover:shadow-md transition-all duration-300 overflow-hidden">
                  {!isExpanded ? (
                    // 折叠态
                    <div className="p-5 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors" onClick={() => toggleCard(cardId)}>
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-3 mb-1">
                            <h3 className="font-bold text-gray-900 dark:text-white truncate">{data.org}</h3>
                            <span className="text-gray-300 dark:text-gray-600">|</span>
                            <span className="text-gray-700 dark:text-gray-300 font-medium">{data.title}</span>
                          </div>
                          <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
                            {data.star?.s ? data.star.s.substring(0, 60) + '...' : '点击展开编辑工作经历...'}
                          </p>
                        </div>
                        <div className="text-right shrink-0 flex items-center gap-2">
                          <span className="block text-sm font-mono text-gray-500">{data.start_date} - {data.end_date || '至今'}</span>
                          {/* 删除按钮 - 折叠态可见 */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeletingCardId(cardId);
                            }}
                            className="text-gray-400 hover:text-red-500 transition-colors p-1 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                            title="删除"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                          <ChevronDown className="w-5 h-5 text-gray-400" />
                        </div>
                      </div>
                    </div>
                  ) : (
                    // 展开态
                    <>
                      <div className="p-6 pb-2 border-b border-gray-50 dark:border-gray-800/50">
                        <div className="flex flex-col lg:flex-row gap-6 mb-4">
                          <div className="flex-1">
                            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1 block">公司名称</label>
                            <input
                              className="fluid-input text-xl font-bold text-gray-900 dark:text-white placeholder-gray-300"
                              placeholder="输入公司名称"
                              type="text"
                              value={data.org}
                              onChange={(e) => updateCardField(cardId, 'org', e.target.value)}
                            />
                          </div>
                          <div className="flex-1">
                            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1 block">担任职位</label>
                            <input
                              className="fluid-input text-xl font-bold text-gray-900 dark:text-white placeholder-gray-300"
                              placeholder="输入职位名称"
                              type="text"
                              value={data.title}
                              onChange={(e) => updateCardField(cardId, 'title', e.target.value)}
                            />
                          </div>
                          <div className="w-full lg:w-auto shrink-0">
                            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1 block">时间段</label>
                            <div className="flex items-center gap-2">
                              <input
                                className="fluid-input w-24 text-center text-base text-gray-600 dark:text-gray-300"
                                placeholder="YYYY.MM"
                                type="text"
                                value={data.start_date}
                                onChange={(e) => updateCardField(cardId, 'start_date', e.target.value)}
                              />
                              <span className="text-gray-400">-</span>
                              <input
                                className="fluid-input w-24 text-center text-base text-gray-600 dark:text-gray-300"
                                placeholder="至今"
                                type="text"
                                value={data.end_date}
                                onChange={(e) => updateCardField(cardId, 'end_date', e.target.value)}
                              />
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="p-6 pt-4 space-y-4">
                        {/* STAR Sections */}
                        {[
                          { id: 's', label: 'S - 情境 (Situation)', color: 'blue', ph: 'Describe the context...' },
                          { id: 't', label: 'T - 任务 (Task)', color: 'orange', ph: 'What were your goals?' },
                          { id: 'a', label: 'A - 行动 (Action)', color: 'amber', ph: 'What specifically did you do?' },
                          { id: 'r', label: 'R - 结果 (Result)', color: 'emerald', ph: 'Quantifiable outcomes...' },
                        ].map((section, idx) => (
                          <div key={section.id} className="flex gap-4 relative group">
                            {idx !== 3 && <div className="absolute left-[19px] top-10 bottom-0 w-[2px] bg-gray-100 dark:bg-gray-800"></div>}
                            <div className={`shrink-0 w-10 h-10 rounded-full bg-${section.color}-50 dark:bg-${section.color}-900/20 text-${section.color}-600 dark:text-${section.color}-400 flex items-center justify-center ring-4 ring-white dark:ring-surface-dark z-10 font-bold`}>
                              {section.id.toUpperCase()}
                            </div>
                            <div className="flex-1 pt-1 pb-4">
                              <div className="flex items-center justify-between mb-2">
                                <span className={`text-xs font-bold text-${section.color}-600 dark:text-${section.color}-400 uppercase tracking-widest`}>{section.label}</span>
                              </div>
                              <textarea
                                className="w-full bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-lg p-3 text-sm text-gray-700 dark:text-gray-300 focus:ring-2 focus:ring-primary/20 focus:border-primary resize-none leading-relaxed transition-all hover:bg-white dark:hover:bg-gray-800 shadow-sm"
                                rows={section.id === 'a' ? 4 : 2}
                                value={data.star?.[section.id] || ""}
                                placeholder={section.ph}
                                onChange={(e) => updateCardField(cardId, `star.${section.id}`, e.target.value)}
                              />
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="bg-gray-50 dark:bg-gray-800/50 px-6 py-3 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between">
                        <button
                          onClick={() => handlePolishCard(cardId)}
                          disabled={isPolishing}
                          className="flex items-center gap-2 text-sm font-medium text-emerald-600 bg-emerald-50 hover:bg-emerald-100 dark:text-emerald-400 dark:bg-emerald-900/20 dark:hover:bg-emerald-900/30 px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
                        >
                          <Sparkles className="w-4 h-4" />
                          {isPolishing ? 'AI 润色中...' : 'AI 润色'}
                        </button>
                        <div className="flex items-center gap-2">
                          {/* 删除按钮 - 展开态可见 */}
                          <button
                            onClick={() => setDeletingCardId(cardId)}
                            className="text-gray-400 hover:text-red-500 transition-colors p-2 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg mr-2"
                            title="删除"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>

                          {isModified ? (
                            <>
                              <button
                                onClick={() => handleCancelCard(cardId)}
                                className="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white transition-colors text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
                                disabled={savingCardId === cardId}
                              >
                                取消
                              </button>
                              <button
                                onClick={() => handleSaveCard(cardId)}
                                className="flex items-center gap-2 text-sm font-medium text-white bg-primary hover:bg-primary-dark px-6 py-2 rounded-lg transition-colors shadow-sm shadow-primary/20 disabled:opacity-50 disabled:cursor-not-allowed"
                                disabled={savingCardId === cardId}
                              >
                                {savingCardId === cardId ? '保存中...' : '保存'}
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => toggleCard(cardId)}
                              className="flex items-center gap-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white px-4 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                            >
                              折叠
                              <ChevronUp className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              );
            })}

            {/* 删除确认对话框 */}
            {deletingCardId && (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                <div className="bg-white dark:bg-surface-dark rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl">
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">确认删除</h3>
                  <p className="text-gray-600 dark:text-gray-400 mb-6">
                    确定要删除这条工作经历吗？此操作无法撤销。
                  </p>
                  <div className="flex items-center justify-end gap-3">
                    <button
                      onClick={() => setDeletingCardId(null)}
                      className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                    >
                      取消
                    </button>
                    <button
                      onClick={() => handleDeleteCard(deletingCardId)}
                      className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
                    >
                      删除
                    </button>
                  </div>
                </div>
              </div>
            )}
          </section>
          {/* ============= 新的工作经历UI(多卡片) 结束 ============= */}

          {/* Education Section */}
          <section className="space-y-6 pt-6 border-t border-gray-200 dark:border-gray-800">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <GraduationCap className="w-5 h-5 text-purple-600" />
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
              className="w-full group border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-xl p-4 flex items-center justify-center gap-2 text-gray-500 hover:text-purple-600 hover:border-purple-500 hover:bg-purple-50 dark:hover:bg-purple-900/10 transition-all duration-300 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <div className="p-1 rounded-full bg-gray-200 dark:bg-gray-800 group-hover:bg-white group-hover:text-purple-600 transition-colors">
                <Plus className="w-5 h-5" />
              </div>
              <span className="font-medium">新增教育经历</span>
            </button>

            {/* Editable/New Edu Card */}
            {editingEduId && (
              <div className="bg-white dark:bg-surface-dark rounded-xl border border-purple-500/30 shadow-lg shadow-purple-500/5 overflow-hidden transition-all duration-300 ring-1 ring-purple-500/10 relative animate-in fade-in slide-in-from-top-4">
                <div className="p-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="flex-1">
                      <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1 block">学校名称</label>
                      <input
                        className="fluid-input text-lg font-bold text-gray-900 dark:text-white placeholder-gray-300 w-full"
                        placeholder="输入学校名称"
                        value={editingEduData?.school || ""}
                        onChange={(e) => editingEduId && updateEduField(editingEduId, "school", e.target.value)}
                      />
                    </div>
                    <div className="flex-1">
                      <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1 block">专业</label>
                      <input
                        className="fluid-input text-lg font-bold text-gray-900 dark:text-white placeholder-gray-300 w-full"
                        placeholder="输入专业"
                        value={editingEduData?.major || ""}
                        onChange={(e) => editingEduId && updateEduField(editingEduId, "major", e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1 block">学位</label>
                      <input
                        className="fluid-input text-base text-gray-700 dark:text-gray-300 placeholder-gray-300 w-full"
                        placeholder="本科/硕士/博士"
                        value={editingEduData?.degree || ""}
                        onChange={(e) => editingEduId && updateEduField(editingEduId, "degree", e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1 block">时间段</label>
                      <div className="flex items-center gap-2">
                        <input
                          className="fluid-input w-24 text-center text-base text-gray-600 dark:text-gray-300"
                          placeholder="Start"
                          value={editingEduData?.startDate || ""}
                          onChange={(e) => editingEduId && updateEduField(editingEduId, "startDate", e.target.value)}
                        />
                        <span className="text-gray-400">-</span>
                        <input
                          className="fluid-input w-24 text-center text-base text-gray-600 dark:text-gray-300"
                          placeholder="End"
                          value={editingEduData?.endDate || ""}
                          onChange={(e) => editingEduId && updateEduField(editingEduId, "endDate", e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="md:col-span-2">
                      <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1 block">GPA (可选)</label>
                      <input
                        className="fluid-input text-base text-gray-700 dark:text-gray-300 placeholder-gray-300 w-full"
                        placeholder="例如: 3.8/4.0"
                        value={editingEduData?.gpa || ""}
                        onChange={(e) => editingEduId && updateEduField(editingEduId, "gpa", e.target.value)}
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1 block">主修课程 (可选)</label>
                      <textarea
                        className="w-full bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-lg p-3 text-sm text-gray-700 dark:text-gray-300 focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 resize-none"
                        rows={2}
                        placeholder="列出关键相关课程..."
                        value={editingEduData?.courses || ""}
                        onChange={(e) => editingEduId && updateEduField(editingEduId, "courses", e.target.value)}
                      />
                    </div>
                  </div>
                </div>

                <div className="bg-gray-50 dark:bg-gray-800/50 px-6 py-3 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between">
                  <button
                    className="text-gray-400 hover:text-red-500 transition-colors p-2 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg"
                    onClick={() => editingEduId && handleDeleteEdu(editingEduId)}
                    title="删除"
                    disabled={savingEduId === editingEduId}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleCancelEditEdu}
                      className="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white transition-colors text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
                      disabled={savingEduId === editingEduId}
                    >
                      取消
                    </button>
                    <button
                      onClick={handleSaveEdu}
                      className="flex items-center gap-2 text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 px-6 py-2 rounded-lg transition-colors shadow-sm shadow-purple-500/20"
                      disabled={savingEduId === editingEduId || !isEduModified}
                    >
                      保存
                      <ChevronUp className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Edu List Items */}
            {educations.map((edu) => {
              const viewData = buildEduCardData(edu);
              return (
                <div
                  key={edu.master.id}
                  className="group bg-white dark:bg-surface-dark rounded-xl border border-gray-200 dark:border-gray-700 p-5 hover:shadow-md hover:border-purple-400 transition-all duration-200 cursor-pointer"
                  onClick={() => handleEditEdu(edu)}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-1">
                        <h3 className="font-bold text-gray-900 dark:text-white truncate">{viewData.school}</h3>
                        <span className="text-gray-300 dark:text-gray-600">|</span>
                        <span className="text-gray-700 dark:text-gray-300 font-medium">{viewData.major}</span>
                      </div>
                      <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
                        {viewData.degree} {viewData.gpa ? `• GPA: ${viewData.gpa}` : ''} {viewData.courses ? `• ${viewData.courses}` : ''}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="block text-sm font-mono text-gray-500 mb-2">{viewData.startDate} - {viewData.endDate}</span>
                      <ChevronDown className="w-5 h-5 text-gray-400 group-hover:text-purple-500 transition-colors ml-auto" />
                    </div>
                  </div>
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

            {/* Editable/New Cert Card */}
            {editingCertId && (
              <div className="bg-white dark:bg-surface-dark rounded-xl border border-amber-500/30 shadow-lg shadow-amber-500/5 overflow-hidden transition-all duration-300 ring-1 ring-amber-500/10">
                <div className="p-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="md:col-span-2">
                      <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1 block">证书名称</label>
                      <input
                        className="fluid-input text-lg font-bold text-gray-900 dark:text-white placeholder-gray-300"
                        placeholder="例如: PMP 项目管理专业人士"
                        type="text"
                        value={editingCertData?.name || ""}
                        onChange={(e) => editingCertId && updateCertField(editingCertId, "name", e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1 block">颁发机构</label>
                      <input
                        className="fluid-input text-base text-gray-700 dark:text-gray-300 placeholder-gray-300"
                        placeholder="例如: PMI"
                        type="text"
                        value={editingCertData?.issuer || ""}
                        onChange={(e) => editingCertId && updateCertField(editingCertId, "issuer", e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1 block">获得时间</label>
                      <input
                        className="fluid-input text-base text-gray-700 dark:text-gray-300 placeholder-gray-300"
                        placeholder="YYYY 或 YYYY.MM"
                        type="text"
                        value={editingCertData?.date || ""}
                        onChange={(e) => editingCertId && updateCertField(editingCertId, "date", e.target.value)}
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1 block">
                        匹配度 (可选) - {editingCertData?.matchRate ?? 0}%
                        {!isCertMatchRateEditable && (
                          <span className="ml-2 text-[11px] font-normal text-amber-500 normal-case">
                            已有描述，匹配度不可编辑
                          </span>
                        )}
                      </label>
                      <input
                        className="w-full disabled:cursor-not-allowed"
                        type="range"
                        min="0"
                        max="100"
                        value={editingCertData?.matchRate ?? 0}
                        onChange={(e) =>
                          editingCertId &&
                          isCertMatchRateEditable &&
                          updateCertField(editingCertId, "matchRate", parseInt(e.target.value))
                        }
                        disabled={!isCertMatchRateEditable || savingCertId === editingCertId}
                      />
                    </div>
                  </div>
                </div>

                <div className="bg-gray-50 dark:bg-gray-800/50 px-6 py-3 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between">
                  <button
                    className="text-gray-400 hover:text-red-500 transition-colors p-2 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg"
                    onClick={() => editingCertId && handleDeleteCert(editingCertId)}
                    title="删除"
                    disabled={savingCertId === editingCertId}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleCancelEditCert}
                      className="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white transition-colors text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
                      disabled={savingCertId === editingCertId}
                    >
                      取消
                    </button>
                    <button
                      onClick={handleSaveCert}
                      className="flex items-center gap-2 text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 px-6 py-2 rounded-lg transition-colors shadow-sm shadow-amber-500/20"
                      disabled={savingCertId === editingCertId || !isCertModified}
                    >
                      保存
                      <ChevronUp className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Cert List Items */}
            {certifications.map((cert) => {
              const viewData = buildCertificationCardData(cert);
              return (
                <div
                  key={cert.id}
                  className="group bg-white dark:bg-surface-dark rounded-xl border border-gray-200 dark:border-gray-700 p-5 hover:shadow-md hover:border-amber-400 transition-all duration-200 cursor-pointer"
                  onClick={() => handleEditCert(cert)}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-1">
                        <h3 className="font-bold text-gray-900 dark:text-white truncate">{viewData.name}</h3>
                        {viewData.matchRate > 0 && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400">
                            匹配度 {viewData.matchRate}%
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-500 dark:text-gray-400 truncate">{viewData.issuer}</p>
                    </div>
                    <div className="text-right shrink-0 flex items-center gap-2">
                      <span className="block text-sm font-mono text-gray-500">{viewData.date}</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteCert(cert.id);
                        }}
                        className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-all p-1 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
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
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">技术栈 / Tech Stack</h4>
                  </div>

                  <div className="flex flex-wrap gap-2 mb-4">
                    {skills.map((skill) => (
                      <span key={skill.id} className="group px-3 py-1.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors cursor-default flex items-center gap-1">
                        {skill.name}
                        <button
                          onClick={() => handleDeleteSkill(skill.id)}
                          className="hidden group-hover:block hover:text-red-500 transition-colors"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>

                  <div className="flex gap-2 max-w-sm">
                    <input
                      className="fluid-input text-sm"
                      placeholder="添加新技能 (Add Skill)"
                      value={newSkill}
                      onChange={(e) => setNewSkill(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleAddSkill()}
                      disabled={isLoadingSkills || isCreatingSkill}
                    />
                    <button
                      onClick={handleAddSkill}
                      className="p-2 text-primary hover:bg-primary/10 rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                      disabled={isLoadingSkills || isCreatingSkill}
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </section>

        </div>
      </main>

      {/* Toast 提示容器 */}
      <ToastContainer toasts={toasts} onClose={closeToast} />
    </div>
  );
};

export default ExperienceBank;
