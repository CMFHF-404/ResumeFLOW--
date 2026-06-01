import { useCallback, type Dispatch, type SetStateAction } from 'react';
import type { ResumeExperienceListMarkerStyle } from '../../../types/resume';
import {
    normalizeResumeExperienceListMarkerStyle,
    normalizeResumeSkillTagSeparator,
} from '../../../utils/resumeCustomization';
import {
    resolveDefaultResumeThemeColorPresetId,
    type ResumeTemplateId,
    type ResumeThemeColorPresetId,
} from '../../../constants/resumeTemplates';
import {
    savePreferredResumeTemplateId,
    saveResumeTemplatePreset,
    type ResumeTemplatePresetMap,
} from '../../resumeTemplateStorage';

type TemplatePresetInput = {
    templateId: ResumeTemplateId;
    sectionOrder: string[];
    themeColorPresetId: ResumeThemeColorPresetId;
    experienceListMarkerStyle: ResumeExperienceListMarkerStyle;
    skillTagSeparator: string;
};

type UseTemplatePresetActionsParams = {
    isTemplatePresetMapReady: boolean;
    templatePresetMap: ResumeTemplatePresetMap;
    resumeTemplateId: ResumeTemplateId;
    themeColorPresetId: ResumeThemeColorPresetId;
    experienceListMarkerStyle: ResumeExperienceListMarkerStyle;
    skillTagSeparator: string;
    sectionOrder: string[];
    setResumeTemplateId: Dispatch<SetStateAction<ResumeTemplateId>>;
    setThemeColorPresetId: Dispatch<SetStateAction<ResumeThemeColorPresetId>>;
    setExperienceListMarkerStyle: Dispatch<SetStateAction<ResumeExperienceListMarkerStyle>>;
    setSkillTagSeparator: Dispatch<SetStateAction<string>>;
    setSectionOrder: Dispatch<SetStateAction<string[]>>;
    setIsTemplateSelectorOpen: Dispatch<SetStateAction<boolean>>;
    setTemplatePresetMap: Dispatch<SetStateAction<ResumeTemplatePresetMap>>;
    showToastInfo: (message: string, duration?: number) => string;
    showToastSuccess: (message: string, duration?: number) => string;
    showToastError: (message: string, duration?: number) => string;
};

export const useTemplatePresetActions = ({
    isTemplatePresetMapReady,
    templatePresetMap,
    resumeTemplateId,
    themeColorPresetId,
    experienceListMarkerStyle,
    skillTagSeparator,
    sectionOrder,
    setResumeTemplateId,
    setThemeColorPresetId,
    setExperienceListMarkerStyle,
    setSkillTagSeparator,
    setSectionOrder,
    setIsTemplateSelectorOpen,
    setTemplatePresetMap,
    showToastInfo,
    showToastSuccess,
    showToastError,
}: UseTemplatePresetActionsParams) => {
    const handleSelectTemplate = useCallback((templateId: ResumeTemplateId) => {
        if (!isTemplatePresetMapReady) {
            showToastInfo('正在同步模板预设，请稍后再试');
            return;
        }
        savePreferredResumeTemplateId(templateId);
        if (templateId === resumeTemplateId) {
            setIsTemplateSelectorOpen(false);
            return;
        }
        const preset = templatePresetMap[templateId];
        const nextThemeColorPresetId = preset?.themeColorPresetId ?? resolveDefaultResumeThemeColorPresetId(templateId);
        const nextExperienceListMarkerStyle = normalizeResumeExperienceListMarkerStyle(
            preset?.experienceListMarkerStyle
        );
        const nextSkillTagSeparator = normalizeResumeSkillTagSeparator(preset?.skillTagSeparator);
        const shouldUpdateSectionOrder = Boolean(preset);
        const isSameSectionOrder = !preset
            || JSON.stringify(sectionOrder) === JSON.stringify(preset.sectionOrder);
        if (
            templateId === resumeTemplateId
            && themeColorPresetId === nextThemeColorPresetId
            && experienceListMarkerStyle === nextExperienceListMarkerStyle
            && skillTagSeparator === nextSkillTagSeparator
            && isSameSectionOrder
        ) {
            setIsTemplateSelectorOpen(false);
            return;
        }
        setResumeTemplateId(templateId);
        setThemeColorPresetId(nextThemeColorPresetId);
        setExperienceListMarkerStyle(nextExperienceListMarkerStyle);
        setSkillTagSeparator(nextSkillTagSeparator);
        if (shouldUpdateSectionOrder) {
            setSectionOrder([...preset.sectionOrder]);
        }
        setIsTemplateSelectorOpen(false);
    }, [
        experienceListMarkerStyle,
        isTemplatePresetMapReady,
        resumeTemplateId,
        sectionOrder,
        setExperienceListMarkerStyle,
        setIsTemplateSelectorOpen,
        setResumeTemplateId,
        setSectionOrder,
        setSkillTagSeparator,
        setThemeColorPresetId,
        showToastInfo,
        skillTagSeparator,
        templatePresetMap,
        themeColorPresetId,
    ]);

    const handleSaveTemplatePreset = useCallback(async (preset: TemplatePresetInput) => {
        try {
            const savedPreset = await saveResumeTemplatePreset(preset);
            setTemplatePresetMap((prev) => ({
                ...prev,
                [savedPreset.templateId]: savedPreset,
            }));
            if (savedPreset.templateId === resumeTemplateId) {
                setThemeColorPresetId(savedPreset.themeColorPresetId);
                setSectionOrder([...savedPreset.sectionOrder]);
                setExperienceListMarkerStyle(savedPreset.experienceListMarkerStyle);
                setSkillTagSeparator(savedPreset.skillTagSeparator);
            }
            showToastSuccess('模板预设已保存');
        } catch (error) {
            console.error('[ResumeEditor] 保存模板预设失败:', error);
            showToastError('保存模板预设失败，请稍后重试');
            throw error;
        }
    }, [
        resumeTemplateId,
        setExperienceListMarkerStyle,
        setSectionOrder,
        setSkillTagSeparator,
        setTemplatePresetMap,
        setThemeColorPresetId,
        showToastError,
        showToastSuccess,
    ]);

    return {
        handleSelectTemplate,
        handleSaveTemplatePreset,
    };
};
