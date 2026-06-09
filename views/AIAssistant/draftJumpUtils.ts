import type { AssistantSession } from '../../services/aiService';
import type { PendingAssistantManualSaveDraft } from '../assistantManualSaveStorage';
import { writePendingAssistantManualSaveDraft } from '../assistantManualSaveStorage';
import { buildResumeEditorDraftJumpState } from './draftApplyUtils';
import { extractApplyErrorDetails } from './logUtils';
import { readContextString } from './sessionContextUtils';
import type { AssistantDraftMessageItem } from './sessionUtils';

type DraftJumpHandlerParams = {
  item: Omit<AssistantDraftMessageItem, 'onJumpToEditor'>;
  selectedSession: AssistantSession | null;
  onJumpToResumeEditor?: (resumeId?: string) => void;
  markManualSaveMessage: (messageId: string) => void;
  writePendingManualSaveDraft?: (draft: PendingAssistantManualSaveDraft) => void;
  notifyError: (message: string) => void;
  now?: () => number;
};

type AttachDraftJumpHandlersParams = {
  selectedSession: AssistantSession | null;
  onJumpToResumeEditor?: (resumeId?: string) => void;
  markManualSaveMessage: (messageId: string) => void;
  notifyError: (message: string) => void;
};

export const createDraftJumpHandler = ({
  item,
  selectedSession,
  onJumpToResumeEditor,
  markManualSaveMessage,
  writePendingManualSaveDraft = writePendingAssistantManualSaveDraft,
  notifyError,
  now = Date.now,
}: DraftJumpHandlerParams): (() => void) => {
  const { message, card, isManualSaveMode } = item;
  return () => {
    const context = selectedSession?.context_json ?? {};
    const contextResumeId = readContextString(context, 'resumeId');

    if (isManualSaveMode && card.type === 'experience') {
      try {
        const { resumeId, pendingManualSaveDraft } = buildResumeEditorDraftJumpState({
          sessionId: selectedSession?.id ?? '',
          messageId: message.id,
          context,
          draft: card.data,
          createdAt: now(),
        });
        if (pendingManualSaveDraft) {
          writePendingManualSaveDraft(pendingManualSaveDraft);
          markManualSaveMessage(message.id);
        }
        onJumpToResumeEditor?.(resumeId ?? undefined);
      } catch (jumpError) {
        const jumpErrorDetails = extractApplyErrorDetails(jumpError);
        notifyError(`无法跳转到编辑区：${jumpErrorDetails.userMessage}`);
      }
      return;
    }

    onJumpToResumeEditor?.(contextResumeId ?? undefined);
  };
};

export const attachDraftJumpHandlers = (
  items: Omit<AssistantDraftMessageItem, 'onJumpToEditor'>[],
  params: AttachDraftJumpHandlersParams,
): AssistantDraftMessageItem[] => (
  items.map((item) => ({
    ...item,
    onJumpToEditor: item.isManualSaveMode
      ? createDraftJumpHandler({ item, ...params })
      : undefined,
  }))
);
