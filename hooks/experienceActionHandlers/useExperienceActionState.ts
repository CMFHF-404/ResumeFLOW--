import { useRef, useState } from 'react';
import type {
    CertificationEditDraft,
    EducationEditDraft,
    ExperienceEditDraft,
    SkillDraftContext,
    SkillEditDraft,
} from '../../types/resume';
import type {
    CertificationState,
    EducationState,
    ExperienceState,
    SkillState,
} from './types';

export const useExperienceState = (): ExperienceState => {
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

export const useEducationState = (): EducationState => {
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

export const useCertificationState = (): CertificationState => {
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

export const useSkillState = (): SkillState => {
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
