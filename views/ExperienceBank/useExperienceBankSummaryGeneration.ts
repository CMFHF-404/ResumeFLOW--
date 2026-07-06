import { useCallback, useRef, useState } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { ToastConfig } from '../../components/Toast';
import { aiService, type GeneratePersonalSummaryParams } from '../../services/aiService';
import type { Profile } from '../../services/profileService';
import type { ExperienceBankPdfRenderSnapshot } from '../../types/experienceBankExport';
import { resolveThoughtDisplayEvent } from '../../utils/aiThought';
import { stripRichTextToText } from '../../utils/richText';

type ToastFn = (message: string, duration?: number) => string;
type LoadingToastFn = (message: string) => string;
type UpdateToastFn = (id: string, updates: Partial<Omit<ToastConfig, 'id'>>) => void;

type UseExperienceBankSummaryGenerationParams = {
  isLoadingProfile: boolean;
  isEditingProfile: boolean;
  hasHydratedProfileRef: MutableRefObject<boolean>;
  setIsEditingProfile: Dispatch<SetStateAction<boolean>>;
  setSummary: Dispatch<SetStateAction<string>>;
  loadExportSnapshot: () => Promise<ExperienceBankPdfRenderSnapshot>;
  loadValidationSnapshot: () => Promise<ExperienceBankPdfRenderSnapshot | null>;
  buildSummaryPayload: (
    profile: Profile | null,
    snapshot: ExperienceBankPdfRenderSnapshot,
  ) => GeneratePersonalSummaryParams;
  buildCurrentProfileDraftSnapshot: (profile: Profile | null) => Profile | null;
  mergeRecoveredProfileIntoDraft: (profile: Profile) => void;
  markSummaryDraftTouched: () => void;
  toastError: ToastFn;
  loading: LoadingToastFn;
  updateToast: UpdateToastFn;
  closeToast: (id: string) => void;
};

const snapshotHasSummarySourceContent = (snapshot: ExperienceBankPdfRenderSnapshot) => (
  snapshot.workItems.length > 0
  || snapshot.projectItems.length > 0
  || snapshot.educationItems.length > 0
  || snapshot.certifications.length > 0
  || snapshot.skills.length > 0
);

export const useExperienceBankSummaryGeneration = ({
  isLoadingProfile,
  isEditingProfile,
  hasHydratedProfileRef,
  setIsEditingProfile,
  setSummary,
  loadExportSnapshot,
  loadValidationSnapshot,
  buildSummaryPayload,
  buildCurrentProfileDraftSnapshot,
  mergeRecoveredProfileIntoDraft,
  markSummaryDraftTouched,
  toastError,
  loading,
  updateToast,
  closeToast,
}: UseExperienceBankSummaryGenerationParams) => {
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const summaryGenerationRequestIdRef = useRef(0);
  const summaryDraftVersionRef = useRef(0);
  const activeSummaryToastIdRef = useRef<string | null>(null);

  const cancelSummaryGeneration = useCallback((options?: { bumpDraftVersion?: boolean }) => {
    summaryGenerationRequestIdRef.current += 1;
    if (activeSummaryToastIdRef.current) {
      closeToast(activeSummaryToastIdRef.current);
      activeSummaryToastIdRef.current = null;
    }
    setIsGeneratingSummary(false);
    if (options?.bumpDraftVersion) {
      summaryDraftVersionRef.current += 1;
    }
  }, [closeToast]);

  const handleGenerateSummary = useCallback(async () => {
    if (isGeneratingSummary || isLoadingProfile) {
      return;
    }

    setIsGeneratingSummary(true);
    const requestId = summaryGenerationRequestIdRef.current + 1;
    summaryGenerationRequestIdRef.current = requestId;
    const draftVersionAtStart = summaryDraftVersionRef.current;
    const isCurrentSummaryRequest = () => summaryGenerationRequestIdRef.current === requestId;
    let toastId: string | null = null;
    const releaseActiveSummaryToast = () => {
      if (toastId && activeSummaryToastIdRef.current === toastId) {
        activeSummaryToastIdRef.current = null;
      }
    };
    try {
      const latestSnapshot = await loadExportSnapshot();
      if (
        !isCurrentSummaryRequest()
        || summaryDraftVersionRef.current !== draftVersionAtStart
      ) {
        return;
      }
      mergeRecoveredProfileIntoDraft(latestSnapshot.profile);
      hasHydratedProfileRef.current = true;
      const profileSnapshot = buildCurrentProfileDraftSnapshot(latestSnapshot.profile);
      const existingSummary = profileSnapshot?.summary?.trim() || '';
      if (!snapshotHasSummarySourceContent(latestSnapshot)) {
        toastError('请先完善经历库内容后再生成个人评价。');
        return;
      }
      if (existingSummary && typeof window !== 'undefined') {
        const shouldOverwrite = window.confirm('当前已有个人评价内容，是否用 AI 生成结果覆盖？');
        if (!shouldOverwrite) {
          return;
        }
      }

      toastId = loading('正在生成个人评价...');
      activeSummaryToastIdRef.current = toastId;
      if (!isEditingProfile) {
        setIsEditingProfile(true);
      }
      const requestPayload = buildSummaryPayload(profileSnapshot, latestSnapshot);
      const requestSignature = JSON.stringify(requestPayload);

      const response = await aiService.generatePersonalSummaryStream(requestPayload, (event) => {
        const resolution = resolveThoughtDisplayEvent(event);
        if (toastId && resolution?.kind === 'model_thought' && isCurrentSummaryRequest()) {
          updateToast(toastId, {
            message: resolution.text,
            type: 'ai_thinking',
            duration: 0,
          });
        }
      });

      if (
        !isCurrentSummaryRequest()
        || summaryDraftVersionRef.current !== draftVersionAtStart
      ) {
        if (toastId) {
          closeToast(toastId);
        }
        releaseActiveSummaryToast();
        return;
      }
      const currentSnapshot = await loadValidationSnapshot();
      if (!currentSnapshot) {
        if (toastId) {
          closeToast(toastId);
        }
        releaseActiveSummaryToast();
        return;
      }
      const currentProfileSnapshot = buildCurrentProfileDraftSnapshot(currentSnapshot.profile);
      const currentSignature = JSON.stringify(
        buildSummaryPayload(currentProfileSnapshot, currentSnapshot),
      );
      if (
        !isCurrentSummaryRequest()
        || summaryDraftVersionRef.current !== draftVersionAtStart
        || currentSignature !== requestSignature
      ) {
        if (toastId) {
          closeToast(toastId);
        }
        releaseActiveSummaryToast();
        return;
      }
      markSummaryDraftTouched();
      setSummary(stripRichTextToText(response.summary).trim());
      if (toastId) {
        updateToast(toastId, {
          message: '个人评价已生成',
          type: 'success',
          duration: 2500,
        });
      }
      releaseActiveSummaryToast();
    } catch (error) {
      if (!isCurrentSummaryRequest()) {
        if (toastId) {
          closeToast(toastId);
        }
        releaseActiveSummaryToast();
        return;
      }
      console.error('[ExperienceBank] 个人评价生成失败:', error);
      if (toastId) {
        updateToast(toastId, {
          message: error instanceof Error ? error.message : '个人评价生成失败，请稍后重试',
          type: 'error',
          duration: 3500,
        });
      } else {
        toastError(error instanceof Error ? error.message : '个人评价生成失败，请稍后重试');
      }
      releaseActiveSummaryToast();
    } finally {
      if (isCurrentSummaryRequest()) {
        setIsGeneratingSummary(false);
      }
    }
  }, [
    buildCurrentProfileDraftSnapshot,
    buildSummaryPayload,
    closeToast,
    hasHydratedProfileRef,
    isEditingProfile,
    isGeneratingSummary,
    isLoadingProfile,
    loadExportSnapshot,
    loadValidationSnapshot,
    loading,
    markSummaryDraftTouched,
    mergeRecoveredProfileIntoDraft,
    setIsEditingProfile,
    setSummary,
    toastError,
    updateToast,
  ]);

  const handleSummaryChange = useCallback((value: string) => {
    summaryDraftVersionRef.current += 1;
    markSummaryDraftTouched();
    setSummary(value);
  }, [markSummaryDraftTouched, setSummary]);

  return {
    isGeneratingSummary,
    cancelSummaryGeneration,
    handleGenerateSummary,
    handleSummaryChange,
  };
};
