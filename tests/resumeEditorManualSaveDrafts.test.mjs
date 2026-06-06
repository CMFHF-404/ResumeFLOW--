import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import { build } from 'esbuild';

const importManualSaveDrafts = async () => {
  const result = await build({
    entryPoints: ['views/ResumeEditor/hooks/useResumeEditorManualSaveDrafts.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const source = result.outputFiles[0].text;
  const encoded = Buffer.from(source).toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
};

const buildPendingDraft = (overrides = {}) => ({
  source: 'resume_editor',
  sessionId: 'session-1',
  messageId: 'message-1',
  resumeId: 'resume-1',
  masterId: 'master-1',
  draft: {
    title: 'Title',
    company: 'Org',
    startDate: '2026-01',
    endDate: '',
    isCurrent: true,
    star: {
      s: 'S',
      t: 'T',
      a: 'A',
      r: 'R',
    },
  },
  createdAt: 1780275672227,
  ...overrides,
});

test('selects the first resume editor manual-save draft whose target still exists', async () => {
  const { selectResumeEditorManualSaveDrafts } = await importManualSaveDrafts();
  const staleDraft = buildPendingDraft({ messageId: 'stale', masterId: 'missing-master' });
  const firstValidDraft = buildPendingDraft({ messageId: 'valid-1', masterId: 'master-1' });
  const secondValidDraft = buildPendingDraft({ messageId: 'valid-2', masterId: 'master-2' });
  const assistantDraft = buildPendingDraft({
    source: 'experience_bank',
    messageId: 'ignored-source',
    masterId: 'master-3',
  });

  const result = selectResumeEditorManualSaveDrafts(
    [staleDraft, firstValidDraft, secondValidDraft, assistantDraft],
    [{ id: 'master-1' }, { id: 'master-2' }, { id: 'master-3' }],
  );

  assert.equal(result.pendingManualSaveDraft, firstValidDraft);
  assert.deepEqual(result.staleManualSaveDrafts, [staleDraft]);
});

test('returns only stale drafts when no resume editor draft target exists', async () => {
  const { selectResumeEditorManualSaveDrafts } = await importManualSaveDrafts();
  const staleDraftA = buildPendingDraft({ messageId: 'stale-a', masterId: 'missing-a' });
  const staleDraftB = buildPendingDraft({ messageId: 'stale-b', masterId: 'missing-b' });

  const result = selectResumeEditorManualSaveDrafts(
    [staleDraftA, staleDraftB],
    [{ id: 'other-master' }],
  );

  assert.equal(result.pendingManualSaveDraft, null);
  assert.deepEqual(result.staleManualSaveDrafts, [staleDraftA, staleDraftB]);
});

test('manual-save draft action starts editing before applying a new target', async () => {
  const { resolveResumeEditorManualSaveDraftAction } = await importManualSaveDrafts();
  const pendingManualSaveDraft = buildPendingDraft({ masterId: 'master-1' });

  assert.equal(
    resolveResumeEditorManualSaveDraftAction({
      pendingManualSaveDraft,
      draftKey: 'draft-key',
      appliedManualSaveDraftKey: null,
      editingExpId: null,
      editingDraftMasterId: null,
    }),
    'start-editing',
  );
});

test('manual-save draft action skips already applied draft keys', async () => {
  const { resolveResumeEditorManualSaveDraftAction } = await importManualSaveDrafts();
  const pendingManualSaveDraft = buildPendingDraft({ masterId: 'master-1' });

  assert.equal(
    resolveResumeEditorManualSaveDraftAction({
      pendingManualSaveDraft,
      draftKey: 'draft-key',
      appliedManualSaveDraftKey: 'draft-key',
      editingExpId: 'master-1',
      editingDraftMasterId: 'master-1',
    }),
    'skip',
  );
});

test('manual-save draft action applies when target is already being edited once', async () => {
  const { resolveResumeEditorManualSaveDraftAction } = await importManualSaveDrafts();
  const pendingManualSaveDraft = buildPendingDraft({ masterId: 'master-1' });

  assert.equal(
    resolveResumeEditorManualSaveDraftAction({
      pendingManualSaveDraft,
      draftKey: 'draft-key',
      appliedManualSaveDraftKey: null,
      editingExpId: 'master-1',
      editingDraftMasterId: 'master-1',
    }),
    'apply-draft',
  );
});
