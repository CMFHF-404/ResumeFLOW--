import { useCallback, useRef } from 'react';
import type { ExperienceListItem } from '../../services/experienceService';
import type { ExperienceCardData, StarFieldKey } from '../ExperienceCard';
import {
  useCardDataStore,
  useCardEditors,
  useCardExpansionState,
  useCardInitializer,
  useCardRefs,
  useCardRemoval,
} from './cardDataHooks';
import { isTempId, STAR_FIELD_KEYS } from './cardDataUtils';
import { useExperienceCreate, useExperienceDelete, useExperienceSave } from './experienceActions';
import { useExperienceList, useSortedExperiences } from './experienceListHooks';
import { usePolishActions } from './polishActions';
import type { CardPolishMode, ExperienceSectionModel, ExperienceSectionProps } from './types';

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
  onCancel: (cardId: string) => void;
  onFieldChange: (cardId: string, field: string, value: string | string[]) => void;
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
  savingCardId: input.savingCardId,
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
  onCancel: input.onCancel,
  onFieldChange: input.onFieldChange,
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
  defaultTitle,
  emptyTitleError,
  toast,
  onLaunchAssistant,
}: ExperienceSectionProps): ExperienceSectionModel => {
  const { experiences, setExperiences, isLoading, refreshExperiences } = useExperienceList(category, refreshSignal);
  const { setCardRef, scrollToCard, highlightCard } = useCardRefs();
  const store = useCardDataStore();
  const pendingAiPolishApplyRef = useRef(new Set<string>());
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
  const { isCreating, handleAddNew } = useExperienceCreate({
    category, defaultOrg, defaultTitle, toast, setExperiences,
    setCardData: store.setCardData,
    setOriginalCardData: store.setOriginalCardData,
    setModifiedCards: store.setModifiedCards,
    setExpandedCards: expansion.setExpandedCards,
  });
  const deleteActions = useExperienceDelete({
    category, toast, refreshExperiences, highlightCard, setExperiences,
    removeCardState,
    removeCardExpansion: expansion.removeCardExpansion,
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
    cardData: store.cardData,
    toast,
    updateCardField,
    updateCardData,
    updateCardStar,
    category,
    onLaunchAssistant,
    hasPendingAiPolishApply,
    markPendingAiPolishApply,
    clearPendingAiPolishApply,
  });
  const { savingCardId, handleSaveCard } = useExperienceSave({
    category, cardData: store.cardData, emptyTitleError, toast, refreshExperiences,
    toggleCard: expansion.toggleCard, clearPreviewState, hasPendingAiPolishApply, clearPendingAiPolishApply, setExperiences,
    setCardData: store.setCardData,
    setOriginalCardData: store.setOriginalCardData,
    setModifiedCards: store.setModifiedCards,
  });
  const sortedExperiences = useSortedExperiences(experiences);

  const handleFieldChange = useCallback(
    (cardId: string, field: string, value: string | string[]) => {
      if (field.startsWith('star.')) {
        const starField = field.split('.')[1] as StarFieldKey;
        if (STAR_FIELD_KEYS.includes(starField)) {
          clearStarSnapshot(cardId, starField);
        }
      }
      updateCardField(cardId, field, value);
    },
    [clearStarSnapshot, updateCardField]
  );

  const handleCancel = useCallback((cardId: string) => {
    clearPendingAiPolishApply(cardId);
    clearPreviewState(cardId);
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
  }, [clearPendingAiPolishApply, clearPreviewState, resetCard, expansion, setExperiences, store]);

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
    deletingCardId: deleteActions.deletingCardId,
    setCardRef,
    isPolishing,
    getPolishMode,
    getCustomPrompt,
    isPreviewingPolish,
    onAdd: handleAddNew,
    onToggle: expansion.toggleCard,
    onDeleteRequest: deleteActions.requestDelete,
    onSave: handleSaveCard,
    onCancel: handleCancel,
    onFieldChange: handleFieldChange,
    onPolishModeChange: handlePolishModeChange,
    onCustomPromptChange: handleCustomPromptChange,
    onRunPolish: handleRunPolish,
    onUndoPolishPreview: handleUndoPolishPreview,
    onConfirmPolishPreview: handleConfirmPolishPreview,
    onOpenAssistant: handleOpenAssistant,
    onUndo: handleUndo,
    onDeleteConfirm: deleteActions.executeDelete,
    onDeleteCancel: deleteActions.cancelDelete,
  });
};
