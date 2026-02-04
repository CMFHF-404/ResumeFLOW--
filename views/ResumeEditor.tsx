import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Moon, Sun, Download, LayoutTemplate,
    Target, Wand2, RefreshCw,
    Edit3, Eye, EyeOff, GripVertical, CheckCircle2,
    ChevronDown, ChevronUp, ArrowLeft, Database, User, Award, Wrench, Briefcase, FolderKanban
} from 'lucide-react';
import { aiService, JDAnalysisResult } from '../services/aiService';
import { experienceService, ExperienceDetail, ExperienceListItem } from '../services/experienceService';
import { profileService, Profile } from '../services/profileService';
import { certificationsService, Certification as CertificationRecord } from '../services/certificationsService';
import { resumeService, Resume, ResumeDetail, ResumeExperienceItem } from '../services/resumeService';
import { skillsService, UserSkill } from '../services/skillsService';
import { useDebounce } from '../components/hooks/useDebounce';
import { parseYearMonthValue } from './experienceUtils';
import { clearActiveResumeId, getActiveResumeId, setActiveResumeId } from './resumeStorage';
import { clearJDAnalysisCache, loadJDAnalysisCache, saveJDAnalysisCache } from './jdAnalysisStorage';
import { mergeLinkedInLink, resolveLinkedInLink } from './profileUtils';

const DEFAULT_RESUME_TITLE = '未命名简历';
const AUTO_SAVE_DELAY_MS = 800;
const STAR_FIELDS = ['s', 't', 'a', 'r'] as const;
const CERT_META_PREFIX = "__rf_cert_meta__:";
const EXPERIENCE_CATEGORY_ORDER: Array<ResumeExperienceView['category']> = ['work', 'project'];
const DEFAULT_SECTION_ORDER = ['summary', 'work', 'project', 'education', 'certifications', 'skills'] as const;
const RESUME_SECTION_IDS = new Set<string>(DEFAULT_SECTION_ORDER);
const SIDEBAR_WIDTH_CLASS = 'w-[600px]';
const JD_PANEL_BOTTOM_SPACING_CLASS = 'mb-3';
const DEFAULT_JD_TEXT = '';
const EMPTY_TEXT_SIGNATURE = '';
const PROFILE_SYNC_MODES = {
    global: 'global',
    local: 'local',
} as const;

type StarFieldKey = typeof STAR_FIELDS[number];

type StarFields = {
    s: string;
    t: string;
    a: string;
    r: string;
};

type ResumeExperienceView = {
    id: string;
    title: string;
    company: string;
    date: string;
    startDate?: string;
    endDate?: string;
    isCurrent?: boolean;
    star: StarFields;
    matchScore?: number;
    resumeLinkId?: string;
    experienceVersionId?: string;
    category: 'work' | 'project';
};

type ResumeEditorProfile = {
    name: string;
    email: string;
    phone: string;
    location: string;
    linkedin: string;
    summary: string;
};

type ProfileSyncMode = typeof PROFILE_SYNC_MODES[keyof typeof PROFILE_SYNC_MODES];

type ResumeEditorConfig = {
    profile?: ResumeEditorProfile;
    profileSyncMode?: ProfileSyncMode;
    selection?: {
        experienceIds?: string[];
        educationIds?: string[];
        certificationIds?: string[];
        skillIds?: string[];
    };
    layout?: {
        sectionOrder?: string[];
        density?: 'compact' | 'standard' | 'spacious';
    };
};

type JDAnalysisContext = {
    jdTextSignature: string;
    experienceSignature: string;
};

type ActiveResumeContext = {
    id: string;
    detail: ResumeDetail | null;
};

type CachedResumeResolveResult =
    | { status: 'ok'; detail: ResumeDetail }
    | { status: 'missing' }
    | { status: 'error' };

type ExperienceEditDraft = {
    masterId: string;
    star: StarFields;
};

type EducationView = {
    id: string;
    school: string;
    major: string;
    degree: string;
    startDate: string;
    endDate: string;
    gpa?: string;
    courses?: string;
};

type CertificationView = {
    id: string;
    name: string;
    issuer?: string;
    date: string;
    matchRate?: number;
};

type SkillItemView = {
    id: string;
    name: string;
};

type SkillGroupView = {
    name: string;
    skills: SkillItemView[];
};

const DEFAULT_PROFILE: ResumeEditorProfile = {
    name: '',
    email: '',
    phone: '',
    location: '',
    linkedin: '',
    summary: '',
};

const normalizeStarValue = (value: unknown): string => {
    if (value === null || value === undefined) {
        return '';
    }
    if (Array.isArray(value)) {
        return value.join('、');
    }
    return String(value);
};

const normalizeJobKeywords = (keywords?: string[]): string[] => {
    return (keywords || [])
        .map((keyword) => keyword.trim())
        .filter(Boolean);
};

const buildJDTextSignature = (value: string) => {
    const trimmed = value.trim();
    return trimmed || EMPTY_TEXT_SIGNATURE;
};

const buildExperienceSignature = (items: ResumeExperienceView[]) => {
    const normalized = items.map((item) => ({
        id: item.id,
        versionId: item.experienceVersionId || '',
        title: item.title,
        company: item.company,
        startDate: item.startDate || '',
        endDate: item.endDate || '',
        isCurrent: Boolean(item.isCurrent),
        star: item.star,
    }));
    normalized.sort((a, b) => a.id.localeCompare(b.id));
    return JSON.stringify(normalized);
};

const buildStarFields = (star?: Record<string, any>): StarFields => ({
    s: normalizeStarValue(star?.s),
    t: normalizeStarValue(star?.t),
    a: normalizeStarValue(star?.a),
    r: normalizeStarValue(star?.r),
});

const normalizeEducationStar = (star?: Record<string, any>) => ({
    degree: normalizeStarValue(star?.degree),
    gpa: normalizeStarValue(star?.gpa),
    courses: normalizeStarValue(star?.courses),
});

const formatYearMonth = (value?: string): string => {
    if (!value) {
        return '';
    }
    const trimmed = value.trim();
    if (!trimmed) {
        return '';
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        return trimmed.slice(0, 7).replace('-', '.');
    }
    if (/^\d{4}-\d{2}$/.test(trimmed)) {
        return trimmed.replace('-', '.');
    }
    return trimmed.replace('-', '.');
};

const buildExperienceDate = (start?: string, end?: string, isCurrent?: boolean) => {
    const startText = formatYearMonth(start);
    const endText = isCurrent ? '至今' : formatYearMonth(end);
    if (startText && endText) {
        return `${startText} - ${endText}`;
    }
    return startText || endText || '';
};

const buildEducationView = (item: ExperienceListItem): EducationView => {
    const latest = item.latest_version;
    const star = normalizeEducationStar(latest?.star);
    return {
        id: item.master.id,
        school: latest?.org || '',
        major: latest?.title || '',
        degree: star.degree || '',
        startDate: formatYearMonth(latest?.start_date),
        endDate: formatYearMonth(latest?.end_date),
        gpa: star.gpa || undefined,
        courses: star.courses || undefined,
    };
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

const buildCertificationView = (cert: CertificationRecord): CertificationView => ({
    id: cert.id,
    name: cert.name || '',
    issuer: cert.issuer || '',
    date: formatYearMonth(cert.issue_date),
    matchRate: parseCertificationMatchRate(cert.description),
});

const resolveSkillCategoryName = (category?: string) => {
    const trimmed = (category || '').trim();
    return trimmed || '未分类';
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

const sortByDateDesc = (items: ResumeExperienceView[]) => {
    return [...items].sort((a, b) => {
        const valA = parseYearMonthValue(a.startDate) ?? -1;
        const valB = parseYearMonthValue(b.startDate) ?? -1;
        return valB - valA;
    });
};

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

const compareByScoreThenDate = (a: ResumeExperienceView, b: ResumeExperienceView) => {
    const scoreA = a.matchScore ?? -1;
    const scoreB = b.matchScore ?? -1;
    if (scoreA !== scoreB) {
        return scoreB - scoreA;
    }
    return compareByDateDesc(a, b);
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

const ResumeEditor: React.FC = () => {
    const [isDarkMode, setIsDarkMode] = useState(false);
    const [resumeId, setResumeId] = useState<string | null>(null);
    const [resumeDetail, setResumeDetail] = useState<ResumeDetail | null>(null);
    const [resumeExperienceMap, setResumeExperienceMap] = useState<Map<string, ResumeExperienceItem>>(
        new Map()
    );
    const [experienceSourceMap, setExperienceSourceMap] = useState<Map<string, ExperienceListItem>>(
        new Map()
    );
    const [isLoadingExperiences, setIsLoadingExperiences] = useState(true);
    const [isLoadingResume, setIsLoadingResume] = useState(true);
    const [saveState, setSaveState] = useState<'idle' | 'dirty' | 'saving' | 'saved' | 'error'>('idle');
    const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
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

    // 证书与技能状态
    const [certifications, setCertifications] = useState<CertificationView[]>([]);
    const [skillGroups, setSkillGroups] = useState<SkillGroupView[]>([]);

    // 教育背景/证书/技能选择状态
    const [selectedEduIds, setSelectedEduIds] = useState<Set<string>>(new Set());
    const [selectedCertIds, setSelectedCertIds] = useState<Set<string>>(new Set());
    const [selectedSkillIds, setSelectedSkillIds] = useState<Set<string>>(new Set());

    // 2. Experience State
    const [experienceItems, setExperienceItems] = useState<ResumeExperienceView[]>([]);
    const [selectedExpIds, setSelectedExpIds] = useState<Set<string>>(new Set());
    const [editingExpId, setEditingExpId] = useState<string | null>(null);
    const [editingDraft, setEditingDraft] = useState<ExperienceEditDraft | null>(null);
    const [syncToMaster, setSyncToMaster] = useState(true);
    const [isSavingExperience, setIsSavingExperience] = useState(false);

    // 3. JD Analysis State
    const [jdText, setJdText] = useState(DEFAULT_JD_TEXT);
    const [analysisResult, setAnalysisResult] = useState<JDAnalysisResult | null>(null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [isJDCollapsed, setIsJDCollapsed] = useState(false);
    const [analysisContext, setAnalysisContext] = useState<JDAnalysisContext | null>(null);

    // 4. UI State
    const [sidebarTab, setSidebarTab] = useState<'profile' | 'experience'>('experience');
    const [density, setDensity] = useState<'compact' | 'standard' | 'spacious'>('standard');

    // Drag & Drop State
    const [draggedItemId, setDraggedItemId] = useState<string | null>(null);

    // Section Order State (for draggable resume sections)
    const [sectionOrder, setSectionOrder] = useState<string[]>(
        () => [...DEFAULT_SECTION_ORDER]
    );
    const [draggedSectionId, setDraggedSectionId] = useState<string | null>(null);
    const previewRef = useRef<HTMLDivElement | null>(null);
    const a4HeightRef = useRef<number | null>(null);
    const lastSavedConfigRef = useRef<string | null>(null);
    const hasHydratedConfigRef = useRef(false);
    const hasLoadedJdCacheRef = useRef(false);
    const experienceSignature = useMemo(
        () => buildExperienceSignature(experienceItems),
        [experienceItems]
    );
    const jdTextSignature = useMemo(
        () => buildJDTextSignature(jdText),
        [jdText]
    );
    const jobKeywords = useMemo(
        () => normalizeJobKeywords(analysisResult?.jobKeywords),
        [analysisResult]
    );
    const isProfileReadOnly = !isEditingProfile || isSavingProfile;
    const applyExperienceMatchScores = useCallback(
        (matches?: Array<{ id: string; score: number }>) => {
            const matchScores = new Map(
                (matches || []).map((match) => [match.id, match.score])
            );
            setExperienceItems((prev) => {
                const next = prev.map((item) => ({
                    ...item,
                    matchScore: matchScores.has(item.id)
                        ? matchScores.get(item.id)
                        : undefined,
                }));
                const comparator = matchScores.size > 0
                    ? compareByScoreThenDate
                    : compareByDateDesc;
                return sortByCategory(next, comparator);
            });
        },
        []
    );
    const resetJDAnalysisState = useCallback(
        (options?: { resetJdText?: boolean; clearCache?: boolean }) => {
            setAnalysisResult(null);
            setAnalysisContext(null);
            setIsJDCollapsed(false);
            applyExperienceMatchScores();
            if (options?.resetJdText) {
                setJdText(DEFAULT_JD_TEXT);
            }
            if (options?.clearCache && resumeId) {
                clearJDAnalysisCache(resumeId);
            }
        },
        [applyExperienceMatchScores, resumeId]
    );

    useEffect(() => {
        if (!resumeId) {
            return;
        }
        hasLoadedJdCacheRef.current = false;
        resetJDAnalysisState({ resetJdText: true, clearCache: false });
    }, [resetJDAnalysisState, resumeId]);

    useEffect(() => {
        if (!resumeId || isLoadingExperiences || hasLoadedJdCacheRef.current) {
            return;
        }
        const cached = loadJDAnalysisCache(resumeId);
        if (cached && cached.experienceSignature === experienceSignature) {
            setJdText(cached.jdText);
            setAnalysisResult(cached.result);
            setAnalysisContext({
                jdTextSignature: buildJDTextSignature(cached.jdText),
                experienceSignature: cached.experienceSignature,
            });
            applyExperienceMatchScores(cached.result.experienceMatches);
            setIsJDCollapsed(true);
        } else if (cached) {
            clearJDAnalysisCache(resumeId);
        }
        hasLoadedJdCacheRef.current = true;
    }, [applyExperienceMatchScores, experienceSignature, isLoadingExperiences, resumeId]);

    useEffect(() => {
        if (!analysisContext || !resumeId) {
            return;
        }
        if (analysisContext.experienceSignature !== experienceSignature) {
            resetJDAnalysisState({ clearCache: true });
        }
    }, [analysisContext, experienceSignature, resetJDAnalysisState]);

    useEffect(() => {
        if (!analysisContext || !resumeId) {
            return;
        }
        if (analysisContext.jdTextSignature !== jdTextSignature) {
            resetJDAnalysisState({ clearCache: true });
        }
    }, [analysisContext, jdTextSignature, resetJDAnalysisState]);

    const ensureActiveResumeId = useCallback(async (resumes: Resume[]) => {
        if (resumes.length > 0) {
            setActiveResumeId(resumes[0].id);
            return resumes[0].id;
        }
        const created = await resumeService.create({ title: DEFAULT_RESUME_TITLE });
        setActiveResumeId(created.id);
        return created.id;
    }, []);

    const resolveCachedResume = useCallback(
        async (cachedId: string): Promise<CachedResumeResolveResult> => {
            try {
                const detail = await resumeService.get(cachedId);
                return { status: 'ok', detail };
            } catch (error) {
                const status =
                    typeof error === 'object' && error
                        ? (error as { response?: { status?: number } }).response?.status
                        : undefined;
                if (status === 404) {
                    return { status: 'missing' };
                }
                return { status: 'error' };
            }
        },
        []
    );

    const resolveActiveResumeContext = useCallback(async (): Promise<ActiveResumeContext> => {
        const cachedId = getActiveResumeId();
        if (cachedId) {
            const cached = await resolveCachedResume(cachedId);
            if (cached.status === 'ok') {
                return { id: cachedId, detail: cached.detail };
            }
            if (cached.status === 'missing') {
                clearActiveResumeId();
                const resumes = await resumeService.list({ force: true });
                const id = await ensureActiveResumeId(resumes);
                return { id, detail: null };
            }
            return { id: cachedId, detail: null };
        }
        const resumes = await resumeService.list();
        const id = await ensureActiveResumeId(resumes);
        return { id, detail: null };
    }, [ensureActiveResumeId, resolveCachedResume]);

    const fetchExperiences = useCallback(async () => {
        const [workItems, projectItems] = await Promise.all([
            experienceService.list('work'),
            experienceService.list('project'),
        ]);
        return [...workItems, ...projectItems];
    }, []);

    const fetchEducationExperiences = useCallback(async () => {
        return experienceService.list('education');
    }, []);

    const fetchCertifications = useCallback(async () => {
        return certificationsService.list();
    }, []);

    const fetchSkills = useCallback(async () => {
        return skillsService.list();
    }, []);

    const applyResumeDetail = useCallback((detail: ResumeDetail | null) => {
        setResumeDetail(detail);
        setResumeExperienceMap(buildResumeExperienceMap(detail));
    }, []);

    const resolveA4Height = useCallback(() => {
        if (!a4HeightRef.current) {
            a4HeightRef.current = getA4PixelHeight();
        }
        return a4HeightRef.current;
    }, []);

    const applySmartScale = useCallback(() => {
        const preview = previewRef.current;
        if (!preview) {
            return;
        }
        const contentHeight = preview.getBoundingClientRect().height;
        const a4Height = resolveA4Height();
        if (!a4Height || !contentHeight) {
            return;
        }
        const currentScale = resumeScale || 1;
        const unscaledHeight = currentScale !== 1 ? contentHeight / currentScale : contentHeight;
        const nextScale =
            unscaledHeight > a4Height ? Math.max(0.86, a4Height / unscaledHeight) : 1;
        setResumeScale(Number(nextScale.toFixed(3)));
    }, [resolveA4Height, resumeScale]);

    const adjustToSinglePage = useCallback(() => {
        setDensity('compact');
        requestAnimationFrame(() => {
            applySmartScale();
        });
    }, [applySmartScale]);

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

    const debouncedConfig = useDebounce(resumeConfigSnapshot, AUTO_SAVE_DELAY_MS);
    const debouncedConfigSignature = useMemo(
        () => JSON.stringify(debouncedConfig),
        [debouncedConfig]
    );
    const configSignature = useMemo(
        () => JSON.stringify(resumeConfigSnapshot),
        [resumeConfigSnapshot]
    );

    const applyResumeConfig = useCallback(
        (config: ResumeEditorConfig, profileData?: Profile | null) => {
            const syncMode = resolveProfileSyncMode(config, profileData || undefined);
            setProfileSyncMode(syncMode);
            if (profileData) {
                setProfileSocialLinks({ ...(profileData.social_links || {}) });
            }
            setProfile(resolveProfileSnapshot(config, profileData || undefined));
            setSectionOrder(normalizeSectionOrder(config.layout?.sectionOrder));
            if (config.layout?.density) {
                setDensity(config.layout.density);
            }
        },
        []
    );

    const applyExperienceState = useCallback(
        (detail: ResumeDetail | null, experiences: ExperienceListItem[], config: ResumeEditorConfig) => {
            applyResumeDetail(detail);
            setExperienceSourceMap(buildSourceMap(experiences));
            const resumeMap = buildResumeExperienceMap(detail);
            const views = sortByCategory(
                experiences.map((item) =>
                    buildResumeExperienceView(item, resumeMap.get(item.master.id))
                ),
                compareByDateDesc
            );
            setExperienceItems(views);
            const configSelection = resolveSelectionSet(config.selection?.experienceIds);
            if (configSelection.size > 0) {
                setSelectedExpIds(configSelection);
            } else if (resumeMap.size > 0) {
                setSelectedExpIds(new Set(resumeMap.keys()));
            } else {
                setSelectedExpIds(new Set(views.map((item) => item.id)));
            }
        },
        [applyResumeDetail]
    );

    const applyEducationState = useCallback((items: ExperienceListItem[], config: ResumeEditorConfig) => {
        const views = items.map(buildEducationView);
        setEducations(views);
        const selection = resolveSelectionSet(config.selection?.educationIds);
        const validIds = new Set(views.map((item) => item.id));
        const normalized = new Set([...selection].filter((id) => validIds.has(id)));
        setSelectedEduIds(normalized.size ? normalized : new Set(validIds));
    }, []);

    const applyCertificationState = useCallback(
        (items: CertificationRecord[], config: ResumeEditorConfig) => {
            const views = items.map(buildCertificationView);
            setCertifications(views);
            const selection = resolveSelectionSet(config.selection?.certificationIds);
            const validIds = new Set(views.map((item) => item.id));
            const normalized = new Set([...selection].filter((id) => validIds.has(id)));
            setSelectedCertIds(normalized.size ? normalized : new Set(validIds));
        },
        []
    );

    const applySkillState = useCallback((items: UserSkill[], config: ResumeEditorConfig) => {
        const groups = buildSkillGroups(items);
        setSkillGroups(groups);
        const selection = resolveSelectionSet(config.selection?.skillIds);
        const validIds = new Set(items.map((skill) => skill.id));
        const normalized = new Set([...selection].filter((id) => validIds.has(id)));
        setSelectedSkillIds(normalized.size ? normalized : new Set(validIds));
    }, []);

    useEffect(() => {
        let cancelled = false;
        const loadResumeContext = async () => {
            setIsLoadingResume(true);
            setIsLoadingExperiences(true);
            try {
                const { id: activeId, detail: cachedDetail } = await resolveActiveResumeContext();
                if (!activeId || cancelled) {
                    return;
                }
                setResumeId(activeId);
                const [
                    detail,
                    profileData,
                    experiences,
                    educationExperiences,
                    certifications,
                    skills,
                ] = await Promise.all([
                    cachedDetail ?? resumeService.get(activeId).catch(() => null),
                    profileService.getProfile().catch(() => null),
                    fetchExperiences(),
                    fetchEducationExperiences(),
                    fetchCertifications(),
                    fetchSkills(),
                ]);
                if (cancelled) {
                    return;
                }
                const config = (detail?.resume?.config || {}) as ResumeEditorConfig;
                applyResumeConfig(config, profileData);
                applyExperienceState(detail, experiences, config);
                applyEducationState(educationExperiences, config);
                applyCertificationState(certifications, config);
                applySkillState(skills, config);
                hasHydratedConfigRef.current = true;
            } catch (error) {
                console.error('[ResumeEditor] 加载简历上下文失败:', error);
            } finally {
                if (!cancelled) {
                    setIsLoadingResume(false);
                    setIsLoadingExperiences(false);
                }
            }
        };
        loadResumeContext();
        return () => {
            cancelled = true;
        };
    }, [
        applyCertificationState,
        applyEducationState,
        applyExperienceState,
        applyResumeConfig,
        applySkillState,
        fetchCertifications,
        fetchEducationExperiences,
        fetchExperiences,
        fetchSkills,
        resolveActiveResumeContext,
    ]);

    useEffect(() => {
        if (!hasHydratedConfigRef.current) {
            return;
        }
        if (lastSavedConfigRef.current === null) {
            lastSavedConfigRef.current = configSignature;
            setSaveState('saved');
        } else if (configSignature !== lastSavedConfigRef.current && saveState !== 'saving') {
            setSaveState('dirty');
        } else if (configSignature === lastSavedConfigRef.current && saveState !== 'saving') {
            setSaveState('saved');
        }
    }, [configSignature, saveState]);

    useEffect(() => {
        if (!resumeId || !hasHydratedConfigRef.current) {
            return;
        }
        if (debouncedConfigSignature === lastSavedConfigRef.current) {
            return;
        }
        setSaveState('saving');
        resumeService
            .update(resumeId, { config: debouncedConfig })
            .then(() => {
                lastSavedConfigRef.current = debouncedConfigSignature;
                setSaveState('saved');
                setLastSavedAt(new Date().toLocaleTimeString());
            })
            .catch((error) => {
                console.error('[ResumeEditor] 自动保存失败:', error);
                setSaveState('error');
            });
    }, [debouncedConfig, debouncedConfigSignature, resumeId]);

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

    const handleAnalyze = async () => {
        setIsAnalyzing(true);
        try {
            const payload = experienceItems.map((item) => ({
                id: item.id,
                title: item.title,
                org: item.company,
                start_date: item.startDate,
                end_date: item.endDate,
                star: item.star,
            }));
            const result = await aiService.analyzeJD(
                jdText,
                JSON.stringify(payload)
            );
            applyExperienceMatchScores(result.experienceMatches);
            setAnalysisResult(result);
            setAnalysisContext({
                jdTextSignature,
                experienceSignature,
            });
            if (resumeId) {
                saveJDAnalysisCache(resumeId, {
                    jdText,
                    experienceSignature,
                    result,
                });
            }
            setIsJDCollapsed(true);
        } catch (error) {
            console.error("Failed to analyze JD", error);
        } finally {
            setIsAnalyzing(false);
        }
    };

    const toggleExperienceSelection = (id: string) => {
        const newSet = new Set(selectedExpIds);
        if (newSet.has(id)) {
            newSet.delete(id);
        } else {
            newSet.add(id);
        }
        setSelectedExpIds(newSet);
    };

    // 教育背景/证书/技能选择切换函数
    const toggleEducationSelection = (id: string) => {
        const newSet = new Set(selectedEduIds);
        newSet.has(id) ? newSet.delete(id) : newSet.add(id);
        setSelectedEduIds(newSet);
    };

    const toggleCertificationSelection = (id: string) => {
        const newSet = new Set(selectedCertIds);
        newSet.has(id) ? newSet.delete(id) : newSet.add(id);
        setSelectedCertIds(newSet);
    };

    const toggleSkillSelection = (id: string) => {
        const newSet = new Set(selectedSkillIds);
        newSet.has(id) ? newSet.delete(id) : newSet.add(id);
        setSelectedSkillIds(newSet);
    };

    const updateEditingStar = (field: StarFieldKey, value: string) => {
        setEditingDraft((prev) => {
            if (!prev) {
                return prev;
            }
            return {
                ...prev,
                star: {
                    ...prev.star,
                    [field]: value,
                },
            };
        });
    };

    const hasLocalStarOverride = useCallback(
        (masterId: string) => {
            const resumeItem = resumeExperienceMap.get(masterId);
            return Boolean(resumeItem?.overrides_json?.star);
        },
        [resumeExperienceMap]
    );

    const startEditingExperience = (id: string) => {
        const item = experienceItems.find((entry) => entry.id === id);
        if (!item) {
            return;
        }
        setEditingExpId(id);
        setEditingDraft({
            masterId: id,
            star: { ...item.star },
        });
        setSyncToMaster(!hasLocalStarOverride(id));
    };

    const cancelEditingExperience = () => {
        setEditingExpId(null);
        setEditingDraft(null);
    };

    const applyStarUpdate = (masterId: string, star: StarFields) => {
        setExperienceItems((prev) =>
            prev.map((item) =>
                item.id === masterId
                    ? {
                        ...item,
                        star,
                    }
                    : item
            )
        );
    };

    const buildMasterUpdatePayload = (source: ExperienceListItem, star: StarFields) => {
        const latest = source.latest_version;
        return {
            title: latest?.title || '',
            org: latest?.org,
            location: latest?.location,
            start_date: latest?.start_date,
            end_date: latest?.end_date,
            is_current: latest?.is_current ?? false,
            summary: latest?.summary,
            highlights: latest?.highlights || [],
            tags: latest?.tags || [],
            star,
        };
    };

    const syncExperienceToMaster = async (masterId: string, star: StarFields) => {
        const source = experienceSourceMap.get(masterId);
        if (!source?.latest_version?.title) {
            throw new Error('缺少经历标题，无法同步到经历库');
        }
        const payload = buildMasterUpdatePayload(source, star);
        const detail: ExperienceDetail = await experienceService.update(masterId, { version: payload });
        const updatedVersion = detail.latest_version || source.latest_version;
        setExperienceSourceMap((prev) => {
            const next = new Map(prev);
            next.set(masterId, {
                ...source,
                latest_version: updatedVersion,
            });
            return next;
        });
        applyStarUpdate(masterId, buildStarFields(updatedVersion?.star || star));
    };

    const ensureResumeLink = async (masterId: string, versionId?: string) => {
        if (!resumeId) {
            return null;
        }
        const existing = resumeExperienceMap.get(masterId);
        if (existing?.id) {
            return existing.id;
        }
        if (!versionId) {
            return null;
        }
        const detail = await resumeService.updateAssembly(resumeId, {
            operations: [
                {
                    op: 'add',
                    experience_version_id: versionId,
                },
            ],
        });
        applyResumeDetail(detail);
        const nextMap = buildResumeExperienceMap(detail);
        return nextMap.get(masterId)?.id ?? null;
    };

    const saveExperienceOverride = async (masterId: string, star: StarFields) => {
        const targetItem = experienceItems.find((item) => item.id === masterId);
        const linkId = await ensureResumeLink(masterId, targetItem?.experienceVersionId);
        if (!linkId || !resumeId) {
            throw new Error('无法创建简历经历关联');
        }
        const detail = await resumeService.updateAssembly(resumeId, {
            operations: [
                {
                    op: 'override',
                    resume_experience_id: linkId,
                    overrides_json: { star },
                },
            ],
        });
        applyResumeDetail(detail);
        applyStarUpdate(masterId, star);
        setSelectedExpIds((prev) => new Set(prev).add(masterId));
    };

    const handleSaveExperience = async () => {
        if (!editingDraft) {
            return;
        }
        setIsSavingExperience(true);
        try {
            if (syncToMaster) {
                await syncExperienceToMaster(editingDraft.masterId, editingDraft.star);
            } else {
                await saveExperienceOverride(editingDraft.masterId, editingDraft.star);
            }
            setEditingExpId(null);
            setEditingDraft(null);
        } catch (error) {
            console.error('[ResumeEditor] 保存经历失败:', error);
        } finally {
            setIsSavingExperience(false);
        }
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
        compact: 'mb-3',
        standard: 'mb-6',
        spacious: 'mb-8'
    }[density];

    const listSpacingClass = {
        compact: 'space-y-2',
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

    const renderExperienceListSection = (
        title: string,
        items: ResumeExperienceView[],
        icon?: React.ReactNode,
        theme: 'primary' | 'project' = 'primary'
    ) => {
        if (!items.length) {
            return null;
        }

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

        return (
            <div className="space-y-3">
                <div className="flex items-center gap-2 mb-2">
                    {icon}
                    <h4 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{title}</h4>
                </div>
                {items.map((item) => {
                    const isSelected = selectedExpIds.has(item.id);
                    return (
                        <div key={item.id} className={`bg-white dark:bg-gray-800 border rounded-xl p-3 shadow-sm transition-all group relative ${isSelected ? `${themeStyles.borderSelected} ring-1 ${themeStyles.ringSelected}` : 'border-gray-200 dark:border-gray-700 opacity-70 hover:opacity-100'}`}>
                            <div className="flex items-start gap-3">
                                <div className="pt-1">
                                    <input
                                        type="checkbox"
                                        checked={isSelected}
                                        onChange={() => toggleExperienceSelection(item.id)}
                                        className={`w-4 h-4 rounded border-gray-300 ${themeStyles.checkboxtext} ${themeStyles.checkboxFocus} cursor-pointer`}
                                    />
                                </div>
                                <div className="flex-1 cursor-pointer" onClick={() => startEditingExperience(item.id)}>
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <h4 className={`font-bold text-sm ${isSelected ? themeStyles.titleSelected : 'text-gray-500'}`}>{item.company}</h4>
                                            <p className="text-xs text-gray-500">{item.title}</p>
                                        </div>
                                        <button
                                            className={`p-1.5 text-gray-300 rounded transition-colors ${themeStyles.editHoverData}`}
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                startEditingExperience(item.id);
                                            }}
                                        >
                                            <Edit3 className="w-4 h-4" />
                                        </button>
                                    </div>
                                    <div className="flex items-center justify-between mt-2">
                                        <p className="text-[10px] text-gray-400 font-mono">{item.date}</p>
                                        {typeof item.matchScore === 'number' && (
                                            <span className="text-[10px] font-semibold text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 px-2 py-0.5 rounded-full">
                                                匹配度 {item.matchScore}%
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        );
    };

    const renderCertificationListSection = (title: string, items: CertificationView[]) => {
        if (!items.length) {
            return null;
        }
        return (
            <div className="space-y-3">
                <div className="flex items-center gap-2 mb-2">
                    <Award className="w-3.5 h-3.5 text-amber-500" />
                    <h4 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{title}</h4>
                </div>
                {items.map((cert) => {
                    const isSelected = selectedCertIds.has(cert.id);
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
                                        <span className="text-xs text-gray-400 font-mono shrink-0 ml-2">{cert.date}</span>
                                    </div>
                                    {cert.issuer && (
                                        <p className="text-xs text-gray-500 dark:text-gray-400 mb-2 truncate">{cert.issuer}</p>
                                    )}
                                    {typeof cert.matchRate === 'number' && cert.matchRate > 0 && (
                                        <div className="flex items-center gap-1.5">
                                            <div className="h-1.5 flex-1 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                                                <div
                                                    className="h-full bg-amber-500 rounded-full"
                                                    style={{ width: `${cert.matchRate}%` }}
                                                />
                                            </div>
                                            <span className="text-[10px] font-medium text-amber-600 dark:text-amber-500">{cert.matchRate}%</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        );
    };

    const renderSkillListSection = (title: string, groups: SkillGroupView[]) => {
        if (!groups.length) {
            return null;
        }
        return (
            <div className="space-y-4">
                <div className="flex items-center gap-2 mb-2">
                    <Wrench className="w-3.5 h-3.5 text-rose-500" />
                    <h4 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{title}</h4>
                </div>
                {groups.map((group) => (
                    <div
                        key={group.name}
                        className="bg-white dark:bg-gray-800 rounded-xl border border-rose-500/30 shadow-sm hover:shadow-md transition-all overflow-hidden"
                    >
                        <div className="bg-rose-50/50 dark:bg-rose-900/10 px-3 py-2 border-b border-rose-100 dark:border-rose-800/30">
                            <h5 className="text-xs font-bold text-rose-700 dark:text-rose-400">{group.name}</h5>
                        </div>
                        <div className="p-3 bg-white dark:bg-gray-800/50">
                            <div className="flex flex-wrap gap-2">
                                {group.skills.map((skill) => {
                                    const isSelected = selectedSkillIds.has(skill.id);
                                    return (
                                        <label
                                            key={skill.id}
                                            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs cursor-pointer transition-all select-none ${isSelected
                                                ? 'border-rose-500 bg-rose-500 text-white shadow-sm shadow-rose-200 dark:shadow-none'
                                                : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-rose-300 dark:hover:border-rose-700 bg-gray-50 dark:bg-gray-800'
                                                }`}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={isSelected}
                                                onChange={() => toggleSkillSelection(skill.id)}
                                                className="hidden" // Hidden checkbox, utilizing the label style for state
                                            />
                                            {isSelected && <CheckCircle2 className="w-3 h-3 text-white" />}
                                            <span>{skill.name}</span>
                                        </label>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                ))}
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
                    <div className="flex bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
                        <button
                            onClick={() => { setDensity('compact'); setResumeScale(1); }}
                            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${density === 'compact' ? 'bg-white dark:bg-gray-600 shadow text-primary dark:text-white' : 'text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-700'}`}
                        >
                            紧凑
                        </button>
                        <button
                            onClick={() => { setDensity('standard'); setResumeScale(1); }}
                            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${density === 'standard' ? 'bg-white dark:bg-gray-600 shadow text-primary dark:text-white' : 'text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-700'}`}
                        >
                            标准
                        </button>
                        <button
                            onClick={() => { setDensity('spacious'); setResumeScale(1); }}
                            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${density === 'spacious' ? 'bg-white dark:bg-gray-600 shadow text-primary dark:text-white' : 'text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-700'}`}
                        >
                            宽敞
                        </button>
                    </div>
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

                    {/* Compact JD Panel */}
                    <div className={`border-b border-border-light dark:border-border-dark bg-gray-50/50 dark:bg-gray-800/30 transition-all duration-300 ease-in-out flex flex-col ${JD_PANEL_BOTTOM_SPACING_CLASS} ${isJDCollapsed ? 'h-auto py-3' : 'h-auto py-4'}`}>
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
                            {isJDCollapsed ? (
                                // Collapsed State
                                <div className="space-y-2">
                                    <div className="flex items-center gap-3">
                                        <div className="flex items-center gap-1.5 bg-white dark:bg-gray-900 border border-emerald-200 dark:border-emerald-800/50 rounded-full pl-3 pr-2 py-1 shadow-sm">
                                            <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
                                                匹配度: {analysisResult?.matchPercentage || 0}%
                                            </span>
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
                            ) : (
                                // Expanded State
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
                                                <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400">匹配度: {analysisResult.matchPercentage}%</span>
                                                <span className="text-[10px] text-emerald-600/80">
                                                    Missing: {(analysisResult.missingKeywords || []).join(', ')}
                                                </span>
                                            </div>
                                            <p className="text-[10px] text-emerald-800 dark:text-emerald-300/80 leading-relaxed">{analysisResult.summary}</p>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Tab Navigation (Swapped order) */}
                    <div className="flex border-b border-border-light dark:border-border-dark bg-white dark:bg-surface-dark">
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
                                                同步修改全部简历
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
                                    <h3 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase mb-3">教育背景</h3>
                                    <div className="space-y-2">
                                        {educations.length === 0 ? (
                                            <p className="text-xs text-gray-400">暂无教育经历</p>
                                        ) : (
                                            educations.map((edu) => {
                                                const isSelected = selectedEduIds.has(edu.id);
                                                return (
                                                    <div
                                                        key={edu.id}
                                                        className={`p-3 rounded border transition-all ${isSelected
                                                            ? 'bg-gray-50 dark:bg-gray-900 border-primary ring-1 ring-primary'
                                                            : 'bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-700 opacity-60'
                                                            }`}
                                                    >
                                                        <div className="flex gap-3">
                                                            <input
                                                                type="checkbox"
                                                                checked={isSelected}
                                                                onChange={() => toggleEducationSelection(edu.id)}
                                                                className="w-4 h-4 mt-0.5 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer shrink-0"
                                                            />
                                                            <div className="flex-1 min-w-0">
                                                                <div className="flex justify-between items-start mb-1">
                                                                    <h4 className="text-sm font-bold text-gray-900 dark:text-white">{edu.school}</h4>
                                                                    <span className="text-xs text-gray-500 ml-2 shrink-0">{edu.startDate} - {edu.endDate}</span>
                                                                </div>
                                                                <p className="text-xs text-gray-600 dark:text-gray-400">{edu.major}</p>
                                                                <p className="text-xs text-gray-500 dark:text-gray-500">{edu.degree}</p>
                                                                {edu.gpa && <p className="text-xs text-gray-500 mt-1">GPA: {edu.gpa}</p>}
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })
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
                                        <h4 className="font-bold text-gray-900 dark:text-white">{editingItem?.company}</h4>
                                        <p className="text-xs text-gray-500">{editingItem?.title}</p>
                                    </div>

                                    {['s', 't', 'a', 'r'].map((key) => {
                                        const labelMap: any = { s: 'Situation (情境)', t: 'Task (任务)', a: 'Action (行动)', r: 'Result (结果)' };
                                        const colorMap: any = { s: 'text-blue-600', t: 'text-orange-600', a: 'text-amber-600', r: 'text-emerald-600' };
                                        return (
                                            <div key={key} className="space-y-1">
                                                <label className={`text-[10px] font-bold uppercase tracking-wider ${colorMap[key]} pl-1`}>
                                                    {labelMap[key]}
                                                </label>
                                                <textarea
                                                    className="w-full text-sm p-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all h-24 resize-none leading-relaxed"
                                                    value={editingDraft?.star?.[key as StarFieldKey] || ''}
                                                    onChange={(e) => updateEditingStar(key as StarFieldKey, e.target.value)}
                                                    placeholder={`Enter ${key.toUpperCase()}...`}
                                                />
                                            </div>
                                        )
                                    })}
                                    <div className="bg-white dark:bg-gray-800 p-3 rounded-lg border border-gray-200 dark:border-gray-700 flex items-center justify-between">
                                        <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
                                            <input
                                                type="checkbox"
                                                checked={syncToMaster}
                                                onChange={(e) => setSyncToMaster(e.target.checked)}
                                                className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary"
                                            />
                                            同步修改全部简历
                                        </label>
                                        <div className="flex items-center gap-2">
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
                                        'primary'
                                    )}
                                    {renderExperienceListSection(
                                        '项目经历',
                                        projectItems,
                                        <FolderKanban className="w-3.5 h-3.5 text-indigo-500" />,
                                        'project'
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
                                                    .map((edu) => (
                                                        <div key={edu.id} className="mb-2">
                                                            <div className="flex justify-between items-baseline mb-0.5">
                                                                <h3 className="text-sm font-bold text-gray-900">{edu.school}</h3>
                                                                <span className="text-xs font-medium text-gray-600">{edu.startDate} - {edu.endDate}</span>
                                                            </div>
                                                            <p className="text-xs text-gray-800">{edu.major}, {edu.degree}</p>
                                                            {edu.gpa && <p className="text-xs text-gray-600">GPA: {edu.gpa}</p>}
                                                        </div>
                                                    ))}
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
        </div>
    );
};

export default ResumeEditor;
