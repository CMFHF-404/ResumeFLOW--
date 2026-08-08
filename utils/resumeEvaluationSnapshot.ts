import type {
  CertificationView,
  EducationView,
  ResumeEditorProfile,
  ResumeExperienceView,
  SkillGroupView,
} from "../types/resume";
import {
  buildCertificationAnalyzeEntry,
  buildEducationAnalyzeEntry,
  buildExperienceAnalyzeEntry,
  buildSkillAnalyzePayload,
} from "./resumeHelpers";
import { stripRichTextToText } from "./richText";

export type ResumeEvaluationFactMetadata = {
  fact_id: string;
  content: string;
  verification_status: "user_claimed";
  source: string;
  confidence: 1;
};

type BuildResumeEvaluationSnapshotParams = {
  profile: ResumeEditorProfile;
  personalSummary: string;
  hasPersonalSummaryOverride: boolean;
  isSummaryVisible: boolean;
  targetRole: string;
  experiences: ResumeExperienceView[];
  selectedExperienceIds: ReadonlySet<string>;
  educations: EducationView[];
  selectedEducationIds: ReadonlySet<string>;
  certifications: CertificationView[];
  selectedCertificationIds: ReadonlySet<string>;
  skillGroups: SkillGroupView[];
  selectedSkillIds: ReadonlySet<string>;
  sectionOrder?: readonly string[];
};

const DEFAULT_EVALUATION_SECTION_ORDER = [
  "summary",
  "education",
  "work",
  "project",
  "certifications",
  "skills",
] as const;
const EVALUATION_SECTION_IDS = new Set<string>(DEFAULT_EVALUATION_SECTION_ORDER);

const plainText = (value: unknown) => stripRichTextToText(String(value ?? "")).trim();

const buildFactCollector = () => {
  const facts: ResumeEvaluationFactMetadata[] = [];
  const add = (source: string, value: unknown) => {
    const content = plainText(value);
    if (!content) {
      return;
    }
    facts.push({
      fact_id: `FACT_${String(facts.length + 1).padStart(3, "0")}`,
      content,
      verification_status: "user_claimed",
      source,
      confidence: 1,
    });
  };
  return { facts, add };
};

const buildEvaluationExperience = (item: ResumeExperienceView) => ({
  ...buildExperienceAnalyzeEntry(item),
  category: item.category,
  star: {
    s: plainText(item.star.s),
    t: plainText(item.star.t),
    a: plainText(item.star.a),
    r: plainText(item.star.r),
  },
});

const buildEvaluationEducation = (item: EducationView) => {
  const education = buildEducationAnalyzeEntry(item);
  return {
    ...education,
    school: plainText(education.school),
    major: plainText(education.major),
    degree: plainText(education.degree),
    gpa: plainText(education.gpa) || undefined,
    courses: plainText(education.courses) || undefined,
  };
};

export const buildResumeEvaluationSnapshot = ({
  profile,
  personalSummary,
  hasPersonalSummaryOverride,
  isSummaryVisible,
  targetRole,
  experiences,
  selectedExperienceIds,
  educations,
  selectedEducationIds,
  certifications,
  selectedCertificationIds,
  skillGroups,
  selectedSkillIds,
  sectionOrder = DEFAULT_EVALUATION_SECTION_ORDER,
}: BuildResumeEvaluationSnapshotParams) => {
  const selectedExperiences = experiences.filter((item) => selectedExperienceIds.has(item.id));
  const selectedEducations = educations.filter((item) => selectedEducationIds.has(item.id));
  const selectedCertifications = certifications.filter((item) => selectedCertificationIds.has(item.id));
  const selectedSkillGroups = skillGroups
    .map((group) => ({
      ...group,
      skills: group.skills.filter((skill) => selectedSkillIds.has(skill.id)),
    }))
    .filter((group) => group.skills.length > 0);
  const selectedSkills = buildSkillAnalyzePayload(selectedSkillGroups);
  const allSkills = buildSkillAnalyzePayload(skillGroups);
  const resolvedSummary = isSummaryVisible
    ? plainText(hasPersonalSummaryOverride ? personalSummary : profile.summary)
    : "";
  const normalizedSectionOrder = [...sectionOrder, ...DEFAULT_EVALUATION_SECTION_ORDER]
    .filter((sectionId, index, items) => (
      EVALUATION_SECTION_IDS.has(sectionId)
      && items.indexOf(sectionId) === index
      && (sectionId !== "summary" || Boolean(resolvedSummary))
    ));
  const resumeProfile = {
    name: plainText(profile.name),
    email: plainText(profile.email),
    phone: plainText(profile.phone),
    location: plainText(profile.location),
    linkedin: plainText(profile.linkedin),
  };
  const { facts, add } = buildFactCollector();

  Object.entries(resumeProfile).forEach(([field, value]) => add(`resume.profile.${field}`, value));
  add("resume.personal_summary", resolvedSummary);
  selectedExperiences.forEach((item, index) => {
    const base = `resume.experiences[${index}]`;
    add(`${base}.org`, item.company);
    add(`${base}.title`, item.title);
    add(`${base}.start_date`, item.startDate);
    add(`${base}.end_date`, item.endDate);
    add(`${base}.star.s`, item.star.s);
    add(`${base}.star.t`, item.star.t);
    add(`${base}.star.a`, item.star.a);
    add(`${base}.star.r`, item.star.r);
  });
  selectedEducations.forEach((item, index) => {
    const base = `resume.educations[${index}]`;
    add(`${base}.school`, item.school);
    add(`${base}.major`, item.major);
    add(`${base}.degree`, item.degree);
    add(`${base}.start_date`, item.startDate);
    add(`${base}.end_date`, item.endDate);
    add(`${base}.gpa`, item.gpa);
    add(`${base}.courses`, item.courses);
  });
  selectedCertifications.forEach((item, index) => {
    const base = `resume.certifications[${index}]`;
    add(`${base}.name`, item.name);
    add(`${base}.issuer`, item.issuer);
    add(`${base}.issue_date`, item.date);
  });
  selectedSkills.forEach((item, index) => {
    add(`resume.skills[${index}].name`, item.name);
    add(`resume.skills[${index}].category`, item.category);
  });
  add("target_role", targetRole);

  return {
    evaluation_scope: "full_resume" as const,
    target_role: plainText(targetRole),
    resume: {
      section_order: normalizedSectionOrder,
      profile: resumeProfile,
      personal_summary: resolvedSummary,
      experiences: selectedExperiences.map(buildEvaluationExperience),
      educations: selectedEducations.map(buildEvaluationEducation),
      certifications: selectedCertifications.map(buildCertificationAnalyzeEntry),
      skills: selectedSkills,
    },
    experience_atoms: experiences.map(buildExperienceAnalyzeEntry),
    match_candidates: {
      certifications: certifications.map(buildCertificationAnalyzeEntry),
      skills: allSkills,
    },
    fact_metadata: facts,
  };
};

export type ResumeEvaluationSnapshot = ReturnType<typeof buildResumeEvaluationSnapshot>;
