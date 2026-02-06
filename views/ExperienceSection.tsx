import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import ConfirmDialog from '../components/ConfirmDialog';
import { aiService } from '../services/aiService';
import { experienceService, ExperienceCategory, ExperienceListItem } from '../services/experienceService';
import ExperienceCard, { ExperienceCardData, ExperienceCardLabels, StarFieldKey, STAR_FIELD_LABELS } from './ExperienceCard';
import { convertDateToISO, getTodayLocalISODate, parseYearMonthValue, runDedupedRefresh } from './experienceUtils';
import { mergeTags, sanitizeTagList } from './tagUtils';
import { normalizeAiRichText, stripRichTextToText } from '../utils/richText';

type ToastApi = {
  success: (message: string, duration?: number) => string;
  error: (message: string, duration?: number) => string;
  loading: (message: string) => string;
  updateToast: (id: string, updates: { message?: string; type?: 'success' | 'error' | 'loading'; duration?: number }) => void;
};

type ExperienceSectionProps = {
  category: Extract<ExperienceCategory, 'work' | 'project'>;
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  labels: ExperienceCardLabels;
  addButtonLabel: string;
  emptyTitleError: string;
  deleteConfirmText: string;
  defaultOrg: string;
  defaultTitle: string;
  refreshSignal?: number;
  showTags?: boolean;
  toast: ToastApi;
  themeColor?: string;
};

type ExperienceSectionModel = {
  experiences: ExperienceListItem[];
  sortedExperiences: ExperienceListItem[];
  isLoading: boolean;
  isCreating: boolean;
  cardData: Map<string, ExperienceCardData>;
  expandedCards: Set<string>;
  collapsingCards: Set<string>;
  modifiedCards: Set<string>;
  savingCardId: string | null;
  generatingTagIds: Set<string>;
  deletingCardId: string | null;
  setCardRef: (cardId: string, element: HTMLDivElement | null) => void;
  isFieldPolishing: (cardId: string, field: StarFieldKey) => boolean;
  onAdd: () => void;
  onToggle: (cardId: string) => void;
  onDeleteRequest: (cardId: string) => void;
  onSave: (cardId: string) => void;
  onCancel: (cardId: string) => void;
  onFieldChange: (cardId: string, field: string, value: string | string[]) => void;
  onPolish: (cardId: string, field: StarFieldKey) => void;
  onGenerateTags: (cardId: string) => void;
  onDeleteConfirm: () => void;
  onDeleteCancel: () => void;
};

const isTempId = (id: string) => id.startsWith('temp_');

const sortExperiencesByStartDate = (experiences: ExperienceListItem[]) => {
  return [...experiences].sort((a, b) => {
    const dateA = a.latest_version?.start_date;
    const dateB = b.latest_version?.start_date;
    const valA = parseYearMonthValue(dateA) ?? -1;
    const valB = parseYearMonthValue(dateB) ?? -1;
    return valB - valA;
  });
};

const buildExperienceCardData = (item: ExperienceListItem): ExperienceCardData => {
  const star = item.latest_version?.star || {};
  return {
    org: item.latest_version?.org || '',
    title: item.latest_version?.title || '',
    start_date: item.latest_version?.start_date || '',
    end_date: item.latest_version?.end_date || '',
    tags: Array.isArray(item.latest_version?.tags) ? item.latest_version?.tags || [] : [],
    star: {
      s: star.s || '',
      t: star.t || '',
      a: star.a || '',
      r: star.r || '',
    },
  };
};

const createEmptyCardData = (): ExperienceCardData => ({
  org: '',
  title: '',
  start_date: '',
  end_date: '',
  tags: [],
  star: { s: '', t: '', a: '', r: '' },
});

const cloneExperienceCardData = (data: ExperienceCardData) => JSON.parse(JSON.stringify(data));

const resolveExperienceCardData = (
  cardId: string,
  experiences: ExperienceListItem[],
  seedData?: ExperienceCardData
): ExperienceCardData | null => {
  if (seedData) {
    return seedData;
  }
  const item = experiences.find((exp) => exp.master.id === cardId);
  return item ? buildExperienceCardData(item) : null;
};

const getStarFieldValue = (data: ExperienceCardData, field: StarFieldKey): string => {
  const value = data?.star?.[field];
  if (value === null || value === undefined) {
    return '';
  }
  return String(value);
};

const buildStarPolishPayload = (data: ExperienceCardData, field: StarFieldKey, fieldValue?: string) => {
  const starPayload: Record<StarFieldKey, string> = {
    s: stripRichTextToText(getStarFieldValue(data, 's')),
    t: stripRichTextToText(getStarFieldValue(data, 't')),
    a: stripRichTextToText(getStarFieldValue(data, 'a')),
    r: stripRichTextToText(getStarFieldValue(data, 'r')),
  };
  starPayload[field] = fieldValue ?? starPayload[field];
  return {
    content: {
      company: data?.org || '',
      role: data?.title || '',
      ...starPayload,
    },
    targetField: field,
  };
};

const buildTagGenerationText = (data: ExperienceCardData): string => {
  const parts = [
    data?.title ? `职位: ${data.title}` : '',
    data?.org ? `公司: ${data.org}` : '',
    data?.star?.s ? `S: ${stripRichTextToText(data.star.s)}` : '',
    data?.star?.t ? `T: ${stripRichTextToText(data.star.t)}` : '',
    data?.star?.a ? `A: ${stripRichTextToText(data.star.a)}` : '',
    data?.star?.r ? `R: ${stripRichTextToText(data.star.r)}` : '',
  ];
  return parts.filter(Boolean).join('\n');
};

const buildVersionPayload = (data: ExperienceCardData) => ({
  title: data.title,
  org: data.org || undefined,
  start_date: convertDateToISO(data.start_date),
  end_date: convertDateToISO(data.end_date),
  tags: data.tags || [],
  star: data.star || {},
});

const buildPolishKey = (cardId: string, field: StarFieldKey) => `${cardId}:${field}`;

const applyOptimisticSave = (
  cardId: string,
  data: ExperienceCardData,
  setOriginalCardData: React.Dispatch<React.SetStateAction<Map<string, ExperienceCardData>>>,
  setModifiedCards: React.Dispatch<React.SetStateAction<Set<string>>>,
  setExperiences: React.Dispatch<React.SetStateAction<ExperienceListItem[]>>
) => {
  setOriginalCardData((prev) => new Map(prev).set(cardId, cloneExperienceCardData(data)));
  setModifiedCards((prev) => {
    const next = new Set(prev);
    next.delete(cardId);
    return next;
  });
  setExperiences((prev) =>
    prev.map((item) => {
      if (item.master.id !== cardId) {
        return item;
      }
      return {
        ...item,
        latest_version: {
          ...(item.latest_version || {}),
          title: data.title,
          org: data.org,
          start_date: convertDateToISO(data.start_date),
          end_date: convertDateToISO(data.end_date),
          tags: data.tags || [],
          star: data.star,
        } as any,
      };
    })
  );
};

const syncCardFromRefresh = (
  cardId: string,
  list: ExperienceListItem[],
  setModifiedCards: React.Dispatch<React.SetStateAction<Set<string>>>,
  setCardData: React.Dispatch<React.SetStateAction<Map<string, ExperienceCardData>>>,
  setOriginalCardData: React.Dispatch<React.SetStateAction<Map<string, ExperienceCardData>>>
) => {
  const updatedItem = list.find((item) => item.master.id === cardId);
  if (!updatedItem) {
    return;
  }
  const freshData = buildExperienceCardData(updatedItem);
  setModifiedCards((currentModified) => {
    if (!currentModified.has(cardId)) {
      setCardData((prev) => new Map(prev).set(cardId, freshData));
      setOriginalCardData((prev) => new Map(prev).set(cardId, cloneExperienceCardData(freshData)));
    }
    return currentModified;
  });
};

const useExperienceList = (category: ExperienceSectionProps['category'], refreshSignal?: number) => {
  const initialExperiencesRef = useRef<ExperienceListItem[] | null>(
    experienceService.peekList(category)
  );
  const [experiences, setExperiences] = useState<ExperienceListItem[]>(
    () => initialExperiencesRef.current ?? []
  );
  const [isLoading, setIsLoading] = useState(() => !initialExperiencesRef.current);
  const refreshInFlightRef = useRef<Promise<ExperienceListItem[]> | null>(null);
  const hasLoadedRef = useRef(false);

  const refreshExperiences = useCallback(async () => {
    return runDedupedRefresh(refreshInFlightRef, async () => {
      const data = await experienceService.list(category, { force: true });
      setExperiences(data);
      return data;
    });
  }, [category]);

  useEffect(() => {
    const loadExperiences = async () => {
      if (hasLoadedRef.current) {
        return;
      }
      try {
        if (!initialExperiencesRef.current?.length) {
          setIsLoading(true);
        }
        hasLoadedRef.current = true;
        const data = await experienceService.list(category);
        setExperiences(data);
      } catch (error) {
        console.error(`[ExperienceSection] 加载${category}经历失败:`, error);
        hasLoadedRef.current = false;
      } finally {
        setIsLoading(false);
      }
    };
    loadExperiences();
  }, [category]);

  useEffect(() => {
    if (!refreshSignal) {
      return;
    }
    refreshExperiences().catch((error) => {
      console.error(`[ExperienceSection] 刷新${category}经历失败:`, error);
    });
  }, [category, refreshExperiences, refreshSignal]);

  return { experiences, setExperiences, isLoading, refreshExperiences };
};

const useCardRefs = () => {
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const setCardRef = useCallback((cardId: string, element: HTMLDivElement | null) => {
    if (element) {
      cardRefs.current.set(cardId, element);
    } else {
      cardRefs.current.delete(cardId);
    }
  }, []);

  const scrollToCard = useCallback((cardId: string, delay: number) => {
    setTimeout(() => {
      const element = cardRefs.current.get(cardId);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, delay);
  }, []);

  return { setCardRef, scrollToCard };
};

const useCardDataStore = () => {
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

const useCardInitializer = (
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

const useCardEditors = (
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
        } else if (field === 'tags') {
          current.tags = value as string[];
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

  return { updateCardField, resetCard };
};

const useCardRemoval = (
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

const useCardExpansionState = (
  ensureCardState: (cardId: string, seedData?: ExperienceCardData) => void,
  scrollToCard: (cardId: string, delay: number) => void
) => {
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  const [collapsingCards, setCollapsingCards] = useState<Set<string>>(new Set());

  const toggleCard = useCallback(
    (cardId: string) => {
      setExpandedCards((prev) => {
        const next = new Set(prev);
        if (next.has(cardId)) {
          setCollapsingCards((collapsing) => new Set(collapsing).add(cardId));
          next.delete(cardId);
          setTimeout(() => {
            setCollapsingCards((current) => {
              const updated = new Set(current);
              updated.delete(cardId);
              return updated;
            });
            scrollToCard(cardId, 50);
          }, 300);
        } else {
          next.add(cardId);
          ensureCardState(cardId);
          scrollToCard(cardId, 100);
        }
        return next;
      });
    },
    [ensureCardState, scrollToCard]
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
  scrollToCard: (cardId: string, delay: number) => void;
};

const useExperienceCreate = ({
  category,
  defaultOrg,
  defaultTitle,
  toast,
  setExperiences,
  setCardData,
  setOriginalCardData,
  setModifiedCards,
  setExpandedCards,
  scrollToCard,
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
          tags: [],
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
      scrollToCard(tempId, 100);

    } catch (error) {
      console.error(`[ExperienceSection] 创建${category}草稿失败:`, error);
      toast.error('创建失败', 2000);
    } finally {
      setIsCreating(false);
    }
  }, [category, defaultOrg, defaultTitle, isCreating, scrollToCard, setCardData, setExpandedCards, setExperiences, setModifiedCards, setOriginalCardData, toast]);

  return { isCreating, handleAddNew };
};

type ExperienceSaveParams = {
  category: ExperienceSectionProps['category'];
  cardData: Map<string, ExperienceCardData>;
  emptyTitleError: string;
  toast: ToastApi;
  refreshExperiences: () => Promise<ExperienceListItem[]>;
  toggleCard: (cardId: string) => void;
  setExperiences: React.Dispatch<React.SetStateAction<ExperienceListItem[]>>;
  setCardData: React.Dispatch<React.SetStateAction<Map<string, ExperienceCardData>>>;
  setOriginalCardData: React.Dispatch<React.SetStateAction<Map<string, ExperienceCardData>>>;
  setModifiedCards: React.Dispatch<React.SetStateAction<Set<string>>>;
};

const useExperienceSave = ({
  category,
  cardData,
  emptyTitleError,
  toast,
  refreshExperiences,
  toggleCard,
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
    [cardData, category, emptyTitleError, refreshExperiences, setCardData, setExperiences, setModifiedCards, setOriginalCardData, toast, toggleCard]
  );

  return { savingCardId, handleSaveCard };
};

type ExperienceDeleteParams = {
  category: ExperienceSectionProps['category'];
  toast: ToastApi;
  refreshExperiences: () => Promise<ExperienceListItem[]>;
  scrollToCard: (cardId: string, delay: number) => void;
  setExperiences: React.Dispatch<React.SetStateAction<ExperienceListItem[]>>;
  removeCardState: (cardId: string) => void;
  removeCardExpansion: (cardId: string) => void;
};

const useExperienceDelete = ({
  category,
  toast,
  refreshExperiences,
  scrollToCard,
  setExperiences,
  removeCardState,
  removeCardExpansion,
}: ExperienceDeleteParams) => {
  const [deletingCardId, setDeletingCardId] = useState<string | null>(null);

  const requestDelete = useCallback(
    (cardId: string) => {
      setDeletingCardId(cardId);
      scrollToCard(cardId, 0);
    },
    [scrollToCard]
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

type ExperienceAiParams = {
  cardData: Map<string, ExperienceCardData>;
  toast: ToastApi;
  updateCardField: (cardId: string, field: string, value: string | string[]) => void;
};

const usePolishActions = ({ cardData, toast, updateCardField }: ExperienceAiParams) => {
  const [polishingTargets, setPolishingTargets] = useState<Set<string>>(new Set());

  const updatePolishingTarget = useCallback((cardId: string, field: StarFieldKey, polishing: boolean) => {
    setPolishingTargets((prev) => {
      const next = new Set(prev);
      const key = buildPolishKey(cardId, field);
      if (polishing) {
        next.add(key);
      } else {
        next.delete(key);
      }
      return next;
    });
  }, []);

  const handlePolishField = useCallback(
    async (cardId: string, field: StarFieldKey) => {
      const data = cardData.get(cardId);
      if (!data) {
        return;
      }
      const currentValue = getStarFieldValue(data, field).trim();
      if (!currentValue) {
        toast.error(`请先填写${STAR_FIELD_LABELS[field]}内容再润色`);
        return;
      }

      updatePolishingTarget(cardId, field, true);
      try {
        const response = await aiService.polishExperience(
          buildStarPolishPayload(data, field, currentValue)
        );
        const polished = response?.[field];
        if (typeof polished === 'string') {
          const normalized = normalizeAiRichText(polished);
          if (normalized.trim()) {
            updateCardField(cardId, `star.${field}`, normalized);
          } else {
            toast.error('未获取到有效润色结果，请稍后重试');
          }
        } else {
          toast.error('未获取到有效润色结果，请稍后重试');
        }
      } catch (error) {
        console.error('[ExperienceSection] AI 润色失败:', error);
        toast.error('AI 润色失败，请稍后重试');
      } finally {
        updatePolishingTarget(cardId, field, false);
      }
    },
    [cardData, toast, updateCardField, updatePolishingTarget]
  );

  const isFieldPolishing = useCallback(
    (cardId: string, field: StarFieldKey) => polishingTargets.has(buildPolishKey(cardId, field)),
    [polishingTargets]
  );

  return { handlePolishField, isFieldPolishing };
};

const useTagActions = ({ cardData, toast, updateCardField }: ExperienceAiParams) => {
  const [generatingTagIds, setGeneratingTagIds] = useState<Set<string>>(new Set());

  const handleGenerateTags = useCallback(
    async (cardId: string) => {
      const data = cardData.get(cardId);
      if (!data) {
        return;
      }
      const sourceText = buildTagGenerationText(data);
      if (!sourceText.trim()) {
        toast.error('请先填写职位/公司或 STAR 内容，再生成标签');
        return;
      }

      setGeneratingTagIds((prev) => new Set(prev).add(cardId));
      try {
        const response = await aiService.generateTags(sourceText);
        const generated = sanitizeTagList(response?.tags);
        if (!generated.length) {
          toast.error('未生成有效标签，请稍后重试');
          return;
        }
        const merged = mergeTags(data.tags || [], generated);
        updateCardField(cardId, 'tags', merged);
      } catch (error) {
        console.error('[ExperienceSection] 生成标签失败:', error);
        toast.error('生成标签失败，请稍后重试');
      } finally {
        setGeneratingTagIds((prev) => {
          const next = new Set(prev);
          next.delete(cardId);
          return next;
        });
      }
    },
    [cardData, toast, updateCardField]
  );

  return { generatingTagIds, handleGenerateTags };
};

const useSortedExperiences = (experiences: ExperienceListItem[]) => {
  return useMemo(() => sortExperiencesByStartDate(experiences), [experiences]);
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
  savingCardId: string | null;
  generatingTagIds: Set<string>;
  deletingCardId: string | null;
  setCardRef: (cardId: string, element: HTMLDivElement | null) => void;
  isFieldPolishing: (cardId: string, field: StarFieldKey) => boolean;
  onAdd: () => void;
  onToggle: (cardId: string) => void;
  onDeleteRequest: (cardId: string) => void;
  onSave: (cardId: string) => void;
  onCancel: (cardId: string) => void;
  onFieldChange: (cardId: string, field: string, value: string | string[]) => void;
  onPolish: (cardId: string, field: StarFieldKey) => void;
  onGenerateTags: (cardId: string) => void;
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
  savingCardId: input.savingCardId,
  generatingTagIds: input.generatingTagIds,
  deletingCardId: input.deletingCardId,
  setCardRef: input.setCardRef,
  isFieldPolishing: input.isFieldPolishing,
  onAdd: input.onAdd,
  onToggle: input.onToggle,
  onDeleteRequest: input.onDeleteRequest,
  onSave: input.onSave,
  onCancel: input.onCancel,
  onFieldChange: input.onFieldChange,
  onPolish: input.onPolish,
  onGenerateTags: input.onGenerateTags,
  onDeleteConfirm: input.onDeleteConfirm,
  onDeleteCancel: input.onDeleteCancel,
});

const useExperienceSectionModel = ({
  category,
  refreshSignal,
  defaultOrg,
  defaultTitle,
  emptyTitleError,
  toast,
}: ExperienceSectionProps): ExperienceSectionModel => {
  const { experiences, setExperiences, isLoading, refreshExperiences } = useExperienceList(category, refreshSignal);
  const { setCardRef, scrollToCard } = useCardRefs();
  const store = useCardDataStore();
  const { ensureCardState } = useCardInitializer(experiences, store.setCardData, store.setOriginalCardData);
  const { updateCardField, resetCard } = useCardEditors(store.originalCardData, store.setCardData, store.setModifiedCards);
  const { removeCardState } = useCardRemoval(store.setCardData, store.setModifiedCards, store.setOriginalCardData);
  const expansion = useCardExpansionState(ensureCardState, scrollToCard);
  const { isCreating, handleAddNew } = useExperienceCreate({
    category, defaultOrg, defaultTitle, toast, setExperiences,
    setCardData: store.setCardData,
    setOriginalCardData: store.setOriginalCardData,
    setModifiedCards: store.setModifiedCards,
    setExpandedCards: expansion.setExpandedCards,
    scrollToCard,
  });
  const { savingCardId, handleSaveCard } = useExperienceSave({
    category, cardData: store.cardData, emptyTitleError, toast, refreshExperiences,
    toggleCard: expansion.toggleCard, setExperiences,
    setCardData: store.setCardData,
    setOriginalCardData: store.setOriginalCardData,
    setModifiedCards: store.setModifiedCards,
  });
  const deleteActions = useExperienceDelete({
    category, toast, refreshExperiences, scrollToCard, setExperiences,
    removeCardState,
    removeCardExpansion: expansion.removeCardExpansion,
  });
  const polishActions = usePolishActions({ cardData: store.cardData, toast, updateCardField });
  const tagActions = useTagActions({ cardData: store.cardData, toast, updateCardField });
  const sortedExperiences = useSortedExperiences(experiences);

  const handleCancel = useCallback((cardId: string) => {
    if (isTempId(cardId)) {
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
  }, [resetCard, expansion, setExperiences, store]);

  return buildSectionModel({
    experiences,
    sortedExperiences,
    isLoading,
    isCreating,
    cardData: store.cardData,
    expandedCards: expansion.expandedCards,
    collapsingCards: expansion.collapsingCards,
    modifiedCards: store.modifiedCards,
    savingCardId,
    generatingTagIds: tagActions.generatingTagIds,
    deletingCardId: deleteActions.deletingCardId,
    setCardRef,
    isFieldPolishing: polishActions.isFieldPolishing,
    onAdd: handleAddNew,
    onToggle: expansion.toggleCard,
    onDeleteRequest: deleteActions.requestDelete,
    onSave: handleSaveCard,
    onCancel: handleCancel,
    onFieldChange: updateCardField,
    onPolish: polishActions.handlePolishField,
    onGenerateTags: tagActions.handleGenerateTags,
    onDeleteConfirm: deleteActions.executeDelete,
    onDeleteCancel: deleteActions.cancelDelete,
  });
};

const SectionHeader: React.FC<{
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  isLoading: boolean;
  count: number;
}> = ({ icon, title, subtitle, isLoading, count }) => (
  <div className="flex items-center justify-between">
    <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
      {icon}
      {title}
      <span className="text-sm font-normal text-gray-400 ml-2">{subtitle}</span>
    </h2>
    <span className="text-xs font-mono text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">
      {isLoading ? 'Loading...' : `${count} items`}
    </span>
  </div>
);

const AddExperienceButton: React.FC<{
  onClick: () => void;
  label: string;
  disabled: boolean;
  themeColor?: string;
}> = ({ onClick, label, disabled, themeColor }) => {
  const isPrimary = !themeColor || themeColor === 'primary';
  const containerClass = isPrimary
    ? 'hover:text-primary hover:border-primary hover:bg-primary/5'
    : `hover:text-${themeColor}-600 hover:border-${themeColor}-600 hover:bg-${themeColor}-50`;
  const iconClass = isPrimary
    ? 'group-hover:text-primary'
    : `group-hover:text-${themeColor}-600`;

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full group border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-xl p-4 flex items-center justify-center gap-2 text-gray-500 transition-all duration-300 disabled:opacity-60 disabled:cursor-not-allowed ${containerClass}`}
      type="button"
    >
      <div className={`p-1 rounded-full bg-gray-200 dark:bg-gray-800 transition-colors group-hover:bg-white ${iconClass}`}>
        <Plus className="w-5 h-5" />
      </div>
      <span className="font-medium">{label}</span>
    </button>
  );
};

const ExperienceCardList: React.FC<{
  items: ExperienceListItem[];
  labels: ExperienceCardLabels;
  showTags: boolean;
  model: ExperienceSectionModel;
  themeColor?: string;
}> = ({ items, labels, showTags, model, themeColor }) => (
  <>
    {items.map((item) => {
      const cardId = item.master.id;
      const data = model.cardData.get(cardId) || buildExperienceCardData(item);
      return (
        <ExperienceCard
          key={cardId}
          ref={(el) => model.setCardRef(cardId, el)}
          data={data}
          labels={labels}
          isExpanded={model.expandedCards.has(cardId)}
          isCollapsing={model.collapsingCards.has(cardId)}
          isModified={model.modifiedCards.has(cardId)}
          isSaving={model.savingCardId === cardId}
          showTags={showTags}
          isGeneratingTags={model.generatingTagIds.has(cardId)}
          isFieldPolishing={(field) => model.isFieldPolishing(cardId, field)}
          onToggle={() => model.onToggle(cardId)}
          onDelete={() => model.onDeleteRequest(cardId)}
          onSave={() => model.onSave(cardId)}
          onCancel={() => model.onCancel(cardId)}
          onFieldChange={(field, value) => model.onFieldChange(cardId, field, value)}
          onPolish={(field) => model.onPolish(cardId, field)}
          onGenerateTags={() => model.onGenerateTags(cardId)}
          themeColor={themeColor}
        />
      );
    })}
  </>
);

const DeleteDialog: React.FC<{
  isOpen: boolean;
  description: string;
  onCancel: () => void;
  onConfirm: () => void;
}> = ({ isOpen, description, onCancel, onConfirm }) => (
  <ConfirmDialog
    isOpen={isOpen}
    title="确认删除"
    description={
      <>
        {description}
        <br />
        此操作无法撤销。
      </>
    }
    onCancel={onCancel}
    onConfirm={onConfirm}
  />
);

const ExperienceSectionView: React.FC<{
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  labels: ExperienceCardLabels;
  addButtonLabel: string;
  deleteConfirmText: string;
  showTags: boolean;
  model: ExperienceSectionModel;
  themeColor?: string;
}> = ({ title, subtitle, icon, labels, addButtonLabel, deleteConfirmText, showTags, model, themeColor }) => (
  <section className="space-y-6 pt-6 border-t border-gray-200 dark:border-gray-800">
    <SectionHeader
      icon={icon}
      title={title}
      subtitle={subtitle}
      isLoading={model.isLoading}
      count={model.experiences.length}
    />
    <AddExperienceButton
      onClick={model.onAdd}
      label={addButtonLabel}
      disabled={model.isCreating}
      themeColor={themeColor}
    />
    <ExperienceCardList items={model.sortedExperiences} labels={labels} showTags={showTags} model={model} themeColor={themeColor} />
    <DeleteDialog
      isOpen={Boolean(model.deletingCardId)}
      description={deleteConfirmText}
      onCancel={model.onDeleteCancel}
      onConfirm={model.onDeleteConfirm}
    />
  </section>
);

const ExperienceSection: React.FC<ExperienceSectionProps> = (props) => {
  const model = useExperienceSectionModel(props);
  return (
    <ExperienceSectionView
      title={props.title}
      subtitle={props.subtitle}
      icon={props.icon}
      labels={props.labels}
      addButtonLabel={props.addButtonLabel}
      deleteConfirmText={props.deleteConfirmText}
      showTags={props.showTags ?? false}
      model={model}
      themeColor={props.themeColor}
    />
  );
};

export default ExperienceSection;
