import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import { build } from 'esbuild';

const read = (path) => readFileSync(path, 'utf8');

const importCardUtils = async () => {
  const result = await build({
    entryPoints: ['views/ExperienceSection/cardDataUtils.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const source = result.outputFiles[0].text;
  const encoded = Buffer.from(source).toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
};

test('new temporary experience cards default to simple edit mode', () => {
  const source = read('views/ExperienceSection/experienceActions.ts');

  assert.match(source, /editMode:\s*['"]simple['"]/);
  assert.match(source, /simpleText:\s*['"]['"]/);
});

test('persisted experience cards default to expert edit mode', async () => {
  const { buildExperienceCardData } = await importCardUtils();

  const card = buildExperienceCardData({
    master: { id: 'exp-1', category: 'work', is_archived: false },
    latest_version: {
      id: 'ver-1',
      title: '产品经理',
      org: '原子简历',
      start_date: '2026-01-01',
      end_date: '',
      star: { s: '情境', t: '任务', a: '行动', r: '结果' },
    },
  });

  assert.equal(card.editMode, 'expert');
  assert.equal(card.simpleText, '');
});

test('formal experience save still blocks blank titles on the frontend', () => {
  const source = read('views/ExperienceSection/experienceActions.ts');
  const modelSource = read('views/ExperienceSection/model.ts');

  assert.match(modelSource, /emptyTitleError,\s*toast/);
  assert.match(source, /emptyTitleError/);
  assert.match(source, /!data\.title\s*\|\|\s*!data\.title\.trim\(\)/);
  assert.match(source, /toast\.error\(emptyTitleError\)/);
});

test('experience section wires server draft load and autosave services', () => {
  const modelSource = read('views/ExperienceSection/model.ts');
  const serviceSource = read('services/experienceDraftService.ts');

  assert.match(modelSource, /experienceDraftService\.list/);
  assert.match(modelSource, /experienceDraftService\.upsert/);
  assert.match(modelSource, /experienceDraftService\.delete/);
  assert.match(serviceSource, /\/api\/experience-drafts/);
});

test('formal list refresh preserves local draft and temp cards', async () => {
  const { mergeFormalAndLocalExperiences } = await importCardUtils();
  const refreshedFormalItems = [
    { master: { id: 'exp-1', category: 'work', is_archived: false }, latest_version: { id: 'v1', title: '正式经历' } },
  ];
  const currentItems = [
    { master: { id: 'draft_draft-1', category: 'work', is_archived: false }, latest_version: { id: 'draft_draft-1', title: '草稿' } },
    { master: { id: 'temp_1', category: 'work', is_archived: false }, latest_version: { id: 'temp_1', title: '临时' } },
    { master: { id: 'exp-old', category: 'work', is_archived: false }, latest_version: { id: 'old', title: '旧正式经历' } },
  ];

  const result = mergeFormalAndLocalExperiences(refreshedFormalItems, currentItems);

  assert.deepEqual(result.map((item) => item.master.id), ['draft_draft-1', 'temp_1', 'exp-1']);
});

test('draft cards are deleted through the draft service instead of the formal experience API', () => {
  const source = read('views/ExperienceSection/experienceActions.ts');

  assert.match(
    source,
    /if \(isTempId\(cardId\) \|\| cardId\.startsWith\(['"]draft_['"]\)\) \{[\s\S]*experienceDraftService\.delete\(draftId\)[\s\S]*return;[\s\S]*\}/
  );
  assert.match(source, /await experienceService\.delete\(cardId\);/);
});

test('formalized draft creation waits for draft cleanup and surfaces cleanup failure', () => {
  const source = read('views/ExperienceSection/experienceActions.ts');

  assert.match(source, /await experienceDraftService\.delete\(data\.draftId\)/);
  assert.match(source, /草稿清理失败/);
  assert.doesNotMatch(source, /experienceDraftService\.delete\(data\.draftId\)\.catch/);
});

test('formalizing simple entries waits for any in-flight draft autosave before creating', () => {
  const source = read('views/ExperienceSection/model.ts');

  assert.match(source, /draftSaveRequestsRef/);
  assert.match(source, /flushDraftSave\(cardId\)/);
  assert.match(source, /const flushedDraft = await flushDraftSave\(cardId\)/);
  assert.match(source, /await handleSaveCard\(cardId, \{[\s\S]*\.\.\.nextData[\s\S]*draftId: flushedDraft\?\.draftId \?\? nextData\.draftId/);
});

test('formalizing simple entries validates title before AI splitting', () => {
  const source = read('views/ExperienceSection/model.ts');

  assert.match(
    source,
    /if \(!data\.title \|\| !data\.title\.trim\(\)\) \{[\s\S]*toast\.error\(emptyTitleError\);[\s\S]*return;[\s\S]*\}[\s\S]*const localResult = parseSimpleExperienceText/
  );
});

test('formalizing simple entries disables the card before AI splitting returns', () => {
  const source = read('views/ExperienceSection/model.ts');
  const cardSource = read('views/ExperienceCard.tsx');

  assert.match(source, /const \[formalizingCardId, setFormalizingCardId\] = useState<string \| null>\(null\)/);
  assert.match(source, /savingCardId === cardId \|\| formalizingCardId === cardId/);
  assert.match(
    source,
    /setFormalizingCardId\(cardId\);[\s\S]*const localResult = parseSimpleExperienceText/
  );
  assert.match(
    source,
    /isCardBusy:\s*\(cardId\) => savingCardId === cardId \|\| formalizingCardId === cardId/
  );
  assert.match(
    source,
    /setFormalizingCardId\(\(current\) => current === cardId \? null : current\)/
  );
  assert.match(cardSource, /isLocked=\{isSaving\}/);
  assert.match(cardSource, /disabled=\{isLocked\}/);
  assert.match(cardSource, /disabled=\{isSaving\}/);
});

test('draft autosaves for the same card are serialized to avoid stale overwrites', () => {
  const source = read('views/ExperienceSection/model.ts');

  assert.match(source, /draftSaveQueueRef/);
  assert.match(source, /const previousSave = draftSaveQueueRef\.current\.get\(cardId\) \?\? Promise\.resolve\(\)/);
  assert.match(source, /previousSave[\s\S]*\.then\(\(\) => \{[\s\S]*experienceDraftService\.upsert/);
  assert.match(source, /draftSaveQueueRef\.current\.set\(cardId, saveRequest\)/);
});

test('discarding draft cards invalidates queued autosaves before they can recreate drafts', () => {
  const modelSource = read('views/ExperienceSection/model.ts');
  const actionsSource = read('views/ExperienceSection/experienceActions.ts');

  assert.match(modelSource, /latestSavedDraftsRef/);
  assert.match(modelSource, /latestSavedDraftsRef\.current\.set\(cardId, saved\)/);
  assert.match(modelSource, /return saved \?\? latestSavedDraftsRef\.current\.get\(cardId\) \?\? null/);
  assert.match(modelSource, /invalidatedDraftSaveCardsRef/);
  assert.match(modelSource, /invalidatedDraftSaveCardsRef\.current\.add\(cardId\)/);
  assert.match(modelSource, /if \(invalidatedDraftSaveCardsRef\.current\.has\(cardId\)\) \{[\s\S]*return null;[\s\S]*\}/);
  assert.match(modelSource, /onBeforeRemoveLocal: discardDraftAutosave/);
  assert.match(actionsSource, /const discardedDraft = await onBeforeRemoveLocal\?\.\(cardId\) \?\? null/);
  assert.match(actionsSource, /const draftId = discardedDraft\?\.id \?\? cardData\.get\(cardId\)\?\.draftId/);
  assert.match(
    actionsSource,
    /if \(isTempId\(cardId\) \|\| cardId\.startsWith\(['"]draft_['"]\)\) \{[\s\S]*const draftId = discardedDraft\?\.id \?\? cardData\.get\(cardId\)\?\.draftId[\s\S]*experienceDraftService\.delete\(draftId\)[\s\S]*return;[\s\S]*\}/
  );
});

test('canceling unsaved draft cards keeps local state when server draft deletion fails', () => {
  const source = read('views/ExperienceSection/model.ts');

  assert.match(source, /const handleCancel = useCallback\(async \(cardId: string\) => \{/);
  assert.match(
    source,
    /if \(isTempId\(cardId\) \|\| cardId\.startsWith\(['"]draft_['"]\)\) \{[\s\S]*await discardDraftAutosave\(cardId\)[\s\S]*await experienceDraftService\.delete\(draftId\)[\s\S]*catch \(error\) \{[\s\S]*toast\.error\(['"]草稿删除失败，请重试['"]/
  );
  assert.match(
    source,
    /toast\.error\(['"]草稿删除失败，请重试['"][\s\S]*return;[\s\S]*setExperiences\(prev => prev\.filter/
  );
});

test('formalizing lock is evaluated per card instead of through one saving id', () => {
  const modelSource = read('views/ExperienceSection/model.ts');
  const typeSource = read('views/ExperienceSection/types.ts');
  const viewSource = read('views/ExperienceSection/ExperienceSectionView.tsx');

  assert.match(typeSource, /isCardBusy: \(cardId: string\) => boolean/);
  assert.match(modelSource, /isCardBusy:\s*\(cardId\) => savingCardId === cardId \|\| formalizingCardId === cardId/);
  assert.match(viewSource, /isSaving=\{model\.isCardBusy\(cardId\)\}/);
  assert.doesNotMatch(modelSource, /savingCardId:\s*savingCardId \?\? formalizingCardId/);
});

test('formalizing one card blocks starting a second formalize request', () => {
  const source = read('views/ExperienceSection/model.ts');

  assert.match(
    source,
    /if \(!data \|\| savingCardId === cardId \|\| formalizingCardId === cardId \|\| formalizingCardIdRef\.current\) \{[\s\S]*return;[\s\S]*\}/
  );
  assert.match(source, /formalizingCardIdRef\.current = cardId/);
});

test('confirm delete waits for draft delete before removing local draft cards', () => {
  const source = read('views/ExperienceSection/experienceActions.ts');

  assert.match(
    source,
    /if \(isTempId\(cardId\) \|\| cardId\.startsWith\(['"]draft_['"]\)\) \{[\s\S]*const draftId = discardedDraft\?\.id \?\? cardData\.get\(cardId\)\?\.draftId[\s\S]*await experienceDraftService\.delete\(draftId\)[\s\S]*setExperiences\(\(prev\) => prev\.filter/
  );
  assert.doesNotMatch(
    source,
    /setExperiences\(\(prev\) => prev\.filter\(\(item\) => item\.master\.id !== cardId\)\);[\s\S]*if \(isTempId\(cardId\)/
  );
});
