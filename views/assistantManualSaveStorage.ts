import type { AssistantExperienceDraft } from '../services/aiService';

const ASSISTANT_MANUAL_SAVE_STORAGE_KEY = 'yuanzijianli.assistantManualSaveDraft';

export type PendingAssistantManualSaveDraft = {
  source: 'resume_editor';
  sessionId: string;
  messageId: string;
  resumeId: string;
  masterId: string;
  draft: AssistantExperienceDraft;
  createdAt: number;
};

type PendingAssistantManualSaveDraftMatcher = Partial<
  Pick<PendingAssistantManualSaveDraft, 'sessionId' | 'messageId' | 'resumeId' | 'masterId'>
>;

const isAssistantExperienceDraft = (value: unknown): value is AssistantExperienceDraft => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  const star = candidate.star;
  if (!star || typeof star !== 'object') {
    return false;
  }
  const starFields = star as Record<string, unknown>;
  return (
    typeof candidate.category === 'string'
    && typeof candidate.org === 'string'
    && typeof candidate.title === 'string'
    && typeof candidate.startDate === 'string'
    && typeof candidate.endDate === 'string'
    && typeof starFields.s === 'string'
    && typeof starFields.t === 'string'
    && typeof starFields.a === 'string'
    && typeof starFields.r === 'string'
  );
};

const isPendingAssistantManualSaveDraft = (value: unknown): value is PendingAssistantManualSaveDraft => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    candidate.source === 'resume_editor'
    && typeof candidate.sessionId === 'string'
    && typeof candidate.messageId === 'string'
    && typeof candidate.resumeId === 'string'
    && typeof candidate.masterId === 'string'
    && typeof candidate.createdAt === 'number'
    && isAssistantExperienceDraft(candidate.draft)
  );
};

const matchesDraft = (
  draft: PendingAssistantManualSaveDraft,
  matcher?: PendingAssistantManualSaveDraftMatcher,
) => {
  if (!matcher) {
    return true;
  }
  return (
    (!matcher.sessionId || matcher.sessionId === draft.sessionId)
    && (!matcher.messageId || matcher.messageId === draft.messageId)
    && (!matcher.resumeId || matcher.resumeId === draft.resumeId)
    && (!matcher.masterId || matcher.masterId === draft.masterId)
  );
};

const sortDraftsByCreatedAtDesc = (drafts: PendingAssistantManualSaveDraft[]) => (
  [...drafts].sort((a, b) => b.createdAt - a.createdAt)
);

const readStoredDrafts = (): PendingAssistantManualSaveDraft[] => {
  if (typeof window === 'undefined') {
    return [];
  }
  const raw = window.localStorage.getItem(ASSISTANT_MANUAL_SAVE_STORAGE_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return sortDraftsByCreatedAtDesc(parsed.filter(isPendingAssistantManualSaveDraft));
    }
    return isPendingAssistantManualSaveDraft(parsed) ? [parsed] : [];
  } catch {
    return [];
  }
};

const writeStoredDrafts = (drafts: PendingAssistantManualSaveDraft[]) => {
  if (typeof window === 'undefined') {
    return;
  }
  if (drafts.length === 0) {
    window.localStorage.removeItem(ASSISTANT_MANUAL_SAVE_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(
    ASSISTANT_MANUAL_SAVE_STORAGE_KEY,
    JSON.stringify(sortDraftsByCreatedAtDesc(drafts)),
  );
};

export const readPendingAssistantManualSaveDrafts = (
  matcher?: PendingAssistantManualSaveDraftMatcher,
): PendingAssistantManualSaveDraft[] => (
  readStoredDrafts().filter((draft) => matchesDraft(draft, matcher))
);

export const readPendingAssistantManualSaveDraft = (
  matcher?: PendingAssistantManualSaveDraftMatcher,
): PendingAssistantManualSaveDraft | null => (
  readPendingAssistantManualSaveDrafts(matcher)[0] ?? null
);

export const writePendingAssistantManualSaveDraft = (draft: PendingAssistantManualSaveDraft) => {
  const current = readStoredDrafts().filter((item) => !matchesDraft(item, {
    sessionId: draft.sessionId,
    messageId: draft.messageId,
  }));
  current.push(draft);
  writeStoredDrafts(current);
};

export const clearPendingAssistantManualSaveDraft = (
  matcher?: PendingAssistantManualSaveDraftMatcher,
) => {
  if (typeof window === 'undefined') {
    return;
  }
  if (!matcher) {
    window.localStorage.removeItem(ASSISTANT_MANUAL_SAVE_STORAGE_KEY);
    return;
  }
  writeStoredDrafts(readStoredDrafts().filter((draft) => !matchesDraft(draft, matcher)));
};
