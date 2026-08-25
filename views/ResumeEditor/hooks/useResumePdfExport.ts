import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type { ToastConfig } from '../../../components/Toast';
import { exportService } from '../../../services/exportService';
import {
    assertResumeAuthContext,
    captureResumeAuthCacheKey,
} from '../../../services/resumeService';
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
    closeToast: (id: string) => void;
    resumeName: string;
    targetRole: string;
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
    closeToast,
    resumeName,
    targetRole,
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
}: UseResumePdfExportParams) => {
    const exportGenerationRef = useRef(0);
    const activeToastIdRef = useRef<string | null>(null);
    useLayoutEffect(() => {
        exportGenerationRef.current += 1;
        setIsExportingPdf(false);
        if (activeToastIdRef.current) {
            closeToast(activeToastIdRef.current);
            activeToastIdRef.current = null;
        }
    }, [authUserKey, closeToast, setIsExportingPdf]);
    useEffect(() => () => {
        exportGenerationRef.current += 1;
        if (activeToastIdRef.current) {
            closeToast(activeToastIdRef.current);
            activeToastIdRef.current = null;
        }
    }, [closeToast]);

    return useCallback(async () => {
        if (isExportingPdf) {
            return;
        }

        const exportGeneration = exportGenerationRef.current + 1;
        exportGenerationRef.current = exportGeneration;
        let expectedAuthCacheKey: string | undefined;
        let toastId: string | undefined;
        let toastSettled = false;
        const canCommit = async () => {
            if (
                exportGenerationRef.current !== exportGeneration
                || !expectedAuthCacheKey
            ) {
                return false;
            }
            try {
                await assertResumeAuthContext(expectedAuthCacheKey);
                return exportGenerationRef.current === exportGeneration;
            } catch {
                return false;
            }
        };

        try {
            expectedAuthCacheKey = await captureResumeAuthCacheKey(authUserKey);
            if (!await canCommit()) {
                return;
            }
            const snapshot = buildResumePdfRenderSnapshot({
                resumeName,
                targetRole,
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
            toastId = showToastLoading('正在生成 PDF...');
            activeToastIdRef.current = toastId;
            setIsExportingPdf(true);
            const { downloadUrl, fileName } = await exportService.createResumePdfDownloadLink(
                snapshot,
                exportTitle,
                { expectedAuthCacheKey },
            );
            if (!await canCommit()) {
                return;
            }
            await downloadUrlFile(downloadUrl, fileName, expectedAuthCacheKey);
            if (!await canCommit()) {
                return;
            }
            updateToast(toastId, {
                message: 'PDF 已生成，开始下载。',
                type: 'success',
                duration: 3000,
            });
            toastSettled = true;
            activeToastIdRef.current = null;
            trackResumeExported(expectedAuthCacheKey);
        } catch (error) {
            console.error('[ResumeEditor] PDF 导出失败:', error);
            if (!toastId || !await canCommit()) {
                return;
            }
            const message = error instanceof Error
                ? error.message
                : 'PDF 导出失败，请稍后重试。';
            updateToast(toastId, {
                message,
                type: 'error',
                duration: 4000,
            });
            toastSettled = true;
            activeToastIdRef.current = null;
        } finally {
            if (toastId && !toastSettled) {
                closeToast(toastId);
                if (activeToastIdRef.current === toastId) {
                    activeToastIdRef.current = null;
                }
            }
            if (exportGenerationRef.current === exportGeneration) {
                setIsExportingPdf(false);
            }
        }
    }, [
        authUserKey,
        bulletSpacingValue,
        closeToast,
        educations,
        experienceListMarkerStyle,
        fontSize,
        isExportingPdf,
        lineHeight,
        listSpacingClass,
        listSpacingValue,
        profile,
        resumeName,
        targetRole,
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
};
