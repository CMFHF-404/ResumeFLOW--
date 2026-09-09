import type { ResumeExperienceListMarkerStyle, SmartPageLayout } from '../../types/resume';
import {
    resolveDefaultResumeThemeColorPresetId, supportsResumeTemplateThemeColorCustomization,
    type ResumeTemplateId, type ResumeThemeColorPresetId,
} from '../../constants/resumeTemplates';
import { normalizeResumeExperienceListMarkerStyle, normalizeResumeSkillTagSeparator } from '../../utils/resumeCustomization';
import type { ResumeTemplatePresetMap, ResumeTemplatePreset } from '../../services/resumeTemplateStorage';

export type TemplateAppearance = {
    templateId: ResumeTemplateId;
    themeColorPresetId: ResumeThemeColorPresetId;
    sectionOrder: string[];
    experienceListMarkerStyle: ResumeExperienceListMarkerStyle;
    skillTagSeparator: string;
    layout: SmartPageLayout;
    isSmartPageApplied: boolean;
};
export type TemplatePresetDraft = Omit<ResumeTemplatePreset, 'updatedAt'>;

// The editor's persisted configuration stays untouched throughout a selection session.
export function selectTemplateAppearance(current: TemplateAppearance, templateId: ResumeTemplateId, presets: ResumeTemplatePresetMap): TemplateAppearance {
    if (current.templateId === templateId) return current;
    const preset = presets[templateId];
    return {
        ...current, templateId,
        themeColorPresetId: supportsResumeTemplateThemeColorCustomization(templateId)
            ? preset?.themeColorPresetId ?? resolveDefaultResumeThemeColorPresetId(templateId)
            : resolveDefaultResumeThemeColorPresetId(templateId),
        sectionOrder: preset ? [...preset.sectionOrder] : current.sectionOrder,
        experienceListMarkerStyle: normalizeResumeExperienceListMarkerStyle(preset?.experienceListMarkerStyle),
        skillTagSeparator: normalizeResumeSkillTagSeparator(preset?.skillTagSeparator),
        layout: preset?.layoutDefaults ? { ...preset.layoutDefaults } : current.layout,
        isSmartPageApplied: preset?.layoutDefaults ? false : current.isSmartPageApplied,
    };
}

export function applyTemplateDraft(current: TemplateAppearance, preset: TemplatePresetDraft): TemplateAppearance {
    return {
        ...current, templateId: preset.templateId,
        sectionOrder: [...preset.sectionOrder],
        themeColorPresetId: supportsResumeTemplateThemeColorCustomization(preset.templateId)
            ? preset.themeColorPresetId : resolveDefaultResumeThemeColorPresetId(preset.templateId),
        experienceListMarkerStyle: normalizeResumeExperienceListMarkerStyle(preset.experienceListMarkerStyle),
        skillTagSeparator: normalizeResumeSkillTagSeparator(preset.skillTagSeparator),
    };
}
