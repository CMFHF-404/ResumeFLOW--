import {
    useCallback,
    useState,
    type Dispatch,
    type SetStateAction,
} from 'react';
import {
    type ResumeDetail,
} from '../services/resumeService';
import type {
    CertificationEditDraft,
    ConfirmDialogState,
    EducationEditDraft,
    ExperienceEditDraft,
    ResumeExperienceView,
    SkillDraftContext,
    SkillEditDraft,
    StarFieldKey,
} from '../types/resume';
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
import type {
    CertificationDomain,
    CertificationState,
    ConfirmCopy,
    DraftPrefixes,
    EducationDomain,
    EducationState,
    ExperienceDefaults,
    ExperienceDomain,
    ExperienceHelpers,
    ExperienceState,
    MatchScoreDomain,
    SkillDomain,
    SkillState,
    ToastApi,
} from './experienceActionHandlers/types';
import {
    useCertificationState,
    useEducationState,
    useExperienceState,
    useSkillState,
} from './experienceActionHandlers/useExperienceActionState';

export type {
    CertificationDomain,
    CertificationState,
    ConfirmCopy,
    DraftPrefixes,
    EducationDomain,
    EducationState,
    ExperienceDefaults,
    ExperienceDomain,
    ExperienceHelpers,
    ExperienceState,
    MatchScoreDomain,
    SkillDomain,
    SkillState,
    ToastApi,
} from './experienceActionHandlers/types';

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

