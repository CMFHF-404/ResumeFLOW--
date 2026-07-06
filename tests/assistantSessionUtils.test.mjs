import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import { build } from 'esbuild';

const importAssistantSessionUtils = async () => {
  const result = await build({
    entryPoints: ['views/AIAssistant/sessionUtils.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const source = result.outputFiles[0].text;
  const encoded = Buffer.from(source).toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
};

const importAssistantSessionContextUtils = async () => {
  const result = await build({
    entryPoints: ['views/AIAssistant/sessionContextUtils.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const source = result.outputFiles[0].text;
  const encoded = Buffer.from(source).toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
};

const buildSession = (id, updatedAt, title = `Session ${id}`) => ({
  id,
  user_id: 'user-1',
  title,
  mode: 'general',
  entry_source: 'direct',
  latest_preview: {},
  context_json: {},
  created_at: updatedAt,
  updated_at: updatedAt,
});

test('rejects assistant session list responses that are not arrays', async () => {
  const { assertAssistantSessionListResponse } = await importAssistantSessionUtils();

  assert.throws(
    () => assertAssistantSessionListResponse({ sessions: [] }),
    /Assistant session list response must be an array/
  );
});

test('rejects assistant session details whose messages are not arrays', async () => {
  const { assertAssistantSessionDetailResponse } = await importAssistantSessionUtils();

  assert.throws(
    () => assertAssistantSessionDetailResponse({
      session: {
        id: 'session-1',
        user_id: 'user-1',
        title: 'AI 助理',
        mode: 'general',
        entry_source: 'direct',
        latest_preview: {},
        context_json: {},
        created_at: '2026-06-03T00:00:00Z',
        updated_at: '2026-06-03T00:00:00Z',
      },
      messages: { items: [] },
    }),
    /Assistant session detail messages must be an array/
  );
});

test('preserves locally mutated sessions that are missing from stale list responses', async () => {
  const { reconcileAssistantSessions } = await importAssistantSessionUtils();

  const localSession = buildSession('local-new', '2026-06-03T00:03:00Z', 'Local draft');
  const serverSession = buildSession('server-old', '2026-06-03T00:01:00Z', 'Server old');
  const result = reconcileAssistantSessions(
    [localSession],
    [serverSession],
    10,
    new Map([['local-new', 11]]),
    new Map(),
  );

  assert.deepEqual(result.map((session) => session.id), ['local-new', 'server-old']);
});

test('does not revive sessions deleted after a list request started', async () => {
  const { reconcileAssistantSessions } = await importAssistantSessionUtils();

  const deletedSession = buildSession('deleted', '2026-06-03T00:04:00Z', 'Deleted');
  const result = reconcileAssistantSessions(
    [],
    [deletedSession],
    10,
    new Map(),
    new Map([['deleted', 12]]),
  );

  assert.deepEqual(result.map((session) => session.id), []);
});

test('keeps locally updated sessions when stale list responses contain the same id', async () => {
  const { reconcileAssistantSessions } = await importAssistantSessionUtils();

  const localSession = buildSession('same', '2026-06-03T00:05:00Z', 'Local rename');
  const staleServerSession = buildSession('same', '2026-06-03T00:02:00Z', 'Stale server');
  const result = reconcileAssistantSessions(
    [localSession],
    [staleServerSession],
    10,
    new Map([['same', 13]]),
    new Map(),
  );

  assert.equal(result.length, 1);
  assert.equal(result[0].title, 'Local rename');
});

test('mergeAssistantSessions lets incoming sessions win and sorts by updated time', async () => {
  const { mergeAssistantSessions } = await importAssistantSessionUtils();

  const oldSession = buildSession('same', '2026-06-03T00:01:00Z', 'Old');
  const otherSession = buildSession('other', '2026-06-03T00:02:00Z', 'Other');
  const updatedSession = buildSession('same', '2026-06-03T00:03:00Z', 'Updated');
  const result = mergeAssistantSessions([oldSession, otherSession], [updatedSession]);

  assert.deepEqual(result.map((session) => session.id), ['same', 'other']);
  assert.equal(result[0].title, 'Updated');
});

test('matches legacy education previews against normalized experience draft cards', async () => {
  const { isSameDraftCard } = await importAssistantSessionUtils();

  const preview = {
    type: 'education',
    status: 'draft_ready',
    data: {
      org: '某大学',
      title: '计算机科学',
      startDate: '2022-09',
      endDate: '2026-06',
      isCurrent: false,
      star: {
        s: '本科阶段',
        t: '课程学习',
        a: '数据结构',
        r: '完成核心课程',
      },
    },
  };
  const card = {
    type: 'experience',
    status: 'draft_ready',
    data: {
      category: 'education',
      org: '某大学',
      title: '计算机科学',
      startDate: '2022-09',
      endDate: '2026-06',
      isCurrent: false,
      star: {
        s: '本科阶段',
        t: '课程学习',
        a: '数据结构',
        r: '完成核心课程',
      },
    },
  };

  assert.equal(isSameDraftCard(preview, card), true);
});

test('hydrates sidebar context from latest historical selected resume without losing full live snapshot', async () => {
  const { deriveSelectedAssistantContextFromMessages } = await importAssistantSessionContextUtils();

  const liveResume = {
    resumeId: 'resume-1',
    resumeName: 'AI 产品实习简历',
    contextSource: 'implicit_current_resume',
    jdContext: '当前 JD',
    snapshot: {
      experiences: [
        { id: 'exp-1', title: '产品助理', org: 'A 公司', star: { s: 's1' } },
        { id: 'exp-2', title: 'RPG 项目', org: '个人项目', star: { s: 's2' } },
      ],
      educations: [{ id: 'edu-1', school: '浙江农林大学', major: '地理信息科学', degree: '本科' }],
      certifications: [],
      skills: [{ id: 'skill-1', name: 'Axure', category: '产品工具' }],
    },
  };
  const messages = [
    {
      id: 'older-user',
      role: 'user',
      message_type: 'user_text',
      content_json: { text: '旧消息' },
      created_at: '2026-06-03T00:00:00.000Z',
    },
    {
      id: 'latest-user',
      role: 'user',
      message_type: 'user_text',
      content_json: {
        text: '继续优化',
        selected_resume: {
          resume_id: 'resume-1',
          resume_name: 'AI 产品实习简历',
          context_source: 'implicit_current_resume',
          selection: { mode: 'subset', experienceIds: ['exp-2'] },
          snapshot: {
            experiences: [{ id: 'exp-2', title: 'RPG 项目', org: '个人项目', star: { s: 's2' } }],
            educations: [],
            certifications: [],
            skills: [],
          },
        },
        selected_experiences: [{
          masterId: 'master-1',
          category: 'project',
          org: '个人项目',
          title: 'RPG 项目',
          isCurrent: false,
        }],
      },
      created_at: '2026-06-03T00:01:00.000Z',
    },
  ];

  const hydrated = deriveSelectedAssistantContextFromMessages(messages, liveResume);

  assert.equal(hydrated.selectedResume.contextSource, 'implicit_current_resume');
  assert.deepEqual(hydrated.selectedResume.selection, { mode: 'subset', experienceIds: ['exp-2'] });
  assert.deepEqual(hydrated.selectedResume.snapshot.experiences.map((item) => item.id), ['exp-1', 'exp-2']);
  assert.deepEqual(hydrated.selectedResumeModuleIds, ['exp-exp-2']);
  assert.deepEqual(hydrated.selectedExperiences.map((item) => item.masterId), ['master-1']);
});
