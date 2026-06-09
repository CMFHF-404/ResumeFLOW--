import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type {
    Certification as CertificationRecord,
    CertificationCreatePayload,
} from '../../services/certificationsService';
import type {
    ExperienceListItem,
    ExperienceUpdatePayload,
} from '../../services/experienceService';
import type {
    ResumeDetail,
    ResumeExperienceItem,
} from '../../services/resumeService';
import type { UserSkill } from '../../services/skillsService';
import type { MatchTrend } from '../../types/analysis';
import type {
    CertificationEditDraft,
    CertificationView,
    DatePayloadFallback,
    EducationEditDraft,
    EducationView,
    ExperienceEditDraft,
    ResumeExperienceView,
    SkillDraftContext,
    SkillEditDraft,
    SkillGroupView,
    StarFields,
} from '../../types/resume';

export type ToastApi = {
    success: (message: string, duration?: number) => string;
    error: (message: string, duration?: number) => string;
    loading: (message: string) => string;
    updateToast: (id: string, updates: { message?: string; type?: 'success' | 'error' | 'loading' | 'ai_thinking'; duration?: number }) => void;
    closeToast: (id: string) => void;
};

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
