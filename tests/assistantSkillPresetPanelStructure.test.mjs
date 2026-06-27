import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('AIAssistant binds composer quick buttons to assistant skill presets', () => {
  const assistant = read('views/AIAssistant.tsx');
  const contextRail = read('views/AIAssistant/AssistantContextRail.tsx');
  const presetPanel = read('views/AIAssistant/AssistantSkillPresetPanel.tsx');
  const chatInput = read('views/AIAssistant/ChatInputBox.tsx');
  const expectedPresets = [
    {
      id: 'star_guidance',
      title: 'STAR 引导助手',
      prompt: '请用 STAR 引导我补全这段经历，先追问缺失信息，不要急着生成成稿。',
      icon: 'Sparkles',
    },
    {
      id: 'experience_completion',
      title: '智能补全',
      prompt: '请按智能补全模式诊断选中经历是否足够支撑目标 JD；证据不足时只追问当前经历内可补充事实，0-3 个问题，不要询问其他项目、课程项目、个人练习或非本项目案例。',
      icon: 'Wrench',
    },
    {
      id: 'mock_interview',
      title: '模拟面试教练',
      prompt: '请结合我选择的简历/JD，模拟面试官追问，并指出我的回答如何更贴合岗位价值。',
      icon: 'Lightbulb',
    },
  ];

  assert.doesNotMatch(assistant, /AssistantSkillPresetPanel/);
  assert.match(assistant, /<AssistantContextRail[\s\S]*<ChatInputBox/);
  assert.match(assistant, /hasContextItems=\{composerAttachments\.length > 0 \|\| Boolean\(selectedResume\)\}/);
  assert.match(assistant, /onSelectSkillPreset=\{handleSelectSkillPreset\}/);
  assert.match(assistant, /from '\.\/AIAssistant\/AssistantContextRail'/);
  assert.match(assistant, /displayLabel: exp\.org \|\| exp\.title \|\| '经历'/);
  assert.match(assistant, /displayLabel: edu\.school \|\| '教育经历'/);
  assert.match(assistant, /displayLabel: cert\.name \|\| '证书资质'/);
  assert.doesNotMatch(assistant, /ExperiencePicker/);
  assert.doesNotMatch(assistant, /key: 'pick-experience'/);
  assert.doesNotMatch(assistant, /label: '选择经历'/);
  assert.doesNotMatch(assistant, /ASSISTANT_SKILL_PRESETS/);
  assert.doesNotMatch(assistant, /mock_interview/);
  assert.match(contextRail, /hideSelectedResumeCard\?: boolean/);
  assert.match(contextRail, /shouldShowSelectedResumeCard = Boolean\(selectedResume\) && !hideSelectedResumeCard/);
  assert.doesNotMatch(contextRail, /selectedExperiences/);
  assert.doesNotMatch(contextRail, /resumeExperienceCards/);
  assert.doesNotMatch(contextRail, /简历经历/);
  assert.doesNotMatch(contextRail, /当前简历 · 选择经历/);
  assert.doesNotMatch(contextRail, /onSelectResumeExperiences/);
  assert.match(chatInput, /ASSISTANT_SKILL_PRESETS/);
  assert.match(chatInput, /presetId: 'star_guidance'/);
  assert.match(chatInput, /label: 'STAR 引导助手'/);
  assert.match(chatInput, /presetId: 'experience_completion'/);
  assert.match(chatInput, /label: '智能补全'/);
  assert.match(chatInput, /presetId: 'mock_interview'/);
  assert.match(chatInput, /label: '模拟面试'/);
  assert.doesNotMatch(chatInput, /label: 'AI生成'/);
  assert.doesNotMatch(chatInput, /label: 'AI润色'/);
  assert.doesNotMatch(chatInput, /label: 'AI诊断'/);
  assert.doesNotMatch(chatInput, /帮我根据JD生成简历对应模块的内容/);
  assert.doesNotMatch(chatInput, /帮我AI润色这段经历/);
  assert.doesNotMatch(chatInput, /帮我诊断一下我的简历/);
  assert.match(chatInput, /displayLabel: string/);
  assert.match(chatInput, /selectedResumeModuleIds/);
  assert.match(chatInput, /selectedModuleSummary/);
  assert.match(chatInput, /selectedModuleTitle/);
  assert.match(chatInput, /selectedResumeModules\[selectedModuleCount - 1\]\?\.displayLabel/);
  assert.match(chatInput, /selectedResumeModules\.map\(\(item\) => item\.displayLabel\)/);
  assert.match(chatInput, /current\.includes\(mod\.id\) \? current : \[\.\.\.current, mod\.id\]/);
  assert.match(chatInput, /const isSelected = selectedResumeModuleIds\.includes\(mod\.id\)/);
  assert.match(chatInput, /isSelected\s*\?\s*'bg-emerald-600 text-white shadow-sm shadow-emerald-100 hover:bg-emerald-600 dark:bg-emerald-500 dark:text-white dark:shadow-none dark:hover:bg-emerald-500'/);
  assert.match(presetPanel, /ASSISTANT_SKILL_PRESETS/);
  assert.match(presetPanel, /aria-label="AI 助手技能"/);
  assert.match(presetPanel, /activeSkillId === id/);
  assert.match(presetPanel, /onClick=\{\(\) => onSelectPreset\(id, prompt\)\}/);
  assert.match(chatInput, /hasContextItems = false/);
  assert.doesNotMatch(chatInput, /selectedResume\?: AssistantSelectedResume/);
  assert.doesNotMatch(chatInput, /selectedExperiences\?: AssistantSelectedExperience/);
  assert.doesNotMatch(chatInput, /attachments\?: ChatInputAttachmentPreview/);

  const presetOrder = [...presetPanel.matchAll(/id: '([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual(presetOrder, expectedPresets.map((preset) => preset.id));
  for (const preset of expectedPresets) {
    assert.match(presetPanel, new RegExp(`id: '${preset.id}'`));
    assert.match(presetPanel, new RegExp(`title: '${preset.title}'`));
    assert.match(presetPanel, new RegExp(`prompt: '${preset.prompt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`));
    assert.match(presetPanel, new RegExp(`Icon: ${preset.icon}`));
  }
});
