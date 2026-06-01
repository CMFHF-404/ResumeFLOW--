import { useCallback, type Dispatch, type SetStateAction } from 'react';
import type {
    ResumeEditorConfig,
    ResumeExperienceListMarkerStyle,
    SectionSpacingKey,
} from '../../../types/resume';
import {
    normalizeResumeExperienceListMarkerStyle,
    normalizeResumeSkillTagSeparator,
} from '../../../utils/resumeCustomization';
import {
    normalizeResumeTemplateId,
    resolveDefaultResumeThemeColorPresetId,
    type ResumeTemplateId,
    type ResumeThemeColorPresetId,
} from '../../../constants/resumeTemplates';
import {
    resolveLayoutSnapshotFromConfig,
    type SmartPageLayout,
} from '../layoutUtils';

type UseApplyResumeLayoutConfigParams = {
    setTopPaddingPx: Dispatch<SetStateAction<number>>;
    setSectionSpacingKey: Dispatch<SetStateAction<SectionSpacingKey>>;
    setItemSpacingEm: Dispatch<SetStateAction<number>>;
    setLineHeight: Dispatch<SetStateAction<number>>;
    setFontSize: Dispatch<SetStateAction<number>>;
    setMeasureLayout: Dispatch<SetStateAction<SmartPageLayout>>;
    setIsSmartPageApplied: Dispatch<SetStateAction<boolean>>;
    setResumeTemplateId: Dispatch<SetStateAction<ResumeTemplateId>>;
    setThemeColorPresetId: Dispatch<SetStateAction<ResumeThemeColorPresetId>>;
    setExperienceListMarkerStyle: Dispatch<SetStateAction<ResumeExperienceListMarkerStyle>>;
    setSkillTagSeparator: Dispatch<SetStateAction<string>>;
};

export const useApplyResumeLayoutConfig = ({
    setTopPaddingPx,
    setSectionSpacingKey,
    setItemSpacingEm,
    setLineHeight,
    setFontSize,
    setMeasureLayout,
    setIsSmartPageApplied,
    setResumeTemplateId,
    setThemeColorPresetId,
    setExperienceListMarkerStyle,
    setSkillTagSeparator,
}: UseApplyResumeLayoutConfigParams) => useCallback((config: ResumeEditorConfig) => {
    const nextLayout = resolveLayoutSnapshotFromConfig(config.layout);
    setTopPaddingPx(nextLayout.topPaddingPx);
    setSectionSpacingKey(nextLayout.sectionSpacingKey);
    setItemSpacingEm(nextLayout.itemSpacingEm);
    setLineHeight(nextLayout.lineHeight);
    setFontSize(nextLayout.fontSize);
    setMeasureLayout(nextLayout);
    setIsSmartPageApplied(nextLayout.isSmartPageApplied);
    const rawTemplateId = config.layout?.templateId;
    const nextTemplateId = normalizeResumeTemplateId(rawTemplateId);
    setResumeTemplateId(nextTemplateId);
    setThemeColorPresetId(
        config.layout?.themeColorPresetId
        ?? resolveDefaultResumeThemeColorPresetId(rawTemplateId ?? nextTemplateId)
    );
    setExperienceListMarkerStyle(
        normalizeResumeExperienceListMarkerStyle(config.layout?.experienceListMarkerStyle)
    );
    setSkillTagSeparator(normalizeResumeSkillTagSeparator(config.layout?.skillTagSeparator));
}, [
    setExperienceListMarkerStyle,
    setFontSize,
    setIsSmartPageApplied,
    setItemSpacingEm,
    setLineHeight,
    setMeasureLayout,
    setResumeTemplateId,
    setSectionSpacingKey,
    setSkillTagSeparator,
    setThemeColorPresetId,
    setTopPaddingPx,
]);
