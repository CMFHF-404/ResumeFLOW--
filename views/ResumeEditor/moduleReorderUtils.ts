import type {
    CertificationView,
    EducationView,
    ResumeExperienceView,
    SkillGroupView,
} from '../../types/resume';
import type { DragItemType } from './dragKeys';

export type ModuleReorderContext = {
    moduleType: 'experience' | 'education' | 'certification' | 'skill_group' | 'section';
    moduleKey: string;
    id: string;
    fromPosition: number;
    sectionId?: string;
    category?: 'work' | 'project';
};

export type ReorderStateSnapshot = {
    experienceItems: ResumeExperienceView[];
    educations: EducationView[];
    certifications: CertificationView[];
    skillGroups: SkillGroupView[];
    sectionOrder: string[];
};

export const mapDragTypeToModuleType = (dragType: DragItemType): ModuleReorderContext['moduleType'] => (
    dragType === 'skillGroup' ? 'skill_group' : dragType
);

export const resolveModuleKey = (
    moduleType: ModuleReorderContext['moduleType'],
    category?: ModuleReorderContext['category'],
    sectionId?: string
) => {
    if (moduleType === 'experience' && category) {
        return `experience:${category}`;
    }
    if (moduleType === 'section' && sectionId) {
        return `section:${sectionId}`;
    }
    return moduleType;
};
