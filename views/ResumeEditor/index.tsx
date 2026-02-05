import React, { useMemo, useRef, useState } from 'react';
import ConfirmDialog from '../../components/ConfirmDialog';
import { ToastContainer, useToast } from '../../components/Toast';
import { useExperienceActions } from '../../hooks/useExperienceActions';
import { useJDAnalysis } from '../../hooks/useJDAnalysis';
import { useResumeData } from '../../hooks/useResumeData';
import { profileService } from '../../services/profileService';
import type { Certification as CertificationRecord } from '../../services/certificationsService';
import type { ExperienceListItem } from '../../services/experienceService';
import type {
    CertificationView,
    EducationView,
    ProfileSyncMode,
    ResumeEditorProfile,
    ResumeExperienceView,
    SkillGroupView,
} from '../../types/resume';
import { buildExperienceDate } from '../../utils/dateUtils';
import { buildStarFields } from '../../utils/resumeHelpers';
import { parseYearMonthValue } from '../experienceUtils';
import { mergeLinkedInLink } from '../profileUtils';
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
    LINE_HEIGHT_DEFAULT,
    LINE_HEIGHT_MIN,
    LINE_HEIGHT_STEP,
    LIST_SPACING_REM_BY_DENSITY,
    PREVIEW_PADDING_MM,
    PROFILE_SYNC_MODES,
    SMART_PAGE_ADJUSTING_TOAST_DURATION_MS,
    SMART_PAGE_BOTTOM_GAP_MM,
    SMART_PAGE_HEIGHT_TOLERANCE,
    SMART_PAGE_TOAST_MESSAGES,
} from './constants';
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
    return `${(baseSpacing * scale).toFixed(3)}rem`;
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

const ResumeEditor: React.FC = () => {
    const [isDarkMode, setIsDarkMode] = useState(false);
    const [lineHeight, setLineHeight] = useState(LINE_HEIGHT_DEFAULT);
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
    const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
    // Section Order State (for draggable resume sections)
    const [sectionOrder, setSectionOrder] = useState<string[]>(
        () => [...DEFAULT_SECTION_ORDER]
    );
    const [draggedSectionId, setDraggedSectionId] = useState<string | null>(null);
    const previewRef = useRef<HTMLDivElement | null>(null);
    const previewContentRef = useRef<HTMLDivElement | null>(null);
    const a4HeightRef = useRef<number | null>(null);
    const smartPageAdjustingRef = useRef(false);

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
    const applyLineHeightAndMeasure = async (nextLineHeight: number) => {
        setLineHeight(nextLineHeight);
        return measureContentHeight();
    };
    const tryAdjustLineHeight = async (availableHeight: number) => {
        for (const nextLineHeight of REDUCED_LINE_HEIGHT_STEPS) {
            const height = await applyLineHeightAndMeasure(nextLineHeight);
            if (isWithinAvailableHeight(height, availableHeight)) {
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
            const initialHeight = await applyLineHeightAndMeasure(LINE_HEIGHT_DEFAULT);
            if (isWithinAvailableHeight(initialHeight, availableHeight)) {
                showToastSuccess(SMART_PAGE_TOAST_MESSAGES.success);
                return;
            }
            const lineHeightAdjusted = await tryAdjustLineHeight(availableHeight);
            if (lineHeightAdjusted) {
                showToastSuccess(SMART_PAGE_TOAST_MESSAGES.success);
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
    const editingItem = experienceItems.find((item) => item.id === experience.editingExpId);
    const listSpacingValue = useMemo(() => {
        return buildSpacingValue(LIST_SPACING_REM_BY_DENSITY[density], lineHeight);
    }, [density, lineHeight]);
    const bulletSpacingValue = useMemo(
        () => buildSpacingValue(LIST_SPACING_REM_BY_DENSITY.compact, lineHeight),
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
    const handleEditExperience = (id: string) => {
        setSidebarTab('experience');
        experience.startEditingExperience(id);
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
                onAdjustToSinglePage={adjustToSinglePage}
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
                        onAnalyze: handleAnalyze,
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
                        skillGroups,
                        selectedSkillIds,
                        skillMatchScores,
                        onResetRenamingCategory: resetRenamingCategory,
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
                    onSectionDragStart={handleSectionDragStart}
                    onSectionDragOver={handleSectionDragOver}
                    onSectionDrop={handleSectionDrop}
                    onItemDragStart={handleDragStart}
                    onItemDragOver={handleDragOver}
                    onItemDrop={handleDrop}
                    onNavigateTab={setSidebarTab}
                    onEditExperience={handleEditExperience}
                />
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
