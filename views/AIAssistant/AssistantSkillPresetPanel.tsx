import React from 'react';
import {
  Lightbulb,
  Sparkles,
  Wrench,
} from 'lucide-react';
import type { AssistantSkillId } from '../../services/aiService';

type SkillPreset = {
  id: AssistantSkillId;
  title: string;
  prompt: string;
  Icon: React.ComponentType<{ className?: string }>;
};

export const ASSISTANT_SKILL_PRESETS: SkillPreset[] = [
  {
    id: 'star_guidance',
    title: 'STAR 引导助手',
    prompt: '请用 STAR 引导我补全这段经历，先追问缺失信息，不要急着生成成稿。',
    Icon: Sparkles,
  },
  {
    id: 'experience_completion',
    title: '智能补全',
    prompt: '请按智能补全模式诊断选中经历是否足够支撑目标 JD；证据不足时只追问当前经历内可补充事实，0-3 个问题，不要询问其他项目、课程项目、个人练习或非本项目案例。',
    Icon: Wrench,
  },
  {
    id: 'mock_interview',
    title: '模拟面试教练',
    prompt: '请结合我选择的简历/JD，模拟面试官追问，并指出我的回答如何更贴合岗位价值。',
    Icon: Lightbulb,
  },
];

type AssistantSkillPresetPanelProps = {
  activeSkillId: AssistantSkillId | null;
  onSelectPreset: (skillId: AssistantSkillId, prompt: string) => void;
};

export const AssistantSkillPresetPanel: React.FC<AssistantSkillPresetPanelProps> = ({
  activeSkillId,
  onSelectPreset,
}) => (
  <div className="mb-2 w-full overflow-hidden" aria-label="AI 助手技能">
    <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
      {ASSISTANT_SKILL_PRESETS.map(({ id, title, prompt, Icon }) => {
        const isActive = activeSkillId === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onSelectPreset(id, prompt)}
            className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-2xl border px-3 text-sm font-semibold shadow-sm transition ${
              isActive
                ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-200'
                : 'border-slate-200 bg-white/90 text-slate-600 hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900/90 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:text-white'
            }`}
            title={prompt}
          >
            <Icon className="h-4 w-4" />
            <span>{title}</span>
          </button>
        );
      })}
    </div>
  </div>
);
