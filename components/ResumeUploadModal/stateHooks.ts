import { useCallback, useMemo, useRef, useState } from 'react';

import { experienceService } from '../../services/experienceService';
import { certificationsService } from '../../services/certificationsService';
import type { Certification } from '../../services/certificationsService';
import { skillsService, type UserSkill } from '../../services/skillsService';
import {
  type ParsedExperienceItem,
  type ParsedPersonalInfo,
  type ParsedCertification,
  type ParsedSkillGroup,
  type ParsedPersonalInfoSelection,
  parserService,
} from '../../services/parserService';
import { trackExperienceBankImported } from '../../utils/analyticsTracker';
import {
  appendThinkingDelta,
  buildEmptySet,
  buildEmptyThinkingNodes,
  completeThinkingNodes,
  failThinkingNodes,
  getStageForTraceNode,
  normalizeImportVersion,
  sleep,
  type ParseStage,
  type ThinkingNode,
} from './parseUtils';
import {
  buildCertificationImportPayloads,
  buildCertificationDuplicateIds,
  buildDefaultSelection,
  buildParsedCertifications,
  buildParsedSkillGroups,
  buildSkillDuplicateIds,
  buildSkillImportPayloads,
  countSelectedPersonalInfo,
  flattenSkillTags,
  isSupportedFile,
  type ParsedCertificationView,
  type ParsedSkillGroupView,
  type ParsedSkillTagView,
} from './derivedData';

const STAGE_TRANSITION_DELAY_MS = 180;

export const STAGE_PROGRESS: Record<ParseStage, number> = {
  idle: 0,
  uploading: 20,
  parsing: 60,
  analyzing: 85,
  ready: 100,
  error: 0,
};
// Keep the client-side timeout above backend AI_TIMEOUT_SECONDS (300s),
// so the backend can return the real parser or model error instead of the
// browser aborting the stream first.
const PARSE_TIMEOUT_MS = 360_000;
const TIMEOUT_ERROR_NAME = 'ResumeParseTimeout';
const LONG_PARSE_NOTICE_DELAY_MS = 4000;
const LONG_PARSE_NOTICE_DURATION_MS = 8000;
const LONG_PARSE_NOTICE_MESSAGE = '检测到简历内容较长，本次解析可能需要更长时间，请耐心等待。';
const PARSE_SUCCESS_MESSAGE = '简历解析完成';
const REPEATED_PARSE_ERROR_HINT =
  '如果简历文本过长或者含有图片（如模板）可能造成简历无法解析，请使用其他AI助手整理出干净文本再解析';

export type ToastHandlers = {
  success: (message: string, duration?: number) => void;
  error: (message: string, duration?: number) => void;
  info: (message: string, duration?: number) => void;
  loading: (message: string) => string;
  updateToast: (id: string, updates: { message?: string; type?: 'success' | 'error'; duration?: number }) => void;
};

const createTimeoutError = () => {
  const error = new Error('解析超时');
  error.name = TIMEOUT_ERROR_NAME;
  return error;
};

const withTimeout = async <T,>(
  task: Promise<T>,
  timeoutMs: number,
  onTimeout?: () => void
): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => {
      onTimeout?.();
      reject(createTimeoutError());
    }, timeoutMs);
  });

  try {
    return await Promise.race([task, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};

const isAbortLikeError = (error: unknown) => {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.name === 'AbortError' || /aborted|abort/i.test(error.message);
};

const USER_VISIBLE_PARSE_ERROR_PATTERNS = [
  /无法读取附件中的文本内容/,
  /文件为空，无法解析/,
  /不支持的文件类型/,
  /文件过大，无法直接解析/,
  /文件无法读取，请确认文件未损坏、未加密且内容可解析/,
] as const;

const resolveParseErrorMessage = (error: unknown) => {
  if (error instanceof Error && error.name === TIMEOUT_ERROR_NAME) {
    return '解析超时，请稍后重试。';
  }
  if (error instanceof Error && error.message.trim()) {
    const message = error.message.trim();
    if (USER_VISIBLE_PARSE_ERROR_PATTERNS.some((pattern) => pattern.test(message))) {
      return message;
    }
  }
  return '解析失败，请检查文件内容或稍后重试。';
};

const isHttpNotFoundError = (error: unknown) => {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const response = (error as { response?: { status?: number } }).response;
  return response?.status === 404;
};

const buildParseErrorMessage = (error: unknown, errorCount: number) => {
  const baseMessage = resolveParseErrorMessage(error);
  if (errorCount < 2) {
    return baseMessage;
  }
  if (
    baseMessage.includes(REPEATED_PARSE_ERROR_HINT)
    || baseMessage.includes('无法读取附件中的文本内容')
  ) {
    return baseMessage;
  }
  return `${baseMessage} ${REPEATED_PARSE_ERROR_HINT}`;
};

export const useResumeItems = () => {
  const [items, setItems] = useState<ParsedExperienceItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(buildEmptySet);

  const selectedItems = useMemo(
    () => items.filter((item) => selectedIds.has(item.id)),
    [items, selectedIds]
  );

  const applyParsedItems = useCallback((nextItems: ParsedExperienceItem[]) => {
    setItems(nextItems);
    setSelectedIds(buildDefaultSelection(nextItems));
  }, []);

  const resetSelection = useCallback(() => {
    setItems([]);
    setSelectedIds(buildEmptySet());
  }, []);

  const toggleSelection = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      if (prev.size === items.length) {
        return buildEmptySet();
      }
      return new Set(items.map((item) => item.id));
    });
  }, [items]);

  const toggleSelectionBatch = useCallback((ids: string[]) => {
    if (!ids.length) {
      return;
    }
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const isAllSelected = ids.every((id) => next.has(id));
      ids.forEach((id) => {
        if (isAllSelected) {
          next.delete(id);
        } else {
          next.add(id);
        }
      });
      return next;
    });
  }, []);

  return {
    items,
    selectedIds,
    selectedItems,
    applyParsedItems,
    resetSelection,
    toggleSelection,
    toggleSelectAll,
    toggleSelectionBatch,
  };
};

export const useParsedCertifications = () => {
  const [items, setItems] = useState<ParsedCertificationView[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(buildEmptySet);
  const [duplicateIds, setDuplicateIds] = useState<Set<string>>(buildEmptySet);

  const selectedItems = useMemo(
    () => items.filter((item) => selectedIds.has(item.id)),
    [items, selectedIds]
  );

  const applyParsedCertifications = useCallback((
    nextItems: ParsedCertification[],
    existingCertifications?: Certification[]
  ) => {
    const next = buildParsedCertifications(nextItems);
    const nextDuplicates = existingCertifications
      ? buildCertificationDuplicateIds(next, existingCertifications)
      : buildEmptySet();
    setItems(next);
    setDuplicateIds(nextDuplicates);
    setSelectedIds(new Set(next.filter((item) => !nextDuplicates.has(item.id)).map((item) => item.id)));
  }, []);

  const resetSelection = useCallback(() => {
    setItems([]);
    setSelectedIds(buildEmptySet());
    setDuplicateIds(buildEmptySet());
  }, []);

  const toggleSelection = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      if (prev.size === items.length) {
        return buildEmptySet();
      }
      return new Set(items.map((item) => item.id));
    });
  }, [items]);

  return {
    items,
    selectedIds,
    selectedItems,
    duplicateIds,
    applyParsedCertifications,
    resetSelection,
    toggleSelection,
    toggleSelectAll,
  };
};

export const useParsedSkills = () => {
  const [groups, setGroups] = useState<ParsedSkillGroupView[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(buildEmptySet);
  const [duplicateIds, setDuplicateIds] = useState<Set<string>>(buildEmptySet);

  const allTags = useMemo(() => flattenSkillTags(groups), [groups]);
  const selectedTags = useMemo(
    () => allTags.filter((tag) => selectedIds.has(tag.id)),
    [allTags, selectedIds]
  );

  const applyParsedSkills = useCallback((
    nextItems: ParsedSkillGroup[],
    existingSkills?: UserSkill[]
  ) => {
    const nextGroups = buildParsedSkillGroups(nextItems);
    setGroups(nextGroups);
    const nextDuplicates = existingSkills
      ? buildSkillDuplicateIds(nextGroups, existingSkills)
      : buildEmptySet();
    setDuplicateIds(nextDuplicates);
    const nextSelected = new Set(
      flattenSkillTags(nextGroups)
        .filter((tag) => !nextDuplicates.has(tag.id))
        .map((tag) => tag.id)
    );
    setSelectedIds(nextSelected);
  }, []);

  const resetSelection = useCallback(() => {
    setGroups([]);
    setSelectedIds(buildEmptySet());
    setDuplicateIds(buildEmptySet());
  }, []);

  const toggleSelection = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      if (prev.size === allTags.length) {
        return buildEmptySet();
      }
      return new Set(allTags.map((tag) => tag.id));
    });
  }, [allTags]);

  return {
    groups,
    selectedIds,
    selectedTags,
    duplicateIds,
    applyParsedSkills,
    resetSelection,
    toggleSelection,
    toggleSelectAll,
  };
};

export const useResumeParsing = (
  applyParsedItems: (items: ParsedExperienceItem[]) => void,
  applyParsedPersonalInfo: (info?: ParsedPersonalInfo) => void,
  applyParsedCertifications: (
    items: ParsedCertification[],
    existingCertifications?: Certification[]
  ) => void,
  applyParsedSkills: (items: ParsedSkillGroup[], existingSkills?: UserSkill[]) => void,
  toast: ToastHandlers
) => {
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<ParseStage>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [thinkingNodes, setThinkingNodes] = useState<ThinkingNode[]>(buildEmptyThinkingNodes);
  const [enableThinking, setEnableThinking] = useState(false);
  const longParseNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const parseErrorCountRef = useRef(0);
  const activeParseControllerRef = useRef<AbortController | null>(null);
  const parseRunIdRef = useRef(0);

  const clearLongParseNotice = useCallback(() => {
    if (longParseNoticeTimerRef.current) {
      clearTimeout(longParseNoticeTimerRef.current);
      longParseNoticeTimerRef.current = null;
    }
  }, []);

  const cancelActiveParse = useCallback(() => {
    const currentController = activeParseControllerRef.current;
    if (!currentController) {
      return;
    }
    activeParseControllerRef.current = null;
    currentController.abort();
  }, []);

  const resetParsing = useCallback(() => {
    cancelActiveParse();
    clearLongParseNotice();
    parseErrorCountRef.current = 0;
    setFile(null);
    setStage('idle');
    setErrorMessage(null);
    setIsDragging(false);
    setThinkingNodes(buildEmptyThinkingNodes());
  }, [cancelActiveParse, clearLongParseNotice]);

  const scheduleLongParseNotice = useCallback(() => {
    clearLongParseNotice();
    longParseNoticeTimerRef.current = setTimeout(() => {
      toast.info(LONG_PARSE_NOTICE_MESSAGE, LONG_PARSE_NOTICE_DURATION_MS);
      longParseNoticeTimerRef.current = null;
    }, LONG_PARSE_NOTICE_DELAY_MS);
  }, [clearLongParseNotice, toast]);

  const fetchExistingSkills = useCallback(async () => {
    try {
      return await skillsService.list({ force: true });
    } catch (error) {
      console.error('[ResumeUploadModal] Failed to fetch skills for dedupe:', error);
      return [];
    }
  }, []);

  const fetchExistingCertifications = useCallback(async () => {
    try {
      return await certificationsService.list({ force: true });
    } catch (error) {
      console.error('[ResumeUploadModal] Failed to fetch certifications for dedupe:', error);
      return [];
    }
  }, []);

  const handleFileParse = useCallback(
    async (nextFile: File) => {
      cancelActiveParse();
      clearLongParseNotice();
      applyParsedItems([]);
      applyParsedPersonalInfo(undefined);
      applyParsedCertifications([]);
      applyParsedSkills([]);
      if (!isSupportedFile(nextFile)) {
        setErrorMessage('仅支持 PDF 或 DOCX 格式的简历。');
        setStage('error');
        return;
      }
      setErrorMessage(null);
      setStage('uploading');
      setFile(nextFile);
      setThinkingNodes(buildEmptyThinkingNodes());
      const currentRunId = parseRunIdRef.current + 1;
      parseRunIdRef.current = currentRunId;
      const abortController = new AbortController();
      let didTimeout = false;
      const isCurrentParseRun = () =>
        parseRunIdRef.current === currentRunId
        && activeParseControllerRef.current === abortController;

      try {
        activeParseControllerRef.current = abortController;
        await sleep(STAGE_TRANSITION_DELAY_MS);
        if (!isCurrentParseRun()) {
          return;
        }
        setStage('parsing');
        scheduleLongParseNotice();
        const response = await withTimeout(
          parserService.parseResume(
            nextFile,
            (event) => {
              if (!isCurrentParseRun()) {
                return;
              }
              if (event.type === 'progress') {
                setStage(getStageForTraceNode(event.node));
                return;
              }
              if (event.type === 'thought_reset') {
                setThinkingNodes(buildEmptyThinkingNodes());
                return;
              }
              if (event.type === 'thought') {
                setThinkingNodes((prev) => appendThinkingDelta(prev, event.summary));
              }
            },
            abortController.signal,
            { enableThinking }
          ),
          PARSE_TIMEOUT_MS,
          () => {
            didTimeout = true;
            abortController.abort();
          }
        );
        if (!isCurrentParseRun()) {
          return;
        }
        await sleep(STAGE_TRANSITION_DELAY_MS);
        if (!isCurrentParseRun()) {
          return;
        }
        setStage('analyzing');
        await sleep(STAGE_TRANSITION_DELAY_MS);
        if (!isCurrentParseRun()) {
          return;
        }
        applyParsedItems(response.items || []);
        applyParsedPersonalInfo(response.personal_info);
        const [existingCertifications, existingSkills] = await Promise.all([
          fetchExistingCertifications(),
          fetchExistingSkills(),
        ]);
        if (!isCurrentParseRun()) {
          return;
        }
        applyParsedCertifications(response.certifications || [], existingCertifications);
        applyParsedSkills(response.skills || [], existingSkills);
        setThinkingNodes((prev) => completeThinkingNodes(prev));
        setStage('ready');
        toast.success(PARSE_SUCCESS_MESSAGE);
        parseErrorCountRef.current = 0;
      } catch (error) {
        if (parseRunIdRef.current !== currentRunId) {
          return;
        }
        if (isAbortLikeError(error) && !didTimeout) {
          return;
        }
        const resolvedError =
          didTimeout && isAbortLikeError(error) ? createTimeoutError() : error;
        console.error('[ResumeUploadModal] Failed to parse resume:', error);
        parseErrorCountRef.current += 1;
        const message = buildParseErrorMessage(resolvedError, parseErrorCountRef.current);
        setErrorMessage(message);
        setThinkingNodes((prev) => failThinkingNodes(prev));
        setStage('error');
        toast.error(message);
      } finally {
        if (activeParseControllerRef.current === abortController) {
          activeParseControllerRef.current = null;
        }
        if (parseRunIdRef.current === currentRunId) {
          clearLongParseNotice();
        }
      }
    },
    [
      applyParsedItems,
      applyParsedPersonalInfo,
      applyParsedCertifications,
      applyParsedSkills,
      cancelActiveParse,
      clearLongParseNotice,
      fetchExistingSkills,
      fetchExistingCertifications,
      enableThinking,
      scheduleLongParseNotice,
      toast,
    ]
  );

  const handleFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const nextFile = event.target.files?.[0];
      event.target.value = '';
      if (nextFile) {
        handleFileParse(nextFile);
      }
    },
    [handleFileParse]
  );

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const nextFile = event.dataTransfer.files?.[0];
      setIsDragging(false);
      if (nextFile) {
        handleFileParse(nextFile);
      }
    },
    [handleFileParse]
  );

  return {
    file,
    stage,
    errorMessage,
    isDragging,
    thinkingNodes,
    enableThinking,
    setEnableThinking,
    setIsDragging,
    handleFileChange,
    handleDrop,
    resetParsing,
  };
};

export const useResumeImport = (
  selectedItems: ParsedExperienceItem[],
  selectedCertifications: ParsedCertificationView[],
  selectedSkillTags: ParsedSkillTagView[],
  personalInfoSelection: ParsedPersonalInfoSelection,
  toast: ToastHandlers,
  onImported: () => Promise<void> | void,
  onClose: () => void
) => {
  const [isImporting, setIsImporting] = useState(false);

  const handleImport = useCallback(async () => {
    const personalInfoSelectedCount = countSelectedPersonalInfo(personalInfoSelection);
    const totalSelected =
      selectedItems.length
      + selectedCertifications.length
      + selectedSkillTags.length
      + personalInfoSelectedCount;
    if (!totalSelected) {
      toast.error('请选择要导入的内容');
      return;
    }

    let toastId: string | null = null;
    try {
      setIsImporting(true);
      toastId = toast.loading('正在导入选择的内容...');
      let experienceCount = 0;
      let certificationCount = 0;
      let skillCount = 0;
      const unavailableModules: string[] = [];
      for (const item of selectedItems) {
        await experienceService.create({
          category: item.category,
          version: normalizeImportVersion(item.version),
        });
        experienceCount += 1;
      }
      let certificationPayloads: Awaited<ReturnType<typeof buildCertificationImportPayloads>> = [];
      try {
        certificationPayloads = await buildCertificationImportPayloads(selectedCertifications);
      } catch (error) {
        if (isHttpNotFoundError(error)) {
          unavailableModules.push('证书');
          console.warn('[ResumeUploadModal] Certifications API unavailable, skip import.', error);
        } else {
          throw error;
        }
      }
      let skillPayloads: Awaited<ReturnType<typeof buildSkillImportPayloads>> = [];
      try {
        skillPayloads = await buildSkillImportPayloads(selectedSkillTags);
      } catch (error) {
        if (isHttpNotFoundError(error)) {
          unavailableModules.push('技能');
          console.warn('[ResumeUploadModal] Skills API unavailable, skip import.', error);
        } else {
          throw error;
        }
      }
      for (const payload of certificationPayloads) {
        try {
          await certificationsService.create(payload);
        } catch (error) {
          if (isHttpNotFoundError(error)) {
            if (!unavailableModules.includes('证书')) {
              unavailableModules.push('证书');
            }
            console.warn('[ResumeUploadModal] Certifications API unavailable during create, skip rest.', error);
            break;
          }
          throw error;
        }
        certificationCount += 1;
      }
      for (const payload of skillPayloads) {
        try {
          await skillsService.create(payload);
        } catch (error) {
          if (isHttpNotFoundError(error)) {
            if (!unavailableModules.includes('技能')) {
              unavailableModules.push('技能');
            }
            console.warn('[ResumeUploadModal] Skills API unavailable during create, skip rest.', error);
            break;
          }
          throw error;
        }
        skillCount += 1;
      }
      const summaryParts = [];
      if (experienceCount > 0) {
        summaryParts.push(`已导入 ${experienceCount} 条经历`);
      }
      if (certificationCount > 0) {
        summaryParts.push(`已导入 ${certificationCount} 张证书`);
      }
      if (skillCount > 0) {
        summaryParts.push(`已导入 ${skillCount} 项技能`);
      }
      if (personalInfoSelectedCount > 0) {
        summaryParts.push(`已更新 ${personalInfoSelectedCount} 项个人信息`);
      }
      if (unavailableModules.length > 0) {
        summaryParts.push(`${unavailableModules.join('、')}模块暂不可用，已自动跳过`);
      }
      const summary = summaryParts.length ? summaryParts.join(' / ') : '没有新内容可导入';
      if (toastId) {
        toast.updateToast(toastId, {
          message: summary,
          type: 'success',
          duration: 2500,
        });
      } else {
        toast.success(summary);
      }
      trackExperienceBankImported({
        experienceCount,
        certificationCount,
        skillCount,
        personalInfoCount: personalInfoSelectedCount,
        totalSelected,
      });
      await onImported();
      onClose();
    } catch (error) {
      console.error('[ResumeUploadModal] Import failed:', error);
      if (toastId) {
        toast.updateToast(toastId, {
          message: '导入失败，请稍后重试',
          type: 'error',
          duration: 3000,
        });
      } else {
        toast.error('导入失败，请稍后重试');
      }
    } finally {
      setIsImporting(false);
    }
  }, [
    onClose,
    onImported,
    selectedItems,
    selectedCertifications,
    selectedSkillTags,
    personalInfoSelection,
    toast,
  ]);

  return { isImporting, handleImport };
};

