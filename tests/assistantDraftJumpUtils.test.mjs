import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import { build } from 'esbuild';

const importAssistantDraftJumpUtils = async () => {
  const result = await build({
    entryPoints: ['views/AIAssistant/draftJumpUtils.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const source = result.outputFiles[0].text;
  const encoded = Buffer.from(source).toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
};

const buildMessage = (overrides = {}) => ({
  id: 'message-1',
  role: 'assistant',
  message_type: 'draft_card',
  content_json: {},
  created_at: '2026-06-08T00:00:00.000Z',
  ...overrides,
});

const buildSession = (overrides = {}) => ({
  id: 'session-1',
  user_id: 'user-1',
  title: 'Session',
  mode: 'experience',
  entry_source: 'resume_editor',
  context_json: { resumeId: 'resume-1', masterId: 'master-1' },
  latest_preview: {},
  created_at: '2026-06-08T00:00:00.000Z',
  updated_at: '2026-06-08T00:00:00.000Z',
  ...overrides,
});

const buildExperienceCard = (overrides = {}) => ({
  type: 'experience',
  status: 'draft_ready',
  data: {
    category: 'project',
    org: 'Org',
    title: 'Title',
    startDate: '2026-01',
    endDate: '',
    isCurrent: true,
    star: {
      s: 'Situation',
      t: 'Task',
      a: 'Action',
      r: 'Result',
    },
    ...overrides,
  },
});

test('builds a manual-save jump handler that stores pending draft and jumps to resume editor', async () => {
  const { createDraftJumpHandler } = await importAssistantDraftJumpUtils();
  const writtenDrafts = [];
  const markedMessageIds = [];
  const jumpedResumeIds = [];

  const handler = createDraftJumpHandler({
    item: {
      message: buildMessage(),
      card: buildExperienceCard({ targetMasterId: 'master-1' }),
      isManualSaveMode: true,
    },
    selectedSession: buildSession(),
    onJumpToResumeEditor: (resumeId) => jumpedResumeIds.push(resumeId),
    markManualSaveMessage: (messageId) => markedMessageIds.push(messageId),
    writePendingManualSaveDraft: (draft) => writtenDrafts.push(draft),
    notifyError: (message) => assert.fail(`unexpected error: ${message}`),
    now: () => 1780891200000,
  });

  assert.equal(typeof handler, 'function');
  handler();

  assert.deepEqual(jumpedResumeIds, ['resume-1']);
  assert.deepEqual(markedMessageIds, ['message-1']);
  assert.equal(writtenDrafts.length, 1);
  assert.equal(writtenDrafts[0].messageId, 'message-1');
  assert.equal(writtenDrafts[0].masterId, 'master-1');
  assert.equal(writtenDrafts[0].createdAt, 1780891200000);
});

test('manual-save jump handler reports target mismatch without writing pending draft', async () => {
  const { createDraftJumpHandler } = await importAssistantDraftJumpUtils();
  const writtenDrafts = [];
  const errors = [];
  const jumpedResumeIds = [];

  const handler = createDraftJumpHandler({
    item: {
      message: buildMessage(),
      card: buildExperienceCard({ targetMasterId: 'other-master' }),
      isManualSaveMode: true,
    },
    selectedSession: buildSession(),
    onJumpToResumeEditor: (resumeId) => jumpedResumeIds.push(resumeId),
    markManualSaveMessage: () => assert.fail('message should not be marked'),
    writePendingManualSaveDraft: (draft) => writtenDrafts.push(draft),
    notifyError: (message) => errors.push(message),
    now: () => 1780891200000,
  });

  handler();

  assert.equal(writtenDrafts.length, 0);
  assert.equal(jumpedResumeIds.length, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /无法跳转到编辑区：AI 草稿目标经历与当前编辑上下文不一致/);
});

test('attaches jump handlers only to manual-save draft items', async () => {
  const { attachDraftJumpHandlers } = await importAssistantDraftJumpUtils();

  const items = attachDraftJumpHandlers(
    [
      {
        message: buildMessage({ id: 'manual-message' }),
        card: buildExperienceCard(),
        isManualSaveMode: true,
      },
      {
        message: buildMessage({ id: 'regular-message' }),
        card: buildExperienceCard(),
        isManualSaveMode: false,
      },
    ],
    {
      selectedSession: buildSession(),
      onJumpToResumeEditor: () => {},
      markManualSaveMessage: () => {},
      notifyError: (message) => assert.fail(`unexpected error: ${message}`),
    },
  );

  assert.equal(typeof items[0].onJumpToEditor, 'function');
  assert.equal(items[1].onJumpToEditor, undefined);
});

test('manual non-experience jump handler falls back to resume id from session context', async () => {
  const { attachDraftJumpHandlers } = await importAssistantDraftJumpUtils();
  const jumpedResumeIds = [];

  const items = attachDraftJumpHandlers(
    [{
      message: buildMessage(),
      card: {
        type: 'skill_group',
        status: 'draft_ready',
        data: { category: 'Frontend', skills: ['React'] },
      },
      isManualSaveMode: false,
    }],
    {
      selectedSession: buildSession({ context_json: { resumeId: 'resume-2' } }),
      onJumpToResumeEditor: (resumeId) => jumpedResumeIds.push(resumeId),
      markManualSaveMessage: () => assert.fail('message should not be marked'),
      notifyError: (message) => assert.fail(`unexpected error: ${message}`),
    },
  );

  assert.equal(items[0].onJumpToEditor, undefined);

  const manualItems = attachDraftJumpHandlers(
    [{ ...items[0], isManualSaveMode: true }],
    {
      selectedSession: buildSession({ context_json: { resumeId: 'resume-2' } }),
      onJumpToResumeEditor: (resumeId) => jumpedResumeIds.push(resumeId),
      markManualSaveMessage: () => assert.fail('message should not be marked'),
      notifyError: (message) => assert.fail(`unexpected error: ${message}`),
    },
  );

  assert.equal(typeof manualItems[0].onJumpToEditor, 'function');
  manualItems[0].onJumpToEditor();

  assert.deepEqual(jumpedResumeIds, ['resume-2']);
});

test('applied draft navigation jumps back to the experience bank target', async () => {
  const { createAppliedDraftNavigationHandler } = await importAssistantDraftJumpUtils();
  const jumps = [];

  const handler = createAppliedDraftNavigationHandler({
    navigation: {
      targetView: 'experience_bank',
      targetId: 'master-1',
      category: 'project',
    },
    onJumpToExperienceBank: (category, targetId) => jumps.push({ category, targetId }),
    notifyError: (message) => assert.fail(`unexpected error: ${message}`),
  });

  assert.equal(typeof handler, 'function');
  handler();

  assert.deepEqual(jumps, [{ category: 'project', targetId: 'master-1' }]);
});

test('applied draft navigation jumps back to the resume editor target', async () => {
  const { createAppliedDraftNavigationHandler } = await importAssistantDraftJumpUtils();
  const jumps = [];

  const handler = createAppliedDraftNavigationHandler({
    navigation: {
      targetView: 'resume_editor',
      resumeId: 'resume-1',
      targetId: 'master-1',
    },
    onJumpToResumeEditor: (resumeId, targetId) => jumps.push({ resumeId, targetId }),
    notifyError: (message) => assert.fail(`unexpected error: ${message}`),
  });

  handler();

  assert.deepEqual(jumps, [{ resumeId: 'resume-1', targetId: 'master-1' }]);
});
