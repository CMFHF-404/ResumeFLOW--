import type { AssistantDraftCard, AssistantMessage, AssistantSession, AssistantSessionDetail } from '../../services/aiService';
import { normalizeAssistantDraftCard } from '../../utils/assistantDraft';

export type AssistantDraftMessageItem = {
  message: AssistantMessage;
  card: AssistantDraftCard;
  isManualSaveMode: boolean;
  onJumpToEditor?: () => void;
};

export type AssistantDraftGroup = {
  id: string;
  items: AssistantDraftMessageItem[];
  latestItem: AssistantDraftMessageItem;
};

export const assertAssistantSessionListResponse = (value: unknown): AssistantSession[] => {
  if (!Array.isArray(value)) {
    throw new Error('Assistant session list response must be an array');
  }
  return value as AssistantSession[];
};

export const assertAssistantSessionDetailResponse = (value: AssistantSessionDetail): AssistantSessionDetail => {
  if (!Array.isArray(value.messages)) {
    throw new Error('Assistant session detail messages must be an array');
  }
  return value;
};

export const isDraftMessageApplied = (message: AssistantMessage) => {
  if (message.message_type !== 'draft_card') {
    return false;
  }
  return typeof message.content_json?.applied_at === 'string' && message.content_json.applied_at.trim().length > 0;
};

export const isPendingLatestPreview = (session: AssistantSession) => {
  const preview = session.latest_preview;
  if (!preview || typeof preview !== 'object') {
    return false;
  }
  if (typeof preview.type !== 'string' || !preview.type.trim()) {
    return false;
  }
  return !(typeof preview.applied_at === 'string' && preview.applied_at.trim().length > 0);
};

export const isSameDraftCard = (preview: Record<string, unknown> | undefined, card: AssistantDraftCard) => {
  if (!preview || typeof preview !== 'object') {
    return false;
  }
  try {
    const normalizedPreview = normalizeAssistantDraftCard(preview as unknown as AssistantDraftCard);
    const normalizedCard = normalizeAssistantDraftCard(card);
    if (normalizedPreview.type !== normalizedCard.type) {
      return false;
    }
    return JSON.stringify(normalizedPreview.data ?? null) === JSON.stringify(normalizedCard.data);
  } catch (error) {
    return false;
  }
};

const resolveDraftGroupId = (item: AssistantDraftMessageItem) => {
  if (item.card.type === 'skill_group') {
    const category = item.card.data.category.trim();
    if (category) {
      return `skill_group:${category.toLocaleLowerCase()}`;
    }
    return `message:${item.message.id}`;
  }
  if (item.card.type !== 'experience') {
    return `message:${item.message.id}`;
  }
  const targetMasterId = item.card.data.targetMasterId?.trim();
  if (targetMasterId) {
    return `master:${targetMasterId}`;
  }
  const category = item.card.data.category;
  const org = item.card.data.org.trim();
  const title = item.card.data.title.trim();
  if (org || title) {
    return `draft:${category}:${org}:${title}`;
  }
  return `message:${item.message.id}`;
};

export const groupDraftItems = (items: AssistantDraftMessageItem[]): AssistantDraftGroup[] => {
  const groupsById = new Map<string, AssistantDraftMessageItem[]>();
  items.forEach((item) => {
    const groupId = resolveDraftGroupId(item);
    const current = groupsById.get(groupId) ?? [];
    current.push(item);
    groupsById.set(groupId, current);
  });
  return Array.from(groupsById.entries())
    .map(([id, groupItems]) => ({
      id,
      items: groupItems,
      latestItem: groupItems[groupItems.length - 1],
    }))
    .sort((left, right) => items.lastIndexOf(right.latestItem) - items.lastIndexOf(left.latestItem));
};

export const sortSessionsByUpdatedAt = (items: AssistantSession[]) => {
  return [...items].sort(
    (left, right) => new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime()
  );
};

export const mergeAssistantSessions = (
  current: AssistantSession[],
  incoming: AssistantSession[],
) => {
  const next = new Map<string, AssistantSession>();
  current.forEach((session) => {
    next.set(session.id, session);
  });
  incoming.forEach((session) => {
    next.set(session.id, session);
  });
  return sortSessionsByUpdatedAt(Array.from(next.values()));
};

export const reconcileAssistantSessions = (
  current: AssistantSession[],
  incoming: AssistantSession[],
  mutationSeqAtStart: number,
  sessionMutationSeqs: Map<string, number>,
  deletedSessionSeqs: Map<string, number>,
) => {
  const incomingIds = new Set(incoming.map((session) => session.id));
  const next = new Map<string, AssistantSession>();

  current.forEach((session) => {
    const localMutationSeq = sessionMutationSeqs.get(session.id) ?? 0;
    if (!incomingIds.has(session.id) && localMutationSeq > mutationSeqAtStart) {
      next.set(session.id, session);
    }
  });

  incoming.forEach((session) => {
    const currentSession = current.find((item) => item.id === session.id);
    const localMutationSeq = sessionMutationSeqs.get(session.id) ?? 0;
    const deletedSeq = deletedSessionSeqs.get(session.id) ?? 0;
    if (deletedSeq > mutationSeqAtStart) {
      return;
    }
    if (currentSession && localMutationSeq > mutationSeqAtStart) {
      next.set(session.id, currentSession);
      return;
    }
    next.set(session.id, session);
  });

  return sortSessionsByUpdatedAt(Array.from(next.values()));
};
