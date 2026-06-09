import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('AIAssistant delegates skill preset cards to AssistantSkillPresetPanel', () => {
  const assistant = read('views/AIAssistant.tsx');
  const presetPanel = read('views/AIAssistant/AssistantSkillPresetPanel.tsx');
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

  assert.match(assistant, /AssistantSkillPresetPanel/);
  assert.match(assistant, /activeSkillId=\{activeComposerSkillId\}/);
  assert.match(assistant, /onSelectPreset=\{handleSelectSkillPreset\}/);
  assert.doesNotMatch(assistant, /ASSISTANT_SKILL_PRESETS/);
  assert.doesNotMatch(assistant, /mock_interview/);
  assert.match(presetPanel, /ASSISTANT_SKILL_PRESETS/);
  assert.match(presetPanel, /activeSkillId === id/);
  assert.match(presetPanel, /onClick=\{\(\) => onSelectPreset\(id, prompt\)\}/);

  const presetOrder = [...presetPanel.matchAll(/id: '([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual(presetOrder, expectedPresets.map((preset) => preset.id));
  for (const preset of expectedPresets) {
    assert.match(presetPanel, new RegExp(`id: '${preset.id}'`));
    assert.match(presetPanel, new RegExp(`title: '${preset.title}'`));
    assert.match(presetPanel, new RegExp(`prompt: '${preset.prompt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`));
    assert.match(presetPanel, new RegExp(`Icon: ${preset.icon}`));
  }
});
