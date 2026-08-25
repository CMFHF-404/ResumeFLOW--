import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ExperienceListItem } from '../../services/experienceService';
import type { ExperienceCardData, StarFieldKey } from '../ExperienceCard';
import { aiService } from '../../services/aiService';
import { experienceDraftService, type ExperienceDraftRecord } from '../../services/experienceDraftService';
import {
  useCardDataStore,
  useCardEditors,
  useCardExpansionState,
  useCardInitializer,
  useCardRefs,
  useCardRemoval,
} from './cardDataHooks';
import {
  buildDraftCardData,
  cloneExperienceCardData,
  createEmptyCardData,
  isTempId,
  STAR_FIELD_KEYS,
} from './cardDataUtils';
import {
  joinStarFieldsForSimpleMode,
  parseSimpleExperienceText,
  validateSplitCoverage,
} from './experienceSimpleModeParser';
import { useExperienceCreate, useExperienceDelete, useExperienceSave } from './experienceActions';
import { useExperienceList, useSortedExperiences } from './experienceListHooks';
import { usePolishActions } from './polishActions';
import type { CardPolishMode, ExperienceSectionModel, ExperienceSectionProps } from './types';
import { useAuthOwnerOperationGuard } from '../../hooks/useAuthOwnerOperationGuard';
import { AuthContextChangedError, isAuthContextChangedError } from '../../services/apiClient';

const MAX_SPLIT_EXPERIENCE_CACHE_ENTRIES = 24;

const normalizeSplitExperienceCacheText = (value?: string | null) => (value || '').trim();

const buildSplitExperienceCacheKey = (
  cardId: string,
  category: string,
  data: ExperienceCardData
) => JSON.stringify([
  cardId,
  category,
  normalizeSplitExperienceCacheText(data.org),
  normalizeSplitExperienceCacheText(data.title),
  data.simpleText || '',
]);

const rememberSplitExperienceResult = (
  cache: Map<string, Record<StarFieldKey, string>>,
  key: string,
  value: Record<StarFieldKey, string>
) => {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > MAX_SPLIT_EXPERIENCE_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (!oldestKey) {
      break;
    }
    cache.delete(oldestKey);
  }
};

type SectionModelInput = {
  experiences: ExperienceListItem[];
  sortedExperiences: ExperienceListItem[];
  isLoading: boolean;
  isCreating: boolean;
  cardData: Map<string, ExperienceCardData>;
  expandedCards: Set<string>;
  collapsingCards: Set<string>;
  modifiedCards: Set<string>;
  isCardBusy: (cardId: string) => boolean;
  deletingCardId: string | null;
  setCardRef: (cardId: string, element: HTMLDivElement | null) => void;
  isPolishing: (cardId: string) => boolean;
  getPolishMode: (cardId: string) => CardPolishMode;
  getCustomPrompt: (cardId: string) => string;
  isPreviewingPolish: (cardId: string) => boolean;
  onAdd: () => void;
  onToggle: (cardId: string) => void;
  onDeleteRequest: (cardId: string) => void;
  onSave: (cardId: string) => void;
  onPreviewSimpleEntry: (cardId: string) => void;
  onCancel: (cardId: string) => void;
  onFieldChange: (cardId: string, field: string, value: string | string[]) => void;
  onEditModeChange: (cardId: string, mode: 'simple' | 'expert') => void;
  onPolishModeChange: (cardId: string, mode: CardPolishMode) => void;
  onCustomPromptChange: (cardId: string, value: string) => void;
  onRunPolish: (cardId: string) => void;
  onUndoPolishPreview: (cardId: string) => void;
  onConfirmPolishPreview: (cardId: string) => void;
  onOpenAssistant: (cardId: string) => void;
  onUndo: (cardId: string, field: StarFieldKey) => boolean;
  onDeleteConfirm: () => void;
  onDeleteCancel: () => void;
};

const buildSectionModel = (input: SectionModelInput): ExperienceSectionModel => ({
  experiences: input.experiences,
  sortedExperiences: input.sortedExperiences,
  isLoading: input.isLoading,
  isCreating: input.isCreating,
  cardData: input.cardData,
  expandedCards: input.expandedCards,
  collapsingCards: input.collapsingCards,
  modifiedCards: input.modifiedCards,
  isCardBusy: input.isCardBusy,
  deletingCardId: input.deletingCardId,
  setCardRef: input.setCardRef,
  isPolishing: input.isPolishing,
  getPolishMode: input.getPolishMode,
  getCustomPrompt: input.getCustomPrompt,
  isPreviewingPolish: input.isPreviewingPolish,
  onAdd: input.onAdd,
  onToggle: input.onToggle,
  onDeleteRequest: input.onDeleteRequest,
  onSave: input.onSave,
  onPreviewSimpleEntry: input.onPreviewSimpleEntry,
  onCancel: input.onCancel,
  onFieldChange: input.onFieldChange,
  onEditModeChange: input.onEditModeChange,
  onPolishModeChange: input.onPolishModeChange,
  onCustomPromptChange: input.onCustomPromptChange,
  onRunPolish: input.onRunPolish,
  onUndoPolishPreview: input.onUndoPolishPreview,
  onConfirmPolishPreview: input.onConfirmPolishPreview,
  onOpenAssistant: input.onOpenAssistant,
  onUndo: input.onUndo,
  onDeleteConfirm: input.onDeleteConfirm,
  onDeleteCancel: input.onDeleteCancel,
});

export const useExperienceSectionModel = ({
  category,
  refreshSignal,
  defaultOrg,
  emptyTitleError,
  titleRequired = true,
  toast,
  authUserKey,
  isAuthenticated,
  onRequireAuth,
  onLaunchAssistant,
  focusRequest,
}: ExperienceSectionProps): ExperienceSectionModel => {
  const ownerGuard = useAuthOwnerOperationGuard(authUserKey ?? null);
  const activeLoadingToastIdsRef = useRef<Set<string>>(new Set());
  const trackedToast = useMemo(() => ({
    ...toast,
    loading: (message: string) => {
      const id = toast.loading(message);
      activeLoadingToastIdsRef.current.add(id);
      return id;
    },
    updateToast: (id: string, updates: Parameters<typeof toast.updateToast>[1]) => {
      if (updates.type && updates.type !== 'loading' && updates.type !== 'ai_thinking') {
        activeLoadingToastIdsRef.current.delete(id);
      }
      toast.updateToast(id, updates);
    },
    closeToast: (id: string) => {
      activeLoadingToastIdsRef.current.delete(id);
      toast.closeToast?.(id);
    },
  }), [toast]);

  useLayoutEffect(() => {
    for (const id of activeLoadingToastIdsRef.current) {
      toast.closeToast?.(id);
    }
    activeLoadingToastIdsRef.current.clear();
  }, [authUserKey, toast]);

  useEffect(() => () => {
    for (const id of activeLoadingToastIdsRef.current) {
      toast.closeToast?.(id);
    }
    activeLoadingToastIdsRef.current.clear();
  }, [toast]);

  const { experiences, setExperiences, isLoading, refreshExperiences } = useExperienceList(
    category,
    refreshSignal,
    isAuthenticated,
    authUserKey,
    ownerGuard,
  );
  const { setCardRef, scrollToCard, highlightCard } = useCardRefs();
  const store = useCardDataStore();
  const [previewingCardId, setPreviewingCardId] = useState<string | null>(null);
  const previewingCardIdRef = useRef<string | null>(null);
  const pendingAiPolishApplyRef = useRef(new Set<string>());
  const draftSaveTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const draftSaveRequestsRef = useRef<Map<string, Promise<ExperienceDraftRecord | null>>>(new Map());
  const draftSaveQueueRef = useRef<Map<string, Promise<ExperienceDraftRecord | null>>>(new Map());
  const latestSavedDraftsRef = useRef<Map<string, ExperienceDraftRecord>>(new Map());
  const lastFocusRequestIdRef = useRef<number | null>(null);
  const invalidatedDraftSaveCardsRef = useRef(new Set<string>());
  const splitExperienceCacheRef = useRef<Map<string, Record<StarFieldKey, string>>>(new Map());
  const { ensureCardState } = useCardInitializer(experiences, store.setCardData, store.setOriginalCardData);
  const { updateCardField, updateCardStar, updateCardData, resetCard } = useCardEditors(
    store.originalCardData,
    store.setCardData,
    store.setModifiedCards
  );
  const markPendingAiPolishApply = useCallback((cardId: string) => {
    pendingAiPolishApplyRef.current.add(cardId);
  }, []);
  const hasPendingAiPolishApply = useCallback((cardId: string) => {
    return pendingAiPolishApplyRef.current.has(cardId);
  }, []);
  const clearPendingAiPolishApply = useCallback((cardId: string) => {
    pendingAiPolishApplyRef.current.delete(cardId);
  }, []);
  const { removeCardState } = useCardRemoval(store.setCardData, store.setModifiedCards, store.setOriginalCardData);
  const expansion = useCardExpansionState(ensureCardState, scrollToCard, highlightCard);
  const requireAuth = useCallback(() => {
    if (!isAuthenticated) {
      void onRequireAuth();
      return true;
    }
    return false;
  }, [isAuthenticated, onRequireAuth]);
  const clearDraftSaveTimer = useCallback((cardId: string) => {
    const pendingTimer = draftSaveTimersRef.current.get(cardId);
    if (!pendingTimer) {
      return;
    }
    clearTimeout(pendingTimer);
    draftSaveTimersRef.current.delete(cardId);
  }, []);
  const flushDraftSave = useCallback(async (cardId: string) => {
    clearDraftSaveTimer(cardId);
    const pendingRequest = draftSaveRequestsRef.current.get(cardId);
    if (!pendingRequest) {
      return null;
    }
    const saved = await pendingRequest;
    return saved
      ? { draftId: saved.id, clientDraftKey: saved.client_draft_key }
      : null;
  }, [clearDraftSaveTimer]);
  const discardDraftAutosave = useCallback(async (cardId: string) => {
    clearDraftSaveTimer(cardId);
    invalidatedDraftSaveCardsRef.current.add(cardId);
    const pendingRequest = draftSaveQueueRef.current.get(cardId) ?? draftSaveRequestsRef.current.get(cardId);
    if (!pendingRequest) {
      return latestSavedDraftsRef.current.get(cardId) ?? null;
    }
    const saved = await pendingRequest;
    return saved ?? latestSavedDraftsRef.current.get(cardId) ?? null;
  }, [clearDraftSaveTimer]);
  const { isCreating, handleAddNew } = useExperienceCreate({
    category, defaultOrg, toast: trackedToast, setExperiences,
    setCardData: store.setCardData,
    setOriginalCardData: store.setOriginalCardData,
    setModifiedCards: store.setModifiedCards,
    setExpandedCards: expansion.setExpandedCards,
  });
  const deleteActions = useExperienceDelete({
    ownerGuard, category, cardData: store.cardData, toast: trackedToast, refreshExperiences, highlightCard, setExperiences,
    removeCardState,
    removeCardExpansion: expansion.removeCardExpansion,
    onBeforeRemoveLocal: discardDraftAutosave,
  });
  const {
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
  } = usePolishActions({
    ownerGuard,
    cardData: store.cardData,
    toast: trackedToast,
    updateCardField,
    updateCardData,
    updateCardStar,
    category,
    onLaunchAssistant,
    hasPendingAiPolishApply,
    markPendingAiPolishApply,
    clearPendingAiPolishApply,
  });
  const { savingCardId, handleSaveCard: saveExperienceCard } = useExperienceSave({
    ownerGuard, category, cardData: store.cardData, emptyTitleError, titleRequired, toast: trackedToast, refreshExperiences,
    toggleCard: expansion.toggleCard, clearPreviewState, hasPendingAiPolishApply, clearPendingAiPolishApply, setExperiences,
    setCardData: store.setCardData,
    setOriginalCardData: store.setOriginalCardData,
    setModifiedCards: store.setModifiedCards,
  });
  const handleSaveCard = useCallback(async (cardId: string) => {
    const data = store.cardData.get(cardId);
    if (!data) {
      return;
    }
    if (titleRequired && (isTempId(cardId) || cardId.startsWith('draft_')) && (!data.title || !data.title.trim())) {
      await saveExperienceCard(cardId);
      return;
    }
    if (isTempId(cardId) || cardId.startsWith('draft_')) {
      const flushedDraft = await flushDraftSave(cardId);
      await saveExperienceCard(cardId, {
        ...data,
        draftId: flushedDraft?.draftId ?? data.draftId,
        clientDraftKey: flushedDraft?.clientDraftKey ?? data.clientDraftKey,
      });
      return;
    }
    await saveExperienceCard(cardId);
  }, [flushDraftSave, saveExperienceCard, store.cardData, titleRequired]);
  const sortedExperiences = useSortedExperiences(experiences);

  useEffect(() => {
    if (!focusRequest || !focusRequest.targetId || focusRequest.category !== category) {
      return;
    }
    if (isLoading || lastFocusRequestIdRef.current === focusRequest.requestId) {
      return;
    }
    const targetExists = experiences.some((item) => item.master.id === focusRequest.targetId);
    if (!targetExists) {
      return;
    }
    lastFocusRequestIdRef.current = focusRequest.requestId;
    ensureCardState(focusRequest.targetId);
    expansion.setExpandedCards((prev) => {
      const next = new Set(prev);
      next.add(focusRequest.targetId as string);
      return next;
    });
    scrollToCard(focusRequest.targetId, 100);
    highlightCard(focusRequest.targetId, 350);
  }, [
    category,
    ensureCardState,
    expansion,
    experiences,
    focusRequest,
    highlightCard,
    isLoading,
    scrollToCard,
  ]);

  useEffect(() => {
    if (!isAuthenticated || !authUserKey) {
      return;
    }
    let cancelled = false;
    let operation: Awaited<ReturnType<typeof ownerGuard.beginOperation>> | null = null;
    void ownerGuard.beginOperation()
      .then((capturedOperation) => {
        operation = capturedOperation;
        return experienceDraftService.list(category, {
          expectedAuthCacheKey: capturedOperation.expectedAuthCacheKey,
        });
      })
      .then(async (drafts) => {
        if (!operation) {
          return;
        }
        await ownerGuard.assertOperationCurrent(operation);
        return drafts;
      })
      .then((drafts) => {
        if (!drafts || cancelled || drafts.length === 0) {
          return;
        }
        const draftItems: ExperienceListItem[] = drafts.map((draft) => ({
          master: {
            id: `draft_${draft.client_draft_key}`,
            category,
            is_archived: false,
          },
          latest_version: {
            id: `draft_${draft.client_draft_key}`,
            title: draft.card_data?.title || '',
            org: draft.card_data?.org || defaultOrg,
            start_date: draft.card_data?.start_date || '',
            end_date: draft.card_data?.end_date || '',
            star: draft.card_data?.star || { s: '', t: '', a: '', r: '' },
          },
        }));
        setExperiences((prev) => {
          const existingIds = new Set(prev.map((item) => item.master.id));
          const missingDrafts = draftItems.filter((item) => !existingIds.has(item.master.id));
          return missingDrafts.length ? [...missingDrafts, ...prev] : prev;
        });
        store.setCardData((prev) => {
          const next = new Map(prev);
          drafts.forEach((draft) => next.set(`draft_${draft.client_draft_key}`, buildDraftCardData(draft)));
          return next;
        });
        store.setOriginalCardData((prev) => {
          const next = new Map(prev);
          drafts.forEach((draft) => {
            const data = buildDraftCardData(draft);
            next.set(`draft_${draft.client_draft_key}`, cloneExperienceCardData(data));
          });
          return next;
        });
        store.setModifiedCards((prev) => {
          const next = new Set(prev);
          drafts.forEach((draft) => next.add(`draft_${draft.client_draft_key}`));
          return next;
        });
        expansion.setExpandedCards((prev) => {
          const next = new Set(prev);
          drafts.forEach((draft) => next.add(`draft_${draft.client_draft_key}`));
          return next;
        });
      })
      .catch((error) => {
        if (!isAuthContextChangedError(error)) {
          console.error(`[ExperienceSection] 加载${category}草稿失败:`, error);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    category,
    authUserKey,
    defaultOrg,
    expansion.setExpandedCards,
    isAuthenticated,
    ownerGuard,
    setExperiences,
    store.setCardData,
    store.setModifiedCards,
    store.setOriginalCardData,
  ]);

  useEffect(() => () => {
    draftSaveTimersRef.current.forEach((timer) => clearTimeout(timer));
    draftSaveTimersRef.current.clear();
    draftSaveRequestsRef.current.clear();
    draftSaveQueueRef.current.clear();
    latestSavedDraftsRef.current.clear();
    invalidatedDraftSaveCardsRef.current.clear();
  }, []);

  const setDraftStatus = useCallback((cardId: string, status: ExperienceCardData['draftStatus']) => {
    store.setCardData((prev) => {
      const current = prev.get(cardId);
      if (!current || current.draftStatus === status) {
        return prev;
      }
      const next = new Map(prev);
      next.set(cardId, { ...current, draftStatus: status });
      return next;
    });
  }, [store.setCardData]);

  const scheduleDraftSave = useCallback((cardId: string, data: ExperienceCardData) => {
    if (!isAuthenticated) {
      return;
    }
    if (!isTempId(cardId) && !cardId.startsWith('draft_')) {
      return;
    }
    invalidatedDraftSaveCardsRef.current.delete(cardId);
    const existing = draftSaveTimersRef.current.get(cardId);
    if (existing) {
      clearTimeout(existing);
    }
    setDraftStatus(cardId, 'saving');
    const timer = setTimeout(() => {
      const latest = data;
      const clientDraftKey = latest.clientDraftKey || cardId.replace(/^draft_/, '');
      draftSaveTimersRef.current.delete(cardId);
      const previousSave = draftSaveQueueRef.current.get(cardId) ?? Promise.resolve();
      const saveRequest = previousSave
        .catch(() => null)
        .then(async () => {
          if (invalidatedDraftSaveCardsRef.current.has(cardId)) {
            return null;
          }
          const operation = await ownerGuard.beginOperation();
          const saved = await experienceDraftService.upsert({
            category,
            clientDraftKey,
            mode: latest.editMode,
            simpleText: latest.simpleText || '',
            cardData: latest,
          }, {
            expectedAuthCacheKey: operation.expectedAuthCacheKey,
          });
          await ownerGuard.assertOperationCurrent(operation);
          return saved;
        })
        .then((saved) => {
          if (!saved) {
            return null;
          }
          store.setCardData((prev) => {
            const current = prev.get(cardId);
            if (!current) {
              return prev;
            }
            const next = new Map(prev);
            next.set(cardId, {
              ...current,
              draftId: saved.id,
              clientDraftKey: saved.client_draft_key,
              draftStatus: 'saved',
            });
            return next;
          });
          latestSavedDraftsRef.current.set(cardId, saved);
          return saved;
        })
        .catch((error) => {
          if (isAuthContextChangedError(error)) {
            return null;
          }
          console.error(`[ExperienceSection] 保存${category}草稿失败:`, error);
          setDraftStatus(cardId, 'error');
          return null;
        })
        .finally(() => {
          if (draftSaveRequestsRef.current.get(cardId) === saveRequest) {
            draftSaveRequestsRef.current.delete(cardId);
          }
          if (draftSaveQueueRef.current.get(cardId) === saveRequest) {
            draftSaveQueueRef.current.delete(cardId);
          }
        });
      draftSaveRequestsRef.current.set(cardId, saveRequest);
      draftSaveQueueRef.current.set(cardId, saveRequest);
    }, 700);
    draftSaveTimersRef.current.set(cardId, timer);
  }, [category, isAuthenticated, ownerGuard, setDraftStatus, store.setCardData]);

  const handleFieldChange = useCallback(
    (cardId: string, field: string, value: string | string[]) => {
      if (requireAuth()) {
        return;
      }
      if (field.startsWith('star.')) {
        const starField = field.split('.')[1] as StarFieldKey;
        if (STAR_FIELD_KEYS.includes(starField)) {
          clearStarSnapshot(cardId, starField);
        }
      }
      updateCardField(cardId, field, value);
      const nextData = store.cardData.get(cardId);
      if (nextData) {
        const current = { ...nextData };
        if (field.startsWith('star.')) {
          const starField = field.split('.')[1] as StarFieldKey;
          current.star = { ...current.star, [starField]: value as string };
        } else {
          (current as any)[field] = value;
        }
        scheduleDraftSave(cardId, current);
      }
    },
    [clearStarSnapshot, requireAuth, scheduleDraftSave, store.cardData, updateCardField]
  );

  const handleEditModeChange = useCallback((cardId: string, mode: 'simple' | 'expert') => {
    if (requireAuth()) {
      return;
    }
    const data = store.cardData.get(cardId);
    if (!data || data.editMode === mode) {
      return;
    }
    const nextData: ExperienceCardData = mode === 'expert'
      ? {
        ...data,
        editMode: 'expert',
        star: parseSimpleExperienceText(data.simpleText || '').star,
      }
      : {
        ...data,
        editMode: 'simple',
        simpleText: joinStarFieldsForSimpleMode(data.star || createEmptyCardData().star),
      };
    updateCardData(cardId, nextData);
    scheduleDraftSave(cardId, nextData);
  }, [requireAuth, scheduleDraftSave, store.cardData, updateCardData]);

  const handlePreviewSimpleEntry = useCallback(async (cardId: string) => {
    if (requireAuth()) {
      return;
    }
    const data = store.cardData.get(cardId);
    if (!data || savingCardId === cardId || previewingCardId === cardId || previewingCardIdRef.current) {
      return;
    }
    previewingCardIdRef.current = cardId;
    setPreviewingCardId(cardId);
    try {
      const localResult = parseSimpleExperienceText(data.simpleText || '');
      let nextStar = localResult.star;
      if (!localResult.ok) {
        const splitCacheKey = buildSplitExperienceCacheKey(cardId, category, data);
        const cachedSplit = splitExperienceCacheRef.current.get(splitCacheKey);
        if (cachedSplit) {
          nextStar = cachedSplit;
        } else {
          let splitOperation: Awaited<ReturnType<typeof ownerGuard.beginOperation>> | null = null;
          try {
            splitOperation = await ownerGuard.beginOperation();
            const aiResult = await aiService.splitExperienceText({
              rawText: data.simpleText || '',
              category,
              org: data.org,
              title: data.title,
            }, { expectedAuthCacheKey: splitOperation.expectedAuthCacheKey });
            await ownerGuard.assertOperationCurrent(splitOperation);
            if (validateSplitCoverage(data.simpleText || '', aiResult)) {
              nextStar = aiResult;
              rememberSplitExperienceResult(splitExperienceCacheRef.current, splitCacheKey, aiResult);
            } else {
              toast.error('AI 拆分可能遗漏内容，已全部放入 A 部分，请手动调整', 3000);
            }
          } catch (error) {
            if (
              isAuthContextChangedError(error)
              || (splitOperation && !ownerGuard.isOperationCurrent(splitOperation))
            ) {
              throw new AuthContextChangedError();
            }
            console.error('[ExperienceSection] AI 拆分经历失败:', error);
            toast.error('AI 拆分失败，已全部放入 A 部分，请手动调整', 3000);
          }
        }
      }
      const nextData: ExperienceCardData = {
        ...data,
        editMode: 'expert',
        star: nextStar,
      };
      updateCardData(cardId, nextData);
      scheduleDraftSave(cardId, nextData);
    } catch (error) {
      if (!isAuthContextChangedError(error)) {
        throw error;
      }
    } finally {
      if (previewingCardIdRef.current === cardId) {
        previewingCardIdRef.current = null;
      }
      setPreviewingCardId((current) => current === cardId ? null : current);
    }
  }, [category, ownerGuard, previewingCardId, requireAuth, savingCardId, scheduleDraftSave, store.cardData, toast, updateCardData]);

  const handleCancel = useCallback(async (cardId: string) => {
    if (requireAuth()) {
      return;
    }
    clearPendingAiPolishApply(cardId);
    clearPreviewState(cardId);
    if (isTempId(cardId) || cardId.startsWith('draft_')) {
      const currentData = store.cardData.get(cardId);
      let operation: Awaited<ReturnType<typeof ownerGuard.beginOperation>> | null = null;
      try {
        operation = await ownerGuard.beginOperation();
        const discardedDraft = await discardDraftAutosave(cardId);
        await ownerGuard.assertOperationCurrent(operation);
        const draftId = discardedDraft?.id ?? currentData?.draftId;
        if (draftId) {
          await experienceDraftService.delete(draftId, {
            expectedAuthCacheKey: operation.expectedAuthCacheKey,
          });
          await ownerGuard.assertOperationCurrent(operation);
        }
        latestSavedDraftsRef.current.delete(cardId);
      } catch (error) {
        if (
          isAuthContextChangedError(error)
          || (operation && !ownerGuard.isOperationCurrent(operation))
        ) {
          return;
        }
        console.error('[ExperienceSection] 删除草稿失败:', error);
        toast.error('草稿删除失败，请重试', 3000);
        return;
      }
      setExperiences(prev => prev.filter(item => item.master.id !== cardId));
      store.setCardData(prev => {
        const next = new Map(prev);
        next.delete(cardId);
        return next;
      });
      store.setOriginalCardData(prev => {
        const next = new Map(prev);
        next.delete(cardId);
        return next;
      });
      store.setModifiedCards(prev => {
        const next = new Set(prev);
        next.delete(cardId);
        return next;
      });
      expansion.removeCardExpansion(cardId);
    } else {
      resetCard(cardId);
    }
  }, [clearPendingAiPolishApply, clearPreviewState, discardDraftAutosave, expansion, ownerGuard, requireAuth, resetCard, setExperiences, store, toast]);

  const handleAdd = useCallback(() => {
    if (requireAuth()) {
      return;
    }
    void handleAddNew();
  }, [handleAddNew, requireAuth]);

  const handleToggle = useCallback((cardId: string) => {
    if (requireAuth()) {
      return;
    }
    expansion.toggleCard(cardId);
  }, [expansion, requireAuth]);

  const handleDeleteRequest = useCallback((cardId: string) => {
    if (requireAuth()) {
      return;
    }
    deleteActions.requestDelete(cardId);
  }, [deleteActions, requireAuth]);

  const handleConfirmDelete = useCallback(() => {
    if (requireAuth()) {
      return;
    }
    void deleteActions.executeDelete();
  }, [deleteActions, requireAuth]);

  const handleRunPolishProtected = useCallback((cardId: string) => {
    if (requireAuth()) {
      return;
    }
    void handleRunPolish(cardId);
  }, [handleRunPolish, requireAuth]);

  const handleOpenAssistantProtected = useCallback((cardId: string) => {
    if (requireAuth()) {
      return;
    }
    handleOpenAssistant(cardId);
  }, [handleOpenAssistant, requireAuth]);

  const handleSaveProtected = useCallback((cardId: string) => {
    if (requireAuth()) {
      return;
    }
    void handleSaveCard(cardId);
  }, [handleSaveCard, requireAuth]);

  return buildSectionModel({
    experiences,
    sortedExperiences,
    isLoading,
    isCreating,
    cardData: store.cardData,
    expandedCards: expansion.expandedCards,
    collapsingCards: expansion.collapsingCards,
    modifiedCards: store.modifiedCards,
    isCardBusy: (cardId) => savingCardId === cardId || previewingCardId === cardId,
    deletingCardId: deleteActions.deletingCardId,
    setCardRef,
    isPolishing,
    getPolishMode,
    getCustomPrompt,
    isPreviewingPolish,
    onAdd: handleAdd,
    onToggle: handleToggle,
    onDeleteRequest: handleDeleteRequest,
    onSave: handleSaveProtected,
    onPreviewSimpleEntry: handlePreviewSimpleEntry,
    onCancel: handleCancel,
    onFieldChange: handleFieldChange,
    onEditModeChange: handleEditModeChange,
    onPolishModeChange: handlePolishModeChange,
    onCustomPromptChange: handleCustomPromptChange,
    onRunPolish: handleRunPolishProtected,
    onUndoPolishPreview: handleUndoPolishPreview,
    onConfirmPolishPreview: handleConfirmPolishPreview,
    onOpenAssistant: handleOpenAssistantProtected,
    onUndo: handleUndo,
    onDeleteConfirm: handleConfirmDelete,
    onDeleteCancel: deleteActions.cancelDelete,
  });
};
