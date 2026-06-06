import { useCallback } from 'react';
import type {
    ProfileSyncMode,
    ResumeEditorProfile,
} from '../../../types/resume';

type ResumeEditorTransientResetExperienceController = {
    cancelEditingExperience: () => void;
};

type ResumeEditorTransientResetEducationController = {
    cancelEducationEdit: () => void;
};

type ResumeEditorTransientResetCertificationController = {
    cancelCertificationEdit: () => void;
};

type ResumeEditorTransientResetSkillController = {
    cancelSkillEdit: () => void;
    setRenamingCategoryTarget: (value: string | null) => void;
    setRenamingCategoryDraft: (value: string) => void;
};

type UseResumeEditorTransientResetParams = {
    handleCancelDelete: () => void;
    setOriginalProfile: (profile: ResumeEditorProfile) => void;
    setOriginalProfileSyncMode: (mode: ProfileSyncMode) => void;
    setIsEditingProfile: (isEditing: boolean) => void;
    experience: ResumeEditorTransientResetExperienceController;
    education: ResumeEditorTransientResetEducationController;
    certification: ResumeEditorTransientResetCertificationController;
    skill: ResumeEditorTransientResetSkillController;
};

export function useResumeEditorTransientReset({
    handleCancelDelete,
    setOriginalProfile,
    setOriginalProfileSyncMode,
    setIsEditingProfile,
    experience,
    education,
    certification,
    skill,
}: UseResumeEditorTransientResetParams) {
    return useCallback((
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
}
