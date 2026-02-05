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
    PROFILE_SYNC_MODES,
    SMART_PAGE_HEIGHT_TOLERANCE,
    SMART_PAGE_MIN_SCALE,
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
    const editingItem = experienceItems.find((item) => item.id === experience.editingExpId);
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
    const handleEditExperience = (id: string) => {
        setSidebarTab('experience');
        experience.startEditingExperience(id);
    };
    const handleToggleJdCollapse = () => {
        setIsJDCollapsed((prev) => !prev);
    };
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
                    resumeScale={resumeScale}
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
