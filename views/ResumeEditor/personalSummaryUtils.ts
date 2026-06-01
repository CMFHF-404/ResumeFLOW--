import type {
    CertificationView,
    EducationView,
    ResumeEditorProfile,
    ResumeExperienceView,
    SkillGroupView,
} from '../../types/resume';
import { stripRichTextToText } from '../../utils/richText';

export type PersonalSummarySource = {
    isSummaryVisible: boolean;
    personalSummary: string;
    hasPersonalSummaryOverride: boolean;
    profileSummary: string;
};

export type PersonalSummaryContextInput = {
    profile: ResumeEditorProfile;
    selectedWorkItems: ResumeExperienceView[];
    selectedProjectItems: ResumeExperienceView[];
    selectedEducations: EducationView[];
    selectedCertifications: CertificationView[];
    selectedSkillGroups: SkillGroupView[];
};

export const resolveEditablePersonalSummary = ({
    personalSummary,
    hasPersonalSummaryOverride,
    profileSummary,
}: Pick<PersonalSummarySource, 'personalSummary' | 'hasPersonalSummaryOverride' | 'profileSummary'>) => (
    hasPersonalSummaryOverride ? personalSummary : profileSummary
);

export const hasMeaningfulPersonalSummary = (value: string) => (
    Boolean(stripRichTextToText(value).trim())
);

export const resolveEffectivePersonalSummary = ({
    isSummaryVisible,
    personalSummary,
    hasPersonalSummaryOverride,
    profileSummary,
}: PersonalSummarySource) => {
    if (!isSummaryVisible) {
        return '';
    }
    if (hasPersonalSummaryOverride) {
        return personalSummary.trim();
    }
    return profileSummary.trim();
};

export const buildPersonalSummaryContext = ({
    profile,
    selectedWorkItems,
    selectedProjectItems,
    selectedEducations,
    selectedCertifications,
    selectedSkillGroups,
}: PersonalSummaryContextInput) => ({
    profile: {
        name: profile.name,
        email: profile.email,
        phone: profile.phone,
        location: profile.location,
        linkedin: profile.linkedin,
    },
    workExperiences: selectedWorkItems.map((item) => ({
        id: item.id,
        title: item.title,
        org: item.company,
        start_date: item.startDate,
        end_date: item.endDate,
        is_current: item.isCurrent ?? false,
        star: item.star,
    })),
    projectExperiences: selectedProjectItems.map((item) => ({
        id: item.id,
        title: item.title,
        org: item.company,
        start_date: item.startDate,
        end_date: item.endDate,
        is_current: item.isCurrent ?? false,
        star: item.star,
    })),
    educationExperiences: selectedEducations.map((item) => ({
        id: item.id,
        school: item.school,
        major: item.major,
        degree: item.degree,
        start_date: item.startDate,
        end_date: item.endDate,
        is_current: item.isCurrent ?? false,
        gpa: item.gpa || '',
        courses: item.courses || '',
    })),
    certifications: selectedCertifications.map((item) => ({
        id: item.id,
        name: item.name,
        issuer: item.issuer || '',
        issue_date: item.date,
    })),
    skills: selectedSkillGroups.flatMap((group) =>
        group.skills.map((skill) => ({
            id: skill.id,
            name: skill.name,
            category: group.name,
        }))
    ),
});
