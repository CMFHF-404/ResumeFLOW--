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
    graftJDAnalysisAuthority,
    loadJDAnalysisCache,
    normalizeJDAnalysisPersistence,
    resolveJDAnalysisForConfigSnapshot,
} from '../../../services/jdAnalysisStorage';
import { buildResumeConfigSnapshot } from '../helpers';

type UseCommittedResumeConfigSnapshotParams = {
    authUserKey?: string | null;
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
    authUserKey,
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
    const backendPersistedJDAnalysis = useMemo(
        () => normalizeJDAnalysisPersistence(
            resumeDetail?.resume?.config?.jdAnalysis
        ),
        [resumeDetail?.resume?.config?.jdAnalysis]
    );

    return useCallback(() => {
        const nextProfile = isEditingProfile ? originalProfile : profile;
        const nextProfileSyncMode = isEditingProfile ? originalProfileSyncMode : profileSyncMode;
        const authoritativeJDAnalysis = resolveJDAnalysisForConfigSnapshot(
            backendPersistedJDAnalysis,
            resumeId ? loadJDAnalysisCache(authUserKey, resumeId) : null
        );
        const draft = buildResumeConfigSnapshot(
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
            authoritativeJDAnalysis
        );
        return graftJDAnalysisAuthority(draft, authoritativeJDAnalysis);
    }, [
        authUserKey,
        backendPersistedJDAnalysis,
        bossGreetingSnapshot,
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
        persistedJDAnalysisSnapshot,
        resumeId,
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
