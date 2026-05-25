import type { AssistantMode, AssistantSession } from '../../services/aiService';

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
