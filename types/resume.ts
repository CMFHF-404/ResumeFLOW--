import type { Dispatch, DragEvent, ReactNode, SetStateAction } from "react";
import type { ResumeDetail } from "../services/resumeService";

export type StarFields = {
  s: string;
  t: string;
  a: string;
  r: string;
};

export type StarFieldKey = keyof StarFields;

export type ResumeExperienceView = {
  id: string;
  title: string;
  company: string;
  date: string;
  startDate?: string;
  endDate?: string;
  isCurrent?: boolean;
  star: StarFields;
  matchScore?: number;
  matchReason?: string;
  resumeLinkId?: string;
  experienceVersionId?: string;
  category: "work" | "project";
  isDraft?: boolean;
};

export type ExperienceListThemeStyles = {
  borderSelected: string;
  ringSelected: string;
  checkboxText: string;
  checkboxFocus: string;
  editHoverData: string;
  titleSelected: string;
};

export type ExperienceSectionHeaderProps = {
  title: string;
  icon?: ReactNode;
  onAddItem: () => void;
  actionLabel: string;
  isAdding: boolean;
  onResetSort?: () => void;
};

export type ExperienceListSectionProps = {
  title: string;
  items: ResumeExperienceView[];
  selectedIds: Set<string>;
  icon?: ReactNode;
  theme: "primary" | "project";
  actionLabel: string;
  onToggleSelection: (id: string) => void;
  onAddItem: () => void;
  onEditItem: (id: string) => void;
  onDeleteItem: (id: string) => void;
  deletingIds: Set<string>;
  staleExperienceIds: Set<string>;
  isAdding: boolean;
  onResetSort?: () => void;
};

export type ExperienceCardProps = {
  item: ResumeExperienceView;
  isSelected: boolean;
  themeStyles: ExperienceListThemeStyles;
  onToggleSelection: (id: string) => void;
  onDelete: (id: string) => void;
  onEdit: (id: string) => void;
  deletingIds: Set<string>;
  staleExperienceIds: Set<string>;
  dragItemKey?: string;
  onDragStart?: (event: DragEvent, itemKey: string) => void;
  onDragEnd?: () => void;
};

export type ResumeEditorProfile = {
  name: string;
  email: string;
  phone: string;
  location: string;
  linkedin: string;
  summary: string;
};

export type ProfileSyncMode = "global" | "local";

export type ResumeEditorConfig = {
  profile?: ResumeEditorProfile;
  profileSyncMode?: ProfileSyncMode;
  selection?: {
    experienceIds?: string[];
    educationIds?: string[];
    certificationIds?: string[];
    skillIds?: string[];
  };
  layout?: {
    sectionOrder?: string[];
    density?: "compact" | "standard" | "spacious";
    isSummaryVisible?: boolean;
    orders?: ResumeLayoutOrders;
  };
};

export type ResumeLayoutOrders = {
  workExperienceIds?: string[];
  projectExperienceIds?: string[];
  educationIds?: string[];
  certificationIds?: string[];
  skillGroupNames?: string[];
};

export type ActiveResumeContext = {
  id: string;
  detail: ResumeDetail | null;
};

export type CachedResumeResolveResult =
  | { status: "ok"; detail: ResumeDetail }
  | { status: "missing" }
  | { status: "error" };

export type ExperienceEditDraft = {
  masterId: string;
  title: string;
  company: string;
  startDate: string;
  endDate: string;
  isCurrent?: boolean;
  star: StarFields;
  category: ResumeExperienceView["category"];
  isDraft?: boolean;
};

export type EducationView = {
  id: string;
  school: string;
  major: string;
  degree: string;
  startDate: string;
  endDate: string;
  isCurrent?: boolean;
  gpa?: string;
  courses?: string;
  isDraft?: boolean;
};

export type CertificationView = {
  id: string;
  name: string;
  issuer?: string;
  date: string;
  matchRate?: number;
  isDraft?: boolean;
};

export type EducationEditDraft = {
  id?: string;
  school: string;
  major: string;
  degree: string;
  startDate: string;
  endDate: string;
  gpa: string;
  courses: string;
};

export type CertificationEditDraft = {
  id?: string;
  name: string;
  issuer: string;
  issueDate: string;
};

export type SkillEditDraft = {
  id?: string;
  name: string;
  category: string;
};

export type SkillDraftContext = {
  mode: "type" | "group" | "edit";
  groupName?: string;
};

export type ConfirmDialogState = {
  id: string;
  type: "experience" | "education" | "certification" | "skill" | "skillCategory";
  title: string;
  description: string;
};

export type SkillItemView = {
  id: string;
  name: string;
};

export type SkillGroupView = {
  name: string;
  skills: SkillItemView[];
};

export type ExperienceActions = {
  editingExpId: string | null;
  editingDraft: ExperienceEditDraft | null;
  syncToMaster: boolean;
  setSyncToMaster: Dispatch<SetStateAction<boolean>>;
  isSavingExperience: boolean;
  isAddingExperience: boolean;
  deletingExperienceIds: Set<string>;
  handleAddExperience: (category: ResumeExperienceView["category"]) => Promise<void>;
  startEditingExperience: (id: string) => void;
  cancelEditingExperience: () => void;
  updateEditingStar: (field: StarFieldKey, value: string) => void;
  updateEditingMeta: (field: "company" | "title", value: string) => void;
  updateEditingDate: (field: "startDate" | "endDate", value: string) => void;
  handleSaveExperience: () => Promise<void>;
  requestDeleteExperience: (id: string) => void;
};

export type CertificationActions = {
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

export type SkillActions = {
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

export type SelectionActions = {
  toggleExperienceSelection: (id: string) => void;
  toggleCertificationSelection: (id: string) => void;
  toggleSkillSelection: (id: string) => void;
};

export type ExperienceTabProps = {
  experience: ExperienceActions;
  certification: CertificationActions;
  skill: SkillActions;
  selection: SelectionActions;
  workItems: ResumeExperienceView[];
  projectItems: ResumeExperienceView[];
  selectedExpIds: Set<string>;
  staleExperienceIds: Set<string>;
  sortedCertifications: CertificationView[];
  selectedCertIds: Set<string>;
  certificationMatchScores: Map<string, number>;
  skillGroups: SkillGroupView[];
  selectedSkillIds: Set<string>;
  skillMatchScores: Map<string, number>;
  onResetRenamingCategory: () => void;
  onResetWorkSort?: () => void;
  onResetProjectSort?: () => void;
};

export type DatePayloadFallback = {
  start_date?: string;
  end_date?: string;
  is_current?: boolean;
};
