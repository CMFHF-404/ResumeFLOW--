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

  assert.match(assistant, /surface\?: 'full' \| 'sidebar'/);
  assert.match(assistant, /const isSidebarSurface = surface === 'sidebar'/);
  assert.match(assistant, /pendingOpenSessionRequest/);
  assert.match(assistant, /suppressAutoSelectSessionRef\.current = true/);
  assert.match(assistant, /setSelectedSessionId\(sessionId\)/);
  assert.match(assistant, /loadSessionDetail\(sessionId\)/);
  assert.match(assistant, /!isSidebarSurface \? \(\s*<AssistantHistoryPanel/);
  assert.match(assistant, /<Maximize2/);
  assert.match(assistant, /surface=\{isSidebarSurface \? 'sidebar' : 'mobile'\}/);
  assert.match(assistant, /!isSidebarSurface \? \(\s*<AssistantDesktopDraftPanel/);

  assert.match(draftPanel, /surface\?: 'mobile' \| 'sidebar'/);
  assert.match(draftPanel, /surface === 'sidebar' \? 'mb-2' : 'mb-2 md:hidden'/);
  assert.match(draftPanel, /versionState=\{getDraftVersionState\(surface\)\}/);
  assert.match(draftState, /export type DraftSurface = 'desktop' \| 'mobile' \| 'sidebar'/);
  assert.match(draftState, /surface !== 'desktop'/);
});
