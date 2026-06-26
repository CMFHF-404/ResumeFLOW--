import type { AssistantDraftApplyNavigation, AssistantSession } from '../../services/aiService';
import type { PendingAssistantManualSaveDraft } from '../assistantManualSaveStorage';
import { writePendingAssistantManualSaveDraft } from '../assistantManualSaveStorage';
import { buildResumeEditorDraftJumpState } from './draftApplyUtils';
import { extractApplyErrorDetails } from './logUtils';
import { readContextString } from './sessionContextUtils';
import type { AssistantDraftMessageItem } from './sessionUtils';

type DraftJumpHandlerParams = {
  item: Omit<AssistantDraftMessageItem, 'onJumpToEditor' | 'onViewAppliedDraft'>;
  selectedSession: AssistantSession | null;
  onJumpToResumeEditor?: (resumeId?: string, targetId?: string) => void;
  markManualSaveMessage: (messageId: string) => void;
  writePendingManualSaveDraft?: (draft: PendingAssistantManualSaveDraft) => void;
  notifyError: (message: string) => void;
  now?: () => number;
};

type AttachDraftJumpHandlersParams = {
  selectedSession: AssistantSession | null;
  onJumpToResumeEditor?: (resumeId?: string, targetId?: string) => void;
  onJumpToExperienceBank?: (category?: AssistantDraftApplyNavigation['category'], targetId?: string) => void;
  markManualSaveMessage: (messageId: string) => void;
  notifyError: (message: string) => void;
};

type AppliedDraftNavigationHandlerParams = {
  navigation: AssistantDraftApplyNavigation | null | undefined;
  onJumpToResumeEditor?: (resumeId?: string, targetId?: string) => void;
  onJumpToExperienceBank?: (category?: AssistantDraftApplyNavigation['category'], targetId?: string) => void;
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

export const createAppliedDraftNavigationHandler = ({
  navigation,
  onJumpToResumeEditor,
  onJumpToExperienceBank,
  notifyError,
}: AppliedDraftNavigationHandlerParams): (() => void) | undefined => {
  if (!navigation) {
    return undefined;
  }
  return () => {
    if (navigation.targetView === 'resume_editor') {
      if (!onJumpToResumeEditor) {
        notifyError('无法跳转到简历工厂：当前页面缺少跳转入口');
        return;
      }
      onJumpToResumeEditor(navigation.resumeId ?? undefined, navigation.targetId ?? undefined);
      return;
    }
    if (navigation.targetView === 'experience_bank') {
      if (!onJumpToExperienceBank) {
        notifyError('无法跳转到经历库：当前页面缺少跳转入口');
        return;
      }
      onJumpToExperienceBank(navigation.category ?? undefined, navigation.targetId ?? undefined);
    }
  };
};

export const attachDraftJumpHandlers = (
  items: Omit<AssistantDraftMessageItem, 'onJumpToEditor' | 'onViewAppliedDraft'>[],
  params: AttachDraftJumpHandlersParams,
): AssistantDraftMessageItem[] => (
  items.map((item) => ({
    ...item,
    onViewAppliedDraft: createAppliedDraftNavigationHandler({
      navigation: item.navigation,
      onJumpToResumeEditor: params.onJumpToResumeEditor,
      onJumpToExperienceBank: params.onJumpToExperienceBank,
      notifyError: params.notifyError,
    }),
    onJumpToEditor: item.isManualSaveMode
      ? createDraftJumpHandler({ item, ...params })
      : undefined,
  }))
);
