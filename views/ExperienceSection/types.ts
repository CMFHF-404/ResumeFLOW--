import type React from 'react';
import type { PolishMode } from '../../services/aiService';
import type { ExperienceCategory, ExperienceListItem } from '../../services/experienceService';
import type { ExperienceCardData, ExperienceCardLabels, StarFieldKey } from '../ExperienceCard';
import type { AssistantLaunchRequest } from '../AIAssistant/types';

export type ToastApi = {
  success: (message: string, duration?: number) => string;
  error: (message: string, duration?: number) => string;
  loading: (message: string) => string;
  updateToast: (id: string, updates: { message?: string; type?: 'success' | 'error' | 'loading' | 'ai_thinking'; duration?: number }) => void;
};

export type ExperienceSectionProps = {
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
  toast: ToastApi;
  isAuthenticated: boolean;
  onRequireAuth: () => void | Promise<void>;
  themeColor?: string;
  onLaunchAssistant?: (request: AssistantLaunchRequest) => void;
  onCountChange?: (count: number | null) => void;
};

export type CardPolishMode = Exclude<PolishMode, 'assistant'>;

export type ExperienceSectionModel = {
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
