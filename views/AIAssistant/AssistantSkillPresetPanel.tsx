import React from 'react';
import {
  Bot,
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

const ASSISTANT_SKILL_PRESETS: SkillPreset[] = [
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
  <div className="mx-auto mt-6 flex w-full max-w-3xl min-w-0 flex-col gap-6 md:mt-10">
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:shadow-[0_20px_60px_-30px_rgba(2,6,23,0.95)] md:p-8">
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300">
          <Bot className="h-6 w-6" />
        </div>
        <div>
          <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-100">选择 AI 助手定位</h2>
          <p className="mt-2 text-sm leading-7 text-slate-600 dark:text-slate-400">
            先选一个工作方式，我会把对应提示放进输入框。你可以继续修改，再决定是否发送。
          </p>
        </div>
      </div>
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        {ASSISTANT_SKILL_PRESETS.map(({ id, title, prompt, Icon }) => {
          const isActive = activeSkillId === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onSelectPreset(id, prompt)}
              className={`min-h-[124px] rounded-2xl border px-4 py-4 text-left transition ${
                isActive
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-950 shadow-sm dark:border-emerald-500/60 dark:bg-emerald-950/35 dark:text-emerald-100'
                  : 'border-slate-200 bg-slate-50/80 text-slate-800 hover:border-slate-300 hover:bg-white dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100 dark:hover:border-slate-600 dark:hover:bg-slate-900'
              }`}
            >
              <span className={`inline-flex h-9 w-9 items-center justify-center rounded-xl ${
                isActive
                  ? 'bg-emerald-500 text-white'
                  : 'bg-white text-slate-500 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700'
              }`}
              >
                <Icon className="h-4 w-4" />
              </span>
              <span className="mt-3 block text-sm font-semibold leading-5">{title}</span>
              <span className="mt-2 block text-xs leading-5 text-slate-500 dark:text-slate-400">
                {prompt}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  </div>
);
