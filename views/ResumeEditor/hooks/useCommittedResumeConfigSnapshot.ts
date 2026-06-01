import { useCallback, useMemo } from 'react';
import type {
    ProfileSyncMode,
    ResumeBossGreeting,
    ResumeEditorProfile,
    ResumeExperienceListMarkerStyle,
    ResumeJDAnalysis,
    ResumeLayoutOrders,
    SectionSpacingKey,
} from '../../../types/resume';
import type { ResumeDetail } from '../../../services/resumeService';
import type {
    ResumeTemplateId,
    ResumeThemeColorPresetId,
} from '../../../constants/resumeTemplates';
import {
    loadJDAnalysisCache,
    normalizeJDAnalysisPersistence,
    selectPreferredPersistedJDAnalysis,
} from '../../jdAnalysisStorage';
import { buildResumeConfigSnapshot } from '../helpers';

type UseCommittedResumeConfigSnapshotParams = {
    resumeId: string | null;
    resumeDetail: ResumeDetail | null;
    persistedJDAnalysisSnapshot: ResumeJDAnalysis | null | undefined;
    isEditingProfile: boolean;
    originalProfile: ResumeEditorProfile;
    profile: ResumeEditorProfile;
    originalProfileSyncMode: ProfileSyncMode;
    profileSyncMode: ProfileSyncMode;
    personalSummary: string;
    hasPersonalSummaryOverride: boolean;
    bossGreetingSnapshot: ResumeBossGreeting | null;
    selectedExpIds: Set<string>;
    selectedEduIds: Set<string>;
    selectedCertIds: Set<string>;
    selectedSkillIds: Set<string>;
    sectionOrder: string[];
    density: 'compact' | 'standard' | 'spacious';
    topPaddingPx: number;
    sectionSpacingKey: SectionSpacingKey;
    itemSpacingEm: number;
    lineHeight: number;
    fontSize: number;
    isSmartPageApplied: boolean;
    isSummaryVisible: boolean;
    layoutOrders: ResumeLayoutOrders;
    resumeTemplateId: ResumeTemplateId;
    themeColorPresetId: ResumeThemeColorPresetId;
    experienceListMarkerStyle: ResumeExperienceListMarkerStyle;
    skillTagSeparator: string;
};

export const useCommittedResumeConfigSnapshot = ({
    resumeId,
    resumeDetail,
    persistedJDAnalysisSnapshot,
    isEditingProfile,
    originalProfile,
    profile,
    originalProfileSyncMode,
    profileSyncMode,
    personalSummary,
    hasPersonalSummaryOverride,
    bossGreetingSnapshot,
    selectedExpIds,
    selectedEduIds,
    selectedCertIds,
    selectedSkillIds,
    sectionOrder,
    density,
    topPaddingPx,
    sectionSpacingKey,
    itemSpacingEm,
    lineHeight,
    fontSize,
    isSmartPageApplied,
    isSummaryVisible,
    layoutOrders,
    resumeTemplateId,
    themeColorPresetId,
    experienceListMarkerStyle,
    skillTagSeparator,
}: UseCommittedResumeConfigSnapshotParams) => {
    const hydratingPersistedJDAnalysisSnapshot = useMemo(() => {
        const backendPersistedJDAnalysis = normalizeJDAnalysisPersistence(
            resumeDetail?.resume?.config?.jdAnalysis
        );
        return selectPreferredPersistedJDAnalysis(
            backendPersistedJDAnalysis,
            resumeId ? loadJDAnalysisCache(resumeId) : null
        )?.payload ?? null;
    }, [resumeDetail?.resume?.config?.jdAnalysis, resumeId]);

    const committedPersistedJDAnalysisSnapshot =
        persistedJDAnalysisSnapshot !== undefined
            ? persistedJDAnalysisSnapshot
            : hydratingPersistedJDAnalysisSnapshot;

    return useCallback(() => {
        const nextProfile = isEditingProfile ? originalProfile : profile;
        const nextProfileSyncMode = isEditingProfile ? originalProfileSyncMode : profileSyncMode;
        return buildResumeConfigSnapshot(
            nextProfile,
            personalSummary,
            hasPersonalSummaryOverride,
            bossGreetingSnapshot,
            nextProfileSyncMode,
            selectedExpIds,
            selectedEduIds,
            selectedCertIds,
            selectedSkillIds,
            sectionOrder,
            density,
            topPaddingPx,
            sectionSpacingKey,
            itemSpacingEm,
            lineHeight,
            fontSize,
            isSmartPageApplied,
            isSummaryVisible,
            layoutOrders,
            resumeTemplateId,
            themeColorPresetId,
            experienceListMarkerStyle,
            skillTagSeparator,
            committedPersistedJDAnalysisSnapshot
        );
    }, [
        bossGreetingSnapshot,
        committedPersistedJDAnalysisSnapshot,
        density,
        experienceListMarkerStyle,
        fontSize,
        hasPersonalSummaryOverride,
        isEditingProfile,
        isSmartPageApplied,
        isSummaryVisible,
        itemSpacingEm,
        layoutOrders,
        lineHeight,
        originalProfile,
        originalProfileSyncMode,
        personalSummary,
        profile,
        profileSyncMode,
        resumeTemplateId,
        sectionOrder,
        sectionSpacingKey,
        selectedCertIds,
        selectedEduIds,
        selectedExpIds,
        selectedSkillIds,
        skillTagSeparator,
        themeColorPresetId,
        topPaddingPx,
    ]);
};
