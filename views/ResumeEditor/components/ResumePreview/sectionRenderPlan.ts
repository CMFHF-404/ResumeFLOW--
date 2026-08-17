export type ResumePreviewSectionLayout = 'split' | 'page';

export type ResumePreviewSectionPlan =
    | { kind: 'summary' }
    | { kind: 'experience'; experienceKind: 'work' | 'project'; title: '工作经历' | '项目经历' }
    | { kind: 'education'; variant: ResumePreviewSectionLayout; includeOverflowState: boolean }
    | { kind: 'certifications'; variant: ResumePreviewSectionLayout; includeOverflowState: boolean }
    | { kind: 'skills'; includeOverflowState: boolean };

export const resolveResumePreviewSectionPlan = (
    sectionId: string,
    layout: ResumePreviewSectionLayout,
): ResumePreviewSectionPlan | null => {
    if (sectionId === 'summary') {
        return { kind: 'summary' };
    }

    if (sectionId === 'work') {
        return { kind: 'experience', experienceKind: 'work', title: '工作经历' };
    }

    if (sectionId === 'project') {
        return { kind: 'experience', experienceKind: 'project', title: '项目经历' };
    }

    const includeOverflowState = layout === 'page';

    if (sectionId === 'education') {
        return { kind: 'education', variant: layout, includeOverflowState };
    }

    if (sectionId === 'certifications') {
        return { kind: 'certifications', variant: layout, includeOverflowState };
    }

    if (sectionId === 'skills') {
        return { kind: 'skills', includeOverflowState };
    }

    return null;
};
