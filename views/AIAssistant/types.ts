import type {
  AssistantDraftCard,
  AssistantEntryContext,
  AssistantMessage,
  AssistantSelectedResume,
  AssistantSkillId,
} from '../../services/aiService';

export type AssistantDraftApplyMeta = {
  sessionId: string;
  messageId: string;
  persistApplied: () => Promise<AssistantMessage>;
};

export type AssistantApplyDraftHandler = (
  draft: AssistantDraftCard,
  meta: AssistantDraftApplyMeta,
) => Promise<boolean>;

export type AssistantLaunchRequest = {
  requestId?: string;
  context: AssistantEntryContext;
  initialSkillId?: AssistantSkillId | null;
  initialUserMessage?: string;
  prefillResume?: AssistantSelectedResume;
  applyDraftHandler?: AssistantApplyDraftHandler;
  callbackOnly?: boolean;
};
