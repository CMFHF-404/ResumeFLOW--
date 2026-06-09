import { useCallback, useState } from 'react';
import type { ToastConfig } from '../../components/Toast';
import { exportService } from '../../services/exportService';
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
  buildCurrentProfileDraftSnapshot: (
    profile: ExperienceBankPdfRenderSnapshot['profile'],
  ) => ExperienceBankPdfRenderSnapshot['profile'];
  loading: (message: string) => string;
  updateToast: UpdateToast;
};

export const useExperienceBankPdfExport = ({
  buildCurrentProfileDraftSnapshot,
  loading,
  updateToast,
}: UseExperienceBankPdfExportOptions) => {
  const [isExportingPdf, setIsExportingPdf] = useState(false);

  const handleExportAll = useCallback(async () => {
    if (isExportingPdf) {
      return;
    }

    const exportDate = new Date();
    const exportTitle = buildExperienceBankExportTitle(exportDate);
    const toastId = loading('正在生成 PDF...');
    setIsExportingPdf(true);

    try {
      const latestSnapshot = await loadExperienceBankExportSnapshot();
      const profileSnapshot = buildCurrentProfileDraftSnapshot(latestSnapshot.profile);
      const snapshot = buildExperienceBankPdfRenderSnapshot({
        ...latestSnapshot,
        profile: profileSnapshot,
        exportDateLabel: buildExperienceBankExportDateLabel(exportDate),
      });
      const { downloadUrl, fileName } = await exportService.createExperienceBankPdfDownloadLink(
        snapshot,
        exportTitle,
      );
      await downloadUrlFile(downloadUrl, fileName);
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
    } catch (error) {
      console.error('[ExperienceBank] 导出失败:', error);
      updateToast(toastId, {
        message: error instanceof Error ? error.message : '导出失败，请稍后重试',
        type: 'error',
      });
    } finally {
      setIsExportingPdf(false);
    }
  }, [buildCurrentProfileDraftSnapshot, isExportingPdf, loading, updateToast]);

  return {
    isExportingPdf,
    handleExportAll,
  };
};
