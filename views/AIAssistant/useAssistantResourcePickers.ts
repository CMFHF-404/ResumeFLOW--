import { useCallback, useLayoutEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';

import { certificationsService } from '../../services/certificationsService';
import { experienceService } from '../../services/experienceService';
import type { AssistantSelectedResume } from '../../services/aiService';
import {
  assertResumeAuthContext,
  ResumeAuthContextChangedError,
  resumeService,
} from '../../services/resumeService';
import { skillsService } from '../../services/skillsService';
import { isAuthContextChangedError } from '../../services/apiClient';
import { buildSelectedResumeFromResources } from '../../utils/assistantResumeContext';
import { buildSelectedResumeWithExperienceSelection } from './resumeSelectionUtils';
import { hasResumeJDContext, normalizeSelectedResume } from './selectionUtils';
import type { ResumePickerItem } from './ResumePicker';
import type { AssistantLaunchRequest } from './types';

type UseAssistantResourcePickersParams = {
  authUserKey: string | null;
  selectedSessionIdRef: MutableRefObject<string | null>;
  suppressAutoSelectSessionRef: MutableRefObject<boolean>;
  draftLaunchRequestRef: MutableRefObject<AssistantLaunchRequest | null>;
  persistDraftSelectedResume: (sessionId: string | null | undefined, resume: AssistantSelectedResume | null) => void;
  setSelectedResume: Dispatch<SetStateAction<AssistantSelectedResume | null>>;
  error: (message: string, duration?: number) => void;
};

type PickerOwnerOperation = {
  expectedAuthCacheKey: string;
  generation: number;
};

const mapResumePickerItem = (item: Awaited<ReturnType<typeof resumeService.list>>[number]): ResumePickerItem => ({
  id: item.id,
  title: item.title || '未命名简历',
  targetRole: item.target_role || '',
  updatedAt: item.updated_at,
  hasJD: hasResumeJDContext(item),
});

export const useAssistantResourcePickers = ({
  authUserKey,
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
  const [pickerDataOwnerKey, setPickerDataOwnerKey] = useState<string | null>(null);
  const listGenerationRef = useRef(0);
  const detailGenerationRef = useRef(0);
  const applyGenerationRef = useRef(0);
  const committedOwnerRef = useRef(authUserKey);
  const visiblePickerResumes = pickerDataOwnerKey === authUserKey ? pickerResumes : [];
  const visiblePickerResumeDetailsById = pickerDataOwnerKey === authUserKey
    ? pickerResumeDetailsById
    : {};

  const beginOperation = useCallback((generationRef: MutableRefObject<number>): PickerOwnerOperation => {
    if (!authUserKey || authUserKey === 'anonymous') {
      throw new ResumeAuthContextChangedError();
    }
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    return { expectedAuthCacheKey: authUserKey, generation };
  }, [authUserKey]);

  const isOperationCurrent = useCallback((
    generationRef: MutableRefObject<number>,
    operation: PickerOwnerOperation,
  ) => (
    generationRef.current === operation.generation
    && committedOwnerRef.current === operation.expectedAuthCacheKey
  ), []);

  const assertOperationCurrent = useCallback(async (
    generationRef: MutableRefObject<number>,
    operation: PickerOwnerOperation,
  ) => {
    if (!isOperationCurrent(generationRef, operation)) {
      throw new ResumeAuthContextChangedError();
    }
    await assertResumeAuthContext(operation.expectedAuthCacheKey);
    if (!isOperationCurrent(generationRef, operation)) {
      throw new ResumeAuthContextChangedError();
    }
  }, [isOperationCurrent]);

  const closeResumePicker = useCallback(() => {
    listGenerationRef.current += 1;
    detailGenerationRef.current += 1;
    applyGenerationRef.current += 1;
    setIsLoadingPickerResumes(false);
    setIsLoadingPickerResumeDetail(false);
    setIsApplyingPickerResume(false);
    setIsResumePickerOpen(false);
  }, []);

  useLayoutEffect(() => {
    if (committedOwnerRef.current === authUserKey) {
      return;
    }
    committedOwnerRef.current = authUserKey;
    closeResumePicker();
    setPickerDataOwnerKey(null);
    setPickerResumes([]);
    setPickerResumeDetailsById({});
  }, [authUserKey, closeResumePicker]);

  const openResumePicker = useCallback(async () => {
    setIsResumePickerOpen(true);
    if (isLoadingPickerResumes) {
      return;
    }
    let operation: PickerOwnerOperation | null = null;
    try {
      operation = beginOperation(listGenerationRef);
      setIsLoadingPickerResumes(true);
      await assertOperationCurrent(listGenerationRef, operation);
      const rows = await resumeService.list({
        expectedAuthCacheKey: operation.expectedAuthCacheKey,
      });
      await assertOperationCurrent(listGenerationRef, operation);
      setPickerDataOwnerKey(operation.expectedAuthCacheKey);
      setPickerResumes(rows.map(mapResumePickerItem));
    } catch (loadError) {
      if (
        loadError instanceof ResumeAuthContextChangedError
        || isAuthContextChangedError(loadError)
        || (operation && !isOperationCurrent(listGenerationRef, operation))
      ) {
        return;
      }
      console.error('[AIAssistant] Failed to load resumes for picker:', loadError);
      error('加载简历列表失败，请稍后重试');
    } finally {
      if (!operation || isOperationCurrent(listGenerationRef, operation)) {
        setIsLoadingPickerResumes(false);
      }
    }
  }, [assertOperationCurrent, beginOperation, error, isLoadingPickerResumes, isOperationCurrent]);

  const loadPickerResumeDetail = useCallback(async (resumeId: string) => {
    let operation: PickerOwnerOperation | null = null;
    try {
      operation = beginOperation(detailGenerationRef);
      setIsLoadingPickerResumeDetail(true);
      await assertOperationCurrent(detailGenerationRef, operation);
      const cached = visiblePickerResumeDetailsById[resumeId];
      if (cached) {
        return cached;
      }
      const resumeList = await resumeService.list({
        expectedAuthCacheKey: operation.expectedAuthCacheKey,
      });
      await assertOperationCurrent(detailGenerationRef, operation);
      if (visiblePickerResumes.length === 0) {
        setPickerDataOwnerKey(operation.expectedAuthCacheKey);
        setPickerResumes(resumeList.map(mapResumePickerItem));
      }
      const selectedResumeRecord = resumeList.find((item) => item.id === resumeId);
      if (!selectedResumeRecord) {
        throw new Error('resume_not_found');
      }
      const [detail, educations, certifications, skills] = await Promise.all([
        resumeService.get(resumeId, {
          expectedAuthCacheKey: operation.expectedAuthCacheKey,
        }),
        experienceService.listAll('education', {
          expectedAuthCacheKey: operation.expectedAuthCacheKey,
        }),
        certificationsService.list({
          expectedAuthCacheKey: operation.expectedAuthCacheKey,
        }),
        skillsService.list({
          expectedAuthCacheKey: operation.expectedAuthCacheKey,
        }),
      ]);
      await assertOperationCurrent(detailGenerationRef, operation);
      const loadedResume = normalizeSelectedResume(
        buildSelectedResumeFromResources(selectedResumeRecord, detail, educations, certifications, skills),
      );
      if (!loadedResume) {
        throw new Error('resume_context_empty');
      }
      setPickerDataOwnerKey(operation.expectedAuthCacheKey);
      setPickerResumeDetailsById((current) => (
        pickerDataOwnerKey === operation?.expectedAuthCacheKey
          ? { ...current, [resumeId]: loadedResume }
          : { [resumeId]: loadedResume }
      ));
      return loadedResume;
    } catch (loadError) {
      if (
        loadError instanceof ResumeAuthContextChangedError
        || isAuthContextChangedError(loadError)
        || (operation && !isOperationCurrent(detailGenerationRef, operation))
      ) {
        return null;
      }
      console.error('[AIAssistant] Failed to load resume detail for picker:', loadError);
      error('加载简历内容失败，请稍后重试');
      return null;
    } finally {
      if (!operation || isOperationCurrent(detailGenerationRef, operation)) {
        setIsLoadingPickerResumeDetail(false);
      }
    }
  }, [
    assertOperationCurrent,
    beginOperation,
    error,
    isOperationCurrent,
    pickerDataOwnerKey,
    visiblePickerResumeDetailsById,
    visiblePickerResumes,
  ]);

  const handleConfirmSelectedResume = useCallback(async (resumeId: string, experienceIds: string[]) => {
    let operation: PickerOwnerOperation | null = null;
    const selectedSessionIdAtStart = selectedSessionIdRef.current;
    const draftLaunchRequestAtStart = draftLaunchRequestRef.current;
    try {
      operation = beginOperation(applyGenerationRef);
      setIsApplyingPickerResume(true);
      await assertOperationCurrent(applyGenerationRef, operation);
      const loadedResume = await loadPickerResumeDetail(resumeId);
      await assertOperationCurrent(applyGenerationRef, operation);
      if (
        selectedSessionIdRef.current !== selectedSessionIdAtStart
        || draftLaunchRequestRef.current !== draftLaunchRequestAtStart
      ) {
        throw new ResumeAuthContextChangedError();
      }
      const nextSelectedResume = buildSelectedResumeWithExperienceSelection(loadedResume, experienceIds);
      if (!nextSelectedResume) {
        error('请至少选择一段简历内经历');
        return;
      }
      if (!selectedSessionIdAtStart) {
        suppressAutoSelectSessionRef.current = true;
        const draftLaunchRequest = draftLaunchRequestAtStart;
        if (draftLaunchRequest && nextSelectedResume) {
          draftLaunchRequestRef.current = {
            ...draftLaunchRequest,
            prefillResume: nextSelectedResume,
          };
        }
      }
      setSelectedResume(nextSelectedResume);
      persistDraftSelectedResume(selectedSessionIdAtStart, nextSelectedResume);
      closeResumePicker();
    } catch (applyError) {
      if (
        applyError instanceof ResumeAuthContextChangedError
        || isAuthContextChangedError(applyError)
        || (operation && !isOperationCurrent(applyGenerationRef, operation))
      ) {
        return;
      }
      console.error('[AIAssistant] Failed to attach selected resume:', applyError);
      error('带入简历失败，请稍后重试');
    } finally {
      if (!operation || isOperationCurrent(applyGenerationRef, operation)) {
        setIsApplyingPickerResume(false);
      }
    }
  }, [
    draftLaunchRequestRef,
    assertOperationCurrent,
    beginOperation,
    closeResumePicker,
    error,
    loadPickerResumeDetail,
    persistDraftSelectedResume,
    selectedSessionIdRef,
    setSelectedResume,
    suppressAutoSelectSessionRef,
    isOperationCurrent,
  ]);

  return {
    pickerResumes: visiblePickerResumes,
    isResumePickerOpen,
    closeResumePicker,
    isLoadingPickerResumes,
    isLoadingPickerResumeDetail,
    isApplyingPickerResume,
    openResumePicker,
    loadPickerResumeDetail,
    handleConfirmSelectedResume,
  };
};
