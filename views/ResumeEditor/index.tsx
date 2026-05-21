import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Database } from 'lucide-react';
import ConfirmDialog from '../../components/ConfirmDialog';
import { ToastContainer, useToast } from '../../components/Toast';
import { useExperienceActions } from '../../hooks/useExperienceActions';
import { useJDAnalysis } from '../../hooks/useJDAnalysis';
import { useResumeData } from '../../hooks/useResumeData';
import { resolveAuthUserKeyFromActiveSession } from '../../services/apiClient';
import { exportService } from '../../services/exportService';
import { profileService, type Profile } from '../../services/profileService';
import {
    resumeService,
    type Resume as ResumeRecord,
    type ResumeExperienceItem,
} from '../../services/resumeService';
import {
    aiService,
    type BossGreetingStreamEvent,
    type JDAnalysisResult,
    type PolishMode,
    type PersonalSummaryStreamEvent,
} from '../../services/aiService';
import { certificationsService, type Certification as CertificationRecord } from '../../services/certificationsService';
import { experienceService, type ExperienceDetail, type ExperienceListItem } from '../../services/experienceService';
import { skillsService } from '../../services/skillsService';
import type {
    CertificationView,
    EducationEditDraft,
    EducationView,
    ExperienceEditDraft,
    PolishPreviewState,
    ProfileSyncMode,
    ResumeBossGreeting,
    ResumeEditorConfig,
    ResumeEditorProfile,
    ResumeExperienceListMarkerStyle,
    ResumeJDAnalysis,
    ResumeLayoutOrders,
    ResumePrintLayoutMeasurement,
    ResumeExperienceView,
    SectionSpacingKey,
    SkillGroupView,
} from '../../types/resume';
import type { Resume as DashboardResume } from '../../types';
import { buildExperienceDate, normalizeDateInput } from '../../utils/dateUtils';
import {
    buildResumeAISnapshot,
    buildStarFields,
    mergeStarFieldsWithSource,
} from '../../utils/resumeHelpers';
import { mergeLinkedInLink } from '../profileUtils';
import {
    loadJDAnalysisCache,
    normalizeJDAnalysisPersistence,
    selectPreferredPersistedJDAnalysis,
} from '../jdAnalysisStorage';
import {
    clearPendingAssistantManualSaveDraft,
    type PendingAssistantManualSaveDraft,
    readPendingAssistantManualSaveDrafts,
} from '../assistantManualSaveStorage';
import { type DropPosition, moveItemWithDropPosition } from '../../utils/dragSort';
import { formatRelativeTime } from '../../utils/timeUtils';
import { buildResumeExportTitle } from '../../utils/exportFilename';
import { downloadUrlFile } from '../../utils/downloadUrlFile';
import { extractThoughtHeadline } from '../../utils/aiThought';
import { buildJDCapabilityContext, buildJDPolishContext } from '../../utils/assistantResumeContext';
import { buildSmartCompleteAssistantPrompt } from '../../utils/assistantSmartCompletePrompt';
import { normalizeAssistantDraftCard } from '../../utils/assistantDraft';
import { measureResumePrintLayout } from '../../utils/resumePrintLayout';
import {
    normalizeAiRichText,
    sanitizeRichTextHtml,
    stripRichTextToText,
} from '../../utils/richText';
import {
    trackAiAssistantDraftApplied,
    trackAiPolishApplied,
    trackAiPolishResult,
    trackAiPolishStart,
    trackAiPolishUndone,
    trackBossGreetingResult,
    trackBossGreetingStart,
    trackLayoutModeChange,
    trackModuleReordered,
    trackResumeExported,
    trackSmartAssemblyResult,
    trackSmartAssemblyStart,
    trackSmartOnePageTriggered,
} from '../../utils/analyticsTracker';
import { mapResumesToDashboard } from '../../utils/dashboardResumeMapper';
import { resolveResumeDisplayTitle, UNTITLED_RESUME_TITLE } from '../../constants/resumeConstants';
import {
    AUTO_SAVE_DELAY_MS,
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
    FONT_SIZE_MAX,
    FONT_SIZE_MIN,
    FONT_SIZE_STEP,
    LINE_HEIGHT_DEFAULT,
    LINE_HEIGHT_MAX,
    LINE_HEIGHT_MIN,
    LINE_HEIGHT_STEP,
    LIST_SPACING_BY_DENSITY,
    PROFILE_SYNC_MODES,
    SIDEBAR_WIDTH_CLASS,
    SMART_PAGE_ADJUSTING_TOAST_DURATION_MS,
    SMART_PAGE_ITEM_SPACING_MAX,
    SMART_PAGE_ITEM_SPACING_MIN,
    SMART_PAGE_ITEM_SPACING_STEP,
    SMART_PAGE_TOP_PADDING_MIN_PX,
    SMART_PAGE_TOP_PADDING_STEP_PX,
    PRINT_LAYOUT_OVERFLOW_TOLERANCE_PX,
    SMART_PAGE_TOAST_MESSAGES,
    JD_ANALYSIS_TOAST_MESSAGES,
    JD_ANALYSIS_PROGRESS_NODE_TITLES,
    JD_ANALYSIS_TOAST_DURATION_MS,
    JD_ANALYSIS_TOAST_ERROR_DURATION_MS,
    DEFAULT_MATCH_SCORE_FILTER,
} from './constants';
import { buildDragItemKey, parseDragItemKey, type DragItemType } from './dragKeys';
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
import {
    FONT_SIZE_OPTIONS,
    FONT_SIZE_SHRINK_STEPS,
    ITEM_SPACING_SELECT_OPTIONS,
    LINE_HEIGHT_OPTIONS,
    LINE_HEIGHT_SHRINK_STEPS,
    MAX_ITEM_SPACING_EM,
    SECTION_SPACING_OPTIONS,
    TOP_PADDING_MIN_PX,
    TOP_PADDING_SELECT_OPTIONS,
    TOP_PADDING_SLIDER_MAX,
    areLayoutValuesEqual,
    buildDefaultSmartPageLayout,
    buildDiscreteStepsFromCurrent,
    buildFontSizeSteps,
    buildItemSpacingSteps,
    buildLineHeightSteps,
    buildReductionStepsFromCurrent,
    buildSpacingValue,
    buildTopPaddingSteps,
    resolveMaxTopPaddingPx,
    resolveDefaultItemSpacingEm,
    resolveDefaultSectionSpacingKey,
    resolveDefaultTopPaddingPx,
    resolveLayoutSnapshotFromConfig,
    resolveNearestSectionSpacingKey,
    resolveSectionSpacingClass,
    SECTION_SPACING_KEYS,
    type LayoutSnapshot,
    type SmartPageLayout,
} from './layoutUtils';
import {
    buildAutoAssemblySelectionFilter,
    buildLayoutSnapshot,
    buildOrderedScoreItems,
    buildRemovalQueue,
    buildSelectionSnapshot,
    hasPositiveMatchScore,
    pickThresholdIds,
    pickTopIds,
    toMatchScoreMap,
    toggleGroupedSelectionSnapshotIds,
    toggleSelectionSnapshotIds,
    type AutoAssemblySelection,
    type ManualSelectionSnapshot,
} from './autoAssemblyUtils';
import {
    isDefaultResumeTitle,
    normalizeResumeTitle,
    resolveAutoResumeName,
} from './autoNameUtils';
import { buildResumePdfRenderSnapshot } from '../../utils/resumePdf';
import {
    DEFAULT_RESUME_EXPERIENCE_LIST_MARKER_STYLE,
    DEFAULT_RESUME_SKILL_TAG_SEPARATOR,
    normalizeResumeExperienceListMarkerStyle,
    normalizeResumeSkillTagSeparator,
} from '../../utils/resumeCustomization';
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
    loadResumeTemplatePresetMap,
    saveResumeTemplatePreset,
    savePreferredResumeTemplateId,
    syncResumeTemplatePresetsFromProfile,
} from '../resumeTemplateStorage';
import EditorSidebar from './components/EditorSidebar';
import EditorToolbar from './components/EditorToolbar';
import LayoutAdjustToolbar from './components/LayoutAdjustToolbar';
import MobileEditorHeader from './components/MobileEditorHeader';
import TemplateSelectorModal from './components/TemplateSelectorModal';
import ResumePreview from './components/ResumePreview';
import AIPolishToolbar from '../../components/AIPolishToolbar';
import type { AssistantDraftApplyMeta, AssistantLaunchRequest } from '../AIAssistant/types';

const MOBILE_EDITOR_DRAWER_ANIMATION_MS = 320;
const TEMPLATE_PRESET_SYNC_TIMEOUT_MS = 1500;

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
    | { status: 'partial'; stage: 'load'; resumeId: string; error?: unknown }
    | { status: 'failed'; stage: 'create'; error: unknown };

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

const normalizePersistedBossGreeting = (value: unknown): ResumeBossGreeting | null => {
    if (!value || typeof value !== 'object') {
        return null;
    }
    const record = value as Partial<ResumeBossGreeting>;
    const greeting = typeof record.greeting === 'string' ? record.greeting.trim() : '';
    if (!greeting) {
        return null;
    }
    return {
        greeting,
        ...(typeof record.signature === 'string' && record.signature.trim()
            ? { signature: record.signature }
            : {}),
    };
};

type PendingPersistedBossGreeting = ResumeBossGreeting & {
    resumeId: string | null;
};

const buildPersonalSummarySignature = ({
    jdText,
    context,
}: PersonalSummarySignatureParams) => JSON.stringify({
    jdText: jdText.trim(),
    context,
});

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
    educations: sortSnapshotEntriesById(snapshot.educations),
    certifications: sortSnapshotEntriesById(snapshot.certifications),
    skills: sortSnapshotEntriesById(snapshot.skills),
});

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

const applyAssistantExperienceDraftToEditingDraft = (
    draft: ExperienceEditDraft,
    assistantDraft: {
        org: string;
        title: string;
        startDate: string;
        endDate: string;
        isCurrent?: boolean;
        star: {
            s: string;
            t: string;
            a: string;
            r: string;
        };
    }
): ExperienceEditDraft => {
    const nextDraft: ExperienceEditDraft = {
        ...draft,
        company: assistantDraft.org,
        title: assistantDraft.title,
        startDate: assistantDraft.startDate || '',
        endDate: assistantDraft.isCurrent ? '' : (assistantDraft.endDate || ''),
        isCurrent: Boolean(assistantDraft.isCurrent),
        star: {
            s: assistantDraft.star.s,
            t: assistantDraft.star.t,
            a: assistantDraft.star.a,
            r: assistantDraft.star.r,
        },
        starTouched: true,
    };
    return (
        nextDraft.company === draft.company
        && nextDraft.title === draft.title
        && nextDraft.startDate === draft.startDate
        && nextDraft.endDate === draft.endDate
        && nextDraft.isCurrent === draft.isCurrent
        && nextDraft.star.s === draft.star.s
        && nextDraft.star.t === draft.star.t
        && nextDraft.star.a === draft.star.a
        && nextDraft.star.r === draft.star.r
        && nextDraft.starTouched === draft.starTouched
    )
        ? draft
        : nextDraft;
};

const buildPendingAssistantManualSaveDraftKey = (
    draft: Pick<PendingAssistantManualSaveDraft, 'sessionId' | 'messageId' | 'resumeId' | 'masterId' | 'createdAt'>
) => [
    draft.sessionId,
    draft.messageId,
    draft.resumeId,
    draft.masterId,
    String(draft.createdAt),
].join(':');

const readErrorStatus = (error: unknown): number | undefined => (
    (error as { response?: { status?: number } } | null)?.response?.status
);

const measureResumeLayout = (
    pageElement: HTMLElement | null,
    contentElement: HTMLElement | null
): ResumePrintLayoutMeasurement | null => {
    if (!pageElement || !contentElement) {
        return null;
    }

    return measureResumePrintLayout(
        pageElement,
        contentElement,
        PRINT_LAYOUT_OVERFLOW_TOLERANCE_PX
    );
};

type ResumeEditorProps = {
    cachedResumes?: DashboardResume[];
    cachedResumesOwnerKey?: string | null;
    authUserKey?: string | null;
    onResumesUpdate?: (resumes: DashboardResume[]) => void;
    onLaunchAssistant?: (request: AssistantLaunchRequest) => void;
    onOpenAgentPluginConfig?: () => void;
    mobileDrawerOpenRequest?: number;
    onMobileDrawerOpenRequestConsumed?: () => void;
};

type ResumePolishMode = Exclude<PolishMode, 'assistant'>;
const DEFAULT_RESUME_POLISH_MODE: ResumePolishMode = 'default';
const SMART_RESUME_POLISH_MODES: ResumePolishMode[] = [
    'default',
    'highlight',
    'custom',
];
const BATCH_RESUME_POLISH_MODES: ResumePolishMode[] = [
    'default',
    'highlight',
    'custom',
];

type SmartCompletionPromptState = {
    diagnosis: string;
    questions: string[];
    answer: string;
};

const FLOATING_POLISH_PREVIEW_FIELDS: Array<{ key: keyof ExperienceEditDraft['star']; label: string }> = [
    { key: 's', label: '情境' },
    { key: 't', label: '任务' },
    { key: 'a', label: '行动' },
    { key: 'r', label: '结果' },
];

const FloatingPolishPreviewContent: React.FC<{ draft: ExperienceEditDraft }> = ({ draft }) => {
    const rows = FLOATING_POLISH_PREVIEW_FIELDS
        .map(({ key, label }) => {
            const html = sanitizeRichTextHtml(draft.star[key] ?? '');
            return stripRichTextToText(html).trim() ? { key, label, html } : null;
        })
        .filter((item): item is { key: keyof ExperienceEditDraft['star']; label: string; html: string } => Boolean(item));

    if (!rows.length) {
        return (
            <div className="rounded-2xl border border-emerald-100 bg-white/80 px-3 py-3 text-sm leading-6 text-emerald-900">
                暂无可预览的正文内容。
            </div>
        );
    }

    return (
        <div className="space-y-3">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
                修改后文本
            </div>
            <div className="space-y-2">
                {rows.map((row) => (
                    <div key={row.key} className="rounded-2xl border border-emerald-100 bg-white/86 px-3 py-2 shadow-sm">
                        <div className="text-[11px] font-semibold text-emerald-700">{row.label}</div>
                        <div
                            className="mt-1 text-sm leading-6 text-slate-800"
                            dangerouslySetInnerHTML={{ __html: row.html }}
                        />
                    </div>
                ))}
            </div>
        </div>
    );
};

const buildSmartCompletionCustomPrompt = (answer: string, capabilityContext: string) => {
    const trimmedAnswer = answer.trim();
    const trimmedCapabilityContext = capabilityContext.trim();
    return [
        trimmedCapabilityContext,
        trimmedAnswer ? `用户补充的真实事实：${trimmedAnswer}` : '',
    ].filter(Boolean).join('\n\n') || undefined;
};

const buildSmartCompletionPromptState = (
    result: {
        evidenceDiagnosis?: string;
        followUpQuestions?: string[];
    },
    previous?: SmartCompletionPromptState | null
): SmartCompletionPromptState => ({
    diagnosis: result.evidenceDiagnosis?.trim() || '这段经历证据不足，建议先补充事实后再润色。',
    questions: (result.followUpQuestions ?? [])
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 3),
    answer: previous?.answer ?? '',
});
type FloatingExperiencePolishSessionItem = {
    targetId: string;
    beforeDraft: ExperienceEditDraft;
    afterDraft: ExperienceEditDraft;
    beforeItem: ResumeExperienceView;
    afterItem: ResumeExperienceView;
    wasSelected: boolean;
};
type FloatingExperiencePolishSession = {
    mode: 'single' | 'batch';
    items: FloatingExperiencePolishSessionItem[];
    failedIds: string[];
};

const ResumeEditor: React.FC<ResumeEditorProps> = ({
    cachedResumes = [],
    cachedResumesOwnerKey = null,
    authUserKey = null,
    onResumesUpdate,
    onLaunchAssistant,
    onOpenAgentPluginConfig,
    mobileDrawerOpenRequest = 0,
    onMobileDrawerOpenRequestConsumed,
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
    const [previewPrintMeasurement, setPreviewPrintMeasurement] = useState<ResumePrintLayoutMeasurement | null>(null);
    const [isLayoutAdjustToolbarOpen, setIsLayoutAdjustToolbarOpen] = useState(false);
    const [isTemplateSelectorOpen, setIsTemplateSelectorOpen] = useState(false);
    const [templatePresetMap, setTemplatePresetMap] = useState(() => loadResumeTemplatePresetMap(authUserKey));
    const [isTemplatePresetMapReady, setIsTemplatePresetMapReady] = useState(false);
    const [isTemplatePresetFallbackAvailable, setIsTemplatePresetFallbackAvailable] = useState(false);
    const [templatePresetFallbackOwnerKey, setTemplatePresetFallbackOwnerKey] = useState<string | null>(authUserKey);
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
    const [isPersonalSummaryOverwriteDialogOpen, setIsPersonalSummaryOverwriteDialogOpen] = useState(false);
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
    const pendingPersistedBossGreetingRef = useRef<PendingPersistedBossGreeting | null>(null);
    const activeAutoAssembleToastIdRef = useRef<string | null>(null);
    const activeBossGreetingToastIdRef = useRef<string | null>(null);
    const activePersonalSummaryToastIdRef = useRef<string | null>(null);
    const previousMatchScoreFilterResumeIdRef = useRef<string | null>(null);
    const latestAuthUserKeyRef = useRef<string | null>(authUserKey);
    const templatePresetRequestIdRef = useRef(0);
    const templatePresetCompletedRequestIdRef = useRef(0);
    const bossGreetingUiStateRef = useRef({
        text: '',
        signature: '',
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
    const applyTemplatePresetMapForCurrentUser = useCallback(async (
        requestId: number,
        requestedAuthUserKey: string | null | undefined,
        currentProfile?: Profile | null
    ) => {
        const ownerId = currentProfile?.user_id
            ?? requestedAuthUserKey
            ?? await resolveAuthUserKeyFromActiveSession();
        if (
            templatePresetRequestIdRef.current !== requestId
            || latestAuthUserKeyRef.current !== (requestedAuthUserKey ?? null)
        ) {
            return;
        }
        templatePresetCompletedRequestIdRef.current = requestId;
        const nextPresetMap = currentProfile?.extra_json
            ? syncResumeTemplatePresetsFromProfile(currentProfile.extra_json, ownerId)
            : loadResumeTemplatePresetMap(ownerId);
        setTemplatePresetMap(nextPresetMap);
        setIsTemplatePresetMapReady(Boolean(ownerId));
        setIsTemplatePresetFallbackAvailable(false);
        setTemplatePresetFallbackOwnerKey(ownerId ?? null);
    }, []);
    const unlockTemplatePresetMapWithLocalFallback = useCallback((requestedAuthUserKey?: string | null) => {
        const ownerId = requestedAuthUserKey ?? null;
        if (!ownerId) {
            return;
        }
        setTemplatePresetMap(loadResumeTemplatePresetMap(ownerId));
        setIsTemplatePresetMapReady(Boolean(ownerId));
        setIsTemplatePresetFallbackAvailable(false);
        setTemplatePresetFallbackOwnerKey(ownerId ?? null);
    }, []);
    const refreshTemplatePresetMapForCurrentUser = useCallback((requestedAuthUserKey?: string | null) => {
        const requestId = ++templatePresetRequestIdRef.current;
        setIsTemplatePresetMapReady(false);
        setIsTemplatePresetFallbackAvailable(false);
        setTemplatePresetFallbackOwnerKey(requestedAuthUserKey ?? null);
        const profilePromise = profileService
            .getProfile({ force: true })
            .catch(() => profileService.peekProfileForCurrentUser());
        let timeoutId: number | null = null;
        if (typeof window !== 'undefined') {
            timeoutId = window.setTimeout(async () => {
                const ownerId = requestedAuthUserKey ?? await resolveAuthUserKeyFromActiveSession();
                if (
                    templatePresetCompletedRequestIdRef.current === requestId
                    || templatePresetRequestIdRef.current !== requestId
                    || latestAuthUserKeyRef.current !== (requestedAuthUserKey ?? null)
                ) {
                    return;
                }
                setTemplatePresetFallbackOwnerKey(ownerId ?? null);
                setIsTemplatePresetFallbackAvailable(Boolean(ownerId));
            }, TEMPLATE_PRESET_SYNC_TIMEOUT_MS);
        }
        void profilePromise.then((currentProfile) => {
            if (timeoutId !== null && typeof window !== 'undefined') {
                window.clearTimeout(timeoutId);
            }
            void applyTemplatePresetMapForCurrentUser(requestId, requestedAuthUserKey, currentProfile);
        });
    }, [applyTemplatePresetMapForCurrentUser]);
    useEffect(() => {
        latestAuthUserKeyRef.current = authUserKey;
        const requestId = ++templatePresetRequestIdRef.current;
        setTemplatePresetMap(loadResumeTemplatePresetMap(authUserKey));
        setIsTemplatePresetMapReady(false);
        setIsTemplatePresetFallbackAvailable(false);
        setTemplatePresetFallbackOwnerKey(authUserKey ?? null);
        let cancelled = false;
        let timeoutId: number | null = null;
        const profilePromise = profileService
            .getProfile({ force: true })
            .catch(() => profileService.peekProfileForCurrentUser());
        if (typeof window !== 'undefined') {
            timeoutId = window.setTimeout(async () => {
                const ownerId = authUserKey ?? await resolveAuthUserKeyFromActiveSession();
                if (
                    templatePresetCompletedRequestIdRef.current === requestId
                    || templatePresetRequestIdRef.current !== requestId
                    || cancelled
                    || latestAuthUserKeyRef.current !== authUserKey
                ) {
                    return;
                }
                setTemplatePresetFallbackOwnerKey(ownerId ?? null);
                setIsTemplatePresetFallbackAvailable(Boolean(ownerId));
            }, TEMPLATE_PRESET_SYNC_TIMEOUT_MS);
        }
        void profilePromise.then((currentProfile) => {
            if (timeoutId !== null && typeof window !== 'undefined') {
                window.clearTimeout(timeoutId);
            }
            if (cancelled) {
                return;
            }
            void applyTemplatePresetMapForCurrentUser(requestId, authUserKey, currentProfile);
        });
        return () => {
            cancelled = true;
            if (timeoutId !== null && typeof window !== 'undefined') {
                window.clearTimeout(timeoutId);
            }
        };
    }, [applyTemplatePresetMapForCurrentUser, authUserKey]);
    const handleOpenTemplateSelector = useCallback(() => {
        setIsTemplateSelectorOpen(true);
        refreshTemplatePresetMapForCurrentUser(authUserKey);
    }, [authUserKey, refreshTemplatePresetMapForCurrentUser]);
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
    const [experienceListMarkerStyle, setExperienceListMarkerStyle] = useState<ResumeExperienceListMarkerStyle>(
        DEFAULT_RESUME_EXPERIENCE_LIST_MARKER_STYLE
    );
    const [skillTagSeparator, setSkillTagSeparator] = useState(DEFAULT_RESUME_SKILL_TAG_SEPARATOR);

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
    const bossGreetingSnapshot = useMemo<ResumeBossGreeting | null>(() => {
        const greeting = bossGreeting.trim();
        if (!greeting) {
            return null;
        }
        return {
            greeting,
            ...(bossGreetingSignature.trim() ? { signature: bossGreetingSignature } : {}),
        };
    }, [bossGreeting, bossGreetingSignature]);

    const resumeConfigSnapshot = useMemo(
        () =>
            buildResumeConfigSnapshot(
                profile,
                personalSummary,
                hasPersonalSummaryOverride,
                bossGreetingSnapshot,
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
                experienceListMarkerStyle,
                skillTagSeparator,
                persistedJDAnalysisSnapshot
            ),
        [
            density,
            bossGreetingSnapshot,
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
            experienceListMarkerStyle,
            sectionOrder,
            sectionSpacingKey,
            selectedCertIds,
            selectedEduIds,
            selectedExpIds,
            topPaddingPx,
            selectedSkillIds,
            skillTagSeparator,
        ]
    );
    const applyLayoutConfig = useCallback((config: ResumeEditorConfig) => {
        const nextLayout = resolveLayoutSnapshotFromConfig(config.layout);
        setTopPaddingPx(nextLayout.topPaddingPx);
        setSectionSpacingKey(nextLayout.sectionSpacingKey);
        setItemSpacingEm(nextLayout.itemSpacingEm);
        setLineHeight(nextLayout.lineHeight);
        setFontSize(nextLayout.fontSize);
        setMeasureLayout(nextLayout);
        setIsSmartPageApplied(nextLayout.isSmartPageApplied);
        const rawTemplateId = config.layout?.templateId;
        const nextTemplateId = normalizeResumeTemplateId(rawTemplateId);
        setResumeTemplateId(nextTemplateId);
        setThemeColorPresetId(
            config.layout?.themeColorPresetId
            ?? resolveDefaultResumeThemeColorPresetId(rawTemplateId ?? nextTemplateId)
        );
        setExperienceListMarkerStyle(
            normalizeResumeExperienceListMarkerStyle(config.layout?.experienceListMarkerStyle)
        );
        setSkillTagSeparator(normalizeResumeSkillTagSeparator(config.layout?.skillTagSeparator));
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
        authUserKey,
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
    const handleSelectTemplate = useCallback((templateId: ResumeTemplateId) => {
        if (!isTemplatePresetMapReady) {
            showToastInfo('正在同步模板预设，请稍后再试');
            return;
        }
        savePreferredResumeTemplateId(templateId);
        if (templateId === resumeTemplateId) {
            setIsTemplateSelectorOpen(false);
            return;
        }
        const preset = templatePresetMap[templateId];
        const nextThemeColorPresetId = preset?.themeColorPresetId ?? resolveDefaultResumeThemeColorPresetId(templateId);
        const nextExperienceListMarkerStyle = normalizeResumeExperienceListMarkerStyle(
            preset?.experienceListMarkerStyle
        );
        const nextSkillTagSeparator = normalizeResumeSkillTagSeparator(preset?.skillTagSeparator);
        const shouldUpdateSectionOrder = Boolean(preset);
        const isSameSectionOrder = !preset
            || JSON.stringify(sectionOrder) === JSON.stringify(preset.sectionOrder);
        if (
            templateId === resumeTemplateId
            && themeColorPresetId === nextThemeColorPresetId
            && experienceListMarkerStyle === nextExperienceListMarkerStyle
            && skillTagSeparator === nextSkillTagSeparator
            && isSameSectionOrder
        ) {
            setIsTemplateSelectorOpen(false);
            return;
        }
        setResumeTemplateId(templateId);
        setThemeColorPresetId(nextThemeColorPresetId);
        setExperienceListMarkerStyle(nextExperienceListMarkerStyle);
        setSkillTagSeparator(nextSkillTagSeparator);
        if (shouldUpdateSectionOrder) {
            setSectionOrder([...preset.sectionOrder]);
        }
        setIsTemplateSelectorOpen(false);
    }, [
        experienceListMarkerStyle,
        isTemplatePresetMapReady,
        resumeTemplateId,
        sectionOrder,
        showToastInfo,
        skillTagSeparator,
        templatePresetMap,
        themeColorPresetId,
    ]);
    const handleSaveTemplatePreset = useCallback(async (
        preset: {
            templateId: ResumeTemplateId;
            sectionOrder: string[];
            themeColorPresetId: ResumeThemeColorPresetId;
            experienceListMarkerStyle: ResumeExperienceListMarkerStyle;
            skillTagSeparator: string;
        }
    ) => {
        try {
            const savedPreset = await saveResumeTemplatePreset(preset);
            setTemplatePresetMap((prev) => ({
                ...prev,
                [savedPreset.templateId]: savedPreset,
            }));
            if (savedPreset.templateId === resumeTemplateId) {
                setThemeColorPresetId(savedPreset.themeColorPresetId);
                setSectionOrder([...savedPreset.sectionOrder]);
                setExperienceListMarkerStyle(savedPreset.experienceListMarkerStyle);
                setSkillTagSeparator(savedPreset.skillTagSeparator);
            }
            showToastSuccess('模板预设已保存');
        } catch (error) {
            console.error('[ResumeEditor] 保存模板预设失败:', error);
            showToastError('保存模板预设失败，请稍后重试');
            throw error;
        }
    }, [resumeTemplateId, showToastError, showToastSuccess]);
    const hydratingPersistedJDAnalysisSnapshot = useMemo(() => {
        const backendPersistedJDAnalysis = normalizeJDAnalysisPersistence(
            resumeDetail?.resume?.config?.jdAnalysis
        );
        return selectPreferredPersistedJDAnalysis(
            backendPersistedJDAnalysis,
            resumeId ? loadJDAnalysisCache(resumeId) : null
        )?.payload ?? null;
    }, [resumeDetail?.resume?.config?.jdAnalysis, resumeId]);
    const persistedBossGreeting = useMemo(
        () => normalizePersistedBossGreeting(resumeDetail?.resume?.config?.bossGreeting),
        [resumeDetail?.resume?.config?.bossGreeting]
    );
    useEffect(() => {
        const nextGreeting = persistedBossGreeting?.greeting ?? '';
        const nextSignature = persistedBossGreeting?.signature ?? '';
        const pendingBossGreeting = pendingPersistedBossGreetingRef.current;
        if (
            pendingBossGreeting
            && pendingBossGreeting.resumeId === resumeId
            && (
                nextGreeting !== pendingBossGreeting.greeting
                || nextSignature !== (pendingBossGreeting.signature ?? '')
            )
        ) {
            return;
        }
        pendingPersistedBossGreetingRef.current = null;
        const shouldResetVisibility = (
            nextGreeting !== bossGreetingUiStateRef.current.text
            || nextSignature !== bossGreetingUiStateRef.current.signature
        );
        if (nextGreeting !== bossGreetingUiStateRef.current.text) {
            setBossGreeting(nextGreeting);
        }
        if (nextSignature !== bossGreetingUiStateRef.current.signature) {
            setBossGreetingSignature(nextSignature);
        }
        if (shouldResetVisibility) {
            setIsBossGreetingVisible(false);
        }
    }, [persistedBossGreeting, resumeId]);
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
            bossGreetingSnapshot,
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
            experienceListMarkerStyle,
            skillTagSeparator,
            committedPersistedJDAnalysisSnapshot
        );
    }, [
        bossGreetingSnapshot,
        committedPersistedJDAnalysisSnapshot,
        density,
        experienceListMarkerStyle,
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
        skillTagSeparator,
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
    const jdCapabilityPolishContext = useMemo(
        () => buildJDCapabilityContext(analysisResult, isOutdated),
        [analysisResult, isOutdated]
    );
    const pendingAssistantApplyRef = useRef(new Map<string, AssistantDraftApplyMeta['persistApplied']>());
    const trackedPendingAssistantApplyRef = useRef(new Set<string>());
    const pendingAiPolishApplyRef = useRef(new Set<string>());
    const activeManualSaveDraftRef = useRef<PendingAssistantManualSaveDraft | null>(null);
    const appliedManualSaveDraftKeyRef = useRef<string | null>(null);
    const movePendingExperienceAssistantApply = useCallback((draftMasterId: string, savedMasterId: string) => {
        const pending = pendingAssistantApplyRef.current.get(draftMasterId);
        if (!pending || draftMasterId === savedMasterId) {
            return;
        }
        pendingAssistantApplyRef.current.delete(draftMasterId);
        pendingAssistantApplyRef.current.set(savedMasterId, pending);
        if (trackedPendingAssistantApplyRef.current.has(draftMasterId)) {
            trackedPendingAssistantApplyRef.current.delete(draftMasterId);
            trackedPendingAssistantApplyRef.current.add(savedMasterId);
        }
    }, []);
    const movePendingExperienceAiPolishApply = useCallback((draftMasterId: string, savedMasterId: string) => {
        if (draftMasterId === savedMasterId || !pendingAiPolishApplyRef.current.has(draftMasterId)) {
            return;
        }
        pendingAiPolishApplyRef.current.delete(draftMasterId);
        pendingAiPolishApplyRef.current.add(savedMasterId);
    }, []);
    const markPendingExperienceAiPolishApply = useCallback((masterId: string) => {
        pendingAiPolishApplyRef.current.add(masterId);
    }, []);
    const handleExperienceSaveSuccess = useCallback(async (masterId: string) => {
        let hasTrackedAssistantApply = false;
        const pending = pendingAssistantApplyRef.current.get(masterId);
        if (pending) {
            const shouldTrackAssistantApply = !trackedPendingAssistantApplyRef.current.has(masterId);
            try {
                await pending();
                pendingAssistantApplyRef.current.delete(masterId);
                trackedPendingAssistantApplyRef.current.delete(masterId);
            } catch (error) {
                if (shouldTrackAssistantApply) {
                    trackedPendingAssistantApplyRef.current.add(masterId);
                }
                console.error('[ResumeEditor] 同步 AI 草稿状态失败:', error);
                showToastError('已保存，但 AI 草稿状态同步失败，请稍后重试');
            }
            if (shouldTrackAssistantApply) {
                trackAiAssistantDraftApplied({
                    source: 'resume_editor',
                    cardType: 'experience',
                    callbackOnly: true,
                });
                hasTrackedAssistantApply = true;
            }
        }
        const activeManualSaveDraft = activeManualSaveDraftRef.current;
        const pendingManualSaveDraft = (
            activeManualSaveDraft
            && activeManualSaveDraft.resumeId === resumeId
            && activeManualSaveDraft.masterId === masterId
        )
            ? activeManualSaveDraft
            : null;
        if (pendingManualSaveDraft) {
            try {
                await aiService.markAssistantMessageApplied(
                    pendingManualSaveDraft.sessionId,
                    pendingManualSaveDraft.messageId,
                    { skipApply: true },
                );
                clearPendingAssistantManualSaveDraft({
                    sessionId: pendingManualSaveDraft.sessionId,
                    messageId: pendingManualSaveDraft.messageId,
                });
                activeManualSaveDraftRef.current = null;
                appliedManualSaveDraftKeyRef.current = null;
                if (!hasTrackedAssistantApply) {
                    trackAiAssistantDraftApplied({
                        source: 'resume_editor',
                        cardType: 'experience',
                        callbackOnly: true,
                    });
                }
            } catch (error) {
                const status = readErrorStatus(error);
                if (status === 404) {
                    clearPendingAssistantManualSaveDraft({
                        sessionId: pendingManualSaveDraft.sessionId,
                        messageId: pendingManualSaveDraft.messageId,
                    });
                    activeManualSaveDraftRef.current = null;
                    appliedManualSaveDraftKeyRef.current = null;
                    if (!hasTrackedAssistantApply) {
                        trackAiAssistantDraftApplied({
                            source: 'resume_editor',
                            cardType: 'experience',
                            callbackOnly: true,
                        });
                    }
                    return;
                }
                console.error('[ResumeEditor] 同步 AI 草稿状态失败:', error);
                showToastError('已保存，但 AI 草稿状态同步失败，请稍后重试');
                activeManualSaveDraftRef.current = pendingManualSaveDraft;
            }
        }
        if (pendingAiPolishApplyRef.current.has(masterId)) {
            trackAiPolishApplied({ source: 'resume_editor', field: 'all' });
            pendingAiPolishApplyRef.current.delete(masterId);
        }
    }, [resumeId, showToastError]);
    const clearPendingExperienceState = useCallback((masterId: string | null) => {
        if (!masterId) {
            return;
        }
        pendingAssistantApplyRef.current.delete(masterId);
        trackedPendingAssistantApplyRef.current.delete(masterId);
        pendingAiPolishApplyRef.current.delete(masterId);
        const activeManualSaveDraft = activeManualSaveDraftRef.current;
        if (
            activeManualSaveDraft
            && activeManualSaveDraft.resumeId === resumeId
            && activeManualSaveDraft.masterId === masterId
        ) {
            activeManualSaveDraftRef.current = null;
            appliedManualSaveDraftKeyRef.current = buildPendingAssistantManualSaveDraftKey(activeManualSaveDraft);
        }
    }, [resumeId]);
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
        onExperienceDraftPersisted: (draftMasterId, savedMasterId) => {
            movePendingExperienceAssistantApply(draftMasterId, savedMasterId);
            movePendingExperienceAiPolishApply(draftMasterId, savedMasterId);
        },
        onExperienceAiPolishPrepared: markPendingExperienceAiPolishApply,
        onExperienceSaveSuccess: handleExperienceSaveSuccess,
        onExperienceEditDiscarded: clearPendingExperienceState,
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
    useEffect(() => {
        if (!resumeId) {
            return;
        }
        if (isLoadingExperiences) {
            return;
        }
        const pendingManualSaveDrafts = readPendingAssistantManualSaveDrafts({ resumeId })
            .filter((draft) => draft.source === 'resume_editor');
        if (pendingManualSaveDrafts.length === 0) {
            activeManualSaveDraftRef.current = null;
            appliedManualSaveDraftKeyRef.current = null;
            return;
        }
        const [pendingManualSaveDraft, staleManualSaveDrafts] = pendingManualSaveDrafts.reduce<
            [PendingAssistantManualSaveDraft | null, PendingAssistantManualSaveDraft[]]
        >((result, draft) => {
            const [currentDraft, staleDrafts] = result;
            const targetExists = experienceItems.some((item) => item.id === draft.masterId);
            if (targetExists) {
                return currentDraft ? result : [draft, staleDrafts];
            }
            staleDrafts.push(draft);
            return [currentDraft, staleDrafts];
        }, [null, []]);
        staleManualSaveDrafts.forEach((draft) => {
            clearPendingAssistantManualSaveDraft({
                sessionId: draft.sessionId,
                messageId: draft.messageId,
            });
        });
        if (!pendingManualSaveDraft) {
            activeManualSaveDraftRef.current = null;
            appliedManualSaveDraftKeyRef.current = null;
            return;
        }
        const draftKey = buildPendingAssistantManualSaveDraftKey(pendingManualSaveDraft);
        activeManualSaveDraftRef.current = pendingManualSaveDraft;
        if (experience.editingExpId !== pendingManualSaveDraft.masterId) {
            if (appliedManualSaveDraftKeyRef.current === draftKey) {
                return;
            }
            experience.startEditingExperience(pendingManualSaveDraft.masterId);
            return;
        }
        if (!experience.editingDraft || experience.editingDraft.masterId !== pendingManualSaveDraft.masterId) {
            return;
        }
        if (appliedManualSaveDraftKeyRef.current === draftKey) {
            return;
        }
        appliedManualSaveDraftKeyRef.current = draftKey;
        experience.setEditingDraft((prev) => {
            if (!prev || prev.masterId !== pendingManualSaveDraft.masterId) {
                return prev;
            }
            return applyAssistantExperienceDraftToEditingDraft(prev, pendingManualSaveDraft.draft);
        });
    }, [experience, experienceItems, isLoadingExperiences, resumeId]);
    const [experiencePolishMode, setExperiencePolishMode] = useState<ResumePolishMode>(DEFAULT_RESUME_POLISH_MODE);
    const [experienceCustomPrompt, setExperienceCustomPrompt] = useState('');
    const [experienceSmartCompletionPrompt, setExperienceSmartCompletionPrompt] = useState<SmartCompletionPromptState | null>(null);
    const [experiencePolishPreview, setExperiencePolishPreview] = useState<PolishPreviewState<ExperienceEditDraft> | null>(null);
    const [isEditingExperiencePolishRunning, setIsEditingExperiencePolishRunning] = useState(false);
    const editingExperiencePolishRunningRef = useRef(false);
    const [activeFloatingPolishExperienceId, setActiveFloatingPolishExperienceId] = useState<string | null>(null);
    const [isBatchPolishToolbarOpen, setIsBatchPolishToolbarOpen] = useState(false);
    const [floatingPolishMode, setFloatingPolishMode] = useState<ResumePolishMode>(DEFAULT_RESUME_POLISH_MODE);
    const [floatingPolishCustomPrompt, setFloatingPolishCustomPrompt] = useState('');
    const [floatingSmartCompletionPrompt, setFloatingSmartCompletionPrompt] = useState<SmartCompletionPromptState | null>(null);
    const [floatingPolishSession, setFloatingPolishSession] = useState<FloatingExperiencePolishSession | null>(null);
    const [isFloatingExperiencePolishRunning, setIsFloatingExperiencePolishRunning] = useState(false);
    const [pendingPolishAutoAnalyzeSeq, setPendingPolishAutoAnalyzeSeq] = useState(0);
    const floatingExperiencePolishRunningRef = useRef(false);
    const lastPolishAutoAnalyzeSeqRef = useRef(0);
    const singleFloatingPolishPreview = floatingPolishSession?.mode === 'single'
        ? floatingPolishSession.items[0] ?? null
        : null;
    const batchFloatingPolishPreview = floatingPolishSession?.mode === 'batch'
        ? floatingPolishSession
        : null;

    useEffect(() => {
        setExperiencePolishMode(DEFAULT_RESUME_POLISH_MODE);
        setExperienceCustomPrompt('');
        setExperienceSmartCompletionPrompt(null);
        setExperiencePolishPreview(null);
        setIsEditingExperiencePolishRunning(false);
        editingExperiencePolishRunningRef.current = false;
    }, [experience.editingExpId]);

    useEffect(() => {
        if (!experience.editingExpId || floatingPolishSession) {
            return;
        }
        setActiveFloatingPolishExperienceId(null);
    }, [experience.editingExpId, floatingPolishSession]);

    useEffect(() => {
        if (!activeFloatingPolishExperienceId) {
            return;
        }
        const targetExists = experienceItems.some((item) => item.id === activeFloatingPolishExperienceId);
        if (!targetExists) {
            setActiveFloatingPolishExperienceId(null);
            setFloatingSmartCompletionPrompt(null);
            setFloatingPolishSession((prev) => {
                if (!prev || prev.mode !== 'single') {
                    return prev;
                }
                return prev.items.some((item) => item.targetId === activeFloatingPolishExperienceId) ? null : prev;
            });
            floatingExperiencePolishRunningRef.current = false;
            setIsFloatingExperiencePolishRunning(false);
        }
    }, [activeFloatingPolishExperienceId, experienceItems]);

    const handleRunEditingExperiencePolish = useCallback(async () => {
        if (!experience.editingDraft || editingExperiencePolishRunningRef.current) {
            return;
        }
        const trimmedJd = jdPolishContext.trim();
        if (!trimmedJd) {
            showToastError('请先填写 JD 再润色');
            return;
        }

        const toastId = showToastLoading(
            experiencePolishMode === 'default'
                ? '正在根据 JD 突出重点...'
                : '正在基于 JD 润色...'
        );
        let hasError = false;
        let applied = false;
        let requestedSmartCompletion = false;
        let action: 'applied' | 'discarded' = 'discarded';
        const startTime = Date.now();

        try {
            editingExperiencePolishRunningRef.current = true;
            setIsEditingExperiencePolishRunning(true);
            trackAiPolishStart({ source: 'resume_editor', field: 'all' });
            const draft = experience.editingDraft;
            const result = await aiService.polishExperienceStream({
                content: {
                    company: draft.company,
                    role: draft.title,
                    s: draft.star.s,
                    t: draft.star.t,
                    a: draft.star.a,
                    r: draft.star.r,
                },
                jdText: trimmedJd,
                mode: experiencePolishMode,
                customPrompt: experiencePolishMode === 'custom'
                    ? experienceCustomPrompt.trim()
                    : experiencePolishMode === 'smart_complete'
                        ? buildSmartCompletionCustomPrompt(
                            experienceSmartCompletionPrompt?.answer ?? '',
                            jdCapabilityPolishContext
                        )
                        : undefined,
                entrySource: 'resume_editor',
            }, (event) => {
                if (event.type !== 'thought') {
                    return;
                }
                const title = extractThoughtHeadline(event.summary);
                if (title) {
                    updateToast(toastId, { message: title, type: 'ai_thinking', duration: 0 });
                }
            });

            if (
                experiencePolishMode === 'smart_complete'
                && (
                    result.recommendedRewriteMode === 'ask_before_rewrite'
                    || result.recommendedRewriteMode === 'not_recommended_for_this_role'
                )
            ) {
                requestedSmartCompletion = true;
                setExperienceSmartCompletionPrompt((prev) => buildSmartCompletionPromptState(result, prev));
                return;
            }

            const normalizeField = (value?: string) => {
                if (!value) {
                    return undefined;
                }
                const normalized = normalizeAiRichText(value, { allowList: false });
                return normalized.trim() ? normalized : undefined;
            };

            const nextDraft: ExperienceEditDraft = {
                ...draft,
                star: {
                    s: normalizeField(result?.s) ?? draft.star.s,
                    t: normalizeField(result?.t) ?? draft.star.t,
                    a: normalizeField(result?.a) ?? draft.star.a,
                    r: normalizeField(result?.r) ?? draft.star.r,
                },
                starTouched: true,
            };

            const hasChange = (['s', 't', 'a', 'r'] as const).some((key) => nextDraft.star[key] !== draft.star[key]);
            if (hasChange) {
                experience.setEditingDraft(nextDraft);
                applied = true;
                action = 'applied';
                setExperienceSmartCompletionPrompt(null);
                pendingAiPolishApplyRef.current.add(draft.masterId);
            }
        } catch (error) {
            hasError = true;
            console.error('[ResumeEditor] 编辑态 AI 润色失败:', error);
        } finally {
            if (hasError) {
                updateToast(toastId, { message: 'JD 润色失败，请稍后重试', type: 'error', duration: 3000 });
            } else if (applied) {
                updateToast(toastId, { message: '已应用到当前编辑内容', type: 'success', duration: 2500 });
            } else if (requestedSmartCompletion) {
                updateToast(toastId, { message: '请在智能补全卡片内补充信息后再执行', type: 'success', duration: 2500 });
            } else {
                updateToast(toastId, { message: 'AI 已完成润色，但没有生成可用调整', type: 'success', duration: 2500 });
            }
            trackAiPolishResult({
                source: 'resume_editor',
                field: 'all',
                action,
                durationMs: Date.now() - startTime,
            });
            editingExperiencePolishRunningRef.current = false;
            setIsEditingExperiencePolishRunning(false);
        }
    }, [
        experience,
        experienceCustomPrompt,
        experiencePolishMode,
        experienceSmartCompletionPrompt,
        jdCapabilityPolishContext,
        jdPolishContext,
        showToastError,
        showToastLoading,
        updateToast,
    ]);

    const handleUndoEditingExperiencePolish = useCallback(() => {
        if (!experiencePolishPreview) {
            return;
        }
        experience.setEditingDraft((prev) => {
            if (!prev) {
                return prev;
            }
            return {
                ...prev,
                star: {
                    s: prev.star.s === experiencePolishPreview.after.star.s ? experiencePolishPreview.before.star.s : prev.star.s,
                    t: prev.star.t === experiencePolishPreview.after.star.t ? experiencePolishPreview.before.star.t : prev.star.t,
                    a: prev.star.a === experiencePolishPreview.after.star.a ? experiencePolishPreview.before.star.a : prev.star.a,
                    r: prev.star.r === experiencePolishPreview.after.star.r ? experiencePolishPreview.before.star.r : prev.star.r,
                },
                starTouched: prev.starTouched || experiencePolishPreview.before.starTouched,
            };
        });
        if (experience.editingDraft?.masterId && !experiencePolishPreview.hadPendingApplyBeforePreview) {
            pendingAiPolishApplyRef.current.delete(experience.editingDraft.masterId);
        }
        setExperiencePolishPreview(null);
        trackAiPolishUndone({ source: 'resume_editor', field: 'all' });
    }, [experience, experiencePolishPreview]);

    const handleConfirmEditingExperiencePolish = useCallback(() => {
        if (!experiencePolishPreview) {
            return;
        }
        setExperiencePolishPreview(null);
    }, [experiencePolishPreview]);

    const buildExperienceViewFromDraft = useCallback((
        baseItem: ResumeExperienceView,
        draft: ExperienceEditDraft
    ): ResumeExperienceView => {
        const safeDates = resolveSafeDateRange(
            draft.startDate,
            draft.isCurrent ? '' : draft.endDate
        );
        const nextIsCurrent = draft.isCurrent ?? isPresentLabel(draft.endDate);
        return {
            ...baseItem,
            title: draft.title.trim() || baseItem.title,
            company: draft.company.trim() || baseItem.company,
            startDate: safeDates.start,
            endDate: nextIsCurrent ? '' : safeDates.end,
            isCurrent: nextIsCurrent,
            date: buildExperienceDate(
                safeDates.start,
                nextIsCurrent ? '' : safeDates.end,
                nextIsCurrent
            ),
            star: {
                s: draft.star.s,
                t: draft.star.t,
                a: draft.star.a,
                r: draft.star.r,
            },
        };
    }, []);

    const buildFloatingPolishSessionItem = useCallback((
        baseItem: ResumeExperienceView,
        nextDraft: ExperienceEditDraft,
        beforeDraft?: ExperienceEditDraft
    ): FloatingExperiencePolishSessionItem | null => {
        const previousDraft = beforeDraft ?? buildExperienceEditDraft(baseItem);
        const nextItem = buildExperienceViewFromDraft(baseItem, nextDraft);
        const hasChange = (
            nextItem.title !== baseItem.title
            || nextItem.company !== baseItem.company
            || nextItem.startDate !== baseItem.startDate
            || nextItem.endDate !== baseItem.endDate
            || nextItem.isCurrent !== baseItem.isCurrent
            || nextItem.star.s !== baseItem.star.s
            || nextItem.star.t !== baseItem.star.t
            || nextItem.star.a !== baseItem.star.a
            || nextItem.star.r !== baseItem.star.r
        );
        if (!hasChange) {
            return null;
        }

        return {
            targetId: baseItem.id,
            beforeDraft: previousDraft,
            afterDraft: nextDraft,
            beforeItem: baseItem,
            afterItem: nextItem,
            wasSelected: selectedExpIds.has(baseItem.id),
        };
    }, [
        buildExperienceViewFromDraft,
        selectedExpIds,
    ]);

    const applyFloatingPolishSessionItems = useCallback((items: FloatingExperiencePolishSessionItem[]) => {
        if (!items.length) {
            return;
        }
        const nextItemMap = new Map(items.map((item) => [item.targetId, item.afterItem]));
        setExperienceItems((prev) =>
            prev.map((item) => nextItemMap.get(item.id) ?? item)
        );
        setSelectedExpIds((prev) => {
            const next = new Set(prev);
            items.forEach((item) => {
                next.add(item.targetId);
            });
            return next;
        });
    }, []);

    const restoreFloatingPolishSessionItems = useCallback((session: FloatingExperiencePolishSession) => {
        const previousItemMap = new Map(session.items.map((item) => [item.targetId, item.beforeItem]));
        setExperienceItems((prev) =>
            prev.map((item) => previousItemMap.get(item.id) ?? item)
        );
        setSelectedExpIds((prev) => {
            const next = new Set(prev);
            session.items.forEach((item) => {
                if (item.wasSelected) {
                    next.add(item.targetId);
                } else {
                    next.delete(item.targetId);
                }
            });
            return next;
        });
    }, []);

    const applyFloatingPolishPreview = useCallback((
        mode: FloatingExperiencePolishSession['mode'],
        items: FloatingExperiencePolishSessionItem[],
        failedIds: string[] = []
    ) => {
        if (!items.length) {
            return false;
        }
        applyFloatingPolishSessionItems(items);
        setFloatingPolishSession({ mode, items, failedIds });
        if (mode === 'single') {
            setActiveFloatingPolishExperienceId(items[0]?.targetId ?? null);
            setIsBatchPolishToolbarOpen(false);
        } else {
            setActiveFloatingPolishExperienceId(null);
            setIsBatchPolishToolbarOpen(true);
        }
        return true;
    }, [applyFloatingPolishSessionItems]);

    const handleCloseFloatingPolishToolbar = useCallback(() => {
        if (isFloatingExperiencePolishRunning) {
            showToastError('请等待当前润色完成后再继续操作');
            return;
        }
        setFloatingSmartCompletionPrompt(null);
        if (floatingPolishSession?.mode === 'single') {
            restoreFloatingPolishSessionItems(floatingPolishSession);
            setFloatingPolishSession(null);
            setActiveFloatingPolishExperienceId(null);
            return;
        }
        setActiveFloatingPolishExperienceId(null);
    }, [floatingPolishSession, isFloatingExperiencePolishRunning, restoreFloatingPolishSessionItems, showToastError]);

    const handleDismissFloatingPolishToolbar = useCallback(() => {
        if (isFloatingExperiencePolishRunning) {
            showToastError('请等待当前润色完成后再继续操作');
            return;
        }
        if (floatingPolishSession?.mode === 'single') {
            showToastError('请先确认或撤销当前润色结果');
            return;
        }
        setFloatingSmartCompletionPrompt(null);
        setActiveFloatingPolishExperienceId(null);
    }, [floatingPolishSession, isFloatingExperiencePolishRunning, showToastError]);

    const handleCloseBatchPolishToolbar = useCallback(() => {
        if (isFloatingExperiencePolishRunning) {
            showToastError('请等待当前润色完成后再继续操作');
            return;
        }
        setFloatingSmartCompletionPrompt(null);
        if (floatingPolishSession?.mode === 'batch') {
            restoreFloatingPolishSessionItems(floatingPolishSession);
            setFloatingPolishSession(null);
        }
        setIsBatchPolishToolbarOpen(false);
    }, [floatingPolishSession, isFloatingExperiencePolishRunning, restoreFloatingPolishSessionItems, showToastError]);

    const handleDismissBatchPolishToolbar = useCallback(() => {
        if (isFloatingExperiencePolishRunning) {
            showToastError('请等待当前润色完成后再继续操作');
            return;
        }
        if (floatingPolishSession?.mode === 'batch') {
            showToastError('请先确认或撤销当前批量润色结果');
            return;
        }
        setFloatingSmartCompletionPrompt(null);
        setIsBatchPolishToolbarOpen(false);
    }, [floatingPolishSession, isFloatingExperiencePolishRunning, showToastError]);

    const handlePolishExperienceFromCard = useCallback((id: string) => {
        if (isFloatingExperiencePolishRunning) {
            showToastError('请等待当前润色完成后再继续操作');
            return;
        }
        if (floatingPolishSession) {
            const isSameSingleTarget = floatingPolishSession.mode === 'single'
                && floatingPolishSession.items[0]?.targetId === id;
            if (!isSameSingleTarget) {
                showToastError('请先确认或撤销当前润色结果');
                return;
            }
        }
        if (isBatchPolishToolbarOpen) {
            showToastError('请先关闭当前批量润色弹窗');
            return;
        }
        setSidebarTab('experience');
        setFloatingSmartCompletionPrompt(null);
        setActiveFloatingPolishExperienceId((prev) => (
            prev === id && !singleFloatingPolishPreview ? null : id
        ));
    }, [
        floatingPolishSession,
        isBatchPolishToolbarOpen,
        isFloatingExperiencePolishRunning,
        showToastError,
        singleFloatingPolishPreview,
    ]);

    const handleRunFloatingExperiencePolish = useCallback(async () => {
        if (!activeFloatingPolishExperienceId || floatingExperiencePolishRunningRef.current) {
            return;
        }
        const targetItem = experienceItems.find((item) => item.id === activeFloatingPolishExperienceId);
        if (!targetItem) {
            return;
        }

        const trimmedJd = jdPolishContext.trim();
        if (!trimmedJd) {
            showToastError('请先填写 JD 再润色');
            return;
        }

        const draft = buildExperienceEditDraft(targetItem);
        const toastId = showToastLoading('正在为简历预览生成润色结果...');
        let hasError = false;
        let applied = false;
        let requestedSmartCompletion = false;
        let action: 'applied' | 'discarded' = 'discarded';
        const startTime = Date.now();

        try {
            floatingExperiencePolishRunningRef.current = true;
            setIsFloatingExperiencePolishRunning(true);
            trackAiPolishStart({ source: 'resume_editor', field: 'all' });
            const result = await aiService.polishExperienceStream({
                content: {
                    company: draft.company,
                    role: draft.title,
                    s: draft.star.s,
                    t: draft.star.t,
                    a: draft.star.a,
                    r: draft.star.r,
                },
                jdText: trimmedJd,
                mode: floatingPolishMode,
                customPrompt: floatingPolishMode === 'custom'
                    ? floatingPolishCustomPrompt.trim()
                    : floatingPolishMode === 'smart_complete'
                        ? buildSmartCompletionCustomPrompt(
                            floatingSmartCompletionPrompt?.answer ?? '',
                            jdCapabilityPolishContext
                        )
                        : undefined,
                entrySource: 'resume_editor',
            }, (event) => {
                if (event.type !== 'thought') {
                    return;
                }
                const title = extractThoughtHeadline(event.summary);
                if (title) {
                    updateToast(toastId, { message: title, type: 'ai_thinking', duration: 0 });
                }
            });

            if (
                floatingPolishMode === 'smart_complete'
                && (
                    result.recommendedRewriteMode === 'ask_before_rewrite'
                    || result.recommendedRewriteMode === 'not_recommended_for_this_role'
                )
            ) {
                requestedSmartCompletion = true;
                setFloatingSmartCompletionPrompt((prev) => buildSmartCompletionPromptState(result, prev));
                return;
            }

            const normalizeField = (value?: string) => {
                if (!value) {
                    return undefined;
                }
                const normalized = normalizeAiRichText(value, { allowList: false });
                return normalized.trim() ? normalized : undefined;
            };

            const nextDraft: ExperienceEditDraft = {
                ...draft,
                star: {
                    s: normalizeField(result?.s) ?? draft.star.s,
                    t: normalizeField(result?.t) ?? draft.star.t,
                    a: normalizeField(result?.a) ?? draft.star.a,
                    r: normalizeField(result?.r) ?? draft.star.r,
                },
                starTouched: true,
            };
            const sessionItem = buildFloatingPolishSessionItem(targetItem, nextDraft, draft);
            applied = sessionItem ? applyFloatingPolishPreview('single', [sessionItem]) : false;
            if (applied) {
                action = 'applied';
                setFloatingSmartCompletionPrompt(null);
            }
        } catch (error) {
            hasError = true;
            console.error('[ResumeEditor] 浮动润色预览失败:', error);
        } finally {
            if (hasError) {
                updateToast(toastId, { message: 'AI 润色失败，请稍后重试', type: 'error', duration: 3000 });
            } else if (applied) {
                updateToast(toastId, { message: '已同步到简历预览，请确认或撤销', type: 'success', duration: 2500 });
            } else if (requestedSmartCompletion) {
                updateToast(toastId, { message: '请在智能补全卡片内补充信息后再执行', type: 'success', duration: 2500 });
            } else {
                updateToast(toastId, { message: 'AI 已完成润色，但没有生成可用调整', type: 'success', duration: 2500 });
            }
            trackAiPolishResult({
                source: 'resume_editor',
                field: 'all',
                action,
                durationMs: Date.now() - startTime,
            });
            floatingExperiencePolishRunningRef.current = false;
            setIsFloatingExperiencePolishRunning(false);
        }
    }, [
        activeFloatingPolishExperienceId,
        applyFloatingPolishPreview,
        buildFloatingPolishSessionItem,
        experienceItems,
        floatingPolishCustomPrompt,
        floatingPolishMode,
        floatingSmartCompletionPrompt,
        jdCapabilityPolishContext,
        jdPolishContext,
        showToastError,
        showToastLoading,
        updateToast,
    ]);

    const handleUndoFloatingExperiencePolish = useCallback(() => {
        if (!singleFloatingPolishPreview || !floatingPolishSession || floatingPolishSession.mode !== 'single') {
            return;
        }
        restoreFloatingPolishSessionItems(floatingPolishSession);
        setFloatingPolishSession(null);
        setActiveFloatingPolishExperienceId(null);
        trackAiPolishUndone({ source: 'resume_editor', field: 'all' });
    }, [floatingPolishSession, restoreFloatingPolishSessionItems, singleFloatingPolishPreview]);

    const ensureFloatingPolishResumeLink = useCallback(async (
        masterId: string,
        versionId?: string
    ) => {
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
        const nextMap = buildResumeExperienceMap(detail);
        applyResumeDetail(detail);
        setResumeExperienceMap(nextMap);
        return nextMap.get(masterId)?.id ?? null;
    }, [applyResumeDetail, resumeExperienceMap, resumeId, setResumeExperienceMap]);

    const ensureFloatingPolishResumeLinks = useCallback(async (
        sessionItems: FloatingExperiencePolishSessionItem[]
    ) => {
        if (!resumeId) {
            throw new Error('当前简历不存在');
        }
        const pendingAddMap = new Map<string, string>();
        sessionItems.forEach((item) => {
            if (resumeExperienceMap.get(item.targetId)?.id) {
                return;
            }
            const versionId = item.afterItem.experienceVersionId;
            if (versionId) {
                pendingAddMap.set(item.targetId, versionId);
            }
        });
        if (!pendingAddMap.size) {
            return {
                nextMap: resumeExperienceMap,
                addedLinkIds: [] as string[],
            };
        }

        const detail = await resumeService.updateAssembly(resumeId, {
            operations: Array.from(pendingAddMap.values()).map((versionId) => ({
                op: 'add',
                experience_version_id: versionId,
            })),
        });
        const nextMap = buildResumeExperienceMap(detail);
        const addedLinkIds = Array.from(pendingAddMap.keys())
            .map((targetId) => nextMap.get(targetId)?.id ?? null)
            .filter((linkId): linkId is string => Boolean(linkId));
        applyResumeDetail(detail);
        setResumeExperienceMap(nextMap);
        return {
            nextMap,
            addedLinkIds,
        };
    }, [applyResumeDetail, resumeExperienceMap, resumeId, setResumeExperienceMap]);

    const rollbackFloatingPolishResumeLinks = useCallback(async (linkIds: string[]) => {
        if (!resumeId || !linkIds.length) {
            return;
        }
        const detail = await resumeService.updateAssembly(resumeId, {
            operations: linkIds.map((linkId) => ({
                op: 'remove',
                resume_experience_id: linkId,
            })),
        });
        const nextMap = buildResumeExperienceMap(detail);
        applyResumeDetail(detail);
        setResumeExperienceMap(nextMap);
    }, [applyResumeDetail, resumeId, setResumeExperienceMap]);

    const buildExperiencePolishOverrideOperation = useCallback((
        sessionItem: FloatingExperiencePolishSessionItem,
        linkMap: Map<string, ResumeExperienceItem> = resumeExperienceMap
    ) => {
        const targetId = sessionItem.targetId;
        const currentItem = sessionItem.afterItem;
        const draft = sessionItem.afterDraft;
        const resumeItem = linkMap.get(targetId);
        const hasStarOverride = Boolean(
            resumeItem?.overrides_json
            && Object.prototype.hasOwnProperty.call(resumeItem.overrides_json, 'star')
        );
        const sourceStar = experienceSourceMap.get(targetId)?.latest_version?.star;
        const resolvedStar = (
            draft.starTouched || hasStarOverride
                ? draft.star
                : mergeStarFieldsWithSource(draft.star, sourceStar)
        );
        const linkId = resumeItem?.id;
        if (!linkId) {
            throw new Error('无法创建简历经历关联');
        }

        const dates = resolveExperienceDatePayload(draft, {
            start_date: currentItem.startDate,
            end_date: currentItem.endDate,
            is_current: currentItem.isCurrent,
        });
        const overrides: Record<string, unknown> = {
            star: resolvedStar,
            is_current: dates.isCurrent,
        };
        if (dates.startDate) {
            overrides.start_date = dates.startDate;
        }
        if (dates.endDate) {
            overrides.end_date = dates.endDate;
        }
        const title = draft.title.trim();
        const org = draft.company.trim();
        if (title) {
            overrides.title = title;
        }
        if (org) {
            overrides.org = org;
        }

        return {
            op: 'override',
            resume_experience_id: linkId,
            overrides_json: overrides,
        };
    }, [
        experienceSourceMap,
        mergeStarFieldsWithSource,
        resolveExperienceDatePayload,
        resumeExperienceMap,
    ]);

    const handleConfirmFloatingExperiencePolish = useCallback(async () => {
        if (!singleFloatingPolishPreview || floatingExperiencePolishRunningRef.current || !resumeId) {
            return;
        }

        const toastId = showToastLoading('正在保存润色结果...');
        let addedLinkIds: string[] = [];
        try {
            floatingExperiencePolishRunningRef.current = true;
            setIsFloatingExperiencePolishRunning(true);
            const targetId = singleFloatingPolishPreview.targetId;
            const { nextMap: workingResumeMap, addedLinkIds: createdLinkIds } = await ensureFloatingPolishResumeLinks([
                singleFloatingPolishPreview,
            ]);
            addedLinkIds = createdLinkIds;
            const operation = buildExperiencePolishOverrideOperation(singleFloatingPolishPreview, workingResumeMap);
            const detail = await resumeService.updateAssembly(resumeId, {
                operations: [operation],
            });
            const nextMap = buildResumeExperienceMap(detail);
            applyResumeDetail(detail);
            setResumeExperienceMap(nextMap);
            setSelectedExpIds((prev) => {
                const next = new Set(prev);
                next.add(targetId);
                return next;
            });
            setFloatingPolishSession(null);
            setActiveFloatingPolishExperienceId(null);
            setPendingPolishAutoAnalyzeSeq((current) => current + 1);
            trackAiPolishApplied({ source: 'resume_editor', field: 'all' });
            updateToast(toastId, { message: '润色结果已保存到当前简历', type: 'success', duration: 2500 });
        } catch (error) {
            console.error('[ResumeEditor] 保存浮动润色结果失败:', error);
            if (addedLinkIds.length > 0) {
                try {
                    await rollbackFloatingPolishResumeLinks(addedLinkIds);
                } catch (rollbackError) {
                    console.error('[ResumeEditor] 回滚浮动润色关联失败:', rollbackError);
                }
            }
            updateToast(toastId, { message: '保存润色结果失败，请稍后重试', type: 'error', duration: 3000 });
        } finally {
            floatingExperiencePolishRunningRef.current = false;
            setIsFloatingExperiencePolishRunning(false);
        }
    }, [
        applyResumeDetail,
        buildExperiencePolishOverrideOperation,
        ensureFloatingPolishResumeLinks,
        resumeId,
        rollbackFloatingPolishResumeLinks,
        setPendingPolishAutoAnalyzeSeq,
        setResumeExperienceMap,
        showToastLoading,
        singleFloatingPolishPreview,
        updateToast,
    ]);

    const handleOpenBatchPolishToolbar = useCallback(() => {
        if (isFloatingExperiencePolishRunning) {
            showToastError('请等待当前润色完成后再继续操作');
            return;
        }
        if (floatingPolishSession) {
            showToastError('请先确认或撤销当前润色结果');
            return;
        }
        if (activeFloatingPolishExperienceId) {
            showToastError('请先关闭当前润色工具栏');
            return;
        }
        setSidebarTab('experience');
        setFloatingSmartCompletionPrompt(null);
        if (floatingPolishMode === 'smart_complete') {
            setFloatingPolishMode(DEFAULT_RESUME_POLISH_MODE);
        }
        setIsBatchPolishToolbarOpen(true);
    }, [
        activeFloatingPolishExperienceId,
        floatingPolishSession,
        floatingPolishMode,
        isFloatingExperiencePolishRunning,
        showToastError,
    ]);

    const handleRunBatchExperiencePolish = useCallback(async () => {
        if (floatingExperiencePolishRunningRef.current) {
            return;
        }
        const trimmedJd = jdPolishContext.trim();
        if (!trimmedJd) {
            showToastError('请先填写 JD 再润色');
            return;
        }
        if (floatingPolishMode === 'smart_complete') {
            setFloatingPolishMode(DEFAULT_RESUME_POLISH_MODE);
            setFloatingSmartCompletionPrompt(null);
            showToastError('批量润色暂不支持智能补全，请使用单条经历补充事实');
            return;
        }
        const targetItems = experienceItems.filter((item) => selectedExpIds.has(item.id));
        if (!targetItems.length) {
            showToastError('请先至少选中一条经历');
            return;
        }

        const toastId = showToastLoading('正在批量润色中……');
        let hasError = false;
        let action: 'applied' | 'discarded' = 'discarded';
        const startTime = Date.now();

        try {
            floatingExperiencePolishRunningRef.current = true;
            setIsFloatingExperiencePolishRunning(true);
            trackAiPolishStart({ source: 'resume_editor', field: 'all' });

            const normalizeField = (value?: string) => {
                if (!value) {
                    return undefined;
                }
                const normalized = normalizeAiRichText(value, { allowList: false });
                return normalized.trim() ? normalized : undefined;
            };

            const results = await Promise.allSettled(targetItems.map(async (item) => {
                const draft = buildExperienceEditDraft(item);
                const result = await aiService.polishExperienceStream({
                    content: {
                        company: draft.company,
                        role: draft.title,
                        s: draft.star.s,
                        t: draft.star.t,
                        a: draft.star.a,
                        r: draft.star.r,
                    },
                    jdText: trimmedJd,
                    mode: floatingPolishMode,
                    customPrompt: floatingPolishMode === 'custom' ? floatingPolishCustomPrompt.trim() : undefined,
                    entrySource: 'resume_editor',
                });

                const nextDraft: ExperienceEditDraft = {
                    ...draft,
                    star: {
                        s: normalizeField(result?.s) ?? draft.star.s,
                        t: normalizeField(result?.t) ?? draft.star.t,
                        a: normalizeField(result?.a) ?? draft.star.a,
                        r: normalizeField(result?.r) ?? draft.star.r,
                    },
                    starTouched: true,
                };
                return buildFloatingPolishSessionItem(item, nextDraft, draft);
            }));

            const sessionItems: FloatingExperiencePolishSessionItem[] = [];
            const failedIds: string[] = [];
            const unchangedIds: string[] = [];

            results.forEach((result, index) => {
                const targetId = targetItems[index]?.id;
                if (!targetId) {
                    return;
                }
                if (result.status === 'fulfilled') {
                    if (result.value) {
                        sessionItems.push(result.value);
                    } else {
                        unchangedIds.push(targetId);
                    }
                    return;
                }
                failedIds.push(targetId);
            });

            if (sessionItems.length > 0) {
                applyFloatingPolishPreview('batch', sessionItems, failedIds);
                action = 'applied';
                updateToast(toastId, {
                    message: failedIds.length > 0
                        ? `已完成 ${sessionItems.length} 条，${failedIds.length} 条失败，请确认可用结果`
                        : '批量润色完成，请确认是否保存',
                    type: 'success',
                    duration: 2500,
                });
            } else if (unchangedIds.length > 0 && failedIds.length === 0) {
                updateToast(toastId, {
                    message: 'AI 已完成批量润色，但没有生成可用调整',
                    type: 'success',
                    duration: 2500,
                });
            } else {
                hasError = true;
                updateToast(toastId, {
                    message: '批量润色失败，请稍后重试',
                    type: 'error',
                    duration: 3000,
                });
            }
        } catch (error) {
            hasError = true;
            console.error('[ResumeEditor] 批量润色失败:', error);
            updateToast(toastId, {
                message: '批量润色失败，请稍后重试',
                type: 'error',
                duration: 3000,
            });
        } finally {
            if (!hasError) {
                trackAiPolishResult({
                    source: 'resume_editor',
                    field: 'all',
                    action,
                    durationMs: Date.now() - startTime,
                });
            } else {
                trackAiPolishResult({
                    source: 'resume_editor',
                    field: 'all',
                    action: 'discarded',
                    durationMs: Date.now() - startTime,
                });
            }
            floatingExperiencePolishRunningRef.current = false;
            setIsFloatingExperiencePolishRunning(false);
        }
    }, [
        applyFloatingPolishPreview,
        buildFloatingPolishSessionItem,
        experienceItems,
        floatingPolishCustomPrompt,
        floatingPolishMode,
        jdPolishContext,
        selectedExpIds,
        showToastError,
        showToastLoading,
        updateToast,
    ]);

    const handleUndoBatchExperiencePolish = useCallback(() => {
        if (!batchFloatingPolishPreview) {
            return;
        }
        restoreFloatingPolishSessionItems(batchFloatingPolishPreview);
        setFloatingPolishSession(null);
        setIsBatchPolishToolbarOpen(false);
        trackAiPolishUndone({ source: 'resume_editor', field: 'all' });
    }, [batchFloatingPolishPreview, restoreFloatingPolishSessionItems]);

    const handleConfirmBatchExperiencePolish = useCallback(async () => {
        if (!batchFloatingPolishPreview || floatingExperiencePolishRunningRef.current || !resumeId) {
            return;
        }

        const toastId = showToastLoading('正在保存批量润色结果...');
        let addedLinkIds: string[] = [];
        try {
            floatingExperiencePolishRunningRef.current = true;
            setIsFloatingExperiencePolishRunning(true);
            const { nextMap: workingResumeMap, addedLinkIds: createdLinkIds } = await ensureFloatingPolishResumeLinks(
                batchFloatingPolishPreview.items
            );
            addedLinkIds = createdLinkIds;
            const operations = [];
            for (const item of batchFloatingPolishPreview.items) {
                operations.push(buildExperiencePolishOverrideOperation(item, workingResumeMap));
            }
            const detail = await resumeService.updateAssembly(resumeId, { operations });
            const nextMap = buildResumeExperienceMap(detail);
            applyResumeDetail(detail);
            setResumeExperienceMap(nextMap);
            setFloatingPolishSession(null);
            setIsBatchPolishToolbarOpen(false);
            setPendingPolishAutoAnalyzeSeq((current) => current + 1);
            trackAiPolishApplied({ source: 'resume_editor', field: 'all' });
            updateToast(toastId, {
                message: batchFloatingPolishPreview.failedIds.length > 0
                    ? `批量润色已保存 ${batchFloatingPolishPreview.items.length} 条可用结果`
                    : '批量润色结果已保存到当前简历',
                type: 'success',
                duration: 2500,
            });
        } catch (error) {
            console.error('[ResumeEditor] 保存批量润色结果失败:', error);
            if (addedLinkIds.length > 0) {
                try {
                    await rollbackFloatingPolishResumeLinks(addedLinkIds);
                } catch (rollbackError) {
                    console.error('[ResumeEditor] 回滚批量润色关联失败:', rollbackError);
                }
            }
            updateToast(toastId, { message: '保存批量润色结果失败，请稍后重试', type: 'error', duration: 3000 });
        } finally {
            floatingExperiencePolishRunningRef.current = false;
            setIsFloatingExperiencePolishRunning(false);
        }
    }, [
        applyResumeDetail,
        batchFloatingPolishPreview,
        buildExperiencePolishOverrideOperation,
        ensureFloatingPolishResumeLinks,
        resumeId,
        rollbackFloatingPolishResumeLinks,
        setPendingPolishAutoAnalyzeSeq,
        setResumeExperienceMap,
        showToastLoading,
        updateToast,
    ]);

    const handleOpenExperienceAssistant = useCallback(() => {
        if (!experience.editingDraft || !onLaunchAssistant) {
            return;
        }
        const draft = experience.editingDraft;
        onLaunchAssistant({
            context: {
                mode: 'experience',
                entrySource: 'resume_editor',
                title: `${draft.company || '未命名经历'} · 智能补全`,
                contextJson: {
                    resumeId,
                    masterId: draft.masterId,
                    category: draft.category,
                    company: draft.company,
                    title: draft.title,
                    startDate: draft.startDate,
                    endDate: draft.endDate,
                    isCurrent: draft.isCurrent,
                    star: draft.star,
                    jdText: jdPolishContext,
                },
            },
            initialSkillId: 'experience_completion',
            initialUserMessage: buildSmartCompleteAssistantPrompt({
                jdText: jdPolishContext,
                org: draft.company,
                title: draft.title,
                startDate: draft.startDate,
                endDate: draft.endDate,
                isCurrent: draft.isCurrent,
                star: draft.star,
            }),
            applyDraftHandler: async (draftCard, meta) => {
                const normalizedDraftCard = normalizeAssistantDraftCard(draftCard);
                if (normalizedDraftCard.type !== 'experience') {
                    return false;
                }
                pendingAssistantApplyRef.current.set(draft.masterId, meta.persistApplied);
                trackedPendingAssistantApplyRef.current.delete(draft.masterId);
                experience.setEditingDraft((prev) => {
                    if (!prev) {
                        return prev;
                    }
                    return {
                        ...prev,
                        company: normalizedDraftCard.data.org,
                        title: normalizedDraftCard.data.title,
                        startDate: normalizedDraftCard.data.startDate || '',
                        endDate: normalizedDraftCard.data.isCurrent ? '' : (normalizedDraftCard.data.endDate || ''),
                        isCurrent: Boolean(normalizedDraftCard.data.isCurrent),
                        star: {
                            s: normalizedDraftCard.data.star.s,
                            t: normalizedDraftCard.data.star.t,
                            a: normalizedDraftCard.data.star.a,
                            r: normalizedDraftCard.data.star.r,
                        },
                        starTouched: true,
                    };
                });
                setExperiencePolishPreview(null);
                return true;
            },
            callbackOnly: true,
        });
    }, [experience, jdPolishContext, onLaunchAssistant, resumeId]);

    const handleOpenFloatingExperienceAssistant = useCallback(() => {
        if (!activeFloatingPolishExperienceId || !onLaunchAssistant) {
            return;
        }
        const currentItem = experienceItems.find((item) => item.id === activeFloatingPolishExperienceId);
        if (!currentItem) {
            return;
        }
        const draft = buildExperienceEditDraft(currentItem);
        onLaunchAssistant({
            context: {
                mode: 'experience',
                entrySource: 'resume_editor',
                title: `${draft.company || '未命名经历'} · 智能补全`,
                contextJson: {
                    resumeId,
                    masterId: draft.masterId,
                    category: draft.category,
                    company: draft.company,
                    title: draft.title,
                    startDate: draft.startDate,
                    endDate: draft.endDate,
                    isCurrent: draft.isCurrent,
                    star: draft.star,
                    jdText: jdPolishContext,
                },
            },
            initialSkillId: 'experience_completion',
            initialUserMessage: buildSmartCompleteAssistantPrompt({
                jdText: jdPolishContext,
                org: draft.company,
                title: draft.title,
                startDate: draft.startDate,
                endDate: draft.endDate,
                isCurrent: draft.isCurrent,
                star: draft.star,
            }),
            applyDraftHandler: async (draftCard) => {
                const normalizedDraftCard = normalizeAssistantDraftCard(draftCard);
                if (normalizedDraftCard.type !== 'experience') {
                    return false;
                }
                const nextDraft: ExperienceEditDraft = {
                    ...draft,
                    company: normalizedDraftCard.data.org,
                    title: normalizedDraftCard.data.title,
                    startDate: normalizedDraftCard.data.startDate || '',
                    endDate: normalizedDraftCard.data.isCurrent ? '' : (normalizedDraftCard.data.endDate || ''),
                    isCurrent: Boolean(normalizedDraftCard.data.isCurrent),
                    star: {
                        s: normalizedDraftCard.data.star.s,
                        t: normalizedDraftCard.data.star.t,
                        a: normalizedDraftCard.data.star.a,
                        r: normalizedDraftCard.data.star.r,
                    },
                    starTouched: true,
                };
                if (!activeFloatingPolishExperienceId) {
                    return false;
                }
                const currentItem = experienceItems.find((item) => item.id === activeFloatingPolishExperienceId);
                if (!currentItem) {
                    return false;
                }
                const sessionItem = buildFloatingPolishSessionItem(currentItem, nextDraft, draft);
                return sessionItem ? applyFloatingPolishPreview('single', [sessionItem]) : false;
            },
            callbackOnly: true,
        });
    }, [
        activeFloatingPolishExperienceId,
        applyFloatingPolishPreview,
        buildFloatingPolishSessionItem,
        experienceItems,
        jdPolishContext,
        onLaunchAssistant,
        resumeId,
    ]);

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
        if (pendingPolishAutoAnalyzeSeq <= 0) {
            return;
        }
        if (lastPolishAutoAnalyzeSeqRef.current === pendingPolishAutoAnalyzeSeq) {
            return;
        }
        lastPolishAutoAnalyzeSeqRef.current = pendingPolishAutoAnalyzeSeq;
        void runJdAnalyzeWithToast();
    }, [pendingPolishAutoAnalyzeSeq, runJdAnalyzeWithToast]);
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
    const waitForPreviewUpdate = useCallback((frames = 1) => new Promise<void>((resolve) => {
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
    }), []);
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
        setMeasureLayout(defaultLayout);
        setIsSmartPageApplied(isApplied);
    };
    const applyVisibleLayout = (nextLayout: SmartPageLayout) => {
        setTopPaddingPx(nextLayout.topPaddingPx);
        setSectionSpacingKey(nextLayout.sectionSpacingKey);
        setItemSpacingEm(nextLayout.itemSpacingEm);
        setLineHeight(nextLayout.lineHeight);
        setFontSize(nextLayout.fontSize);
        setMeasureLayout(nextLayout);
    };
    const applyLayoutSnapshot = async (snapshot: LayoutSnapshot) => {
        applyVisibleLayout(snapshot);
        setIsSmartPageApplied(snapshot.isSmartPageApplied);
        await waitForPreviewUpdate(2);
    };
    const measureContentLayout = () => measureResumeLayout(
        measurePreviewRef.current,
        measurePreviewContentRef.current
    );
    const applyMeasureLayoutAndMeasure = async (nextLayout: SmartPageLayout) => {
        setMeasureLayout(nextLayout);
        await waitForPreviewUpdate(2);
        return measureContentLayout();
    };

    const tryMeasureLayout = async (
        a4Height: number,
        nextLayout: SmartPageLayout
    ): Promise<SmartPageResult> => {
        const measurement = await applyMeasureLayoutAndMeasure(nextLayout);
        if (measurement?.fits) {
            return nextLayout;
        }
        return null;
    };

    const resolveNearestStepIndex = (steps: number[], value: number) => steps.reduce(
        (nearestIndex, step, index) => (
            Math.abs(step - value) < Math.abs(steps[nearestIndex] - value)
                ? index
                : nearestIndex
        ),
        0
    );

    const resolveStepByOffset = (steps: number[], value: number, offset: number) => {
        const baseIndex = resolveNearestStepIndex(steps, value);
        const nextIndex = Math.min(Math.max(baseIndex + offset, 0), steps.length - 1);
        return steps[nextIndex];
    };

    const resolveLayoutScore = (
        layout: SmartPageLayout,
        defaultLayout: SmartPageLayout,
        topPaddingSteps: number[],
        itemSpacingSteps: number[],
        mode: 'shrink' | 'expand'
    ) => {
        const topPaddingMinPx = Math.min(...topPaddingSteps);
        const topPaddingMaxPx = Math.max(...topPaddingSteps);
        const itemSpacingMinEm = Math.min(...itemSpacingSteps);
        const itemSpacingMaxEm = Math.max(...itemSpacingSteps);
        const minSectionSpacingKey = SECTION_SPACING_KEYS[SECTION_SPACING_KEYS.length - 1];
        const maxSectionSpacingKey = SECTION_SPACING_KEYS[0];
        const defaultSectionIndex = resolveNearestStepIndex(
            SECTION_SPACING_KEYS,
            defaultLayout.sectionSpacingKey
        );
        const currentSectionIndex = resolveNearestStepIndex(
            SECTION_SPACING_KEYS,
            layout.sectionSpacingKey
        );
        const fontSizeDelta = Math.abs(layout.fontSize - defaultLayout.fontSize) / FONT_SIZE_STEP;
        const lineHeightDelta = Math.abs(layout.lineHeight - defaultLayout.lineHeight) / LINE_HEIGHT_STEP;
        const topPaddingDelta = Math.abs(layout.topPaddingPx - defaultLayout.topPaddingPx)
            / SMART_PAGE_TOP_PADDING_STEP_PX;
        const itemSpacingDelta = Math.abs(layout.itemSpacingEm - defaultLayout.itemSpacingEm)
            / SMART_PAGE_ITEM_SPACING_STEP;
        const sectionSpacingDelta = Math.abs(currentSectionIndex - defaultSectionIndex);

        const weightedDelta = (
            (fontSizeDelta * 5)
            + (lineHeightDelta * 3)
            + (sectionSpacingDelta * 2)
            + (topPaddingDelta * 2)
            + (itemSpacingDelta * 1.5)
        );

        let penalty = mode === 'shrink' ? weightedDelta : 0;

        if (mode === 'shrink' && Math.abs(layout.fontSize - FONT_SIZE_MIN) < 0.001) {
            if (layout.sectionSpacingKey !== minSectionSpacingKey) {
                penalty += 6;
            }
            if (layout.topPaddingPx - topPaddingMinPx > 0.001) {
                penalty += 6;
            }
        }

        if (mode === 'expand' && Math.abs(layout.fontSize - FONT_SIZE_MAX) < 0.001) {
            if (layout.sectionSpacingKey !== maxSectionSpacingKey) {
                penalty += 6;
            }
            if (topPaddingMaxPx - layout.topPaddingPx > 0.001) {
                penalty += 6;
            }
        }

        const resolveAdjustmentRatio = (
            value: number,
            baselineValue: number,
            minValue: number,
            maxValue: number
        ) => {
            const denominator = mode === 'shrink'
                ? baselineValue - minValue
                : maxValue - baselineValue;
            if (Math.abs(denominator) < 0.001) {
                return 0;
            }
            return mode === 'shrink'
                ? Math.max(0, Math.min(1, (baselineValue - value) / denominator))
                : Math.max(0, Math.min(1, (value - baselineValue) / denominator));
        };

        const sectionAdjustmentRatio = mode === 'shrink'
            ? defaultSectionIndex >= SECTION_SPACING_KEYS.length - 1
                ? 0
                : Math.max(
                    0,
                    Math.min(
                        1,
                        (currentSectionIndex - defaultSectionIndex)
                        / ((SECTION_SPACING_KEYS.length - 1) - defaultSectionIndex)
                    )
                )
            : defaultSectionIndex <= 0
                ? 0
                : Math.max(
                    0,
                    Math.min(1, (defaultSectionIndex - currentSectionIndex) / defaultSectionIndex)
                );

        const ratios = [
            resolveAdjustmentRatio(layout.fontSize, defaultLayout.fontSize, FONT_SIZE_MIN, FONT_SIZE_MAX),
            resolveAdjustmentRatio(layout.lineHeight, defaultLayout.lineHeight, LINE_HEIGHT_MIN, LINE_HEIGHT_MAX),
            sectionAdjustmentRatio,
            resolveAdjustmentRatio(
                layout.topPaddingPx,
                defaultLayout.topPaddingPx,
                topPaddingMinPx,
                topPaddingMaxPx
            ),
            resolveAdjustmentRatio(
                layout.itemSpacingEm,
                defaultLayout.itemSpacingEm,
                itemSpacingMinEm,
                itemSpacingMaxEm
            ),
        ];
        const averageRatio = ratios.reduce((sum, ratio) => sum + ratio, 0) / ratios.length;
        penalty += ratios.reduce(
            (sum, ratio) => sum + Math.abs(ratio - averageRatio),
            0
        ) * 2;

        const maxRatio = Math.max(...ratios);
        const minRatio = Math.min(...ratios);
        if (maxRatio - minRatio > 0.35) {
            penalty += (maxRatio - minRatio - 0.35) * 8;
        }

        return mode === 'shrink'
            ? 100 - penalty
            : weightedDelta - penalty;
    };

    const findBestFitWithinStage = async (
        a4Height: number,
        targetLayout: SmartPageLayout,
        defaultLayout: SmartPageLayout,
        topPaddingSteps: number[],
        itemSpacingSteps: number[],
        mode: 'shrink' | 'expand',
        fontSizeSteps: number[],
        lineHeightSteps: number[]
    ): Promise<SmartPageResult> => {
        const fontStartIndex = resolveNearestStepIndex(fontSizeSteps, targetLayout.fontSize);
        const lineHeightStartIndex = resolveNearestStepIndex(lineHeightSteps, targetLayout.lineHeight);
        let bestFitLayout: SmartPageResult = null;
        let bestFitScore = Number.NEGATIVE_INFINITY;

        if (mode === 'shrink') {
            for (let fontIndex = fontStartIndex; fontIndex < fontSizeSteps.length; fontIndex += 1) {
                const relaxedLineHeightStartIndex = Math.max(
                    0,
                    lineHeightStartIndex - (fontIndex - fontStartIndex)
                );
                for (
                    let lineHeightIndex = relaxedLineHeightStartIndex;
                    lineHeightIndex < lineHeightSteps.length;
                    lineHeightIndex += 1
                ) {
                    const fitLayout = await tryMeasureLayout(a4Height, {
                        ...targetLayout,
                        fontSize: fontSizeSteps[fontIndex],
                        lineHeight: lineHeightSteps[lineHeightIndex],
                    });
                    if (!fitLayout) {
                        continue;
                    }
                    const score = resolveLayoutScore(
                        fitLayout,
                        defaultLayout,
                        topPaddingSteps,
                        itemSpacingSteps,
                        mode
                    );
                    if (score > bestFitScore) {
                        bestFitLayout = fitLayout;
                        bestFitScore = score;
                    }
                }
            }
            return bestFitLayout;
        }

        for (let fontIndex = fontStartIndex; fontIndex >= 0; fontIndex -= 1) {
            for (let lineHeightIndex = lineHeightStartIndex; lineHeightIndex >= 0; lineHeightIndex -= 1) {
                const fitLayout = await tryMeasureLayout(a4Height, {
                    ...targetLayout,
                    fontSize: fontSizeSteps[fontIndex],
                    lineHeight: lineHeightSteps[lineHeightIndex],
                });
                if (!fitLayout) {
                    continue;
                }
                const score = resolveLayoutScore(
                    fitLayout,
                    defaultLayout,
                    topPaddingSteps,
                    itemSpacingSteps,
                    mode
                );
                if (score > bestFitScore) {
                    bestFitLayout = fitLayout;
                    bestFitScore = score;
                }
            }
        }

        return bestFitLayout;
    };

    const reboundTypographyIfPossible = async (
        a4Height: number,
        layout: SmartPageLayout
    ): Promise<SmartPageLayout> => {
        let candidate = layout;
        const fontIndex = resolveNearestStepIndex(FONT_SIZE_SHRINK_STEPS, candidate.fontSize);
        if (fontIndex > 0) {
            const reboundFontLayout = await tryMeasureLayout(a4Height, {
                ...candidate,
                fontSize: FONT_SIZE_SHRINK_STEPS[fontIndex - 1],
            });
            if (reboundFontLayout) {
                candidate = reboundFontLayout;
            }
        }

        const lineHeightIndex = resolveNearestStepIndex(LINE_HEIGHT_SHRINK_STEPS, candidate.lineHeight);
        if (lineHeightIndex > 0) {
            const reboundLineHeightLayout = await tryMeasureLayout(a4Height, {
                ...candidate,
                lineHeight: LINE_HEIGHT_SHRINK_STEPS[lineHeightIndex - 1],
            });
            if (reboundLineHeightLayout) {
                candidate = reboundLineHeightLayout;
            }
        }

        return candidate;
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
                const topPaddingExpandSteps = buildTopPaddingSteps(
                    defaultLayout.topPaddingPx,
                    resolveMaxTopPaddingPx(a4Height),
                    SMART_PAGE_TOP_PADDING_STEP_PX
                );
                const itemSpacingExpandSteps = buildItemSpacingSteps(
                    defaultLayout.itemSpacingEm,
                    SMART_PAGE_ITEM_SPACING_MAX,
                    SMART_PAGE_ITEM_SPACING_STEP
                );
                const fontSizeExpandSteps = buildFontSizeSteps(
                    defaultLayout.fontSize,
                    FONT_SIZE_MAX,
                    FONT_SIZE_STEP
                );
                const lineHeightExpandSteps = buildLineHeightSteps(
                    defaultLayout.lineHeight,
                    LINE_HEIGHT_MAX,
                    LINE_HEIGHT_STEP
                );
                const sectionSpacingExpandSteps = buildDiscreteStepsFromCurrent(
                    SECTION_SPACING_KEYS,
                    defaultLayout.sectionSpacingKey,
                    'expand'
                );

                const expansionStageLayouts: Array<{ key: string; layout: SmartPageLayout }> = [
                    {
                        key: 'mild',
                        layout: {
                            topPaddingPx: resolveStepByOffset(topPaddingExpandSteps, defaultLayout.topPaddingPx, 1),
                            sectionSpacingKey: resolveStepByOffset(
                                sectionSpacingExpandSteps,
                                defaultLayout.sectionSpacingKey,
                                1
                            ) as SectionSpacingKey,
                            itemSpacingEm: resolveStepByOffset(itemSpacingExpandSteps, defaultLayout.itemSpacingEm, 1),
                            lineHeight: resolveStepByOffset(lineHeightExpandSteps, defaultLayout.lineHeight, 1),
                            fontSize: resolveStepByOffset(fontSizeExpandSteps, defaultLayout.fontSize, 1),
                        },
                    },
                    {
                        key: 'medium',
                        layout: {
                            topPaddingPx: resolveStepByOffset(topPaddingExpandSteps, defaultLayout.topPaddingPx, 2),
                            sectionSpacingKey: resolveStepByOffset(
                                sectionSpacingExpandSteps,
                                defaultLayout.sectionSpacingKey,
                                2
                            ) as SectionSpacingKey,
                            itemSpacingEm: resolveStepByOffset(itemSpacingExpandSteps, defaultLayout.itemSpacingEm, 2),
                            lineHeight: resolveStepByOffset(lineHeightExpandSteps, defaultLayout.lineHeight, 2),
                            fontSize: resolveStepByOffset(fontSizeExpandSteps, defaultLayout.fontSize, 2),
                        },
                    },
                    {
                        key: 'strong',
                        layout: {
                            topPaddingPx: resolveStepByOffset(topPaddingExpandSteps, defaultLayout.topPaddingPx, 3),
                            sectionSpacingKey: resolveStepByOffset(
                                sectionSpacingExpandSteps,
                                defaultLayout.sectionSpacingKey,
                                3
                            ) as SectionSpacingKey,
                            itemSpacingEm: resolveStepByOffset(itemSpacingExpandSteps, defaultLayout.itemSpacingEm, 3),
                            lineHeight: resolveStepByOffset(lineHeightExpandSteps, defaultLayout.lineHeight, 3),
                            fontSize: resolveStepByOffset(fontSizeExpandSteps, defaultLayout.fontSize, 3),
                        },
                    },
                    {
                        key: 'max-balanced',
                        layout: {
                            topPaddingPx: topPaddingExpandSteps[topPaddingExpandSteps.length - 1],
                            sectionSpacingKey: sectionSpacingExpandSteps[sectionSpacingExpandSteps.length - 1],
                            itemSpacingEm: itemSpacingExpandSteps[itemSpacingExpandSteps.length - 1],
                            lineHeight: lineHeightExpandSteps[lineHeightExpandSteps.length - 1],
                            fontSize: fontSizeExpandSteps[fontSizeExpandSteps.length - 1],
                        },
                    },
                ];
                const dedupedExpansionStages = expansionStageLayouts.filter((stage, index, stages) => {
                    const currentKey = JSON.stringify(stage.layout);
                    return stages.findIndex((candidate) => JSON.stringify(candidate.layout) === currentKey) === index;
                });
                const expansionCandidates: Array<{ key: string; layout: SmartPageLayout; score: number }> = [];
                for (const stage of dedupedExpansionStages) {
                    const fitLayout = await findBestFitWithinStage(
                        a4Height,
                        stage.layout,
                        defaultLayout,
                        topPaddingExpandSteps,
                        itemSpacingExpandSteps,
                        'expand',
                        fontSizeExpandSteps,
                        lineHeightExpandSteps
                    );
                    if (!fitLayout || areLayoutValuesEqual(fitLayout, defaultLayout)) {
                        continue;
                    }
                    expansionCandidates.push({
                        key: stage.key,
                        layout: fitLayout,
                        score: resolveLayoutScore(
                            fitLayout,
                            defaultLayout,
                            topPaddingExpandSteps,
                            itemSpacingExpandSteps,
                            'expand'
                        ),
                    });
                }
                const bestExpansionCandidate = expansionCandidates.reduce<typeof expansionCandidates[number] | null>(
                    (bestCandidate, currentCandidate) => {
                        if (!bestCandidate || currentCandidate.score > bestCandidate.score) {
                            return currentCandidate;
                        }
                        return bestCandidate;
                    },
                    null
                );
                return finalizeFit(bestExpansionCandidate?.layout ?? initialFit);
            }

            const topPaddingSteps = buildTopPaddingSteps(
                defaultLayout.topPaddingPx,
                SMART_PAGE_TOP_PADDING_MIN_PX,
                SMART_PAGE_TOP_PADDING_STEP_PX
            );
            const itemSpacingSteps = buildReductionStepsFromCurrent(
                defaultLayout.itemSpacingEm,
                SMART_PAGE_ITEM_SPACING_MIN,
                SMART_PAGE_ITEM_SPACING_STEP
            );
            const hardFallbackLayout: SmartPageLayout = {
                topPaddingPx: topPaddingSteps[topPaddingSteps.length - 1],
                sectionSpacingKey: SECTION_SPACING_KEYS[SECTION_SPACING_KEYS.length - 1],
                itemSpacingEm: itemSpacingSteps[itemSpacingSteps.length - 1],
                lineHeight: LINE_HEIGHT_SHRINK_STEPS[LINE_HEIGHT_SHRINK_STEPS.length - 1],
                fontSize: FONT_SIZE_SHRINK_STEPS[FONT_SIZE_SHRINK_STEPS.length - 1],
            };

            const stageLayouts: Array<{ key: string; layout: SmartPageLayout }> = [
                {
                    key: 'mild',
                    layout: {
                        topPaddingPx: resolveStepByOffset(topPaddingSteps, defaultLayout.topPaddingPx, 1),
                        sectionSpacingKey: resolveStepByOffset(
                            SECTION_SPACING_KEYS,
                            defaultLayout.sectionSpacingKey,
                            1
                        ) as SectionSpacingKey,
                        itemSpacingEm: resolveStepByOffset(itemSpacingSteps, defaultLayout.itemSpacingEm, 1),
                        lineHeight: resolveStepByOffset(LINE_HEIGHT_SHRINK_STEPS, defaultLayout.lineHeight, 1),
                        fontSize: resolveStepByOffset(FONT_SIZE_SHRINK_STEPS, defaultLayout.fontSize, 1),
                    },
                },
                {
                    key: 'medium',
                    layout: {
                        topPaddingPx: resolveStepByOffset(topPaddingSteps, defaultLayout.topPaddingPx, 2),
                        sectionSpacingKey: resolveStepByOffset(
                            SECTION_SPACING_KEYS,
                            defaultLayout.sectionSpacingKey,
                            2
                        ) as SectionSpacingKey,
                        itemSpacingEm: resolveStepByOffset(itemSpacingSteps, defaultLayout.itemSpacingEm, 2),
                        lineHeight: resolveStepByOffset(LINE_HEIGHT_SHRINK_STEPS, defaultLayout.lineHeight, 2),
                        fontSize: resolveStepByOffset(FONT_SIZE_SHRINK_STEPS, defaultLayout.fontSize, 2),
                    },
                },
                {
                    key: 'strong',
                    layout: {
                        topPaddingPx: resolveStepByOffset(topPaddingSteps, defaultLayout.topPaddingPx, 3),
                        sectionSpacingKey: resolveStepByOffset(
                            SECTION_SPACING_KEYS,
                            defaultLayout.sectionSpacingKey,
                            3
                        ) as SectionSpacingKey,
                        itemSpacingEm: resolveStepByOffset(itemSpacingSteps, defaultLayout.itemSpacingEm, 3),
                        lineHeight: resolveStepByOffset(LINE_HEIGHT_SHRINK_STEPS, defaultLayout.lineHeight, 3),
                        fontSize: resolveStepByOffset(FONT_SIZE_SHRINK_STEPS, defaultLayout.fontSize, 3),
                    },
                },
                {
                    key: 'max-balanced',
                    layout: {
                        topPaddingPx: topPaddingSteps[topPaddingSteps.length - 1],
                        sectionSpacingKey: SECTION_SPACING_KEYS[SECTION_SPACING_KEYS.length - 1],
                        itemSpacingEm: itemSpacingSteps[itemSpacingSteps.length - 1],
                        lineHeight: resolveStepByOffset(
                            LINE_HEIGHT_SHRINK_STEPS,
                            defaultLayout.lineHeight,
                            Math.round(0.2 / LINE_HEIGHT_STEP)
                        ),
                        fontSize: resolveStepByOffset(
                            FONT_SIZE_SHRINK_STEPS,
                            defaultLayout.fontSize,
                            Math.round(2 / FONT_SIZE_STEP)
                        ),
                    },
                },
                {
                    key: 'hard-fallback',
                    layout: hardFallbackLayout,
                },
            ];

            const dedupedStageLayouts = stageLayouts.filter((stage, index, stages) => {
                const currentKey = JSON.stringify(stage.layout);
                return stages.findIndex((candidate) => JSON.stringify(candidate.layout) === currentKey) === index;
            });

            const fittingCandidates: Array<{ key: string; layout: SmartPageLayout; score: number }> = [];
            for (const stage of dedupedStageLayouts) {
                const fitLayout = stage.key === 'hard-fallback'
                    ? await tryMeasureLayout(a4Height, stage.layout)
                    : await findBestFitWithinStage(
                        a4Height,
                        stage.layout,
                        defaultLayout,
                        topPaddingSteps,
                        itemSpacingSteps,
                        'shrink',
                        FONT_SIZE_SHRINK_STEPS,
                        LINE_HEIGHT_SHRINK_STEPS
                    );
                if (!fitLayout) {
                    continue;
                }
                fittingCandidates.push({
                    key: stage.key,
                    layout: fitLayout,
                    score: resolveLayoutScore(
                        fitLayout,
                        defaultLayout,
                        topPaddingSteps,
                        itemSpacingSteps,
                        'shrink'
                    ),
                });
            }

            const bestFitCandidate = fittingCandidates.reduce<typeof fittingCandidates[number] | null>(
                (bestCandidate, currentCandidate) => {
                    if (!bestCandidate) {
                        return currentCandidate;
                    }
                    if (currentCandidate.score > bestCandidate.score) {
                        return currentCandidate;
                    }
                    return bestCandidate;
                },
                null
            );

            if (bestFitCandidate) {
                const reboundLayout = await reboundTypographyIfPossible(
                    a4Height,
                    bestFitCandidate.layout
                );
                return finalizeFit(reboundLayout);
            }

            return finalizeOverflow(hardFallbackLayout);
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
        if (resumeId) {
            await flushResumeConfig(buildCommittedResumeConfigSnapshot());
        }
        try {
            const profileForCreate = await profileService.getProfile().catch(() => profileService.peekProfileForCurrentUser());
            const ownerId = profileForCreate?.user_id ?? authUserKey ?? await resolveAuthUserKeyFromActiveSession();
            nextResume = await resumeService.create({
                title: UNTITLED_RESUME_TITLE,
                config: buildPreferredResumeCreateConfig(
                    profileForCreate?.extra_json,
                    ownerId
                ),
            });
        } catch (error) {
            console.error('[ResumeEditor] 创建空白简历失败:', error);
            return {
                status: 'failed',
                stage: 'create',
                error,
            };
        }

        const reloadResult = await reloadResumeContext(nextResume.id);
        if (reloadResult.status !== 'success') {
            await refreshDashboardResumesFromServer();
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
            return {
                status: 'warning',
                stage: 'sync',
                resumeId: nextResume.id,
                error: syncResult.error,
            };
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
                    message: '新简历已创建，但未完成切换，请从仪表盘打开',
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
    useEffect(() => {
        if (mobileDrawerOpenRequest <= 0 || typeof window === 'undefined') {
            return;
        }
        onMobileDrawerOpenRequestConsumed?.();
        if (window.innerWidth >= 768) {
            return;
        }
        setSidebarTab('experience');
        openMobileEditorDrawer();
    }, [mobileDrawerOpenRequest, onMobileDrawerOpenRequestConsumed, openMobileEditorDrawer]);
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
    const handleExperiencePolishModeChange = (mode: ResumePolishMode) => {
        setExperiencePolishMode(mode);
        if (mode !== 'smart_complete') {
            setExperienceSmartCompletionPrompt(null);
        }
    };
    const handleFloatingPolishModeChange = (mode: ResumePolishMode) => {
        setFloatingPolishMode(mode);
        if (mode !== 'smart_complete') {
            setFloatingSmartCompletionPrompt(null);
        }
    };
    const editingItem = experienceItems.find((item) => item.id === experience.editingExpId);
    const editingSuggestionToolbar = editingItem ? (
        <AIPolishToolbar
            isPreviewing={false}
            isRunning={isEditingExperiencePolishRunning}
            activeMode={experiencePolishMode}
            modeOptions={SMART_RESUME_POLISH_MODES}
            customPrompt={experienceCustomPrompt}
            smartCompletionPrompt={experienceSmartCompletionPrompt ? {
                ...experienceSmartCompletionPrompt,
                onAnswerChange: (value) => setExperienceSmartCompletionPrompt((prev) => (
                    prev ? { ...prev, answer: value } : prev
                )),
            } : null}
            hasJdContext
            disabledAssistant={!jdPolishContext.trim()}
            compact
            onModeChange={handleExperiencePolishModeChange}
            onCustomPromptChange={setExperienceCustomPrompt}
            onRun={() => void handleRunEditingExperiencePolish()}
            onUndo={handleUndoEditingExperiencePolish}
            onConfirm={handleConfirmEditingExperiencePolish}
            onOpenAssistant={handleOpenExperienceAssistant}
        />
    ) : null;
    const floatingPolishToolbar = activeFloatingPolishExperienceId ? (
        <AIPolishToolbar
            isPreviewing={Boolean(singleFloatingPolishPreview)}
            isRunning={isFloatingExperiencePolishRunning}
            activeMode={floatingPolishMode}
            modeOptions={SMART_RESUME_POLISH_MODES}
            customPrompt={floatingPolishCustomPrompt}
            smartCompletionPrompt={floatingSmartCompletionPrompt ? {
                ...floatingSmartCompletionPrompt,
                onAnswerChange: (value) => setFloatingSmartCompletionPrompt((prev) => (
                    prev ? { ...prev, answer: value } : prev
                )),
            } : null}
            hasJdContext
            disabledAssistant={!jdPolishContext.trim()}
            previewTitle="AI 润色结果"
            previewDescription="润色结果已同步到简历预览，确认后会保存到当前简历。"
            previewContent={
                singleFloatingPolishPreview ? (
                    <FloatingPolishPreviewContent draft={singleFloatingPolishPreview.afterDraft} />
                ) : undefined
            }
            onModeChange={handleFloatingPolishModeChange}
            onCustomPromptChange={setFloatingPolishCustomPrompt}
            onRun={() => void handleRunFloatingExperiencePolish()}
            onUndo={handleUndoFloatingExperiencePolish}
            onConfirm={() => void handleConfirmFloatingExperiencePolish()}
            onOpenAssistant={handleOpenFloatingExperienceAssistant}
        />
    ) : null;
    const batchPolishToolbar = isBatchPolishToolbarOpen ? (
        <AIPolishToolbar
            isPreviewing={Boolean(batchFloatingPolishPreview)}
            isRunning={isFloatingExperiencePolishRunning}
            activeMode={floatingPolishMode === 'smart_complete' ? DEFAULT_RESUME_POLISH_MODE : floatingPolishMode}
            modeOptions={BATCH_RESUME_POLISH_MODES}
            customPrompt={floatingPolishCustomPrompt}
            smartCompletionPrompt={floatingSmartCompletionPrompt ? {
                ...floatingSmartCompletionPrompt,
                onAnswerChange: (value) => setFloatingSmartCompletionPrompt((prev) => (
                    prev ? { ...prev, answer: value } : prev
                )),
            } : null}
            hasJdContext
            disabledAssistant
            previewTitle="AI 批量润色结果"
            previewDescription={
                batchFloatingPolishPreview
                    ? `已同步 ${batchFloatingPolishPreview.items.length} 条经历到简历预览，请确认是否统一保存。${batchFloatingPolishPreview.failedIds.length > 0 ? ` 本次有 ${batchFloatingPolishPreview.failedIds.length} 条未成功。` : ''}`
                    : '执行后会并发润色当前已选经历，并同步到简历预览等待统一确认。'
            }
            runButtonLabel="开始批量润色"
            runningLabel="批量润色中..."
            undoLabel="撤销全部"
            confirmLabel="确认全部"
            onModeChange={handleFloatingPolishModeChange}
            onCustomPromptChange={setFloatingPolishCustomPrompt}
            onRun={() => void handleRunBatchExperiencePolish()}
            onUndo={handleUndoBatchExperiencePolish}
            onConfirm={() => void handleConfirmBatchExperiencePolish()}
            onOpenAssistant={() => {}}
        />
    ) : null;
    const floatingPolishHighlightItemIds = useMemo(
        () => new Set(
            (floatingPolishSession?.items ?? []).map((item) => buildDragItemKey('experience', item.targetId))
        ),
        [floatingPolishSession]
    );
    const isPreviewInteractionLocked = Boolean(floatingPolishSession)
        || isFloatingExperiencePolishRunning
        || isBatchPolishToolbarOpen;
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
    const selectedExperienceCount = selectedWorkItems.length + selectedProjectItems.length;
    const canBatchPolish = Boolean(
        jdPolishContext.trim()
        && selectedExperienceCount > 0
        && !isFloatingExperiencePolishRunning
        && !floatingPolishSession
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
            selectedSkillGroups,
            selectedEducations,
        ),
        [selectedCertifications, selectedEducations, selectedProjectItems, selectedSkillGroups, selectedWorkItems]
    );
    const selectedResumeSnapshotText = useMemo(
        () => buildStableResumeSnapshotText(selectedResumeSnapshot),
        [selectedResumeSnapshot]
    );
    const handleApplyResumeAssistantDraft = useCallback(async (
        draftCard: Parameters<NonNullable<AssistantLaunchRequest['applyDraftHandler']>>[0],
        _meta: AssistantDraftApplyMeta
    ) => {
        const normalizedDraftCard = normalizeAssistantDraftCard(draftCard);
        const applyEducationAssistantDetail = (
            detail: ExperienceDetail,
            options?: { replacedId?: string }
        ) => {
            const nextItem: ExperienceListItem = {
                master: detail.master,
                latest_version: detail.latest_version,
            };
            const nextView = buildEducationView(nextItem);
            setEducationSourceMap((prev) => {
                const next = new Map(prev);
                if (options?.replacedId && options.replacedId !== detail.master.id) {
                    next.delete(options.replacedId);
                }
                next.set(detail.master.id, nextItem);
                return next;
            });
            setEducations((prev) => {
                const matchId = options?.replacedId ?? detail.master.id;
                const targetIndex = prev.findIndex((item) => item.id === matchId || item.id === detail.master.id);
                const next = prev.filter((item) => item.id !== detail.master.id && item.id !== options?.replacedId);
                if (targetIndex >= 0) {
                    next.splice(targetIndex, 0, nextView);
                    return next;
                }
                return [...next, nextView];
            });
            setSelectedEduIds((prev) => {
                const next = new Set(prev);
                if (options?.replacedId && options.replacedId !== detail.master.id) {
                    next.delete(options.replacedId);
                }
                next.add(detail.master.id);
                return next;
            });
        };

        if (normalizedDraftCard.type === 'certification') {
            const record = await certificationsService.create({
                name: normalizedDraftCard.data.name.trim(),
                issuer: normalizedDraftCard.data.issuer.trim() || undefined,
                issue_date: normalizedDraftCard.data.issueDate.trim() || undefined,
                expiry_date: normalizedDraftCard.data.expiryDate.trim() || undefined,
                credential_id: normalizedDraftCard.data.credentialId.trim() || undefined,
                credential_url: normalizedDraftCard.data.credentialUrl.trim() || undefined,
                description: normalizedDraftCard.data.description.trim() || undefined,
            });
            const nextCertifications = await certificationsService.list({ force: true });
            setCertifications(nextCertifications.map(buildCertificationView).sort(compareCertificationByDateDesc));
            setCertificationSourceMap(new Map(nextCertifications.map((item) => [item.id, item])));
            setSelectedCertIds((prev) => {
                const next = new Set(prev);
                next.add(record.id);
                return next;
            });
            return true;
        }

        if (normalizedDraftCard.type === 'skill_group') {
            const category = normalizedDraftCard.data.category.trim() || undefined;
            const skillPayloads = Array.from(
                normalizedDraftCard.data.skills.reduce((map, item) => {
                    const name = item.name.trim();
                    if (!name || map.has(name)) {
                        return map;
                    }
                    map.set(name, {
                        name,
                        category,
                        proficiency: typeof item.proficiency === 'number' ? item.proficiency : undefined,
                    });
                    return map;
                }, new Map<string, { name: string; category?: string; proficiency?: number }>())
                    .values()
            );
            if (skillPayloads.length === 0) {
                throw new Error('缺少技能名称，无法录入技能组');
            }
            const createdSkills = await Promise.all(
                skillPayloads.map((payload) => skillsService.create(payload))
            );
            const nextSkills = await skillsService.list({ force: true });
            setSkillGroups(buildSkillGroups(nextSkills));
            setSelectedSkillIds((prev) => {
                const next = new Set(prev);
                createdSkills.forEach((item) => next.add(item.id));
                return next;
            });
            return true;
        }

        if (normalizedDraftCard.type === 'experience' && normalizedDraftCard.data.category === 'education') {
            const targetMasterId = normalizedDraftCard.data.targetMasterId?.trim() || null;
            const educationDraft: EducationEditDraft = {
                school: normalizedDraftCard.data.org.trim(),
                major: normalizedDraftCard.data.title.trim(),
                degree: normalizedDraftCard.data.star.s.trim(),
                startDate: normalizedDraftCard.data.startDate.trim(),
                endDate: normalizedDraftCard.data.isCurrent ? '至今' : normalizedDraftCard.data.endDate.trim(),
                gpa: normalizedDraftCard.data.star.t.trim(),
                courses: normalizedDraftCard.data.star.a.trim(),
            };
            if (!educationDraft.major) {
                throw new Error('缺少教育标题，无法录入教育经历');
            }
            const sourceItem = targetMasterId
                ? (
                    educationSourceMap.get(targetMasterId)
                    ?? (() => {
                        throw new Error('缺少教育经历源数据');
                    })()
                )
                : null;
            const payload = buildEducationVersionPayload(sourceItem, educationDraft);
            const detail = targetMasterId
                ? await experienceService.update(targetMasterId, { version: payload })
                : await experienceService.create({
                    category: 'education',
                    version: payload,
                });
            applyEducationAssistantDetail(detail);
            return true;
        }

        if (normalizedDraftCard.type !== 'experience' || !resumeId) {
            return false;
        }

        const title = normalizedDraftCard.data.title.trim();
        if (!title) {
            throw new Error('缺少经历标题，无法回填到当前简历');
        }

        const buildAssemblyOverrideOperation = () => {
            const overrides: Record<string, unknown> = {
                star: normalizedDraftCard.data.star,
                is_current: Boolean(normalizedDraftCard.data.isCurrent),
            };
            const clearOverrideKeys = new Set<string>();
            const org = normalizedDraftCard.data.org.trim();
            const startDate = normalizeDateInput(normalizedDraftCard.data.startDate);
            const endDate = normalizedDraftCard.data.isCurrent ? undefined : normalizeDateInput(normalizedDraftCard.data.endDate);
            if (title) {
                overrides.title = title;
            }
            if (org) {
                overrides.org = org;
            }
            if (startDate) {
                overrides.start_date = startDate;
            }
            if (endDate) {
                overrides.end_date = endDate;
            } else {
                clearOverrideKeys.add('end_date');
            }
            return {
                overrides_json: overrides,
                ...(clearOverrideKeys.size > 0 ? { clear_override_keys: Array.from(clearOverrideKeys) } : {}),
            };
        };

        const resolveTargetLinkId = async () => {
            const targetMasterId = normalizedDraftCard.data.targetMasterId?.trim();
            if (targetMasterId) {
                const targetDetail = await experienceService.get(targetMasterId);
                const linkId = await ensureFloatingPolishResumeLink(
                    targetMasterId,
                    targetDetail.latest_version?.id
                );
                if (!linkId) {
                    throw new Error('无法创建目标经历与当前简历的关联');
                }
                return { masterId: targetMasterId, linkId };
            }

            const created = await experienceService.create({
                category: normalizedDraftCard.data.category,
                version: {
                    title,
                    org: normalizedDraftCard.data.org.trim() || undefined,
                    start_date: normalizeDateInput(normalizedDraftCard.data.startDate),
                    end_date: normalizedDraftCard.data.isCurrent ? undefined : normalizeDateInput(normalizedDraftCard.data.endDate),
                    is_current: Boolean(normalizedDraftCard.data.isCurrent),
                    star: normalizedDraftCard.data.star,
                },
            });
            const createdMasterId = created.master.id;
            const linkId = await ensureFloatingPolishResumeLink(
                createdMasterId,
                created.latest_version?.id
            );
            if (!linkId) {
                throw new Error('无法将新经历添加到当前简历');
            }
            return { masterId: createdMasterId, linkId };
        };

        const { masterId, linkId } = await resolveTargetLinkId();
        const detail = await resumeService.updateAssembly(resumeId, {
            operations: [
                {
                    op: 'override',
                    resume_experience_id: linkId,
                    ...buildAssemblyOverrideOperation(),
                },
            ],
        });
        const nextMap = buildResumeExperienceMap(detail);
        applyResumeDetail(detail);
        setResumeExperienceMap(nextMap);
        if (normalizedDraftCard.data.category === 'education') {
            setSelectedEduIds((prev) => {
                const next = new Set(prev);
                next.add(masterId);
                return next;
            });
        } else {
            setSelectedExpIds((prev) => {
                const next = new Set(prev);
                next.add(masterId);
                return next;
            });
        }
        return true;
    }, [
        applyResumeDetail,
        compareCertificationByDateDesc,
        buildCertificationView,
        buildEducationView,
        buildEducationVersionPayload,
        buildSkillGroups,
        educationSourceMap,
        setCertifications,
        setCertificationSourceMap,
        setEducationSourceMap,
        setEducations,
        setSelectedCertIds,
        setSelectedEduIds,
        setSelectedSkillIds,
        ensureFloatingPolishResumeLink,
        resumeId,
        setSkillGroups,
        setResumeExperienceMap,
    ]);
    const handleLaunchResumeAssistant = useCallback(() => {
        if (!resumeId || !onLaunchAssistant) {
            return;
        }
        onLaunchAssistant({
            context: {
                mode: 'general',
                entrySource: 'resume_editor',
                title: `${resumeName || '未命名简历'} · AI 助理`,
                contextJson: {
                    resumeId,
                },
            },
            prefillResume: {
                resumeId,
                resumeName: resumeName || '未命名简历',
                snapshot: selectedResumeSnapshot,
                ...(jdPolishContext ? { jdContext: jdPolishContext } : {}),
            },
            applyDraftHandler: handleApplyResumeAssistantDraft,
        });
    }, [handleApplyResumeAssistantDraft, jdPolishContext, onLaunchAssistant, resumeId, resumeName, selectedResumeSnapshot]);
    const editablePersonalSummary = useMemo(() => {
        if (hasPersonalSummaryOverride) {
            return personalSummary;
        }
        return profile.summary;
    }, [hasPersonalSummaryOverride, personalSummary, profile.summary]);
    const hasEditablePersonalSummary = useMemo(
        () => Boolean(stripRichTextToText(editablePersonalSummary).trim()),
        [editablePersonalSummary]
    );
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
        if (
            !isSummaryVisible
            && !hasEditablePersonalSummary
            && stripRichTextToText(value).trim()
        ) {
            setIsSummaryVisible(true);
        }
        setPersonalSummary(value);
        setHasPersonalSummaryOverride(true);
    }, [hasEditablePersonalSummary, isSummaryVisible]);
    const previewProfile = useMemo(
        () => ({
            ...profile,
            summary: effectivePersonalSummary,
        }),
        [effectivePersonalSummary, profile]
    );
    const collectPreviewMeasurement = useCallback(async (): Promise<ResumePrintLayoutMeasurement | null> => {
        await waitForPreviewUpdate(2);
        if (typeof document !== 'undefined' && document.fonts?.ready) {
            await document.fonts.ready;
            await waitForPreviewUpdate(1);
        }

        return measureResumeLayout(
            measurePreviewRef.current,
            measurePreviewContentRef.current
        );
    }, [waitForPreviewUpdate]);
    useEffect(() => {
        let cancelled = false;
        void collectPreviewMeasurement().then((measurement) => {
            if (cancelled) {
                return;
            }
            setPreviewPrintMeasurement(measurement);
        });

        return () => {
            cancelled = true;
        };
    }, [
        collectPreviewMeasurement,
        measureLayout,
        previewProfile,
        resumeTemplateId,
        themeColorPresetId,
        sectionOrder,
        selectedWorkItems,
        selectedProjectItems,
        educations,
        selectedEduIds,
        sortedCertifications,
        selectedCertIds,
        selectedSkillGroups,
    ]);
    useEffect(() => {
        const pageElement = measurePreviewRef.current;
        const contentElement = measurePreviewContentRef.current;
        if (!pageElement || !contentElement || typeof window === 'undefined') {
            return undefined;
        }

        let cancelled = false;
        let frameId: number | null = null;
        const pendingImageListeners = new Set<HTMLImageElement>();
        const detachImageListeners = () => {
            pendingImageListeners.forEach((image) => {
                image.removeEventListener('load', scheduleMeasurement);
                image.removeEventListener('error', scheduleMeasurement);
            });
            pendingImageListeners.clear();
        };
        const refreshPendingImages = () => {
            detachImageListeners();
            contentElement.querySelectorAll('img').forEach((image) => {
                if (image.complete) {
                    return;
                }
                image.addEventListener('load', scheduleMeasurement);
                image.addEventListener('error', scheduleMeasurement);
                pendingImageListeners.add(image);
            });
        };
        const runMeasurement = () => {
            frameId = null;
            void collectPreviewMeasurement().then((measurement) => {
                if (cancelled) {
                    return;
                }
                setPreviewPrintMeasurement(measurement);
            });
        };
        function scheduleMeasurement() {
            if (cancelled || frameId !== null) {
                return;
            }
            frameId = window.requestAnimationFrame(runMeasurement);
        }

        refreshPendingImages();
        scheduleMeasurement();

        if (typeof ResizeObserver === 'undefined') {
            window.addEventListener('resize', scheduleMeasurement);
            return () => {
                cancelled = true;
                detachImageListeners();
                window.removeEventListener('resize', scheduleMeasurement);
                if (frameId !== null) {
                    window.cancelAnimationFrame(frameId);
                }
            };
        }

        const observer = new ResizeObserver(() => {
            refreshPendingImages();
            scheduleMeasurement();
        });
        observer.observe(pageElement);
        observer.observe(contentElement);

        return () => {
            cancelled = true;
            detachImageListeners();
            observer.disconnect();
            if (frameId !== null) {
                window.cancelAnimationFrame(frameId);
            }
        };
    }, [collectPreviewMeasurement]);
    const isPreviewOverflowing = previewPrintMeasurement?.fits === false;
    const overflowingSectionIds = useMemo(
        () => new Set(previewPrintMeasurement?.overflowingSectionIds ?? []),
        [previewPrintMeasurement]
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
        signature: bossGreetingSignature,
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
        if (isFloatingExperiencePolishRunning) {
            showToastError('请等待当前润色完成后再继续操作');
            return;
        }
        if (floatingPolishSession) {
            showToastError('请先确认或撤销当前润色结果');
            return;
        }
        if (isBatchPolishToolbarOpen) {
            showToastError('请先关闭当前批量润色弹窗');
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
        floatingPolishSession,
        handleAnalyzeWithAutoName,
        isAutoAssembling,
        isBatchPolishToolbarOpen,
        isFloatingExperiencePolishRunning,
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
                    resumeId,
                    signature: requestedBossGreetingSignature,
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
            pendingPersistedBossGreetingRef.current = {
                resumeId: requestedResumeId ?? null,
                greeting: nextGreeting,
                signature: requestedBossGreetingSignature,
            };
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

    const runGeneratePersonalSummary = useCallback(async () => {
        if (isGeneratingPersonalSummary) {
            return;
        }
        if (!jdPolishContext.trim()) {
            showToastError('请先填写 JD 内容或完成 JD 分析后再生成个人评价。');
            return;
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
            const normalizedSummary = normalizeAiRichText(response.summary, { allowList: false });
            const hasGeneratedSummary = Boolean(stripRichTextToText(normalizedSummary).trim());
            if (!isSummaryVisible && !hasEditablePersonalSummary && hasGeneratedSummary) {
                setIsSummaryVisible(true);
            }
            setPersonalSummary(normalizedSummary);
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
        hasEditablePersonalSummary,
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

    const handleGeneratePersonalSummary = useCallback(() => {
        if (isGeneratingPersonalSummary) {
            return;
        }
        if (!jdPolishContext.trim()) {
            showToastError('请先填写 JD 内容或完成 JD 分析后再生成个人评价。');
            return;
        }
        if (hasEditablePersonalSummary) {
            setIsPersonalSummaryOverwriteDialogOpen(true);
            return;
        }
        void runGeneratePersonalSummary();
    }, [
        hasEditablePersonalSummary,
        isGeneratingPersonalSummary,
        jdPolishContext,
        runGeneratePersonalSummary,
        showToastError,
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
        setIsPersonalSummaryOverwriteDialogOpen(false);
        pendingPersistedBossGreetingRef.current = null;
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
            experienceListMarkerStyle,
            skillTagSeparator,
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
        experienceListMarkerStyle,
        fontSize,
        isExportingPdf,
        lineHeight,
        listSpacingClass,
        listSpacingValue,
        previewProfile,
        resumeName,
        resumeTemplateId,
        sectionOrder,
        sectionSpacingClass,
        selectedCertIds,
        selectedEduIds,
        selectedProjectItems,
        selectedSkillGroups,
        selectedWorkItems,
        showToastLoading,
        skillTagSeparator,
        sortedCertifications,
        themeColorPresetId,
        topPaddingPx,
        updateToast,
        waitForPreviewUpdate,
    ]);
    const hasFloatingPolishBlockingState = useCallback(() => {
        if (isFloatingExperiencePolishRunning) {
            showToastError('请等待当前润色完成后再继续操作');
            return true;
        }
        if (floatingPolishSession) {
            showToastError('请先确认或撤销当前润色结果');
            return true;
        }
        if (isBatchPolishToolbarOpen) {
            showToastError('请先关闭当前批量润色弹窗');
            return true;
        }
        return false;
    }, [floatingPolishSession, isBatchPolishToolbarOpen, isFloatingExperiencePolishRunning, showToastError]);

    const handleEditExperience = (id: string) => {
        if (hasFloatingPolishBlockingState()) {
            return;
        }
        setSidebarTab('experience');
        if (typeof window !== 'undefined' && window.innerWidth < 768) {
            openMobileEditorDrawer();
        }
        experience.startEditingExperience(id);
    };
    const handleEditCertification = (id: string) => {
        if (hasFloatingPolishBlockingState()) {
            return;
        }
        experience.cancelEditingExperience();
        setSidebarTab('experience');
        if (typeof window !== 'undefined' && window.innerWidth < 768) {
            openMobileEditorDrawer();
        }
        certification.beginEditCertification(id);
    };
    const handleEditSkill = (id: string) => {
        if (hasFloatingPolishBlockingState()) {
            return;
        }
        experience.cancelEditingExperience();
        setSidebarTab('experience');
        if (typeof window !== 'undefined' && window.innerWidth < 768) {
            openMobileEditorDrawer();
        }
        skill.beginEditSkill(id);
    };
    const handleSidebarTabSelect = useCallback((tab: 'profile' | 'experience') => {
        if (tab === 'profile' && hasFloatingPolishBlockingState()) {
            return;
        }
        setSidebarTab(tab);
    }, [hasFloatingPolishBlockingState]);
    const handleProfileTabSelected = useCallback(() => {
        experience.cancelEditingExperience();
    }, [experience]);
    const handlePreviewNavigateTab = useCallback((tab: 'profile' | 'experience') => {
        if (tab === 'profile' && hasFloatingPolishBlockingState()) {
            return;
        }
        setSidebarTab(tab);
    }, [hasFloatingPolishBlockingState]);
    const handleBeginProfileEdit = useCallback(() => {
        if (hasFloatingPolishBlockingState()) {
            return;
        }
        beginProfileEdit();
    }, [beginProfileEdit, hasFloatingPolishBlockingState]);
    const handleBeginCreateEducation = useCallback(() => {
        if (hasFloatingPolishBlockingState()) {
            return;
        }
        education.beginCreateEducation();
    }, [education, hasFloatingPolishBlockingState]);
    const handleBeginEditEducation = useCallback((id: string) => {
        if (hasFloatingPolishBlockingState()) {
            return;
        }
        education.beginEditEducation(id);
    }, [education, hasFloatingPolishBlockingState]);
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
                    isPreviewOverflowing={isPreviewOverflowing}
                    onOpenTemplateSelector={handleOpenTemplateSelector}
                    onLaunchAssistant={handleLaunchResumeAssistant}
                    canLaunchAssistant={Boolean(resumeId && !isLoadingResume)}
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
                    isPreviewOverflowing={isPreviewOverflowing}
                    canBatchPolish={canBatchPolish}
                    selectedExperienceCount={selectedExperienceCount}
                    isBatchPolishing={isFloatingExperiencePolishRunning}
                    hasBlockingPolishState={Boolean(floatingPolishSession) || isFloatingExperiencePolishRunning || isBatchPolishToolbarOpen}
                    batchPolishToolbar={batchPolishToolbar}
                    onBatchPolish={handleOpenBatchPolishToolbar}
                    onCloseBatchPolishToolbar={handleCloseBatchPolishToolbar}
                    onOpenTemplateSelector={handleOpenTemplateSelector}
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
                    onLaunchAssistant={handleLaunchResumeAssistant}
                    canLaunchAssistant={Boolean(resumeId && !isLoadingResume)}
                />
            </div>
            <div className="flex flex-1 flex-col overflow-visible md:min-h-0 md:overflow-hidden md:flex-row">
                <div className={`hidden md:flex md:h-full md:min-h-0 md:shrink-0 md:overflow-hidden ${SIDEBAR_WIDTH_CLASS}`}>
                    <EditorSidebar
                        sidebarTab={sidebarTab}
                        onSelectTab={handleSidebarTabSelect}
                        onProfileTabSelected={handleProfileTabSelected}
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
                            onOpenAgentPluginConfig,
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
                            onBeginEdit: handleBeginProfileEdit,
                            onCancelEdit: cancelProfileEdit,
                            onSave: handleSaveProfile,
                            educations,
                            selectedEduIds,
                            editingEducationId: education.editingEducationId,
                            educationDraft: education.educationDraft,
                            isSavingEducation: education.isSavingEducation,
                            deletingEducationIds: education.deletingEducationIds,
                            onBeginCreateEducation: handleBeginCreateEducation,
                            onBeginEditEducation: handleBeginEditEducation,
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
                            selectedExperienceCount,
                            canBatchPolish,
                            isBatchPolishing: isFloatingExperiencePolishRunning,
                            isAutoAssembling,
                            onBatchPolish: handleOpenBatchPolishToolbar,
                            onAutoAssemble: handleAutoAssemble,
                            onResetRenamingCategory: resetRenamingCategory,
                            onPolishExperience: handlePolishExperienceFromCard,
                            activePolishExperienceId: activeFloatingPolishExperienceId,
                            hasBlockingPolishState: Boolean(floatingPolishSession) || isFloatingExperiencePolishRunning || isBatchPolishToolbarOpen,
                            isEditingExperiencePolishPreviewing: Boolean(experiencePolishPreview),
                            polishToolbar: floatingPolishToolbar,
                            batchPolishToolbar,
                            onClosePolishExperienceToolbar: handleCloseFloatingPolishToolbar,
                            onDismissPolishExperienceToolbar: handleDismissFloatingPolishToolbar,
                            onCloseBatchPolishToolbar: handleCloseBatchPolishToolbar,
                            onDismissBatchPolishToolbar: handleDismissBatchPolishToolbar,
                            onResetWorkSort: () => handleResetSort('work'),
                            onResetProjectSort: () => handleResetSort('project'),
                            onResetCertificationSort: handleResetCertificationSort,
                        }}
                        editingSuggestion={{
                            editingItem,
                            staleExperienceIds,
                            toolbar: editingSuggestionToolbar,
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
                                max: LINE_HEIGHT_MAX,
                                step: LINE_HEIGHT_STEP,
                            }}
                            fontSizeSlider={{
                                min: FONT_SIZE_MIN,
                                max: FONT_SIZE_MAX,
                                step: FONT_SIZE_STEP,
                            }}
                            topPaddingSlider={{
                                min: TOP_PADDING_MIN_PX,
                                max: TOP_PADDING_SLIDER_MAX,
                                step: SMART_PAGE_TOP_PADDING_STEP_PX,
                            }}
                            sectionSpacingSlider={{
                                min: 2,
                                max: 12,
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
                        showOverflowGuide={isPreviewOverflowing}
                        overflowHighlightSectionIds={overflowingSectionIds}
                        polishHighlightItemIds={floatingPolishHighlightItemIds}
                        readOnly={isPreviewInteractionLocked}
                        lineHeight={lineHeight}
                        fontSize={fontSize}
                        listSpacingValue={listSpacingValue}
                        bulletSpacingValue={bulletSpacingValue}
                        topPaddingPx={topPaddingPx}
                        templateId={resumeTemplateId}
                        themeColorPresetId={themeColorPresetId}
                        experienceListMarkerStyle={experienceListMarkerStyle}
                        skillTagSeparator={skillTagSeparator}
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
                        onNavigateTab={handlePreviewNavigateTab}
                        onEditExperience={handleEditExperience}
                        onEditCertification={handleEditCertification}
                        onEditSkill={handleEditSkill}
                        resumeDisplayTitle={resolveResumeDisplayTitle(resumeName)}
                    />
                </div>
            </div>
            <TemplateSelectorModal
                isOpen={isTemplateSelectorOpen}
                selectedTemplateId={resumeTemplateId}
                themeColorPresetId={themeColorPresetId}
                sectionOrder={sectionOrder}
                experienceListMarkerStyle={experienceListMarkerStyle}
                skillTagSeparator={skillTagSeparator}
                templatePresetMap={templatePresetMap}
                isPresetMapReady={isTemplatePresetMapReady}
                isPresetSyncFallbackAvailable={isTemplatePresetFallbackAvailable}
                onClose={() => setIsTemplateSelectorOpen(false)}
                onUseLocalPresetFallback={() => unlockTemplatePresetMapWithLocalFallback(templatePresetFallbackOwnerKey)}
                onSelectTemplate={handleSelectTemplate}
                onSaveTemplatePreset={handleSaveTemplatePreset}
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
                    experienceListMarkerStyle={experienceListMarkerStyle}
                    skillTagSeparator={skillTagSeparator}
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
                    onNavigateTab={handlePreviewNavigateTab}
                    onEditExperience={() => { }}
                    onEditCertification={() => { }}
                    onEditSkill={() => { }}
                    resumeDisplayTitle={resolveResumeDisplayTitle(resumeName)}
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
                                onSelectTab={handleSidebarTabSelect}
                                onProfileTabSelected={handleProfileTabSelected}
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
                                    onOpenAgentPluginConfig,
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
                                    onBeginEdit: handleBeginProfileEdit,
                                    onCancelEdit: cancelProfileEdit,
                                    onSave: handleSaveProfile,
                                    educations,
                                    selectedEduIds,
                                    editingEducationId: education.editingEducationId,
                                    educationDraft: education.educationDraft,
                                    isSavingEducation: education.isSavingEducation,
                                    deletingEducationIds: education.deletingEducationIds,
                                    onBeginCreateEducation: handleBeginCreateEducation,
                                    onBeginEditEducation: handleBeginEditEducation,
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
                                    selectedExperienceCount,
                                    canBatchPolish,
                                    isBatchPolishing: isFloatingExperiencePolishRunning,
                                    isAutoAssembling,
                                    onBatchPolish: handleOpenBatchPolishToolbar,
                                    onAutoAssemble: handleAutoAssemble,
                                    onResetRenamingCategory: resetRenamingCategory,
                            onPolishExperience: handlePolishExperienceFromCard,
                            activePolishExperienceId: activeFloatingPolishExperienceId,
                            hasBlockingPolishState: Boolean(floatingPolishSession) || isFloatingExperiencePolishRunning || isBatchPolishToolbarOpen,
                            isEditingExperiencePolishPreviewing: Boolean(experiencePolishPreview),
                            polishToolbar: floatingPolishToolbar,
                            batchPolishToolbar,
                            onClosePolishExperienceToolbar: handleCloseFloatingPolishToolbar,
                            onDismissPolishExperienceToolbar: handleDismissFloatingPolishToolbar,
                            onCloseBatchPolishToolbar: handleCloseBatchPolishToolbar,
                            onDismissBatchPolishToolbar: handleDismissBatchPolishToolbar,
                                    onResetWorkSort: () => handleResetSort('work'),
                                    onResetProjectSort: () => handleResetSort('project'),
                                    onResetCertificationSort: handleResetCertificationSort,
                                }}
                                editingSuggestion={{
                                    editingItem,
                                    staleExperienceIds,
                                    toolbar: editingSuggestionToolbar,
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
            <ConfirmDialog
                isOpen={isPersonalSummaryOverwriteDialogOpen}
                title="覆盖当前个人评价？"
                description="当前已有个人评价内容，继续后将使用新的 AI 生成结果覆盖。"
                confirmLabel="继续生成"
                tone="primary"
                isConfirming={isGeneratingPersonalSummary}
                onConfirm={() => {
                    setIsPersonalSummaryOverwriteDialogOpen(false);
                    void runGeneratePersonalSummary();
                }}
                onCancel={() => setIsPersonalSummaryOverwriteDialogOpen(false)}
            />
        </div>
    );
};
export default ResumeEditor;
