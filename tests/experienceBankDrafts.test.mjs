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

test('persisted and saved expert cards preserve adjacent duplicate STAR text', async () => {
  const { buildExperienceCardData, buildVersionPayload } = await importCardUtils();
  const task = '独立负责防窜货风控模块的从0到1设计与落地。';
  const duplicateTask = `${task} ${task}`;

  const card = buildExperienceCardData({
    master: { id: 'exp-1', category: 'work', is_archived: false },
    latest_version: {
      id: 'ver-1',
      title: '产品助理',
      org: '原子简历',
      star: {
        s: '情境',
        t: duplicateTask,
        a: '行动',
        r: '结果',
      },
    },
  });

  assert.equal(card.star.t, duplicateTask);
  assert.equal(buildVersionPayload(card).star.t, duplicateTask);
});

test('formal experience save still blocks blank titles on the frontend', () => {
  const source = read('views/ExperienceSection/experienceActions.ts');
  const modelSource = read('views/ExperienceSection/model.ts');

  assert.match(modelSource, /titleRequired\s*=\s*true/);
  assert.match(modelSource, /emptyTitleError,\s*titleRequired,\s*toast/);
  assert.match(source, /emptyTitleError/);
  assert.match(source, /titleRequired && \(!data\.title\s*\|\|\s*!data\.title\.trim\(\)\)/);
  assert.match(source, /toast\.error\(emptyTitleError\)/);
});

test('project experience role is optional while work titles remain required', () => {
  const bankSource = read('views/ExperienceBank.tsx');
  const typeSource = read('views/ExperienceSection/types.ts');

  const workSection = bankSource.match(/<ExperienceSection\s*category="work"[\s\S]*?\/>/)?.[0] ?? '';
  const projectSection = bankSource.match(/<ExperienceSection\s*category="project"[\s\S]*?onCountChange=\{setProjectExperienceCount\}/)?.[0] ?? '';

  assert.match(typeSource, /titleRequired\?: boolean/);
  assert.doesNotMatch(workSection, /titleRequired=\{false\}/);
  assert.match(projectSection, /titleRequired=\{false\}/);
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

test('previewing simple entries switches to STAR without immediately saving', () => {
  const source = read('views/ExperienceSection/model.ts');
  const previewBlock = source.match(
    /const handlePreviewSimpleEntry = useCallback[\s\S]*?\n  const handleCancel = useCallback/
  )?.[0] ?? '';

  assert.match(source, /const handlePreviewSimpleEntry = useCallback\(async \(cardId: string\) => \{/);
  assert.match(source, /editMode:\s*['"]expert['"]/);
  assert.match(source, /updateCardData\(cardId, nextData\)/);
  assert.doesNotMatch(previewBlock, /const flushedDraft = await flushDraftSave\(cardId\)/);
  assert.doesNotMatch(previewBlock, /await (?:handleSaveCard|saveExperienceCard)\(cardId, \{/);
});

test('saving a previewed local draft flushes queued draft autosave before formal creation', () => {
  const source = read('views/ExperienceSection/model.ts');

  assert.match(source, /const \{ savingCardId, handleSaveCard: saveExperienceCard \} = useExperienceSave\(/);
  assert.match(source, /const handleSaveCard = useCallback\(async \(cardId: string\) => \{/);
  assert.match(
    source,
    /if \(isTempId\(cardId\) \|\| cardId\.startsWith\(['"]draft_['"]\)\) \{[\s\S]*const flushedDraft = await flushDraftSave\(cardId\)/
  );
  assert.match(
    source,
    /await saveExperienceCard\(cardId, \{[\s\S]*\.\.\.data[\s\S]*draftId: flushedDraft\?\.draftId \?\? data\.draftId[\s\S]*clientDraftKey: flushedDraft\?\.clientDraftKey \?\? data\.clientDraftKey/
  );
});

test('saving a previewed local draft with blank title keeps queued autosave intact', () => {
  const source = read('views/ExperienceSection/model.ts');
  const saveBlock = source.match(
    /const handleSaveCard = useCallback\(async \(cardId: string\) => \{[\s\S]*?\n  \}, \[flushDraftSave/
  )?.[0] ?? '';

  assert.match(
    saveBlock,
    /if \(titleRequired && \(isTempId\(cardId\) \|\| cardId\.startsWith\(['"]draft_['"]\)\) && \(!data\.title \|\| !data\.title\.trim\(\)\)\) \{[\s\S]*await saveExperienceCard\(cardId\);[\s\S]*return;[\s\S]*\}[\s\S]*const flushedDraft = await flushDraftSave\(cardId\)/
  );
});

test('previewing simple entries does not require a title before parsing', () => {
  const source = read('views/ExperienceSection/model.ts');

  assert.doesNotMatch(
    source,
    /if \(!data\.title \|\| !data\.title\.trim\(\)\) \{[\s\S]*toast\.error\(emptyTitleError\);[\s\S]*return;[\s\S]*\}[\s\S]*const localResult = parseSimpleExperienceText/
  );
  assert.match(source, /const localResult = parseSimpleExperienceText\(data\.simpleText \|\| ''\)/);
});

test('previewing simple entries disables the card before AI splitting returns', () => {
  const source = read('views/ExperienceSection/model.ts');
  const cardSource = read('views/ExperienceCard.tsx');

  assert.match(source, /const \[previewingCardId, setPreviewingCardId\] = useState<string \| null>\(null\)/);
  assert.match(source, /savingCardId === cardId \|\| previewingCardId === cardId/);
  assert.match(
    source,
    /setPreviewingCardId\(cardId\);[\s\S]*const localResult = parseSimpleExperienceText/
  );
  assert.match(
    source,
    /isCardBusy:\s*\(cardId\) => savingCardId === cardId \|\| previewingCardId === cardId/
  );
  assert.match(
    source,
    /setPreviewingCardId\(\(current\) => current === cardId \? null : current\)/
  );
  assert.match(cardSource, /isLocked=\{isSaving\}/);
  assert.match(cardSource, /disabled=\{isLocked\}/);
  assert.match(cardSource, /disabled=\{isSaving\}/);
});

test('previewing simple entries shows parsing affordances in the card UI', () => {
  const cardSource = read('views/ExperienceCard.tsx');
  const htmlSource = read('index.html');

  assert.match(cardSource, /isProcessingSimpleEntry/);
  assert.match(cardSource, /解析中\.\.\./);
  assert.match(cardSource, /预览 STAR/);
  assert.match(cardSource, /simple-parsing-flow/);
  assert.match(htmlSource, /@keyframes simpleParsingGlow/);
  assert.match(htmlSource, /simpleParsingShimmer/);
  assert.match(cardSource, /AI 会智能介入解析/);
});

test('A action field shows gray unordered bullet cues and alone enables list editing', () => {
  const cardSource = read('views/ExperienceCard.tsx');
  const htmlSource = read('index.html');

  assert.match(cardSource, /section\.id === ['"]a['"] \? ['"]star-action-bullet-cue['"] : ['"]['"]/);
  assert.match(cardSource, /enableList=\{section\.id === ['"]a['"]\}/);
  assert.match(cardSource, /showLineBulletCue=\{section\.id === ['"]a['"]\}/);
  const richTextEditorSource = read('components/RichTextEditor.tsx');
  assert.match(richTextEditorSource, /measurePlainLineBulletTops/);
  assert.match(richTextEditorSource, /measureCaretBulletTop/);
  assert.match(richTextEditorSource, /inferLineBulletTop/);
  assert.match(richTextEditorSource, /includeCaretLine/);
  assert.match(richTextEditorSource, /measuredLineTops/);
  assert.match(richTextEditorSource, /document\.activeElement === editor/);
  assert.match(htmlSource, /\.rich-text-line-bullet-cue-dot/);
  assert.match(htmlSource, /\.star-action-bullet-cue li::marker/);
  assert.doesNotMatch(htmlSource, /\.star-action-bullet-cue\s*\{[\s\S]*background-image/);
  assert.doesNotMatch(htmlSource, /\.star-action-bullet-cue\s*\{[\s\S]*repeat-y/);
});

test('mode tabs align on the right and wire fold-expand transition classes', () => {
  const cardSource = read('views/ExperienceCard.tsx');
  const htmlSource = read('index.html');

  assert.match(cardSource, /const modeTabs = \(/);
  assert.match(cardSource, /modeTabs\?: React\.ReactNode/);
  assert.match(cardSource, /section\.id === 's' \? modeTabs : null/);
  assert.match(cardSource, />\s*原始文本\s*</);
  assert.match(cardSource, /aria-label="切换到 STAR"/);
  assert.match(cardSource, /STAR_MODE_LETTERS\.map/);
  assert.match(
    cardSource,
    /<div className="flex flex-wrap items-center justify-between gap-3">[\s\S]*解析规则：可用 S\/T\/A\/R 标题，或用 --- 分隔情境、任务、行动、结果，也可随意填写，AI 会智能介入解析。[\s\S]*\{modeTabs\}/
  );
  assert.doesNotMatch(cardSource, /<div className="flex flex-wrap items-center gap-3">\s*\{modeTabs\}/);
  assert.match(cardSource, /star-mode-panel/);
  assert.match(cardSource, /simple-mode-panel/);
  assert.match(htmlSource, /@keyframes starPanelExpand/);
  assert.match(htmlSource, /@keyframes simplePanelFoldIn/);
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

test('previewing lock is evaluated per card instead of through one saving id', () => {
  const modelSource = read('views/ExperienceSection/model.ts');
  const typeSource = read('views/ExperienceSection/types.ts');
  const viewSource = read('views/ExperienceSection/ExperienceSectionView.tsx');

  assert.match(typeSource, /isCardBusy: \(cardId: string\) => boolean/);
  assert.match(modelSource, /isCardBusy:\s*\(cardId\) => savingCardId === cardId \|\| previewingCardId === cardId/);
  assert.match(viewSource, /isSaving=\{model\.isCardBusy\(cardId\)\}/);
  assert.doesNotMatch(modelSource, /savingCardId:\s*savingCardId \?\? previewingCardId/);
});

test('previewing one card blocks starting a second preview request', () => {
  const source = read('views/ExperienceSection/model.ts');

  assert.match(
    source,
    /if \(!data \|\| savingCardId === cardId \|\| previewingCardId === cardId \|\| previewingCardIdRef\.current\) \{[\s\S]*return;[\s\S]*\}/
  );
  assert.match(source, /previewingCardIdRef\.current = cardId/);
});

test('previewing simple entries only calls AI as fallback and caches split results', () => {
  const source = read('views/ExperienceSection/model.ts');

  assert.match(source, /splitExperienceCacheRef/);
  assert.match(source, /buildSplitExperienceCacheKey/);
  assert.match(source, /const localResult = parseSimpleExperienceText\(data\.simpleText \|\| ''\)/);
  assert.match(
    source,
    /let nextStar = localResult\.star;[\s\S]*if \(!localResult\.ok\) \{[\s\S]*splitExperienceCacheRef\.current\.get\(splitCacheKey\)[\s\S]*aiService\.splitExperienceText/
  );
  assert.doesNotMatch(
    source,
    /const localResult = parseSimpleExperienceText\(data\.simpleText \|\| ''\)[\s\S]*aiService\.splitExperienceText[\s\S]*if \(!localResult\.ok\)/
  );
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
