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
  };
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

export type DatePayloadFallback = {
  start_date?: string;
  end_date?: string;
  is_current?: boolean;
};
