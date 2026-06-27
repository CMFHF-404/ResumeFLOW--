import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('assistant supports editor sidebar surface and full-page session handoff', () => {
  const assistant = read('views/AIAssistant.tsx');
  const types = read('views/AIAssistant/types.ts');
  const draftPanel = read('views/AIAssistant/AssistantDraftPanel.tsx');
  const draftState = read('views/AIAssistant/useAssistantDraftPanelState.ts');
  const app = read('App.tsx');
  const editor = read('views/ResumeEditor/index.tsx');

  assert.match(types, /export type AssistantOpenSessionRequest/);
  assert.match(app, /assistantOpenSessionRequest/);
  assert.match(app, /handleOpenAssistantSession/);
  assert.match(app, /pendingOpenSessionRequest=\{assistantOpenSessionRequest\}/);
  assert.match(app, /onConsumeOpenSessionRequest=\{handleConsumeAssistantOpenSessionRequest\}/);
  assert.match(editor, /onOpenAssistantSession\?: \(sessionId: string\) => void/);
  assert.match(editor, /onExpandToFullPage=\{handleExpandAssistantSidebar\}/);
  assert.match(editor, /const assistantSidebarSelectedResume = useMemo/);
  assert.match(editor, /snapshot: selectedResumeSnapshot/);
  assert.match(editor, /liveSelectedResume=\{assistantSidebarSelectedResume\}/);

  assert.match(assistant, /surface\?: 'full' \| 'sidebar'/);
  assert.match(assistant, /liveSelectedResume\?: AssistantSelectedResume \| null/);
  assert.match(assistant, /const isSidebarSurface = surface === 'sidebar'/);
  assert.match(assistant, /normalizeSelectedResume\(liveSelectedResume\)/);
  assert.match(assistant, /!isSidebarSurface \|\| !isAuthenticated \|\| selectedSessionId/);
  assert.match(assistant, /prefillResume: normalizedLiveSelectedResume \?\? undefined/);
  assert.match(assistant, /pendingOpenSessionRequest/);
  assert.match(assistant, /suppressAutoSelectSessionRef\.current = true/);
  assert.match(assistant, /setSelectedSessionId\(sessionId\)/);
  assert.match(assistant, /loadSessionDetail\(sessionId\)/);
  assert.match(assistant, /!isSidebarSurface \? \(\s*<AssistantHistoryPanel/);
  assert.match(assistant, /<Maximize2/);
  assert.doesNotMatch(assistant, /你的AI求职助手/);
  assert.doesNotMatch(assistant, /<Bot className="h-5 w-5" \/>/);
  assert.doesNotMatch(assistant, /shrink-0 border-b border-slate-200\/90 bg-white\/95 px-4 py-3 backdrop-blur/);
  assert.match(assistant, /pointer-events-none absolute right-3 top-3 z-20 flex items-center gap-1/);
  assert.match(assistant, /pointer-events-auto inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400\/50 dark:text-slate-400 dark:hover:text-white/);
  assert.doesNotMatch(assistant, /bg-slate-100 text-slate-600 transition hover:bg-slate-200/);
  assert.match(assistant, /surface=\{isSidebarSurface \? 'sidebar' : 'mobile'\}/);
  assert.match(assistant, /hideSelectedResumeCard=\{isSidebarSurface\}/);
  assert.doesNotMatch(assistant, /onSelectResumeExperiences/);
  assert.match(assistant, /hasContextItems=\{composerAttachments\.length > 0 \|\| Boolean\(selectedResume\)\}/);
  assert.doesNotMatch(assistant, /selectedExperiences=\{selectedExperiences\}/);
  assert.doesNotMatch(assistant, /key: 'pick-experience'/);
  assert.doesNotMatch(assistant, /label: '选择经历'/);
  assert.match(assistant, /!isSidebarSurface \? \(\s*<AssistantDesktopDraftPanel/);

  assert.match(draftPanel, /surface\?: 'mobile' \| 'sidebar'/);
  assert.match(draftPanel, /surface === 'sidebar' \? 'mb-2' : 'mb-2 md:hidden'/);
  assert.match(draftPanel, /versionState=\{getDraftVersionState\(surface\)\}/);
  assert.match(draftState, /export type DraftSurface = 'desktop' \| 'mobile' \| 'sidebar'/);
  assert.match(draftState, /surface !== 'desktop'/);
});
