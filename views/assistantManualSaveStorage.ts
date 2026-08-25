import type { AssistantExperienceDraft } from '../services/aiService';

const ASSISTANT_MANUAL_SAVE_STORAGE_KEY = 'yuanzijianli.assistantManualSaveDraft';
const ASSISTANT_MANUAL_SAVE_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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

const isAuthenticatedOwnerKey = (ownerKey: string | null | undefined): ownerKey is string => (
  typeof ownerKey === 'string'
  && ownerKey.trim().length > 0
  && ownerKey !== 'anonymous'
);

export const buildAssistantManualSaveStorageKey = (ownerKey: string) => (
  `${ASSISTANT_MANUAL_SAVE_STORAGE_KEY}:${encodeURIComponent(ownerKey)}`
);

export const clearLegacyAssistantManualSaveDrafts = () => {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.removeItem(ASSISTANT_MANUAL_SAVE_STORAGE_KEY);
};

export const clearPendingAssistantManualSaveDraftsForOwner = (
  ownerKey: string | null | undefined,
) => {
  if (typeof window === 'undefined' || !isAuthenticatedOwnerKey(ownerKey)) {
    return;
  }
  window.localStorage.removeItem(buildAssistantManualSaveStorageKey(ownerKey));
};

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

const isFreshDraft = (draft: PendingAssistantManualSaveDraft, now: number) => (
  draft.createdAt >= now - ASSISTANT_MANUAL_SAVE_DRAFT_TTL_MS
  && draft.createdAt <= now
);

const readStoredDrafts = (
  ownerKey: string | null | undefined,
  now = Date.now(),
): PendingAssistantManualSaveDraft[] => {
  if (typeof window === 'undefined' || !isAuthenticatedOwnerKey(ownerKey)) {
    clearLegacyAssistantManualSaveDrafts();
    return [];
  }
  clearLegacyAssistantManualSaveDrafts();
  const storageKey = buildAssistantManualSaveStorageKey(ownerKey);
  const raw = window.localStorage.getItem(storageKey);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    const parsedDrafts = Array.isArray(parsed) ? parsed : null;
    const drafts = parsedDrafts
      ? parsedDrafts.filter(isPendingAssistantManualSaveDraft)
      : isPendingAssistantManualSaveDraft(parsed) ? [parsed] : [];
    const freshDrafts = drafts.filter((draft) => isFreshDraft(draft, now));
    if (freshDrafts.length !== parsedDrafts?.length || !parsedDrafts) {
      writeStoredDrafts(ownerKey, freshDrafts);
    }
    return sortDraftsByCreatedAtDesc(freshDrafts);
  } catch {
    window.localStorage.removeItem(storageKey);
    return [];
  }
};

const writeStoredDrafts = (
  ownerKey: string | null | undefined,
  drafts: PendingAssistantManualSaveDraft[],
) => {
  if (typeof window === 'undefined' || !isAuthenticatedOwnerKey(ownerKey)) {
    clearLegacyAssistantManualSaveDrafts();
    return;
  }
  clearLegacyAssistantManualSaveDrafts();
  const storageKey = buildAssistantManualSaveStorageKey(ownerKey);
  if (drafts.length === 0) {
    window.localStorage.removeItem(storageKey);
    return;
  }
  window.localStorage.setItem(
    storageKey,
    JSON.stringify(sortDraftsByCreatedAtDesc(drafts)),
  );
};

export const readPendingAssistantManualSaveDrafts = (
  ownerKey: string | null | undefined,
  matcher?: PendingAssistantManualSaveDraftMatcher,
): PendingAssistantManualSaveDraft[] => (
  readStoredDrafts(ownerKey).filter((draft) => matchesDraft(draft, matcher))
);

export const readPendingAssistantManualSaveDraft = (
  ownerKey: string | null | undefined,
  matcher?: PendingAssistantManualSaveDraftMatcher,
): PendingAssistantManualSaveDraft | null => (
  readPendingAssistantManualSaveDrafts(ownerKey, matcher)[0] ?? null
);

export const writePendingAssistantManualSaveDraft = (
  ownerKey: string | null | undefined,
  draft: PendingAssistantManualSaveDraft,
) => {
  const current = readStoredDrafts(ownerKey).filter((item) => !matchesDraft(item, {
    sessionId: draft.sessionId,
    messageId: draft.messageId,
  }));
  current.push(draft);
  writeStoredDrafts(ownerKey, current);
};

export const clearPendingAssistantManualSaveDraft = (
  ownerKey: string | null | undefined,
  matcher?: PendingAssistantManualSaveDraftMatcher,
) => {
  if (typeof window === 'undefined' || !isAuthenticatedOwnerKey(ownerKey)) {
    clearLegacyAssistantManualSaveDrafts();
    return;
  }
  clearLegacyAssistantManualSaveDrafts();
  if (!matcher) {
    window.localStorage.removeItem(buildAssistantManualSaveStorageKey(ownerKey));
    return;
  }
  writeStoredDrafts(
    ownerKey,
    readStoredDrafts(ownerKey).filter((draft) => !matchesDraft(draft, matcher)),
  );
};
