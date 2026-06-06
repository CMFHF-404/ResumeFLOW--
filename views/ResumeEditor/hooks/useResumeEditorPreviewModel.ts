import { useMemo } from 'react';
import type {
    CertificationView,
    EducationView,
    ResumeEditorProfile,
    ResumeExperienceView,
    SectionSpacingKey,
    SkillGroupView,
} from '../../../types/resume';
import { buildResumeAISnapshot } from '../../../utils/resumeHelpers';
import {
    buildSpacingValue,
    resolveSectionSpacingClass,
    type SmartPageLayout,
} from '../layoutUtils';
import {
    buildPersonalSummaryContext,
    hasMeaningfulPersonalSummary,
    resolveEditablePersonalSummary,
    resolveEffectivePersonalSummary,
} from '../personalSummaryUtils';
import { buildStableResumeSnapshotText } from '../snapshotUtils';
import { LIST_SPACING_BY_DENSITY } from '../constants';

type UseResumeEditorPreviewModelOptions = {
    itemSpacingEm: number;
    lineHeight: number;
    sectionSpacingKey: SectionSpacingKey;
    measureLayout: SmartPageLayout;
    experienceItems: ResumeExperienceView[];
    selectedExpIds: Set<string>;
    educations: EducationView[];
    selectedEduIds: Set<string>;
    certifications: CertificationView[];
    selectedCertIds: Set<string>;
    skillGroups: SkillGroupView[];
    selectedSkillIds: Set<string>;
    profile: ResumeEditorProfile;
    personalSummary: string;
    hasPersonalSummaryOverride: boolean;
    isSummaryVisible: boolean;
};

export const useResumeEditorPreviewModel = ({
    itemSpacingEm,
    lineHeight,
    sectionSpacingKey,
    measureLayout,
    experienceItems,
    selectedExpIds,
    educations,
    selectedEduIds,
    certifications,
    selectedCertIds,
    skillGroups,
    selectedSkillIds,
    profile,
    personalSummary,
    hasPersonalSummaryOverride,
    isSummaryVisible,
}: UseResumeEditorPreviewModelOptions) => {
    const listSpacingValue = useMemo(() => {
        return buildSpacingValue(itemSpacingEm, lineHeight);
    }, [itemSpacingEm, lineHeight]);
    const bulletSpacingValue = useMemo(
        () => buildSpacingValue(LIST_SPACING_BY_DENSITY.compact, lineHeight),
        [lineHeight]
    );
    const sectionSpacingClass = useMemo(
        () => resolveSectionSpacingClass(sectionSpacingKey),
        [sectionSpacingKey]
    );
    const measureListSpacingValue = useMemo(
        () => buildSpacingValue(measureLayout.itemSpacingEm, measureLayout.lineHeight),
        [measureLayout.itemSpacingEm, measureLayout.lineHeight]
    );
    const measureBulletSpacingValue = useMemo(
        () => buildSpacingValue(LIST_SPACING_BY_DENSITY.compact, measureLayout.lineHeight),
        [measureLayout.lineHeight]
    );
    const measureSectionSpacingClass = useMemo(
        () => resolveSectionSpacingClass(measureLayout.sectionSpacingKey),
        [measureLayout.sectionSpacingKey]
    );
    const workItems = useMemo(
        () => experienceItems.filter((item) => item.category === 'work'),
        [experienceItems]
    );
    const projectItems = useMemo(
        () => experienceItems.filter((item) => item.category === 'project'),
        [experienceItems]
    );
    const selectedWorkItems = useMemo(
        () => workItems.filter((item) => selectedExpIds.has(item.id)),
        [selectedExpIds, workItems]
    );
    const selectedProjectItems = useMemo(
        () => projectItems.filter((item) => selectedExpIds.has(item.id)),
        [projectItems, selectedExpIds]
    );
    const selectedEducations = useMemo(
        () => educations.filter((item) => selectedEduIds.has(item.id)),
        [educations, selectedEduIds]
    );
    const sortedCertifications = certifications;
    const selectedSkillGroups = useMemo(() => {
        return skillGroups
            .map((group) => ({
                name: group.name,
                skills: group.skills.filter((skill) => selectedSkillIds.has(skill.id)),
            }))
            .filter((group) => group.skills.length > 0);
    }, [skillGroups, selectedSkillIds]);
    const selectedCertifications = useMemo(
        () => sortedCertifications.filter((item) => selectedCertIds.has(item.id)),
        [selectedCertIds, sortedCertifications]
    );
    const selectedResumeSnapshot = useMemo(
        () => buildResumeAISnapshot(
            [...selectedWorkItems, ...selectedProjectItems],
            selectedCertifications,
            selectedSkillGroups,
            selectedEducations,
        ),
        [selectedCertifications, selectedEducations, selectedProjectItems, selectedSkillGroups, selectedWorkItems]
    );
    const selectedResumeSnapshotText = useMemo(
        () => buildStableResumeSnapshotText(selectedResumeSnapshot),
        [selectedResumeSnapshot]
    );
    const editablePersonalSummary = useMemo(
        () => resolveEditablePersonalSummary({
            personalSummary,
            hasPersonalSummaryOverride,
            profileSummary: profile.summary,
        }),
        [hasPersonalSummaryOverride, personalSummary, profile.summary]
    );
    const hasEditablePersonalSummary = useMemo(
        () => hasMeaningfulPersonalSummary(editablePersonalSummary),
        [editablePersonalSummary]
    );
    const effectivePersonalSummary = useMemo(
        () => resolveEffectivePersonalSummary({
            isSummaryVisible,
            personalSummary,
            hasPersonalSummaryOverride,
            profileSummary: profile.summary,
        }),
        [hasPersonalSummaryOverride, isSummaryVisible, personalSummary, profile.summary]
    );
    const previewProfile = useMemo(
        () => ({
            ...profile,
            summary: effectivePersonalSummary,
        }),
        [effectivePersonalSummary, profile]
    );
    const personalSummaryContext = useMemo(
        () => buildPersonalSummaryContext({
            profile,
            selectedWorkItems,
            selectedProjectItems,
            selectedEducations,
            selectedCertifications,
            selectedSkillGroups,
        }),
        [
            profile,
            selectedCertifications,
            selectedEducations,
            selectedProjectItems,
            selectedSkillGroups,
            selectedWorkItems,
        ]
    );

    return {
        listSpacingValue,
        bulletSpacingValue,
        sectionSpacingClass,
        measureListSpacingValue,
        measureBulletSpacingValue,
        measureSectionSpacingClass,
        workItems,
        projectItems,
        selectedWorkItems,
        selectedProjectItems,
        selectedExperienceCount: selectedWorkItems.length + selectedProjectItems.length,
        selectedEducations,
        sortedCertifications,
        selectedSkillGroups,
        selectedCertifications,
        selectedResumeSnapshot,
        selectedResumeSnapshotText,
        editablePersonalSummary,
        hasEditablePersonalSummary,
        effectivePersonalSummary,
        previewProfile,
        personalSummaryContext,
    };
};
