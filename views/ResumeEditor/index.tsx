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
import { aiService, type JDAnalysisResult } from '../../services/aiService';
import type { Certification as CertificationRecord } from '../../services/certificationsService';
import type { ExperienceListItem } from '../../services/experienceService';
import type {
    CertificationView,
    EducationView,
    ProfileSyncMode,
    ResumeEditorConfig,
    ResumeEditorProfile,
    ResumeLayoutOrders,
    ResumeExperienceView,
    SkillGroupView,
} from '../../types/resume';
import type { Resume as DashboardResume } from '../../types';
import { buildExperienceDate } from '../../utils/dateUtils';
import {
    buildResumeAISnapshot,
    buildStarFields,
    clampMatchScore,
    mergeStarFieldsWithSource,
} from '../../utils/resumeHelpers';
import { mergeLinkedInLink } from '../profileUtils';
import { type DropPosition, moveItemWithDropPosition } from '../../utils/dragSort';
import { formatRelativeTime } from '../../utils/timeUtils';
import { buildResumeExportTitle } from '../../utils/exportFilename';
import { extractThoughtHeadline } from '../../utils/aiThought';
import {
    trackLayoutModeChange,
    trackModuleReordered,
    trackResumeExported,
    trackSmartOnePageTriggered,
} from '../../utils/analyticsTracker';
import { DEFAULT_RESUME_TITLE } from '../../constants/resumeConstants';
import {
    AUTO_SAVE_DELAY_MS,
    A4_HEIGHT_MM,
    AUTO_ASSEMBLY_MATCH_THRESHOLD,
    AUTO_ASSEMBLY_MAX_EXPERIENCES,
    AUTO_ASSEMBLY_TOAST_MESSAGES,
    BOSS_GREETING_TOAST_MESSAGES,
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
    SECTION_SPACING_CLASS_BY_DENSITY,
    SMART_PAGE_ADJUSTING_TOAST_DURATION_MS,
    SMART_PAGE_ITEM_SPACING_DEFAULT,
    SMART_PAGE_ITEM_SPACING_MIN,
    SMART_PAGE_ITEM_SPACING_STEP,
    SMART_PAGE_SECTION_SPACING_CLASS_BY_KEY,
    SMART_PAGE_SECTION_SPACING_STEPS,
    SMART_PAGE_TOP_PADDING_MIN_PX,
    SMART_PAGE_TOP_PADDING_STEP_PX,
    SMART_PAGE_BOTTOM_GAP_MM,
    SMART_PAGE_HEIGHT_TOLERANCE,
    SMART_PAGE_TOAST_MESSAGES,
    JD_ANALYSIS_TOAST_MESSAGES,
    JD_ANALYSIS_PROGRESS_NODE_TITLES,
    JD_ANALYSIS_TOAST_DURATION_MS,
    JD_ANALYSIS_TOAST_ERROR_DURATION_MS,
} from './constants';
import { parseDragItemKey, type DragItemType } from './dragKeys';
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
const CSS_PX_PER_MM = 96 / 25.4;

type SectionSpacingKey = 2 | 3 | 4 | 5 | 6 | 8;

type SmartPageLayout = {
    topPaddingPx: number;
    sectionSpacingKey: SectionSpacingKey;
    itemSpacingEm: number;
    lineHeight: number;
    fontSize: number;
};

type SmartPageBaseLayout = Pick<
    SmartPageLayout,
    'topPaddingPx' | 'sectionSpacingKey' | 'itemSpacingEm'
>;

const buildTopPaddingSteps = (start: number, min: number, step: number) => {
    const steps: number[] = [];
    for (let value = start; value >= min; value -= step) {
        steps.push(Number(value.toFixed(2)));
    }
    if (steps[steps.length - 1] !== min) {
        steps.push(min);
    }
    return steps;
};

const buildItemSpacingSteps = (start: number, min: number, step: number) => {
    const steps: number[] = [];
    for (let value = start; value >= min; value -= step) {
        steps.push(Number(value.toFixed(2)));
    }
    if (steps[steps.length - 1] !== min) {
        steps.push(min);
    }
    return steps;
};

const buildReductionStepsFromCurrent = (start: number, min: number, step: number) => {
    if (start <= min) {
        return [Number(start.toFixed(2))];
    }
    return buildItemSpacingSteps(start, min, step);
};

const resolveDefaultTopPaddingPx = (a4Height?: number) => {
    const pxPerMm = a4Height ? a4Height / A4_HEIGHT_MM : CSS_PX_PER_MM;
    return Number((pxPerMm * PREVIEW_PADDING_MM).toFixed(2));
};

const resolveDefaultSectionSpacingKey = (
    density: 'compact' | 'standard' | 'spacious'
): SectionSpacingKey => {
    if (density === 'compact') {
        return 4;
    }
    if (density === 'spacious') {
        return 8;
    }
    return 6;
};

const resolveDefaultItemSpacingEm = (density: 'compact' | 'standard' | 'spacious') => {
    if (density === 'standard') {
        return SMART_PAGE_ITEM_SPACING_DEFAULT;
    }
    return LIST_SPACING_BY_DENSITY[density];
};

const resolveSectionSpacingClass = (spacingKey: SectionSpacingKey) => {
    if (spacingKey === 8) {
        return SECTION_SPACING_CLASS_BY_DENSITY.spacious;
    }
    return SMART_PAGE_SECTION_SPACING_CLASS_BY_KEY[spacingKey];
};

type ModuleReorderContext = {
    moduleType: 'experience' | 'education' | 'certification' | 'skill_group' | 'section';
    moduleKey: string;
    id: string;
    fromPosition: number;
    sectionId?: string;
    category?: 'work' | 'project';
};

type SmartPageResult = SmartPageLayout | null;
type SmartPageExecutionResult =
    | ({ status: 'fit' } & SmartPageLayout)
    | ({ status: 'overflow' } & SmartPageLayout)
    | { status: 'skipped'; reason: 'busy' | 'unavailable' };

type OrderedScoreItem = {
    id: string;
    score: number;
    index: number;
};

type AutoAssemblySelection = {
    hasMatchedExperience: boolean;
    experienceIds: string[];
    certificationIds: string[];
    skillIds: string[];
    experienceRemovalQueue: string[];
    certificationRemovalQueue: string[];
    skillRemovalQueue: string[];
};

type BossGreetingSignatureParams = {
    jdText: string;
    summary: string;
    jobTitle?: string;
    company?: string;
    resumeText: string;
};

type ManualSelectionSnapshot = {
    experienceIds: string[];
    certificationIds: string[];
    skillIds: string[];
};

type LayoutSnapshot = SmartPageLayout & {
    isSmartPageApplied: boolean;
};

type AutoAssemblyStateSnapshot = {
    selection: ManualSelectionSnapshot;
    layout: LayoutSnapshot;
};

const buildDefaultSmartPageLayout = (
    density: 'compact' | 'standard' | 'spacious',
    a4Height?: number
): SmartPageLayout => ({
    topPaddingPx: resolveDefaultTopPaddingPx(a4Height),
    sectionSpacingKey: resolveDefaultSectionSpacingKey(density),
    itemSpacingEm: resolveDefaultItemSpacingEm(density),
    lineHeight: LINE_HEIGHT_DEFAULT,
    fontSize: FONT_SIZE_DEFAULT,
});

const resolveLayoutSnapshotFromConfig = (
    layout?: ResumeEditorConfig['layout'],
    a4Height?: number
): LayoutSnapshot => {
    const resolvedDensity = layout?.density ?? 'standard';
    const defaultLayout = buildDefaultSmartPageLayout(resolvedDensity, a4Height);
    return {
        topPaddingPx: layout?.topPaddingPx ?? defaultLayout.topPaddingPx,
        sectionSpacingKey: layout?.sectionSpacingKey ?? defaultLayout.sectionSpacingKey,
        itemSpacingEm: layout?.itemSpacingEm ?? defaultLayout.itemSpacingEm,
        lineHeight: layout?.lineHeight ?? defaultLayout.lineHeight,
        fontSize: layout?.fontSize ?? defaultLayout.fontSize,
        isSmartPageApplied: layout?.isSmartPageApplied ?? false,
    };
};

const toMatchScoreMap = (entries?: Array<{ id: string; score: number }>) => {
    const map = new Map<string, number>();
    (entries || []).forEach((entry) => {
        const score = clampMatchScore(entry.score);
        if (score !== undefined) {
            map.set(entry.id, score);
        }
    });
    return map;
};

const compareByScoreAsc = (a: OrderedScoreItem, b: OrderedScoreItem) => {
    if (a.score !== b.score) {
        return a.score - b.score;
    }
    return a.index - b.index;
};

const compareByScoreDesc = (a: OrderedScoreItem, b: OrderedScoreItem) => {
    if (a.score !== b.score) {
        return b.score - a.score;
    }
    return a.index - b.index;
};

const buildOrderedScoreItems = <T extends { id: string }>(
    items: T[],
    scoreMap: Map<string, number>
) => items.map((item, index) => ({
    id: item.id,
    score: scoreMap.get(item.id) ?? 0,
    index,
}));

const pickTopIds = (
    items: OrderedScoreItem[],
    limit: number
) => items
    .slice()
    .sort(compareByScoreDesc)
    .slice(0, limit)
    .map((item) => item.id);

const pickThresholdIds = (
    items: OrderedScoreItem[],
    threshold: number
) => items
    .filter((item) => item.score > threshold)
    .map((item) => item.id);

const buildRemovalQueue = (
    selectedIds: Set<string>,
    orderedItems: OrderedScoreItem[]
) => orderedItems
    .filter((item) => selectedIds.has(item.id))
    .slice()
    .sort(compareByScoreAsc)
    .map((item) => item.id);

const buildBossGreetingSignature = ({
    jdText,
    summary,
    jobTitle,
    company,
    resumeText,
}: BossGreetingSignatureParams) => JSON.stringify({
    jdText: jdText.trim(),
    summary,
    jobTitle: jobTitle ?? '',
    company: company ?? '',
    resumeText,
});

const buildSelectionSnapshot = (
    selectedExpIds: Set<string>,
    selectedCertIds: Set<string>,
    selectedSkillIds: Set<string>
): ManualSelectionSnapshot => ({
    experienceIds: [...selectedExpIds],
    certificationIds: [...selectedCertIds],
    skillIds: [...selectedSkillIds],
});

const buildLayoutSnapshot = (
    layout: SmartPageLayout,
    isSmartPageApplied: boolean
): LayoutSnapshot => ({
    ...layout,
    isSmartPageApplied,
});

const toggleSelectionSnapshotIds = (ids: string[], targetId: string) => (
    ids.includes(targetId) ? ids.filter((id) => id !== targetId) : [...ids, targetId]
);

const toggleGroupedSelectionSnapshotIds = (ids: string[], targetIds: string[]) => {
    const next = new Set(ids);
    const shouldSelect = targetIds.some((id) => !next.has(id));
    targetIds.forEach((id) => {
        if (shouldSelect) {
            next.add(id);
            return;
        }
        next.delete(id);
    });
    return [...next];
};

const sortSnapshotEntriesById = <T extends { id: string }>(items: T[]) => (
    [...items].sort((a, b) => a.id.localeCompare(b.id))
);

const buildStableResumeSnapshotText = (snapshot: ReturnType<typeof buildResumeAISnapshot>) => JSON.stringify({
    experiences: sortSnapshotEntriesById(snapshot.experiences),
    certifications: sortSnapshotEntriesById(snapshot.certifications),
    skills: sortSnapshotEntriesById(snapshot.skills),
});

const hasPositiveMatchScore = (item: OrderedScoreItem) => item.score > 0;

const mapDragTypeToModuleType = (dragType: DragItemType): ModuleReorderContext['moduleType'] => {
    return dragType === 'skillGroup' ? 'skill_group' : dragType;
};

const resolveModuleKey = (
    moduleType: ModuleReorderContext['moduleType'],
    category?: ModuleReorderContext['category'],
    sectionId?: string
) => {
    if (moduleType === 'experience' && category) {
        return `experience:${category}`;
    }
    if (moduleType === 'section' && sectionId) {
        return `section:${sectionId}`;
    }
    return moduleType;
};

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

const buildJDPolishContext = (
    jdText: string,
    analysisResult: JDAnalysisResult | null,
    isOutdated: boolean
) => {
    const trimmedJdText = jdText.trim();
    if (trimmedJdText) {
        return trimmedJdText;
    }
    if (!analysisResult || isOutdated) {
        return '';
    }
    const contextLines = [
        analysisResult.jobTitle?.trim() ? `目标岗位：${analysisResult.jobTitle.trim()}` : '',
        analysisResult.company?.trim() ? `目标公司：${analysisResult.company.trim()}` : '',
        analysisResult.summary?.trim() ? `岗位摘要：${analysisResult.summary.trim()}` : '',
        analysisResult.jobKeywords?.length ? `岗位关键词：${analysisResult.jobKeywords.join('、')}` : '',
        analysisResult.missingKeywords?.length ? `重点补强：${analysisResult.missingKeywords.join('、')}` : '',
    ].filter(Boolean);
    return contextLines.join('\n');
};

const resolveSmartPageAvailableHeight = (a4Height: number, topPaddingPx: number) => {
    const pxPerMm = a4Height / A4_HEIGHT_MM;
    const bottomPaddingPx = pxPerMm * PREVIEW_PADDING_MM;
    const requiredBottomGapPx = Math.max(bottomPaddingPx, pxPerMm * SMART_PAGE_BOTTOM_GAP_MM);
    return Math.max(0, a4Height - topPaddingPx - requiredBottomGapPx);
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
    cachedResumesOwnerKey?: string | null;
    authUserKey?: string | null;
    onResumesUpdate?: (resumes: DashboardResume[]) => void;
};

const ResumeEditor: React.FC<ResumeEditorProps> = ({
    cachedResumes = [],
    cachedResumesOwnerKey = null,
    authUserKey = null,
    onResumesUpdate,
}) => {
    const [isDarkMode, setIsDarkMode] = useState(false);
    const [lineHeight, setLineHeight] = useState(LINE_HEIGHT_DEFAULT);
    const [fontSize, setFontSize] = useState(FONT_SIZE_DEFAULT);
    const [topPaddingPx, setTopPaddingPx] = useState(resolveDefaultTopPaddingPx());
    const [sectionSpacingKey, setSectionSpacingKey] = useState<SectionSpacingKey>(
        resolveDefaultSectionSpacingKey('standard')
    );
    const [itemSpacingEm, setItemSpacingEm] = useState(resolveDefaultItemSpacingEm('standard'));
    const [measureLayout, setMeasureLayout] = useState<SmartPageLayout>(() =>
        buildDefaultSmartPageLayout('standard')
    );
    const [isDragging, setIsDragging] = useState(false);
    const [isSmartPageApplied, setIsSmartPageApplied] = useState(false);
    const [isAutoSavePaused, setIsAutoSavePaused] = useState(false);
    const [isCreatingResume, setIsCreatingResume] = useState(false);
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
    const isCacheOwnerMatched = Boolean(
        cachedResumesOwnerKey && authUserKey && cachedResumesOwnerKey === authUserKey
    );
    // 教育背景/证书/技能选择状态
    const [selectedEduIds, setSelectedEduIds] = useState<Set<string>>(new Set());
    const [selectedCertIds, setSelectedCertIds] = useState<Set<string>>(new Set());
    const [selectedSkillIds, setSelectedSkillIds] = useState<Set<string>>(new Set());
    // 2. Experience State
    const [experienceItems, setExperienceItems] = useState<ResumeExperienceView[]>([]);
    const [selectedExpIds, setSelectedExpIds] = useState<Set<string>>(new Set());
    const [isAutoAssembling, setIsAutoAssembling] = useState(false);
    const [bossGreeting, setBossGreeting] = useState('');
    const [bossGreetingSignature, setBossGreetingSignature] = useState('');
    const [isBossGreetingVisible, setIsBossGreetingVisible] = useState(false);
    const [isGeneratingBossGreeting, setIsGeneratingBossGreeting] = useState(false);
    // 3. UI State
    const [sidebarTab, setSidebarTab] = useState<'profile' | 'experience'>('experience');
    const [density, setDensity] = useState<'compact' | 'standard' | 'spacious'>('standard');
    const previousDensityRef = useRef<'compact' | 'standard' | 'spacious'>(density);
    const manualSelectionVersionRef = useRef(0);
    const manualLayoutVersionRef = useRef(0);
    const isProgrammaticSelectionUpdateRef = useRef(false);
    const manualSelectionSnapshotRef = useRef<ManualSelectionSnapshot>({
        experienceIds: [],
        certificationIds: [],
        skillIds: [],
    });
    const latestLayoutSnapshotRef = useRef<LayoutSnapshot>(
        buildLayoutSnapshot(
            {
                topPaddingPx,
                sectionSpacingKey,
                itemSpacingEm,
                lineHeight,
                fontSize,
            },
            isSmartPageApplied
        )
    );
    const manualLayoutSnapshotRef = useRef<LayoutSnapshot>(
        buildLayoutSnapshot(
            {
                topPaddingPx,
                sectionSpacingKey,
                itemSpacingEm,
                lineHeight,
                fontSize,
            },
            isSmartPageApplied
        )
    );
    // resumeId 在 useResumeData() 之后才声明，此处不能直接引用，初始化为 undefined。
    // 在 useEffect 中同步更新，确保 ref 始终持有最新值。
    const latestResumeIdRef = useRef<string | undefined>(undefined);
    const latestBossGreetingSignatureRef = useRef('');
    const latestBossGreetingAnalysisOutdatedRef = useRef(false);
    const autoAssembleRequestIdRef = useRef(0);
    const bossGreetingRequestIdRef = useRef(0);
    const activeAutoAssembleToastIdRef = useRef<string | null>(null);
    const activeBossGreetingToastIdRef = useRef<string | null>(null);
    const bossGreetingUiStateRef = useRef({
        text: '',
        isVisible: false,
    });
    const {
        toasts,
        success: showToastSuccess,
        error: showToastError,
        info: showToastInfo,
        loading: showToastLoading,
        updateToast,
        closeToast,
    } = useToast();
    useEffect(() => {
        if (previousDensityRef.current !== density) {
            trackLayoutModeChange({
                from: previousDensityRef.current,
                to: density,
            });
            previousDensityRef.current = density;
        }
    }, [density]);
    useEffect(() => {
        if (smartPageAdjustingRef.current || isSmartPageApplied) {
            return;
        }
        setSectionSpacingKey(resolveDefaultSectionSpacingKey(density));
        setItemSpacingEm(resolveDefaultItemSpacingEm(density));
    }, [density, isSmartPageApplied]);
    useEffect(() => {
        latestLayoutSnapshotRef.current = buildLayoutSnapshot(
            {
                topPaddingPx,
                sectionSpacingKey,
                itemSpacingEm,
                lineHeight,
                fontSize,
            },
            isSmartPageApplied
        );
        if (!isAutoAssembling && !smartPageAdjustingRef.current) {
            manualLayoutSnapshotRef.current = latestLayoutSnapshotRef.current;
        }
    }, [
        fontSize,
        isAutoAssembling,
        isSmartPageApplied,
        itemSpacingEm,
        lineHeight,
        sectionSpacingKey,
        topPaddingPx,
    ]);
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
    const reorderContextRef = useRef<ModuleReorderContext | null>(null);
    const previewRef = useRef<HTMLDivElement | null>(null);
    const previewContentRef = useRef<HTMLDivElement | null>(null);
    const measurePreviewRef = useRef<HTMLDivElement | null>(null);
    const measurePreviewContentRef = useRef<HTMLDivElement | null>(null);
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
                topPaddingPx,
                sectionSpacingKey,
                itemSpacingEm,
                lineHeight,
                fontSize,
                isSmartPageApplied,
                isSummaryVisible,
                layoutOrders
            ),
        [
            density,
            fontSize,
            isSmartPageApplied,
            isSummaryVisible,
            lineHeight,
            itemSpacingEm,
            layoutOrders,
            profile,
            profileSyncMode,
            sectionOrder,
            sectionSpacingKey,
            selectedCertIds,
            selectedEduIds,
            selectedExpIds,
            topPaddingPx,
            selectedSkillIds,
        ]
    );
    const buildCommittedResumeConfigSnapshot = useCallback(() => {
        // 创建新简历前只持久化已确认的 profile 状态，避免把编辑中的草稿静默写回旧简历。
        const nextProfile = isEditingProfile ? originalProfile : profile;
        const nextProfileSyncMode = isEditingProfile ? originalProfileSyncMode : profileSyncMode;
        return buildResumeConfigSnapshot(
            nextProfile,
            nextProfileSyncMode,
            selectedExpIds,
            selectedEduIds,
            selectedCertIds,
            selectedSkillIds,
            sectionOrder,
            density,
            topPaddingPx,
            sectionSpacingKey,
            itemSpacingEm,
            lineHeight,
            fontSize,
            isSmartPageApplied,
            isSummaryVisible,
            layoutOrders
        );
    }, [
        density,
        fontSize,
        isEditingProfile,
        isSmartPageApplied,
        isSummaryVisible,
        itemSpacingEm,
        layoutOrders,
        lineHeight,
        originalProfile,
        originalProfileSyncMode,
        profile,
        profileSyncMode,
        sectionOrder,
        sectionSpacingKey,
        selectedCertIds,
        selectedEduIds,
        selectedExpIds,
        selectedSkillIds,
        topPaddingPx,
    ]);
    const applyLayoutConfig = useCallback((config: ResumeEditorConfig) => {
        const nextLayout = resolveLayoutSnapshotFromConfig(config.layout);
        setTopPaddingPx(nextLayout.topPaddingPx);
        setSectionSpacingKey(nextLayout.sectionSpacingKey);
        setItemSpacingEm(nextLayout.itemSpacingEm);
        setLineHeight(nextLayout.lineHeight);
        setFontSize(nextLayout.fontSize);
        setIsSmartPageApplied(nextLayout.isSmartPageApplied);
    }, []);
    const {
        resumeId,
        resumeDetail,
        resumeExperienceMap,
        experienceSourceMap,
        setResumeExperienceMap,
        setExperienceSourceMap,
        isLoadingResume,
        isLoadingExperiences,
        saveState,
        lastSavedAt,
        applyResumeDetail,
        flushResumeConfig,
        reloadResumeContext,
        suppressAutoSaveForConfig,
        clearSuppressedAutoSave,
    } = useResumeData({
        configSnapshot: resumeConfigSnapshot,
        autoSaveDelayMs: AUTO_SAVE_DELAY_MS,
        isAutoSavePaused,
        setProfile,
        setProfileSyncMode,
        setProfileSocialLinks,
        setSectionOrder,
        setDensity,
        setIsSummaryVisible,
        applyLayoutConfig,
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
    // 将 resumeId 同步到 ref，供不可在 render 阶段读取的异步回调使用。
    useEffect(() => {
        latestResumeIdRef.current = resumeId;
    }, [resumeId]);
    const {
        jdText,
        setJdText,
        jdFile,
        setJdFile,
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
        hasMissingAttachmentContext,
        debugInfo,
        isOutdated,
    } = useJDAnalysis({
        resumeId,
        experienceItems,
        setExperienceItems,
        certifications,
        skillGroups,
        isLoadingExperiences,
        authUserKey,
    });
    const jdPolishContext = useMemo(
        () => buildJDPolishContext(jdText, analysisResult, isOutdated),
        [analysisResult, isOutdated, jdText]
    );
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
        jdText: jdPolishContext,
        toast: {
            success: showToastSuccess,
            error: showToastError,
            loading: showToastLoading,
            updateToast,
            closeToast,
        },
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
    const markManualSelectionChanged = useCallback(() => {
        manualSelectionVersionRef.current += 1;
    }, []);
    const commitLayoutSnapshot = useCallback((
        snapshot: LayoutSnapshot,
        options?: { incrementVersion?: boolean }
    ) => {
        if (options?.incrementVersion) {
            manualLayoutVersionRef.current += 1;
        }
        manualLayoutSnapshotRef.current = snapshot;
    }, []);
    const updateManualSelectionSnapshot = useCallback(
        (updater: (snapshot: ManualSelectionSnapshot) => ManualSelectionSnapshot) => {
            manualSelectionSnapshotRef.current = updater(
                buildSelectionSnapshot(selectedExpIds, selectedCertIds, selectedSkillIds)
            );
        },
        [selectedCertIds, selectedExpIds, selectedSkillIds]
    );
    useEffect(() => {
        if (isProgrammaticSelectionUpdateRef.current) {
            return;
        }
        manualSelectionSnapshotRef.current = buildSelectionSnapshot(
            selectedExpIds,
            selectedCertIds,
            selectedSkillIds
        );
    }, [selectedCertIds, selectedExpIds, selectedSkillIds]);
    const trackedSelection = useMemo(() => ({
        toggleExperienceSelection: (id: string) => {
            markManualSelectionChanged();
            updateManualSelectionSnapshot((snapshot) => ({
                ...snapshot,
                experienceIds: toggleSelectionSnapshotIds(snapshot.experienceIds, id),
            }));
            selection.toggleExperienceSelection(id);
        },
        toggleEducationSelection: (id: string) => {
            markManualSelectionChanged();
            selection.toggleEducationSelection(id);
        },
        toggleCertificationSelection: (id: string) => {
            markManualSelectionChanged();
            updateManualSelectionSnapshot((snapshot) => ({
                ...snapshot,
                certificationIds: toggleSelectionSnapshotIds(snapshot.certificationIds, id),
            }));
            selection.toggleCertificationSelection(id);
        },
        toggleSkillSelection: (id: string) => {
            markManualSelectionChanged();
            updateManualSelectionSnapshot((snapshot) => ({
                ...snapshot,
                skillIds: toggleSelectionSnapshotIds(snapshot.skillIds, id),
            }));
            selection.toggleSkillSelection(id);
        },
        toggleSkillGroupSelection: (groupName: string, skillIds?: string[]) => {
            markManualSelectionChanged();
            const targetSkillIds = skillIds
                ?? skillGroups.find((item) => item.name === groupName)?.skills.map((item) => item.id)
                ?? [];
            updateManualSelectionSnapshot((snapshot) => ({
                ...snapshot,
                skillIds: toggleGroupedSelectionSnapshotIds(
                    snapshot.skillIds,
                    targetSkillIds
                ),
            }));
            selection.toggleSkillGroupSelection(groupName, targetSkillIds);
        },
    }), [markManualSelectionChanged, selection, skillGroups, updateManualSelectionSnapshot]);
    const updateDashboardCache = useCallback(
        (updated: ResumeRecord) => {
            if (!onResumesUpdate || cachedResumes.length === 0 || !isCacheOwnerMatched) {
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
        [cachedResumes, isCacheOwnerMatched, onResumesUpdate]
    );
    const prependDashboardCache = useCallback((created: ResumeRecord) => {
        if (!onResumesUpdate || !isCacheOwnerMatched) {
            return;
        }
        const createdResume: DashboardResume = {
            id: created.id,
            name: created.title,
            targetRole: created.target_role || '通用',
            matchRate: 0,
            lastModified: formatRelativeTime(created.updated_at),
            status: 'draft',
            type: 'general',
        };
        const next = [createdResume, ...cachedResumes.filter((item) => item.id !== created.id)];
        onResumesUpdate(next);
    }, [cachedResumes, isCacheOwnerMatched, onResumesUpdate]);
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
    const runJdAnalyzeWithToast = useCallback(async () => {
        if (isAnalyzing) {
            return null;
        }
        if (!hasMissingAttachmentContext && !jdFile && !jdText.trim()) {
            showToastError(JD_ANALYSIS_TOAST_MESSAGES.empty, JD_ANALYSIS_TOAST_ERROR_DURATION_MS);
            return null;
        }
        const toastId = showToastLoading(JD_ANALYSIS_TOAST_MESSAGES.loading);
        try {
            let hasThoughtTitle = false;
            const result = await handleAnalyze({
                onEvent: (event) => {
                    if (!toastId) {
                        return;
                    }
                    if (event.type === 'thought') {
                        const title = extractThoughtHeadline(event.summary);
                        if (!title) {
                            return;
                        }
                        hasThoughtTitle = true;
                        updateToast(toastId, {
                            message: title,
                            type: 'loading',
                            duration: 0,
                        });
                        return;
                    }
                    if (event.type !== 'progress' || hasThoughtTitle) {
                        return;
                    }
                    const title = JD_ANALYSIS_PROGRESS_NODE_TITLES[event.node];
                    if (!title) {
                        return;
                    }
                    updateToast(toastId, {
                        message: title,
                        type: 'loading',
                        duration: 0,
                    });
                },
            });
            if (result.status === 'success') {
                if (toastId) {
                    updateToast(toastId, {
                        message: JD_ANALYSIS_TOAST_MESSAGES.success,
                        type: 'success',
                        duration: JD_ANALYSIS_TOAST_DURATION_MS,
                    });
                } else {
                    showToastSuccess(JD_ANALYSIS_TOAST_MESSAGES.success, JD_ANALYSIS_TOAST_DURATION_MS);
                }
                return result.result;
            }
            const isError = result.status === 'error' || result.status === 'missing_attachment';
            const message = result.status === 'missing_attachment'
                ? JD_ANALYSIS_TOAST_MESSAGES.missingAttachment
                : isError
                    ? JD_ANALYSIS_TOAST_MESSAGES.error
                    : JD_ANALYSIS_TOAST_MESSAGES.noChange;
            const duration = isError
                ? JD_ANALYSIS_TOAST_ERROR_DURATION_MS
                : JD_ANALYSIS_TOAST_DURATION_MS;
            const type = isError ? 'error' : 'success';
            if (toastId) {
                updateToast(toastId, { message, type, duration });
            } else if (isError) {
                showToastError(message, duration);
            } else {
                showToastSuccess(message, duration);
            }
            return null;
        } catch (error) {
            console.error('[ResumeEditor] JD 分析失败:', error);
            if (toastId) {
                updateToast(toastId, {
                    message: JD_ANALYSIS_TOAST_MESSAGES.error,
                    type: 'error',
                    duration: JD_ANALYSIS_TOAST_ERROR_DURATION_MS,
                });
            } else {
                showToastError(JD_ANALYSIS_TOAST_MESSAGES.error, JD_ANALYSIS_TOAST_ERROR_DURATION_MS);
            }
            return null;
        }
    }, [
        handleAnalyze,
        isAnalyzing,
        jdFile,
        jdText,
        showToastError,
        showToastLoading,
        showToastSuccess,
        updateToast,
    ]);
    const handleAnalyzeWithAutoName = useCallback(async () => {
        const result = await runJdAnalyzeWithToast();
        if (!result) {
            return null;
        }
        if (!canAutoNameResume(resumeName)) {
            return result;
        }
        const autoName = resolveAutoResumeName(result, jdText);
        if (!autoName) {
            return result;
        }
        await applyResumeNameUpdate(autoName, { silent: true });
        return result;
    }, [applyResumeNameUpdate, canAutoNameResume, jdText, resumeName, runJdAnalyzeWithToast]);
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
    const waitForPreviewUpdate = (frames = 1) => new Promise<void>((resolve) => {
        const tick = (remaining: number) => {
            requestAnimationFrame(() => {
                if (remaining <= 1) {
                    resolve();
                    return;
                }
                tick(remaining - 1);
            });
        };
        tick(frames);
    });
    const waitForSmartPageIdle = () => new Promise<void>((resolve) => {
        const tick = () => {
            if (!smartPageAdjustingRef.current) {
                resolve();
                return;
            }
            requestAnimationFrame(tick);
        };
        tick();
    });
    const resolveDefaultLayoutParams = (
        a4Height?: number,
        densityOverride: 'compact' | 'standard' | 'spacious' = density
    ): SmartPageLayout => buildDefaultSmartPageLayout(densityOverride, a4Height);
    const restoreDefaultLayout = (isApplied = false) => {
        const defaultLayout = resolveDefaultLayoutParams(resolveA4Height() ?? undefined);
        setTopPaddingPx(defaultLayout.topPaddingPx);
        setSectionSpacingKey(defaultLayout.sectionSpacingKey);
        setItemSpacingEm(defaultLayout.itemSpacingEm);
        setLineHeight(defaultLayout.lineHeight);
        setFontSize(defaultLayout.fontSize);
        setIsSmartPageApplied(isApplied);
    };
    const applyVisibleLayout = (nextLayout: SmartPageLayout) => {
        setTopPaddingPx(nextLayout.topPaddingPx);
        setSectionSpacingKey(nextLayout.sectionSpacingKey);
        setItemSpacingEm(nextLayout.itemSpacingEm);
        setLineHeight(nextLayout.lineHeight);
        setFontSize(nextLayout.fontSize);
    };
    const applyLayoutSnapshot = async (snapshot: LayoutSnapshot) => {
        applyVisibleLayout(snapshot);
        setIsSmartPageApplied(snapshot.isSmartPageApplied);
        await waitForPreviewUpdate(2);
    };
    const measureContentHeight = () => {
        const container = measurePreviewContentRef.current;
        if (!container) {
            return 0;
        }
        return resolveMeasuredContentHeight(container);
    };
    const applyMeasureLayoutAndMeasure = async (nextLayout: SmartPageLayout) => {
        setMeasureLayout(nextLayout);
        await waitForPreviewUpdate(2);
        return measureContentHeight();
    };

    const tryMeasureLayout = async (
        a4Height: number,
        nextLayout: SmartPageLayout
    ): Promise<SmartPageResult> => {
        const height = await applyMeasureLayoutAndMeasure(nextLayout);
        const availableHeight = resolveSmartPageAvailableHeight(a4Height, nextLayout.topPaddingPx);
        if (isWithinAvailableHeight(height, availableHeight)) {
            return nextLayout;
        }
        return null;
    };

    const findFirstFittingLineHeight = async (
        a4Height: number,
        baseLayout: SmartPageBaseLayout,
        currentFontSize: number
    ): Promise<SmartPageResult> => {
        let low = 0;
        let high = LINE_HEIGHT_STEPS.length - 1;
        let candidateLayout: SmartPageResult = null;
        while (low <= high) {
            const mid = Math.floor((low + high) / 2);
            const fitLayout = await tryMeasureLayout(a4Height, {
                ...baseLayout,
                lineHeight: LINE_HEIGHT_STEPS[mid],
                fontSize: currentFontSize,
            });
            if (fitLayout) {
                candidateLayout = fitLayout;
                high = mid - 1;
            } else {
                low = mid + 1;
            }
        }
        return candidateLayout;
    };

    const tryFitAtFontSize = async (
        a4Height: number,
        baseLayout: SmartPageBaseLayout,
        currentFontSize: number
    ): Promise<SmartPageResult> => {
        return findFirstFittingLineHeight(a4Height, baseLayout, currentFontSize);
    };

    const tryFitAtBestFontSize = async (
        a4Height: number,
        baseLayout: SmartPageBaseLayout
    ): Promise<SmartPageResult> => {
        let low = 0;
        let high = FONT_SIZE_STEPS.length - 1;
        let candidateLayout: SmartPageResult = null;
        while (low <= high) {
            const mid = Math.floor((low + high) / 2);
            const fitLayout = await tryFitAtFontSize(
                a4Height,
                baseLayout,
                FONT_SIZE_STEPS[mid]
            );
            if (fitLayout) {
                candidateLayout = fitLayout;
                high = mid - 1;
            } else {
                low = mid + 1;
            }
        }
        return candidateLayout;
    };

    const executeSmartPageAdjustment = async (
        options?: { announce?: boolean }
    ): Promise<SmartPageExecutionResult> => {
        if (smartPageAdjustingRef.current) {
            return { status: 'skipped', reason: 'busy' };
        }
        smartPageAdjustingRef.current = true;
        setIsAutoSavePaused(true);
        try {
            if (!measurePreviewRef.current || !measurePreviewContentRef.current) {
                return { status: 'skipped', reason: 'unavailable' };
            }
            const a4Height = resolveA4Height();
            if (!a4Height) {
                return { status: 'skipped', reason: 'unavailable' };
            }
            if (options?.announce) {
                showToastInfo(
                    SMART_PAGE_TOAST_MESSAGES.adjusting,
                    SMART_PAGE_ADJUSTING_TOAST_DURATION_MS
                );
            }

            const finalizeFit = async (layout: SmartPageLayout): Promise<SmartPageExecutionResult> => {
                applyVisibleLayout(layout);
                setIsSmartPageApplied(true);
                await waitForPreviewUpdate(2);
                trackSmartOnePageTriggered({
                    lineHeight: layout.lineHeight,
                    fontSize: layout.fontSize,
                });
                return { status: 'fit', ...layout };
            };
            const finalizeOverflow = async (layout: SmartPageLayout): Promise<SmartPageExecutionResult> => {
                applyVisibleLayout(layout);
                setIsSmartPageApplied(true);
                await waitForPreviewUpdate(2);
                return { status: 'overflow', ...layout };
            };

            const defaultLayout = resolveDefaultLayoutParams(a4Height);
            const initialFit = await tryMeasureLayout(a4Height, defaultLayout);
            if (initialFit) {
                return finalizeFit(initialFit);
            }

            const topPaddingSteps = buildTopPaddingSteps(
                defaultLayout.topPaddingPx,
                SMART_PAGE_TOP_PADDING_MIN_PX,
                SMART_PAGE_TOP_PADDING_STEP_PX
            );
            const sectionSpacingSteps = [
                defaultLayout.sectionSpacingKey,
                ...SMART_PAGE_SECTION_SPACING_STEPS.filter(
                    (step) => step < defaultLayout.sectionSpacingKey
                ),
            ];
            const itemSpacingSteps = buildReductionStepsFromCurrent(
                defaultLayout.itemSpacingEm,
                SMART_PAGE_ITEM_SPACING_MIN,
                SMART_PAGE_ITEM_SPACING_STEP
            );
            const fitCache = new Map<string, SmartPageResult>();
            const itemIndexCache = new Map<string, number | null>();
            const sectionIndexCache = new Map<number, number | null>();
            const resolveBaseLayoutKey = (baseLayout: SmartPageBaseLayout) => (
                `${baseLayout.topPaddingPx}|${baseLayout.sectionSpacingKey}|${baseLayout.itemSpacingEm}`
            );
            const resolveFitForBaseLayout = async (
                baseLayout: SmartPageBaseLayout
            ): Promise<SmartPageResult> => {
                const cacheKey = resolveBaseLayoutKey(baseLayout);
                if (fitCache.has(cacheKey)) {
                    return fitCache.get(cacheKey) ?? null;
                }
                const fitLayout = await tryFitAtBestFontSize(a4Height, baseLayout);
                fitCache.set(cacheKey, fitLayout);
                return fitLayout;
            };
            const findFirstFittingItemIndex = async (
                topPaddingPx: number,
                sectionSpacingKey: SectionSpacingKey
            ) => {
                const cacheKey = `${topPaddingPx}|${sectionSpacingKey}`;
                if (itemIndexCache.has(cacheKey)) {
                    return itemIndexCache.get(cacheKey) ?? null;
                }
                let low = 0;
                let high = itemSpacingSteps.length - 1;
                let candidateIndex: number | null = null;
                while (low <= high) {
                    const mid = Math.floor((low + high) / 2);
                    const fitLayout = await resolveFitForBaseLayout({
                        topPaddingPx,
                        sectionSpacingKey,
                        itemSpacingEm: itemSpacingSteps[mid],
                    });
                    if (fitLayout) {
                        candidateIndex = mid;
                        high = mid - 1;
                    } else {
                        low = mid + 1;
                    }
                }
                itemIndexCache.set(cacheKey, candidateIndex);
                return candidateIndex;
            };
            const findFirstFittingSectionIndex = async (topPaddingPx: number) => {
                if (sectionIndexCache.has(topPaddingPx)) {
                    return sectionIndexCache.get(topPaddingPx) ?? null;
                }
                let low = 0;
                let high = sectionSpacingSteps.length - 1;
                let candidateIndex: number | null = null;
                while (low <= high) {
                    const mid = Math.floor((low + high) / 2);
                    const itemIndex = await findFirstFittingItemIndex(
                        topPaddingPx,
                        sectionSpacingSteps[mid]
                    );
                    if (itemIndex !== null) {
                        candidateIndex = mid;
                        high = mid - 1;
                    } else {
                        low = mid + 1;
                    }
                }
                sectionIndexCache.set(topPaddingPx, candidateIndex);
                return candidateIndex;
            };
            const maximallyCompressedBaseLayout: SmartPageBaseLayout = {
                topPaddingPx: topPaddingSteps[topPaddingSteps.length - 1],
                sectionSpacingKey: sectionSpacingSteps[sectionSpacingSteps.length - 1],
                itemSpacingEm: itemSpacingSteps[itemSpacingSteps.length - 1],
            };
            const maximallyCompressedFit = await resolveFitForBaseLayout(
                maximallyCompressedBaseLayout
            );
            if (!maximallyCompressedFit) {
                return finalizeOverflow({
                    ...maximallyCompressedBaseLayout,
                    lineHeight: LINE_HEIGHT_STEPS[LINE_HEIGHT_STEPS.length - 1],
                    fontSize: FONT_SIZE_STEPS[FONT_SIZE_STEPS.length - 1],
                });
            }

            let topPaddingLow = 0;
            let topPaddingHigh = topPaddingSteps.length - 1;
            let candidateTopPaddingIndex: number | null = null;
            while (topPaddingLow <= topPaddingHigh) {
                const mid = Math.floor((topPaddingLow + topPaddingHigh) / 2);
                const sectionIndex = await findFirstFittingSectionIndex(topPaddingSteps[mid]);
                if (sectionIndex !== null) {
                    candidateTopPaddingIndex = mid;
                    topPaddingHigh = mid - 1;
                } else {
                    topPaddingLow = mid + 1;
                }
            }
            if (candidateTopPaddingIndex !== null) {
                const topPaddingPx = topPaddingSteps[candidateTopPaddingIndex];
                const sectionIndex = await findFirstFittingSectionIndex(topPaddingPx);
                if (sectionIndex !== null) {
                    const sectionSpacingKey = sectionSpacingSteps[sectionIndex];
                    const itemIndex = await findFirstFittingItemIndex(
                        topPaddingPx,
                        sectionSpacingKey
                    );
                    if (itemIndex !== null) {
                        const fitLayout = await resolveFitForBaseLayout({
                            topPaddingPx,
                            sectionSpacingKey,
                            itemSpacingEm: itemSpacingSteps[itemIndex],
                        });
                        if (fitLayout) {
                            return finalizeFit(fitLayout);
                        }
                    }
                }
            }

            return finalizeOverflow({
                ...maximallyCompressedBaseLayout,
                lineHeight: LINE_HEIGHT_STEPS[LINE_HEIGHT_STEPS.length - 1],
                fontSize: FONT_SIZE_STEPS[FONT_SIZE_STEPS.length - 1],
            });
        } finally {
            smartPageAdjustingRef.current = false;
            setIsAutoSavePaused(false);
        }
    };
    const handleAdjustToSinglePage = async () => {
        const result = await executeSmartPageAdjustment({ announce: true });
        if (result.status === 'fit') {
            commitLayoutSnapshot(
                buildLayoutSnapshot(
                    {
                        topPaddingPx: result.topPaddingPx,
                        sectionSpacingKey: result.sectionSpacingKey,
                        itemSpacingEm: result.itemSpacingEm,
                        lineHeight: result.lineHeight,
                        fontSize: result.fontSize,
                    },
                    true
                ),
                { incrementVersion: true }
            );
            showToastSuccess(SMART_PAGE_TOAST_MESSAGES.success);
            return;
        }
        if (result.status === 'overflow') {
            commitLayoutSnapshot(
                buildLayoutSnapshot(
                    {
                        topPaddingPx: result.topPaddingPx,
                        sectionSpacingKey: result.sectionSpacingKey,
                        itemSpacingEm: result.itemSpacingEm,
                        lineHeight: result.lineHeight,
                        fontSize: result.fontSize,
                    },
                    true
                ),
                { incrementVersion: true }
            );
            showToastError(SMART_PAGE_TOAST_MESSAGES.overflow);
        }
    };
    const adjustToSinglePage = () => {
        void handleAdjustToSinglePage();
    };
    const handleRestoreDefault = () => {
        commitLayoutSnapshot(
            buildLayoutSnapshot(
                resolveDefaultLayoutParams(resolveA4Height() ?? undefined),
                false
            ),
            { incrementVersion: true }
        );
        restoreDefaultLayout(false);
    };
    const restoreDefault = () => {
        handleRestoreDefault();
    };
    const handleResumeNameChange = (name: string) => {
        void applyResumeNameUpdate(name);
    };
    const resetEditorTransientState = useCallback((
        nextProfile: ResumeEditorProfile,
        nextProfileSyncMode: ProfileSyncMode
    ) => {
        handleCancelDelete();
        setOriginalProfile({ ...nextProfile });
        setOriginalProfileSyncMode(nextProfileSyncMode);
        setIsEditingProfile(false);
        experience.cancelEditingExperience();
        education.cancelEducationEdit();
        certification.cancelCertificationEdit();
        skill.cancelSkillEdit();
        skill.setRenamingCategoryTarget(null);
        skill.setRenamingCategoryDraft('');
    }, [
        certification.cancelCertificationEdit,
        education.cancelEducationEdit,
        experience.cancelEditingExperience,
        handleCancelDelete,
        setIsEditingProfile,
        setOriginalProfile,
        setOriginalProfileSyncMode,
        skill.cancelSkillEdit,
        skill.setRenamingCategoryDraft,
        skill.setRenamingCategoryTarget,
    ]);
    const handleCreateResume = useCallback(async () => {
        if (isCreatingResume) {
            return;
        }
        let hasSwitchedResume = false;
        setIsCreatingResume(true);
        try {
            suppressAutoSaveForConfig(resumeConfigSnapshot);
            await flushResumeConfig(buildCommittedResumeConfigSnapshot());
            const created = await resumeService.create({ title: DEFAULT_RESUME_TITLE });
            prependDashboardCache(created);
            const reloadedContext = await reloadResumeContext(created.id);
            if (!reloadedContext) {
                throw new Error('resume_reload_failed');
            }
            resetEditorTransientState(
                reloadedContext.profile,
                reloadedContext.profileSyncMode
            );
            hasSwitchedResume = true;
            showToastSuccess('新简历已创建');
        } catch (error) {
            console.error('[ResumeEditor] 创建新简历失败:', error);
            showToastError('创建新简历失败，请稍后重试');
        } finally {
            if (!hasSwitchedResume) {
                clearSuppressedAutoSave();
            }
            setIsCreatingResume(false);
        }
    }, [
        buildCommittedResumeConfigSnapshot,
        clearSuppressedAutoSave,
        flushResumeConfig,
        isCreatingResume,
        prependDashboardCache,
        reloadResumeContext,
        resetEditorTransientState,
        showToastError,
        showToastSuccess,
        suppressAutoSaveForConfig,
        resumeConfigSnapshot,
    ]);
    const handlePolishExperienceFromCard = useCallback(async (id: string) => {
        await experience.handlePolishExperienceById(id);
    }, [experience]);

    const resolveIndexPosition = <T,>(
        items: T[],
        predicate: (item: T) => boolean
    ) => {
        const index = items.findIndex(predicate);
        return index >= 0 ? index + 1 : null;
    };

    const resolveExperiencePosition = (id: string, category: 'work' | 'project') => {
        const items = experienceItems.filter((item) => item.category === category);
        return resolveIndexPosition(items, (item) => item.id === id);
    };

    const buildItemReorderContext = (itemKey: string): ModuleReorderContext | null => {
        const parsed = parseDragItemKey(itemKey);
        if (!parsed) {
            return null;
        }
        const moduleType = mapDragTypeToModuleType(parsed.type);
        if (parsed.type === 'experience') {
            const item = experienceItems.find((entry) => entry.id === parsed.id);
            if (!item) {
                return null;
            }
            const position = resolveExperiencePosition(parsed.id, item.category);
            if (!position) {
                return null;
            }
            return {
                moduleType,
                moduleKey: resolveModuleKey(moduleType, item.category),
                id: parsed.id,
                fromPosition: position,
                category: item.category,
            };
        }
        if (parsed.type === 'education') {
            const position = resolveIndexPosition(educations, (item) => item.id === parsed.id);
            if (!position) {
                return null;
            }
            return {
                moduleType,
                moduleKey: resolveModuleKey(moduleType),
                id: parsed.id,
                fromPosition: position,
            };
        }
        if (parsed.type === 'certification') {
            const position = resolveIndexPosition(certifications, (item) => item.id === parsed.id);
            if (!position) {
                return null;
            }
            return {
                moduleType,
                moduleKey: resolveModuleKey(moduleType),
                id: parsed.id,
                fromPosition: position,
            };
        }
        const position = resolveIndexPosition(skillGroups, (group) => group.name === parsed.id);
        if (!position) {
            return null;
        }
        return {
            moduleType,
            moduleKey: resolveModuleKey(moduleType),
            id: parsed.id,
            fromPosition: position,
        };
    };

    const resolveCurrentPosition = (context: ModuleReorderContext) => {
        switch (context.moduleType) {
            case 'experience':
                if (!context.category) {
                    return null;
                }
                return resolveExperiencePosition(context.id, context.category);
            case 'education':
                return resolveIndexPosition(educations, (item) => item.id === context.id);
            case 'certification':
                return resolveIndexPosition(certifications, (item) => item.id === context.id);
            case 'skill_group':
                return resolveIndexPosition(skillGroups, (group) => group.name === context.id);
            case 'section':
                return resolveIndexPosition(sectionOrder, (item) => item === context.id);
            default:
                return null;
        }
    };

    const finalizeReorderTracking = () => {
        const context = reorderContextRef.current;
        if (!context) {
            return;
        }
        const toPosition = resolveCurrentPosition(context);
        reorderContextRef.current = null;
        if (!toPosition || toPosition === context.fromPosition) {
            return;
        }
        trackModuleReordered({
            moduleType: context.moduleType,
            moduleKey: context.moduleKey,
            fromPosition: context.fromPosition,
            toPosition,
            sectionId: context.sectionId,
        }, authUserKey);
    };
    const handleDragStart = (e: React.DragEvent, itemKey: string) => {
        lastItemHoverKeyRef.current = null;
        lastSectionHoverKeyRef.current = null;
        setDraggedSectionId(null);
        setDraggedItemKey(itemKey);
        reorderContextRef.current = buildItemReorderContext(itemKey);
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
        reorderContextRef.current = null;
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
        finalizeReorderTracking();
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
        const sectionPosition = resolveIndexPosition(sectionOrder, (item) => item === sectionId);
        reorderContextRef.current = sectionPosition
            ? {
                moduleType: 'section',
                moduleKey: resolveModuleKey('section', undefined, sectionId),
                id: sectionId,
                fromPosition: sectionPosition,
                sectionId,
            }
            : null;
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
        finalizeReorderTracking();
        clearDragState();
    };
    const editingItem = experienceItems.find((item) => item.id === experience.editingExpId);
    const listSpacingValue = useMemo(() => {
        return buildSpacingValue(itemSpacingEm, lineHeight);
    }, [itemSpacingEm, lineHeight]);
    const bulletSpacingValue = useMemo(
        () => buildSpacingValue(LIST_SPACING_BY_DENSITY.compact, lineHeight),
        [lineHeight]
    );
    const sectionSpacingClass = useMemo(
        () => resolveSectionSpacingClass(sectionSpacingKey),
        [sectionSpacingKey]
    );
    const measureListSpacingValue = useMemo(
        () => buildSpacingValue(measureLayout.itemSpacingEm, measureLayout.lineHeight),
        [measureLayout.itemSpacingEm, measureLayout.lineHeight]
    );
    const measureBulletSpacingValue = useMemo(
        () => buildSpacingValue(LIST_SPACING_BY_DENSITY.compact, measureLayout.lineHeight),
        [measureLayout.lineHeight]
    );
    const measureSectionSpacingClass = useMemo(
        () => resolveSectionSpacingClass(measureLayout.sectionSpacingKey),
        [measureLayout.sectionSpacingKey]
    );
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
    const selectedCertifications = useMemo(
        () => sortedCertifications.filter((item) => selectedCertIds.has(item.id)),
        [selectedCertIds, sortedCertifications]
    );
    const selectedResumeSnapshot = useMemo(
        () => buildResumeAISnapshot(
            [...selectedWorkItems, ...selectedProjectItems],
            selectedCertifications,
            selectedSkillGroups
        ),
        [selectedCertifications, selectedProjectItems, selectedSkillGroups, selectedWorkItems]
    );
    const selectedResumeSnapshotText = useMemo(
        () => buildStableResumeSnapshotText(selectedResumeSnapshot),
        [selectedResumeSnapshot]
    );
    const bossGreetingCurrentSignature = useMemo(
        () => buildBossGreetingSignature({
            jdText: jdPolishContext,
            summary: analysisResult?.summary ?? '',
            jobTitle: analysisResult?.jobTitle,
            company: analysisResult?.company,
            resumeText: selectedResumeSnapshotText,
        }),
        [analysisResult?.company, analysisResult?.jobTitle, analysisResult?.summary, jdPolishContext, selectedResumeSnapshotText]
    );
    const isBossGreetingOutdated = Boolean(
        bossGreeting && bossGreetingSignature !== bossGreetingCurrentSignature
    );
    latestResumeIdRef.current = resumeId;
    latestBossGreetingSignatureRef.current = bossGreetingCurrentSignature;
    latestBossGreetingAnalysisOutdatedRef.current = isOutdated;
    bossGreetingUiStateRef.current = {
        text: bossGreeting,
        isVisible: isBossGreetingVisible,
    };

    const applyAssemblySelection = useCallback(async (
        selection: Pick<AutoAssemblySelection, 'experienceIds' | 'certificationIds' | 'skillIds'>
    ) => {
        isProgrammaticSelectionUpdateRef.current = true;
        try {
            setSelectedExpIds(new Set(selection.experienceIds));
            setSelectedCertIds(new Set(selection.certificationIds));
            setSelectedSkillIds(new Set(selection.skillIds));
            await waitForPreviewUpdate(2);
        } finally {
            isProgrammaticSelectionUpdateRef.current = false;
        }
    }, []);

    const buildAutoAssemblySelection = useCallback((result: JDAnalysisResult): AutoAssemblySelection => {
        const experienceItemsByScore = buildOrderedScoreItems(
            [...workItems, ...projectItems],
            toMatchScoreMap(result.experienceMatches)
        );
        const certificationItemsByScore = buildOrderedScoreItems(
            sortedCertifications,
            toMatchScoreMap(result.certificationMatches)
        );
        const skillItemsByScore = buildOrderedScoreItems(
            skillGroups.flatMap((group) => group.skills),
            toMatchScoreMap(result.skillMatches)
        );
        const matchedExperienceItems = experienceItemsByScore.filter(hasPositiveMatchScore);
        const experienceIds = pickTopIds(
            matchedExperienceItems,
            AUTO_ASSEMBLY_MAX_EXPERIENCES
        );
        const certificationIds = pickThresholdIds(
            certificationItemsByScore,
            AUTO_ASSEMBLY_MATCH_THRESHOLD
        );
        const skillIds = pickThresholdIds(skillItemsByScore, AUTO_ASSEMBLY_MATCH_THRESHOLD);
        return {
            hasMatchedExperience: matchedExperienceItems.length > 0,
            experienceIds,
            certificationIds,
            skillIds,
            experienceRemovalQueue: buildRemovalQueue(new Set(experienceIds), experienceItemsByScore),
            certificationRemovalQueue: buildRemovalQueue(new Set(certificationIds), certificationItemsByScore),
            skillRemovalQueue: buildRemovalQueue(new Set(skillIds), skillItemsByScore),
        };
    }, [projectItems, skillGroups, sortedCertifications, workItems]);

    const runAutoAssemblySelection = useCallback(async (
        selection: AutoAssemblySelection,
        requestedResumeId: string | null,
        requestedSelectionVersion: number,
        requestedLayoutVersion: number,
        initialStateSnapshot: AutoAssemblyStateSnapshot
    ): Promise<SmartPageExecutionResult> => {
        const isResumeRequestCurrent = () => latestResumeIdRef.current === requestedResumeId;
        const isSelectionVersionCurrent = () => (
            manualSelectionVersionRef.current === requestedSelectionVersion
        );
        const isLayoutVersionCurrent = () => (
            manualLayoutVersionRef.current === requestedLayoutVersion
        );
        const isAssemblyStateCurrent = () => (
            isResumeRequestCurrent()
            && isSelectionVersionCurrent()
            && isLayoutVersionCurrent()
        );
        const currentSelection = {
            experienceIds: [...selection.experienceIds],
            certificationIds: [...selection.certificationIds],
            skillIds: [...selection.skillIds],
        };
        const restoreInitialState = async () => {
            if (!isResumeRequestCurrent()) {
                return;
            }
            await applyAssemblySelection(initialStateSnapshot.selection);
            await applyLayoutSnapshot(initialStateSnapshot.layout);
        };
        const restoreInitialSelection = async () => {
            if (!isResumeRequestCurrent()) {
                return;
            }
            await applyAssemblySelection(initialStateSnapshot.selection);
        };
        const restoreLatestManualState = async () => {
            if (!isResumeRequestCurrent()) {
                return;
            }
            await applyAssemblySelection(manualSelectionSnapshotRef.current);
            await applyLayoutSnapshot(manualLayoutSnapshotRef.current);
        };
        const restoreStateAfterBusySkip = async () => {
            await waitForSmartPageIdle();
            if (!isResumeRequestCurrent()) {
                return;
            }
            if (!isSelectionVersionCurrent()) {
                await restoreLatestManualState();
                return;
            }
            await restoreInitialSelection();
        };
        const applySelectionAndMeasure = async (
            nextSelection: Pick<AutoAssemblySelection, 'experienceIds' | 'certificationIds' | 'skillIds'>
        ): Promise<SmartPageExecutionResult> => {
            if (!isResumeRequestCurrent()) {
                return { status: 'skipped', reason: 'busy' };
            }
            if (!isAssemblyStateCurrent()) {
                await restoreLatestManualState();
                return { status: 'skipped', reason: 'busy' };
            }
            if (smartPageAdjustingRef.current) {
                await restoreStateAfterBusySkip();
                return { status: 'skipped', reason: 'busy' };
            }
            await applyAssemblySelection(nextSelection);
            const result = await executeSmartPageAdjustment();
            if (!isAssemblyStateCurrent()) {
                await restoreLatestManualState();
                return { status: 'skipped', reason: 'busy' };
            }
            if (result.status === 'skipped') {
                if (result.reason === 'busy') {
                    await restoreStateAfterBusySkip();
                    return result;
                }
                await restoreInitialState();
            }
            return result;
        };
        const removeNext = async (
            ids: string[],
            target: 'experienceIds' | 'certificationIds' | 'skillIds'
        ) => {
            const minRemaining = target === 'experienceIds' ? 1 : 0;
            for (const id of ids) {
                if (!isResumeRequestCurrent()) {
                    return { status: 'skipped', reason: 'busy' } as const;
                }
                if (!isAssemblyStateCurrent()) {
                    await restoreLatestManualState();
                    return { status: 'skipped', reason: 'busy' } as const;
                }
                if (currentSelection[target].length <= minRemaining) {
                    return null;
                }
                currentSelection[target] = currentSelection[target].filter((itemId) => itemId !== id);
                const result = await applySelectionAndMeasure(currentSelection);
                if (result.status === 'fit' || result.status === 'skipped') {
                    return result;
                }
            }
            return null;
        };

        let lastOverflowResult: Extract<SmartPageExecutionResult, { status: 'overflow' }> | null = null;
        const initialResult = await applySelectionAndMeasure(currentSelection);
        if (initialResult.status === 'fit' || initialResult.status === 'skipped') {
            return initialResult;
        }
        lastOverflowResult = initialResult;
        const skillResult = await removeNext(selection.skillRemovalQueue, 'skillIds');
        if (skillResult) {
            return skillResult;
        }
        const certificationResult = await removeNext(
            selection.certificationRemovalQueue,
            'certificationIds'
        );
        if (certificationResult) {
            return certificationResult;
        }
        const experienceResult = await removeNext(selection.experienceRemovalQueue, 'experienceIds');
        if (experienceResult) {
            return experienceResult;
        }
        return lastOverflowResult ?? {
            status: 'overflow',
            topPaddingPx,
            sectionSpacingKey,
            itemSpacingEm,
            lineHeight,
            fontSize,
        };
    }, [applyAssemblySelection, applyLayoutSnapshot, waitForSmartPageIdle]);

    const handleAutoAssemble = useCallback(async () => {
        if (isAutoAssembling) {
            return;
        }
        if (!analysisResult && !hasMissingAttachmentContext && !jdFile && !jdText.trim()) {
            showToastError(AUTO_ASSEMBLY_TOAST_MESSAGES.emptyJd);
            return;
        }
        const requestedResumeId = resumeId;
        const isResumeRequestCurrent = () => latestResumeIdRef.current === requestedResumeId;
        const requestId = autoAssembleRequestIdRef.current + 1;
        autoAssembleRequestIdRef.current = requestId;
        const isAutoAssembleRequestCurrent = () => autoAssembleRequestIdRef.current === requestId;
        const toastId = showToastLoading(AUTO_ASSEMBLY_TOAST_MESSAGES.loading);
        activeAutoAssembleToastIdRef.current = toastId;
        const releaseActiveAutoAssembleToast = () => {
            if (activeAutoAssembleToastIdRef.current === toastId) {
                activeAutoAssembleToastIdRef.current = null;
            }
        };
        setIsAutoAssembling(true);
        try {
            const requestedSelectionVersion = manualSelectionVersionRef.current;
            const requestedLayoutVersion = manualLayoutVersionRef.current;
            const effectiveResult = (!analysisResult || isOutdated)
                ? await handleAnalyzeWithAutoName()
                : analysisResult;
            if (!isResumeRequestCurrent() || !isAutoAssembleRequestCurrent()) {
                closeToast(toastId);
                releaseActiveAutoAssembleToast();
                return;
            }
            if (!effectiveResult) {
                closeToast(toastId);
                releaseActiveAutoAssembleToast();
                return;
            }
            const selection = buildAutoAssemblySelection(effectiveResult);
            if (!selection.hasMatchedExperience) {
                updateToast(toastId, {
                    message: AUTO_ASSEMBLY_TOAST_MESSAGES.noExperienceMatch,
                    type: 'error',
                    duration: JD_ANALYSIS_TOAST_ERROR_DURATION_MS,
                });
                releaseActiveAutoAssembleToast();
                return;
            }
            const smartPageResult = await runAutoAssemblySelection(
                selection,
                requestedResumeId,
                requestedSelectionVersion,
                requestedLayoutVersion,
                {
                    selection: buildSelectionSnapshot(
                        selectedExpIds,
                        selectedCertIds,
                        selectedSkillIds
                    ),
                    layout: buildLayoutSnapshot(
                        {
                            topPaddingPx,
                            sectionSpacingKey,
                            itemSpacingEm,
                            lineHeight,
                            fontSize,
                        },
                        isSmartPageApplied
                    ),
                }
            );
            if (!isResumeRequestCurrent() || !isAutoAssembleRequestCurrent()) {
                closeToast(toastId);
                releaseActiveAutoAssembleToast();
                return;
            }
            if (smartPageResult.status !== 'skipped') {
                await waitForPreviewUpdate(2);
                commitLayoutSnapshot(latestLayoutSnapshotRef.current);
            }
            updateToast(toastId, {
                message: smartPageResult.status === 'fit'
                    ? AUTO_ASSEMBLY_TOAST_MESSAGES.success
                    : smartPageResult.status === 'skipped'
                        ? AUTO_ASSEMBLY_TOAST_MESSAGES.skipped
                        : AUTO_ASSEMBLY_TOAST_MESSAGES.partialOverflow,
                type: smartPageResult.status === 'fit' ? 'success' : 'error',
                duration: JD_ANALYSIS_TOAST_DURATION_MS,
            });
            releaseActiveAutoAssembleToast();
        } catch (error) {
            if (!isResumeRequestCurrent() || !isAutoAssembleRequestCurrent()) {
                closeToast(toastId);
                return;
            }
            console.error('[ResumeEditor] 一键组装失败:', error);
            updateToast(toastId, {
                message: AUTO_ASSEMBLY_TOAST_MESSAGES.error,
                type: 'error',
                duration: JD_ANALYSIS_TOAST_ERROR_DURATION_MS,
            });
            releaseActiveAutoAssembleToast();
        } finally {
            if (isAutoAssembleRequestCurrent()) {
                setIsAutoAssembling(false);
            }
        }
    }, [
        analysisResult,
        buildAutoAssemblySelection,
        handleAnalyzeWithAutoName,
        isAutoAssembling,
        isOutdated,
        jdFile,
        jdText,
        runAutoAssemblySelection,
        showToastError,
        showToastLoading,
        updateToast,
        waitForPreviewUpdate,
        commitLayoutSnapshot,
        closeToast,
        fontSize,
        isSmartPageApplied,
        itemSpacingEm,
        lineHeight,
        resumeId,
        sectionSpacingKey,
        topPaddingPx,
        selectedCertIds,
        selectedExpIds,
        selectedSkillIds,
    ]);

    const generateBossGreeting = useCallback(async (options?: { forceRefresh?: boolean }) => {
        const forceRefresh = options?.forceRefresh ?? false;
        const canReuseBossGreeting = !forceRefresh && Boolean(
            bossGreeting
            && !isBossGreetingOutdated
            && !isOutdated
        );
        if (isGeneratingBossGreeting) {
            return;
        }
        if (canReuseBossGreeting) {
            setIsBossGreetingVisible((prev) => !prev);
            return;
        }
        if (!analysisResult && !hasMissingAttachmentContext && !jdFile && !jdText.trim()) {
            showToastError(BOSS_GREETING_TOAST_MESSAGES.empty);
            return;
        }
        const requestedResumeId = resumeId;
        const isResumeRequestCurrent = () => latestResumeIdRef.current === requestedResumeId;
        const requestId = bossGreetingRequestIdRef.current + 1;
        bossGreetingRequestIdRef.current = requestId;
        const isBossGreetingRequestCurrent = () => bossGreetingRequestIdRef.current === requestId;
        setIsGeneratingBossGreeting(true);
        const toastId = showToastLoading(BOSS_GREETING_TOAST_MESSAGES.loading);
        activeBossGreetingToastIdRef.current = toastId;
        const releaseActiveBossGreetingToast = () => {
            if (activeBossGreetingToastIdRef.current === toastId) {
                activeBossGreetingToastIdRef.current = null;
            }
        };
        try {
            const effectiveResult = (!analysisResult || isOutdated)
                ? await handleAnalyzeWithAutoName()
                : analysisResult;
            if (!isResumeRequestCurrent() || !isBossGreetingRequestCurrent()) {
                closeToast(toastId);
                releaseActiveBossGreetingToast();
                return;
            }
            if (!effectiveResult) {
                closeToast(toastId);
                releaseActiveBossGreetingToast();
                return;
            }
            if (!effectiveResult.summary?.trim()) {
                updateToast(toastId, {
                    message: BOSS_GREETING_TOAST_MESSAGES.empty,
                    type: 'error',
                    duration: JD_ANALYSIS_TOAST_ERROR_DURATION_MS,
                });
                releaseActiveBossGreetingToast();
                return;
            }
            const requestedBossGreetingSignature = buildBossGreetingSignature({
                jdText: jdPolishContext,
                summary: effectiveResult.summary,
                jobTitle: effectiveResult.jobTitle,
                company: effectiveResult.company,
                resumeText: selectedResumeSnapshotText,
            });
            setIsBossGreetingVisible(true);
            const response = await aiService.generateBossGreeting({
                jdText: jdPolishContext,
                analysisSummary: effectiveResult.summary,
                jobTitle: effectiveResult.jobTitle,
                company: effectiveResult.company,
                resumeText: selectedResumeSnapshotText,
            });
            const nextGreeting = response.greeting.trim();
            if (!nextGreeting) {
                throw new Error('empty_greeting');
            }
            if (!isResumeRequestCurrent() || !isBossGreetingRequestCurrent()) {
                closeToast(toastId);
                releaseActiveBossGreetingToast();
                return;
            }
            if (
                latestResumeIdRef.current !== requestedResumeId
                || latestBossGreetingAnalysisOutdatedRef.current
                || latestBossGreetingSignatureRef.current !== requestedBossGreetingSignature
            ) {
                const shouldKeepVisible = (
                    bossGreetingUiStateRef.current.isVisible
                    && Boolean(bossGreetingUiStateRef.current.text.trim())
                );
                setIsBossGreetingVisible(shouldKeepVisible);
                closeToast(toastId);
                releaseActiveBossGreetingToast();
                return;
            }
            setBossGreeting(nextGreeting);
            setBossGreetingSignature(requestedBossGreetingSignature);
            updateToast(toastId, {
                message: BOSS_GREETING_TOAST_MESSAGES.success,
                type: 'success',
                duration: JD_ANALYSIS_TOAST_DURATION_MS,
            });
            releaseActiveBossGreetingToast();
        } catch (error) {
            if (!isResumeRequestCurrent() || !isBossGreetingRequestCurrent()) {
                closeToast(toastId);
                releaseActiveBossGreetingToast();
                return;
            }
            console.error('[ResumeEditor] 生成 BOSS 招呼语失败:', error);
            updateToast(toastId, {
                message: BOSS_GREETING_TOAST_MESSAGES.error,
                type: 'error',
                duration: JD_ANALYSIS_TOAST_ERROR_DURATION_MS,
            });
            releaseActiveBossGreetingToast();
        } finally {
            if (isBossGreetingRequestCurrent()) {
                setIsGeneratingBossGreeting(false);
            }
        }
    }, [
        analysisResult,
        bossGreeting,
        isBossGreetingOutdated,
        isGeneratingBossGreeting,
        isOutdated,
        jdFile,
        handleAnalyzeWithAutoName,
        jdPolishContext,
        resumeId,
        selectedResumeSnapshotText,
        showToastError,
        showToastLoading,
        updateToast,
        closeToast,
        jdText,
        hasMissingAttachmentContext,
    ]);

    const handleGenerateBossGreeting = useCallback(() => {
        void generateBossGreeting();
    }, [generateBossGreeting]);

    const handleRefreshBossGreeting = useCallback(() => {
        void generateBossGreeting({ forceRefresh: true });
    }, [generateBossGreeting]);

    const handleCollapseBossGreeting = useCallback(() => {
        setIsBossGreetingVisible(false);
    }, []);

    const handleCopyBossGreeting = useCallback(async () => {
        if (!bossGreeting.trim()) {
            return;
        }
        try {
            if (!navigator.clipboard) {
                throw new Error('clipboard_unavailable');
            }
            await navigator.clipboard.writeText(bossGreeting);
            showToastSuccess(BOSS_GREETING_TOAST_MESSAGES.copySuccess);
        } catch (error) {
            console.error('[ResumeEditor] 复制 BOSS 招呼语失败:', error);
            showToastError(BOSS_GREETING_TOAST_MESSAGES.copyError);
        }
    }, [bossGreeting, showToastError, showToastSuccess]);

    useEffect(() => {
        autoAssembleRequestIdRef.current += 1;
        bossGreetingRequestIdRef.current += 1;
        if (activeAutoAssembleToastIdRef.current) {
            closeToast(activeAutoAssembleToastIdRef.current);
            activeAutoAssembleToastIdRef.current = null;
        }
        if (activeBossGreetingToastIdRef.current) {
            closeToast(activeBossGreetingToastIdRef.current);
            activeBossGreetingToastIdRef.current = null;
        }
        setIsAutoAssembling(false);
        setIsGeneratingBossGreeting(false);
        setBossGreeting('');
        setBossGreetingSignature('');
        setIsBossGreetingVisible(false);
    }, [closeToast, resumeId]);

    const handleExportPdf = useCallback(() => {
        if (isPrinting) {
            return;
        }
        const content = (
            <div className="rf-print-preview">
                <ResumePreview
                    previewRef={printPreviewRef}
                    previewContentRef={printPreviewContentRef}
                    previewScope="print"
                    lineHeight={lineHeight}
                    fontSize={fontSize}
                    listSpacingValue={listSpacingValue}
                    bulletSpacingValue={bulletSpacingValue}
                    topPaddingPx={topPaddingPx}
                    profile={profile}
                    sectionSpacingClass={sectionSpacingClass}
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
                    onSectionDragStart={() => { }}
                    onSectionDragHover={() => { }}
                    onSectionDrop={() => { }}
                    onItemDragStart={() => { }}
                    onItemDragHover={() => { }}
                    onItemDrop={() => { }}
                    onDragEnd={() => { }}
                    onNavigateTab={() => { }}
                    onEditExperience={() => { }}
                    onEditCertification={() => { }}
                    onEditSkill={() => { }}
                />
            </div>
        );
        startPrint({
            title: buildResumeExportTitle(resumeName),
            content,
        });
        trackResumeExported(authUserKey);
    }, [
        authUserKey,
        bulletSpacingValue,
        educations,
        fontSize,
        isPrinting,
        lineHeight,
        listSpacingClass,
        listSpacingValue,
        profile,
        topPaddingPx,
        resumeName,
        sectionOrder,
        selectedCertIds,
        selectedEduIds,
        selectedProjectItems,
        selectedSkillGroups,
        selectedWorkItems,
        sortedCertifications,
        sectionSpacingClass,
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
    const handleJdTextChange = useCallback(
        (value: string) => {
            const nextJdText = value.trim();
            const currentAutoName = resolveAutoResumeName(analysisResult, jdText);
            setJdText(value);
            if (
                nextJdText === ''
                && currentAutoName
                && normalizeResumeTitle(resumeName) === currentAutoName
            ) {
                void applyResumeNameUpdate(DEFAULT_RESUME_TITLE, { silent: true });
            }
        },
        [analysisResult, applyResumeNameUpdate, jdText, resumeName, setJdText]
    );
    const showDebugInfo =
        import.meta.env.DEV && localStorage.getItem('jdDebug') === '1';
    const isEditorBusy = isLoadingResume || isCreatingResume;
    return (
        <div
            className="relative flex-1 flex flex-col h-full overflow-hidden bg-background-light dark:bg-background-dark"
            aria-busy={isEditorBusy}
        >
            <EditorToolbar
                isDarkMode={isDarkMode}
                saveState={saveState}
                lastSavedAt={lastSavedAt}
                onToggleTheme={toggleTheme}
                isSmartPageApplied={isSmartPageApplied}
                onAdjustToSinglePage={adjustToSinglePage}
                onRestoreDefault={restoreDefault}
                isCreatingResume={isCreatingResume}
                onCreateResume={handleCreateResume}
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
                        onJdTextChange: handleJdTextChange,
                        jdFile,
                        onFileChange: setJdFile,
                        hasMissingAttachmentContext,
                        bossGreeting,
                        isBossGreetingVisible,
                        isBossGreetingOutdated,
                        isGeneratingBossGreeting,
                        onGenerateBossGreeting: handleGenerateBossGreeting,
                        onRefreshBossGreeting: handleRefreshBossGreeting,
                        onCopyBossGreeting: handleCopyBossGreeting,
                        onCollapseBossGreeting: handleCollapseBossGreeting,
                        debugInfo,
                        showDebugInfo,
                        isOutdated,
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
                        onToggleEducationSelection: trackedSelection.toggleEducationSelection,
                    }}
                    experienceTabProps={{
                        experience,
                        certification,
                        skill,
                        selection: trackedSelection,
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
                        isAutoAssembling,
                        onAutoAssemble: handleAutoAssemble,
                        onResetRenamingCategory: resetRenamingCategory,
                        onPolishExperience: handlePolishExperienceFromCard,
                        onResetWorkSort: () => handleResetSort('work'),
                        onResetProjectSort: () => handleResetSort('project'),
                        onResetCertificationSort: handleResetCertificationSort,
                    }}
                    editingSuggestion={{
                        editingItem,
                        staleExperienceIds,
                        jdText: jdPolishContext,
                        isPolishing: experience.isPolishing,
                        onPolish: experience.handlePolishWithJD,
                    }}
                />
                <ResumePreview
                    previewRef={previewRef}
                    previewContentRef={previewContentRef}
                    previewScope="editor"
                    lineHeight={lineHeight}
                    fontSize={fontSize}
                    listSpacingValue={listSpacingValue}
                    bulletSpacingValue={bulletSpacingValue}
                    topPaddingPx={topPaddingPx}
                    profile={profile}
                    sectionSpacingClass={sectionSpacingClass}
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
                <div className="fixed left-[-200vw] top-0 w-screen md:w-[calc(100vw-600px)] pointer-events-none opacity-0" aria-hidden="true">
                    <ResumePreview
                        previewRef={measurePreviewRef}
                        previewContentRef={measurePreviewContentRef}
                        previewScope="measure"
                        lineHeight={measureLayout.lineHeight}
                        fontSize={measureLayout.fontSize}
                        listSpacingValue={measureListSpacingValue}
                        bulletSpacingValue={measureBulletSpacingValue}
                        topPaddingPx={measureLayout.topPaddingPx}
                        profile={profile}
                        sectionSpacingClass={measureSectionSpacingClass}
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
                        onSectionDragStart={() => { }}
                        onSectionDragHover={() => { }}
                        onSectionDrop={() => { }}
                        onItemDragStart={() => { }}
                        onItemDragHover={() => { }}
                        onItemDrop={() => { }}
                        onDragEnd={() => { }}
                        onNavigateTab={setSidebarTab}
                        onEditExperience={() => { }}
                        onEditCertification={() => { }}
                        onEditSkill={() => { }}
                    />
                </div>
            {isEditorBusy ? (
                <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/70 dark:bg-black/50 backdrop-blur-[1px]">
                    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-3 text-sm font-medium text-gray-600 dark:text-gray-200 shadow-sm">
                        {isCreatingResume ? '正在创建并切换简历...' : '正在加载简历...'}
                    </div>
                </div>
            ) : null}
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

