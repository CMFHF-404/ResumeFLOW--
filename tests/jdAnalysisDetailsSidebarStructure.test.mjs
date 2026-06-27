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

  assert.match(editor, /import \{ JDAnalysisDetailsSidebar \} from '\.\/components\/JDAnalysisPanel'/);
  assert.match(editor, /const \[isJDAnalysisDetailsSidebarOpen, setIsJDAnalysisDetailsSidebarOpen\] = useState\(false\)/);
  assert.match(editor, /const handleOpenJDAnalysisDetailsSidebar = useCallback\(\(\) => \{/);
  assert.match(editor, /setIsJDAnalysisDetailsSidebarOpen\(true\)/);
  assert.match(editor, /setIsAssistantSidebarOpen\(false\)/);
  assert.match(editor, /onOpenDetailsSidebar: handleOpenJDAnalysisDetailsSidebar/);
  assert.match(editor, /onOpenAnalysisDetails=\{analysisResult \? handleOpenJDAnalysisDetailsSidebar : undefined\}/);
  assert.match(editor, /const isRightSidebarOpen = isAssistantSidebarOpen \|\| isJDAnalysisDetailsSidebarOpen/);
  assert.match(editor, /const rightSidebarContent = isJDAnalysisDetailsSidebarOpen/);
  assert.match(editor, /<JDAnalysisDetailsSidebar/);
  assert.match(editor, /isAssistantSidebarOpen=\{isRightSidebarOpen\}/);
  assert.match(editor, /assistantSidebar=\{rightSidebarContent\}/);

  assert.match(workspace, /assistantSidebar\?: React\.ReactNode/);
  assert.match(workspace, /isAssistantSidebarOpen\?: boolean/);
});
