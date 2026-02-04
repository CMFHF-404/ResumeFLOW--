import React, { useMemo, useRef, useState } from 'react';
import {
    Moon, Sun, Download, LayoutTemplate,
    Target, Wand2, RefreshCw,
    Edit3, Eye, EyeOff, GripVertical, CheckCircle2,
    ChevronDown, ChevronUp, ArrowLeft, Database, User, Award, Wrench, Briefcase, FolderKanban, Plus, Trash2
} from 'lucide-react';
import { type ExperienceListItem } from '../services/experienceService';
import { profileService, Profile } from '../services/profileService';
import { type Certification as CertificationRecord } from '../services/certificationsService';
import { type ResumeDetail, type ResumeExperienceItem } from '../services/resumeService';
import { type UserSkill } from '../services/skillsService';
import ConfirmDialog from '../components/ConfirmDialog';
import MonthPicker from '../components/MonthPicker';
import { ToastContainer, useToast } from '../components/Toast';
import { useExperienceActions } from '../hooks/useExperienceActions';
import { useJDAnalysis } from '../hooks/useJDAnalysis';
import { useResumeData } from '../hooks/useResumeData';
import { MATCH_BADGE_STYLES } from '../constants/resumeConstants';
import { buildExperienceDate, formatYearMonth, normalizeDateInput } from '../utils/dateUtils';
import {
    buildStarFields,
    normalizeStarValue
} from '../utils/resumeHelpers';
import type {
    CertificationEditDraft,
    CertificationView,
    DatePayloadFallback,
    EducationEditDraft,
    EducationView,
    ExperienceEditDraft,
    ProfileSyncMode,
    ResumeEditorConfig,
    ResumeEditorProfile,
    ResumeExperienceView,
    SkillGroupView,
    SkillItemView,
    StarFieldKey,
    StarFields
} from '../types/resume';
import { parseYearMonthValue } from './experienceUtils';
import { mergeLinkedInLink, resolveLinkedInLink } from './profileUtils';

const DEFAULT_EXPERIENCE_TITLE_BY_CATEGORY = {
    work: '新建工作经历',
    project: '新建项目经历',
} as const;
const DEFAULT_EXPERIENCE_COMPANY_BY_CATEGORY = {
    work: '未命名公司',
    project: '未命名项目',
} as const;
const ADD_WORK_EXPERIENCE_LABEL = '添加工作经历';
const ADD_PROJECT_EXPERIENCE_LABEL = '添加项目经历';
const ADD_EDUCATION_LABEL = '添加教育经历';
const ADD_CERTIFICATION_LABEL = '添加证书';
const ADD_SKILL_TYPE_LABEL = '添加技能类型';
const ADD_SKILL_TAG_LABEL = '添加技能标签';
const DELETE_SKILL_CATEGORY_LABEL = '删除技能分类';
const DEFAULT_EDUCATION_SCHOOL = '未命名学校';
const DEFAULT_EDUCATION_MAJOR = '未命名专业';
const DEFAULT_CERTIFICATION_NAME = '未命名证书';
const DEFAULT_SKILL_NAME = '未命名技能';
const DEFAULT_SKILL_CATEGORY = '未分类';
const CONFIRM_DELETE_EXPERIENCE_TEXT = '确定删除该经历吗？删除后将从经历库移除。';
const CONFIRM_DELETE_EDUCATION_TEXT = '确定删除该教育经历吗？删除后将无法恢复。';
const CONFIRM_DELETE_CERTIFICATION_TEXT = '确定删除该证书吗？删除后将无法恢复。';
const CONFIRM_DELETE_SKILL_TEXT = '确定删除该技能吗？删除后将无法恢复。';
const CONFIRM_DELETE_SKILL_CATEGORY_TEXT = '确定删除该技能分类及其全部技能吗？删除后将无法恢复。';
const CONFIRM_DELETE_EXPERIENCE_TITLE = '删除经历';
const CONFIRM_DELETE_EDUCATION_TITLE = '删除教育经历';
const CONFIRM_DELETE_CERTIFICATION_TITLE = '删除证书';
const CONFIRM_DELETE_SKILL_TITLE = '删除技能';
const CONFIRM_DELETE_SKILL_CATEGORY_TITLE = '删除技能分类';
const AUTO_SAVE_DELAY_MS = 800;
const CERT_META_PREFIX = "__rf_cert_meta__:";
const EXPERIENCE_DRAFT_PREFIX = 'draft-exp';
const EDUCATION_DRAFT_PREFIX = 'draft-edu';
const CERTIFICATION_DRAFT_PREFIX = 'draft-cert';
const EXPERIENCE_CATEGORY_ORDER: Array<ResumeExperienceView['category']> = ['work', 'project'];
const DEFAULT_SECTION_ORDER = ['summary', 'work', 'project', 'education', 'certifications', 'skills'] as const;
const RESUME_SECTION_IDS = new Set<string>(DEFAULT_SECTION_ORDER);
const SIDEBAR_WIDTH_CLASS = 'w-[600px]';
const JD_PANEL_BOTTOM_SPACING_CLASS = 'mb-3';
const SMART_PAGE_MIN_SCALE = 0.86;
const SMART_PAGE_HEIGHT_TOLERANCE = 12;
const SMART_PAGE_TOAST_MESSAGES = {
    success: '已自动调整为一页',
    overflow: '内容过多，无法压缩到一页',
} as const;
const DEFAULT_MATCH_BADGE_TONE: keyof typeof MATCH_BADGE_STYLES = 'emerald';
const JD_PANEL_STICKY_CLASS = 'sticky top-0 z-20';
const EDITING_SUGGESTION_NAV_CLASS = 'border-t border-border-light dark:border-border-dark bg-white dark:bg-surface-dark px-4 py-2';
const STALE_EXPERIENCE_TIP = '该经历已更新，建议重新分析';
const PROFILE_SYNC_MODES = {
    global: 'global',
    local: 'local',
} as const;

const DEFAULT_PROFILE: ResumeEditorProfile = {
    name: '',
    email: '',
    phone: '',
    location: '',
    linkedin: '',
    summary: '',
};

const normalizeJobKeywords = (keywords?: string[]): string[] => {
    return (keywords || [])
        .map((keyword) => keyword.trim())
        .filter(Boolean);
};

const mergeStarFields = (base: StarFields, updates: Partial<StarFields>) => ({
    s: typeof updates.s === 'string' ? updates.s : base.s,
    t: typeof updates.t === 'string' ? updates.t : base.t,
    a: typeof updates.a === 'string' ? updates.a : base.a,
    r: typeof updates.r === 'string' ? updates.r : base.r,
});

const normalizeEducationStar = (star?: Record<string, any>) => ({
    degree: normalizeStarValue(star?.degree),
    gpa: normalizeStarValue(star?.gpa),
    courses: normalizeStarValue(star?.courses),
});

const isPresentLabel = (value?: string) => value === '至今' || value === 'Present';

const resolveSafeDateRange = (start: string, end: string) => {
    const startValue = parseYearMonthValue(start);
    const endValue = parseYearMonthValue(end);
    if (startValue !== null && endValue !== null && startValue > endValue) {
        return { start, end: '' };
    }
    return { start, end };
};


const resolveDatePayload = (
    startDate: string,
    endDate: string,
    baseIsCurrent: boolean,
    fallback?: DatePayloadFallback
) => {
    const normalizedStart = normalizeDateInput(startDate);
    const normalizedEnd = normalizeDateInput(endDate);
    const resolvedIsCurrent = isPresentLabel(endDate) || (baseIsCurrent && !normalizedEnd);
    return {
        startDate: normalizedStart ?? fallback?.start_date,
        endDate: resolvedIsCurrent ? undefined : normalizedEnd ?? fallback?.end_date,
        isCurrent: resolvedIsCurrent,
    };
};

const resolveExperienceDatePayload = (
    draft: ExperienceEditDraft,
    fallback?: DatePayloadFallback
) => {
    const baseIsCurrent = draft.isCurrent ?? fallback?.is_current ?? false;
    return resolveDatePayload(draft.startDate, draft.endDate, baseIsCurrent, fallback);
};

const resolveEducationDatePayload = (
    draft: EducationEditDraft,
    fallback?: DatePayloadFallback
) => {
    const baseIsCurrent = fallback?.is_current ?? false;
    return resolveDatePayload(draft.startDate, draft.endDate, baseIsCurrent, fallback);
};

const buildEducationView = (item: ExperienceListItem): EducationView => {
    const latest = item.latest_version;
    const star = normalizeEducationStar(latest?.star);
    const isCurrent = latest?.is_current ?? false;
    return {
        id: item.master.id,
        school: latest?.org || '',
        major: latest?.title || '',
        degree: star.degree || '',
        startDate: formatYearMonth(latest?.start_date),
        endDate: formatYearMonth(latest?.end_date),
        isCurrent,
        gpa: star.gpa || undefined,
        courses: star.courses || undefined,
    };
};

const buildDraftEducationView = (draftId: string, draft: EducationEditDraft): EducationView => ({
    id: draftId,
    school: draft.school,
    major: draft.major,
    degree: draft.degree,
    startDate: draft.startDate,
    endDate: draft.endDate,
    isCurrent: isPresentLabel(draft.endDate),
    gpa: draft.gpa || undefined,
    courses: draft.courses || undefined,
    isDraft: true,
});

const buildEducationDraft = (
    source?: ExperienceListItem,
    draftId?: string
): EducationEditDraft => {
    const latest = source?.latest_version;
    const star = normalizeEducationStar(latest?.star);
    const endDate = latest?.is_current ? '至今' : (latest?.end_date || '');
    return {
        id: draftId ?? source?.master.id,
        school: latest?.org || DEFAULT_EDUCATION_SCHOOL,
        major: latest?.title || DEFAULT_EDUCATION_MAJOR,
        degree: star.degree || '',
        startDate: latest?.start_date || '',
        endDate,
        gpa: star.gpa || '',
        courses: star.courses || '',
    };
};

const buildCertificationDraft = (source?: CertificationRecord): CertificationEditDraft => ({
    id: source?.id,
    name: source?.name || DEFAULT_CERTIFICATION_NAME,
    issuer: source?.issuer || '',
    issueDate: source?.issue_date || '',
});

const buildDraftCertificationView = (
    draftId: string,
    draft: CertificationEditDraft
): CertificationView => ({
    id: draftId,
    name: draft.name,
    issuer: draft.issuer,
    date: formatYearMonth(draft.issueDate),
    isDraft: true,
});

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

const buildCertificationView = (cert: CertificationRecord): CertificationView => ({
    id: cert.id,
    name: cert.name || '',
    issuer: cert.issuer || '',
    date: formatYearMonth(cert.issue_date),
    matchRate: parseCertificationMatchRate(cert.description),
});

const buildEducationVersionPayload = (
    source: ExperienceListItem | null,
    draft: EducationEditDraft
) => {
    const latest = source?.latest_version;
    const dates = resolveEducationDatePayload(draft, latest);
    return {
        title: draft.major.trim() || DEFAULT_EDUCATION_MAJOR,
        org: draft.school.trim() || DEFAULT_EDUCATION_SCHOOL,
        location: latest?.location,
        start_date: dates.startDate,
        end_date: dates.endDate,
        is_current: dates.isCurrent,
        summary: latest?.summary,
        highlights: latest?.highlights || [],
        tags: latest?.tags || [],
        star: {
            ...(latest?.star || {}),
            degree: draft.degree,
            gpa: draft.gpa,
            courses: draft.courses,
        },
    };
};

const buildCertificationPayload = (draft: CertificationEditDraft) => ({
    name: draft.name.trim() || DEFAULT_CERTIFICATION_NAME,
    issuer: draft.issuer.trim() || undefined,
    issue_date: normalizeDateInput(draft.issueDate),
});

const resolveSkillCategoryName = (category?: string) => {
    const trimmed = (category || '').trim();
    return trimmed || DEFAULT_SKILL_CATEGORY;
};

const buildSkillGroups = (skills: UserSkill[]): SkillGroupView[] => {
    const groups: SkillGroupView[] = [];
    const index = new Map<string, SkillGroupView>();
    skills.forEach((skill) => {
        const name = resolveSkillCategoryName(skill.category);
        let group = index.get(name);
        if (!group) {
            group = { name, skills: [] };
            index.set(name, group);
            groups.push(group);
        }
        group.skills.push({ id: skill.id, name: skill.name });
    });
    return groups;
};

const buildResumeExperienceMap = (detail: ResumeDetail | null) => {
    const map = new Map<string, ResumeExperienceItem>();
    if (!detail?.experiences) {
        return map;
    }
    detail.experiences.forEach((item) => {
        map.set(item.experience.master_experience_id, item);
    });
    return map;
};

const buildSourceMap = (items: ExperienceListItem[]) => {
    return new Map(items.map((item) => [item.master.id, item]));
};

const buildResumeExperienceView = (
    item: ExperienceListItem,
    resumeItem?: ResumeExperienceItem
): ResumeExperienceView => {
    const latest = item.latest_version;
    const snapshot = resumeItem?.experience;
    const title = snapshot?.title ?? latest?.title ?? '';
    const company = snapshot?.org ?? latest?.org ?? '';
    const startDate = snapshot?.start_date ?? latest?.start_date;
    const endDate = snapshot?.end_date ?? latest?.end_date;
    const isCurrent = snapshot?.is_current ?? latest?.is_current ?? false;
    const star = buildStarFields(snapshot?.star ?? latest?.star);
    return {
        id: item.master.id,
        title,
        company,
        date: buildExperienceDate(startDate, endDate, isCurrent),
        startDate,
        endDate,
        isCurrent,
        star,
        resumeLinkId: resumeItem?.id,
        experienceVersionId: resumeItem?.experience_version_id ?? latest?.id,
        category: item.master.category as 'work' | 'project',
    };
};

const buildDraftExperienceView = (
    category: ResumeExperienceView['category'],
    draftId: string
): ResumeExperienceView => ({
    id: draftId,
    title: DEFAULT_EXPERIENCE_TITLE_BY_CATEGORY[category],
    company: DEFAULT_EXPERIENCE_COMPANY_BY_CATEGORY[category],
    date: '',
    startDate: '',
    endDate: '',
    isCurrent: false,
    star: buildStarFields(),
    category,
    isDraft: true,
});

const buildExperienceEditDraft = (item: ResumeExperienceView): ExperienceEditDraft => ({
    masterId: item.id,
    title: item.title,
    company: item.company,
    startDate: item.startDate ?? '',
    endDate: item.isCurrent ? '至今' : item.endDate ?? '',
    isCurrent: item.isCurrent,
    star: { ...item.star },
    category: item.category,
    isDraft: item.isDraft,
});

const sortByCategory = (
    items: ResumeExperienceView[],
    compare: (a: ResumeExperienceView, b: ResumeExperienceView) => number
) => {
    return EXPERIENCE_CATEGORY_ORDER.flatMap((category) =>
        [...items].filter((item) => item.category === category).sort(compare)
    );
};

const compareByDateDesc = (a: ResumeExperienceView, b: ResumeExperienceView) => {
    const valA = parseYearMonthValue(a.startDate) ?? -1;
    const valB = parseYearMonthValue(b.startDate) ?? -1;
    return valB - valA;
};

const buildProfileFromService = (profile?: Profile | null): ResumeEditorProfile | null => {
    if (!profile) {
        return null;
    }
    return {
        name: profile.full_name || '',
        email: profile.email || '',
        phone: profile.phone || '',
        location: profile.location || '',
        linkedin: resolveLinkedInLink(profile),
        summary: profile.summary || '',
    };
};

const isSameProfileSnapshot = (
    base?: ResumeEditorProfile | null,
    other?: ResumeEditorProfile | null
) => {
    if (!base || !other) {
        return false;
    }
    return base.name === other.name
        && base.email === other.email
        && base.phone === other.phone
        && base.location === other.location
        && base.linkedin === other.linkedin
        && base.summary === other.summary;
};

const resolveProfileSyncMode = (
    config?: ResumeEditorConfig,
    profile?: Profile | null
): ProfileSyncMode => {
    const mode = config?.profileSyncMode;
    if (mode === PROFILE_SYNC_MODES.global || mode === PROFILE_SYNC_MODES.local) {
        return mode;
    }
    if (!config?.profile) {
        return PROFILE_SYNC_MODES.global;
    }
    const serviceProfile = buildProfileFromService(profile);
    if (serviceProfile && isSameProfileSnapshot(config.profile, serviceProfile)) {
        return PROFILE_SYNC_MODES.global;
    }
    return PROFILE_SYNC_MODES.local;
};

const resolveProfileSnapshot = (config?: ResumeEditorConfig, profile?: Profile | null) => {
    const syncMode = resolveProfileSyncMode(config, profile);
    const configProfile = config?.profile;
    const serviceProfile = buildProfileFromService(profile);
    if (syncMode === PROFILE_SYNC_MODES.local) {
        if (configProfile) {
            return {
                ...DEFAULT_PROFILE,
                ...configProfile,
            };
        }
        return serviceProfile ?? DEFAULT_PROFILE;
    }
    if (serviceProfile) {
        return serviceProfile;
    }
    if (configProfile) {
        return {
            ...DEFAULT_PROFILE,
            ...configProfile,
        };
    }
    return DEFAULT_PROFILE;
};

const resolveSelectionSet = (ids?: Array<string | number>) => {
    return new Set((ids || []).map((value) => String(value)).filter(Boolean));
};

const buildResumeConfigSnapshot = (
    profile: ResumeEditorProfile,
    profileSyncMode: ProfileSyncMode,
    selectedExpIds: Set<string>,
    selectedEduIds: Set<string>,
    selectedCertIds: Set<string>,
    selectedSkillIds: Set<string>,
    sectionOrder: string[],
    density: 'compact' | 'standard' | 'spacious'
): ResumeEditorConfig => ({
    profile: profileSyncMode === PROFILE_SYNC_MODES.local ? { ...profile } : undefined,
    profileSyncMode,
    selection: {
        experienceIds: Array.from(selectedExpIds),
        educationIds: Array.from(selectedEduIds),
        certificationIds: Array.from(selectedCertIds),
        skillIds: Array.from(selectedSkillIds),
    },
    layout: {
        sectionOrder: [...sectionOrder],
        density,
    },
});

const normalizeSectionOrder = (order?: string[]) => {
    const filtered = (order || []).filter((sectionId) => RESUME_SECTION_IDS.has(sectionId));
    const unique: string[] = [];
    filtered.forEach((sectionId) => {
        if (!unique.includes(sectionId)) {
            unique.push(sectionId);
        }
    });
    DEFAULT_SECTION_ORDER.forEach((sectionId) => {
        if (!unique.includes(sectionId)) {
            unique.push(sectionId);
        }
    });
    return unique.length ? unique : [...DEFAULT_SECTION_ORDER];
};

const getA4PixelHeight = () => {
    const probe = document.createElement('div');
    probe.style.height = '297mm';
    probe.style.position = 'absolute';
    probe.style.visibility = 'hidden';
    document.body.appendChild(probe);
    const height = probe.getBoundingClientRect().height;
    document.body.removeChild(probe);
    return height;
};

const resolveScaleForHeight = (contentHeight: number, a4Height: number) => {
    if (contentHeight <= a4Height) {
        return 1;
    }
    return Math.max(SMART_PAGE_MIN_SCALE, a4Height / contentHeight);
};

const ResumeEditor: React.FC = () => {
    const [isDarkMode, setIsDarkMode] = useState(false);
    const [resumeScale, setResumeScale] = useState(1);

    // 1. Profile State
    const [profile, setProfile] = useState<ResumeEditorProfile>(DEFAULT_PROFILE);
    const [profileSyncMode, setProfileSyncMode] = useState<ProfileSyncMode>(PROFILE_SYNC_MODES.global);
    const [profileSocialLinks, setProfileSocialLinks] = useState<Record<string, any>>({});
    const [isEditingProfile, setIsEditingProfile] = useState(false);
    const [isSavingProfile, setIsSavingProfile] = useState(false);
    const [originalProfile, setOriginalProfile] = useState<ResumeEditorProfile>(DEFAULT_PROFILE);
    const [originalProfileSyncMode, setOriginalProfileSyncMode] = useState<ProfileSyncMode>(
        PROFILE_SYNC_MODES.global
    );

    // 教育背景状态
    const [educations, setEducations] = useState<EducationView[]>([]);
    const [educationSourceMap, setEducationSourceMap] = useState<Map<string, ExperienceListItem>>(
        new Map()
    );

    // 证书与技能状态
    const [certifications, setCertifications] = useState<CertificationView[]>([]);
    const [certificationSourceMap, setCertificationSourceMap] = useState<Map<string, CertificationRecord>>(
        new Map()
    );
    const [skillGroups, setSkillGroups] = useState<SkillGroupView[]>([]);

    // 教育背景/证书/技能选择状态
    const [selectedEduIds, setSelectedEduIds] = useState<Set<string>>(new Set());
    const [selectedCertIds, setSelectedCertIds] = useState<Set<string>>(new Set());
    const [selectedSkillIds, setSelectedSkillIds] = useState<Set<string>>(new Set());

    // 2. Experience State
    const [experienceItems, setExperienceItems] = useState<ResumeExperienceView[]>([]);
    const [selectedExpIds, setSelectedExpIds] = useState<Set<string>>(new Set());
    // 3. UI State
    const [sidebarTab, setSidebarTab] = useState<'profile' | 'experience'>('experience');
    const [density, setDensity] = useState<'compact' | 'standard' | 'spacious'>('standard');
    const { toasts, success: showToastSuccess, error: showToastError, closeToast } = useToast();

    // Drag & Drop State
    const [draggedItemId, setDraggedItemId] = useState<string | null>(null);

    // Section Order State (for draggable resume sections)
    const [sectionOrder, setSectionOrder] = useState<string[]>(
        () => [...DEFAULT_SECTION_ORDER]
    );
    const [draggedSectionId, setDraggedSectionId] = useState<string | null>(null);
    const previewRef = useRef<HTMLDivElement | null>(null);
    const a4HeightRef = useRef<number | null>(null);
    const resumeConfigSnapshot = useMemo(
        () =>
            buildResumeConfigSnapshot(
                profile,
                profileSyncMode,
                selectedExpIds,
                selectedEduIds,
                selectedCertIds,
                selectedSkillIds,
                sectionOrder,
                density
            ),
        [density, profile, profileSyncMode, sectionOrder, selectedCertIds, selectedEduIds, selectedExpIds, selectedSkillIds]
    );
    const {
        resumeId,
        resumeExperienceMap,
        experienceSourceMap,
        setResumeExperienceMap,
        setExperienceSourceMap,
        isLoadingExperiences,
        saveState,
        lastSavedAt,
        applyResumeDetail,
    } = useResumeData({
        configSnapshot: resumeConfigSnapshot,
        autoSaveDelayMs: AUTO_SAVE_DELAY_MS,
        setProfile,
        setProfileSyncMode,
        setProfileSocialLinks,
        setSectionOrder,
        setDensity,
        setExperienceItems,
        setSelectedExpIds,
        setEducations,
        setEducationSourceMap,
        setSelectedEduIds,
        setCertifications,
        setCertificationSourceMap,
        setSelectedCertIds,
        setSkillGroups,
        setSelectedSkillIds,
        buildResumeExperienceMap,
        buildSourceMap,
        buildResumeExperienceView,
        buildEducationView,
        buildCertificationView,
        buildSkillGroups,
        resolveSelectionSet,
        normalizeSectionOrder,
        resolveProfileSyncMode,
        resolveProfileSnapshot,
        sortByCategory,
        compareByDateDesc,
    });
    const {
        jdText,
        setJdText,
        analysisResult,
        isAnalyzing,
        isJDCollapsed,
        setIsJDCollapsed,
        staleExperienceIds,
        certificationMatchScores,
        setCertificationMatchScores,
        skillMatchScores,
        setSkillMatchScores,
        handleAnalyze,
    } = useJDAnalysis({
        resumeId,
        experienceItems,
        setExperienceItems,
        certifications,
        skillGroups,
        isLoadingExperiences,
    });
    const {
        confirmDialog,
        handleConfirmDelete,
        handleCancelDelete,
        experience: {
            editingExpId,
            editingDraft,
            syncToMaster,
            setSyncToMaster,
            isSavingExperience,
            isAddingExperience,
            isPolishing,
            deletingExperienceIds,
            handleAddExperience,
            startEditingExperience,
            cancelEditingExperience,
            updateEditingStar,
            updateEditingMeta,
            updateEditingDate,
            handleSaveExperience,
            handlePolishWithJD,
            requestDeleteExperience,
        },
        education: {
            editingEducationId,
            educationDraft,
            isSavingEducation,
            deletingEducationIds,
            beginCreateEducation,
            beginEditEducation,
            cancelEducationEdit,
            updateEducationDraft,
            updateEducationDate,
            handleSaveEducation,
            requestDeleteEducation,
        },
        certification: {
            editingCertificationId,
            certificationDraft,
            isSavingCertification,
            deletingCertificationIds,
            beginCreateCertification,
            beginEditCertification,
            cancelCertificationEdit,
            updateCertificationDraft,
            handleSaveCertification,
            requestDeleteCertification,
        },
        skill: {
            editingSkillId,
            skillDraft,
            skillDraftContext,
            isSavingSkill,
            deletingSkillIds,
            deletingSkillCategories,
            renamingCategoryTarget,
            renamingCategoryDraft,
            setRenamingCategoryTarget,
            setRenamingCategoryDraft,
            beginCreateSkillType,
            beginCreateSkillInGroup,
            beginEditSkill,
            cancelSkillEdit,
            updateSkillDraft,
            handleSaveSkill,
            handleRenameCategory,
            requestDeleteSkill,
            requestDeleteSkillCategory,
        },
        selection: {
            toggleExperienceSelection,
            toggleEducationSelection,
            toggleCertificationSelection,
            toggleSkillSelection,
        },
    } = useExperienceActions({
        resumeId,
        jdText,
        applyResumeDetail,
        experience: {
            items: experienceItems,
            setItems: setExperienceItems,
            selectedIds: selectedExpIds,
            setSelectedIds: setSelectedExpIds,
            resumeMap: resumeExperienceMap,
            setResumeMap: setResumeExperienceMap,
            sourceMap: experienceSourceMap,
            setSourceMap: setExperienceSourceMap,
        },
        education: {
            items: educations,
            setItems: setEducations,
            selectedIds: selectedEduIds,
            setSelectedIds: setSelectedEduIds,
            sourceMap: educationSourceMap,
            setSourceMap: setEducationSourceMap,
        },
        certification: {
            items: certifications,
            setItems: setCertifications,
            selectedIds: selectedCertIds,
            setSelectedIds: setSelectedCertIds,
            sourceMap: certificationSourceMap,
            setSourceMap: setCertificationSourceMap,
        },
        skill: {
            groups: skillGroups,
            setGroups: setSkillGroups,
            selectedIds: selectedSkillIds,
            setSelectedIds: setSelectedSkillIds,
        },
        jdMatch: {
            setCertificationMatchScores,
            setSkillMatchScores,
        },
        helpers: {
            buildResumeExperienceView,
            buildDraftExperienceView,
            buildExperienceEditDraft,
            buildResumeExperienceMap,
            buildExperienceDate,
            buildStarFields,
            mergeStarFields,
            resolveExperienceDatePayload,
            resolveEducationDatePayload,
            resolveSafeDateRange,
            isPresentLabel,
            sortByCategory,
            compareByDateDesc,
            buildEducationDraft,
            buildDraftEducationView,
            buildEducationView,
            buildEducationVersionPayload,
            buildCertificationDraft,
            buildDraftCertificationView,
            buildCertificationView,
            buildCertificationPayload,
            buildSkillGroups,
        },
        defaults: {
            experienceTitleByCategory: DEFAULT_EXPERIENCE_TITLE_BY_CATEGORY,
            experienceCompanyByCategory: DEFAULT_EXPERIENCE_COMPANY_BY_CATEGORY,
            skillName: DEFAULT_SKILL_NAME,
            skillCategory: DEFAULT_SKILL_CATEGORY,
        },
        confirmCopy: {
            experience: {
                title: CONFIRM_DELETE_EXPERIENCE_TITLE,
                description: CONFIRM_DELETE_EXPERIENCE_TEXT,
            },
            education: {
                title: CONFIRM_DELETE_EDUCATION_TITLE,
                description: CONFIRM_DELETE_EDUCATION_TEXT,
            },
            certification: {
                title: CONFIRM_DELETE_CERTIFICATION_TITLE,
                description: CONFIRM_DELETE_CERTIFICATION_TEXT,
            },
            skill: {
                title: CONFIRM_DELETE_SKILL_TITLE,
                description: CONFIRM_DELETE_SKILL_TEXT,
            },
            skillCategory: {
                title: CONFIRM_DELETE_SKILL_CATEGORY_TITLE,
                description: CONFIRM_DELETE_SKILL_CATEGORY_TEXT,
            },
        },
        draftPrefixes: {
            experience: EXPERIENCE_DRAFT_PREFIX,
            education: EDUCATION_DRAFT_PREFIX,
            certification: CERTIFICATION_DRAFT_PREFIX,
        },
    });
    const jobKeywords = useMemo(
        () => normalizeJobKeywords(analysisResult?.jobKeywords),
        [analysisResult]
    );
    const isProfileReadOnly = !isEditingProfile || isSavingProfile;
    const toggleTheme = () => {
        setIsDarkMode(!isDarkMode);
        document.documentElement.classList.toggle('dark');
    };

    const beginProfileEdit = () => {
        setOriginalProfile({ ...profile });
        setOriginalProfileSyncMode(profileSyncMode);
        setIsEditingProfile(true);
    };

    const cancelProfileEdit = () => {
        setProfile({ ...originalProfile });
        setProfileSyncMode(originalProfileSyncMode);
        setIsEditingProfile(false);
    };

    const handleSaveProfile = async () => {
        if (isSavingProfile) {
            return;
        }
        setIsSavingProfile(true);
        try {
            let nextProfile = { ...profile };
            if (profileSyncMode === PROFILE_SYNC_MODES.global) {
                const nextSocialLinks = mergeLinkedInLink(profileSocialLinks, profile.linkedin);
                const updated = await profileService.updateProfile({
                    full_name: profile.name,
                    email: profile.email,
                    phone: profile.phone,
                    location: profile.location,
                    summary: profile.summary,
                    social_links: nextSocialLinks,
                });
                setProfileSocialLinks({ ...(updated.social_links || nextSocialLinks) });
                const updatedSnapshot = buildProfileFromService(updated);
                if (updatedSnapshot) {
                    nextProfile = updatedSnapshot;
                    setProfile(updatedSnapshot);
                }
            }
            setOriginalProfile({ ...nextProfile });
            setOriginalProfileSyncMode(profileSyncMode);
            setIsEditingProfile(false);
        } catch (error) {
            console.error('[ResumeEditor] 保存个人信息失败:', error);
        } finally {
            setIsSavingProfile(false);
        }
    };

    const resetRenamingCategory = () => {
        setRenamingCategoryTarget(null);
        setRenamingCategoryDraft('');
    };

    const adjustToSinglePage = () => {
        const preview = previewRef.current;
        if (!preview) {
            return;
        }
        if (!a4HeightRef.current) {
            a4HeightRef.current = getA4PixelHeight();
        }
        const a4Height = a4HeightRef.current;
        if (!a4Height) {
            return;
        }
        const contentHeight = preview.scrollHeight;
        if (contentHeight <= a4Height + SMART_PAGE_HEIGHT_TOLERANCE) {
            setResumeScale(1);
            showToastSuccess(SMART_PAGE_TOAST_MESSAGES.success);
            return;
        }
        const requiredScale = a4Height / contentHeight;
        if (requiredScale < SMART_PAGE_MIN_SCALE) {
            setResumeScale(SMART_PAGE_MIN_SCALE);
            showToastError(SMART_PAGE_TOAST_MESSAGES.overflow);
            return;
        }
        setResumeScale(requiredScale);
        showToastSuccess(SMART_PAGE_TOAST_MESSAGES.success);
    };

    const handleDragStart = (e: React.DragEvent, id: string) => {
        setDraggedItemId(id);
        e.dataTransfer.effectAllowed = 'move';
    };

    const handleDragOver = (e: React.DragEvent, id: string) => {
        e.preventDefault();
        if (draggedItemId === null || draggedItemId === id) return;

        // Simple reorder logic
        const draggedIndex = experienceItems.findIndex(i => i.id === draggedItemId);
        const hoverIndex = experienceItems.findIndex(i => i.id === id);

        const newItems = [...experienceItems];
        const [draggedItem] = newItems.splice(draggedIndex, 1);
        newItems.splice(hoverIndex, 0, draggedItem);

        setExperienceItems(newItems);
    };

    const clearDragState = () => {
        setDraggedItemId(null);
        setDraggedSectionId(null);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        clearDragState();
    };

    // Section drag handlers
    const handleSectionDragStart = (e: React.DragEvent, sectionId: string) => {
        setDraggedSectionId(sectionId);
        e.dataTransfer.effectAllowed = 'move';
    };

    const handleSectionDragOver = (e: React.DragEvent, sectionId: string) => {
        e.preventDefault();
        if (!draggedSectionId || draggedSectionId === sectionId) return;

        const draggedIndex = sectionOrder.indexOf(draggedSectionId);
        const hoverIndex = sectionOrder.indexOf(sectionId);

        const newOrder = [...sectionOrder];
        const [removed] = newOrder.splice(draggedIndex, 1);
        newOrder.splice(hoverIndex, 0, removed);

        setSectionOrder(newOrder);
    };

    const handleSectionDrop = () => {
        clearDragState();
    };

    const editingItem = experienceItems.find(i => i.id === editingExpId);

    // Spacing classes based on density
    const spacingClass = {
        compact: 'mb-2',
        standard: 'mb-6',
        spacious: 'mb-8'
    }[density];

    const listSpacingClass = {
        compact: 'space-y-1.5',
        standard: 'space-y-4',
        spacious: 'space-y-6'
    }[density];

    const workItems = useMemo(
        () => experienceItems.filter((item) => item.category === 'work'),
        [experienceItems]
    );
    const projectItems = useMemo(
        () => experienceItems.filter((item) => item.category === 'project'),
        [experienceItems]
    );
    const selectedWorkItems = useMemo(
        () => workItems.filter((item) => selectedExpIds.has(item.id)),
        [selectedExpIds, workItems]
    );
    const selectedProjectItems = useMemo(
        () => projectItems.filter((item) => selectedExpIds.has(item.id)),
        [projectItems, selectedExpIds]
    );
    const sortedCertifications = useMemo(() => {
        return [...certifications].sort((a, b) => {
            const valA = parseYearMonthValue(a.date) ?? -1;
            const valB = parseYearMonthValue(b.date) ?? -1;
            return valB - valA;
        });
    }, [certifications]);

    const selectedSkillGroups = useMemo(() => {
        return skillGroups
            .map((group) => ({
                name: group.name,
                skills: group.skills
                    .filter((skill) => selectedSkillIds.has(skill.id))
                    .map((skill) => skill.name),
            }))
            .filter((group) => group.skills.length > 0);
    }, [skillGroups, selectedSkillIds]);

    const renderExperienceSection = (
        sectionId: 'work' | 'project',
        title: string,
        items: ResumeExperienceView[]
    ) => {
        if (!items.length) {
            return null;
        }
        return (
            <div
                key={sectionId}
                id={sectionId}
                className={`${spacingClass} scroll-mt-20 relative group cursor-move`}
                draggable
                onDragStart={(e) => handleSectionDragStart(e, sectionId)}
                onDragOver={(e) => handleSectionDragOver(e, sectionId)}
                onDrop={handleSectionDrop}
            >
                <div className="absolute -left-6 top-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <GripVertical className="w-4 h-4 text-primary cursor-move" />
                </div>

                <h2 className="text-xs font-bold uppercase tracking-widest text-primary border-b border-gray-200 pb-1 mb-3">{title}</h2>
                <div className={listSpacingClass}>
                    {items.map(item => (
                        <div
                            key={item.id}
                            className="relative group/item cursor-move"
                            draggable
                            onDragStart={(e) => { e.stopPropagation(); handleDragStart(e, item.id); }}
                            onDragOver={(e) => { e.stopPropagation(); handleDragOver(e, item.id); }}
                            onDrop={(e) => { e.stopPropagation(); handleDrop(e); }}
                        >
                            <div className="absolute -left-6 top-0 flex flex-col gap-1 opacity-0 group-hover/item:opacity-100 transition-opacity">
                                <GripVertical className="w-3.5 h-3.5 text-gray-400 cursor-move" />
                                <Edit3
                                    className="w-3.5 h-3.5 text-gray-400 cursor-pointer hover:text-primary"
                                    onClick={(e) => { e.stopPropagation(); setSidebarTab('experience'); startEditingExperience(item.id); }}
                                />
                            </div>

                            <div className="group-hover/item:bg-primary/5 -m-2 p-2 rounded transition-colors">
                                <div className="flex justify-between items-baseline mb-1">
                                    <h3 className="text-sm font-bold text-gray-900">{item.company}</h3>
                                    <span className="text-xs font-medium text-gray-600">{item.date}</span>
                                </div>
                                <p className="text-xs font-semibold text-gray-800 mb-1.5">{item.title}</p>

                                <ul className="list-disc list-outside ml-4 text-xs text-gray-700 space-y-1.5 leading-relaxed">
                                    {item.star?.s && <li><span className="font-semibold text-gray-900">S:</span> {item.star.s}</li>}
                                    {item.star?.t && <li><span className="font-semibold text-gray-900">T:</span> {item.star.t}</li>}
                                    {item.star?.a && (
                                        <li>
                                            <span className="font-semibold text-gray-900">A:</span>
                                            <span className="whitespace-pre-line block mt-1">{item.star.a}</span>
                                        </li>
                                    )}
                                    {item.star?.r && <li><span className="font-semibold text-gray-900">R:</span> {item.star.r}</li>}
                                </ul>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        );
    };

    const renderExperienceSectionHeader = (
        title: string,
        icon?: React.ReactNode,
        action?: { label: string; onClick: () => void }
    ) => (
        <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
                {icon}
                <h4 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    {title}
                </h4>
            </div>
            {action ? (
                <button
                    onClick={action.onClick}
                    disabled={isAddingExperience}
                    title={action.label}
                    aria-label={action.label}
                    className="flex items-center justify-center text-gray-500 hover:text-primary p-1 rounded-md hover:bg-primary/5 disabled:opacity-60"
                >
                    <Plus className="w-3.5 h-3.5" />
                </button>
            ) : null}
        </div>
    );

    const renderExperienceCard = (
        item: ResumeExperienceView,
        themeStyles: {
            borderSelected: string;
            ringSelected: string;
            checkboxtext: string;
            checkboxFocus: string;
            editHoverData: string;
            titleSelected: string;
        }
    ) => {
        const isSelected = selectedExpIds.has(item.id);
        return (
            <div
                key={item.id}
                onClick={() => toggleExperienceSelection(item.id)}
                className={`bg-white dark:bg-gray-800 border rounded-xl p-3 shadow-sm transition-all group relative cursor-pointer ${isSelected ? `${themeStyles.borderSelected} ring-1 ${themeStyles.ringSelected}` : 'border-gray-200 dark:border-gray-700 opacity-70 hover:opacity-100'}`}
            >
                <div className="flex items-start gap-3">
                    <div className="pt-1">
                        <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleExperienceSelection(item.id)}
                            onClick={(event) => event.stopPropagation()}
                            className={`w-4 h-4 rounded border-gray-300 ${themeStyles.checkboxtext} ${themeStyles.checkboxFocus} cursor-pointer`}
                        />
                    </div>
                    <div className="flex-1">
                        <div className="flex justify-between items-start">
                            <div>
                                <h4 className={`font-bold text-sm ${isSelected ? themeStyles.titleSelected : 'text-gray-500'}`}>
                                    {item.company}
                                </h4>
                                <p className="text-xs text-gray-500">{item.title}</p>
                            </div>
                            <div className="flex items-center gap-1">
                                <button
                                    className="p-1.5 text-gray-300 rounded transition-colors hover:text-red-500 hover:bg-red-50"
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        requestDeleteExperience(item.id);
                                    }}
                                    disabled={deletingExperienceIds.has(item.id)}
                                    title="删除经历"
                                    aria-label="删除经历"
                                >
                                    <Trash2 className="w-4 h-4" />
                                </button>
                                <button
                                    className={`p-1.5 text-gray-300 rounded transition-colors ${themeStyles.editHoverData}`}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        startEditingExperience(item.id);
                                    }}
                                    title="编辑经历"
                                    aria-label="编辑经历"
                                >
                                    <Edit3 className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                        <div className="flex items-center justify-between mt-2">
                            <p className="text-[10px] text-gray-400 font-mono">{item.date}</p>
                            {typeof item.matchScore === 'number'
                                ? renderMatchBadge(item.matchScore, DEFAULT_MATCH_BADGE_TONE)
                                : staleExperienceIds.has(item.id)
                                    ? renderStaleBadge()
                                    : null}
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    const renderEducationHeader = () => (
        <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase">教育背景</h3>
            <button
                onClick={beginCreateEducation}
                title={ADD_EDUCATION_LABEL}
                aria-label={ADD_EDUCATION_LABEL}
                className="flex items-center justify-center text-gray-500 hover:text-primary p-1 rounded-md hover:bg-primary/5"
            >
                <Plus className="w-3.5 h-3.5" />
            </button>
        </div>
    );

    const renderEducationForm = () => {
        if (!educationDraft) {
            return null;
        }
        return (
            <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                    <div>
                        <label className="text-[10px] text-gray-400">学校</label>
                        <input
                            className="w-full text-xs mt-0.5 p-2 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-1 focus:ring-primary focus:border-primary"
                            value={educationDraft.school}
                            onChange={(e) => updateEducationDraft('school', e.target.value)}
                        />
                    </div>
                    <div>
                        <label className="text-[10px] text-gray-400">专业</label>
                        <input
                            className="w-full text-xs mt-0.5 p-2 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-1 focus:ring-primary focus:border-primary"
                            value={educationDraft.major}
                            onChange={(e) => updateEducationDraft('major', e.target.value)}
                        />
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                    <div>
                        <label className="text-[10px] text-gray-400">学位</label>
                        <input
                            className="w-full text-xs mt-0.5 p-2 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-1 focus:ring-primary focus:border-primary"
                            value={educationDraft.degree}
                            onChange={(e) => updateEducationDraft('degree', e.target.value)}
                        />
                    </div>
                    <div>
                        <label className="text-[10px] text-gray-400">GPA</label>
                        <input
                            className="w-full text-xs mt-0.5 p-2 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-1 focus:ring-primary focus:border-primary"
                            value={educationDraft.gpa}
                            onChange={(e) => updateEducationDraft('gpa', e.target.value)}
                        />
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                    <div>
                        <label className="text-[10px] text-gray-400">开始时间</label>
                        <div className="h-9 mt-0.5">
                            <MonthPicker
                                value={educationDraft.startDate}
                                onChange={(val) => updateEducationDate('startDate', val)}
                                placeholder="开始时间"
                                className="h-full"
                            />
                        </div>
                    </div>
                    <div>
                        <label className="text-[10px] text-gray-400">结束时间</label>
                        <div className="h-9 mt-0.5">
                            <MonthPicker
                                value={educationDraft.endDate}
                                onChange={(val) => updateEducationDate('endDate', val)}
                                placeholder="结束时间"
                                className="h-full"
                                allowPresent
                                minDate={educationDraft.startDate}
                            />
                        </div>
                    </div>
                </div>
                <div>
                    <label className="text-[10px] text-gray-400">课程</label>
                    <input
                        className="w-full text-xs mt-0.5 p-2 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-1 focus:ring-primary focus:border-primary"
                        value={educationDraft.courses}
                        onChange={(e) => updateEducationDraft('courses', e.target.value)}
                    />
                </div>
            </div>
        );
    };

    const renderEducationCard = (edu: EducationView) => {
        const isSelected = selectedEduIds.has(edu.id);
        const isEditing = editingEducationId === edu.id && !!educationDraft;
        const dateText = buildExperienceDate(edu.startDate, edu.endDate, edu.isCurrent);
        if (isEditing) {
            return (
                <div
                    key={edu.id}
                    className="bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-2"
                >
                    {renderEducationForm()}
                    <div className="flex items-center justify-end gap-2">
                        <button
                            onClick={cancelEducationEdit}
                            className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded"
                            disabled={isSavingEducation}
                        >
                            取消
                        </button>
                        <button
                            onClick={handleSaveEducation}
                            className="text-xs font-semibold text-white bg-primary hover:bg-primary-dark px-3 py-1 rounded disabled:opacity-60"
                            disabled={isSavingEducation}
                        >
                            {isSavingEducation ? '保存中...' : '保存'}
                        </button>
                    </div>
                </div>
            );
        }

        return (
            <div
                key={edu.id}
                className={`p-3 rounded border transition-all ${isSelected
                    ? 'bg-gray-50 dark:bg-gray-900 border-primary ring-1 ring-primary'
                    : 'bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-700 opacity-60'
                    }`}
                onClick={() => toggleEducationSelection(edu.id)}
            >
                <div className="flex gap-3">
                    <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleEducationSelection(edu.id)}
                        onClick={(event) => event.stopPropagation()}
                        className="w-4 h-4 mt-0.5 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-start mb-1">
                            <h4 className="text-sm font-bold text-gray-900 dark:text-white">{edu.school}</h4>
                            <div className="flex items-center gap-1 shrink-0 ml-2">
                                <button
                                    className="p-1 text-gray-300 rounded hover:text-red-500 hover:bg-red-50"
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        requestDeleteEducation(edu.id);
                                    }}
                                    disabled={deletingEducationIds.has(edu.id)}
                                    title="删除教育经历"
                                    aria-label="删除教育经历"
                                >
                                    <Trash2 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                    className="p-1 text-gray-300 rounded hover:text-primary hover:bg-primary/5"
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        beginEditEducation(edu.id);
                                    }}
                                    title="编辑教育经历"
                                    aria-label="编辑教育经历"
                                >
                                    <Edit3 className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        </div>
                        <p className="text-xs text-gray-600 dark:text-gray-400">{edu.major}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-500">{edu.degree}</p>
                        {edu.gpa && <p className="text-xs text-gray-500 mt-1">GPA: {edu.gpa}</p>}
                        <div className="flex items-center justify-between mt-2">
                            <p className="text-[10px] text-gray-400 font-mono">{dateText}</p>
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    const renderExperienceListSection = (
        title: string,
        items: ResumeExperienceView[],
        icon?: React.ReactNode,
        theme: 'primary' | 'project' = 'primary',
        action?: { label: string; onClick: () => void }
    ) => {
        const themeStyles = {
            primary: {
                borderSelected: 'border-primary',
                ringSelected: 'ring-primary/10',
                checkboxtext: 'text-primary',
                checkboxFocus: 'focus:ring-primary',
                editHoverData: 'hover:text-primary hover:bg-primary/5',
                titleSelected: 'text-gray-900 dark:text-white',
            },
            project: {
                borderSelected: 'border-indigo-500',
                ringSelected: 'ring-indigo-500/10',
                checkboxtext: 'text-indigo-600',
                checkboxFocus: 'focus:ring-indigo-500',
                editHoverData: 'hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/10',
                titleSelected: 'text-gray-900 dark:text-white',
            }
        }[theme];

        if (!items.length) {
            return (
                <div className="space-y-3">
                    {renderExperienceSectionHeader(title, icon, action)}
                    <p className="text-xs text-gray-400">暂无{title}</p>
                </div>
            );
        }

        return (
            <div className="space-y-3">
                {renderExperienceSectionHeader(title, icon, action)}
                {items.map((item) => renderExperienceCard(item, themeStyles))}
            </div>
        );
    };

    const renderMatchBadge = (
        score: number,
        tone: keyof typeof MATCH_BADGE_STYLES = DEFAULT_MATCH_BADGE_TONE,
        variant: 'soft' | 'solid' = 'soft'
    ) => (
        <span
            className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${MATCH_BADGE_STYLES[tone][variant]}`}
        >
            匹配度 {score}%
        </span>
    );

    const renderStaleBadge = () => (
        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-300">
            待更新
        </span>
    );

    const resolveExperienceSuggestion = (item?: ResumeExperienceView) => {
        if (item && staleExperienceIds.has(item.id)) {
            return STALE_EXPERIENCE_TIP;
        }
        if (item?.matchReason) {
            return item.matchReason;
        }
        if (analysisResult?.summary) {
            return analysisResult.summary;
        }
        return '暂无润色建议';
    };

    const resolveCertificationMatchRate = (cert: CertificationView) => {
        const score = certificationMatchScores.get(cert.id);
        return typeof score === 'number' ? score : cert.matchRate;
    };

    const renderCertificationHeader = (title: string) => (
        <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
                <Award className="w-3.5 h-3.5 text-amber-500" />
                <h4 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{title}</h4>
            </div>
            <button
                onClick={beginCreateCertification}
                title={ADD_CERTIFICATION_LABEL}
                aria-label={ADD_CERTIFICATION_LABEL}
                className="flex items-center justify-center text-gray-500 hover:text-amber-600 p-1 rounded-md hover:bg-amber-50"
            >
                <Plus className="w-3.5 h-3.5" />
            </button>
        </div>
    );

    const renderCertificationForm = () => {
        if (!certificationDraft) {
            return null;
        }
        return (
            <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                    <div>
                        <label className="text-[10px] text-gray-400">证书名称</label>
                        <input
                            className="w-full text-xs mt-0.5 p-2 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-1 focus:ring-amber-400 focus:border-amber-400"
                            value={certificationDraft.name}
                            onChange={(e) => updateCertificationDraft('name', e.target.value)}
                        />
                    </div>
                    <div>
                        <label className="text-[10px] text-gray-400">颁发机构</label>
                        <input
                            className="w-full text-xs mt-0.5 p-2 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-1 focus:ring-amber-400 focus:border-amber-400"
                            value={certificationDraft.issuer}
                            onChange={(e) => updateCertificationDraft('issuer', e.target.value)}
                        />
                    </div>
                </div>
                <div>
                    <label className="text-[10px] text-gray-400">取得时间 (YYYY-MM)</label>
                    <input
                        className="w-full text-xs mt-0.5 p-2 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-1 focus:ring-amber-400 focus:border-amber-400"
                        value={certificationDraft.issueDate}
                        onChange={(e) => updateCertificationDraft('issueDate', e.target.value)}
                        placeholder="2026-07"
                    />
                </div>
            </div>
        );
    };

    const renderCertificationListSection = (title: string, items: CertificationView[]) => {
        if (!items.length) {
            return (
                <div className="space-y-3">
                    {renderCertificationHeader(title)}
                    <p className="text-xs text-gray-400">暂无证书</p>
                </div>
            );
        }

        return (
            <div className="space-y-3">
                {renderCertificationHeader(title)}
                {items.map((cert) => {
                    const isSelected = selectedCertIds.has(cert.id);
                    const matchRate = resolveCertificationMatchRate(cert);
                    const isEditing = editingCertificationId === cert.id && !!certificationDraft;
                    if (isEditing) {
                        return (
                            <div
                                key={cert.id}
                                className="bg-white dark:bg-gray-800 rounded-lg border border-amber-200/60 dark:border-amber-800/40 p-3 space-y-2"
                            >
                                {renderCertificationForm()}
                                <div className="flex items-center justify-end gap-2">
                                    <button
                                        onClick={cancelCertificationEdit}
                                        className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded"
                                        disabled={isSavingCertification}
                                    >
                                        取消
                                    </button>
                                    <button
                                        onClick={handleSaveCertification}
                                        className="text-xs font-semibold text-white bg-amber-500 hover:bg-amber-600 px-3 py-1 rounded disabled:opacity-60"
                                        disabled={isSavingCertification}
                                    >
                                        {isSavingCertification ? '保存中...' : '保存'}
                                    </button>
                                </div>
                            </div>
                        );
                    }
                    return (
                        <div
                            key={cert.id}
                            className={`bg-white dark:bg-gray-800 rounded-xl border p-3 shadow-sm transition-all group relative cursor-pointer ${isSelected
                                ? 'border-amber-500 ring-1 ring-amber-500/20'
                                : 'border-amber-500/30 hover:shadow-md'
                                }`}
                            onClick={() => toggleCertificationSelection(cert.id)}
                        >
                            <div className="flex items-start gap-3">
                                <div className="pt-1">
                                    <input
                                        type="checkbox"
                                        checked={isSelected}
                                        onChange={() => toggleCertificationSelection(cert.id)}
                                        className="w-4 h-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500 cursor-pointer"
                                        onClick={(e) => e.stopPropagation()}
                                    />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex justify-between items-start mb-1">
                                        <h4 className={`font-bold text-sm truncate ${isSelected ? 'text-gray-900 dark:text-white' : 'text-gray-700 dark:text-gray-200'}`}>
                                            {cert.name}
                                        </h4>
                                        <div className="flex items-center gap-1 shrink-0 ml-2">
                                            <button
                                                className="p-1 text-gray-300 rounded hover:text-red-500 hover:bg-red-50"
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    requestDeleteCertification(cert.id);
                                                }}
                                                disabled={deletingCertificationIds.has(cert.id)}
                                                title="删除证书"
                                                aria-label="删除证书"
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                            <button
                                                className="p-1 text-gray-300 rounded hover:text-amber-600 hover:bg-amber-50"
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    beginEditCertification(cert.id);
                                                }}
                                                title="编辑证书"
                                                aria-label="编辑证书"
                                            >
                                                <Edit3 className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    </div>
                                    {cert.issuer && (
                                        <p className="text-xs text-gray-500 dark:text-gray-400 mb-2 truncate">{cert.issuer}</p>
                                    )}
                                    <div className="flex items-center justify-between mt-2">
                                        <p className="text-[10px] text-gray-400 font-mono">{cert.date}</p>
                                        {typeof matchRate === 'number' && matchRate > 0
                                            ? renderMatchBadge(matchRate, DEFAULT_MATCH_BADGE_TONE)
                                            : null}
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        );
    };

    const renderSkillHeader = (title: string) => (
        <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
                <Wrench className="w-3.5 h-3.5 text-rose-500" />
                <h4 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{title}</h4>
            </div>
            <button
                onClick={beginCreateSkillType}
                title={ADD_SKILL_TYPE_LABEL}
                aria-label={ADD_SKILL_TYPE_LABEL}
                className="flex items-center justify-center text-gray-500 hover:text-rose-600 p-1 rounded-md hover:bg-rose-50"
            >
                <Plus className="w-3.5 h-3.5" />
            </button>
        </div>
    );

    const renderSkillEditor = (options?: {
        hideCategory?: boolean;
        lockCategory?: boolean;
        className?: string;
    }) => {
        if (!skillDraft) {
            return null;
        }
        const { hideCategory = false, lockCategory = false, className = '' } = options ?? {};
        return (
            <div className={`bg-white dark:bg-gray-800 rounded-lg border border-rose-200/60 dark:border-rose-800/40 p-3 space-y-2 ${className}`}>
                <div className={`grid ${hideCategory ? 'grid-cols-1' : 'grid-cols-2'} gap-2`}>
                    <div>
                        <label className="text-[10px] text-gray-400">技能名称</label>
                        <input
                            className="w-full text-xs mt-0.5 p-2 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-1 focus:ring-rose-400 focus:border-rose-400"
                            value={skillDraft.name}
                            onChange={(e) => updateSkillDraft('name', e.target.value)}
                        />
                    </div>
                    {!hideCategory && (
                        <div>
                            <label className="text-[10px] text-gray-400">技能分类</label>
                            <input
                                className="w-full text-xs mt-0.5 p-2 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-1 focus:ring-rose-400 focus:border-rose-400 disabled:bg-gray-100 dark:disabled:bg-gray-900/40"
                                value={skillDraft.category}
                                onChange={(e) => updateSkillDraft('category', e.target.value)}
                                disabled={lockCategory}
                            />
                        </div>
                    )}
                </div>
                <div className="flex items-center justify-end gap-2">
                    <button
                        onClick={cancelSkillEdit}
                        className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded"
                        disabled={isSavingSkill}
                    >
                        取消
                    </button>
                    <button
                        onClick={handleSaveSkill}
                        className="text-xs font-semibold text-white bg-rose-500 hover:bg-rose-600 px-3 py-1 rounded disabled:opacity-60"
                        disabled={isSavingSkill}
                    >
                        {isSavingSkill ? '保存中...' : '保存'}
                    </button>
                </div>
            </div>
        );
    };

    const renderSkillTag = (skill: SkillItemView) => {
        const isSelected = selectedSkillIds.has(skill.id);
        const matchScore = skillMatchScores.get(skill.id);
        return (
            <label
                key={skill.id}
                className={`group flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs cursor-pointer transition-all select-none ${isSelected || editingSkillId === skill.id
                    ? 'border-rose-500 bg-rose-500 text-white shadow-sm shadow-rose-200 dark:shadow-none'
                    : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-rose-300 dark:hover:border-rose-700 bg-gray-50 dark:bg-gray-800'
                    }`}
            >
                <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleSkillSelection(skill.id)}
                    className="hidden"
                />
                {isSelected && <CheckCircle2 className="w-3 h-3 text-white" />}
                <span>{editingSkillId === skill.id ? (skillDraft?.name || skill.name) : skill.name}</span>
                {typeof matchScore === 'number' && matchScore > 0
                    ? renderMatchBadge(matchScore, DEFAULT_MATCH_BADGE_TONE)
                    : null}
                <span className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                        type="button"
                        className="p-1 text-gray-300 rounded hover:text-red-500 hover:bg-red-50"
                        onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            requestDeleteSkill(skill.id);
                        }}
                        disabled={deletingSkillIds.has(skill.id)}
                        title="删除技能"
                        aria-label="删除技能"
                    >
                        <Trash2 className="w-3 h-3" />
                    </button>
                    <button
                        type="button"
                        className="p-1 text-gray-300 rounded hover:text-rose-600 hover:bg-rose-50"
                        onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            beginEditSkill(skill.id);
                        }}
                        title="编辑技能"
                        aria-label="编辑技能"
                    >
                        <Edit3 className="w-3 h-3" />
                    </button>
                </span>
            </label>
        );
    };

    const renderSkillGroupCard = (
        group: SkillGroupView,
        options: { showEditor: boolean; hideCategory: boolean; lockCategory: boolean }
    ) => (
        <div
            key={group.name}
            className="bg-white dark:bg-gray-800 rounded-xl border border-rose-500/30 shadow-sm hover:shadow-md transition-all overflow-hidden"
        >
            <div className="bg-rose-50/50 dark:bg-rose-900/10 px-3 py-2 border-b border-rose-100 dark:border-rose-800/30 flex items-center justify-between">
                {renamingCategoryTarget === group.name ? (
                    <input
                        autoFocus
                        className="text-xs font-bold text-rose-700 dark:text-rose-400 bg-transparent border-b border-rose-300 outline-none w-32"
                        value={renamingCategoryDraft}
                        onChange={(e) => setRenamingCategoryDraft(e.target.value)}
                        onBlur={() => handleRenameCategory(group.name, renamingCategoryDraft)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                handleRenameCategory(group.name, renamingCategoryDraft);
                            } else if (e.key === 'Escape') {
                                resetRenamingCategory();
                            }
                        }}
                    />
                ) : (
                    <div className="flex items-center gap-2 group/title">
                        <h5 className="text-xs font-bold text-rose-700 dark:text-rose-400">{group.name}</h5>
                        <button
                            onClick={() => {
                                setRenamingCategoryTarget(group.name);
                                setRenamingCategoryDraft(group.name);
                            }}
                            className="opacity-0 group-hover/title:opacity-100 p-0.5 text-rose-300 hover:text-rose-500 transition-all"
                        >
                            <Edit3 className="w-3 h-3" />
                        </button>
                    </div>
                )}
                <div className="flex items-center gap-1">
                    <button
                        type="button"
                        onClick={() => requestDeleteSkillCategory(group.name)}
                        title={DELETE_SKILL_CATEGORY_LABEL}
                        aria-label={DELETE_SKILL_CATEGORY_LABEL}
                        className="p-0.5 text-rose-300 hover:text-red-500 transition-all rounded hover:bg-red-50"
                        disabled={deletingSkillCategories.has(group.name)}
                    >
                        <Trash2 className="w-3 h-3" />
                    </button>
                    <button
                        type="button"
                        onClick={() => beginCreateSkillInGroup(group.name)}
                        title={ADD_SKILL_TAG_LABEL}
                        aria-label={ADD_SKILL_TAG_LABEL}
                        className="hidden"
                    >
                        <Plus className="w-3 h-3" />
                        {ADD_SKILL_TAG_LABEL}
                    </button>
                </div>
            </div>
            <div className="p-3 bg-white dark:bg-gray-800/50">
                {options.showEditor && skillDraftContext?.mode === 'edit'
                    ? (
                        <div className="mb-2">
                            {renderSkillEditor({
                                className: 'border-rose-200/50 bg-rose-50/40 dark:bg-rose-900/10',
                            })}
                        </div>
                    )
                    : null}
                <div className="flex flex-wrap gap-2">
                    {group.skills.map((skill) => renderSkillTag(skill))}
                    {skillDraftContext?.mode === 'group' && skillDraftContext?.groupName === group.name ? (
                        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-rose-500 bg-rose-500 text-white shadow-sm shadow-rose-200 dark:shadow-none text-xs">
                            <input
                                autoFocus
                                className="bg-transparent border-none text-xs text-white p-0 m-0 w-20 outline-none focus:ring-0 placeholder-rose-200"
                                placeholder="输入技能..."
                                value={skillDraft?.name || ''}
                                onChange={(e) => updateSkillDraft('name', e.target.value)}
                                onBlur={handleSaveSkill}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        handleSaveSkill();
                                    } else if (e.key === 'Escape') {
                                        cancelSkillEdit();
                                    }
                                }}
                            />
                        </div>
                    ) : (
                        <button
                            onClick={() => beginCreateSkillInGroup(group.name)}
                            className="flex items-center justify-center p-1.5 rounded-lg border border-dashed border-gray-300 hover:border-rose-400 text-gray-400 hover:text-rose-500 hover:bg-rose-50 transition-colors"
                        >
                            <Plus className="w-3.5 h-3.5" />
                        </button>
                    )}
                </div>
            </div>
        </div>
    );

    const renderSkillListSection = (title: string, groups: SkillGroupView[]) => {
        const draftGroupName = (() => {
            if (!skillDraft || !skillDraftContext) {
                return null;
            }
            if (skillDraftContext.mode === 'type') {
                return null;
            }
            if (skillDraftContext.mode === 'group') {
                return skillDraftContext.groupName ?? null;
            }
            return resolveSkillCategoryName(skillDraft.category);
        })();
        const hasDraftGroup = draftGroupName
            ? groups.some((group) => group.name === draftGroupName)
            : false;
        const shouldShowTypeEditor = !!skillDraft
            && (skillDraftContext?.mode === 'type' || (draftGroupName && !hasDraftGroup));
        return (
            <div className="space-y-4">
                {renderSkillHeader(title)}
                {shouldShowTypeEditor ? (
                    <div className="bg-white dark:bg-gray-800 rounded-xl border border-rose-500/30 shadow-sm overflow-hidden animate-in fade-in slide-in-from-top-2">
                        <div className="bg-rose-50/50 dark:bg-rose-900/10 px-3 py-2 border-b border-rose-100 dark:border-rose-800/30">
                            <input
                                autoFocus
                                className="text-xs font-bold text-rose-700 dark:text-rose-400 bg-transparent border-none outline-none w-full placeholder-rose-300"
                                placeholder="输入新分类名称..."
                                value={skillDraft?.category || ''}
                                onChange={(e) => updateSkillDraft('category', e.target.value)}
                            />
                        </div>
                        <div className="p-3 bg-white dark:bg-gray-800/50">
                            <div className="flex flex-wrap gap-2">
                                <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-rose-500 bg-rose-500 text-white shadow-sm shadow-rose-200 dark:shadow-none text-xs">
                                    <input
                                        className="bg-transparent border-none text-xs text-white p-0 m-0 w-24 outline-none focus:ring-0 placeholder-rose-200"
                                        placeholder="输入第一项技能..."
                                        value={skillDraft?.name || ''}
                                        onChange={(e) => updateSkillDraft('name', e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') handleSaveSkill();
                                            if (e.key === 'Escape') cancelSkillEdit();
                                        }}
                                    />
                                </div>
                                <div className="flex items-center gap-2 ml-auto">
                                    <button
                                        onClick={cancelSkillEdit}
                                        className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1"
                                    >
                                        取消
                                    </button>
                                    <button
                                        onClick={handleSaveSkill}
                                        className="text-xs font-bold text-rose-500 hover:text-rose-600 px-2 py-1 bg-rose-50 rounded"
                                    >
                                        确认创建
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                ) : null}
                {groups.length === 0 ? (
                    shouldShowTypeEditor ? null : <p className="text-xs text-gray-400">暂无技能</p>
                ) : (
                    groups.map((group) =>
                        renderSkillGroupCard(group, {
                            showEditor: draftGroupName === group.name,
                            hideCategory: skillDraftContext?.mode === 'group',
                            lockCategory: skillDraftContext?.mode === 'group',
                        })
                    )
                )}
            </div>
        );
    };

    const renderJDCollapsed = () => (
        <div className="space-y-2">
            <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                    {renderMatchBadge(analysisResult?.matchPercentage ?? 0, DEFAULT_MATCH_BADGE_TONE)}
                    <button onClick={handleAnalyze} disabled={isAnalyzing} className="p-1 text-gray-400 hover:text-emerald-600">
                        <RefreshCw className={`w-3 h-3 ${isAnalyzing ? 'animate-spin' : ''}`} />
                    </button>
                </div>
                <div className="flex flex-wrap gap-1 overflow-hidden">
                    {jobKeywords.length > 0 ? (
                        jobKeywords.map((keyword) => (
                            <span
                                key={keyword}
                                className="text-[10px] px-2 py-1 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 rounded"
                            >
                                {keyword}
                            </span>
                        ))
                    ) : (
                        <span className="text-[10px] px-2 py-1 bg-gray-100 dark:bg-gray-800 text-gray-400 rounded">
                            暂无关键词
                        </span>
                    )}
                </div>
            </div>
            {analysisResult?.summary ? (
                <p className="text-[10px] text-emerald-800 dark:text-emerald-300/80 leading-relaxed">
                    {analysisResult.summary}
                </p>
            ) : null}
        </div>
    );

    const renderJDExpanded = () => (
        <div className="space-y-3 animate-in fade-in slide-in-from-top-2">
            <div className="relative group">
                <textarea
                    className="w-full h-24 p-3 text-xs bg-white dark:bg-gray-900 border border-border-light dark:border-border-dark rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent resize-none text-gray-700 dark:text-gray-300 placeholder-gray-400 dark:placeholder-gray-600 shadow-sm"
                    placeholder="在此粘贴职位要求 (Job Description)..."
                    value={jdText}
                    onChange={(e) => setJdText(e.target.value)}
                />
                <button
                    onClick={handleAnalyze}
                    disabled={isAnalyzing}
                    className="absolute bottom-2 right-2 p-1.5 bg-primary text-white rounded-md shadow hover:bg-primary-dark transition-colors flex items-center gap-1 text-[10px] font-bold px-2 disabled:opacity-60"
                >
                    <Wand2 className="w-3 h-3" />
                    {isAnalyzing ? '分析中...' : '开始分析'}
                </button>
            </div>
            {analysisResult && (
                <div className="bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-100 dark:border-emerald-800/30 rounded-lg p-3">
                    <div className="flex justify-between items-center mb-2">
                        {renderMatchBadge(analysisResult.matchPercentage ?? 0, DEFAULT_MATCH_BADGE_TONE)}
                        <span className="text-[10px] text-emerald-600/80">
                            Missing: {(analysisResult.missingKeywords || []).join(', ')}
                        </span>
                    </div>
                    <p className="text-[10px] text-emerald-800 dark:text-emerald-300/80 leading-relaxed">{analysisResult.summary}</p>
                </div>
            )}
        </div>
    );

    const renderJDPanel = () => (
        <div
            className={`${JD_PANEL_STICKY_CLASS} border-b border-border-light dark:border-border-dark bg-gray-50/50 dark:bg-gray-800/30 transition-all duration-300 ease-in-out flex flex-col ${JD_PANEL_BOTTOM_SPACING_CLASS} ${isJDCollapsed ? 'h-auto py-3' : 'h-auto py-4'}`}
        >
            <div className="px-4 flex items-center justify-between mb-2">
                <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
                    <Target className="w-4 h-4 text-primary" />
                    职位分析 (JD Analysis)
                </h3>
                <button
                    onClick={() => setIsJDCollapsed(!isJDCollapsed)}
                    className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                >
                    {isJDCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                </button>
            </div>
            <div className="px-4">
                {isJDCollapsed ? renderJDCollapsed() : renderJDExpanded()}
            </div>
        </div>
    );

    const renderEditingSuggestionNav = () => {
        if (!editingItem) {
            return null;
        }
        return (
            <div className={EDITING_SUGGESTION_NAV_CLASS}>
                <div className="bg-gray-50 dark:bg-gray-900/60 p-3 rounded-lg border border-gray-200 dark:border-gray-700 flex items-center gap-3">
                    <div className="shrink-0">
                        {typeof editingItem.matchScore === 'number'
                            ? renderMatchBadge(editingItem.matchScore, DEFAULT_MATCH_BADGE_TONE, 'solid')
                            : staleExperienceIds.has(editingItem.id)
                                ? renderStaleBadge()
                                : (
                                    <span className="text-[10px] text-gray-400">
                                        匹配度 --
                                    </span>
                                )}
                    </div>
                    <div className="flex-1 text-[10px] text-gray-500 leading-relaxed">
                        {resolveExperienceSuggestion(editingItem)}
                    </div>
                    <button
                        onClick={handlePolishWithJD}
                        disabled={isPolishing || !jdText.trim()}
                        className="shrink-0 flex items-center justify-center gap-1.5 text-[10px] font-semibold text-primary bg-primary/10 hover:bg-primary/20 px-2.5 py-1.5 rounded-md transition-colors disabled:opacity-60"
                    >
                        <Wand2 className="w-3.5 h-3.5" />
                        {isPolishing ? '润色中...' : '基于 JD 润色'}
                    </button>
                </div>
            </div>
        );
    };

    const saveStatusText = useMemo(() => {
        const labels = {
            idle: '未保存',
            dirty: '待保存',
            saving: '保存中...',
            saved: lastSavedAt ? `已保存 ${lastSavedAt}` : '已保存',
            error: '保存失败',
        };
        return labels[saveState];
    }, [lastSavedAt, saveState]);

    const saveStatusClass = useMemo(() => {
        const colors = {
            idle: 'text-gray-400',
            dirty: 'text-gray-500',
            saving: 'text-amber-600',
            saved: 'text-emerald-600',
            error: 'text-red-600',
        };
        return colors[saveState];
    }, [saveState]);

    return (
        <div className="flex-1 flex flex-col h-full overflow-hidden bg-background-light dark:bg-background-dark">
            {/* Top Header */}
            <header className="h-16 bg-surface-light dark:bg-surface-dark border-b border-border-light dark:border-border-dark flex items-center justify-between px-6 shrink-0 z-20">
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 text-primary hover:opacity-80 transition-opacity cursor-pointer">
                        <LayoutTemplate className="w-8 h-8" />
                        <span className="font-bold text-xl tracking-tight text-gray-900 dark:text-white">Elephant</span>
                    </div>
                    <div className="h-6 w-px bg-border-light dark:bg-border-dark"></div>
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-500">简历工厂 / Resume Factory</span>
                    </div>
                </div>
                <div className="flex items-center gap-4">
                    <button
                        onClick={adjustToSinglePage}
                        className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    >
                        <LayoutTemplate className="w-4 h-4" />
                        智能一页
                    </button>
                    <div className="flex items-center gap-2 text-xs">
                        <span className="text-gray-400">自动保存</span>
                        <span className={`font-semibold ${saveStatusClass}`}>{saveStatusText}</span>
                    </div>
                    <div className="h-6 w-px bg-border-light dark:bg-border-dark"></div>
                    <button className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400" onClick={toggleTheme}>
                        {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
                    </button>
                    <button className="flex items-center gap-2 bg-primary hover:bg-primary-dark text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm">
                        <Download className="w-4 h-4" />
                        导出 PDF
                    </button>
                </div>
            </header>

            <div className="flex flex-1 overflow-hidden">
                {/* Left Sidebar: Analysis & Modules */}
                <aside className={`${SIDEBAR_WIDTH_CLASS} flex flex-col border-r border-border-light dark:border-border-dark bg-surface-light dark:bg-surface-dark shrink-0 z-10 hidden md:flex`}>
                    {renderJDPanel()}
                    {/* Tab Navigation (Swapped order) */}
                    <div className="border-b border-border-light dark:border-border-dark bg-white dark:bg-surface-dark">
                        <div className="flex">
                            <button
                                className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors flex items-center justify-center gap-2 ${sidebarTab === 'experience' ? 'border-primary text-primary bg-primary/5' : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}
                                onClick={() => setSidebarTab('experience')}
                            >
                                <Database className="w-4 h-4" /> 经历库
                            </button>
                            <button
                                className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors flex items-center justify-center gap-2 ${sidebarTab === 'profile' ? 'border-primary text-primary bg-primary/5' : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}
                                onClick={() => { setSidebarTab('profile'); cancelEditingExperience(); }}
                            >
                                <User className="w-4 h-4" /> 个人档案
                            </button>
                        </div>
                        {renderEditingSuggestionNav()}
                    </div>

                    {/* Sidebar Content */}
                    <div className="flex-1 overflow-y-auto p-5 space-y-4 bg-gray-50/30 dark:bg-black/20">
                        {sidebarTab === 'profile' ? (
                            // 个人档案 - 按模块组织
                            <div className="space-y-3 animate-in fade-in slide-in-from-left-4 duration-300">
                                {/* 基本信息模块 */}
                                <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                                    <div className="flex items-center justify-between mb-3">
                                        <h3 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase">基本信息</h3>
                                        {!isEditingProfile ? (
                                            <button
                                                onClick={beginProfileEdit}
                                                className="flex items-center gap-2 text-xs font-medium text-primary bg-primary/10 px-3 py-1.5 rounded-md hover:bg-primary/20 transition-colors"
                                                disabled={isSavingProfile}
                                            >
                                                <Wrench className="w-3 h-3" />
                                                编辑
                                            </button>
                                        ) : (
                                            <div className="flex items-center gap-2">
                                                <button
                                                    onClick={cancelProfileEdit}
                                                    className="text-xs font-medium text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white px-3 py-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                                                    disabled={isSavingProfile}
                                                >
                                                    取消
                                                </button>
                                                <button
                                                    onClick={handleSaveProfile}
                                                    className="text-xs font-semibold text-white bg-primary hover:bg-primary-dark px-4 py-1.5 rounded-md transition-colors disabled:opacity-60"
                                                    disabled={isSavingProfile}
                                                >
                                                    {isSavingProfile ? '保存中...' : '保存'}
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                    {isEditingProfile ? (
                                        <div className="flex items-center justify-between text-[10px] text-gray-400 mb-3">
                                            <label className="flex items-center gap-2">
                                                <input
                                                    type="checkbox"
                                                    checked={profileSyncMode === PROFILE_SYNC_MODES.global}
                                                    onChange={(event) =>
                                                        setProfileSyncMode(
                                                            event.target.checked
                                                                ? PROFILE_SYNC_MODES.global
                                                                : PROFILE_SYNC_MODES.local
                                                        )}
                                                    className="w-3 h-3 rounded border-gray-300 text-primary focus:ring-primary"
                                                />
                                                同步修改个人经历库
                                            </label>
                                            <span>关闭后仅对当前简历生效</span>
                                        </div>
                                    ) : null}
                                    <div className="space-y-3">
                                        <div>
                                            <label className="text-xs text-gray-500 dark:text-gray-400">姓名</label>
                                            <input
                                                className="w-full text-sm p-2 mt-0.5 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-1 focus:ring-primary focus:border-primary disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed"
                                                value={profile.name}
                                                onChange={(e) => setProfile({ ...profile, name: e.target.value })}
                                                disabled={isProfileReadOnly}
                                            />
                                        </div>
                                        <div className="grid grid-cols-2 gap-2">
                                            <div>
                                                <label className="text-xs text-gray-500 dark:text-gray-400">电话</label>
                                                <input
                                                    className="w-full text-sm p-2 mt-0.5 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-1 focus:ring-primary focus:border-primary disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed"
                                                    value={profile.phone}
                                                    onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
                                                    disabled={isProfileReadOnly}
                                                />
                                            </div>
                                            <div>
                                                <label className="text-xs text-gray-500 dark:text-gray-400">邮箱</label>
                                                <input
                                                    className="w-full text-sm p-2 mt-0.5 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-1 focus:ring-primary focus:border-primary disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed"
                                                    value={profile.email}
                                                    onChange={(e) => setProfile({ ...profile, email: e.target.value })}
                                                    disabled={isProfileReadOnly}
                                                />
                                            </div>
                                        </div>
                                        <div>
                                            <label className="text-xs text-gray-500 dark:text-gray-400">地点</label>
                                            <input
                                                className="w-full text-sm p-2 mt-0.5 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-1 focus:ring-primary focus:border-primary disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed"
                                                value={profile.location}
                                                onChange={(e) => setProfile({ ...profile, location: e.target.value })}
                                                disabled={isProfileReadOnly}
                                            />
                                        </div>
                                        <div>
                                            <label className="text-xs text-gray-500 dark:text-gray-400">链接</label>
                                            <input
                                                className="w-full text-sm p-2 mt-0.5 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-1 focus:ring-primary focus:border-primary disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed"
                                                value={profile.linkedin}
                                                onChange={(e) => setProfile({ ...profile, linkedin: e.target.value })}
                                                disabled={isProfileReadOnly}
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* 教育背景模块 */}
                                <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                                    {renderEducationHeader()}
                                    <div className="space-y-2">
                                        {educations.length === 0 ? (
                                            <p className="text-xs text-gray-400">暂无教育经历</p>
                                        ) : (
                                            educations.map((edu) => renderEducationCard(edu))
                                        )}
                                    </div>
                                </div>

                                {/* 职业总结模块 */}
                                <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                                    <h3 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase mb-3">职业总结</h3>
                                    <textarea
                                        className="w-full text-sm p-2 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-1 focus:ring-primary focus:border-primary h-28 leading-relaxed resize-none disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed"
                                        value={profile.summary}
                                        onChange={(e) => setProfile({ ...profile, summary: e.target.value })}
                                        placeholder="用 2-4 句话概括你的优势、方向与量化成果"
                                        disabled={isProfileReadOnly}
                                    />
                                </div>

                            </div>
                        ) : (
                            // 2. Experience Selection & STAR Editing
                            editingExpId ? (
                                // Editing Mode (STAR Inputs)
                                <div className="space-y-4 animate-in slide-in-from-right-4 duration-300">
                                    <button
                                        onClick={cancelEditingExperience}
                                        className="flex items-center gap-2 text-xs font-bold text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white mb-2"
                                    >
                                        <ArrowLeft className="w-3 h-3" /> 返回列表
                                    </button>
                                    <div className="bg-white dark:bg-gray-800 p-3 rounded-lg border border-gray-200 dark:border-gray-700 mb-2">
                                        <div className="grid grid-cols-2 gap-2">
                                            <input
                                                className="text-sm font-bold text-gray-900 dark:text-white bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1 focus:ring-1 focus:ring-primary focus:border-primary"
                                                value={editingDraft?.company || ''}
                                                onChange={(e) => updateEditingMeta('company', e.target.value)}
                                                placeholder="公司 / 项目名称"
                                            />
                                            <div className="h-9">
                                                <MonthPicker
                                                    value={editingDraft?.startDate || ''}
                                                    onChange={(val) => updateEditingDate('startDate', val)}
                                                    placeholder="开始时间"
                                                    className="h-full"
                                                />
                                            </div>
                                            <input
                                                className="text-xs text-gray-500 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1 focus:ring-1 focus:ring-primary focus:border-primary"
                                                value={editingDraft?.title || ''}
                                                onChange={(e) => updateEditingMeta('title', e.target.value)}
                                                placeholder="职位 / 角色"
                                            />
                                            <div className="h-9">
                                                <MonthPicker
                                                    value={editingDraft?.endDate || ''}
                                                    onChange={(val) => updateEditingDate('endDate', val)}
                                                    placeholder="结束时间"
                                                    allowPresent
                                                    className="h-full"
                                                    minDate={editingDraft?.startDate || ''}
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    {['s', 't', 'a', 'r'].map((key) => {
                                        const labelMap: any = { s: 'Situation (情境)', t: 'Task (任务)', a: 'Action (行动)', r: 'Result (结果)' };
                                        const colorMap: any = { s: 'text-blue-600', t: 'text-orange-600', a: 'text-amber-600', r: 'text-emerald-600' };
                                        const heightClass = key === 'a' ? 'h-40' : 'h-24';
                                        return (
                                            <div key={key} className="space-y-1">
                                                <label className={`text-[10px] font-bold uppercase tracking-wider ${colorMap[key]} pl-1`}>
                                                    {labelMap[key]}
                                                </label>
                                                <textarea
                                                    className={`w-full text-sm p-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all ${heightClass} resize-none leading-relaxed`}
                                                    value={editingDraft?.star?.[key as StarFieldKey] || ''}
                                                    onChange={(e) => updateEditingStar(key as StarFieldKey, e.target.value)}
                                                    placeholder={`Enter ${key.toUpperCase()}...`}
                                                />
                                            </div>
                                        )
                                    })}
                                    <div className="bg-white dark:bg-gray-800 p-3 rounded-lg border border-gray-200 dark:border-gray-700 space-y-2">
                                        {editingDraft?.isDraft ? (
                                            <div className="flex items-center justify-between">
                                                <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
                                                    <input
                                                        type="checkbox"
                                                        checked
                                                        disabled
                                                        className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary opacity-60 cursor-not-allowed"
                                                    />
                                                    同步修改个人经历库
                                                </label>
                                                <span className="text-[10px] text-gray-400">新增默认同步</span>
                                            </div>
                                        ) : (
                                            <div className="flex items-center justify-between">
                                                <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
                                                    <input
                                                        type="checkbox"
                                                        checked={syncToMaster}
                                                        onChange={(e) => setSyncToMaster(e.target.checked)}
                                                        className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary"
                                                    />
                                                    同步修改个人经历库
                                                </label>
                                                <span className="text-[10px] text-gray-400">关闭后仅对当前简历生效</span>
                                            </div>
                                        )}
                                        <div className="flex items-center justify-end gap-2">
                                            <button
                                                onClick={cancelEditingExperience}
                                                className="text-xs font-medium text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white px-3 py-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                                                disabled={isSavingExperience}
                                            >
                                                取消
                                            </button>
                                            <button
                                                onClick={handleSaveExperience}
                                                className="text-xs font-semibold text-white bg-primary hover:bg-primary-dark px-4 py-1.5 rounded-md transition-colors disabled:opacity-60"
                                                disabled={isSavingExperience}
                                            >
                                                {isSavingExperience ? '保存中...' : '保存'}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                // List Mode (Checkboxes)
                                <div className="space-y-3 animate-in fade-in slide-in-from-left-4 duration-300">
                                    <p className="text-xs text-gray-400 px-1 flex items-center gap-2">
                                        <CheckCircle2 className="w-3 h-3" /> 勾选以添加到简历
                                    </p>
                                    {renderExperienceListSection(
                                        '工作经历',
                                        workItems,
                                        <Briefcase className="w-3.5 h-3.5 text-primary" />,
                                        'primary',
                                        {
                                            label: ADD_WORK_EXPERIENCE_LABEL,
                                            onClick: () => handleAddExperience('work'),
                                        }
                                    )}
                                    {renderExperienceListSection(
                                        '项目经历',
                                        projectItems,
                                        <FolderKanban className="w-3.5 h-3.5 text-indigo-500" />,
                                        'project',
                                        {
                                            label: ADD_PROJECT_EXPERIENCE_LABEL,
                                            onClick: () => handleAddExperience('project'),
                                        }
                                    )}
                                    {renderCertificationListSection('证书资质', sortedCertifications)}
                                    {renderSkillListSection('专业技能', skillGroups)}
                                    {/* Removed the "Import More" card placeholder as per requirement */}
                                </div>
                            )
                        )}
                    </div>
                </aside>

                {/* Main Preview Area (Connected to State) */}
                <main className="flex-1 bg-gray-100 dark:bg-gray-900/50 overflow-y-auto relative flex justify-center p-8 scroll-smooth">
                    <div
                        ref={previewRef}
                        className="a4-preview text-gray-900 p-[20mm] relative"
                        style={{
                            transform: resumeScale === 1 ? undefined : `scale(${resumeScale})`,
                            transformOrigin: 'top center',
                        }}
                    >
                        {/* 1. Header (Basic Info) */}
                        <div id="basic-info" className={`border-b-2 border-gray-900 pb-4 ${spacingClass} text-center scroll-mt-8`}>
                            <h1 className="text-3xl font-bold uppercase tracking-widest mb-2 text-gray-900">{profile.name}</h1>
                            <div className="text-[11px] text-gray-600 flex justify-center flex-wrap gap-x-4 gap-y-1 font-medium">
                                <span>{profile.email}</span>
                                <span>{profile.phone}</span>
                                <span>{profile.location}</span>
                                <span>{profile.linkedin}</span>
                            </div>
                        </div>

                        {/* Dynamically render sections based on sectionOrder */}
                        {sectionOrder.map((sectionId) => {
                            // Summary Section
                            if (sectionId === 'summary' && profile.summary) {
                                return (
                                    <div
                                        key="summary"
                                        id="summary"
                                        className={`${spacingClass} relative group cursor-move`}
                                        draggable
                                        onDragStart={(e) => handleSectionDragStart(e, 'summary')}
                                        onDragOver={(e) => handleSectionDragOver(e, 'summary')}
                                        onDrop={handleSectionDrop}
                                    >
                                        {/* Left corner icons */}
                                        <div className="absolute -left-6 top-0 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <GripVertical className="w-4 h-4 text-primary cursor-move" />
                                            <Edit3
                                                className="w-4 h-4 text-primary cursor-pointer"
                                                onClick={(e) => { e.stopPropagation(); setSidebarTab('profile'); }}
                                            />
                                        </div>
                                        <div className="group-hover:bg-primary/5 -m-2 p-2 rounded transition-colors">
                                            <h2 className="text-xs font-bold uppercase tracking-widest text-primary border-b border-gray-200 pb-1 mb-2">职业总结</h2>
                                            <p className="text-xs leading-relaxed text-gray-800">{profile.summary}</p>
                                        </div>
                                    </div>
                                );
                            }

                            if (sectionId === 'work') {
                                return renderExperienceSection('work', '工作经历', selectedWorkItems);
                            }

                            if (sectionId === 'project') {
                                return renderExperienceSection('project', '项目经历', selectedProjectItems);
                            }

                            // Education Section
                            if (sectionId === 'education' && selectedEduIds.size > 0) {
                                return (
                                    <div
                                        key="education"
                                        id="education"
                                        className={`${spacingClass} scroll-mt-20 relative group cursor-move`}
                                        draggable
                                        onDragStart={(e) => handleSectionDragStart(e, 'education')}
                                        onDragOver={(e) => handleSectionDragOver(e, 'education')}
                                        onDrop={handleSectionDrop}
                                    >
                                        {/* Left corner icons */}
                                        <div className="absolute -left-6 top-0 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <GripVertical className="w-4 h-4 text-primary cursor-move" />
                                            <Edit3
                                                className="w-4 h-4 text-primary cursor-pointer"
                                                onClick={(e) => { e.stopPropagation(); setSidebarTab('profile'); }}
                                            />
                                        </div>

                                        <div className="group-hover:bg-primary/5 -m-2 p-2 rounded transition-colors">
                                            <h2 className="text-xs font-bold uppercase tracking-widest text-primary border-b border-gray-200 pb-1 mb-3">教育背景</h2>
                                            <div className={listSpacingClass}>
                                                {educations
                                                    .filter(edu => selectedEduIds.has(edu.id))
                                                    .map((edu) => {
                                                        const dateText = buildExperienceDate(
                                                            edu.startDate,
                                                            edu.endDate,
                                                            edu.isCurrent
                                                        );
                                                        return (
                                                            <div key={edu.id} className="mb-2">
                                                                <div className="flex justify-between items-baseline mb-0.5">
                                                                    <h3 className="text-sm font-bold text-gray-900">{edu.school}</h3>
                                                                    <span className="text-xs font-medium text-gray-600">{dateText}</span>
                                                                </div>
                                                                <p className="text-xs text-gray-800">{edu.major}, {edu.degree}</p>
                                                                {edu.gpa && <p className="text-xs text-gray-600">GPA: {edu.gpa}</p>}
                                                            </div>
                                                        );
                                                    })}
                                            </div>
                                        </div>
                                    </div>
                                );
                            }

                            // Certifications Section
                            if (sectionId === 'certifications' && selectedCertIds.size > 0) {
                                return (
                                    <div
                                        key="certifications"
                                        id="certifications"
                                        className={`${spacingClass} scroll-mt-20 relative group cursor-move`}
                                        draggable
                                        onDragStart={(e) => handleSectionDragStart(e, 'certifications')}
                                        onDragOver={(e) => handleSectionDragOver(e, 'certifications')}
                                        onDrop={handleSectionDrop}
                                    >
                                        {/* Left corner icons */}
                                        <div className="absolute -left-6 top-0 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <GripVertical className="w-4 h-4 text-primary cursor-move" />
                                            <Edit3
                                                className="w-4 h-4 text-primary cursor-pointer"
                                                onClick={(e) => { e.stopPropagation(); setSidebarTab('experience'); }}
                                            />
                                        </div>

                                        <div className="group-hover:bg-primary/5 -m-2 p-2 rounded transition-colors">
                                            <h2 className="text-xs font-bold uppercase tracking-widest text-primary border-b border-gray-200 pb-1 mb-3">证书资质</h2>
                                            <div className="space-y-1.5">
                                                {sortedCertifications
                                                    .filter(cert => selectedCertIds.has(cert.id))
                                                    .map((cert) => (
                                                        <div key={cert.id} className="flex justify-between items-baseline">
                                                            <div>
                                                                <span className="text-xs font-bold text-gray-900">{cert.name}</span>
                                                                {cert.issuer ? (
                                                                    <span className="text-xs text-gray-600 ml-2">({cert.issuer})</span>
                                                                ) : null}
                                                            </div>
                                                            <span className="text-xs text-gray-600">{cert.date}</span>
                                                        </div>
                                                    ))}
                                            </div>
                                        </div>
                                    </div>
                                );
                            }

                            // Skills Section
                            if (sectionId === 'skills' && selectedSkillGroups.length > 0) {
                                return (
                                    <div
                                        key="skills"
                                        id="skills"
                                        className={`${spacingClass} scroll-mt-20 relative group cursor-move`}
                                        draggable
                                        onDragStart={(e) => handleSectionDragStart(e, 'skills')}
                                        onDragOver={(e) => handleSectionDragOver(e, 'skills')}
                                        onDrop={handleSectionDrop}
                                    >
                                        {/* Left corner icons */}
                                        <div className="absolute -left-6 top-0 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <GripVertical className="w-4 h-4 text-primary cursor-move" />
                                            <Edit3
                                                className="w-4 h-4 text-primary cursor-pointer"
                                                onClick={(e) => { e.stopPropagation(); setSidebarTab('experience'); }}
                                            />
                                        </div>

                                        <div className="group-hover:bg-primary/5 -m-2 p-2 rounded transition-colors">
                                            <h2 className="text-xs font-bold uppercase tracking-widest text-primary border-b border-gray-200 pb-1 mb-2">专业技能</h2>
                                            <div className="text-xs text-gray-800 grid grid-cols-[100px_1fr] gap-y-1.5">
                                                {selectedSkillGroups.map((group) => (
                                                    <React.Fragment key={group.name}>
                                                        <span className="font-bold text-gray-900">{group.name}:</span>
                                                        <span>{group.skills.join(', ')}</span>
                                                    </React.Fragment>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                );
                            }

                            return null;
                        })}
                    </div>
                </main>
            </div>
            <ToastContainer toasts={toasts} onClose={closeToast} />
            <ConfirmDialog
                isOpen={!!confirmDialog}
                title={confirmDialog?.title || ''}
                description={confirmDialog?.description || ''}
                onConfirm={handleConfirmDelete}
                onCancel={handleCancelDelete}
            />
        </div>
    );
};

export default ResumeEditor;
