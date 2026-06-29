import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('JD analysis details open in the editor right sidebar on desktop', () => {
  const panel = read('views/ResumeEditor/components/JDAnalysisPanel.tsx');
  const editor = read('views/ResumeEditor/index.tsx');
  const workspace = read('views/ResumeEditor/components/ResumeEditorDesktopWorkspace.tsx');

  assert.match(panel, /export const JDAnalysisDetailsSidebar/);
  assert.match(panel, /onOpenDetailsSidebar\?: \(\) => void/);
  assert.match(panel, /const handleOpenDetails = useCallback\(\(\) => \{/);
  assert.match(panel, /if \(onOpenDetailsSidebar\) \{[\s\S]*onOpenDetailsSidebar\(\);[\s\S]*return;[\s\S]*setIsDetailsModalOpen\(true\)/);
  assert.match(panel, /onClick=\{handleOpenDetails\}/);
  assert.doesNotMatch(panel, /onClick=\{\(\) => setIsDetailsModalOpen\(true\)\}/);
  assert.match(panel, /aria-labelledby="jd-analysis-details-sidebar-title"/);
  assert.doesNotMatch(panel, /onOpenAssistantSidebar/);
  assert.doesNotMatch(panel, /aria-label="返回 AI 助手"/);
  assert.doesNotMatch(panel, /<Sparkles className="h-4 w-4" \/>/);
  const detailsSidebarHeader = panel.match(
    /aria-labelledby="jd-analysis-details-sidebar-title"[\s\S]*?<div className="min-h-0 flex-1 overflow-y-auto/
  )?.[0] ?? '';
  assert.match(detailsSidebarHeader, /aria-label="关闭 JD 分析详情"/);
  assert.match(detailsSidebarHeader, /onClick=\{handleClose\}/);
  assert.doesNotMatch(detailsSidebarHeader, /onClick=\{handleOpenAssistantSidebar\}/);

  assert.match(editor, /import \{ JDAnalysisDetailsSidebar \} from '\.\/components\/JDAnalysisPanel'/);
  assert.match(editor, /const \[isJDAnalysisDetailsSidebarOpen, setIsJDAnalysisDetailsSidebarOpen\] = useState\(false\)/);
  assert.match(editor, /const handleOpenJDAnalysisDetailsSidebar = useCallback\(\(\) => \{/);
  assert.match(editor, /setIsJDAnalysisDetailsSidebarOpen\(true\)/);
  const openDetailsHandler = editor.match(
    /const handleOpenJDAnalysisDetailsSidebar = useCallback\(\(\) => \{[\s\S]*?\}, \[analysisResult\]\);/
  )?.[0] ?? '';
  assert.doesNotMatch(openDetailsHandler, /setIsAssistantSidebarOpen\(false\)/);
  assert.doesNotMatch(editor, /handleReturnToAssistantSidebar/);
  const closeDetailsHandler = editor.match(
    /const handleCloseJDAnalysisDetailsSidebar = useCallback\(\(\) => \{[\s\S]*?\}, \[\]\);/
  )?.[0] ?? '';
  assert.match(closeDetailsHandler, /setIsJDAnalysisDetailsSidebarOpen\(false\)/);
  assert.doesNotMatch(closeDetailsHandler, /handleToggleResumeAssistantSidebar/);
  assert.doesNotMatch(closeDetailsHandler, /handleReturnToAssistantSidebar/);
  assert.match(editor, /onOpenDetailsSidebar: handleOpenJDAnalysisDetailsSidebar/);
  assert.match(editor, /onOpenAnalysisDetails=\{analysisResult \? handleOpenJDAnalysisDetailsSidebar : undefined\}/);
  assert.match(editor, /const isRightSidebarOpen = isAssistantSidebarOpen \|\| isJDAnalysisDetailsSidebarOpen/);
  assert.match(editor, /const rightSidebarContent = isRightSidebarOpen \? \(/);
  assert.match(editor, /relative h-full min-h-0 w-full overflow-hidden bg-white dark:bg-slate-950/);
  assert.match(editor, /aria-hidden=\{isJDAnalysisDetailsSidebarOpen\}/);
  assert.match(editor, /inert=\{isJDAnalysisDetailsSidebarOpen \? true : undefined\}/);
  assert.match(editor, /isJDAnalysisDetailsSidebarOpen\s*\?\s*'-translate-y-4'[\s\S]*:\s*'translate-y-0'/);
  assert.match(editor, /aria-hidden=\{!isJDAnalysisDetailsSidebarOpen\}/);
  assert.match(editor, /inert=\{!isJDAnalysisDetailsSidebarOpen \? true : undefined\}/);
  assert.match(editor, /isJDAnalysisDetailsSidebarOpen\s*\?\s*'translate-y-0'[\s\S]*:\s*'translate-y-full pointer-events-none'/);
  assert.match(editor, /<JDAnalysisDetailsSidebar/);
  assert.match(editor, /onClose=\{handleCloseJDAnalysisDetailsSidebar\}/);
  assert.doesNotMatch(editor, /onOpenAssistantSidebar=\{handleReturnToAssistantSidebar\}/);
  assert.match(editor, /isAssistantSidebarOpen=\{isRightSidebarOpen\}/);
  assert.match(editor, /assistantSidebar=\{rightSidebarContent\}/);

  assert.match(workspace, /assistantSidebar\?: React\.ReactNode/);
  assert.match(workspace, /isAssistantSidebarOpen\?: boolean/);
});

test('JD analysis panel uses supported Tailwind CDN utilities', () => {
  const panel = read('views/ResumeEditor/components/JDAnalysisPanel.tsx');
  const unsupportedUtilityClasses = [
    'text-red-650',
    'from-amber-450',
  ];

  for (const utilityClass of unsupportedUtilityClasses) {
    const pattern = new RegExp(`\\b${utilityClass}\\b`);
    assert.doesNotMatch(panel, pattern, `${utilityClass} should not be used in JDAnalysisPanel`);
  }
});
