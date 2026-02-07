import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ConfirmDialog from '../../components/ConfirmDialog';
import PrintPortal from '../../components/PrintPortal';
import { ToastContainer, useToast } from '../../components/Toast';
import { useExperienceActions } from '../../hooks/useExperienceActions';
import { useJDAnalysis } from '../../hooks/useJDAnalysis';
import { usePrintJob } from '../../hooks/usePrintJob';
import { useResumeData } from '../../hooks/useResumeData';
import { profileService } from '../../services/profileService';
import { resumeService, type Resume as ResumeRecord } from '../../services/resumeService';
import type { JDAnalysisResult } from '../../services/aiService';
import type { Certification as CertificationRecord } from '../../services/certificationsService';
import type { ExperienceListItem } from '../../services/experienceService';
import type {
    CertificationView,
    EducationView,
    ProfileSyncMode,
    ResumeEditorProfile,
    ResumeLayoutOrders,
    ResumeExperienceView,
    SkillGroupView,
} from '../../types/resume';
import type { Resume as DashboardResume } from '../../types';
import { buildExperienceDate } from '../../utils/dateUtils';
import { buildStarFields, mergeStarFieldsWithSource } from '../../utils/resumeHelpers';
import { mergeLinkedInLink } from '../profileUtils';
import { type DropPosition, moveItemWithDropPosition } from '../../utils/dragSort';
import { formatRelativeTime } from '../../utils/timeUtils';
import { buildResumeExportTitle } from '../../utils/exportFilename';
import { DEFAULT_RESUME_TITLE } from '../../constants/resumeConstants';
import {
    AUTO_SAVE_DELAY_MS,
    A4_HEIGHT_MM,
    CERTIFICATION_DRAFT_PREFIX,
    CONFIRM_DELETE_CERTIFICATION_TEXT,
    CONFIRM_DELETE_CERTIFICATION_TITLE,
    CONFIRM_DELETE_EDUCATION_TEXT,
    CONFIRM_DELETE_EDUCATION_TITLE,
    CONFIRM_DELETE_EXPERIENCE_TEXT,
    CONFIRM_DELETE_EXPERIENCE_TITLE,
    CONFIRM_DELETE_SKILL_CATEGORY_TEXT,
    CONFIRM_DELETE_SKILL_CATEGORY_TITLE,
    CONFIRM_DELETE_SKILL_TEXT,
    CONFIRM_DELETE_SKILL_TITLE,
    DEFAULT_PROFILE,
    DEFAULT_EXPERIENCE_TITLE_BY_CATEGORY,
    DEFAULT_EXPERIENCE_COMPANY_BY_CATEGORY,
    DEFAULT_SECTION_ORDER,
    DEFAULT_SKILL_CATEGORY,
    DEFAULT_SKILL_NAME,
    EDUCATION_DRAFT_PREFIX,
    EXPERIENCE_DRAFT_PREFIX,
    FONT_SIZE_DEFAULT,
    FONT_SIZE_MIN,
    FONT_SIZE_STEP,
    LINE_HEIGHT_DEFAULT,
    LINE_HEIGHT_MIN,
    LINE_HEIGHT_STEP,
    LIST_SPACING_BY_DENSITY,
    PREVIEW_PADDING_MM,
    PROFILE_SYNC_MODES,
    SMART_PAGE_ADJUSTING_TOAST_DURATION_MS,
    SMART_PAGE_BOTTOM_GAP_MM,
    SMART_PAGE_HEIGHT_TOLERANCE,
    SMART_PAGE_TOAST_MESSAGES,
} from './constants';
import { parseDragItemKey } from './dragKeys';
import {
    buildCertificationDraft,
    buildCertificationPayload,
    buildCertificationView,
    buildProfileFromService,
    buildDraftCertificationView,
    buildDraftEducationView,
    buildDraftExperienceView,
    buildEducationDraft,
    buildEducationVersionPayload,
    buildEducationView,
    buildExperienceEditDraft,
    buildResumeConfigSnapshot,
    buildResumeExperienceMap,
    buildResumeExperienceView,
    buildSkillGroups,
    buildSourceMap,
    compareByDateDesc,
    compareCertificationByDateDesc,
    getA4PixelHeight,
    isPresentLabel,
    mergeStarFields,
    normalizeSectionOrder,
    resolveEducationDatePayload,
    resolveExperienceDatePayload,
    resolveProfileSnapshot,
    resolveProfileSyncMode,
    resolveSafeDateRange,
    resolveSelectionSet,
    sortByCategory,
} from './helpers';
import EditorSidebar from './components/EditorSidebar';
import EditorToolbar from './components/EditorToolbar';
import ResumePreview from './components/ResumePreview';

const buildLineHeightSteps = (start: number, min: number, step: number) => {
    const steps: number[] = [];
    for (let value = start; value >= min; value -= step) {
        steps.push(Number(value.toFixed(2)));
    }
    if (steps[steps.length - 1] !== min) {
        steps.push(min);
    }
    return steps;
};

const LINE_HEIGHT_STEPS = buildLineHeightSteps(LINE_HEIGHT_DEFAULT, LINE_HEIGHT_MIN, LINE_HEIGHT_STEP);
const REDUCED_LINE_HEIGHT_STEPS = LINE_HEIGHT_STEPS.slice(1);

// 字号调整步骤（用于智能一页算法）
const buildFontSizeSteps = (start: number, min: number, step: number) => {
    const steps: number[] = [];
    for (let value = start; value >= min; value -= step) {
        steps.push(Number(value.toFixed(1)));
    }
    if (steps[steps.length - 1] !== min) {
        steps.push(min);
    }
    return steps;
};

const FONT_SIZE_STEPS = buildFontSizeSteps(FONT_SIZE_DEFAULT, FONT_SIZE_MIN, FONT_SIZE_STEP);
const REDUCED_FONT_SIZE_STEPS = FONT_SIZE_STEPS.slice(1);

const RESUME_AUTO_NAME_SEPARATOR = ' - ';
const MAX_AUTO_NAME_PART_LENGTH = 40;
const JD_TITLE_PATTERNS = [
    /(?:职位|岗位|角色|招聘职位|招聘岗位|Position|Title)\s*[:：]\s*([^\n\r]+)/i,
    /(?:需求|开放岗位)\s*[:：]\s*([^\n\r]+)/i,
];
const JD_COMPANY_PATTERNS = [
    /(?:公司|企业|单位|组织|公司名称|公司名|Company|Organization)\s*[:：]\s*([^\n\r]+)/i,
];

const normalizeResumeTitle = (value: string) => value.trim();
const isDefaultResumeTitle = (value: string) => normalizeResumeTitle(value) === DEFAULT_RESUME_TITLE;

const sanitizeAutoNamePart = (value?: string) => {
    const trimmed = value?.trim() ?? '';
    if (!trimmed) {
        return '';
    }
    return trimmed.length > MAX_AUTO_NAME_PART_LENGTH
        ? trimmed.slice(0, MAX_AUTO_NAME_PART_LENGTH)
        : trimmed;
};

const extractFirstMatch = (text: string, patterns: RegExp[]) => {
    if (!text.trim()) {
        return '';
    }
    for (const pattern of patterns) {
        const match = pattern.exec(text);
        if (match?.[1]) {
            return sanitizeAutoNamePart(match[1]);
        }
    }
    return '';
};

const buildAutoResumeName = (jobTitle?: string, company?: string) => {
    const safeTitle = sanitizeAutoNamePart(jobTitle);
    const safeCompany = sanitizeAutoNamePart(company);
    if (safeTitle && safeCompany) {
        return `${safeTitle}${RESUME_AUTO_NAME_SEPARATOR}${safeCompany}`;
    }
    return safeTitle || safeCompany || '';
};

const resolveAutoResumeName = (analysisResult: JDAnalysisResult | null, jdText: string) => {
    if (!analysisResult) {
        return '';
    }
    const jobTitle = sanitizeAutoNamePart(analysisResult.jobTitle)
        || extractFirstMatch(jdText, JD_TITLE_PATTERNS);
    const company = sanitizeAutoNamePart(analysisResult.company)
        || extractFirstMatch(jdText, JD_COMPANY_PATTERNS);
    return buildAutoResumeName(jobTitle, company);
};

const resolveSmartPageAvailableHeight = (a4Height: number) => {
    const pxPerMm = a4Height / A4_HEIGHT_MM;
    const paddingPx = pxPerMm * PREVIEW_PADDING_MM;
    const requiredBottomGapPx = Math.max(paddingPx, pxPerMm * SMART_PAGE_BOTTOM_GAP_MM);
    return Math.max(0, a4Height - paddingPx - requiredBottomGapPx);
};

const isWithinAvailableHeight = (contentHeight: number, availableHeight: number) =>
    contentHeight + SMART_PAGE_HEIGHT_TOLERANCE <= availableHeight;

const buildSpacingValue = (baseSpacing: number, lineHeightValue: number) => {
    const scale = Math.min(1, lineHeightValue / LINE_HEIGHT_DEFAULT);
    // 用 em 而不是 rem：这样间距会跟随预览容器的 fontSize 缩放（智能一页阶段2会调整字号）。
    return `${(baseSpacing * scale).toFixed(3)}em`;
};

const resolveElementMarginBottom = (element: HTMLElement) => {
    const computed = window.getComputedStyle(element);
    const raw = computed.marginBottom;
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : 0;
};

// scrollHeight 不一定包含“最后一个子元素的 margin-bottom”（尤其在 margin 折叠时），用 rect + margin 兜底。
const resolveMeasuredContentHeight = (container: HTMLElement) => {
    const baseHeight = container.scrollHeight;
    const lastChild = container.lastElementChild;
    if (!(lastChild instanceof HTMLElement)) {
        return baseHeight;
    }
    const containerRect = container.getBoundingClientRect();
    const lastRect = lastChild.getBoundingClientRect();
    const trailingMargin = resolveElementMarginBottom(lastChild);
    const rectHeight = Math.max(0, lastRect.bottom - containerRect.top + trailingMargin);
    return Math.max(baseHeight, rectHeight);
};

type ResumeEditorProps = {
    cachedResumes?: DashboardResume[];
    onResumesUpdate?: (resumes: DashboardResume[]) => void;
};

const ResumeEditor: React.FC<ResumeEditorProps> = ({
    cachedResumes = [],
    onResumesUpdate,
}) => {
    const [isDarkMode, setIsDarkMode] = useState(false);
    const [lineHeight, setLineHeight] = useState(LINE_HEIGHT_DEFAULT);
    const [fontSize, setFontSize] = useState(FONT_SIZE_DEFAULT);
    const [isDragging, setIsDragging] = useState(false);
    const [isSmartPageApplied, setIsSmartPageApplied] = useState(false);
    const [resumeName, setResumeName] = useState(DEFAULT_RESUME_TITLE);
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
    const {
        toasts,
        success: showToastSuccess,
        error: showToastError,
        info: showToastInfo,
        closeToast,
    } = useToast();
    // Drag & Drop State
    const [draggedItemKey, setDraggedItemKey] = useState<string | null>(null);
    // Section Order State (for draggable resume sections)
    const [sectionOrder, setSectionOrder] = useState<string[]>(
        () => [...DEFAULT_SECTION_ORDER]
    );
    const [draggedSectionId, setDraggedSectionId] = useState<string | null>(null);
    const [isSummaryVisible, setIsSummaryVisible] = useState(false);
    const lastItemHoverKeyRef = useRef<string | null>(null);
    const lastSectionHoverKeyRef = useRef<string | null>(null);
    const previewRef = useRef<HTMLDivElement | null>(null);
    const previewContentRef = useRef<HTMLDivElement | null>(null);
    const printPreviewRef = useRef<HTMLDivElement | null>(null);
    const printPreviewContentRef = useRef<HTMLDivElement | null>(null);
    const a4HeightRef = useRef<number | null>(null);
    const smartPageAdjustingRef = useRef(false);
    const isUpdatingResumeNameRef = useRef(false);
    const { printContent, isPrinting, startPrint } = usePrintJob();

    const layoutOrders: ResumeLayoutOrders = useMemo(
        () => ({
            workExperienceIds: experienceItems.filter((item) => item.category === 'work').map((item) => item.id),
            projectExperienceIds: experienceItems.filter((item) => item.category === 'project').map((item) => item.id),
            educationIds: educations.map((item) => item.id),
            certificationIds: certifications.map((item) => item.id),
            skillGroupNames: skillGroups.map((group) => group.name),
        }),
        [certifications, educations, experienceItems, skillGroups]
    );

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
                density,
                isSummaryVisible,
                layoutOrders
            ),
        [
            density,
            isSummaryVisible,
            layoutOrders,
            profile,
            profileSyncMode,
            sectionOrder,
            selectedCertIds,
            selectedEduIds,
            selectedExpIds,
            selectedSkillIds,
        ]
    );
    const {
        resumeId,
        resumeDetail,
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
        setIsSummaryVisible,
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
        compareCertificationByDateDesc,
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
        certificationMatchTrends,
        setCertificationMatchScores,
        setCertificationMatchTrends,
        skillMatchScores,
        skillMatchTrends,
        setSkillMatchScores,
        setSkillMatchTrends,
        handleAnalyze,
        debugInfo,
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
        experience,
        education,
        certification,
        skill,
        selection,
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
            setCertificationMatchTrends,
            setSkillMatchScores,
            setSkillMatchTrends,
        },
        helpers: {
            buildResumeExperienceView,
            buildDraftExperienceView,
            buildExperienceEditDraft,
            buildResumeExperienceMap,
            buildExperienceDate,
            buildStarFields,
            mergeStarFieldsWithSource,
            mergeStarFields,
            resolveExperienceDatePayload,
            resolveEducationDatePayload,
            resolveSafeDateRange,
            isPresentLabel,
            sortByCategory,
            compareByDateDesc,
            compareCertificationByDateDesc,
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
    const updateDashboardCache = useCallback(
        (updated: ResumeRecord) => {
            if (!onResumesUpdate || cachedResumes.length === 0) {
                return;
            }
            const next = cachedResumes.map((resume) =>
                resume.id === updated.id
                    ? {
                        ...resume,
                        name: updated.title,
                        lastModified: formatRelativeTime(updated.updated_at),
                    }
                    : resume
            );
            onResumesUpdate(next);
        },
        [cachedResumes, onResumesUpdate]
    );
    useEffect(() => {
        if (!resumeDetail?.resume) {
            return;
        }
        const nextTitle = normalizeResumeTitle(resumeDetail.resume.title || DEFAULT_RESUME_TITLE);
        setResumeName(nextTitle || DEFAULT_RESUME_TITLE);
    }, [resumeDetail]);
    const applyResumeNameUpdate = useCallback(
        async (nextName: string, options?: { silent?: boolean }) => {
            const normalized = normalizeResumeTitle(nextName);
            if (!normalized || normalized === resumeName) {
                return;
            }
            if (isUpdatingResumeNameRef.current) {
                return;
            }
            const previousName = resumeName;
            setResumeName(normalized);
            if (!resumeId) {
                return;
            }
            isUpdatingResumeNameRef.current = true;
            try {
                const updated = await resumeService.update(resumeId, { title: normalized });
                const updatedTitle = normalizeResumeTitle(updated.title || normalized);
                setResumeName(updatedTitle || DEFAULT_RESUME_TITLE);
                if (resumeDetail) {
                    applyResumeDetail({
                        ...resumeDetail,
                        resume: {
                            ...resumeDetail.resume,
                            ...updated,
                            title: updatedTitle || DEFAULT_RESUME_TITLE,
                        },
                    });
                }
                updateDashboardCache(updated);
                if (!options?.silent) {
                    showToastSuccess('简历名称已更新');
                }
            } catch (error) {
                console.error('[ResumeEditor] 更新简历名称失败:', error);
                setResumeName(previousName);
                if (!options?.silent) {
                    showToastError('简历名称更新失败');
                }
            } finally {
                isUpdatingResumeNameRef.current = false;
            }
        },
        [
            applyResumeDetail,
            resumeDetail,
            resumeId,
            resumeName,
            showToastError,
            showToastSuccess,
            updateDashboardCache,
        ]
    );
    const canAutoNameResume = useCallback(
        (name: string) => {
            const normalized = normalizeResumeTitle(name);
            return !normalized || isDefaultResumeTitle(normalized);
        },
        []
    );
    const handleAnalyzeWithAutoName = useCallback(async () => {
        const result = await handleAnalyze();
        if (!result) {
            return;
        }
        if (!canAutoNameResume(resumeName)) {
            return;
        }
        const autoName = resolveAutoResumeName(result, jdText);
        if (!autoName) {
            return;
        }
        await applyResumeNameUpdate(autoName, { silent: true });
    }, [applyResumeNameUpdate, canAutoNameResume, handleAnalyze, jdText, resumeName]);
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
        skill.setRenamingCategoryTarget(null);
        skill.setRenamingCategoryDraft('');
    };
    const resolveA4Height = () => {
        if (!a4HeightRef.current) {
            a4HeightRef.current = getA4PixelHeight();
        }
        return a4HeightRef.current;
    };
    const waitForPreviewUpdate = () => new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
    });
    const measureContentHeight = async () => {
        await waitForPreviewUpdate();
        const container = previewContentRef.current;
        if (!container) {
            return 0;
        }
        return resolveMeasuredContentHeight(container);
    };
    const applyLayoutParamsAndMeasure = async (nextLineHeight: number, nextFontSize: number) => {
        setLineHeight(nextLineHeight);
        setFontSize(nextFontSize);
        return measureContentHeight();
    };

    const tryAdjustLineHeight = async (availableHeight: number, currentFontSize: number) => {
        for (const nextLineHeight of REDUCED_LINE_HEIGHT_STEPS) {
            const height = await applyLayoutParamsAndMeasure(nextLineHeight, currentFontSize);
            if (isWithinAvailableHeight(height, availableHeight)) {
                return true;
            }
        }
        return false;
    };

    const tryAdjustFontSize = async (availableHeight: number) => {
        for (const nextFontSize of REDUCED_FONT_SIZE_STEPS) {
            // 每次调整字号后，先尝试默认行高
            let height = await applyLayoutParamsAndMeasure(LINE_HEIGHT_DEFAULT, nextFontSize);
            if (isWithinAvailableHeight(height, availableHeight)) {
                return true;
            }
            // 如果默认行高不够，再尝试调整行高
            const lineHeightAdjusted = await tryAdjustLineHeight(availableHeight, nextFontSize);
            if (lineHeightAdjusted) {
                return true;
            }
        }
        return false;
    };

    const handleAdjustToSinglePage = async () => {
        if (smartPageAdjustingRef.current) {
            return;
        }
        smartPageAdjustingRef.current = true;
        try {
            if (!previewRef.current || !previewContentRef.current) {
                return;
            }
            const a4Height = resolveA4Height();
            if (!a4Height) {
                return;
            }
            const availableHeight = resolveSmartPageAvailableHeight(a4Height);
            showToastInfo(SMART_PAGE_TOAST_MESSAGES.adjusting, SMART_PAGE_ADJUSTING_TOAST_DURATION_MS);

            // 阶段0：重置到默认值并测量
            const initialHeight = await applyLayoutParamsAndMeasure(LINE_HEIGHT_DEFAULT, FONT_SIZE_DEFAULT);
            if (isWithinAvailableHeight(initialHeight, availableHeight)) {
                showToastSuccess(SMART_PAGE_TOAST_MESSAGES.success);
                setIsSmartPageApplied(true);
                return;
            }

            // 阶段1：优先调整行高（保持默认字号）
            const lineHeightAdjusted = await tryAdjustLineHeight(availableHeight, FONT_SIZE_DEFAULT);
            if (lineHeightAdjusted) {
                showToastSuccess(SMART_PAGE_TOAST_MESSAGES.success);
                setIsSmartPageApplied(true);
                return;
            }

            // 阶段2：行高已到极限，开始调整字号
            const fontSizeAdjusted = await tryAdjustFontSize(availableHeight);
            if (fontSizeAdjusted) {
                showToastSuccess(SMART_PAGE_TOAST_MESSAGES.success);
                setIsSmartPageApplied(true);
                return;
            }

            showToastError(SMART_PAGE_TOAST_MESSAGES.overflow);
        } finally {
            smartPageAdjustingRef.current = false;
        }
    };
    const adjustToSinglePage = () => {
        void handleAdjustToSinglePage();
    };
    const handleRestoreDefault = () => {
        setLineHeight(LINE_HEIGHT_DEFAULT);
        setFontSize(FONT_SIZE_DEFAULT);
        setIsSmartPageApplied(false);
    };
    const restoreDefault = () => {
        handleRestoreDefault();
    };
    const handleResumeNameChange = (name: string) => {
        void applyResumeNameUpdate(name);
    };

    const handleDragStart = (e: React.DragEvent, itemKey: string) => {
        lastItemHoverKeyRef.current = null;
        lastSectionHoverKeyRef.current = null;
        setDraggedSectionId(null);
        setDraggedItemKey(itemKey);
        setIsDragging(true);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', itemKey);
    };
    const clearDragState = () => {
        setDraggedItemKey(null);
        setDraggedSectionId(null);
        setIsDragging(false);
        lastItemHoverKeyRef.current = null;
        lastSectionHoverKeyRef.current = null;
    };

    const handleItemDragHover = (targetItemKey: string, position: DropPosition) => {
        if (!draggedItemKey || draggedItemKey === targetItemKey) {
            return;
        }

        const hoverKey = `${targetItemKey}:${position}`;
        if (lastItemHoverKeyRef.current === hoverKey) {
            return;
        }
        lastItemHoverKeyRef.current = hoverKey;

        const dragged = parseDragItemKey(draggedItemKey);
        const target = parseDragItemKey(targetItemKey);
        if (!dragged || !target || dragged.type !== target.type) {
            return;
        }

        if (dragged.type === 'experience') {
            setExperienceItems((prev) => {
                const draggedIndex = prev.findIndex((item) => item.id === dragged.id);
                const targetIndex = prev.findIndex((item) => item.id === target.id);
                if (draggedIndex < 0 || targetIndex < 0) {
                    return prev;
                }
                if (prev[draggedIndex].category !== prev[targetIndex].category) {
                    return prev;
                }
                return moveItemWithDropPosition(prev, draggedIndex, targetIndex, position);
            });
            return;
        }

        if (dragged.type === 'education') {
            setEducations((prev) => {
                const draggedIndex = prev.findIndex((item) => item.id === dragged.id);
                const targetIndex = prev.findIndex((item) => item.id === target.id);
                if (draggedIndex < 0 || targetIndex < 0) {
                    return prev;
                }
                return moveItemWithDropPosition(prev, draggedIndex, targetIndex, position);
            });
            return;
        }

        if (dragged.type === 'certification') {
            setCertifications((prev) => {
                const draggedIndex = prev.findIndex((item) => item.id === dragged.id);
                const targetIndex = prev.findIndex((item) => item.id === target.id);
                if (draggedIndex < 0 || targetIndex < 0) {
                    return prev;
                }
                return moveItemWithDropPosition(prev, draggedIndex, targetIndex, position);
            });
            return;
        }

        setSkillGroups((prev) => {
            const draggedIndex = prev.findIndex((group) => group.name === dragged.id);
            const targetIndex = prev.findIndex((group) => group.name === target.id);
            if (draggedIndex < 0 || targetIndex < 0) {
                return prev;
            }
            return moveItemWithDropPosition(prev, draggedIndex, targetIndex, position);
        });
    };

    const handleItemDrop = (e: React.DragEvent) => {
        e.preventDefault();
        clearDragState();
    };

    const resetExperienceSortForCategory = (
        items: ResumeExperienceView[],
        category: 'work' | 'project'
    ) => {
        const indices: number[] = [];
        const categoryItems: ResumeExperienceView[] = [];

        items.forEach((item, index) => {
            if (item.category !== category) return;
            indices.push(index);
            categoryItems.push(item);
        });

        if (categoryItems.length <= 1) {
            return items;
        }

        const sortedCategoryItems = [...categoryItems].sort(compareByDateDesc);
        const nextItems = [...items];
        indices.forEach((index, sortedIndex) => {
            nextItems[index] = sortedCategoryItems[sortedIndex];
        });
        return nextItems;
    };

    // 重置排序函数：将指定类别的经历恢复为时间倒序
const handleResetSort = (category: 'work' | 'project') => {
    setExperienceItems((prev) => resetExperienceSortForCategory(prev, category));
};

const handleResetCertificationSort = () => {
    setCertifications((prev) => {
        if (prev.length <= 1) {
            return prev;
        }
        return [...prev].sort(compareCertificationByDateDesc);
    });
};
    // Section drag handlers
    const handleSectionDragStart = (e: React.DragEvent, sectionId: string) => {
        lastItemHoverKeyRef.current = null;
        lastSectionHoverKeyRef.current = null;
        setDraggedItemKey(null);
        setDraggedSectionId(sectionId);
        setIsDragging(true);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', sectionId);
    };

    const handleSectionDragHover = (targetSectionId: string, position: DropPosition) => {
        if (!draggedSectionId || draggedSectionId === targetSectionId) {
            return;
        }

        const hoverKey = `${targetSectionId}:${position}`;
        if (lastSectionHoverKeyRef.current === hoverKey) {
            return;
        }
        lastSectionHoverKeyRef.current = hoverKey;
        setSectionOrder((prev) => {
            const draggedIndex = prev.indexOf(draggedSectionId);
            const targetIndex = prev.indexOf(targetSectionId);
            if (draggedIndex < 0 || targetIndex < 0) {
                return prev;
            }
            return moveItemWithDropPosition(prev, draggedIndex, targetIndex, position);
        });
    };

    const handleSectionDrop = (e: React.DragEvent) => {
        e.preventDefault();
        clearDragState();
    };
    const editingItem = experienceItems.find((item) => item.id === experience.editingExpId);
    const listSpacingValue = useMemo(() => {
        return buildSpacingValue(LIST_SPACING_BY_DENSITY[density], lineHeight);
    }, [density, lineHeight]);
    const bulletSpacingValue = useMemo(
        () => buildSpacingValue(LIST_SPACING_BY_DENSITY.compact, lineHeight),
        [lineHeight]
    );
    const previewPaddingValue = `${PREVIEW_PADDING_MM}mm`;
    // Spacing classes based on density
    const spacingClass = {
        compact: 'mb-2',
        standard: 'mb-6',
        spacious: 'mb-8'
    }[density];
    const listSpacingClass = 'space-y-[var(--rf-list-spacing)]';
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
    const sortedCertifications = certifications;
    const selectedSkillGroups = useMemo(() => {
        return skillGroups
            .map((group) => ({
                name: group.name,
                skills: group.skills.filter((skill) => selectedSkillIds.has(skill.id)),
            }))
            .filter((group) => group.skills.length > 0);
    }, [skillGroups, selectedSkillIds]);

    const handleExportPdf = useCallback(() => {
        if (isPrinting) {
            return;
        }
        const content = (
            <div className="rf-print-preview">
                <ResumePreview
                    previewRef={printPreviewRef}
                    previewContentRef={printPreviewContentRef}
                    lineHeight={lineHeight}
                    fontSize={fontSize}
                    listSpacingValue={listSpacingValue}
                    bulletSpacingValue={bulletSpacingValue}
                    previewPaddingValue={previewPaddingValue}
                    profile={profile}
                    spacingClass={spacingClass}
                    listSpacingClass={listSpacingClass}
                    sectionOrder={sectionOrder}
                    selectedWorkItems={selectedWorkItems}
                    selectedProjectItems={selectedProjectItems}
                    educations={educations}
                    selectedEduIds={selectedEduIds}
                    sortedCertifications={sortedCertifications}
                    selectedCertIds={selectedCertIds}
                    selectedSkillGroups={selectedSkillGroups}
                    readOnly
                    isDragging={false}
                    draggedItemKey={null}
                    draggedSectionId={null}
                    onSectionDragStart={() => {}}
                    onSectionDragHover={() => {}}
                    onSectionDrop={() => {}}
                    onItemDragStart={() => {}}
                    onItemDragHover={() => {}}
                    onItemDrop={() => {}}
                    onDragEnd={() => {}}
                    onNavigateTab={() => {}}
                    onEditExperience={() => {}}
                    onEditCertification={() => {}}
                    onEditSkill={() => {}}
                />
            </div>
        );
        startPrint({
            title: buildResumeExportTitle(resumeName),
            content,
        });
    }, [
        bulletSpacingValue,
        educations,
        fontSize,
        isPrinting,
        lineHeight,
        listSpacingClass,
        listSpacingValue,
        previewPaddingValue,
        profile,
        resumeName,
        sectionOrder,
        selectedCertIds,
        selectedEduIds,
        selectedProjectItems,
        selectedSkillGroups,
        selectedWorkItems,
        sortedCertifications,
        spacingClass,
        startPrint,
    ]);
    const handleEditExperience = (id: string) => {
        setSidebarTab('experience');
        experience.startEditingExperience(id);
    };
    const handleEditCertification = (id: string) => {
        experience.cancelEditingExperience();
        setSidebarTab('experience');
        certification.beginEditCertification(id);
    };
    const handleEditSkill = (id: string) => {
        experience.cancelEditingExperience();
        setSidebarTab('experience');
        skill.beginEditSkill(id);
    };
    const handleToggleJdCollapse = () => {
        setIsJDCollapsed((prev) => !prev);
    };
    const showDebugInfo =
        import.meta.env.DEV && localStorage.getItem('jdDebug') === '1';
    return (
        <div className="flex-1 flex flex-col h-full overflow-hidden bg-background-light dark:bg-background-dark">
            <EditorToolbar
                isDarkMode={isDarkMode}
                saveState={saveState}
                lastSavedAt={lastSavedAt}
                onToggleTheme={toggleTheme}
                isSmartPageApplied={isSmartPageApplied}
                onAdjustToSinglePage={adjustToSinglePage}
                onRestoreDefault={restoreDefault}
                resumeName={resumeName}
                onResumeNameChange={handleResumeNameChange}
                onExportPdf={handleExportPdf}
            />
            <div className="flex flex-1 overflow-hidden">
                <EditorSidebar
                    sidebarTab={sidebarTab}
                    onSelectTab={setSidebarTab}
                    onProfileTabSelected={experience.cancelEditingExperience}
                    jdPanelProps={{
                        jdText,
                        analysisResult,
                        isAnalyzing,
                        isCollapsed: isJDCollapsed,
                        onAnalyze: handleAnalyzeWithAutoName,
                        onToggleCollapse: handleToggleJdCollapse,
                        onJdTextChange: setJdText,
                        debugInfo,
                        showDebugInfo,
                    }}
                    profileTabProps={{
                        profile,
                        setProfile,
                        profileSyncMode,
                        setProfileSyncMode,
                        isEditingProfile,
                        isSavingProfile,
                        isProfileReadOnly,
                        onBeginEdit: beginProfileEdit,
                        onCancelEdit: cancelProfileEdit,
                        onSave: handleSaveProfile,
                        educations,
                        selectedEduIds,
                        editingEducationId: education.editingEducationId,
                        educationDraft: education.educationDraft,
                        isSavingEducation: education.isSavingEducation,
                        deletingEducationIds: education.deletingEducationIds,
                        onBeginCreateEducation: education.beginCreateEducation,
                        onBeginEditEducation: education.beginEditEducation,
                        onCancelEducationEdit: education.cancelEducationEdit,
                        onUpdateEducationDraft: education.updateEducationDraft,
                        onUpdateEducationDate: education.updateEducationDate,
                        onSaveEducation: education.handleSaveEducation,
                        onRequestDeleteEducation: education.requestDeleteEducation,
                        onToggleEducationSelection: selection.toggleEducationSelection,
                    }}
                    experienceTabProps={{
                        experience,
                        certification,
                        skill,
                        selection,
                        workItems,
                        projectItems,
                        selectedExpIds,
                        staleExperienceIds,
                        sortedCertifications,
                        selectedCertIds,
                        certificationMatchScores,
                        certificationMatchTrends,
                        skillGroups,
                        selectedSkillIds,
                        skillMatchScores,
                        skillMatchTrends,
                    onResetRenamingCategory: resetRenamingCategory,
                    onResetWorkSort: () => handleResetSort('work'),
                    onResetProjectSort: () => handleResetSort('project'),
                    onResetCertificationSort: handleResetCertificationSort,
                }}
                    editingSuggestion={{
                        editingItem,
                        analysisResult,
                        staleExperienceIds,
                        jdText,
                        isPolishing: experience.isPolishing,
                        onPolish: experience.handlePolishWithJD,
                    }}
                />
                <ResumePreview
                    previewRef={previewRef}
                    previewContentRef={previewContentRef}
                    lineHeight={lineHeight}
                    fontSize={fontSize}
                    listSpacingValue={listSpacingValue}
                    bulletSpacingValue={bulletSpacingValue}
                    previewPaddingValue={previewPaddingValue}
                    profile={profile}
                    spacingClass={spacingClass}
                    listSpacingClass={listSpacingClass}
                    sectionOrder={sectionOrder}
                    selectedWorkItems={selectedWorkItems}
                    selectedProjectItems={selectedProjectItems}
                    educations={educations}
                    selectedEduIds={selectedEduIds}
                    sortedCertifications={sortedCertifications}
                    selectedCertIds={selectedCertIds}
                    selectedSkillGroups={selectedSkillGroups}
                    isDragging={isDragging}
                    draggedItemKey={draggedItemKey}
                    draggedSectionId={draggedSectionId}
                    onSectionDragStart={handleSectionDragStart}
                    onSectionDragHover={handleSectionDragHover}
                    onSectionDrop={handleSectionDrop}
                    onItemDragStart={handleDragStart}
                    onItemDragHover={handleItemDragHover}
                    onItemDrop={handleItemDrop}
                    onDragEnd={clearDragState}
                    onNavigateTab={setSidebarTab}
                    onEditExperience={handleEditExperience}
                    onEditCertification={handleEditCertification}
                    onEditSkill={handleEditSkill}
                />
            </div>
            <ToastContainer toasts={toasts} onClose={closeToast} />
            <PrintPortal isActive={Boolean(printContent)}>
                {printContent}
            </PrintPortal>
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
