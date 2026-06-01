import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { JDAnalysisResult } from '../../../services/aiService';
import type {
    CertificationView,
    ResumeExperienceView,
    SkillGroupView,
} from '../../../types/resume';
import {
    AUTO_ASSEMBLY_MATCH_THRESHOLD,
    AUTO_ASSEMBLY_MAX_EXPERIENCES,
} from '../constants';
import {
    buildOrderedScoreItems,
    buildRemovalQueue,
    hasPositiveMatchScore,
    pickThresholdIds,
    pickTopIds,
    toMatchScoreMap,
    type AutoAssemblySelection,
} from '../autoAssemblyUtils';

type UseAutoAssemblySelectionParams = {
    workItems: ResumeExperienceView[];
    projectItems: ResumeExperienceView[];
    sortedCertifications: CertificationView[];
    skillGroups: SkillGroupView[];
    setSelectedExpIds: Dispatch<SetStateAction<Set<string>>>;
    setSelectedCertIds: Dispatch<SetStateAction<Set<string>>>;
    setSelectedSkillIds: Dispatch<SetStateAction<Set<string>>>;
    isProgrammaticSelectionUpdateRef: MutableRefObject<boolean>;
    waitForPreviewUpdate: (frames?: number) => Promise<void>;
};

export const useAutoAssemblySelection = ({
    workItems,
    projectItems,
    sortedCertifications,
    skillGroups,
    setSelectedExpIds,
    setSelectedCertIds,
    setSelectedSkillIds,
    isProgrammaticSelectionUpdateRef,
    waitForPreviewUpdate,
}: UseAutoAssemblySelectionParams) => {
    const applyAssemblySelection = useCallback(async (
        selection: Pick<AutoAssemblySelection, 'experienceIds' | 'certificationIds' | 'skillIds'>
    ) => {
        isProgrammaticSelectionUpdateRef.current = true;
        try {
            setSelectedExpIds(new Set(selection.experienceIds));
            setSelectedCertIds(new Set(selection.certificationIds));
            setSelectedSkillIds(new Set(selection.skillIds));
            await waitForPreviewUpdate(2);
        } finally {
            isProgrammaticSelectionUpdateRef.current = false;
        }
    }, [
        isProgrammaticSelectionUpdateRef,
        setSelectedCertIds,
        setSelectedExpIds,
        setSelectedSkillIds,
        waitForPreviewUpdate,
    ]);

    const buildAutoAssemblySelection = useCallback((result: JDAnalysisResult): AutoAssemblySelection => {
        const experienceItemsByScore = buildOrderedScoreItems(
            [...workItems, ...projectItems],
            toMatchScoreMap(result.experienceMatches)
        );
        const certificationItemsByScore = buildOrderedScoreItems(
            sortedCertifications,
            toMatchScoreMap(result.certificationMatches)
        );
        const skillItemsByScore = buildOrderedScoreItems(
            skillGroups.flatMap((group) => group.skills),
            toMatchScoreMap(result.skillMatches)
        );
        const matchedExperienceItems = experienceItemsByScore.filter(hasPositiveMatchScore);
        const experienceIds = pickTopIds(
            matchedExperienceItems,
            AUTO_ASSEMBLY_MAX_EXPERIENCES
        );
        const certificationIds = pickThresholdIds(
            certificationItemsByScore,
            AUTO_ASSEMBLY_MATCH_THRESHOLD
        );
        const skillIds = pickThresholdIds(skillItemsByScore, AUTO_ASSEMBLY_MATCH_THRESHOLD);
        return {
            hasMatchedExperience: matchedExperienceItems.length > 0,
            experienceIds,
            certificationIds,
            skillIds,
            experienceRemovalQueue: buildRemovalQueue(new Set(experienceIds), experienceItemsByScore),
            certificationRemovalQueue: buildRemovalQueue(new Set(certificationIds), certificationItemsByScore),
            skillRemovalQueue: buildRemovalQueue(new Set(skillIds), skillItemsByScore),
        };
    }, [projectItems, skillGroups, sortedCertifications, workItems]);

    return {
        applyAssemblySelection,
        buildAutoAssemblySelection,
    };
};
