import { useCallback, useEffect, useRef, useState } from 'react';
import { aiService, type PolishExperienceResponse } from '../../services/aiService';
import type { PolishPreviewState } from '../../types/resume';
import { resolveThoughtDisplayEvent } from '../../utils/aiThought';
import {
  trackAiPolishResult,
  trackAiPolishStart,
  trackAiPolishUndone,
} from '../../utils/analyticsTracker';
import { normalizeAiRichText } from '../../utils/richText';
import type { ExperienceCardData, StarFieldKey } from '../ExperienceCard';
import {
  buildStarFieldState,
  buildStarPolishPayload,
  cloneExperienceCardData,
  getStarFieldValue,
  isTempId,
  STAR_FIELD_KEYS,
} from './cardDataUtils';
import type { CardPolishMode, ExperienceSectionProps, ToastApi } from './types';

type ExperienceAiParams = {
  cardData: Map<string, ExperienceCardData>;
  toast: ToastApi;
  updateCardField: (cardId: string, field: string, value: string | string[]) => void;
  updateCardData: (cardId: string, data: ExperienceCardData) => void;
};

type ExperiencePolishParams = ExperienceAiParams & {
  category: ExperienceSectionProps['category'];
  updateCardStar: (cardId: string, star: Record<StarFieldKey, string>) => void;
  onLaunchAssistant?: ExperienceSectionProps['onLaunchAssistant'];
  hasPendingAiPolishApply: (cardId: string) => boolean;
  markPendingAiPolishApply: (cardId: string) => void;
  clearPendingAiPolishApply: (cardId: string) => void;
};

type StarSnapshot = {
  before: string;
  after: string;
};

type StarSnapshotMap = Partial<Record<StarFieldKey, StarSnapshot>>;

export const POLISH_SOURCE = 'experience_bank';
const DEFAULT_POLISH_MODE: CardPolishMode = 'default';
const POLISH_TOAST_MESSAGES = {
  loading: '正在进行 AI 润色...',
  success: 'AI 润色完成',
  noChange: 'AI 润色完成，但未产生可用调整',
  error: 'AI 润色失败，请稍后重试',
  empty: '请先填写 STAR 内容再润色',
} as const;
const POLISH_TOAST_DURATION_MS = 2500;
const POLISH_TOAST_ERROR_DURATION_MS = 3000;

const normalizePolishField = (value: string | undefined) => {
  if (!value) {
    return undefined;
  }
  const normalized = normalizeAiRichText(value, { allowList: false });
  return normalized.trim() ? normalized : undefined;
};

const buildStarUpdates = (result: PolishExperienceResponse) => {
  const updates: Partial<Record<StarFieldKey, string>> = {};
  STAR_FIELD_KEYS.forEach((key) => {
    const normalized = normalizePolishField(result[key]);
    if (typeof normalized === 'string') {
      updates[key] = normalized;
    }
  });
  return updates;
};

const mergeStarUpdates = (
  current: Record<StarFieldKey, string>,
  updates: Partial<Record<StarFieldKey, string>>
) => ({
  s: typeof updates.s === 'string' ? updates.s : current.s,
  t: typeof updates.t === 'string' ? updates.t : current.t,
  a: typeof updates.a === 'string' ? updates.a : current.a,
  r: typeof updates.r === 'string' ? updates.r : current.r,
});

const buildStarSnapshots = (
  before: Record<StarFieldKey, string>,
  after: Record<StarFieldKey, string>
) => {
  const snapshots: StarSnapshotMap = {};
  STAR_FIELD_KEYS.forEach((key) => {
    if (before[key] !== after[key]) {
      snapshots[key] = { before: before[key], after: after[key] };
    }
  });
  return snapshots;
};

const hasStarSnapshots = (snapshots: StarSnapshotMap) =>
  STAR_FIELD_KEYS.some((key) => Boolean(snapshots[key]));

const hasStarChanges = (
  before: Record<StarFieldKey, string>,
  after: Record<StarFieldKey, string>
) => STAR_FIELD_KEYS.some((key) => before[key] !== after[key]);

const useStarSnapshotStore = (
  cardData: Map<string, ExperienceCardData>,
  updateCardField: (cardId: string, field: string, value: string | string[]) => void
) => {
  const snapshotRef = useRef<Map<string, StarSnapshotMap>>(new Map());

  const storeStarSnapshots = useCallback((cardId: string, snapshots: StarSnapshotMap) => {
    if (!hasStarSnapshots(snapshots)) {
      snapshotRef.current.delete(cardId);
      return;
    }
    snapshotRef.current.set(cardId, snapshots);
  }, []);

  const clearStarSnapshot = useCallback((cardId: string, field: StarFieldKey) => {
    const snapshots = snapshotRef.current.get(cardId);
    if (!snapshots || !snapshots[field]) {
      return;
    }
    const nextSnapshots = { ...snapshots };
    delete nextSnapshots[field];
    if (hasStarSnapshots(nextSnapshots)) {
      snapshotRef.current.set(cardId, nextSnapshots);
    } else {
      snapshotRef.current.delete(cardId);
    }
  }, []);

  const clearCardSnapshots = useCallback((cardId: string) => {
    snapshotRef.current.delete(cardId);
  }, []);

  const handleUndo = useCallback(
    (cardId: string, field: StarFieldKey) => {
      const snapshots = snapshotRef.current.get(cardId);
      const snapshot = snapshots?.[field];
      if (!snapshot) {
        return false;
      }
      const data = cardData.get(cardId);
      if (!data) {
        return false;
      }
      const currentValue = getStarFieldValue(data, field);
      if (currentValue !== snapshot.after) {
        return false;
      }
      updateCardField(cardId, `star.${field}`, snapshot.before);
      const nextSnapshots = { ...snapshots };
      delete nextSnapshots[field];
      if (hasStarSnapshots(nextSnapshots)) {
        snapshotRef.current.set(cardId, nextSnapshots);
      } else {
        snapshotRef.current.delete(cardId);
      }
      return true;
    },
    [cardData, updateCardField]
  );

  return { storeStarSnapshots, clearStarSnapshot, clearCardSnapshots, handleUndo };
};

export const usePolishActions = ({
  cardData,
  toast,
  updateCardField,
  updateCardData,
  updateCardStar,
  category,
  onLaunchAssistant,
  hasPendingAiPolishApply,
  markPendingAiPolishApply,
  clearPendingAiPolishApply,
}: ExperiencePolishParams) => {
  const [polishingTargets, setPolishingTargets] = useState<Set<string>>(new Set());
  const [polishModes, setPolishModes] = useState<Map<string, CardPolishMode>>(new Map());
  const [customPrompts, setCustomPrompts] = useState<Map<string, string>>(new Map());
  const [previewStates, setPreviewStates] = useState<Map<string, PolishPreviewState<ExperienceCardData>>>(new Map());
  const cardDataRef = useRef(cardData);
  const { storeStarSnapshots, clearStarSnapshot, clearCardSnapshots, handleUndo } = useStarSnapshotStore(
    cardData,
    updateCardField
  );

  useEffect(() => {
    cardDataRef.current = cardData;
  }, [cardData]);

  const updatePolishingTarget = useCallback((cardId: string, polishing: boolean) => {
    setPolishingTargets((prev) => {
      const next = new Set(prev);
      if (polishing) {
        next.add(cardId);
      } else {
        next.delete(cardId);
      }
      return next;
    });
  }, []);

  const getPolishMode = useCallback(
    (cardId: string): CardPolishMode => polishModes.get(cardId) ?? DEFAULT_POLISH_MODE,
    [polishModes]
  );

  const getCustomPrompt = useCallback(
    (cardId: string) => customPrompts.get(cardId) ?? '',
    [customPrompts]
  );

  const isPreviewingPolish = useCallback(
    (cardId: string) => previewStates.has(cardId),
    [previewStates]
  );

  const handlePolishModeChange = useCallback((cardId: string, mode: CardPolishMode) => {
    setPolishModes((prev) => new Map(prev).set(cardId, mode));
  }, []);

  const handleCustomPromptChange = useCallback((cardId: string, value: string) => {
    setCustomPrompts((prev) => new Map(prev).set(cardId, value));
  }, []);

  const handleRunPolish = useCallback(
    async (cardId: string) => {
      if (polishingTargets.has(cardId)) {
        return;
      }
      const data = cardData.get(cardId);
      if (!data) {
        return;
      }
      const { content, hasContent } = buildStarPolishPayload(data);
      if (!hasContent) {
        toast.error(POLISH_TOAST_MESSAGES.empty);
        return;
      }

      const startTime = Date.now();
      let action: 'applied' | 'discarded' = 'discarded';
      let toastId: string | null = null;
      let hasError = false;
      const mode = getPolishMode(cardId);
      const customPrompt = getCustomPrompt(cardId).trim();
      trackAiPolishStart({ source: POLISH_SOURCE, field: 'all', category });
      updatePolishingTarget(cardId, true);
      toastId = toast.loading(POLISH_TOAST_MESSAGES.loading);
      try {
        const response = await aiService.polishExperienceStream({
          content,
          mode,
          customPrompt: mode === 'custom' ? customPrompt : undefined,
          entrySource: 'experience_bank',
        }, (event) => {
          if (!toastId) {
            return;
          }
          const resolution = resolveThoughtDisplayEvent(event);
          if (resolution?.kind !== 'model_thought') {
            return;
          }
          toast.updateToast(toastId, { message: resolution.text, type: 'ai_thinking', duration: 0 });
        });
        const latestData = cardDataRef.current.get(cardId);
        if (!latestData) {
          return;
        }
        const currentStar = buildStarFieldState(latestData);
        const updates = buildStarUpdates(response ?? {});
        const nextStar = mergeStarUpdates(currentStar, updates);
        if (hasStarChanges(currentStar, nextStar)) {
          updateCardStar(cardId, nextStar);
          storeStarSnapshots(cardId, buildStarSnapshots(currentStar, nextStar));
          setPreviewStates((prev) => {
            const next = new Map(prev);
            next.set(cardId, {
              mode,
              customPrompt: mode === 'custom' ? customPrompt : undefined,
              before: cloneExperienceCardData(data),
              after: cloneExperienceCardData({
                ...latestData,
                star: nextStar,
              }),
              hadPendingApplyBeforePreview: hasPendingAiPolishApply(cardId),
            });
            return next;
          });
          action = 'applied';
        }
      } catch (error) {
        console.error('[ExperienceSection] AI 润色失败:', error);
        hasError = true;
      } finally {
        const message = hasError
          ? POLISH_TOAST_MESSAGES.error
          : action === 'applied'
            ? POLISH_TOAST_MESSAGES.success
            : POLISH_TOAST_MESSAGES.noChange;
        const duration = hasError ? POLISH_TOAST_ERROR_DURATION_MS : POLISH_TOAST_DURATION_MS;
        const type = hasError ? 'error' : 'success';
        if (toastId) {
          toast.updateToast(toastId, { message, type, duration });
        } else if (hasError) {
          toast.error(message, duration);
        } else {
          toast.success(message, duration);
        }
        trackAiPolishResult({
          source: POLISH_SOURCE,
          field: 'all',
          category,
          action,
          durationMs: Date.now() - startTime,
        });
        updatePolishingTarget(cardId, false);
      }
    },
    [
      cardData,
      category,
      getCustomPrompt,
      getPolishMode,
      polishingTargets,
      storeStarSnapshots,
      toast,
      updateCardStar,
      updatePolishingTarget,
    ]
  );

  const handleUndoPolishPreview = useCallback((cardId: string) => {
    const preview = previewStates.get(cardId);
    if (!preview) {
      return;
    }
    const current = cardDataRef.current.get(cardId);
    const nextData = cloneExperienceCardData(current ?? preview.before);
    STAR_FIELD_KEYS.forEach((key) => {
      if (nextData.star[key] === preview.after.star[key]) {
        nextData.star[key] = preview.before.star[key];
      }
    });
    updateCardData(cardId, nextData);
    clearCardSnapshots(cardId);
    setPreviewStates((prev) => {
      const next = new Map(prev);
      next.delete(cardId);
      return next;
    });
    if (preview.hadPendingApplyBeforePreview) {
      markPendingAiPolishApply(cardId);
    } else {
      clearPendingAiPolishApply(cardId);
    }
    trackAiPolishUndone({ source: POLISH_SOURCE, field: 'all', category });
  }, [category, clearCardSnapshots, clearPendingAiPolishApply, markPendingAiPolishApply, previewStates, updateCardData]);

  const clearPreviewState = useCallback((cardId: string) => {
    clearCardSnapshots(cardId);
    setPreviewStates((prev) => {
      if (!prev.has(cardId)) {
        return prev;
      }
      const next = new Map(prev);
      next.delete(cardId);
      return next;
    });
  }, [clearCardSnapshots]);

  const handleConfirmPolishPreview = useCallback((cardId: string) => {
    if (!previewStates.has(cardId)) {
      return;
    }
    markPendingAiPolishApply(cardId);
    clearPreviewState(cardId);
  }, [clearPreviewState, markPendingAiPolishApply, previewStates]);

  const handleOpenAssistant = useCallback((cardId: string) => {
    const current = cardDataRef.current.get(cardId);
    if (!current || !onLaunchAssistant) {
      return;
    }
    if (isTempId(cardId)) {
      toast.error('请先保存这段经历，再使用 AI 助手', 3000);
      return;
    }
    onLaunchAssistant({
      context: {
        mode: 'experience',
        entrySource: 'experience_bank',
        title: `${current.org || '未命名经历'} · AI 助手`,
        contextJson: {
          origin: 'experience_bank_card_toolbar',
          masterId: cardId,
          category,
          org: current.org,
          title: current.title,
          startDate: current.start_date,
          endDate: current.end_date,
          star: current.star,
        },
      },
    });
  }, [category, onLaunchAssistant, toast]);

  const isPolishing = useCallback(
    (cardId: string) => polishingTargets.has(cardId),
    [polishingTargets]
  );

  return {
    getPolishMode,
    getCustomPrompt,
    isPreviewingPolish,
    handlePolishModeChange,
    handleCustomPromptChange,
    handleRunPolish,
    handleUndoPolishPreview,
    handleConfirmPolishPreview,
    handleOpenAssistant,
    isPolishing,
    handleUndo,
    clearStarSnapshot,
    clearPreviewState,
  };
};
