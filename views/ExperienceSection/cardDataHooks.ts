import { useCallback, useRef, useState } from 'react';
import type React from 'react';
import type { ExperienceListItem } from '../../services/experienceService';
import type { ExperienceCardData, StarFieldKey } from '../ExperienceCard';
import {
  cloneExperienceCardData,
  createEmptyCardData,
  resolveExperienceCardData,
} from './cardDataUtils';

const CARD_HIGHLIGHT_CLASS = 'card-highlight';
const CARD_HIGHLIGHT_DURATION_MS = 900;

export const useCardRefs = () => {
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const setCardRef = useCallback((cardId: string, element: HTMLDivElement | null) => {
    if (element) {
      cardRefs.current.set(cardId, element);
    } else {
      cardRefs.current.delete(cardId);
    }
  }, []);

  /** 展开时滚动到卡片（无闪动） */
  const scrollToCard = useCallback((cardId: string, delay: number) => {
    setTimeout(() => {
      cardRefs.current.get(cardId)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, delay);
  }, []);

  /**
   * 折叠后：先滚动到卡片位置，再触发高亮脉冲动画，帮助用户确认位置。
   */
  const highlightCard = useCallback((cardId: string, delay: number) => {
    setTimeout(() => {
      const element = cardRefs.current.get(cardId);
      if (!element) return;
      element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      // 移除旧动画（如有），强制重排以重新触发
      element.classList.remove(CARD_HIGHLIGHT_CLASS);
      void element.offsetWidth;
      element.classList.add(CARD_HIGHLIGHT_CLASS);
      setTimeout(() => {
        element.classList.remove(CARD_HIGHLIGHT_CLASS);
      }, CARD_HIGHLIGHT_DURATION_MS);
    }, delay);
  }, []);

  return { setCardRef, scrollToCard, highlightCard };
};

export const useCardDataStore = () => {
  const [cardData, setCardData] = useState<Map<string, ExperienceCardData>>(new Map());
  const [originalCardData, setOriginalCardData] = useState<Map<string, ExperienceCardData>>(new Map());
  const [modifiedCards, setModifiedCards] = useState<Set<string>>(new Set());

  return {
    cardData,
    setCardData,
    originalCardData,
    setOriginalCardData,
    modifiedCards,
    setModifiedCards,
  };
};

export const useCardInitializer = (
  experiences: ExperienceListItem[],
  setCardData: React.Dispatch<React.SetStateAction<Map<string, ExperienceCardData>>>,
  setOriginalCardData: React.Dispatch<React.SetStateAction<Map<string, ExperienceCardData>>>
) => {
  const ensureCardState = useCallback(
    (cardId: string, seedData?: ExperienceCardData) => {
      const resolved = resolveExperienceCardData(cardId, experiences, seedData);
      if (!resolved) {
        return;
      }
      setCardData((prev) => {
        if (prev.has(cardId)) {
          return prev;
        }
        const next = new Map(prev);
        next.set(cardId, resolved);
        return next;
      });
      setOriginalCardData((prev) => {
        if (prev.has(cardId)) {
          return prev;
        }
        const next = new Map(prev);
        next.set(cardId, cloneExperienceCardData(resolved));
        return next;
      });
    },
    [experiences, setCardData, setOriginalCardData]
  );

  return { ensureCardState };
};

export const useCardEditors = (
  originalCardData: Map<string, ExperienceCardData>,
  setCardData: React.Dispatch<React.SetStateAction<Map<string, ExperienceCardData>>>,
  setModifiedCards: React.Dispatch<React.SetStateAction<Set<string>>>
) => {
  const updateModifiedState = useCallback(
    (cardId: string, current: ExperienceCardData) => {
      const original = originalCardData.get(cardId);
      const isModified = original ? JSON.stringify(current) !== JSON.stringify(original) : true;
      setModifiedCards((prev) => {
        const next = new Set(prev);
        if (isModified) {
          next.add(cardId);
        } else {
          next.delete(cardId);
        }
        return next;
      });
    },
    [originalCardData, setModifiedCards]
  );

  const updateCardField = useCallback(
    (cardId: string, field: string, value: string | string[]) => {
      setCardData((prev) => {
        const next = new Map(prev);
        const current = { ...(next.get(cardId) || createEmptyCardData()) };
        if (field.startsWith('star.')) {
          const starField = field.split('.')[1] as StarFieldKey;
          const prevStar = current.star || { s: '', t: '', a: '', r: '' };
          current.star = { ...prevStar, [starField]: value as string };
        } else {
          (current as any)[field] = value;
        }
        next.set(cardId, current);
        updateModifiedState(cardId, current);
        return next;
      });
    },
    [setCardData, updateModifiedState]
  );

  const updateCardStar = useCallback(
    (cardId: string, star: Record<StarFieldKey, string>) => {
      setCardData((prev) => {
        const next = new Map(prev);
        const current = { ...(next.get(cardId) || createEmptyCardData()) };
        current.star = { ...(current.star || { s: '', t: '', a: '', r: '' }), ...star };
        next.set(cardId, current);
        updateModifiedState(cardId, current);
        return next;
      });
    },
    [setCardData, updateModifiedState]
  );

  const updateCardData = useCallback(
    (cardId: string, data: ExperienceCardData) => {
      setCardData((prev) => {
        const next = new Map(prev);
        const nextData = cloneExperienceCardData(data);
        next.set(cardId, nextData);
        updateModifiedState(cardId, nextData);
        return next;
      });
    },
    [setCardData, updateModifiedState]
  );

  const resetCard = useCallback(
    (cardId: string) => {
      const original = originalCardData.get(cardId);
      if (original) {
        setCardData((prev) => new Map(prev).set(cardId, cloneExperienceCardData(original)));
      }
      setModifiedCards((prev) => {
        const next = new Set(prev);
        next.delete(cardId);
        return next;
      });
    },
    [originalCardData, setCardData, setModifiedCards]
  );

  return { updateCardField, updateCardStar, updateCardData, resetCard };
};

export const useCardRemoval = (
  setCardData: React.Dispatch<React.SetStateAction<Map<string, ExperienceCardData>>>,
  setModifiedCards: React.Dispatch<React.SetStateAction<Set<string>>>,
  setOriginalCardData: React.Dispatch<React.SetStateAction<Map<string, ExperienceCardData>>>
) => {
  const removeCardState = useCallback(
    (cardId: string) => {
      setCardData((prev) => {
        const next = new Map(prev);
        next.delete(cardId);
        return next;
      });
      setOriginalCardData((prev) => {
        const next = new Map(prev);
        next.delete(cardId);
        return next;
      });
      setModifiedCards((prev) => {
        const next = new Set(prev);
        next.delete(cardId);
        return next;
      });
    },
    [setCardData, setModifiedCards, setOriginalCardData]
  );

  return { removeCardState };
};

export const useCardExpansionState = (
  ensureCardState: (cardId: string, seedData?: ExperienceCardData) => void,
  scrollToCard: (cardId: string, delay: number) => void,
  highlightCard: (cardId: string, delay: number) => void
) => {
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  const [collapsingCards, setCollapsingCards] = useState<Set<string>>(new Set());

  const toggleCard = useCallback(
    (cardId: string) => {
      setExpandedCards((prev) => {
        const next = new Set(prev);
        if (next.has(cardId)) {
          // 收起：fold 动画结束后滚动+高亮闪动
          setCollapsingCards((collapsing) => new Set(collapsing).add(cardId));
          next.delete(cardId);
          setTimeout(() => {
            setCollapsingCards((current) => {
              const updated = new Set(current);
              updated.delete(cardId);
              return updated;
            });
            highlightCard(cardId, 50);
          }, 300);
        } else {
          // 展开：只滚动，不高亮
          next.add(cardId);
          ensureCardState(cardId);
          scrollToCard(cardId, 100);
        }
        return next;
      });
    },
    [ensureCardState, highlightCard, scrollToCard]
  );

  const removeCardExpansion = useCallback((cardId: string) => {
    setExpandedCards((prev) => {
      const next = new Set(prev);
      next.delete(cardId);
      return next;
    });
    setCollapsingCards((prev) => {
      const next = new Set(prev);
      next.delete(cardId);
      return next;
    });
  }, []);

  return { expandedCards, collapsingCards, setExpandedCards, toggleCard, removeCardExpansion };
};
