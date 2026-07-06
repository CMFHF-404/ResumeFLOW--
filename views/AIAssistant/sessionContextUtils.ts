import type {
  AssistantMessage,
  AssistantMode,
  AssistantSelectedExperience,
  AssistantSelectedResume,
  AssistantSession,
} from '../../services/aiService';
import {
  readMessageSelectedExperiences,
  readMessageSelectedResume,
} from './selectionUtils';

export const ASSISTANT_MODE_HINTS: Record<AssistantMode, string> = {
  general: '同一条对话里自由整理经历、证书与技能',
  experience: '用 STAR 追问把经历梳成可录入卡片',
  certification: '把证书信息整理成统一录入格式',
  skill: '归类技能并沉淀成技能组卡片',
};

export const resolveSessionHint = (session: AssistantSession | null) => {
  if (!session) {
    return '直接描述你的素材，AI 会自动识别是在整理经历、证书还是技能。';
  }
  if (session.entry_source === 'resume_editor') {
    return '当前会话来自简历工厂高级入口，但你仍然可以继续扩展到证书或技能。';
  }
  if (session.entry_source === 'experience_bank') {
    return '当前会话来自经历库高级入口，但你仍然可以继续扩展到证书或技能。';
  }
  return ASSISTANT_MODE_HINTS[session.mode];
};

export const readContextString = (context: Record<string, unknown>, key: string) => {
  const value = context[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
};

export const isPersistedCallbackOnlySession = (session: AssistantSession | null) => {
  if (!session) {
    return false;
  }
  const applyMode = readContextString(session.context_json ?? {}, 'assistantApplyMode');
  if (applyMode === 'manual_save') {
    return true;
  }
  return session.entry_source === 'resume_editor'
    && Boolean(readContextString(session.context_json ?? {}, 'masterId'));
};

export type AssistantHydratedSessionContext = {
  selectedResume: AssistantSelectedResume | null;
  selectedResumeModuleIds: string[];
  selectedExperiences: AssistantSelectedExperience[];
};

export const deriveSelectedResumeModuleIds = (
  selectedResume: AssistantSelectedResume | null,
) => {
  const selection = selectedResume?.selection;
  if (!selection || selection.mode !== 'subset') {
    return [];
  }
  if (selection.moduleIds?.length) {
    return selection.moduleIds;
  }
  return selection.experienceIds.map((id) => `exp-${id}`);
};

const findLatestUserContextMessage = (messages: AssistantMessage[]) => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== 'user') {
      continue;
    }
    if (message.content_json?.selected_resume || message.content_json?.selected_experiences) {
      return message;
    }
  }
  return null;
};

const mergeSelectedResumeWithLiveSnapshot = (
  selectedResume: AssistantSelectedResume | null,
  liveSelectedResume: AssistantSelectedResume | null | undefined,
): AssistantSelectedResume | null => {
  if (!selectedResume) {
    return null;
  }
  if (!liveSelectedResume || liveSelectedResume.resumeId !== selectedResume.resumeId) {
    return selectedResume.contextSource
      ? selectedResume
      : { ...selectedResume, contextSource: 'history_replay' };
  }
  return {
    ...liveSelectedResume,
    masterId: selectedResume.masterId ?? liveSelectedResume.masterId,
    resumeName: selectedResume.resumeName || liveSelectedResume.resumeName,
    jdContext: selectedResume.jdContext ?? liveSelectedResume.jdContext,
    contextSource: selectedResume.contextSource ?? liveSelectedResume.contextSource ?? 'history_replay',
    selection: selectedResume.selection,
  };
};

export const deriveSelectedAssistantContextFromMessages = (
  messages: AssistantMessage[],
  liveSelectedResume?: AssistantSelectedResume | null,
): AssistantHydratedSessionContext => {
  const contextMessage = findLatestUserContextMessage(messages);
  if (!contextMessage) {
    return {
      selectedResume: null,
      selectedResumeModuleIds: [],
      selectedExperiences: [],
    };
  }

  const selectedResume = mergeSelectedResumeWithLiveSnapshot(
    readMessageSelectedResume(contextMessage),
    liveSelectedResume,
  );

  return {
    selectedResume,
    selectedResumeModuleIds: deriveSelectedResumeModuleIds(selectedResume),
    selectedExperiences: readMessageSelectedExperiences(contextMessage),
  };
};
