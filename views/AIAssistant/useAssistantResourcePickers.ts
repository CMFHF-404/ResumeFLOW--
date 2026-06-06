import { useCallback, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';

import { certificationsService } from '../../services/certificationsService';
import { experienceService } from '../../services/experienceService';
import type { AssistantSelectedExperience, AssistantSelectedResume } from '../../services/aiService';
import { resumeService } from '../../services/resumeService';
import { skillsService } from '../../services/skillsService';
import { buildSelectedResumeFromResources } from '../../utils/assistantResumeContext';
import { buildSelectedExperience, hasResumeJDContext, normalizeSelectedResume } from './selectionUtils';
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
  const [pickerExperiences, setPickerExperiences] = useState<AssistantSelectedExperience[]>([]);
  const [isExperiencePickerOpen, setIsExperiencePickerOpen] = useState(false);
  const [isLoadingPickerExperiences, setIsLoadingPickerExperiences] = useState(false);
  const [pickerResumes, setPickerResumes] = useState<ResumePickerItem[]>([]);
  const [isResumePickerOpen, setIsResumePickerOpen] = useState(false);
  const [isLoadingPickerResumes, setIsLoadingPickerResumes] = useState(false);
  const [isApplyingPickerResume, setIsApplyingPickerResume] = useState(false);

  const openExperiencePicker = useCallback(async () => {
    setIsExperiencePickerOpen(true);
    if (isLoadingPickerExperiences) {
      return;
    }
    setIsLoadingPickerExperiences(true);
    try {
      const [work, project, education] = await Promise.all([
        experienceService.listAll('work'),
        experienceService.listAll('project'),
        experienceService.listAll('education'),
      ]);
      setPickerExperiences([...work, ...project, ...education].map(buildSelectedExperience));
    } catch (loadError) {
      console.error('[AIAssistant] Failed to load experiences for picker:', loadError);
      error('加载经历列表失败，请稍后重试');
    } finally {
      setIsLoadingPickerExperiences(false);
    }
  }, [error, isLoadingPickerExperiences]);

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

  const handleConfirmSelectedResume = useCallback(async (resumeId: string) => {
    setIsApplyingPickerResume(true);
    try {
      const resumes = pickerResumes.length > 0
        ? pickerResumes
        : (await resumeService.list()).map(mapResumePickerItem);
      if (pickerResumes.length === 0) {
        setPickerResumes(resumes);
      }
      const resumeList = await resumeService.list();
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
      const nextSelectedResume = normalizeSelectedResume(
        buildSelectedResumeFromResources(selectedResumeRecord, detail, educations, certifications, skills),
      );
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
    persistDraftSelectedResume,
    pickerResumes,
    selectedSessionIdRef,
    setSelectedResume,
    suppressAutoSelectSessionRef,
  ]);

  return {
    pickerExperiences,
    isExperiencePickerOpen,
    setIsExperiencePickerOpen,
    isLoadingPickerExperiences,
    openExperiencePicker,
    pickerResumes,
    isResumePickerOpen,
    setIsResumePickerOpen,
    isLoadingPickerResumes,
    isApplyingPickerResume,
    openResumePicker,
    handleConfirmSelectedResume,
  };
};
