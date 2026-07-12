export type ExperienceDraftStarField = 's' | 't' | 'a' | 'r';

export type ExperienceDraftCardData = {
  org: string;
  title: string;
  start_date: string;
  end_date: string;
  star: Record<ExperienceDraftStarField, string>;
};

/**
 * Keeps the existing UI-shaped service input compatible while separating
 * fields that are stored outside card_data or only exist in local UI state.
 */
export type ExperienceDraftCardDataInput = ExperienceDraftCardData & {
  editMode?: 'simple' | 'expert';
  simpleText?: string;
  draftId?: string | null;
  clientDraftKey?: string | null;
  draftStatus?: 'idle' | 'saving' | 'saved' | 'error';
};
