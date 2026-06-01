import { useCallback } from 'react';
import type { ToastConfig } from '../../../components/Toast';
import { exportService } from '../../../services/exportService';
import type {
    CertificationView,
    EducationView,
    ResumeEditorProfile,
    ResumeExperienceListMarkerStyle,
    ResumeExperienceView,
    SkillGroupView,
} from '../../../types/resume';
import { buildResumeExportTitle } from '../../../utils/exportFilename';
import { downloadUrlFile } from '../../../utils/downloadUrlFile';
import { buildResumePdfRenderSnapshot } from '../../../utils/resumePdf';
import { trackResumeExported } from '../../../utils/analyticsTracker';
import type {
    ResumeTemplateId,
    ResumeThemeColorPresetId,
} from '../../../constants/resumeTemplates';

type UpdateToast = (id: string, updates: Partial<Omit<ToastConfig, 'id'>>) => void;

type UseResumePdfExportParams = {
    authUserKey: string | null;
    isExportingPdf: boolean;
    setIsExportingPdf: (value: boolean) => void;
    showToastLoading: (message: string) => string;
    updateToast: UpdateToast;
    resumeName: string;
    profile: ResumeEditorProfile;
    lineHeight: number;
    fontSize: number;
    listSpacingValue: string;
    bulletSpacingValue: string;
    topPaddingPx: number;
    sectionSpacingClass: string;
    listSpacingClass: string;
    sectionOrder: string[];
    selectedWorkItems: ResumeExperienceView[];
    selectedProjectItems: ResumeExperienceView[];
    educations: EducationView[];
    selectedEduIds: Set<string>;
    sortedCertifications: CertificationView[];
    selectedCertIds: Set<string>;
    selectedSkillGroups: SkillGroupView[];
    templateId: ResumeTemplateId;
    themeColorPresetId: ResumeThemeColorPresetId;
    experienceListMarkerStyle: ResumeExperienceListMarkerStyle;
    skillTagSeparator: string;
};

export const useResumePdfExport = ({
    authUserKey,
    isExportingPdf,
    setIsExportingPdf,
    showToastLoading,
    updateToast,
    resumeName,
    profile,
    lineHeight,
    fontSize,
    listSpacingValue,
    bulletSpacingValue,
    topPaddingPx,
    sectionSpacingClass,
    listSpacingClass,
    sectionOrder,
    selectedWorkItems,
    selectedProjectItems,
    educations,
    selectedEduIds,
    sortedCertifications,
    selectedCertIds,
    selectedSkillGroups,
    templateId,
    themeColorPresetId,
    experienceListMarkerStyle,
    skillTagSeparator,
}: UseResumePdfExportParams) => useCallback(async () => {
    if (isExportingPdf) {
        return;
    }

    const snapshot = buildResumePdfRenderSnapshot({
        resumeName,
        profile,
        lineHeight,
        fontSize,
        listSpacingValue,
        bulletSpacingValue,
        topPaddingPx,
        sectionSpacingClass,
        listSpacingClass,
        sectionOrder,
        selectedWorkItems,
        selectedProjectItems,
        educations,
        selectedEduIds,
        sortedCertifications,
        selectedCertIds,
        selectedSkillGroups,
        templateId,
        themeColorPresetId,
        experienceListMarkerStyle,
        skillTagSeparator,
    });
    const exportTitle = buildResumeExportTitle(resumeName);
    const toastId = showToastLoading('正在生成 PDF...');

    setIsExportingPdf(true);
    try {
        const { downloadUrl, fileName } = await exportService.createResumePdfDownloadLink(
            snapshot,
            exportTitle
        );
        await downloadUrlFile(downloadUrl, fileName);
        updateToast(toastId, {
            message: 'PDF 已生成，开始下载。',
            type: 'success',
            duration: 3000,
        });
        trackResumeExported(authUserKey);
    } catch (error) {
        console.error('[ResumeEditor] PDF 导出失败:', error);
        const message = error instanceof Error
            ? error.message
            : 'PDF 导出失败，请稍后重试。';
        updateToast(toastId, {
            message,
            type: 'error',
            duration: 4000,
        });
    } finally {
        setIsExportingPdf(false);
    }
}, [
    authUserKey,
    bulletSpacingValue,
    educations,
    experienceListMarkerStyle,
    fontSize,
    isExportingPdf,
    lineHeight,
    listSpacingClass,
    listSpacingValue,
    profile,
    resumeName,
    sectionOrder,
    sectionSpacingClass,
    selectedCertIds,
    selectedEduIds,
    selectedProjectItems,
    selectedSkillGroups,
    selectedWorkItems,
    showToastLoading,
    skillTagSeparator,
    sortedCertifications,
    templateId,
    themeColorPresetId,
    topPaddingPx,
    updateToast,
    setIsExportingPdf,
]);
