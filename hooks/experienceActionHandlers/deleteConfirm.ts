import type { ConfirmDialogState } from '../../types/resume';

type ConfirmedDeleteHandlers = {
    experience: {
        performDeleteExperience: (id: string) => Promise<void>;
    };
    education: {
        performDeleteEducation: (id: string) => Promise<void>;
    };
    certification: {
        performDeleteCertification: (id: string) => Promise<void>;
    };
    skill: {
        performDeleteSkill: (id: string) => Promise<void>;
        performDeleteSkillCategory: (categoryName: string) => Promise<void>;
    };
};

export const runConfirmedDelete = (
    dialog: ConfirmDialogState,
    handlers: ConfirmedDeleteHandlers
) => {
    const { id, type } = dialog;
    if (type === 'experience') {
        void handlers.experience.performDeleteExperience(id);
        return;
    }
    if (type === 'education') {
        void handlers.education.performDeleteEducation(id);
        return;
    }
    if (type === 'certification') {
        void handlers.certification.performDeleteCertification(id);
        return;
    }
    if (type === 'skill') {
        void handlers.skill.performDeleteSkill(id);
        return;
    }
    if (type === 'skillCategory') {
        void handlers.skill.performDeleteSkillCategory(id);
    }
};
