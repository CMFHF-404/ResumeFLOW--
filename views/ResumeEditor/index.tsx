import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Database } from 'lucide-react';
import ConfirmDialog from '../../components/ConfirmDialog';
import { ToastContainer, useToast } from '../../components/Toast';
import { useExperienceActions } from '../../hooks/useExperienceActions';
import { useJDAnalysis } from '../../hooks/useJDAnalysis';
import { useResumeData } from '../../hooks/useResumeData';
import { exportService } from '../../services/exportService';
import { profileService } from '../../services/profileService';
import { resumeService, type Resume as ResumeRecord } from '../../services/resumeService';
import {
    aiService,
    type BossGreetingStreamEvent,
    type JDAnalysisResult,
    type PersonalSummaryStreamEvent,
} from '../../services/aiService';
import type { Certification as CertificationRecord } from '../../services/certificationsService';
import type { ExperienceListItem } from '../../services/experienceService';
import type {
    CertificationView,
    EducationView,
    ProfileSyncMode,
    ResumeEditorConfig,
    ResumeEditorProfile,
    ResumeJDAnalysis,
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
import {
    loadJDAnalysisCache,
    normalizeJDAnalysisPersistence,
    selectPreferredPersistedJDAnalysis,
} from '../jdAnalysisStorage';
import { type DropPosition, moveItemWithDropPosition } from '../../utils/dragSort';
import { formatRelativeTime } from '../../utils/timeUtils';
import { buildResumeExportTitle } from '../../utils/exportFilename';
import { downloadUrlFile } from '../../utils/downloadUrlFile';
import { extractThoughtHeadline } from '../../utils/aiThought';
import {
    trackBossGreetingResult,
    trackBossGreetingStart,
    trackLayoutModeChange,
    trackModuleReordered,
    trackResumeDuplicated,
    trackResumeExported,
    trackSmartAssemblyResult,
    trackSmartAssemblyStart,
    trackSmartOnePageTriggered,
} from '../../utils/analyticsTracker';
import { mapResumesToDashboard } from '../../utils/dashboardResumeMapper';
import { DEFAULT_RESUME_TITLE, UNTITLED_RESUME_TITLE } from '../../constants/resumeConstants';
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
    SIDEBAR_WIDTH_CLASS,
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
    DEFAULT_MATCH_SCORE_FILTER,
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
import { buildResumePdfRenderSnapshot } from '../../utils/resumePdf';
import {
    DEFAULT_RESUME_TEMPLATE_ID,
    RESUME_THEME_COLOR_PRESETS,
    normalizeResumeTemplateId,
    resolveDefaultResumeThemeColorPresetId,
    type ResumeTemplateId,
    type ResumeThemeColorPresetId,
} from '../../constants/resumeTemplates';
import {
    buildPreferredResumeCreateConfig,
    savePreferredResumeTemplateId,
} from '../resumeTemplateStorage';
import EditorSidebar from './components/EditorSidebar';
import EditorToolbar from './components/EditorToolbar';
import LayoutAdjustToolbar from './components/LayoutAdjustToolbar';
import MobileEditorHeader from './components/MobileEditorHeader';
import TemplateSelectorModal from './components/TemplateSelectorModal';
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
const MOBILE_EDITOR_DRAWER_ANIMATION_MS = 320;
const formatOptionNumberLabel = (value: number, maxDecimals = 2) => (
    value.toFixed(maxDecimals).replace(/\.?0+$/, '')
);
const LINE_HEIGHT_OPTIONS = LINE_HEIGHT_STEPS.map((value) => ({
    value,
    label: formatOptionNumberLabel(value),
}));
const FONT_SIZE_OPTIONS = FONT_SIZE_STEPS.map((value) => ({
    value,
    label: `${formatOptionNumberLabel(value, 1)} px`,
}));

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

const SECTION_SPACING_KEYS: SectionSpacingKey[] = [8, 6, 5, 4, 3, 2];
const MAX_ITEM_SPACING_EM = Math.max(...Object.values(LIST_SPACING_BY_DENSITY));
const ITEM_SPACING_OPTIONS = Array.from(new Set([
    ...buildItemSpacingSteps(
        MAX_ITEM_SPACING_EM,
        SMART_PAGE_ITEM_SPACING_MIN,
        SMART_PAGE_ITEM_SPACING_STEP
    ),
    ...Object.values(LIST_SPACING_BY_DENSITY),
].map((value) => Number(value.toFixed(3))))).sort((left, right) => right - left);
const SECTION_SPACING_OPTIONS = SECTION_SPACING_KEYS.map((value) => ({
    value,
    label: `${value}`,
}));
const ITEM_SPACING_SELECT_OPTIONS = ITEM_SPACING_OPTIONS.map((value) => ({
    value,
    label: formatOptionNumberLabel(value, 3),
}));

const areLayoutValuesEqual = (current: SmartPageLayout, defaults: SmartPageLayout) => (
    current.topPaddingPx === defaults.topPaddingPx
    && current.sectionSpacingKey === defaults.sectionSpacingKey
    && current.itemSpacingEm === defaults.itemSpacingEm
    && current.lineHeight === defaults.lineHeight
    && current.fontSize === defaults.fontSize
);

const resolveNearestSectionSpacingKey = (value: number): SectionSpacingKey => (
    SECTION_SPACING_KEYS.reduce<SectionSpacingKey>((nearest, candidate) => {
        const candidateDistance = Math.abs(candidate - value);
        const nearestDistance = Math.abs(nearest - value);
        if (candidateDistance < nearestDistance) {
            return candidate;
        }
        return nearest;
    }, SECTION_SPACING_KEYS[0])
);

const resolveDefaultTopPaddingPx = (a4Height?: number) => {
    const pxPerMm = a4Height ? a4Height / A4_HEIGHT_MM : CSS_PX_PER_MM;
    return Number((pxPerMm * PREVIEW_PADDING_MM).toFixed(2));
};
const TOP_PADDING_MAX_PX = resolveDefaultTopPaddingPx();
const TOP_PADDING_MIN_PX = SMART_PAGE_TOP_PADDING_MIN_PX;
const TOP_PADDING_OPTIONS = buildTopPaddingSteps(
    TOP_PADDING_MAX_PX,
    TOP_PADDING_MIN_PX,
    SMART_PAGE_TOP_PADDING_STEP_PX
);
const TOP_PADDING_SELECT_OPTIONS = TOP_PADDING_OPTIONS.map((value) => ({
    value,
    label: `${formatOptionNumberLabel(value)} px`,
}));
const TOP_PADDING_SLIDER_MAX = TOP_PADDING_OPTIONS[0] ?? TOP_PADDING_MAX_PX;

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

type ReorderStateSnapshot = {
    experienceItems: ResumeExperienceView[];
    educations: EducationView[];
    certifications: CertificationView[];
    skillGroups: SkillGroupView[];
    sectionOrder: string[];
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

type PersonalSummarySignatureParams = {
    jdText: string;
    context: {
        profile: {
            name: string;
            email: string;
            phone: string;
            location: string;
            linkedin: string;
        };
        workExperiences: Array<Record<string, unknown>>;
        projectExperiences: Array<Record<string, unknown>>;
        educationExperiences: Array<Record<string, unknown>>;
        certifications: Array<Record<string, unknown>>;
        skills: Array<Record<string, unknown>>;
    };
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
type AutoAssemblyExecutionResult = {
    result: SmartPageExecutionResult;
    finalSelection: ManualSelectionSnapshot | null;
};
type MatchScoreFilterSource = 'manual' | 'auto';
type DashboardResumesSyncResult =
    | { status: 'success' | 'skipped' }
    | { status: 'failed'; error: unknown };
type CreateResumeFlowResult =
    | { status: 'success'; resumeId: string }
    | { status: 'warning'; stage: 'sync'; resumeId: string; error: unknown }
    | { status: 'partial'; stage: 'rename' | 'load'; resumeId: string; error?: unknown }
    | { status: 'failed'; stage: 'create' | 'duplicate'; error: unknown };

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

const buildPersonalSummarySignature = ({
    jdText,
    context,
}: PersonalSummarySignatureParams) => JSON.stringify({
    jdText: jdText.trim(),
    context,
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

const buildAutoAssemblySelectionFilter = (
    result: JDAnalysisResult,
    selection: Pick<ManualSelectionSnapshot, 'experienceIds' | 'certificationIds' | 'skillIds'>
) => {
    const experienceScoreMap = toMatchScoreMap(result.experienceMatches);
    const certificationScoreMap = toMatchScoreMap(result.certificationMatches);
    const skillScoreMap = toMatchScoreMap(result.skillMatches);
    const selectedScores = [
        ...selection.experienceIds.map((id) => experienceScoreMap.get(id)),
        ...selection.certificationIds.map((id) => certificationScoreMap.get(id)),
        ...selection.skillIds.map((id) => skillScoreMap.get(id)),
    ].filter((score): score is number => typeof score === 'number' && score > 0);
    if (selectedScores.length === 0) {
        return DEFAULT_MATCH_SCORE_FILTER;
    }
    const minSelectedScore = Math.min(...selectedScores);
    return Math.max(0, Math.min(100, Math.floor(minSelectedScore / 10) * 10));
};

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

const waitForNextFrame = (callback: () => void) => {
    if (typeof window === 'undefined') {
        callback();
        return () => undefined;
    }
    const frameId = window.requestAnimationFrame(() => callback());
    return () => window.cancelAnimationFrame(frameId);
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
const isDefaultResumeTitle = (value: string) => {
    const normalized = normalizeResumeTitle(value);
    return normalized === UNTITLED_RESUME_TITLE || normalized === DEFAULT_RESUME_TITLE;
};

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
    if (analysisResult.extractedJdText?.trim()) {
        return analysisResult.extractedJdText.trim();
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
    const [isDarkMode, setIsDarkMode] = useState(() =>
        typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
    );
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
    const [isLayoutAdjustToolbarOpen, setIsLayoutAdjustToolbarOpen] = useState(false);
    const [isTemplateSelectorOpen, setIsTemplateSelectorOpen] = useState(false);
    const [isAutoSavePaused, setIsAutoSavePaused] = useState(false);
    const [isCreatingResume, setIsCreatingResume] = useState(false);
    const [resumeName, setResumeName] = useState(UNTITLED_RESUME_TITLE);
    // 1. Profile State
    const [profile, setProfile] = useState<ResumeEditorProfile>(DEFAULT_PROFILE);
    const [personalSummary, setPersonalSummary] = useState('');
    const [hasPersonalSummaryOverride, setHasPersonalSummaryOverride] = useState(false);
    const [profileSyncMode, setProfileSyncMode] = useState<ProfileSyncMode>(PROFILE_SYNC_MODES.global);
    const [profileSocialLinks, setProfileSocialLinks] = useState<Record<string, any>>({});
    const [isEditingProfile, setIsEditingProfile] = useState(false);
    const [isSavingProfile, setIsSavingProfile] = useState(false);
    const [isGeneratingPersonalSummary, setIsGeneratingPersonalSummary] = useState(false);
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
    const [matchScoreFilter, setMatchScoreFilter] = useState(DEFAULT_MATCH_SCORE_FILTER);
    const [matchScoreFilterSource, setMatchScoreFilterSource] = useState<MatchScoreFilterSource>('manual');
    const [isAutoAssembling, setIsAutoAssembling] = useState(false);
    const [bossGreeting, setBossGreeting] = useState('');
    const [bossGreetingSignature, setBossGreetingSignature] = useState('');
    const [isBossGreetingVisible, setIsBossGreetingVisible] = useState(false);
    const [isGeneratingBossGreeting, setIsGeneratingBossGreeting] = useState(false);
    const [persistedJDAnalysisSnapshot, setPersistedJDAnalysisSnapshot] =
        useState<ResumeJDAnalysis | null | undefined>(undefined);
    // 3. UI State
    const [sidebarTab, setSidebarTab] = useState<'profile' | 'experience'>('experience');
    const [isMobileEditorDrawerOpen, setIsMobileEditorDrawerOpen] = useState(false);
    const [isMobileEditorDrawerVisible, setIsMobileEditorDrawerVisible] = useState(false);
    const mobileEditorDrawerTimerRef = useRef<number | null>(null);
    const mobileEditorScrollContainerRef = useRef<HTMLDivElement | null>(null);
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
    const personalSummaryRequestIdRef = useRef(0);
    const personalSummaryDraftVersionRef = useRef(0);
    const latestPersonalSummarySignatureRef = useRef('');
    const activeAutoAssembleToastIdRef = useRef<string | null>(null);
    const activeBossGreetingToastIdRef = useRef<string | null>(null);
    const activePersonalSummaryToastIdRef = useRef<string | null>(null);
    const previousMatchScoreFilterResumeIdRef = useRef<string | null>(null);
    const bossGreetingUiStateRef = useRef({
        text: '',
        isVisible: false,
    });
    const currentLayout = useMemo<SmartPageLayout>(() => ({
        topPaddingPx,
        sectionSpacingKey,
        itemSpacingEm,
        lineHeight,
        fontSize,
    }), [fontSize, itemSpacingEm, lineHeight, sectionSpacingKey, topPaddingPx]);
    const defaultLayout = useMemo(
        () => buildDefaultSmartPageLayout(density),
        [density]
    );
    const isLayoutModified = useMemo(
        () => !areLayoutValuesEqual(currentLayout, defaultLayout),
        [currentLayout, defaultLayout]
    );
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
    const reorderStateSnapshotRef = useRef<ReorderStateSnapshot | null>(null);
    const previewRef = useRef<HTMLDivElement | null>(null);
    const previewContentRef = useRef<HTMLDivElement | null>(null);
    const measurePreviewRef = useRef<HTMLDivElement | null>(null);
    const measurePreviewContentRef = useRef<HTMLDivElement | null>(null);
    const a4HeightRef = useRef<number | null>(null);
    const smartPageAdjustingRef = useRef(false);
    const isUpdatingResumeNameRef = useRef(false);
    const [isExportingPdf, setIsExportingPdf] = useState(false);
    const [resumeTemplateId, setResumeTemplateId] = useState<ResumeTemplateId>(DEFAULT_RESUME_TEMPLATE_ID);
    const [themeColorPresetId, setThemeColorPresetId] = useState<ResumeThemeColorPresetId>(
        resolveDefaultResumeThemeColorPresetId(DEFAULT_RESUME_TEMPLATE_ID)
    );

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
                personalSummary,
                hasPersonalSummaryOverride,
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
                layoutOrders,
                resumeTemplateId,
                themeColorPresetId,
                persistedJDAnalysisSnapshot
            ),
        [
            density,
            fontSize,
            isSmartPageApplied,
            isSummaryVisible,
            lineHeight,
            itemSpacingEm,
            layoutOrders,
            persistedJDAnalysisSnapshot,
            hasPersonalSummaryOverride,
            personalSummary,
            profile,
            profileSyncMode,
            resumeTemplateId,
            themeColorPresetId,
            sectionOrder,
            sectionSpacingKey,
            selectedCertIds,
            selectedEduIds,
            selectedExpIds,
            topPaddingPx,
            selectedSkillIds,
        ]
    );
    const applyLayoutConfig = useCallback((config: ResumeEditorConfig) => {
        const nextLayout = resolveLayoutSnapshotFromConfig(config.layout);
        setTopPaddingPx(nextLayout.topPaddingPx);
        setSectionSpacingKey(nextLayout.sectionSpacingKey);
        setItemSpacingEm(nextLayout.itemSpacingEm);
        setLineHeight(nextLayout.lineHeight);
        setFontSize(nextLayout.fontSize);
        setIsSmartPageApplied(nextLayout.isSmartPageApplied);
        const rawTemplateId = config.layout?.templateId;
        const nextTemplateId = normalizeResumeTemplateId(rawTemplateId);
        setResumeTemplateId(nextTemplateId);
        setThemeColorPresetId(
            config.layout?.themeColorPresetId
            ?? resolveDefaultResumeThemeColorPresetId(rawTemplateId ?? nextTemplateId)
        );
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
        persistedJDAnalysisSnapshot,
        autoSaveDelayMs: AUTO_SAVE_DELAY_MS,
        isAutoSavePaused,
        setProfile,
        setPersonalSummary,
        setHasPersonalSummaryOverride,
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
    useEffect(() => {
        setIsLayoutAdjustToolbarOpen(false);
    }, [resumeId]);
    const hydratingPersistedJDAnalysisSnapshot = useMemo(() => {
        const backendPersistedJDAnalysis = normalizeJDAnalysisPersistence(
            resumeDetail?.resume?.config?.jdAnalysis
        );
        return selectPreferredPersistedJDAnalysis(
            backendPersistedJDAnalysis,
            resumeId ? loadJDAnalysisCache(resumeId) : null
        )?.payload ?? null;
    }, [resumeDetail?.resume?.config?.jdAnalysis, resumeId]);
    const committedPersistedJDAnalysisSnapshot =
        persistedJDAnalysisSnapshot !== undefined
            ? persistedJDAnalysisSnapshot
            : hydratingPersistedJDAnalysisSnapshot;
    const buildCommittedResumeConfigSnapshot = useCallback(() => {
        // 创建新简历前只持久化已确认的 profile 状态，避免把编辑中的草稿静默写回旧简历。
        const nextProfile = isEditingProfile ? originalProfile : profile;
        const nextProfileSyncMode = isEditingProfile ? originalProfileSyncMode : profileSyncMode;
        return buildResumeConfigSnapshot(
            nextProfile,
            personalSummary,
            hasPersonalSummaryOverride,
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
            layoutOrders,
            resumeTemplateId,
            themeColorPresetId,
            committedPersistedJDAnalysisSnapshot
        );
    }, [
        committedPersistedJDAnalysisSnapshot,
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
        hasPersonalSummaryOverride,
        personalSummary,
        profile,
        profileSyncMode,
        resumeTemplateId,
        themeColorPresetId,
        sectionOrder,
        sectionSpacingKey,
        selectedCertIds,
        selectedEduIds,
        selectedExpIds,
        selectedSkillIds,
        topPaddingPx,
    ]);
    // 将 resumeId 同步到 ref，供不可在 render 阶段读取的异步回调使用。
    useEffect(() => {
        latestResumeIdRef.current = resumeId;
    }, [resumeId]);
    useEffect(() => {
        setPersistedJDAnalysisSnapshot(undefined);
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
        persistedJDAnalysis: resumeDetail?.resume?.config?.jdAnalysis,
        onPersistedJDAnalysisChange: setPersistedJDAnalysisSnapshot,
        isLoadingResume,
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
    const refreshDashboardResumesFromServer = useCallback(async (): Promise<DashboardResumesSyncResult> => {
        if (!onResumesUpdate || !isCacheOwnerMatched) {
            return { status: 'skipped' };
        }
        try {
            const resumes = await resumeService.list({ force: true });
            onResumesUpdate(mapResumesToDashboard(resumes));
            return { status: 'success' };
        } catch (error) {
            console.error('[ResumeEditor] 刷新简历列表失败:', error);
            return { status: 'failed', error };
        }
    }, [isCacheOwnerMatched, onResumesUpdate]);
    useEffect(() => {
        if (!resumeDetail?.resume) {
            return;
        }
        const nextTitle = normalizeResumeTitle(resumeDetail.resume.title || UNTITLED_RESUME_TITLE);
        setResumeName(nextTitle || UNTITLED_RESUME_TITLE);
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
                setResumeName(updatedTitle || UNTITLED_RESUME_TITLE);
                if (resumeDetail) {
                    applyResumeDetail({
                        ...resumeDetail,
                        resume: {
                            ...resumeDetail.resume,
                            ...updated,
                            title: updatedTitle || UNTITLED_RESUME_TITLE,
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
                            type: 'ai_thinking',
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
    useEffect(() => {
        if (typeof document === 'undefined') {
            return;
        }
        const root = document.documentElement;
        const syncThemeState = () => {
            setIsDarkMode(root.classList.contains('dark'));
        };
        syncThemeState();
        const observer = new MutationObserver(syncThemeState);
        observer.observe(root, { attributes: true, attributeFilter: ['class'] });
        return () => observer.disconnect();
    }, []);
    const isProfileReadOnly = !isEditingProfile || isSavingProfile;
    const toggleTheme = () => {
        const nextIsDark = !document.documentElement.classList.contains('dark');
        document.documentElement.classList.toggle('dark', nextIsDark);
        setIsDarkMode(nextIsDark);
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
    const applyManualLayoutChange = useCallback((
        updater: (layout: SmartPageLayout) => SmartPageLayout
    ) => {
        const nextLayout = updater(currentLayout);
        commitLayoutSnapshot(buildLayoutSnapshot(nextLayout, false), { incrementVersion: true });
        applyVisibleLayout(nextLayout);
        setIsSmartPageApplied(false);
    }, [applyVisibleLayout, commitLayoutSnapshot, currentLayout]);
    const handleToggleLayoutAdjustToolbar = useCallback(() => {
        setIsLayoutAdjustToolbarOpen((prev) => {
            if (!prev) {
                showToastInfo('进入手动调节模式');
            }
            return !prev;
        });
    }, [showToastInfo]);
    const handleLineHeightChange = useCallback((value: number) => {
        applyManualLayoutChange((layout) => ({
            ...layout,
            lineHeight: Number(value.toFixed(2)),
        }));
    }, [applyManualLayoutChange]);
    const handleFontSizeChange = useCallback((value: number) => {
        applyManualLayoutChange((layout) => ({
            ...layout,
            fontSize: Number(value.toFixed(1)),
        }));
    }, [applyManualLayoutChange]);
    const handleTopPaddingChange = useCallback((value: number) => {
        applyManualLayoutChange((layout) => ({
            ...layout,
            topPaddingPx: Number(value.toFixed(2)),
        }));
    }, [applyManualLayoutChange]);
    const handleSectionSpacingChange = useCallback((value: number) => {
        applyManualLayoutChange((layout) => ({
            ...layout,
            sectionSpacingKey: resolveNearestSectionSpacingKey(value),
        }));
    }, [applyManualLayoutChange]);
    const handleItemSpacingChange = useCallback((value: number) => {
        applyManualLayoutChange((layout) => ({
            ...layout,
            itemSpacingEm: Number(value.toFixed(2)),
        }));
    }, [applyManualLayoutChange]);
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
    const runCreateResumeFlow = useCallback(async (): Promise<CreateResumeFlowResult> => {
        let nextResume: ResumeRecord;
        let duplicateStartedAt: number | null = null;
        if (!resumeId) {
            try {
                nextResume = await resumeService.create({
                    title: UNTITLED_RESUME_TITLE,
                    config: buildPreferredResumeCreateConfig(),
                });
            } catch (error) {
                console.error('[ResumeEditor] 创建空白简历失败:', error);
                return {
                    status: 'failed',
                    stage: 'create',
                    error,
                };
            }
        } else {
            duplicateStartedAt = Date.now();
            await flushResumeConfig(buildCommittedResumeConfigSnapshot());

            let duplicated: ResumeRecord;
            try {
                duplicated = await resumeService.duplicate(resumeId);
            } catch (error) {
                console.error('[ResumeEditor] 创建副本失败:', error);
                trackResumeDuplicated({
                    source: 'editor',
                    action: 'error',
                    sourceResumeId: resumeId,
                    durationMs: Date.now() - duplicateStartedAt,
                });
                return {
                    status: 'failed',
                    stage: 'duplicate',
                    error,
                };
            }

            nextResume = duplicated;
            try {
                nextResume = await resumeService.update(duplicated.id, { title: UNTITLED_RESUME_TITLE });
            } catch (error) {
                console.error('[ResumeEditor] 新副本重命名失败:', error);
                await refreshDashboardResumesFromServer();
                trackResumeDuplicated({
                    source: 'editor',
                    action: 'partial',
                    sourceResumeId: resumeId,
                    duplicatedResumeId: duplicated.id,
                    durationMs: Date.now() - duplicateStartedAt,
                });
                return {
                    status: 'partial',
                    stage: 'rename',
                    resumeId: duplicated.id,
                    error,
                };
            }
        }

        const reloadResult = await reloadResumeContext(nextResume.id);
        if (reloadResult.status !== 'success') {
            await refreshDashboardResumesFromServer();
            if (resumeId && duplicateStartedAt !== null) {
                trackResumeDuplicated({
                    source: 'editor',
                    action: 'partial',
                    sourceResumeId: resumeId,
                    duplicatedResumeId: nextResume.id,
                    durationMs: Date.now() - duplicateStartedAt,
                });
            }
            return {
                status: 'partial',
                stage: 'load',
                resumeId: nextResume.id,
                error: reloadResult.error,
            };
        }

        setResumeName(UNTITLED_RESUME_TITLE);
        resetEditorTransientState(
            reloadResult.context.profile,
            reloadResult.context.profileSyncMode
        );

        const syncResult = await refreshDashboardResumesFromServer();
        if (syncResult.status === 'failed') {
            if (resumeId && duplicateStartedAt !== null) {
                trackResumeDuplicated({
                    source: 'editor',
                    action: 'warning',
                    sourceResumeId: resumeId,
                    duplicatedResumeId: nextResume.id,
                    durationMs: Date.now() - duplicateStartedAt,
                });
            }
            return {
                status: 'warning',
                stage: 'sync',
                resumeId: nextResume.id,
                error: syncResult.error,
            };
        }

        if (resumeId && duplicateStartedAt !== null) {
            trackResumeDuplicated({
                source: 'editor',
                action: 'success',
                sourceResumeId: resumeId,
                duplicatedResumeId: nextResume.id,
                durationMs: Date.now() - duplicateStartedAt,
            });
        }

        return {
            status: 'success',
            resumeId: nextResume.id,
        };
    }, [
        buildCommittedResumeConfigSnapshot,
        flushResumeConfig,
        refreshDashboardResumesFromServer,
        reloadResumeContext,
        resetEditorTransientState,
        resumeId,
    ]);
    const handleCreateResume = useCallback(async () => {
        if (isCreatingResume) {
            return;
        }
        if (isLoadingResume) {
            showToastError('当前简历尚未加载完成，请稍后再试');
            return;
        }
        const toastId = showToastLoading('正在创建并切换简历...');
        setIsCreatingResume(true);
        suppressAutoSaveForConfig(buildCommittedResumeConfigSnapshot());

        try {
            const result = await runCreateResumeFlow();
            if (result.status === 'success') {
                updateToast(toastId, {
                    message: '新简历已创建并切换',
                    type: 'success',
                    duration: 3000,
                });
                return;
            }
            if (result.status === 'warning') {
                updateToast(toastId, {
                    message: '新简历已创建并切换',
                    type: 'success',
                    duration: 3000,
                });
                showToastInfo('简历列表同步失败，请稍后刷新仪表盘');
                return;
            }
            if (result.status === 'partial') {
                updateToast(toastId, {
                    message: '副本已创建，但未完成切换，请从仪表盘打开',
                    type: 'error',
                    duration: 4000,
                });
                return;
            }
            updateToast(toastId, {
                message: '创建新简历失败，请稍后重试',
                type: 'error',
                duration: 4000,
            });
        } catch (error) {
            console.error('[ResumeEditor] 创建简历流程异常:', error);
            updateToast(toastId, {
                message: '创建新简历失败，请稍后重试',
                type: 'error',
                duration: 4000,
            });
        } finally {
            clearSuppressedAutoSave();
            setIsCreatingResume(false);
        }
    }, [
        clearSuppressedAutoSave,
        isCreatingResume,
        isLoadingResume,
        resumeId,
        showToastError,
        showToastInfo,
        showToastLoading,
        suppressAutoSaveForConfig,
        buildCommittedResumeConfigSnapshot,
        runCreateResumeFlow,
        updateToast,
    ]);
    const openMobileEditorDrawer = useCallback(() => {
        if (mobileEditorDrawerTimerRef.current !== null) {
            window.clearTimeout(mobileEditorDrawerTimerRef.current);
            mobileEditorDrawerTimerRef.current = null;
        }
        setIsMobileEditorDrawerOpen(true);
        waitForNextFrame(() => {
            setIsMobileEditorDrawerVisible(true);
        });
    }, []);
    const dismissMobileEditorDrawerImmediately = useCallback(() => {
        if (mobileEditorDrawerTimerRef.current !== null) {
            window.clearTimeout(mobileEditorDrawerTimerRef.current);
            mobileEditorDrawerTimerRef.current = null;
        }
        setIsMobileEditorDrawerVisible(false);
        setIsMobileEditorDrawerOpen(false);
    }, []);
    const closeMobileEditorDrawer = useCallback(() => {
        setIsMobileEditorDrawerVisible(false);
        if (mobileEditorDrawerTimerRef.current !== null) {
            window.clearTimeout(mobileEditorDrawerTimerRef.current);
        }
        mobileEditorDrawerTimerRef.current = window.setTimeout(() => {
            setIsMobileEditorDrawerOpen(false);
            mobileEditorDrawerTimerRef.current = null;
        }, MOBILE_EDITOR_DRAWER_ANIMATION_MS);
    }, []);
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
    const captureReorderStateSnapshot = () => {
        reorderStateSnapshotRef.current = {
            experienceItems: [...experienceItems],
            educations: [...educations],
            certifications: [...certifications],
            skillGroups: [...skillGroups],
            sectionOrder: [...sectionOrder],
        };
    };
    const startItemReorder = (itemKey: string) => {
        captureReorderStateSnapshot();
        lastItemHoverKeyRef.current = null;
        lastSectionHoverKeyRef.current = null;
        setDraggedSectionId(null);
        setDraggedItemKey(itemKey);
        reorderContextRef.current = buildItemReorderContext(itemKey);
        setIsDragging(true);
    };

    const handleDragStart = (e: React.DragEvent, itemKey: string) => {
        startItemReorder(itemKey);
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
        reorderStateSnapshotRef.current = null;
    };
    const finishDragInteraction = () => {
        finalizeReorderTracking();
        clearDragState();
    };
    const cancelTouchDragInteraction = () => {
        const snapshot = reorderStateSnapshotRef.current;
        if (snapshot) {
            setExperienceItems(snapshot.experienceItems);
            setEducations(snapshot.educations);
            setCertifications(snapshot.certifications);
            setSkillGroups(snapshot.skillGroups);
            setSectionOrder(snapshot.sectionOrder);
        }
        clearDragState();
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
        finishDragInteraction();
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
    const startSectionReorder = (sectionId: string) => {
        captureReorderStateSnapshot();
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
    };

    const handleSectionDragStart = (e: React.DragEvent, sectionId: string) => {
        startSectionReorder(sectionId);
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
        finishDragInteraction();
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
    const selectedEducations = useMemo(
        () => educations.filter((item) => selectedEduIds.has(item.id)),
        [educations, selectedEduIds]
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
    const editablePersonalSummary = useMemo(() => {
        if (hasPersonalSummaryOverride) {
            return personalSummary;
        }
        return profile.summary;
    }, [hasPersonalSummaryOverride, personalSummary, profile.summary]);
    const effectivePersonalSummary = useMemo(() => {
        if (!isSummaryVisible) {
            return '';
        }
        if (hasPersonalSummaryOverride) {
            return personalSummary.trim();
        }
        return profile.summary.trim();
    }, [hasPersonalSummaryOverride, isSummaryVisible, personalSummary, profile.summary]);
    const handlePersonalSummaryChange = useCallback((value: string) => {
        personalSummaryDraftVersionRef.current += 1;
        if (!isSummaryVisible && !editablePersonalSummary.trim() && value.trim()) {
            setIsSummaryVisible(true);
        }
        setPersonalSummary(value);
        setHasPersonalSummaryOverride(true);
    }, [editablePersonalSummary, isSummaryVisible]);
    const previewProfile = useMemo(
        () => ({
            ...profile,
            summary: effectivePersonalSummary,
        }),
        [effectivePersonalSummary, profile]
    );
    const personalSummaryContext = useMemo(
        () => ({
            profile: {
                name: profile.name,
                email: profile.email,
                phone: profile.phone,
                location: profile.location,
                linkedin: profile.linkedin,
            },
            workExperiences: selectedWorkItems.map((item) => ({
                id: item.id,
                title: item.title,
                org: item.company,
                start_date: item.startDate,
                end_date: item.endDate,
                is_current: item.isCurrent ?? false,
                star: item.star,
            })),
            projectExperiences: selectedProjectItems.map((item) => ({
                id: item.id,
                title: item.title,
                org: item.company,
                start_date: item.startDate,
                end_date: item.endDate,
                is_current: item.isCurrent ?? false,
                star: item.star,
            })),
            educationExperiences: selectedEducations.map((item) => ({
                id: item.id,
                school: item.school,
                major: item.major,
                degree: item.degree,
                start_date: item.startDate,
                end_date: item.endDate,
                is_current: item.isCurrent ?? false,
                gpa: item.gpa || '',
                courses: item.courses || '',
            })),
            certifications: selectedCertifications.map((item) => ({
                id: item.id,
                name: item.name,
                issuer: item.issuer || '',
                issue_date: item.date,
            })),
            skills: selectedSkillGroups.flatMap((group) =>
                group.skills.map((skill) => ({
                    id: skill.id,
                    name: skill.name,
                    category: group.name,
                }))
            ),
        }),
        [
            profile.email,
            profile.linkedin,
            profile.location,
            profile.name,
            profile.phone,
            selectedCertifications,
            selectedEducations,
            selectedProjectItems,
            selectedSkillGroups,
            selectedWorkItems,
        ]
    );
    const personalSummaryCurrentSignature = useMemo(
        () => buildPersonalSummarySignature({
            jdText: jdPolishContext,
            context: personalSummaryContext,
        }),
        [jdPolishContext, personalSummaryContext]
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
    latestPersonalSummarySignatureRef.current = personalSummaryCurrentSignature;
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
    ): Promise<AutoAssemblyExecutionResult> => {
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
            return {
                result: initialResult,
                finalSelection: initialResult.status === 'skipped' ? null : { ...currentSelection },
            };
        }
        lastOverflowResult = initialResult;
        const skillResult = await removeNext(selection.skillRemovalQueue, 'skillIds');
        if (skillResult) {
            return {
                result: skillResult,
                finalSelection: skillResult.status === 'skipped' ? null : { ...currentSelection },
            };
        }
        const certificationResult = await removeNext(
            selection.certificationRemovalQueue,
            'certificationIds'
        );
        if (certificationResult) {
            return {
                result: certificationResult,
                finalSelection: certificationResult.status === 'skipped' ? null : { ...currentSelection },
            };
        }
        const experienceResult = await removeNext(selection.experienceRemovalQueue, 'experienceIds');
        if (experienceResult) {
            return {
                result: experienceResult,
                finalSelection: experienceResult.status === 'skipped' ? null : { ...currentSelection },
            };
        }
        return {
            result: lastOverflowResult ?? {
                status: 'overflow',
                topPaddingPx,
                sectionSpacingKey,
                itemSpacingEm,
                lineHeight,
                fontSize,
            },
            finalSelection: { ...currentSelection },
        };
    }, [applyAssemblySelection, applyLayoutSnapshot, waitForSmartPageIdle]);

    const handleAutoAssemble = useCallback(async () => {
        if (isAutoAssembling) {
            return;
        }
        if (!analysisResult && !hasMissingAttachmentContext && !jdFile && !jdText.trim()) {
            trackSmartAssemblyResult({
                resumeId,
                action: 'empty_jd',
            });
            showToastError(AUTO_ASSEMBLY_TOAST_MESSAGES.emptyJd);
            return;
        }
        const startedAt = Date.now();
        trackSmartAssemblyStart({ resumeId });
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
                trackSmartAssemblyResult({
                    resumeId,
                    action: 'analysis_unavailable',
                    durationMs: Date.now() - startedAt,
                });
                closeToast(toastId);
                releaseActiveAutoAssembleToast();
                return;
            }
            const selection = buildAutoAssemblySelection(effectiveResult);
            const selectionMetrics = {
                experienceCount: selection.experienceIds.length,
                certificationCount: selection.certificationIds.length,
                skillCount: selection.skillIds.length,
                totalSelected:
                    selection.experienceIds.length
                    + selection.certificationIds.length
                    + selection.skillIds.length,
            };
            if (!selection.hasMatchedExperience) {
                trackSmartAssemblyResult({
                    resumeId,
                    action: 'no_match',
                    durationMs: Date.now() - startedAt,
                    ...selectionMetrics,
                });
                updateToast(toastId, {
                    message: AUTO_ASSEMBLY_TOAST_MESSAGES.noExperienceMatch,
                    type: 'error',
                    duration: JD_ANALYSIS_TOAST_ERROR_DURATION_MS,
                });
                releaseActiveAutoAssembleToast();
                return;
            }
            const autoAssemblyExecution = await runAutoAssemblySelection(
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
            const { result: smartPageResult, finalSelection } = autoAssemblyExecution;
            if (!isResumeRequestCurrent() || !isAutoAssembleRequestCurrent()) {
                closeToast(toastId);
                releaseActiveAutoAssembleToast();
                return;
            }
            if (smartPageResult.status !== 'skipped' && finalSelection) {
                setMatchScoreFilter(
                    buildAutoAssemblySelectionFilter(effectiveResult, finalSelection)
                );
                setMatchScoreFilterSource('auto');
            }
            trackSmartAssemblyResult({
                resumeId,
                action: smartPageResult.status === 'fit'
                    ? 'success'
                    : smartPageResult.status === 'skipped'
                        ? 'skipped'
                        : 'partial_overflow',
                durationMs: Date.now() - startedAt,
                ...selectionMetrics,
            });
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
            trackSmartAssemblyResult({
                resumeId,
                action: 'error',
                durationMs: Date.now() - startedAt,
            });
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
        const bossGreetingSource = forceRefresh ? 'refresh' : 'generate' as const;
        const canReuseBossGreeting = !forceRefresh && Boolean(
            bossGreeting
            && !isBossGreetingOutdated
            && !isOutdated
        );
        if (isGeneratingBossGreeting) {
            return;
        }
        if (canReuseBossGreeting) {
            const nextIsVisible = !isBossGreetingVisible;
            setIsBossGreetingVisible(nextIsVisible);
            trackBossGreetingResult({
                resumeId,
                source: 'toggle',
                action: nextIsVisible ? 'shown' : 'hidden',
            });
            return;
        }
        if (!analysisResult && !hasMissingAttachmentContext && !jdFile && !jdText.trim()) {
            trackBossGreetingResult({
                resumeId,
                source: bossGreetingSource,
                action: 'empty',
            });
            showToastError(BOSS_GREETING_TOAST_MESSAGES.empty);
            return;
        }
        const startedAt = Date.now();
        trackBossGreetingStart({
            resumeId,
            source: bossGreetingSource,
        });
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
                trackBossGreetingResult({
                    resumeId,
                    source: bossGreetingSource,
                    action: 'analysis_unavailable',
                    durationMs: Date.now() - startedAt,
                });
                closeToast(toastId);
                releaseActiveBossGreetingToast();
                return;
            }
            if (!effectiveResult.summary?.trim()) {
                trackBossGreetingResult({
                    resumeId,
                    source: bossGreetingSource,
                    action: 'empty',
                    durationMs: Date.now() - startedAt,
                });
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
            const response = await aiService.generateBossGreetingStream(
                {
                    jdText: jdPolishContext,
                    analysisSummary: effectiveResult.summary,
                    jobTitle: effectiveResult.jobTitle,
                    company: effectiveResult.company,
                    resumeText: selectedResumeSnapshotText,
                },
                (event: BossGreetingStreamEvent) => {
                    if (event.type !== 'thought') {
                        return;
                    }
                    if (!isResumeRequestCurrent() || !isBossGreetingRequestCurrent()) {
                        return;
                    }
                    const title = extractThoughtHeadline(event.summary);
                    if (!title) {
                        return;
                    }
                    updateToast(toastId, {
                        message: title,
                        type: 'ai_thinking',
                        duration: 0,
                    });
                }
            );
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
            trackBossGreetingResult({
                resumeId,
                source: bossGreetingSource,
                action: 'success',
                durationMs: Date.now() - startedAt,
            });
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
            trackBossGreetingResult({
                resumeId,
                source: bossGreetingSource,
                action: 'error',
                durationMs: Date.now() - startedAt,
            });
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
        isBossGreetingVisible,
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
        trackBossGreetingResult({
            resumeId,
            source: 'toggle',
            action: 'hidden',
        });
        setIsBossGreetingVisible(false);
    }, [resumeId]);

    const handleCopyBossGreeting = useCallback(async () => {
        if (!bossGreeting.trim()) {
            return;
        }
        try {
            if (!navigator.clipboard) {
                throw new Error('clipboard_unavailable');
            }
            await navigator.clipboard.writeText(bossGreeting);
            trackBossGreetingResult({
                resumeId,
                source: 'copy',
                action: 'success',
            });
            showToastSuccess(BOSS_GREETING_TOAST_MESSAGES.copySuccess);
        } catch (error) {
            console.error('[ResumeEditor] 复制 BOSS 招呼语失败:', error);
            trackBossGreetingResult({
                resumeId,
                source: 'copy',
                action: 'error',
            });
            showToastError(BOSS_GREETING_TOAST_MESSAGES.copyError);
        }
    }, [bossGreeting, resumeId, showToastError, showToastSuccess]);

    const handleGeneratePersonalSummary = useCallback(async () => {
        if (isGeneratingPersonalSummary) {
            return;
        }
        if (!jdPolishContext.trim()) {
            showToastError('请先填写 JD 内容或完成 JD 分析后再生成个人评价。');
            return;
        }
        if (editablePersonalSummary.trim() && typeof window !== 'undefined') {
            const shouldOverwrite = window.confirm('当前已有个人评价内容，是否用 AI 生成结果覆盖？');
            if (!shouldOverwrite) {
                return;
            }
        }

        const toastId = showToastLoading('正在生成个人评价...');
        activePersonalSummaryToastIdRef.current = toastId;
        const requestedResumeId = resumeId;
        const isResumeRequestCurrent = () => latestResumeIdRef.current === requestedResumeId;
        const requestId = personalSummaryRequestIdRef.current + 1;
        personalSummaryRequestIdRef.current = requestId;
        const draftVersionAtStart = personalSummaryDraftVersionRef.current;
        const requestedPersonalSummarySignature = personalSummaryCurrentSignature;
        const isPersonalSummaryRequestCurrent = () => personalSummaryRequestIdRef.current === requestId;
        const releaseActivePersonalSummaryToast = () => {
            if (activePersonalSummaryToastIdRef.current === toastId) {
                activePersonalSummaryToastIdRef.current = null;
            }
        };
        setIsGeneratingPersonalSummary(true);
        try {
            const response = await aiService.generatePersonalSummaryStream(
                {
                    mode: 'resume',
                    profile: personalSummaryContext.profile,
                    workExperiences: personalSummaryContext.workExperiences,
                    projectExperiences: personalSummaryContext.projectExperiences,
                    educationExperiences: personalSummaryContext.educationExperiences,
                    certifications: personalSummaryContext.certifications,
                    skills: personalSummaryContext.skills,
                    jdText: jdPolishContext,
                },
                (event: PersonalSummaryStreamEvent) => {
                    if (event.type !== 'thought') {
                        return;
                    }
                    if (
                        !isResumeRequestCurrent()
                        || !isPersonalSummaryRequestCurrent()
                        || latestPersonalSummarySignatureRef.current !== requestedPersonalSummarySignature
                    ) {
                        return;
                    }
                    const title = extractThoughtHeadline(event.summary);
                    if (!title) {
                        return;
                    }
                    updateToast(toastId, {
                        message: title,
                        type: 'ai_thinking',
                        duration: 0,
                    });
                }
            );
            if (
                !isResumeRequestCurrent()
                || !isPersonalSummaryRequestCurrent()
                || personalSummaryDraftVersionRef.current !== draftVersionAtStart
                || latestPersonalSummarySignatureRef.current !== requestedPersonalSummarySignature
            ) {
                closeToast(toastId);
                releaseActivePersonalSummaryToast();
                return;
            }
            if (!isSummaryVisible && !editablePersonalSummary.trim() && response.summary.trim()) {
                setIsSummaryVisible(true);
            }
            setPersonalSummary(response.summary);
            setHasPersonalSummaryOverride(true);
            updateToast(toastId, {
                message: '个人评价已生成',
                type: 'success',
                duration: 2500,
            });
            releaseActivePersonalSummaryToast();
        } catch (error) {
            if (!isResumeRequestCurrent() || !isPersonalSummaryRequestCurrent()) {
                closeToast(toastId);
                releaseActivePersonalSummaryToast();
                return;
            }
            console.error('[ResumeEditor] 生成个人评价失败:', error);
            updateToast(toastId, {
                message: error instanceof Error ? error.message : '个人评价生成失败，请稍后重试',
                type: 'error',
                duration: 3500,
            });
            releaseActivePersonalSummaryToast();
        } finally {
            if (isPersonalSummaryRequestCurrent()) {
                setIsGeneratingPersonalSummary(false);
            }
        }
    }, [
        closeToast,
        editablePersonalSummary,
        isGeneratingPersonalSummary,
        isSummaryVisible,
        jdPolishContext,
        personalSummaryContext,
        personalSummaryCurrentSignature,
        resumeId,
        showToastError,
        showToastLoading,
        updateToast,
    ]);

    useEffect(() => {
        autoAssembleRequestIdRef.current += 1;
        bossGreetingRequestIdRef.current += 1;
        personalSummaryRequestIdRef.current += 1;
        if (activeAutoAssembleToastIdRef.current) {
            closeToast(activeAutoAssembleToastIdRef.current);
            activeAutoAssembleToastIdRef.current = null;
        }
        if (activeBossGreetingToastIdRef.current) {
            closeToast(activeBossGreetingToastIdRef.current);
            activeBossGreetingToastIdRef.current = null;
        }
        if (activePersonalSummaryToastIdRef.current) {
            closeToast(activePersonalSummaryToastIdRef.current);
            activePersonalSummaryToastIdRef.current = null;
        }
        setIsAutoAssembling(false);
        setIsGeneratingBossGreeting(false);
        setIsGeneratingPersonalSummary(false);
        setBossGreeting('');
        setBossGreetingSignature('');
        setIsBossGreetingVisible(false);
    }, [closeToast, resumeId]);

    const handleExportPdf = useCallback(async () => {
        if (isExportingPdf) {
            return;
        }

        const snapshot = buildResumePdfRenderSnapshot({
            resumeName,
            profile: previewProfile,
            lineHeight,
            fontSize,
            listSpacingValue,
            bulletSpacingValue,
            topPaddingPx,
            sectionSpacingClass,
            listSpacingClass,
            sectionOrder,
            selectedWorkItems,
            selectedProjectItems,
            educations,
            selectedEduIds,
            sortedCertifications,
            selectedCertIds,
            selectedSkillGroups,
            templateId: resumeTemplateId,
            themeColorPresetId,
        });
        const exportTitle = buildResumeExportTitle(resumeName);
        const toastId = showToastLoading('正在生成 PDF...');

        setIsExportingPdf(true);
        try {
            const { downloadUrl, fileName } = await exportService.createResumePdfDownloadLink(
                snapshot,
                exportTitle
            );
            await downloadUrlFile(downloadUrl, fileName);
            updateToast(toastId, {
                message: 'PDF 已生成，开始下载。',
                type: 'success',
                duration: 3000,
            });
            trackResumeExported(authUserKey);
        } catch (error) {
            console.error('[ResumeEditor] PDF 导出失败:', error);
            const message = error instanceof Error
                ? error.message
                : 'PDF 导出失败，请稍后重试。';
            updateToast(toastId, {
                message,
                type: 'error',
                duration: 4000,
            });
        } finally {
            setIsExportingPdf(false);
        }
    }, [
        authUserKey,
        bulletSpacingValue,
        educations,
        fontSize,
        isExportingPdf,
        lineHeight,
        listSpacingClass,
        listSpacingValue,
        previewProfile,
        resumeName,
        sectionOrder,
        sectionSpacingClass,
        selectedCertIds,
        selectedEduIds,
        selectedProjectItems,
        selectedSkillGroups,
        selectedWorkItems,
        showToastLoading,
        sortedCertifications,
        topPaddingPx,
        updateToast,
    ]);
    const handleEditExperience = (id: string) => {
        setSidebarTab('experience');
        if (typeof window !== 'undefined' && window.innerWidth < 768) {
            openMobileEditorDrawer();
        }
        experience.startEditingExperience(id);
    };
    const handleEditCertification = (id: string) => {
        experience.cancelEditingExperience();
        setSidebarTab('experience');
        if (typeof window !== 'undefined' && window.innerWidth < 768) {
            openMobileEditorDrawer();
        }
        certification.beginEditCertification(id);
    };
    const handleEditSkill = (id: string) => {
        experience.cancelEditingExperience();
        setSidebarTab('experience');
        if (typeof window !== 'undefined' && window.innerWidth < 768) {
            openMobileEditorDrawer();
        }
        skill.beginEditSkill(id);
    };
    const handleToggleJdCollapse = () => {
        setIsJDCollapsed((prev) => !prev);
    };
    const resetAutoDerivedMatchScoreFilter = useCallback(() => {
        setMatchScoreFilter(DEFAULT_MATCH_SCORE_FILTER);
        setMatchScoreFilterSource('manual');
    }, []);
    const handleMatchScoreFilterChange = useCallback((value: number) => {
        setMatchScoreFilter(value);
        setMatchScoreFilterSource('manual');
    }, []);
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
                void applyResumeNameUpdate(UNTITLED_RESUME_TITLE, { silent: true });
            }
        },
        [analysisResult, applyResumeNameUpdate, jdText, resumeName, setJdText]
    );
    const showDebugInfo =
        import.meta.env.DEV && localStorage.getItem('jdDebug') === '1';
    const canCreateResume = !isLoadingResume;
    const isEditorBusy = isLoadingResume || isCreatingResume;

    useEffect(() => {
        if (!isMobileEditorDrawerOpen) {
            return;
        }
        const scrollContainer = mobileEditorScrollContainerRef.current;
        const { overflow } = document.body.style;
        document.body.style.overflow = 'hidden';
        const previousContainerOverflow = scrollContainer?.style.overflow ?? '';
        if (scrollContainer) {
            scrollContainer.style.overflow = 'hidden';
        }
        return () => {
            document.body.style.overflow = overflow;
            if (scrollContainer) {
                scrollContainer.style.overflow = previousContainerOverflow;
            }
        };
    }, [isMobileEditorDrawerOpen]);
    useEffect(() => {
        if (previousMatchScoreFilterResumeIdRef.current === resumeId) {
            return;
        }
        previousMatchScoreFilterResumeIdRef.current = resumeId;
        if (matchScoreFilterSource !== 'auto') {
            return;
        }
        resetAutoDerivedMatchScoreFilter();
    }, [matchScoreFilterSource, resetAutoDerivedMatchScoreFilter, resumeId]);
    useEffect(() => {
        if (matchScoreFilterSource !== 'auto' || (analysisResult && !isOutdated)) {
            return;
        }
        resetAutoDerivedMatchScoreFilter();
    }, [analysisResult, isOutdated, matchScoreFilterSource, resetAutoDerivedMatchScoreFilter]);
    useEffect(() => {
        if (!isMobileEditorDrawerOpen || typeof window === 'undefined') {
            return;
        }
        const handleResize = () => {
            if (window.innerWidth >= 768) {
                dismissMobileEditorDrawerImmediately();
            }
        };
        window.addEventListener('resize', handleResize);
        return () => {
            window.removeEventListener('resize', handleResize);
        };
    }, [dismissMobileEditorDrawerImmediately, isMobileEditorDrawerOpen]);
    useEffect(() => {
        return () => {
            if (mobileEditorDrawerTimerRef.current !== null) {
                window.clearTimeout(mobileEditorDrawerTimerRef.current);
            }
        };
    }, []);

    return (
        <div
            ref={mobileEditorScrollContainerRef}
            className="relative flex min-h-full flex-1 flex-col overflow-y-auto bg-background-light dark:bg-background-dark md:h-full md:overflow-hidden"
            aria-busy={isEditorBusy}
        >
            <div className="hidden md:block">
                <EditorToolbar
                    isDarkMode={isDarkMode}
                    saveState={saveState}
                    lastSavedAt={lastSavedAt}
                    onToggleTheme={toggleTheme}
                    isLayoutModified={isLayoutModified}
                    isSmartPageApplied={isSmartPageApplied}
                    isLayoutAdjustToolbarOpen={isLayoutAdjustToolbarOpen}
                    onToggleLayoutAdjustToolbar={handleToggleLayoutAdjustToolbar}
                    onAdjustToSinglePage={adjustToSinglePage}
                    onRestoreDefault={restoreDefault}
                    canCreateResume={canCreateResume}
                    isCreatingResume={isCreatingResume}
                    onCreateResume={handleCreateResume}
                    resumeName={resumeName}
                    onResumeNameChange={handleResumeNameChange}
                    onExportPdf={handleExportPdf}
                    isExportingPdf={isExportingPdf}
                    onOpenTemplateSelector={() => setIsTemplateSelectorOpen(true)}
                />
            </div>
            <div className="md:hidden">
                <MobileEditorHeader
                    resumeId={resumeId}
                    resumeName={resumeName}
                    onResumeNameChange={handleResumeNameChange}
                    analysisResult={analysisResult}
                    isOutdated={isOutdated}
                    isAnalyzing={isAnalyzing}
                    onAnalyze={handleAnalyzeWithAutoName}
                    onExportPdf={handleExportPdf}
                    isExportingPdf={isExportingPdf}
                    onOpenTemplateSelector={() => setIsTemplateSelectorOpen(true)}
                    onAutoAssemble={handleAutoAssemble}
                    isAutoAssembling={isAutoAssembling}
                    onCreateResume={handleCreateResume}
                    canCreateResume={canCreateResume}
                    isCreatingResume={isCreatingResume}
                    isLayoutModified={isLayoutModified}
                    isSmartPageApplied={isSmartPageApplied}
                    isLayoutAdjustToolbarOpen={isLayoutAdjustToolbarOpen}
                    onToggleLayoutAdjustToolbar={handleToggleLayoutAdjustToolbar}
                    onAdjustToSinglePage={adjustToSinglePage}
                    onRestoreDefault={restoreDefault}
                    bossGreeting={bossGreeting}
                    isBossGreetingVisible={isBossGreetingVisible}
                    isBossGreetingOutdated={isBossGreetingOutdated}
                    isGeneratingBossGreeting={isGeneratingBossGreeting}
                    onGenerateBossGreeting={handleGenerateBossGreeting}
                    onRefreshBossGreeting={handleRefreshBossGreeting}
                    onCopyBossGreeting={handleCopyBossGreeting}
                    onCollapseBossGreeting={handleCollapseBossGreeting}
                    jdText={jdText}
                    onJdTextChange={handleJdTextChange}
                    jdFile={jdFile}
                    onFileChange={setJdFile}
                    hasMissingAttachmentContext={hasMissingAttachmentContext}
                    isJDCollapsed={isJDCollapsed}
                    onJDCollapseChange={setIsJDCollapsed}
                />
            </div>
            <div className="flex flex-1 flex-col overflow-visible md:min-h-0 md:overflow-hidden md:flex-row">
                <div className={`hidden md:flex md:h-full md:min-h-0 md:shrink-0 md:overflow-hidden ${SIDEBAR_WIDTH_CLASS}`}>
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
                                personalSummary: editablePersonalSummary,
                                isSummaryVisible,
                                isGeneratingPersonalSummary,
                                canGeneratePersonalSummary: Boolean(jdPolishContext.trim()),
                                onPersonalSummaryChange: handlePersonalSummaryChange,
                                onSummaryVisibilityChange: setIsSummaryVisible,
                                onGeneratePersonalSummary: () => void handleGeneratePersonalSummary(),
                                matchScoreFilter,
                            onMatchScoreFilterChange: handleMatchScoreFilterChange,
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
                </div>
                <div className="flex flex-1 flex-col overflow-visible pb-20 md:min-h-0 md:overflow-hidden md:pb-0">
                    {isLayoutAdjustToolbarOpen ? (
                        <LayoutAdjustToolbar
                            lineHeight={lineHeight}
                            fontSize={fontSize}
                            topPaddingPx={topPaddingPx}
                            sectionSpacingKey={sectionSpacingKey}
                            itemSpacingEm={itemSpacingEm}
                            lineHeightOptions={LINE_HEIGHT_OPTIONS}
                            fontSizeOptions={FONT_SIZE_OPTIONS}
                            topPaddingOptions={TOP_PADDING_SELECT_OPTIONS}
                            sectionSpacingOptions={SECTION_SPACING_OPTIONS}
                            itemSpacingOptions={ITEM_SPACING_SELECT_OPTIONS}
                            lineHeightSlider={{
                                min: LINE_HEIGHT_MIN,
                                max: LINE_HEIGHT_DEFAULT,
                                step: LINE_HEIGHT_STEP,
                            }}
                            fontSizeSlider={{
                                min: FONT_SIZE_MIN,
                                max: FONT_SIZE_DEFAULT,
                                step: FONT_SIZE_STEP,
                            }}
                            topPaddingSlider={{
                                min: TOP_PADDING_MIN_PX,
                                max: TOP_PADDING_SLIDER_MAX,
                                step: SMART_PAGE_TOP_PADDING_STEP_PX,
                            }}
                            sectionSpacingSlider={{
                                min: 2,
                                max: 8,
                                step: 1,
                            }}
                            itemSpacingSlider={{
                                min: SMART_PAGE_ITEM_SPACING_MIN,
                                max: MAX_ITEM_SPACING_EM,
                                step: SMART_PAGE_ITEM_SPACING_STEP,
                            }}
                            themeColorPresetId={themeColorPresetId}
                            themeColorOptions={RESUME_THEME_COLOR_PRESETS}
                            onLineHeightChange={handleLineHeightChange}
                            onFontSizeChange={handleFontSizeChange}
                            onTopPaddingChange={handleTopPaddingChange}
                            onSectionSpacingChange={handleSectionSpacingChange}
                            onItemSpacingChange={handleItemSpacingChange}
                            onThemeColorChange={setThemeColorPresetId}
                        />
                    ) : null}
                    <ResumePreview
                        previewRef={previewRef}
                        previewContentRef={previewContentRef}
                        previewScope="editor"
                        lineHeight={lineHeight}
                        fontSize={fontSize}
                        listSpacingValue={listSpacingValue}
                        bulletSpacingValue={bulletSpacingValue}
                        topPaddingPx={topPaddingPx}
                        templateId={resumeTemplateId}
                        themeColorPresetId={themeColorPresetId}
                        profile={previewProfile}
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
                        onTouchSectionDragStart={startSectionReorder}
                        onItemDragStart={handleDragStart}
                        onItemDragHover={handleItemDragHover}
                        onItemDrop={handleItemDrop}
                        onTouchItemDragStart={startItemReorder}
                        onTouchDragEnd={finishDragInteraction}
                        onTouchDragCancel={cancelTouchDragInteraction}
                        onDragEnd={clearDragState}
                        onNavigateTab={setSidebarTab}
                        onEditExperience={handleEditExperience}
                        onEditCertification={handleEditCertification}
                        onEditSkill={handleEditSkill}
                    />
                </div>
            </div>
            <TemplateSelectorModal
                isOpen={isTemplateSelectorOpen}
                selectedTemplateId={resumeTemplateId}
                themeColorPresetId={themeColorPresetId}
                onClose={() => setIsTemplateSelectorOpen(false)}
                onSelectTemplate={(templateId) => {
                    savePreferredResumeTemplateId(templateId);
                    if (templateId === resumeTemplateId) {
                        setIsTemplateSelectorOpen(false);
                        return;
                    }
                    setResumeTemplateId(templateId);
                    setThemeColorPresetId(resolveDefaultResumeThemeColorPresetId(templateId));
                    setIsTemplateSelectorOpen(false);
                }}
            />

            <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 md:hidden">
                <div className="pointer-events-auto rounded-t-[28px] border border-b-0 border-border-light bg-surface-light/96 px-4 pb-[calc(env(safe-area-inset-bottom)+10px)] pt-2 shadow-[0_-18px_40px_rgba(15,23,42,0.14)] backdrop-blur dark:border-border-dark dark:bg-surface-dark/96">
                    <button
                        type="button"
                        onClick={openMobileEditorDrawer}
                        className="mx-auto flex w-full max-w-[240px] flex-col items-center rounded-t-[20px] px-6 pb-1 pt-0.5 text-center"
                    >
                        <span className="mb-2 h-1.5 w-14 rounded-full bg-gray-300 dark:bg-gray-700" />
                        <span className="inline-flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
                            <Database className="h-4 w-4 text-primary" />
                            经历库
                        </span>
                    </button>
                </div>
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
                    templateId={resumeTemplateId}
                    themeColorPresetId={themeColorPresetId}
                    profile={previewProfile}
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
                    onTouchSectionDragStart={() => { }}
                    onItemDragStart={() => { }}
                    onItemDragHover={() => { }}
                    onItemDrop={() => { }}
                    onTouchItemDragStart={() => { }}
                    onTouchDragEnd={() => { }}
                    onTouchDragCancel={() => { }}
                    onDragEnd={() => { }}
                    onNavigateTab={setSidebarTab}
                    onEditExperience={() => { }}
                    onEditCertification={() => { }}
                    onEditSkill={() => { }}
                />
            </div>
            {isMobileEditorDrawerOpen ? (
                <div className={`fixed inset-0 z-[70] transition-opacity duration-[320ms] ease-[cubic-bezier(0.22,1,0.36,1)] md:hidden ${isMobileEditorDrawerVisible ? 'bg-black/35 opacity-100 backdrop-blur-[1px]' : 'bg-black/0 opacity-0'}`}>
                    <button
                        type="button"
                        aria-label="关闭经历库抽屉遮罩"
                        className="absolute inset-0 h-full w-full cursor-default"
                        onClick={closeMobileEditorDrawer}
                    />
                    <div className={`absolute inset-x-0 bottom-0 h-[82vh] rounded-t-[28px] border border-border-light bg-surface-light shadow-[0_-24px_60px_rgba(15,23,42,0.22)] will-change-transform transition-transform duration-[320ms] ease-[cubic-bezier(0.22,1,0.36,1)] dark:border-border-dark dark:bg-surface-dark ${isMobileEditorDrawerVisible ? 'translate-y-0' : 'translate-y-full'}`}>
                        <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-t-[28px]">
                            <div className="shrink-0 px-4 pb-2 pt-2">
                                <div className="mx-auto h-1.5 w-14 rounded-full bg-gray-300 dark:bg-gray-700" />
                            </div>
                            <EditorSidebar
                                layoutMode="drawer"
                                showJDPanel={false}
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
                                        personalSummary: editablePersonalSummary,
                                        isSummaryVisible,
                                        isGeneratingPersonalSummary,
                                        canGeneratePersonalSummary: Boolean(jdPolishContext.trim()),
                                        onPersonalSummaryChange: handlePersonalSummaryChange,
                                        onSummaryVisibilityChange: setIsSummaryVisible,
                                        onGeneratePersonalSummary: () => void handleGeneratePersonalSummary(),
                                        matchScoreFilter,
                                    onMatchScoreFilterChange: handleMatchScoreFilterChange,
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
                        </div>
                    </div>
                </div>
            ) : null}
            {isEditorBusy ? (
                <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/70 dark:bg-black/50 backdrop-blur-[1px]">
                    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-3 text-sm font-medium text-gray-600 dark:text-gray-200 shadow-sm">
                        {isCreatingResume ? '正在创建并切换简历...' : '正在加载简历...'}
                    </div>
                </div>
            ) : null}
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
