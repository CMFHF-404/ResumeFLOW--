import {
    useCallback,
    useRef,
    useState,
    type Dispatch,
    type MutableRefObject,
    type SetStateAction,
} from 'react';
import { aiService } from '../services/aiService';
import {
    certificationsService,
    Certification as CertificationRecord,
    type CertificationCreatePayload,
} from '../services/certificationsService';
import {
    experienceService,
    type ExperienceDetail,
    type ExperienceListItem,
    type ExperienceUpdatePayload,
    type ExperienceVersion,
} from '../services/experienceService';
import {
    resumeService,
    type ResumeDetail,
    type ResumeExperienceItem,
} from '../services/resumeService';
import type { UserSkill } from '../services/skillsService';
import type { MatchTrend } from '../types/analysis';
import { normalizeAiRichText } from '../utils/richText';
import { extractThoughtHeadline } from '../utils/aiThought';
import {
    trackAiPolishApplied,
    trackAiPolishResult,
    trackAiPolishStart,
    trackResumeCardChecked,
} from '../utils/analyticsTracker';
import type {
    CertificationEditDraft,
    CertificationView,
    ConfirmDialogState,
    DatePayloadFallback,
    EducationEditDraft,
    EducationView,
    ExperienceEditDraft,
    ResumeExperienceView,
    SkillDraftContext,
    SkillEditDraft,
    SkillGroupView,
    StarFieldKey,
    StarFields,
} from '../types/resume';
import {
    addToSet,
    createDraftId,
    deleteMapEntry,
    isDraftId,
    removeFromSet,
    runWithFlag,
    setMapEntry,
    toggleInSet,
} from './experienceActionHandlers/collectionUtils';
import {
    hasStarFieldsChange,
    resolveStarPayload,
} from './experienceActionHandlers/starPayload';
import { runConfirmedDelete } from './experienceActionHandlers/deleteConfirm';
import {
    createExperienceDeleteHandlers,
    createExperienceDraftLifecycleHandlers,
    createExperienceEditHandlers,
    createExperienceSaveHandlers,
    createExperienceSelectionHandlers,
    createExperienceUpdateHelpers,
} from './experienceActionHandlers/experienceHandlers';
import { createEducationHandlers, createCertificationHandlers } from './experienceActionHandlers/educationCertificationHandlers';
import { createSkillHandlers } from './experienceActionHandlers/skillHandlers';

export type ToastApi = {
    success: (message: string, duration?: number) => string;
    error: (message: string, duration?: number) => string;
    loading: (message: string) => string;
    updateToast: (id: string, updates: { message?: string; type?: 'success' | 'error' | 'loading' | 'ai_thinking'; duration?: number }) => void;
    closeToast: (id: string) => void;
};

const JD_POLISH_TOAST_MESSAGES = {
    loading: '正在基于 JD 润色...',
    success: 'JD 润色完成',
    noChange: 'JD 润色完成，但未产生可用调整',
    error: 'JD 润色失败，请稍后重试',
    emptyJd: '请先填写 JD 再润色',
} as const;
const JD_POLISH_TOAST_DURATION_MS = 2500;
const JD_POLISH_TOAST_ERROR_DURATION_MS = 3000;

export type ExperienceDefaults = {
    experienceTitleByCategory: Record<ResumeExperienceView['category'], string>;
    experienceCompanyByCategory: Record<ResumeExperienceView['category'], string>;
    skillName: string;
    skillCategory: string;
};

export type ExperienceHelpers = {
    buildResumeExperienceView: (item: ExperienceListItem, resumeItem?: ResumeExperienceItem) => ResumeExperienceView;
    buildDraftExperienceView: (category: ResumeExperienceView['category'], draftId: string) => ResumeExperienceView;
    buildExperienceEditDraft: (item: ResumeExperienceView) => ExperienceEditDraft;
    buildResumeExperienceMap: (detail: ResumeDetail | null) => Map<string, ResumeExperienceItem>;
    buildExperienceDate: (start?: string, end?: string, isCurrent?: boolean) => string;
    buildStarFields: (star?: Record<string, any>) => StarFields;
    mergeStarFieldsWithSource: (draft: StarFields, sourceStar?: Record<string, any>) => StarFields;
    mergeStarFields: (base: StarFields, updates: Partial<StarFields>) => StarFields;
    resolveExperienceDatePayload: (draft: ExperienceEditDraft, fallback?: DatePayloadFallback) => {
        startDate?: string;
        endDate?: string;
        isCurrent: boolean;
    };
    resolveEducationDatePayload: (draft: EducationEditDraft, fallback?: DatePayloadFallback) => {
        startDate?: string;
        endDate?: string;
        isCurrent: boolean;
    };
    resolveSafeDateRange: (start: string, end: string) => { start: string; end: string };
    isPresentLabel: (value?: string) => boolean;
    sortByCategory: (
        items: ResumeExperienceView[],
        compare: (a: ResumeExperienceView, b: ResumeExperienceView) => number
    ) => ResumeExperienceView[];
    compareByDateDesc: (a: ResumeExperienceView, b: ResumeExperienceView) => number;
    compareCertificationByDateDesc: (a: CertificationView, b: CertificationView) => number;
    buildEducationDraft: (source?: ExperienceListItem, draftId?: string) => EducationEditDraft;
    buildDraftEducationView: (draftId: string, draft: EducationEditDraft) => EducationView;
    buildEducationView: (item: ExperienceListItem) => EducationView;
    buildEducationVersionPayload: (
        source: ExperienceListItem | null,
        draft: EducationEditDraft
    ) => ExperienceUpdatePayload['version'];
    buildCertificationDraft: (source?: CertificationRecord) => CertificationEditDraft;
    buildDraftCertificationView: (draftId: string, draft: CertificationEditDraft) => CertificationView;
    buildCertificationView: (record: CertificationRecord) => CertificationView;
    buildCertificationPayload: (draft: CertificationEditDraft) => CertificationCreatePayload;
    buildSkillGroups: (skills: UserSkill[]) => SkillGroupView[];
};

export type ConfirmCopy = {
    experience: { title: string; description: string };
    education: { title: string; description: string };
    certification: { title: string; description: string };
    skill: { title: string; description: string };
    skillCategory: { title: string; description: string };
};

export type DraftPrefixes = {
    experience: string;
    education: string;
    certification: string;
};

export type ExperienceDomain = {
    items: ResumeExperienceView[];
    setItems: Dispatch<SetStateAction<ResumeExperienceView[]>>;
    selectedIds: Set<string>;
    setSelectedIds: Dispatch<SetStateAction<Set<string>>>;
    resumeMap: Map<string, ResumeExperienceItem>;
    setResumeMap: Dispatch<SetStateAction<Map<string, ResumeExperienceItem>>>;
    sourceMap: Map<string, ExperienceListItem>;
    setSourceMap: Dispatch<SetStateAction<Map<string, ExperienceListItem>>>;
};

export type EducationDomain = {
    items: EducationView[];
    setItems: Dispatch<SetStateAction<EducationView[]>>;
    selectedIds: Set<string>;
    setSelectedIds: Dispatch<SetStateAction<Set<string>>>;
    sourceMap: Map<string, ExperienceListItem>;
    setSourceMap: Dispatch<SetStateAction<Map<string, ExperienceListItem>>>;
};

export type CertificationDomain = {
    items: CertificationView[];
    setItems: Dispatch<SetStateAction<CertificationView[]>>;
    selectedIds: Set<string>;
    setSelectedIds: Dispatch<SetStateAction<Set<string>>>;
    sourceMap: Map<string, CertificationRecord>;
    setSourceMap: Dispatch<SetStateAction<Map<string, CertificationRecord>>>;
};

export type SkillDomain = {
    groups: SkillGroupView[];
    setGroups: Dispatch<SetStateAction<SkillGroupView[]>>;
    selectedIds: Set<string>;
    setSelectedIds: Dispatch<SetStateAction<Set<string>>>;
};

export type MatchScoreDomain = {
    setCertificationMatchScores: Dispatch<SetStateAction<Map<string, number>>>;
    setCertificationMatchTrends: Dispatch<SetStateAction<Map<string, MatchTrend>>>;
    setSkillMatchScores: Dispatch<SetStateAction<Map<string, number>>>;
    setSkillMatchTrends: Dispatch<SetStateAction<Map<string, MatchTrend>>>;
};

type UseExperienceActionsOptions = {
    resumeId: string | null;
    jdText: string;
    toast: ToastApi;
    applyResumeDetail: (detail: ResumeDetail | null) => void;
    onExperienceDraftPersisted?: (draftMasterId: string, savedMasterId: string) => void;
    onExperienceAiPolishPrepared?: (masterId: string) => void;
    onExperienceSaveSuccess?: (masterId: string) => Promise<void>;
    onExperienceEditDiscarded?: (masterId: string | null) => void;
    experience: ExperienceDomain;
    education: EducationDomain;
    certification: CertificationDomain;
    skill: SkillDomain;
    jdMatch: MatchScoreDomain;
    helpers: ExperienceHelpers;
    defaults: ExperienceDefaults;
    confirmCopy: ConfirmCopy;
    draftPrefixes: DraftPrefixes;
};

type UseExperienceActionsResult = {
    confirmDialog: ConfirmDialogState | null;
    handleConfirmDelete: () => void;
    handleCancelDelete: () => void;
    experience: {
        editingExpId: string | null;
        editingDraft: ExperienceEditDraft | null;
        setEditingDraft: Dispatch<SetStateAction<ExperienceEditDraft | null>>;
        syncToMaster: boolean;
        setSyncToMaster: Dispatch<SetStateAction<boolean>>;
        isSavingExperience: boolean;
        isAddingExperience: boolean;
        isPolishing: boolean;
        deletingExperienceIds: Set<string>;
        handleAddExperience: (category: ResumeExperienceView['category']) => Promise<void>;
        startEditingExperience: (id: string) => void;
        cancelEditingExperience: () => void;
        updateEditingStar: (field: StarFieldKey, value: string) => void;
        updateEditingMeta: (field: 'company' | 'title', value: string) => void;
        updateEditingDate: (field: 'startDate' | 'endDate', value: string) => void;
        handleSaveExperience: () => Promise<void>;
        handlePolishWithJD: () => Promise<void>;
        handlePolishExperienceById: (id: string) => Promise<boolean>;
        requestDeleteExperience: (id: string) => void;
    };
    education: {
        editingEducationId: string | null;
        educationDraft: EducationEditDraft | null;
        isSavingEducation: boolean;
        deletingEducationIds: Set<string>;
        beginCreateEducation: () => void;
        beginEditEducation: (id: string) => void;
        cancelEducationEdit: () => void;
        updateEducationDraft: (field: keyof EducationEditDraft, value: string) => void;
        updateEducationDate: (field: 'startDate' | 'endDate', value: string) => void;
        handleSaveEducation: () => Promise<void>;
        requestDeleteEducation: (id: string) => void;
    };
    certification: {
        editingCertificationId: string | null;
        certificationDraft: CertificationEditDraft | null;
        isSavingCertification: boolean;
        deletingCertificationIds: Set<string>;
        beginCreateCertification: () => void;
        beginEditCertification: (id: string) => void;
        cancelCertificationEdit: () => void;
        updateCertificationDraft: (field: keyof CertificationEditDraft, value: string) => void;
        handleSaveCertification: () => Promise<void>;
        requestDeleteCertification: (id: string) => void;
    };
    skill: {
        editingSkillId: string | null;
        skillDraft: SkillEditDraft | null;
        skillDraftContext: SkillDraftContext | null;
        isSavingSkill: boolean;
        deletingSkillIds: Set<string>;
        deletingSkillCategories: Set<string>;
        renamingCategoryTarget: string | null;
        renamingCategoryDraft: string;
        setRenamingCategoryTarget: Dispatch<SetStateAction<string | null>>;
        setRenamingCategoryDraft: Dispatch<SetStateAction<string>>;
        beginCreateSkillType: () => void;
        beginCreateSkillInGroup: (groupName: string) => void;
        beginEditSkill: (id: string) => void;
        cancelSkillEdit: () => void;
        updateSkillDraft: (field: keyof SkillEditDraft, value: string) => void;
        handleSaveSkill: () => Promise<void>;
        handleRenameCategory: (oldName: string, newName: string) => Promise<void>;
        requestDeleteSkill: (id: string) => void;
        requestDeleteSkillCategory: (categoryName: string) => void;
    };
    selection: {
        toggleExperienceSelection: (id: string) => void;
        toggleEducationSelection: (id: string) => void;
        toggleCertificationSelection: (id: string) => void;
        toggleSkillSelection: (id: string) => void;
        toggleSkillGroupSelection: (groupName: string, skillIds?: string[]) => void;
    };
};

export type ExperienceState = {
    editingExpId: string | null;
    setEditingExpId: Dispatch<SetStateAction<string | null>>;
    editingDraft: ExperienceEditDraft | null;
    setEditingDraft: Dispatch<SetStateAction<ExperienceEditDraft | null>>;
    syncToMaster: boolean;
    setSyncToMaster: Dispatch<SetStateAction<boolean>>;
    isSavingExperience: boolean;
    setIsSavingExperience: Dispatch<SetStateAction<boolean>>;
    isAddingExperience: boolean;
    setIsAddingExperience: Dispatch<SetStateAction<boolean>>;
    isPolishing: boolean;
    setIsPolishing: Dispatch<SetStateAction<boolean>>;
    deletingExperienceIds: Set<string>;
    setDeletingExperienceIds: Dispatch<SetStateAction<Set<string>>>;
    editSessionRef: MutableRefObject<number>;
    collectionVersionRef: MutableRefObject<number>;
};

export type EducationState = {
    editingEducationId: string | null;
    setEditingEducationId: Dispatch<SetStateAction<string | null>>;
    educationDraft: EducationEditDraft | null;
    setEducationDraft: Dispatch<SetStateAction<EducationEditDraft | null>>;
    isSavingEducation: boolean;
    setIsSavingEducation: Dispatch<SetStateAction<boolean>>;
    deletingEducationIds: Set<string>;
    setDeletingEducationIds: Dispatch<SetStateAction<Set<string>>>;
};

export type CertificationState = {
    editingCertificationId: string | null;
    setEditingCertificationId: Dispatch<SetStateAction<string | null>>;
    certificationDraft: CertificationEditDraft | null;
    setCertificationDraft: Dispatch<SetStateAction<CertificationEditDraft | null>>;
    isSavingCertification: boolean;
    setIsSavingCertification: Dispatch<SetStateAction<boolean>>;
    deletingCertificationIds: Set<string>;
    setDeletingCertificationIds: Dispatch<SetStateAction<Set<string>>>;
};

export type SkillState = {
    editingSkillId: string | null;
    setEditingSkillId: Dispatch<SetStateAction<string | null>>;
    skillDraft: SkillEditDraft | null;
    setSkillDraft: Dispatch<SetStateAction<SkillEditDraft | null>>;
    skillDraftContext: SkillDraftContext | null;
    setSkillDraftContext: Dispatch<SetStateAction<SkillDraftContext | null>>;
    isSavingSkill: boolean;
    setIsSavingSkill: Dispatch<SetStateAction<boolean>>;
    deletingSkillIds: Set<string>;
    setDeletingSkillIds: Dispatch<SetStateAction<Set<string>>>;
    deletingSkillCategories: Set<string>;
    setDeletingSkillCategories: Dispatch<SetStateAction<Set<string>>>;
    renamingCategoryTarget: string | null;
    setRenamingCategoryTarget: Dispatch<SetStateAction<string | null>>;
    renamingCategoryDraft: string;
    setRenamingCategoryDraft: Dispatch<SetStateAction<string>>;
};

const useExperienceState = (): ExperienceState => {
    const [editingExpId, setEditingExpId] = useState<string | null>(null);
    const [editingDraft, setEditingDraft] = useState<ExperienceEditDraft | null>(null);
    const [syncToMaster, setSyncToMaster] = useState(false);
    const [isSavingExperience, setIsSavingExperience] = useState(false);
    const [isAddingExperience, setIsAddingExperience] = useState(false);
    const [isPolishing, setIsPolishing] = useState(false);
    const [deletingExperienceIds, setDeletingExperienceIds] = useState<Set<string>>(new Set());
    const editSessionRef = useRef(0);
    const collectionVersionRef = useRef(0);

    return {
        editingExpId,
        setEditingExpId,
        editingDraft,
        setEditingDraft,
        syncToMaster,
        setSyncToMaster,
        isSavingExperience,
        setIsSavingExperience,
        isAddingExperience,
        setIsAddingExperience,
        isPolishing,
        setIsPolishing,
        deletingExperienceIds,
        setDeletingExperienceIds,
        editSessionRef,
        collectionVersionRef,
    };
};

const useEducationState = (): EducationState => {
    const [editingEducationId, setEditingEducationId] = useState<string | null>(null);
    const [educationDraft, setEducationDraft] = useState<EducationEditDraft | null>(null);
    const [isSavingEducation, setIsSavingEducation] = useState(false);
    const [deletingEducationIds, setDeletingEducationIds] = useState<Set<string>>(new Set());

    return {
        editingEducationId,
        setEditingEducationId,
        educationDraft,
        setEducationDraft,
        isSavingEducation,
        setIsSavingEducation,
        deletingEducationIds,
        setDeletingEducationIds,
    };
};

const useCertificationState = (): CertificationState => {
    const [editingCertificationId, setEditingCertificationId] = useState<string | null>(null);
    const [certificationDraft, setCertificationDraft] = useState<CertificationEditDraft | null>(null);
    const [isSavingCertification, setIsSavingCertification] = useState(false);
    const [deletingCertificationIds, setDeletingCertificationIds] = useState<Set<string>>(new Set());

    return {
        editingCertificationId,
        setEditingCertificationId,
        certificationDraft,
        setCertificationDraft,
        isSavingCertification,
        setIsSavingCertification,
        deletingCertificationIds,
        setDeletingCertificationIds,
    };
};

const useSkillState = (): SkillState => {
    const [editingSkillId, setEditingSkillId] = useState<string | null>(null);
    const [skillDraft, setSkillDraft] = useState<SkillEditDraft | null>(null);
    const [skillDraftContext, setSkillDraftContext] = useState<SkillDraftContext | null>(null);
    const [isSavingSkill, setIsSavingSkill] = useState(false);
    const [deletingSkillIds, setDeletingSkillIds] = useState<Set<string>>(new Set());
    const [deletingSkillCategories, setDeletingSkillCategories] = useState<Set<string>>(new Set());
    const [renamingCategoryTarget, setRenamingCategoryTarget] = useState<string | null>(null);
    const [renamingCategoryDraft, setRenamingCategoryDraft] = useState('');

    return {
        editingSkillId,
        setEditingSkillId,
        skillDraft,
        setSkillDraft,
        skillDraftContext,
        setSkillDraftContext,
        isSavingSkill,
        setIsSavingSkill,
        deletingSkillIds,
        setDeletingSkillIds,
        deletingSkillCategories,
        setDeletingSkillCategories,
        renamingCategoryTarget,
        setRenamingCategoryTarget,
        renamingCategoryDraft,
        setRenamingCategoryDraft,
    };
};

export const useExperienceActions = (options: UseExperienceActionsOptions): UseExperienceActionsResult => {
    const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);

    const openDeleteConfirm = useCallback((payload: ConfirmDialogState) => {
        setConfirmDialog(payload);
    }, []);

    const handleCancelDelete = useCallback(() => {
        setConfirmDialog(null);
    }, []);

    const experienceState = useExperienceState();
    const educationState = useEducationState();
    const certificationState = useCertificationState();
    const skillState = useSkillState();

    const draftHandlers = createExperienceDraftLifecycleHandlers(
        options.experience,
        options.helpers,
        experienceState,
        options.draftPrefixes
    );
    const editHandlers = createExperienceEditHandlers(
        options.experience,
        options.helpers,
        experienceState,
        draftHandlers,
        options.onExperienceEditDiscarded,
    );
    const updateHelpers = createExperienceUpdateHelpers(options.experience, options.helpers);
    const saveHandlers = createExperienceSaveHandlers(
        options.resumeId,
        options.jdText,
        options.toast,
        options.experience,
        options.helpers,
        options.defaults,
        experienceState,
        updateHelpers,
        draftHandlers,
        options.applyResumeDetail,
        options.onExperienceDraftPersisted,
        options.onExperienceAiPolishPrepared,
        options.onExperienceSaveSuccess,
    );
    const deleteHandlers = createExperienceDeleteHandlers(
        options.experience,
        experienceState,
        editHandlers,
        draftHandlers,
        options.draftPrefixes,
        openDeleteConfirm,
        options.confirmCopy
    );
    const experienceSelection = createExperienceSelectionHandlers(options.experience);

    const educationHandlers = createEducationHandlers(
        options.education,
        options.helpers,
        educationState,
        options.draftPrefixes,
        options.confirmCopy,
        openDeleteConfirm
    );

    const certificationHandlers = createCertificationHandlers(
        options.certification,
        options.helpers,
        certificationState,
        options.draftPrefixes,
        options.confirmCopy,
        openDeleteConfirm,
        options.jdMatch
    );

    const skillHandlers = createSkillHandlers(
        options.skill,
        options.helpers,
        skillState,
        options.defaults,
        options.confirmCopy,
        openDeleteConfirm,
        options.jdMatch
    );

    const handleConfirmDelete = useCallback(() => {
        if (!confirmDialog) {
            return;
        }
        setConfirmDialog(null);
        runConfirmedDelete(confirmDialog, {
            experience: deleteHandlers,
            education: educationHandlers,
            certification: certificationHandlers,
            skill: skillHandlers,
        });
    }, [
        certificationHandlers,
        confirmDialog,
        deleteHandlers,
        educationHandlers,
        skillHandlers,
    ]);

    return {
        confirmDialog,
        handleConfirmDelete,
        handleCancelDelete,
        experience: {
            editingExpId: experienceState.editingExpId,
            editingDraft: experienceState.editingDraft,
            setEditingDraft: experienceState.setEditingDraft,
            syncToMaster: experienceState.syncToMaster,
            setSyncToMaster: experienceState.setSyncToMaster,
            isSavingExperience: experienceState.isSavingExperience,
            isAddingExperience: experienceState.isAddingExperience,
            isPolishing: experienceState.isPolishing,
            deletingExperienceIds: experienceState.deletingExperienceIds,
            handleAddExperience: async (category) => {
                if (experienceState.isAddingExperience) {
                    return;
                }
                experienceState.setIsAddingExperience(true);
                try {
                    draftHandlers.addDraftExperience(category);
                } finally {
                    experienceState.setIsAddingExperience(false);
                }
            },
            startEditingExperience: editHandlers.startEditingExperience,
            cancelEditingExperience: editHandlers.cancelEditingExperience,
            updateEditingStar: editHandlers.updateEditingStar,
            updateEditingMeta: editHandlers.updateEditingMeta,
            updateEditingDate: editHandlers.updateEditingDate,
            handleSaveExperience: saveHandlers.handleSaveExperience,
            handlePolishWithJD: saveHandlers.handlePolishWithJD,
            handlePolishExperienceById: saveHandlers.handlePolishExperienceById,
            requestDeleteExperience: deleteHandlers.requestDeleteExperience,
        },
        education: {
            editingEducationId: educationState.editingEducationId,
            educationDraft: educationState.educationDraft,
            isSavingEducation: educationState.isSavingEducation,
            deletingEducationIds: educationState.deletingEducationIds,
            beginCreateEducation: educationHandlers.beginCreateEducation,
            beginEditEducation: educationHandlers.beginEditEducation,
            cancelEducationEdit: educationHandlers.cancelEducationEdit,
            updateEducationDraft: educationHandlers.updateEducationDraft,
            updateEducationDate: educationHandlers.updateEducationDate,
            handleSaveEducation: educationHandlers.handleSaveEducation,
            requestDeleteEducation: educationHandlers.requestDeleteEducation,
        },
        certification: {
            editingCertificationId: certificationState.editingCertificationId,
            certificationDraft: certificationState.certificationDraft,
            isSavingCertification: certificationState.isSavingCertification,
            deletingCertificationIds: certificationState.deletingCertificationIds,
            beginCreateCertification: certificationHandlers.beginCreateCertification,
            beginEditCertification: certificationHandlers.beginEditCertification,
            cancelCertificationEdit: certificationHandlers.cancelCertificationEdit,
            updateCertificationDraft: certificationHandlers.updateCertificationDraft,
            handleSaveCertification: certificationHandlers.handleSaveCertification,
            requestDeleteCertification: certificationHandlers.requestDeleteCertification,
        },
        skill: {
            editingSkillId: skillState.editingSkillId,
            skillDraft: skillState.skillDraft,
            skillDraftContext: skillState.skillDraftContext,
            isSavingSkill: skillState.isSavingSkill,
            deletingSkillIds: skillState.deletingSkillIds,
            deletingSkillCategories: skillState.deletingSkillCategories,
            renamingCategoryTarget: skillState.renamingCategoryTarget,
            renamingCategoryDraft: skillState.renamingCategoryDraft,
            setRenamingCategoryTarget: skillState.setRenamingCategoryTarget,
            setRenamingCategoryDraft: skillState.setRenamingCategoryDraft,
            beginCreateSkillType: skillHandlers.beginCreateSkillType,
            beginCreateSkillInGroup: skillHandlers.beginCreateSkillInGroup,
            beginEditSkill: skillHandlers.beginEditSkill,
            cancelSkillEdit: skillHandlers.cancelSkillEdit,
            updateSkillDraft: skillHandlers.updateSkillDraft,
            handleSaveSkill: skillHandlers.handleSaveSkill,
            handleRenameCategory: skillHandlers.handleRenameCategory,
            requestDeleteSkill: skillHandlers.requestDeleteSkill,
            requestDeleteSkillCategory: skillHandlers.requestDeleteSkillCategory,
        },
        selection: {
            toggleExperienceSelection: experienceSelection.toggleExperienceSelection,
            toggleEducationSelection: educationHandlers.toggleEducationSelection,
            toggleCertificationSelection: certificationHandlers.toggleCertificationSelection,
            toggleSkillSelection: skillHandlers.toggleSkillSelection,
            toggleSkillGroupSelection: skillHandlers.toggleSkillGroupSelection,
        },
    };
};

