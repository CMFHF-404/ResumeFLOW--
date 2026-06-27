import { useCallback, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';

import { certificationsService } from '../../services/certificationsService';
import { experienceService } from '../../services/experienceService';
import type { AssistantSelectedResume } from '../../services/aiService';
import { resumeService } from '../../services/resumeService';
import { skillsService } from '../../services/skillsService';
import { buildSelectedResumeFromResources } from '../../utils/assistantResumeContext';
import { buildSelectedResumeWithExperienceSelection } from './resumeSelectionUtils';
import { hasResumeJDContext, normalizeSelectedResume } from './selectionUtils';
import type { ResumePickerItem } from './ResumePicker';
import type { AssistantLaunchRequest } from './types';

type UseAssistantResourcePickersParams = {
  selectedSessionIdRef: MutableRefObject<string | null>;
  suppressAutoSelectSessionRef: MutableRefObject<boolean>;
  draftLaunchRequestRef: MutableRefObject<AssistantLaunchRequest | null>;
  persistDraftSelectedResume: (sessionId: string | null | undefined, resume: AssistantSelectedResume | null) => void;
  setSelectedResume: Dispatch<SetStateAction<AssistantSelectedResume | null>>;
  error: (message: string, duration?: number) => void;
};

const mapResumePickerItem = (item: Awaited<ReturnType<typeof resumeService.list>>[number]): ResumePickerItem => ({
  id: item.id,
  title: item.title || '未命名简历',
  targetRole: item.target_role || '',
  updatedAt: item.updated_at,
  hasJD: hasResumeJDContext(item),
});

export const useAssistantResourcePickers = ({
  selectedSessionIdRef,
  suppressAutoSelectSessionRef,
  draftLaunchRequestRef,
  persistDraftSelectedResume,
  setSelectedResume,
  error,
}: UseAssistantResourcePickersParams) => {
  const [pickerResumes, setPickerResumes] = useState<ResumePickerItem[]>([]);
  const [isResumePickerOpen, setIsResumePickerOpen] = useState(false);
  const [isLoadingPickerResumes, setIsLoadingPickerResumes] = useState(false);
  const [isLoadingPickerResumeDetail, setIsLoadingPickerResumeDetail] = useState(false);
  const [isApplyingPickerResume, setIsApplyingPickerResume] = useState(false);
  const [pickerResumeDetailsById, setPickerResumeDetailsById] = useState<Record<string, AssistantSelectedResume>>({});

  const openResumePicker = useCallback(async () => {
    setIsResumePickerOpen(true);
    if (isLoadingPickerResumes) {
      return;
    }
    setIsLoadingPickerResumes(true);
    try {
      const rows = await resumeService.list();
      setPickerResumes(rows.map(mapResumePickerItem));
    } catch (loadError) {
      console.error('[AIAssistant] Failed to load resumes for picker:', loadError);
      error('加载简历列表失败，请稍后重试');
    } finally {
      setIsLoadingPickerResumes(false);
    }
  }, [error, isLoadingPickerResumes]);

  const loadPickerResumeDetail = useCallback(async (resumeId: string) => {
    const cached = pickerResumeDetailsById[resumeId];
    if (cached) {
      return cached;
    }
    setIsLoadingPickerResumeDetail(true);
    try {
      const resumeList = await resumeService.list();
      if (pickerResumes.length === 0) {
        setPickerResumes(resumeList.map(mapResumePickerItem));
      }
      const selectedResumeRecord = resumeList.find((item) => item.id === resumeId);
      if (!selectedResumeRecord) {
        throw new Error('resume_not_found');
      }
      const [detail, educations, certifications, skills] = await Promise.all([
        resumeService.get(resumeId),
        experienceService.listAll('education'),
        certificationsService.list(),
        skillsService.list(),
      ]);
      const loadedResume = normalizeSelectedResume(
        buildSelectedResumeFromResources(selectedResumeRecord, detail, educations, certifications, skills),
      );
      if (!loadedResume) {
        throw new Error('resume_context_empty');
      }
      setPickerResumeDetailsById((current) => ({
        ...current,
        [resumeId]: loadedResume,
      }));
      return loadedResume;
    } catch (loadError) {
      console.error('[AIAssistant] Failed to load resume detail for picker:', loadError);
      error('加载简历内容失败，请稍后重试');
      return null;
    } finally {
      setIsLoadingPickerResumeDetail(false);
    }
  }, [error, pickerResumeDetailsById, pickerResumes]);

  const handleConfirmSelectedResume = useCallback(async (resumeId: string, experienceIds: string[]) => {
    setIsApplyingPickerResume(true);
    try {
      const loadedResume = await loadPickerResumeDetail(resumeId);
      const nextSelectedResume = buildSelectedResumeWithExperienceSelection(loadedResume, experienceIds);
      if (!nextSelectedResume) {
        error('请至少选择一段简历内经历');
        return;
      }
      if (!selectedSessionIdRef.current) {
        suppressAutoSelectSessionRef.current = true;
        const draftLaunchRequest = draftLaunchRequestRef.current;
        if (draftLaunchRequest && nextSelectedResume) {
          draftLaunchRequestRef.current = {
            ...draftLaunchRequest,
            prefillResume: nextSelectedResume,
          };
        }
      }
      setSelectedResume(nextSelectedResume);
      persistDraftSelectedResume(selectedSessionIdRef.current, nextSelectedResume);
      setIsResumePickerOpen(false);
    } catch (applyError) {
      console.error('[AIAssistant] Failed to attach selected resume:', applyError);
      error('带入简历失败，请稍后重试');
    } finally {
      setIsApplyingPickerResume(false);
    }
  }, [
    draftLaunchRequestRef,
    error,
    loadPickerResumeDetail,
    persistDraftSelectedResume,
    selectedSessionIdRef,
    setSelectedResume,
    suppressAutoSelectSessionRef,
  ]);

  return {
    pickerResumes,
    isResumePickerOpen,
    setIsResumePickerOpen,
    isLoadingPickerResumes,
    isLoadingPickerResumeDetail,
    isApplyingPickerResume,
    openResumePicker,
    loadPickerResumeDetail,
    handleConfirmSelectedResume,
  };
};
