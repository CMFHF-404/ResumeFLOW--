import React, { useState, useEffect, useRef } from 'react';
import { Database, UploadCloud, Download, Moon, Sun, Briefcase, Plus, Sparkles, ChevronUp, ChevronDown, Trash2, GraduationCap, FolderKanban, Wrench, User, Mail, Phone, MapPin, Link as LinkIcon, X, LayoutTemplate, Award } from 'lucide-react';
import { aiService } from '../services/aiService';
import { Profile, profileService } from '../services/profileService';
import { Certification } from '../types';

const LINKEDIN_LABEL = "linkedin";

type SocialLinkValue = string | { url?: string; position?: number } | null | undefined;

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

  // 使用 ref 存储回调，避免 useEffect 依赖项变化导致重复执行
  const onProfileUpdateRef = useRef(onProfileUpdate);

  // 同步最新的回调函数到 ref
  useEffect(() => {
    onProfileUpdateRef.current = onProfileUpdate;
  }, [onProfileUpdate]);

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
        setIsLoadingProfile(true);
        console.log('[ExperienceBank] 开始加载个人资料...');

        // profileService 已有内置缓存机制，会自动处理缓存
        const profile = await profileService.getProfile();

        setName(profile.full_name || "");
        setEmail(profile.email || "");
        setPhone(profile.phone || "");
        setLocation(profile.location || "");
        // 从social_links中提取LinkedIn链接
        const loadedLink = resolveLinkedInLink(profile);
        setLink(loadedLink);
        setProfileSocialLinks({ ...(profile.social_links || {}) });
        setOriginalProfile({
          name: profile.full_name || "",
          email: profile.email || "",
          phone: profile.phone || "",
          location: profile.location || "",
          link: loadedLink
        });

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
        }, 300);
      }
    };

    loadProfile();
  }, []); // ✅ 空依赖数组，只在挂载时执行一次

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



  // Work Experience State
  const [expandedWork, setExpandedWork] = useState(true);
  const [company, setCompany] = useState("腾讯 (Tencent)");
  const [role, setRole] = useState("高级产品经理");
  const [startDate, setStartDate] = useState("2021.03");
  const [endDate, setEndDate] = useState("至今");
  const [situation, setSituation] = useState("负责腾讯云核心PaaS产品的商业化落地，面对竞品激烈的市场环境，需在Q3季度完成200%的增长目标。");
  const [task, setTask] = useState("重构产品定价体系，并主导针对KA客户的定制化解决方案，提升大客户转化率。");
  const [action, setAction] = useState("1. 深入调研50+家头部客户，建立多维度定价模型；\n2. 协调产研团队优化部署流程，将交付周期从2周缩短至3天；\n3. 搭建自动化营销漏斗，实现线索分级管理。");
  const [result, setResult] = useState("Q3季度实现营收增长210%，KA客户签约率提升45%，成功打造3个行业标杆案例。");
  const [isPolishing, setIsPolishing] = useState(false);

  // Skills State
  const [skills, setSkills] = useState(["Product Management", "Figma", "SQL", "Python Analysis", "Axure RP", "Jira/Confluence"]);
  const [newSkill, setNewSkill] = useState("");

  // Education State
  const [educations, setEducations] = useState([
    { id: '1', school: '浙江大学', major: '计算机科学与技术', degree: '本科', startDate: '2017.09', endDate: '2021.06', gpa: '3.8/4.0', courses: '数据结构、操作系统、计算机网络...' }
  ]);
  const [expandedEdu, setExpandedEdu] = useState(false);
  const [editingEduId, setEditingEduId] = useState<string | null>(null);
  const [eduSchool, setEduSchool] = useState("");
  const [eduMajor, setEduMajor] = useState("");
  const [eduDegree, setEduDegree] = useState("");
  const [eduStartDate, setEduStartDate] = useState("");
  const [eduEndDate, setEduEndDate] = useState("");
  const [eduGpa, setEduGpa] = useState("");
  const [eduCourses, setEduCourses] = useState("");

  // Education Handlers
  const handleAddEdu = () => {
    setEduSchool("");
    setEduMajor("");
    setEduDegree("");
    setEduStartDate("");
    setEduEndDate("");
    setEduGpa("");
    setEduCourses("");
    setEditingEduId('new');
    setExpandedEdu(true);
  };

  const handleSaveEdu = () => {
    if (!eduSchool.trim() || !eduMajor.trim()) return;

    if (editingEduId === 'new') {
      const newEdu = {
        id: Date.now().toString(),
        school: eduSchool,
        major: eduMajor,
        degree: eduDegree,
        startDate: eduStartDate,
        endDate: eduEndDate,
        gpa: eduGpa,
        courses: eduCourses
      };
      setEducations([...educations, newEdu]);
    } else {
      setEducations(educations.map(edu =>
        edu.id === editingEduId
          ? { ...edu, school: eduSchool, major: eduMajor, degree: eduDegree, startDate: eduStartDate, endDate: eduEndDate, gpa: eduGpa, courses: eduCourses }
          : edu
      ));
    }
    setEditingEduId(null);
    setExpandedEdu(false);
  };

  const handleEditEdu = (edu: any) => {
    setEduSchool(edu.school);
    setEduMajor(edu.major);
    setEduDegree(edu.degree);
    setEduStartDate(edu.startDate);
    setEduEndDate(edu.endDate);
    setEduGpa(edu.gpa || "");
    setEduCourses(edu.courses || "");
    setEditingEduId(edu.id);
    setExpandedEdu(true);
  };

  const handleDeleteEdu = (id: string) => {
    setEducations(educations.filter(edu => edu.id !== id));
    if (editingEduId === id) {
      setEditingEduId(null);
      setExpandedEdu(false);
    }
  };

  const handleCancelEditEdu = () => {
    setEditingEduId(null);
    setExpandedEdu(false);
  };

  // Certifications State
  const [certifications, setCertifications] = useState<Certification[]>([
    { id: '1', name: 'PMP 项目管理专业人士', issuer: 'PMI', date: '2023', matchRate: 95 },
    { id: '2', name: 'Google Analytics 认证', issuer: 'Google', date: '2023', matchRate: 82 }
  ]);
  const [expandedCert, setExpandedCert] = useState(false);
  const [editingCertId, setEditingCertId] = useState<string | null>(null);
  const [certName, setCertName] = useState("");
  const [certIssuer, setCertIssuer] = useState("");
  const [certDate, setCertDate] = useState("");
  const [certMatchRate, setCertMatchRate] = useState<number>(0);

  const toggleTheme = () => {
    setIsDarkMode(!isDarkMode);
    document.documentElement.classList.toggle('dark');
  };

  const handlePolish = async () => {
    setIsPolishing(true);
    try {
      const response = await aiService.polishExperience({
        content: {
          company,
          role,
          s: situation,
          t: task,
          a: action,
          r: result,
        },
      });
      if (response.s) setSituation(response.s);
      if (response.t) setTask(response.t);
      if (response.a) setAction(response.a);
      if (response.r) setResult(response.r);
    } catch (error) {
      console.error("Failed to polish experience", error);
    } finally {
      setIsPolishing(false);
    }
  };

  const handleAddNew = () => {
    setCompany("");
    setRole("");
    setStartDate("");
    setEndDate("");
    setSituation("");
    setTask("");
    setAction("");
    setResult("");
    setExpandedWork(true);
  };

  const handleLoadItem = (title: string, pos: string, start: string, end: string) => {
    setCompany(title);
    setRole(pos);
    setStartDate(start);
    setEndDate(end);
    setExpandedWork(true);

    // Reset STAR to dummy text if loading new item to simulate data fetch
    if (title !== "腾讯 (Tencent)") {
      setSituation("负责...");
      setTask("任务...");
      setAction("行动...");
      setResult("结果...");
    }
  };

  const addSkill = () => {
    if (newSkill.trim() && !skills.includes(newSkill.trim())) {
      setSkills([...skills, newSkill.trim()]);
      setNewSkill("");
    }
  };

  const removeSkill = (skillToRemove: string) => {
    setSkills(skills.filter(s => s !== skillToRemove));
  };

  // 证书管理函数
  const handleAddCert = () => {
    setCertName("");
    setCertIssuer("");
    setCertDate("");
    setCertMatchRate(0);
    setEditingCertId('new');
    setExpandedCert(true);
  };

  const handleSaveCert = () => {
    if (!certName.trim() || !certIssuer.trim()) return;

    if (editingCertId === 'new') {
      const newCert: Certification = {
        id: Date.now().toString(),
        name: certName,
        issuer: certIssuer,
        date: certDate,
        matchRate: certMatchRate
      };
      setCertifications([...certifications, newCert]);
    } else {
      setCertifications(certifications.map(cert =>
        cert.id === editingCertId
          ? { ...cert, name: certName, issuer: certIssuer, date: certDate, matchRate: certMatchRate }
          : cert
      ));
    }
    setEditingCertId(null);
    setExpandedCert(false);
  };

  const handleEditCert = (cert: Certification) => {
    setCertName(cert.name);
    setCertIssuer(cert.issuer);
    setCertDate(cert.date);
    setCertMatchRate(cert.matchRate || 0);
    setEditingCertId(cert.id);
    setExpandedCert(true);
  };

  const handleDeleteCert = (id: string) => {
    setCertifications(certifications.filter(cert => cert.id !== id));
    if (editingCertId === id) {
      setEditingCertId(null);
      setExpandedCert(false);
    }
  };

  const handleCancelEditCert = () => {
    setEditingCertId(null);
    setExpandedCert(false);
  };

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

          {/* Work Experience Section */}
          <section className="space-y-6 pt-6 border-t border-gray-200 dark:border-gray-800">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <Briefcase className="w-5 h-5 text-primary" />
                工作经历
                <span className="text-sm font-normal text-gray-400 ml-2">Work Experience</span>
              </h2>
              <span className="text-xs font-mono text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">3 items</span>
            </div>

            <button
              onClick={handleAddNew}
              className="w-full group border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-xl p-4 flex items-center justify-center gap-2 text-gray-500 hover:text-primary hover:border-primary hover:bg-primary/5 transition-all duration-300"
            >
              <div className="p-1 rounded-full bg-gray-200 dark:bg-gray-800 group-hover:bg-white group-hover:text-primary transition-colors">
                <Plus className="w-5 h-5" />
              </div>
              <span className="font-medium">新增工作经历</span>
            </button>

            {/* Editable Card */}
            <div className="bg-white dark:bg-surface-dark rounded-xl border border-primary/30 shadow-lg shadow-primary/5 overflow-hidden transition-all duration-300 ring-1 ring-primary/10">
              {!expandedWork ? (
                // 折叠态：显示为精简卡片
                <div
                  className="p-5 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                  onClick={() => setExpandedWork(true)}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-1">
                        <h3 className="font-bold text-gray-900 dark:text-white truncate">{company}</h3>
                        <span className="text-gray-300 dark:text-gray-600">|</span>
                        <span className="text-gray-700 dark:text-gray-300 font-medium">{role}</span>
                      </div>
                      <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
                        {situation ? situation.substring(0, 60) + '...' : '点击展开编辑工作经历...'}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="block text-sm font-mono text-gray-500 mb-2">{startDate} - {endDate}</span>
                      <ChevronDown className="w-5 h-5 text-gray-400 group-hover:text-primary transition-colors ml-auto" />
                    </div>
                  </div>
                </div>
              ) : (
                // 展开态：显示编辑表单
                <>
                  <div className="p-6 pb-2 border-b border-gray-50 dark:border-gray-800/50">
                    <div className="flex flex-col lg:flex-row gap-6 mb-4">
                      <div className="flex-1">
                        <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1 block">公司名称</label>
                        <input
                          className="fluid-input text-xl font-bold text-gray-900 dark:text-white placeholder-gray-300"
                          placeholder="输入公司名称"
                          type="text"
                          value={company}
                          onChange={(e) => setCompany(e.target.value)}
                        />
                      </div>
                      <div className="flex-1">
                        <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1 block">担任职位</label>
                        <input
                          className="fluid-input text-xl font-bold text-gray-900 dark:text-white placeholder-gray-300"
                          placeholder="输入职位名称"
                          type="text"
                          value={role}
                          onChange={(e) => setRole(e.target.value)}
                        />
                      </div>
                      <div className="w-full lg:w-auto shrink-0">
                        <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1 block">时间段</label>
                        <div className="flex items-center gap-2">
                          <input
                            className="fluid-input w-24 text-center text-base text-gray-600 dark:text-gray-300"
                            placeholder="YYYY.MM"
                            type="text"
                            value={startDate}
                            onChange={(e) => setStartDate(e.target.value)}
                          />
                          <span className="text-gray-400">-</span>
                          <input
                            className="fluid-input w-24 text-center text-base text-gray-600 dark:text-gray-300"
                            placeholder="至今"
                            type="text"
                            value={endDate}
                            onChange={(e) => setEndDate(e.target.value)}
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="p-6 pt-4 space-y-4 relative animate-in fade-in slide-in-from-top-4 duration-300">
                    {/* STAR Sections - Strict Plain Textareas */}
                    {[
                      { id: 's', label: 'S - 情境 (Situation)', val: situation, set: setSituation, color: 'blue', icon: 'Target', ph: 'Describe the context...' },
                      { id: 't', label: 'T - 任务 (Task)', val: task, set: setTask, color: 'orange', icon: 'Flag', ph: 'What were your goals?' },
                      { id: 'a', label: 'A - 行动 (Action)', val: action, set: setAction, color: 'amber', icon: 'Zap', ph: 'What specifically did you do?' },
                      { id: 'r', label: 'R - 结果 (Result)', val: result, set: setResult, color: 'emerald', icon: 'Trophy', ph: 'Quantifiable outcomes...' },
                    ].map((item, idx) => (
                      <div key={item.id} className="flex gap-4 relative group">
                        {idx !== 3 && <div className="absolute left-[19px] top-10 bottom-0 w-[2px] bg-gray-100 dark:bg-gray-800"></div>}
                        <div className={`shrink-0 w-10 h-10 rounded-full bg-${item.color}-50 dark:bg-${item.color}-900/20 text-${item.color}-600 dark:text-${item.color}-400 flex items-center justify-center ring-4 ring-white dark:ring-surface-dark z-10 font-bold`}>
                          {item.id.toUpperCase()}
                        </div>
                        <div className="flex-1 pt-1 pb-4">
                          <div className="flex items-center justify-between mb-2">
                            <span className={`text-xs font-bold text-${item.color}-600 dark:text-${item.color}-400 uppercase tracking-widest`}>{item.label}</span>
                          </div>
                          <textarea
                            className="w-full bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-lg p-3 text-sm text-gray-700 dark:text-gray-300 focus:ring-2 focus:ring-primary/20 focus:border-primary resize-none leading-relaxed transition-all hover:bg-white dark:hover:bg-gray-800 shadow-sm"
                            rows={item.id === 'a' ? 4 : 2}
                            value={item.val}
                            placeholder={item.ph}
                            onChange={(e) => item.set(e.target.value)}
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="bg-gray-50 dark:bg-gray-800/50 px-6 py-3 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between">
                    <button
                      onClick={handlePolish}
                      disabled={isPolishing}
                      className="flex items-center gap-2 text-sm font-medium text-emerald-600 bg-emerald-50 hover:bg-emerald-100 dark:text-emerald-400 dark:bg-emerald-900/20 dark:hover:bg-emerald-900/30 px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
                    >
                      <Sparkles className="w-4 h-4" />
                      {isPolishing ? 'AI 润色中...' : 'AI 润色'}
                    </button>
                    <div className="flex items-center gap-2">
                      <button
                        className="text-gray-400 hover:text-red-500 transition-colors p-2 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg mr-2"
                        title="删除"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>

                      <button
                        onClick={() => {
                          setExpandedWork(false);
                          // 这里应该添加重置逻辑，目前先简单收起
                        }}
                        className="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white transition-colors text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
                      >
                        取消
                      </button>
                      <button
                        onClick={() => setExpandedWork(false)}
                        className="flex items-center gap-2 text-sm font-medium text-white bg-primary hover:bg-primary-dark px-6 py-2 rounded-lg transition-colors shadow-sm shadow-primary/20"
                      >
                        保存
                        <ChevronUp className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Read-only List Items */}
            <div
              className="group bg-white dark:bg-surface-dark rounded-xl border border-gray-200 dark:border-gray-700 p-5 hover:shadow-md hover:border-primary/50 transition-all duration-200 cursor-pointer"
              onClick={() => handleLoadItem("字节跳动 (ByteDance)", "产品运营实习生", "2020.06", "2020.12")}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-1">
                    <h3 className="font-bold text-gray-900 dark:text-white truncate">字节跳动 (ByteDance)</h3>
                    <span className="text-gray-300 dark:text-gray-600">|</span>
                    <span className="text-gray-700 dark:text-gray-300 font-medium">产品运营实习生</span>
                  </div>
                  <p className="text-sm text-gray-500 dark:text-gray-400 truncate">负责抖音千万级用户增长活动策划，通过数据分析优化投放策略，ROI提升...</p>
                </div>
                <div className="text-right shrink-0">
                  <span className="block text-sm font-mono text-gray-500 mb-2">2020.06 - 2020.12</span>
                  <ChevronDown className="w-5 h-5 text-gray-400 group-hover:text-primary transition-colors ml-auto" />
                </div>
              </div>
            </div>

          </section>

          {/* Education Section */}
          <section className="space-y-6 pt-6 border-t border-gray-200 dark:border-gray-800">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <GraduationCap className="w-5 h-5 text-purple-600" />
                教育经历
                <span className="text-sm font-normal text-gray-400 ml-2">Education</span>
              </h2>
              <span className="text-xs font-mono text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">{educations.length} items</span>
            </div>

            <button
              onClick={handleAddEdu}
              className="w-full group border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-xl p-4 flex items-center justify-center gap-2 text-gray-500 hover:text-purple-600 hover:border-purple-500 hover:bg-purple-50 dark:hover:bg-purple-900/10 transition-all duration-300"
            >
              <div className="p-1 rounded-full bg-gray-200 dark:bg-gray-800 group-hover:bg-white group-hover:text-purple-600 transition-colors">
                <Plus className="w-5 h-5" />
              </div>
              <span className="font-medium">新增教育经历</span>
            </button>

            {/* Editable/New Edu Card */}
            {editingEduId && expandedEdu && (
              <div className="bg-white dark:bg-surface-dark rounded-xl border border-purple-500/30 shadow-lg shadow-purple-500/5 overflow-hidden transition-all duration-300 ring-1 ring-purple-500/10 relative animate-in fade-in slide-in-from-top-4">
                <div className="p-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="flex-1">
                      <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1 block">学校名称</label>
                      <input
                        className="fluid-input text-lg font-bold text-gray-900 dark:text-white placeholder-gray-300 w-full"
                        placeholder="输入学校名称"
                        value={eduSchool}
                        onChange={(e) => setEduSchool(e.target.value)}
                      />
                    </div>
                    <div className="flex-1">
                      <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1 block">专业</label>
                      <input
                        className="fluid-input text-lg font-bold text-gray-900 dark:text-white placeholder-gray-300 w-full"
                        placeholder="输入专业"
                        value={eduMajor}
                        onChange={(e) => setEduMajor(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1 block">学位</label>
                      <input
                        className="fluid-input text-base text-gray-700 dark:text-gray-300 placeholder-gray-300 w-full"
                        placeholder="本科/硕士/博士"
                        value={eduDegree}
                        onChange={(e) => setEduDegree(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1 block">时间段</label>
                      <div className="flex items-center gap-2">
                        <input
                          className="fluid-input w-24 text-center text-base text-gray-600 dark:text-gray-300"
                          placeholder="Start"
                          value={eduStartDate}
                          onChange={(e) => setEduStartDate(e.target.value)}
                        />
                        <span className="text-gray-400">-</span>
                        <input
                          className="fluid-input w-24 text-center text-base text-gray-600 dark:text-gray-300"
                          placeholder="End"
                          value={eduEndDate}
                          onChange={(e) => setEduEndDate(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="md:col-span-2">
                      <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1 block">GPA (可选)</label>
                      <input
                        className="fluid-input text-base text-gray-700 dark:text-gray-300 placeholder-gray-300 w-full"
                        placeholder="例如: 3.8/4.0"
                        value={eduGpa}
                        onChange={(e) => setEduGpa(e.target.value)}
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1 block">主修课程 (可选)</label>
                      <textarea
                        className="w-full bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-lg p-3 text-sm text-gray-700 dark:text-gray-300 focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 resize-none"
                        rows={2}
                        placeholder="列出关键相关课程..."
                        value={eduCourses}
                        onChange={(e) => setEduCourses(e.target.value)}
                      />
                    </div>
                  </div>
                </div>

                <div className="bg-gray-50 dark:bg-gray-800/50 px-6 py-3 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between">
                  <button
                    className="text-gray-400 hover:text-red-500 transition-colors p-2 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg"
                    onClick={() => editingEduId !== 'new' && handleDeleteEdu(editingEduId!)}
                    title="删除"
                    disabled={editingEduId === 'new'}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleCancelEditEdu}
                      className="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white transition-colors text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
                    >
                      取消
                    </button>
                    <button
                      onClick={handleSaveEdu}
                      className="flex items-center gap-2 text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 px-6 py-2 rounded-lg transition-colors shadow-sm shadow-purple-500/20"
                    >
                      保存
                      <ChevronUp className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Edu List Items */}
            {educations.map((edu) => (
              <div
                key={edu.id}
                className="group bg-white dark:bg-surface-dark rounded-xl border border-gray-200 dark:border-gray-700 p-5 hover:shadow-md hover:border-purple-400 transition-all duration-200 cursor-pointer"
                onClick={() => handleEditEdu(edu)}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1">
                      <h3 className="font-bold text-gray-900 dark:text-white truncate">{edu.school}</h3>
                      <span className="text-gray-300 dark:text-gray-600">|</span>
                      <span className="text-gray-700 dark:text-gray-300 font-medium">{edu.major}</span>
                    </div>
                    <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
                      {edu.degree} {edu.gpa ? `• GPA: ${edu.gpa}` : ''} {edu.courses ? `• ${edu.courses}` : ''}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="block text-sm font-mono text-gray-500 mb-2">{edu.startDate} - {edu.endDate}</span>
                    <ChevronDown className="w-5 h-5 text-gray-400 group-hover:text-purple-500 transition-colors ml-auto" />
                  </div>
                </div>
              </div>
            ))}
          </section>

          {/* Certifications Section */}
          <section className="space-y-6 pt-6 border-t border-gray-200 dark:border-gray-800">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <Award className="w-5 h-5 text-amber-500" />
                证书资质
                <span className="text-sm font-normal text-gray-400 ml-2">Certifications</span>
              </h2>
              <span className="text-xs font-mono text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">{certifications.length} items</span>
            </div>

            <button
              onClick={handleAddCert}
              className="w-full group border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-xl p-4 flex items-center justify-center gap-2 text-gray-500 hover:text-amber-600 hover:border-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/10 transition-all duration-300"
            >
              <div className="p-1 rounded-full bg-gray-200 dark:bg-gray-800 group-hover:bg-white group-hover:text-amber-600 transition-colors">
                <Plus className="w-5 h-5" />
              </div>
              <span className="font-medium">新增证书资质</span>
            </button>

            {/* Editable/New Cert Card */}
            {editingCertId && expandedCert && (
              <div className="bg-white dark:bg-surface-dark rounded-xl border border-amber-500/30 shadow-lg shadow-amber-500/5 overflow-hidden transition-all duration-300 ring-1 ring-amber-500/10">
                <div className="p-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="md:col-span-2">
                      <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1 block">证书名称</label>
                      <input
                        className="fluid-input text-lg font-bold text-gray-900 dark:text-white placeholder-gray-300"
                        placeholder="例如: PMP 项目管理专业人士"
                        type="text"
                        value={certName}
                        onChange={(e) => setCertName(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1 block">颁发机构</label>
                      <input
                        className="fluid-input text-base text-gray-700 dark:text-gray-300 placeholder-gray-300"
                        placeholder="例如: PMI"
                        type="text"
                        value={certIssuer}
                        onChange={(e) => setCertIssuer(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1 block">获得时间</label>
                      <input
                        className="fluid-input text-base text-gray-700 dark:text-gray-300 placeholder-gray-300"
                        placeholder="YYYY 或 YYYY.MM"
                        type="text"
                        value={certDate}
                        onChange={(e) => setCertDate(e.target.value)}
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1 block">
                        匹配度 (可选) - {certMatchRate}%
                      </label>
                      <input
                        className="w-full"
                        type="range"
                        min="0"
                        max="100"
                        value={certMatchRate}
                        onChange={(e) => setCertMatchRate(parseInt(e.target.value))}
                      />
                    </div>
                  </div>
                </div>

                <div className="bg-gray-50 dark:bg-gray-800/50 px-6 py-3 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between">
                  <button
                    className="text-gray-400 hover:text-red-500 transition-colors p-2 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg"
                    onClick={() => editingCertId !== 'new' && handleDeleteCert(editingCertId!)}
                    title="删除"
                    disabled={editingCertId === 'new'}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleCancelEditCert}
                      className="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white transition-colors text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
                    >
                      取消
                    </button>
                    <button
                      onClick={handleSaveCert}
                      className="flex items-center gap-2 text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 px-6 py-2 rounded-lg transition-colors shadow-sm shadow-amber-500/20"
                    >
                      保存
                      <ChevronUp className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Cert List Items */}
            {certifications.map((cert) => (
              <div
                key={cert.id}
                className="group bg-white dark:bg-surface-dark rounded-xl border border-gray-200 dark:border-gray-700 p-5 hover:shadow-md hover:border-amber-400 transition-all duration-200 cursor-pointer"
                onClick={() => handleEditCert(cert)}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1">
                      <h3 className="font-bold text-gray-900 dark:text-white truncate">{cert.name}</h3>
                      {cert.matchRate !== undefined && cert.matchRate > 0 && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400">
                          匹配度 {cert.matchRate}%
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-500 dark:text-gray-400 truncate">{cert.issuer}</p>
                  </div>
                  <div className="text-right shrink-0 flex items-center gap-2">
                    <span className="block text-sm font-mono text-gray-500">{cert.date}</span>
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
            ))}
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
                    {skills.map(skill => (
                      <span key={skill} className="group px-3 py-1.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors cursor-default flex items-center gap-1">
                        {skill}
                        <button onClick={() => removeSkill(skill)} className="hidden group-hover:block hover:text-red-500 transition-colors"><X className="w-3 h-3" /></button>
                      </span>
                    ))}
                  </div>

                  <div className="flex gap-2 max-w-sm">
                    <input
                      className="fluid-input text-sm"
                      placeholder="添加新技能 (Add Skill)"
                      value={newSkill}
                      onChange={(e) => setNewSkill(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && addSkill()}
                    />
                    <button onClick={addSkill} className="p-2 text-primary hover:bg-primary/10 rounded-lg transition-colors">
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </section>

        </div>
      </main>
    </div>
  );
};

export default ExperienceBank;
