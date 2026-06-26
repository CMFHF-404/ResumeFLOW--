import type {
  AssistantMessage,
  AssistantSelectedExperience,
  AssistantSelectedResume,
  AssistantSkillId,
  AssistantStreamEvent,
} from '../../services/aiService';
import type { AssistantComposerAttachment } from './attachmentUtils';
import { resolveAssistantStreamThought } from './streamUtils';

export type AssistantSendPayload = {
  userMessage: string;
  skillId?: AssistantSkillId | null;
  enableThinking?: boolean;
  attachments?: AssistantComposerAttachment[];
  selectedExperiences?: AssistantSelectedExperience[];
  selectedResume?: AssistantSelectedResume | null;
};

export type PreparedAssistantSendPayload = {
  trimmedMessage: string;
  effectiveMessage: string;
  skillId: AssistantSkillId | null;
  enableThinking: boolean;
  attachments: AssistantComposerAttachment[];
  selectedExperienceItems: AssistantSelectedExperience[];
  selectedResumeItem: AssistantSelectedResume | null;
};

const MULTI_ATTACHMENT_DEFAULT_MESSAGE = '请先阅读我上传的这些附件，并帮我整理其中的关键信息。';
const SINGLE_ATTACHMENT_DEFAULT_MESSAGE = '请先阅读我上传的附件，并帮我整理其中的信息。';
const SELECTED_RESUME_DEFAULT_MESSAGE = '请结合我选择的简历和对应 JD，给出针对性的简历修改建议，并可按需生成模拟面试题。';
const SELECTED_EXPERIENCE_DEFAULT_MESSAGE = '请优先参考我选中的经历，并结合当前上下文给出针对性的整理与建议。';
const ASSISTANT_THINKING_SEPARATOR = '\n';

const normalizeAssistantThinkingText = (value: string) => value
  .split(/\r?\n/)
  .map((line) => line.replace(/\s+/g, ' ').trim())
  .filter(Boolean)
  .join(ASSISTANT_THINKING_SEPARATOR);

export const appendAssistantThoughtText = (current: string, rawHeadline: string) => {
  const headline = normalizeAssistantThinkingText(rawHeadline);
  if (!headline) {
    return normalizeAssistantThinkingText(current);
  }
  const parts = normalizeAssistantThinkingText(current)
    .split(ASSISTANT_THINKING_SEPARATOR)
    .map((item) => item.trim())
    .filter(Boolean);
  if (parts[parts.length - 1] !== headline) {
    parts.push(headline);
  }
  return parts.join(ASSISTANT_THINKING_SEPARATOR);
};

export type AssistantThoughtStreamState = {
  activeThought: string;
  streamedThoughtText: string;
};

export const reduceAssistantThoughtStreamState = (
  state: AssistantThoughtStreamState,
  event: AssistantStreamEvent,
  enableThinking: boolean,
): AssistantThoughtStreamState => {
  if (event.type === 'thought_reset') {
    return {
      activeThought: '',
      streamedThoughtText: '',
    };
  }
  if (event.type !== 'thought' && event.type !== 'progress') {
    return state;
  }

  const headline = resolveAssistantStreamThought(event);
  return {
    activeThought: appendAssistantThoughtText(state.activeThought, headline),
    streamedThoughtText: enableThinking && event.type === 'thought'
      ? appendAssistantThoughtText(state.streamedThoughtText, headline)
      : state.streamedThoughtText,
  };
};

export const prepareAssistantSendPayload = (payload: AssistantSendPayload): PreparedAssistantSendPayload | null => {
  const trimmedMessage = payload.userMessage.trim();
  const skillId = payload.skillId ?? null;
  const enableThinking = Boolean(payload.enableThinking);
  const attachments = payload.attachments ?? [];
  const selectedExperienceItems = payload.selectedExperiences ?? [];
  const selectedResumeItem = payload.selectedResume ?? null;
  if (!trimmedMessage && attachments.length === 0 && selectedExperienceItems.length === 0 && !selectedResumeItem) {
    return null;
  }
  const effectiveMessage = trimmedMessage
    || (attachments.length > 0
      ? attachments.length > 1
        ? MULTI_ATTACHMENT_DEFAULT_MESSAGE
        : SINGLE_ATTACHMENT_DEFAULT_MESSAGE
      : selectedResumeItem
        ? SELECTED_RESUME_DEFAULT_MESSAGE
        : SELECTED_EXPERIENCE_DEFAULT_MESSAGE);
  return {
    trimmedMessage,
    effectiveMessage,
    skillId,
    enableThinking,
    attachments,
    selectedExperienceItems,
    selectedResumeItem,
  };
};

export const buildOptimisticAssistantUserMessage = (
  prepared: PreparedAssistantSendPayload,
  now: string,
  randomValue: number,
): AssistantMessage => {
  const {
    trimmedMessage,
    skillId,
    attachments,
    selectedExperienceItems,
    selectedResumeItem,
  } = prepared;
  return {
    id: `local-user-${now}-${randomValue}`,
    role: 'user',
    message_type: 'user_text',
    content_json: {
      text: trimmedMessage,
      ...(attachments.length > 0 ? {
        attachment: {
          id: attachments[0].id,
          name: attachments[0].name,
          type: attachments[0].type,
          sizeLabel: attachments[0].sizeLabel,
        },
        ...(attachments.length > 1 ? {
          attachments: attachments.map((attachment) => ({
            id: attachment.id,
            name: attachment.name,
            type: attachment.type,
            sizeLabel: attachment.sizeLabel,
          })),
        } : {}),
      } : {}),
      ...(selectedExperienceItems.length > 0 ? {
        selected_experiences: selectedExperienceItems,
      } : {}),
      ...(selectedResumeItem ? {
        selected_resume: selectedResumeItem,
      } : {}),
      ...(skillId ? { skill_id: skillId } : {}),
    },
    created_at: now,
  };
};

export const buildAssistantTextMessage = (
  assistantText: string,
  skillId: AssistantSkillId | null,
  suggestedFollowups: unknown[] | null | undefined,
  now: string,
  randomValue: number,
  thinkingText = '',
): AssistantMessage => ({
  id: `local-assistant-${now}-${randomValue}`,
  role: 'assistant',
  message_type: 'assistant_text',
  content_json: {
    text: assistantText,
    ...(normalizeAssistantThinkingText(thinkingText) ? {
      thinking: normalizeAssistantThinkingText(thinkingText),
    } : {}),
    ...(skillId ? { skill_id: skillId } : {}),
    ...(suggestedFollowups?.length ? { suggestedFollowups } : {}),
  },
  created_at: now,
});
