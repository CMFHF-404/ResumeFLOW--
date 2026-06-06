import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import { build } from 'esbuild';

const importAssistantDraftApplyUtils = async () => {
  const result = await build({
    entryPoints: ['views/AIAssistant/draftApplyUtils.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const source = result.outputFiles[0].text;
  const encoded = Buffer.from(source).toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
};

const buildExperienceDraft = (overrides = {}) => ({
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
});

test('rejects resume editor drafts that target a different master experience', async () => {
  const { assertResumeEditorDraftTargetMatches } = await importAssistantDraftApplyUtils();

  assert.throws(
    () => assertResumeEditorDraftTargetMatches(
      { masterId: 'context-master' },
      buildExperienceDraft({ targetMasterId: 'other-master' }),
    ),
    /AI 草稿目标经历与当前编辑上下文不一致/
  );
});

test('allows resume editor drafts without a conflicting target master id', async () => {
  const { assertResumeEditorDraftTargetMatches } = await importAssistantDraftApplyUtils();

  assert.doesNotThrow(() => assertResumeEditorDraftTargetMatches(
    { masterId: 'context-master' },
    buildExperienceDraft({ targetMasterId: ' context-master ' }),
  ));
  assert.doesNotThrow(() => assertResumeEditorDraftTargetMatches(
    { masterId: 'context-master' },
    buildExperienceDraft(),
  ));
});

test('builds manual-save drafts from resume editor context', async () => {
  const { buildResumeEditorManualSaveDraft } = await importAssistantDraftApplyUtils();

  const draft = buildExperienceDraft({ targetMasterId: 'target-master' });
  const pendingDraft = buildResumeEditorManualSaveDraft({
    sessionId: 'session-1',
    messageId: 'message-1',
    context: { resumeId: 'resume-1', masterId: 'context-master' },
    draft,
    createdAt: 1780275672227,
  });

  assert.deepEqual(pendingDraft, {
    source: 'resume_editor',
    sessionId: 'session-1',
    messageId: 'message-1',
    resumeId: 'resume-1',
    masterId: 'context-master',
    draft,
    createdAt: 1780275672227,
  });
});

test('falls back to draft target master id for manual-save drafts', async () => {
  const { buildResumeEditorManualSaveDraft } = await importAssistantDraftApplyUtils();

  const pendingDraft = buildResumeEditorManualSaveDraft({
    sessionId: 'session-1',
    messageId: 'message-1',
    context: { resumeId: 'resume-1' },
    draft: buildExperienceDraft({ targetMasterId: 'target-master' }),
    createdAt: 1780275672227,
  });

  assert.equal(pendingDraft.masterId, 'target-master');
});

test('returns null when manual-save drafts lack resume or master context', async () => {
  const { buildResumeEditorManualSaveDraft } = await importAssistantDraftApplyUtils();

  assert.equal(buildResumeEditorManualSaveDraft({
    sessionId: 'session-1',
    messageId: 'message-1',
    context: { resumeId: 'resume-1' },
    draft: buildExperienceDraft(),
    createdAt: 1780275672227,
  }), null);
  assert.equal(buildResumeEditorManualSaveDraft({
    sessionId: 'session-1',
    messageId: 'message-1',
    context: { masterId: 'master-1' },
    draft: buildExperienceDraft(),
    createdAt: 1780275672227,
  }), null);
});

test('builds resume editor draft jump state with resume id and pending draft', async () => {
  const { buildResumeEditorDraftJumpState } = await importAssistantDraftApplyUtils();

  const draft = buildExperienceDraft({ targetMasterId: 'target-master' });
  const jumpState = buildResumeEditorDraftJumpState({
    sessionId: 'session-1',
    messageId: 'message-1',
    context: { resumeId: 'resume-1' },
    draft,
    createdAt: 1780275672227,
  });

  assert.equal(jumpState.resumeId, 'resume-1');
  assert.deepEqual(jumpState.pendingManualSaveDraft, {
    source: 'resume_editor',
    sessionId: 'session-1',
    messageId: 'message-1',
    resumeId: 'resume-1',
    masterId: 'target-master',
    draft,
    createdAt: 1780275672227,
  });
});

test('rejects draft jump state when target master conflicts with context', async () => {
  const { buildResumeEditorDraftJumpState } = await importAssistantDraftApplyUtils();

  assert.throws(
    () => buildResumeEditorDraftJumpState({
      sessionId: 'session-1',
      messageId: 'message-1',
      context: { resumeId: 'resume-1', masterId: 'context-master' },
      draft: buildExperienceDraft({ targetMasterId: 'target-master' }),
      createdAt: 1780275672227,
    }),
    /AI 草稿目标经历与当前编辑上下文不一致/
  );
});
