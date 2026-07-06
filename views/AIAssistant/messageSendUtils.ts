import type {
  AssistantMessage,
  AssistantSelectedExperience,
  AssistantSelectedResume,
  AssistantSkillId,
  AssistantStreamEvent,
} from '../../services/aiService';
import type { AssistantComposerAttachment } from './attachmentUtils';
import { appendThoughtDisplayText } from '../../utils/aiThought';
import { resolveAssistantStreamThoughtDisplay } from './streamUtils';

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
  displayMessage: string;
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
  return appendThoughtDisplayText(current, rawHeadline, {
    separator: ASSISTANT_THINKING_SEPARATOR,
    dedupeStrategy: 'last',
  });
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
  if (!enableThinking) {
    return state;
  }
  const resolution = resolveAssistantStreamThoughtDisplay(event);
  if (resolution?.kind !== 'model_thought' && resolution?.kind !== 'status') {
    return state;
  }

  const activeThought = appendAssistantThoughtText(state.activeThought, resolution.text);
  return {
    activeThought,
    streamedThoughtText: resolution.persist
      ? appendAssistantThoughtText(state.streamedThoughtText, resolution.text)
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
    displayMessage: trimmedMessage || effectiveMessage,
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
    displayMessage,
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
      text: displayMessage,
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

export type AssistantTextStreamState = {
  temporaryMessageId: string | null;
  streamedText: string;
};

const getAssistantDeltaText = (event: AssistantStreamEvent) => {
  if (event.type !== 'assistant_delta') {
    return '';
  }
  if (typeof event.delta === 'string') {
    return event.delta;
  }
  if (typeof event.text === 'string') {
    return event.text;
  }
  return '';
};

export type AssistantTextStreamTransition = {
  state: AssistantTextStreamState;
  temporaryMessage: AssistantMessage | null;
  removeTemporaryMessageId: string | null;
  mutated: boolean;
};

export const reduceAssistantTextStreamEvent = (
  state: AssistantTextStreamState,
  event: AssistantStreamEvent,
  options: {
    skillId: AssistantSkillId | null;
    now: string;
    randomValue: number;
  },
): AssistantTextStreamTransition => {
  if (event.type === 'assistant_text_reset') {
    return {
      state: { temporaryMessageId: null, streamedText: '' },
      temporaryMessage: null,
      removeTemporaryMessageId: state.temporaryMessageId,
      mutated: Boolean(state.temporaryMessageId || state.streamedText),
    };
  }

  const delta = getAssistantDeltaText(event);
  if (!delta) {
    return {
      state,
      temporaryMessage: null,
      removeTemporaryMessageId: null,
      mutated: false,
    };
  }

  const nextText = `${state.streamedText}${delta}`;
  const temporaryMessageId = state.temporaryMessageId
    ?? `local-assistant-stream-${options.now}-${options.randomValue}`;
  const nextMessage = buildAssistantTextMessage(
    nextText,
    options.skillId,
    null,
    options.now,
    options.randomValue,
  );

  return {
    state: {
      temporaryMessageId,
      streamedText: nextText,
    },
    temporaryMessage: {
      ...nextMessage,
      id: temporaryMessageId,
    },
    removeTemporaryMessageId: null,
    mutated: true,
  };
};

export const applyAssistantTextStreamTransition = (
  messages: AssistantMessage[],
  transition: AssistantTextStreamTransition,
): AssistantMessage[] => {
  if (transition.removeTemporaryMessageId) {
    return messages.filter((message) => message.id !== transition.removeTemporaryMessageId);
  }
  if (!transition.temporaryMessage) {
    return messages;
  }
  const existingIndex = messages.findIndex((message) => message.id === transition.temporaryMessage?.id);
  if (existingIndex === -1) {
    return [...messages, transition.temporaryMessage];
  }
  return messages.map((message, index) => (index === existingIndex ? transition.temporaryMessage! : message));
};

export const applyAssistantTextStreamEvent = (
  messages: AssistantMessage[],
  state: AssistantTextStreamState,
  event: AssistantStreamEvent,
  options: {
    skillId: AssistantSkillId | null;
    now: string;
    randomValue: number;
  },
): { messages: AssistantMessage[]; state: AssistantTextStreamState; mutated: boolean } => {
  const transition = reduceAssistantTextStreamEvent(state, event, options);
  return {
    messages: applyAssistantTextStreamTransition(messages, transition),
    state: transition.state,
    mutated: transition.mutated,
  };
};

export const replaceAssistantTextStreamMessage = (
  messages: AssistantMessage[],
  state: AssistantTextStreamState,
  finalMessage: AssistantMessage | null,
): { messages: AssistantMessage[]; state: AssistantTextStreamState; mutated: boolean } => {
  const withoutTemporaryMessage = state.temporaryMessageId
    ? messages.filter((message) => message.id !== state.temporaryMessageId)
    : messages;
  const nextMessages = finalMessage
    ? [...withoutTemporaryMessage, finalMessage]
    : withoutTemporaryMessage;
  return {
    messages: nextMessages,
    state: { temporaryMessageId: null, streamedText: '' },
    mutated: nextMessages !== messages || Boolean(state.temporaryMessageId),
  };
};
