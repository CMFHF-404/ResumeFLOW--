import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('ExperienceBank hosts desktop assistant sidebar and falls back to full-page assistant on mobile', () => {
  const app = read('App.tsx');
  const bank = read('views/ExperienceBank.tsx');

  const experienceBankRoute = app.match(/<ExperienceBank[\s\S]*?\/>/)?.[0] ?? '';
  assert.match(experienceBankRoute, /onLaunchAssistant=\{handleLaunchAssistant\}/);
  assert.match(experienceBankRoute, /onOpenAssistantSession=\{handleOpenAssistantSession\}/);
  assert.match(experienceBankRoute, /onJumpToResumeEditor=\{handleJumpToResumeEditor\}/);

  assert.match(bank, /import AIAssistant from '\.\/AIAssistant'/);
  assert.match(bank, /const EXPERIENCE_BANK_ASSISTANT_SIDEBAR_WIDTH = '390px'/);
  assert.match(bank, /const EXPERIENCE_BANK_DESKTOP_ASSISTANT_MEDIA_QUERY = '\(min-width: 768px\)'/);
  assert.match(bank, /const buildExperienceBankAssistantRequest = \(\): AssistantLaunchRequest => \(\{/);
  const headerAssistantRequest = bank.match(/const buildExperienceBankAssistantRequest = \(\): AssistantLaunchRequest => \(\{[\s\S]*?\n\}\);/)?.[0] ?? '';
  assert.match(headerAssistantRequest, /entrySource: 'direct'/);
  assert.match(bank, /title: '经历库 · AI 助手'/);
  assert.match(bank, /origin: 'experience_bank_header'/);
  assert.match(bank, /const \[isAssistantSidebarOpen, setIsAssistantSidebarOpen\] = useState\(false\)/);
  assert.match(bank, /const \[assistantSidebarLaunchRequest, setAssistantSidebarLaunchRequest\] = useState<AssistantLaunchRequest \| null>\(null\)/);
  assert.match(bank, /assistantSidebarLaunchRequestIdRef = useRef\(0\)/);
  assert.match(bank, /window\.matchMedia\(EXPERIENCE_BANK_DESKTOP_ASSISTANT_MEDIA_QUERY\)\.matches/);
  assert.match(bank, /if \(!shouldOpenSidebar\) \{[\s\S]*onLaunchAssistant\?\.\(request\);[\s\S]*return;[\s\S]*\}/);
  assert.match(bank, /requestId: `experience-bank-sidebar-launch-\$\{assistantSidebarLaunchRequestIdRef\.current\}`/);
  assert.match(bank, /setIsAssistantSidebarOpen\(true\)/);
  assert.match(bank, /const handleExpandAssistantSidebar = useCallback\(\(sessionId\?: string \| null\) => \{/);
  const expandSidebarHandler = bank.match(/const handleExpandAssistantSidebar = useCallback\(\(sessionId\?: string \| null\) => \{[\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] ?? '';
  assert.match(bank, /if \(sessionId && onOpenAssistantSession\) \{[\s\S]*onOpenAssistantSession\(sessionId\);[\s\S]*return;[\s\S]*\}/);
  assert.match(expandSidebarHandler, /onLaunchAssistant\?\.\(buildExperienceBankAssistantRequest\(\)\)/);
  assert.match(bank, /<AIAssistant\s+surface="sidebar"/);
  assert.match(bank, /pendingLaunchRequest=\{assistantSidebarLaunchRequest\}/);
  assert.match(bank, /onConsumeLaunchRequest=\{handleConsumeAssistantSidebarLaunchRequest\}/);
  assert.match(bank, /onClose=\{handleCloseAssistantSidebar\}/);
  assert.match(bank, /onExpandToFullPage=\{handleExpandAssistantSidebar\}/);
  assert.match(bank, /onJumpToResumeEditor=\{onJumpToResumeEditor\}/);
  assert.match(bank, /onJumpToExperienceBank=\{handleAssistantJumpToExperienceBank\}/);
  assert.match(bank, /onAppliedDraftNavigation=\{handleAssistantDraftAppliedNavigation\}/);
  assert.match(bank, /data-experience-bank-assistant-sidebar/);
  assert.match(bank, /if \(isAssistantSidebarOpen\) \{[\s\S]*handleCloseAssistantSidebar\(\);[\s\S]*return;[\s\S]*\}/);
  assert.match(bank, /onClick=\{\(\) => void handleLaunchHeaderAssistant\(\)\}/);
  assert.match(bank, /const assistantHeaderButtonLabel = isAssistantSidebarOpen \? '关闭 AI 助手' : '打开 AI 助手'/);
  assert.match(bank, /title=\{assistantHeaderButtonLabel\}/);
  assert.match(bank, /aria-label=\{assistantHeaderButtonLabel\}/);
  assert.match(bank, /<Bot className="h-4 w-4" \/>[\s\S]*<span className="sr-only">\{assistantHeaderButtonLabel\}<\/span>/);
  assert.match(
    bank,
    /style=\{\{\s*width: isAssistantSidebarOpen \? EXPERIENCE_BANK_ASSISTANT_SIDEBAR_WIDTH : 0,\s*opacity: isAssistantSidebarOpen \? 1 : 0,\s*flexShrink: 0,\s*\}\}/
  );
  assert.doesNotMatch(bank, /setCurrentView\(ViewState\.AI_ASSISTANT\)/);
});

test('assistant draft apply can notify an embedded host about applied navigation', () => {
  const assistant = read('views/AIAssistant.tsx');
  const applyHook = read('views/AIAssistant/useAssistantDraftApplyActions.ts');

  assert.match(assistant, /onAppliedDraftNavigation\?: \(navigation: AssistantDraftApplyNavigation \| null \| undefined\) => void/);
  assert.match(assistant, /onAppliedDraftNavigation,/);
  assert.match(assistant, /useAssistantDraftApplyActions\(\{[\s\S]*onAppliedDraftNavigation,/);

  assert.match(applyHook, /onAppliedDraftNavigation\?: \(navigation: AssistantDraftApplyNavigation \| null \| undefined\) => void/);
  assert.match(applyHook, /onAppliedDraftNavigation\?\.\(updatedResponse\.navigation\)/);
});

test('ExperienceBank AI polish toolbar uses compact width and compact controls', () => {
  const card = read('views/ExperienceCard.tsx');
  const toolbar = read('components/AIPolishToolbar.tsx');

  assert.match(card, /const EXPERIENCE_BANK_POLISH_DIALOG_WIDTH = 480/);
  assert.match(card, /const EXPERIENCE_BANK_POLISH_PREVIEW_DIALOG_WIDTH = 560/);
  assert.match(card, /const EXPERIENCE_BANK_POLISH_MOBILE_DIALOG_WIDTH = 320/);
  assert.match(card, /const EXPERIENCE_BANK_POLISH_MOBILE_PREVIEW_DIALOG_WIDTH = 360/);
  assert.match(
    card,
    /const preferredWidth = isMobileViewport\s*\? \(isPolishPreviewing \? EXPERIENCE_BANK_POLISH_MOBILE_PREVIEW_DIALOG_WIDTH : EXPERIENCE_BANK_POLISH_MOBILE_DIALOG_WIDTH\)\s*: \(isPolishPreviewing \? EXPERIENCE_BANK_POLISH_PREVIEW_DIALOG_WIDTH : EXPERIENCE_BANK_POLISH_DIALOG_WIDTH\);/
  );
  assert.match(card, /<AIPolishToolbar[\s\S]*assistantButtonLabel="AI助手"[\s\S]*compact[\s\S]*className="border-0 bg-transparent p-0 shadow-none"/);
  assert.match(toolbar, /assistantButtonLabel\?: string/);
  assert.match(toolbar, /assistantButtonLabel = '智能补全'/);
  assert.match(toolbar, /\{assistantButtonLabel\}/);
  assert.doesNotMatch(card, /isPolishPreviewing \? 576 : 672/);
});

test('ExperienceBank card assistant opens chat without smart-complete prompt injection', () => {
  const polishActions = read('views/ExperienceSection/polishActions.ts');
  const handleOpenAssistant = polishActions.match(/const handleOpenAssistant = useCallback\(\(cardId: string\) => \{[\s\S]*?\n  \}, \[category, onLaunchAssistant, toast\]\);/)?.[0] ?? '';

  assert.match(handleOpenAssistant, /title: `\$\{current\.org \|\| '未命名经历'\} · AI 助手`/);
  assert.match(handleOpenAssistant, /origin: 'experience_bank_card_toolbar'/);
  assert.doesNotMatch(handleOpenAssistant, /initialSkillId: 'experience_completion'/);
  assert.doesNotMatch(handleOpenAssistant, /initialUserMessage/);
  assert.doesNotMatch(handleOpenAssistant, /buildSmartCompleteAssistantPrompt/);
  assert.doesNotMatch(polishActions, /import \{ buildSmartCompleteAssistantPrompt \}/);
});
