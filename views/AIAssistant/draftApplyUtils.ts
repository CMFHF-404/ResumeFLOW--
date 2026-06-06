import type { AssistantDraftCard } from '../../services/aiService';
import type { PendingAssistantManualSaveDraft } from '../assistantManualSaveStorage';
import { normalizeDateInput } from '../../utils/dateUtils';
import { readContextString } from './sessionContextUtils';

type ExperienceDraftData = Extract<AssistantDraftCard, { type: 'experience' }>['data'];

type ResumeEditorManualSaveDraftParams = {
  sessionId: string;
  messageId: string;
  context: Record<string, unknown>;
  draft: ExperienceDraftData;
  createdAt: number;
};

type ResumeEditorDraftJumpState = {
  resumeId: string | null;
  pendingManualSaveDraft: PendingAssistantManualSaveDraft | null;
};

export const readExperienceDraftTargetMasterId = (draft: ExperienceDraftData) => (
  typeof draft.targetMasterId === 'string' && draft.targetMasterId.trim()
    ? draft.targetMasterId.trim()
    : null
);

export const assertResumeEditorDraftTargetMatches = (
  context: Record<string, unknown>,
  draft: ExperienceDraftData,
) => {
  const contextMasterId = readContextString(context, 'masterId');
  const targetMasterId = readExperienceDraftTargetMasterId(draft);
  if (contextMasterId && targetMasterId && targetMasterId !== contextMasterId) {
    throw new Error('AI 草稿目标经历与当前编辑上下文不一致，请重新生成或回到对应经历中处理。');
  }
};

export const buildResumeEditorManualSaveDraft = ({
  sessionId,
  messageId,
  context,
  draft,
  createdAt,
}: ResumeEditorManualSaveDraftParams): PendingAssistantManualSaveDraft | null => {
  const resumeId = readContextString(context, 'resumeId');
  const masterId = readContextString(context, 'masterId') || readExperienceDraftTargetMasterId(draft);
  if (!resumeId || !masterId) {
    return null;
  }
  return {
    source: 'resume_editor',
    sessionId,
    messageId,
    resumeId,
    masterId,
    draft,
    createdAt,
  };
};

export const buildResumeEditorDraftJumpState = (
  params: ResumeEditorManualSaveDraftParams,
): ResumeEditorDraftJumpState => {
  assertResumeEditorDraftTargetMatches(params.context, params.draft);
  return {
    resumeId: readContextString(params.context, 'resumeId'),
    pendingManualSaveDraft: buildResumeEditorManualSaveDraft(params),
  };
};

export const buildResumeExperienceOverrideOperation = (draft: ExperienceDraftData) => {
  const overrides: Record<string, unknown> = {
    star: draft.star,
    is_current: Boolean(draft.isCurrent),
  };
  const clearOverrideKeys = new Set<string>();
  if (draft.title.trim()) {
    overrides.title = draft.title.trim();
  }
  if (draft.org.trim()) {
    overrides.org = draft.org.trim();
  }
  if (draft.startDate.trim()) {
    overrides.start_date = normalizeDateInput(draft.startDate) ?? draft.startDate.trim();
  }
  if (!draft.isCurrent && draft.endDate.trim()) {
    overrides.end_date = normalizeDateInput(draft.endDate) ?? draft.endDate.trim();
  } else {
    clearOverrideKeys.add('end_date');
  }
  return {
    overrides_json: overrides,
    ...(clearOverrideKeys.size > 0 ? { clear_override_keys: Array.from(clearOverrideKeys) } : {}),
  };
};
