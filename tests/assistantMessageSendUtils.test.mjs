import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import { build } from 'esbuild';

const importAssistantMessageSendUtils = async () => {
  const result = await build({
    entryPoints: ['views/AIAssistant/messageSendUtils.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const source = result.outputFiles[0].text;
  const encoded = Buffer.from(source).toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
};

const buildAttachment = (id, name) => ({
  id,
  name,
  type: 'application/pdf',
  sizeLabel: '12 KB',
  file: { name },
});

test('returns null for empty assistant send payloads', async () => {
  const { prepareAssistantSendPayload } = await importAssistantMessageSendUtils();

  assert.equal(prepareAssistantSendPayload({ userMessage: '   ' }), null);
});

test('uses trimmed user text as the effective message when present', async () => {
  const { prepareAssistantSendPayload } = await importAssistantMessageSendUtils();

  const prepared = prepareAssistantSendPayload({
    userMessage: '  请优化这段经历  ',
    enableThinking: true,
    attachments: [buildAttachment('att-1', 'resume.pdf')],
  });

  assert.equal(prepared.effectiveMessage, '请优化这段经历');
  assert.equal(prepared.trimmedMessage, '请优化这段经历');
  assert.equal(prepared.enableThinking, true);
});

test('defaults assistant send payloads to standard mode when deep thinking is off', async () => {
  const { prepareAssistantSendPayload } = await importAssistantMessageSendUtils();

  const prepared = prepareAssistantSendPayload({
    userMessage: '继续优化',
  });

  assert.equal(prepared.enableThinking, false);
});

test('uses attachment and selected resume fallback messages without user text', async () => {
  const { prepareAssistantSendPayload } = await importAssistantMessageSendUtils();

  const singleAttachment = prepareAssistantSendPayload({
    userMessage: '',
    attachments: [buildAttachment('att-1', 'resume.pdf')],
  });
  const multiAttachment = prepareAssistantSendPayload({
    userMessage: '',
    attachments: [buildAttachment('att-1', 'a.pdf'), buildAttachment('att-2', 'b.pdf')],
  });
  const selectedResume = prepareAssistantSendPayload({
    userMessage: '',
    selectedResume: { resumeId: 'resume-1', title: '主简历', targetRole: '', hasJD: true, snapshot: { experiences: [], educations: [], certifications: [], skills: [] } },
  });

  assert.equal(singleAttachment.effectiveMessage, '请先阅读我上传的附件，并帮我整理其中的信息。');
  assert.equal(multiAttachment.effectiveMessage, '请先阅读我上传的这些附件，并帮我整理其中的关键信息。');
  assert.equal(selectedResume.effectiveMessage, '请结合我选择的简历和对应 JD，给出针对性的简历修改建议，并可按需生成模拟面试题。');
});

test('builds optimistic user messages with attachments and selected context', async () => {
  const {
    buildOptimisticAssistantUserMessage,
    prepareAssistantSendPayload,
  } = await importAssistantMessageSendUtils();

  const selectedExperience = { masterId: 'exp-1', category: 'project', org: 'Org', title: 'Title' };
  const selectedResume = {
    resumeId: 'resume-1',
    title: '主简历',
    targetRole: '',
    hasJD: false,
    snapshot: { experiences: [], educations: [], certifications: [], skills: [] },
  };
  const prepared = prepareAssistantSendPayload({
    userMessage: '整理一下',
    skillId: 'experience_completion',
    attachments: [buildAttachment('att-1', 'a.pdf'), buildAttachment('att-2', 'b.pdf')],
    selectedExperiences: [selectedExperience],
    selectedResume,
  });
  const message = buildOptimisticAssistantUserMessage(prepared, '2026-06-06T00:00:00.000Z', 0.42);

  assert.equal(message.id, 'local-user-2026-06-06T00:00:00.000Z-0.42');
  assert.equal(message.content_json.text, '整理一下');
  assert.equal(message.content_json.skill_id, 'experience_completion');
  assert.deepEqual(message.content_json.attachment, {
    id: 'att-1',
    name: 'a.pdf',
    type: 'application/pdf',
    sizeLabel: '12 KB',
  });
  assert.deepEqual(message.content_json.attachments.map((item) => item.id), ['att-1', 'att-2']);
  assert.deepEqual(message.content_json.selected_experiences, [selectedExperience]);
  assert.deepEqual(message.content_json.selected_resume, selectedResume);
});

test('builds optimistic user messages with resume experience selection metadata', async () => {
  const {
    buildOptimisticAssistantUserMessage,
    prepareAssistantSendPayload,
  } = await importAssistantMessageSendUtils();

  const selectedResume = {
    resumeId: 'resume-1',
    resumeName: 'AI 产品实习简历',
    selection: { mode: 'subset', experienceIds: ['exp-2'] },
    snapshot: {
      experiences: [
        { id: 'exp-2', title: 'RPG 项目', org: '个人项目', star: { s: '做了产品化拆解', t: '', a: '', r: '' } },
      ],
      educations: [],
      certifications: [],
      skills: [{ id: 'skill-1', name: 'Prompt 设计', category: 'AI' }],
    },
  };
  const prepared = prepareAssistantSendPayload({
    userMessage: '',
    selectedResume,
  });
  const message = buildOptimisticAssistantUserMessage(prepared, '2026-06-06T00:00:00.000Z', 0.64);

  assert.equal(prepared.effectiveMessage, '请结合我选择的简历和对应 JD，给出针对性的简历修改建议，并可按需生成模拟面试题。');
  assert.deepEqual(message.content_json.selected_resume.selection, {
    mode: 'subset',
    experienceIds: ['exp-2'],
  });
  assert.deepEqual(
    message.content_json.selected_resume.snapshot.experiences.map((item) => item.id),
    ['exp-2'],
  );
});

test('builds assistant text messages with optional skill and followups', async () => {
  const { buildAssistantTextMessage } = await importAssistantMessageSendUtils();

  const message = buildAssistantTextMessage(
    '可以这样优化。',
    'star_guidance',
    [{ label: '继续', prompt: '继续完善', skillId: 'star_guidance' }],
    '2026-06-06T00:00:00.000Z',
    0.73,
  );

  assert.equal(message.id, 'local-assistant-2026-06-06T00:00:00.000Z-0.73');
  assert.equal(message.role, 'assistant');
  assert.equal(message.message_type, 'assistant_text');
  assert.equal(message.content_json.text, '可以这样优化。');
  assert.equal(message.content_json.skill_id, 'star_guidance');
  assert.deepEqual(message.content_json.suggestedFollowups, [
    { label: '继续', prompt: '继续完善', skillId: 'star_guidance' },
  ]);
});

test('omits assistant text optional fields when they are empty', async () => {
  const { buildAssistantTextMessage } = await importAssistantMessageSendUtils();

  const message = buildAssistantTextMessage(
    '普通回复',
    null,
    [],
    '2026-06-06T00:00:00.000Z',
    0.12,
  );

  assert.deepEqual(message.content_json, { text: '普通回复' });
});

test('builds assistant text messages with persisted thinking summaries', async () => {
  const { buildAssistantTextMessage } = await importAssistantMessageSendUtils();

  const message = buildAssistantTextMessage(
    '可以这样优化。',
    null,
    [],
    '2026-06-06T00:00:00.000Z',
    0.31,
    '  正在分析上下文\n匹配经历证据  ',
  );

  assert.deepEqual(message.content_json, {
    text: '可以这样优化。',
    thinking: '正在分析上下文\n匹配经历证据',
  });
});

test('assistant thought stream reset clears active and persisted thinking', async () => {
  const { reduceAssistantThoughtStreamState } = await importAssistantMessageSendUtils();

  const withFirstThought = reduceAssistantThoughtStreamState(
    { activeThought: '', streamedThoughtText: '' },
    { type: 'thought', summary: '旧通道摘要' },
    true,
  );
  const afterReset = reduceAssistantThoughtStreamState(
    withFirstThought,
    { type: 'thought_reset' },
    true,
  );
  const afterFallbackThought = reduceAssistantThoughtStreamState(
    afterReset,
    { type: 'thought', summary: '切换后摘要' },
    true,
  );

  assert.deepEqual(afterReset, {
    activeThought: '',
    streamedThoughtText: '',
  });
  assert.deepEqual(afterFallbackThought, {
    activeThought: '切换后摘要',
    streamedThoughtText: '切换后摘要',
  });
});
