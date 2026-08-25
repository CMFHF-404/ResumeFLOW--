import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ToastConfig } from '../../components/Toast';
import { exportService } from '../../services/exportService';
import {
  assertResumeAuthContext,
  captureResumeAuthCacheKey,
} from '../../services/resumeService';
import type { ExperienceBankPdfRenderSnapshot } from '../../types/experienceBankExport';
import {
  buildExperienceBankExportDateLabel,
  buildExperienceBankExportTitle,
} from '../../utils/exportFilename';
import { buildExperienceBankPdfRenderSnapshot } from '../../utils/experienceBankPdf';
import { downloadUrlFile } from '../../utils/downloadUrlFile';
import { trackExperienceBankExported } from '../../utils/analyticsTracker';
import { loadExperienceBankExportSnapshot } from './exportSnapshotLoaders';

type UpdateToast = (id: string, updates: Partial<Omit<ToastConfig, 'id'>>) => void;

type UseExperienceBankPdfExportOptions = {
  authUserKey: string | null;
  buildCurrentProfileDraftSnapshot: (
    profile: ExperienceBankPdfRenderSnapshot['profile'],
  ) => ExperienceBankPdfRenderSnapshot['profile'];
  loading: (message: string) => string;
  updateToast: UpdateToast;
  closeToast: (id: string) => void;
};

export const useExperienceBankPdfExport = ({
  authUserKey,
  buildCurrentProfileDraftSnapshot,
  loading,
  updateToast,
  closeToast,
}: UseExperienceBankPdfExportOptions) => {
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const exportGenerationRef = useRef(0);
  const activeToastIdRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    exportGenerationRef.current += 1;
    setIsExportingPdf(false);
    if (activeToastIdRef.current) {
      closeToast(activeToastIdRef.current);
      activeToastIdRef.current = null;
    }
  }, [authUserKey, closeToast]);
  useEffect(() => () => {
    exportGenerationRef.current += 1;
    if (activeToastIdRef.current) {
      closeToast(activeToastIdRef.current);
      activeToastIdRef.current = null;
    }
  }, [closeToast]);

  const handleExportAll = useCallback(async () => {
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
      expectedAuthCacheKey = await captureResumeAuthCacheKey(authUserKey ?? undefined);
      if (!await canCommit()) {
        return;
      }
      const exportDate = new Date();
      const exportTitle = buildExperienceBankExportTitle(exportDate);
      toastId = loading('正在生成 PDF...');
      activeToastIdRef.current = toastId;
      setIsExportingPdf(true);
      const latestSnapshot = await loadExperienceBankExportSnapshot(expectedAuthCacheKey);
      if (!await canCommit()) {
        return;
      }
      const profileSnapshot = buildCurrentProfileDraftSnapshot(latestSnapshot.profile);
      const snapshot = buildExperienceBankPdfRenderSnapshot({
        ...latestSnapshot,
        profile: profileSnapshot,
        exportDateLabel: buildExperienceBankExportDateLabel(exportDate),
      });
      const { downloadUrl, fileName } = await exportService.createExperienceBankPdfDownloadLink(
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
      trackExperienceBankExported({
        workCount: snapshot.workItems.length,
        projectCount: snapshot.projectItems.length,
        educationCount: snapshot.educationItems.length,
        certificationCount: snapshot.certifications.length,
        skillCount: snapshot.skills.length,
      });
      updateToast(toastId, {
        message: 'PDF 已生成，开始下载。',
        type: 'success',
        duration: 3000,
      });
      toastSettled = true;
      activeToastIdRef.current = null;
    } catch (error) {
      console.error('[ExperienceBank] 导出失败:', error);
      if (!toastId || !await canCommit()) {
        return;
      }
      updateToast(toastId, {
        message: error instanceof Error ? error.message : '导出失败，请稍后重试',
        type: 'error',
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
    buildCurrentProfileDraftSnapshot,
    closeToast,
    isExportingPdf,
    loading,
    updateToast,
  ]);

  return {
    isExportingPdf,
    handleExportAll,
  };
};
