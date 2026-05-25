import { useCallback, useState } from 'react';
import type React from 'react';
import { experienceService, type ExperienceListItem } from '../../services/experienceService';
import { trackAiPolishApplied } from '../../utils/analyticsTracker';
import type { ExperienceCardData } from '../ExperienceCard';
import { getTodayLocalISODate } from '../experienceUtils';
import {
  applyOptimisticSave,
  buildExperienceCardData,
  buildVersionPayload,
  cloneExperienceCardData,
  isTempId,
  syncCardFromRefresh,
} from './cardDataUtils';
import { POLISH_SOURCE } from './polishActions';
import type { ExperienceSectionProps, ToastApi } from './types';

type ExperienceCreateParams = {
  category: ExperienceSectionProps['category'];
  defaultOrg: string;
  defaultTitle: string;
  toast: ToastApi;
  setExperiences: React.Dispatch<React.SetStateAction<ExperienceListItem[]>>;
  setCardData: React.Dispatch<React.SetStateAction<Map<string, ExperienceCardData>>>;
  setOriginalCardData: React.Dispatch<React.SetStateAction<Map<string, ExperienceCardData>>>;
  setModifiedCards: React.Dispatch<React.SetStateAction<Set<string>>>;
  setExpandedCards: React.Dispatch<React.SetStateAction<Set<string>>>;
};

export const useExperienceCreate = ({
  category,
  defaultOrg,
  defaultTitle,
  toast,
  setExperiences,
  setCardData,
  setOriginalCardData,
  setModifiedCards,
  setExpandedCards,
}: ExperienceCreateParams) => {
  const [isCreating, setIsCreating] = useState(false);

  const handleAddNew = useCallback(async () => {
    if (isCreating) {
      return;
    }
    try {
      setIsCreating(true);

      const tempId = `temp_${Date.now()}`;
      const newExperience: ExperienceListItem = {
        master: {
          id: tempId,
          category,
          is_archived: false,
        },
        latest_version: {
          id: tempId,
          title: defaultTitle,
          org: defaultOrg,
          start_date: getTodayLocalISODate(),
          star: { s: '', t: '', a: '', r: '' },
        },
      };

      setExperiences((prev) => [newExperience, ...prev]);

      const initialData = buildExperienceCardData(newExperience);
      setCardData((prev) => new Map(prev).set(tempId, initialData));
      setOriginalCardData((prev) => new Map(prev).set(tempId, cloneExperienceCardData(initialData)));

      // Mark as modified so the Save button is enabled immediately
      setModifiedCards((prev) => new Set(prev).add(tempId));

      setExpandedCards((prev) => new Set(prev).add(tempId));

    } catch (error) {
      console.error(`[ExperienceSection] 创建${category}草稿失败:`, error);
      toast.error('创建失败', 2000);
    } finally {
      setIsCreating(false);
    }
  }, [category, defaultOrg, defaultTitle, isCreating, setCardData, setExpandedCards, setExperiences, setModifiedCards, setOriginalCardData, toast]);

  return { isCreating, handleAddNew };
};

type ExperienceSaveParams = {
  category: ExperienceSectionProps['category'];
  cardData: Map<string, ExperienceCardData>;
  emptyTitleError: string;
  toast: ToastApi;
  refreshExperiences: () => Promise<ExperienceListItem[]>;
  toggleCard: (cardId: string) => void;
  clearPreviewState: (cardId: string) => void;
  hasPendingAiPolishApply: (cardId: string) => boolean;
  clearPendingAiPolishApply: (cardId: string) => void;
  setExperiences: React.Dispatch<React.SetStateAction<ExperienceListItem[]>>;
  setCardData: React.Dispatch<React.SetStateAction<Map<string, ExperienceCardData>>>;
  setOriginalCardData: React.Dispatch<React.SetStateAction<Map<string, ExperienceCardData>>>;
  setModifiedCards: React.Dispatch<React.SetStateAction<Set<string>>>;
};

export const useExperienceSave = ({
  category,
  cardData,
  emptyTitleError,
  toast,
  refreshExperiences,
  toggleCard,
  clearPreviewState,
  hasPendingAiPolishApply,
  clearPendingAiPolishApply,
  setExperiences,
  setCardData,
  setOriginalCardData,
  setModifiedCards,
}: ExperienceSaveParams) => {
  const [savingCardId, setSavingCardId] = useState<string | null>(null);

  const handleSaveCard = useCallback(
    async (cardId: string) => {
      let toastId: string | null = null;
      try {
        const data = cardData.get(cardId);
        if (!data) {
          return;
        }
        const shouldTrackAiPolishApplied = hasPendingAiPolishApply(cardId);
        if (!data.title || !data.title.trim()) {
          toast.error(emptyTitleError);
          return;
        }

        setSavingCardId(cardId);

        if (isTempId(cardId)) {
          // Handle Creation
          toastId = toast.loading('正在创建...');
          const createdExperience = await experienceService.create({
            category,
            version: buildVersionPayload(data),
          });

          const realId = createdExperience.master.id;

          // Update List: Replace temp with real
          setExperiences((prev) => prev.map((item) => item.master.id === cardId ? createdExperience : item));

          // Update Card Data: Move from temp key to real key
          const newData = buildExperienceCardData(createdExperience);
          setCardData((prev) => {
            const next = new Map(prev);
            next.delete(cardId);
            next.set(realId, newData);
            return next;
          });
          setOriginalCardData((prev) => {
            const next = new Map(prev);
            next.delete(cardId);
            next.set(realId, cloneExperienceCardData(newData));
            return next;
          });
          setModifiedCards((prev) => {
            const next = new Set(prev);
            next.delete(cardId);
            next.delete(realId);
            return next;
          });
          clearPreviewState(cardId);
          if (shouldTrackAiPolishApplied) {
            trackAiPolishApplied({ source: POLISH_SOURCE, field: 'all', category });
            clearPendingAiPolishApply(cardId);
          }

          // Close the card (standard behavior is toggle)
          // If we call toggleCard(cardId), it will try to collapse 'temp_...' which is fine if it's in expanded set.
          // But since we are changing IDs, we should probably manually fix the expansion state if we want smooth animation.
          // However, simply removing from expanded set is enough.
          // We will let toggleCard handle the UI cleanup for the temp ID.
          toggleCard(cardId);

          if (toastId) {
            toast.updateToast(toastId, { message: '已创建', type: 'success', duration: 2000 });
          } else {
            toast.success('已创建', 2000);
          }

          // We don't strictly need to refresh full list since we just got the fresh item, 
          // but keeping it for consistency with other parts of the app is okay.
        } else {
          // Handle Update
          applyOptimisticSave(cardId, data, setOriginalCardData, setModifiedCards, setExperiences);

          toastId = toast.loading('正在同步...');
          await experienceService.update(cardId, { version: buildVersionPayload(data) });
          clearPreviewState(cardId);
          if (shouldTrackAiPolishApplied) {
            trackAiPolishApplied({ source: POLISH_SOURCE, field: 'all', category });
            clearPendingAiPolishApply(cardId);
          }

          if (toastId) {
            toast.updateToast(toastId, { message: '已保存', type: 'success', duration: 2000 });
          } else {
            toast.success('已保存', 2000);
          }

          toggleCard(cardId);

          refreshExperiences()
            .then((updatedList) => {
              syncCardFromRefresh(cardId, updatedList, setModifiedCards, setCardData, setOriginalCardData);
            })
            .catch((error) => {
              console.error(`[ExperienceSection] 刷新${category}经历失败:`, error);
            });
        }
      } catch (error) {
        console.error(`[ExperienceSection] 保存${category}经历失败:`, error);
        if (toastId) {
          toast.updateToast(toastId, { message: '保存失败，请重试', type: 'error', duration: 3000 });
        } else {
          toast.error('保存失败，请重试', 3000);
        }
      } finally {
        setSavingCardId(null);
      }
    },
    [cardData, category, clearPendingAiPolishApply, clearPreviewState, emptyTitleError, hasPendingAiPolishApply, refreshExperiences, setCardData, setExperiences, setModifiedCards, setOriginalCardData, toast, toggleCard]
  );

  return { savingCardId, handleSaveCard };
};

type ExperienceDeleteParams = {
  category: ExperienceSectionProps['category'];
  toast: ToastApi;
  refreshExperiences: () => Promise<ExperienceListItem[]>;
  /** 删除请求时（确认 dialog 出现前）高亮提示卡片位置，替代 scrollToCard */
  highlightCard: (cardId: string, delay: number) => void;
  setExperiences: React.Dispatch<React.SetStateAction<ExperienceListItem[]>>;
  removeCardState: (cardId: string) => void;
  removeCardExpansion: (cardId: string) => void;
};

export const useExperienceDelete = ({
  category,
  toast,
  refreshExperiences,
  highlightCard,
  setExperiences,
  removeCardState,
  removeCardExpansion,
}: ExperienceDeleteParams) => {
  const [deletingCardId, setDeletingCardId] = useState<string | null>(null);

  const requestDelete = useCallback(
    (cardId: string) => {
      setDeletingCardId(cardId);
      highlightCard(cardId, 0);
    },
    [highlightCard]
  );

  const executeDelete = useCallback(async () => {
    if (!deletingCardId) {
      return;
    }
    let toastId: string | null = null;
    const cardId = deletingCardId;
    try {
      setDeletingCardId(null);
      setExperiences((prev) => prev.filter((item) => item.master.id !== cardId));
      removeCardExpansion(cardId);
      removeCardState(cardId);

      if (isTempId(cardId)) {
        toast.success('已删除', 2000);
        return;
      }

      toastId = toast.loading('正在删除...');
      await experienceService.delete(cardId);
      if (toastId) {
        toast.updateToast(toastId, { message: '已删除', type: 'success', duration: 2000 });
      } else {
        toast.success('已删除', 2000);
      }
    } catch (error) {
      console.error(`[ExperienceSection] 删除${category}经历失败:`, error);
      if (toastId) {
        toast.updateToast(toastId, { message: '删除同步失败，正在恢复列表...', type: 'error', duration: 3000 });
      } else {
        toast.error('删除同步失败，正在恢复列表...', 3000);
      }
      refreshExperiences().catch((refreshError) => {
        console.error(`[ExperienceSection] 恢复${category}经历失败:`, refreshError);
      });
    }
  }, [category, deletingCardId, refreshExperiences, removeCardExpansion, removeCardState, setExperiences, toast]);

  const cancelDelete = useCallback(() => setDeletingCardId(null), []);

  return { deletingCardId, requestDelete, executeDelete, cancelDelete };
};
