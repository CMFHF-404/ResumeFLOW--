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
  assert.match(panel, /JD 分析报告/);
  assert.match(panel, /简历诊断报告/);
  assert.match(panel, /<ResumeEvaluationReport/);
  assert.match(panel, /role="tablist" aria-label="分析报告类型"/);
  assert.match(panel, /role="tabpanel" aria-labelledby="jd-report-tab"/);
  assert.match(panel, /role="tabpanel" aria-labelledby="resume-report-tab"/);
  assert.doesNotMatch(panel, /onOpenAssistantSidebar/);
  assert.doesNotMatch(panel, /aria-label="返回 AI 助手"/);
  assert.doesNotMatch(panel, /<Sparkles className="h-4 w-4" \/>/);
  const detailsSidebarHeader = panel.match(
    /aria-labelledby="jd-analysis-details-sidebar-title"[\s\S]*?<div className="min-h-0 flex-1 overflow-y-auto/
  )?.[0] ?? '';
  assert.match(detailsSidebarHeader, /aria-label="关闭分析报告"/);
  assert.match(detailsSidebarHeader, /onClick=\{handleClose\}/);
  assert.doesNotMatch(detailsSidebarHeader, /onClick=\{handleOpenAssistantSidebar\}/);

  assert.match(editor, /import \{ JDAnalysisDetailsSidebar \} from '\.\/components\/JDAnalysisPanel'/);
  assert.match(editor, /const \[isJDAnalysisDetailsSidebarOpen, setIsJDAnalysisDetailsSidebarOpen\] = useState\(false\)/);
  assert.match(editor, /const handleOpenJDAnalysisDetailsSidebar = useCallback\(\(\) => \{/);
  assert.match(editor, /setIsJDAnalysisDetailsSidebarOpen\(true\)/);
  const openDetailsHandler = editor.match(
    /const handleOpenJDAnalysisDetailsSidebar = useCallback\(\(\) => \{[\s\S]*?\}, \[analysisResult, captureMobileAnalysisReturnFocus\]\);/
  )?.[0] ?? '';
  assert.match(openDetailsHandler, /captureMobileAnalysisReturnFocus\(\)/);
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
  assert.match(
    editor,
    /const jdAnalysisDetailsSidebarProps = analysisResult \? \{[\s\S]*?onClose: handleCloseJDAnalysisDetailsSidebar,[\s\S]*?\} satisfies React\.ComponentProps<typeof JDAnalysisDetailsSidebar> : null;/,
  );
  assert.equal(
    (editor.match(/<JDAnalysisDetailsSidebar \{\.\.\.jdAnalysisDetailsSidebarProps\} \/>/g) ?? []).length,
    2,
  );
  assert.doesNotMatch(editor, /onOpenAssistantSidebar=\{handleReturnToAssistantSidebar\}/);
  assert.match(editor, /isAssistantSidebarOpen=\{isRightSidebarOpen\}/);
  assert.match(editor, /assistantSidebar=\{rightSidebarContent\}/);

  assert.match(workspace, /assistantSidebar\?: React\.ReactNode/);
  assert.match(workspace, /isAssistantSidebarOpen\?: boolean/);
});

test('JD interpretation renders the independent JD-fit badge and deep-report action', () => {
  const panel = read('views/ResumeEditor/components/JDAnalysisPanel.tsx');
  const analysisUtils = read('views/ResumeEditor/components/JDAnalysisPanel/analysisUtils.ts');
  const badges = read('views/ResumeEditor/components/Badges.tsx');

  const interpretationStart = panel.indexOf('const JDInterpretationCard:');
  const interpretationEnd = panel.indexOf('type JDAnalysisPanelProps');
  const interpretationCard = panel.slice(interpretationStart, interpretationEnd);
  assert.match(interpretationCard, /const jdMatch = typeof analysisResult\.matchPercentage === 'number'/);
  assert.match(interpretationCard, /JD ANALYSIS REPORT/);
  assert.match(interpretationCard, /aria-label=\{`JD 匹配度 \$\{jdMatch\}%`\}/);
  assert.match(interpretationCard, /<strong[^>]*>\{jdMatch\}<\/strong>/);
  assert.match(interpretationCard, /<span[^>]*>%<\/span>/);
  assert.match(interpretationCard, /analysisResult\.matchPercentage/);
  assert.doesNotMatch(interpretationCard, /analysisResult\.summary/);
  assert.doesNotMatch(analysisUtils, /真实诉求：\$\{getText\(interpretation\?\.roleIntent\) \|\| getText\(analysisResult\.summary\)/);
  assert.match(panel, /const shouldShowJdAnalysis = Boolean\(jdText\.trim\(\)\)[\s\S]*&& \(!isCurrentEvaluation \|\| evaluation\.jdMatch !== null\)/);
  assert.match(panel, /disabled=\{!shouldShowJdAnalysis\}/);
  assert.doesNotMatch(panel, /<StaleBadge/);
  assert.match(badges, /匹配度 \{score\}%/);
});

test('JD-only downstream prompts do not reuse the resume-quality summary', () => {
  const assistantContext = read('utils/assistantResumeContext.ts');
  const bossGreeting = read('views/ResumeEditor/hooks/useBossGreetingActions.ts');
  const editor = read('views/ResumeEditor/index.tsx');

  assert.match(assistantContext, /export const buildJDIntentSummary/);
  assert.match(assistantContext, /analysisResult\?\.jdInterpretation\?\.roleIntent\?\.trim\(\)/);
  assert.doesNotMatch(assistantContext, /岗位摘要：\$\{analysisResult\.summary/);
  assert.match(bossGreeting, /const analysisSummary = buildJDIntentSummary\(effectiveResult\)/);
  assert.doesNotMatch(bossGreeting, /analysisSummary: effectiveResult\.summary/);
  assert.match(editor, /summary: buildJDIntentSummary\(analysisResult\)/);
});

test('analysis details hide every JD-specific section when the live JD context is empty', () => {
  const panel = read('views/ResumeEditor/components/JDAnalysisPanel.tsx');
  assert.match(
    panel,
    /const shouldShowJdAnalysis = Boolean\(jdText\.trim\(\)\)/
  );
});

test('mobile editor exposes the shared report in a full-height dialog and uses JD-match percentage units', () => {
  const editor = read('views/ResumeEditor/index.tsx');
  const mobile = read('views/ResumeEditor/components/MobileEditorHeader.tsx');
  const dialogHook = read('views/ResumeEditor/hooks/useMobileJDAnalysisDialog.ts');

  assert.match(mobile, /onOpenAnalysisDetails\?: \(\) => void/);
  assert.match(mobile, /JD 匹配/);
  assert.match(mobile, /查看报告/);
  assert.match(mobile, /analysisResult\.matchPercentage \?\? 0[\s\S]*?%/);
  assert.doesNotMatch(mobile, /analysisResult\.matchPercentage \?\? 0[\s\S]{0,120}分/);
  assert.doesNotMatch(mobile, /StaleBadge/);
  assert.match(editor, /role="dialog"/);
  assert.match(editor, /aria-label="分析报告"/);
  assert.match(editor, /ref=\{mobileAnalysisDialogRef\}/);
  assert.match(editor, /import \{ useMobileJDAnalysisDialog \} from '\.\/hooks\/useMobileJDAnalysisDialog'/);
  assert.match(editor, /useMobileJDAnalysisDialog\(\{[\s\S]*isOpen: isJDAnalysisDetailsSidebarOpen,[\s\S]*onClose: handleCloseJDAnalysisDetailsSidebar,/);
  assert.match(editor, /captureReturnFocus: captureMobileAnalysisReturnFocus/);
  assert.match(editor, /jdAnalysisDetailsSidebarProps && isMobileAnalysisViewport \? \(/);
  assert.match(editor, /h-\[calc\(100dvh-2rem\)\]/);
  assert.match(editor, /md:hidden/);
  assert.match(editor, /onOpenAnalysisDetails=\{analysisResult \? handleOpenJDAnalysisDetailsSidebar : undefined\}/);
  assert.doesNotMatch(editor, /document\.body\.style\.overflow = 'hidden'/);

  assert.match(dialogHook, /export const MOBILE_ANALYSIS_MEDIA_QUERY = '\(max-width: 767px\)'/);
  assert.match(dialogHook, /mediaQuery\.addEventListener\('change', syncViewport\)/);
  assert.match(dialogHook, /mediaQuery\.removeEventListener\('change', syncViewport\)/);
  assert.match(dialogHook, /!isOpen \|\| !isMobileAnalysisViewport/);
  assert.match(dialogHook, /event\.key === 'Escape'/);
  assert.match(dialogHook, /element\.inert = true/);
  assert.match(dialogHook, /document\.body\.style\.overflow = 'hidden'/);
  assert.match(dialogHook, /returnFocusElement\.focus\(\)/);
  assert.match(dialogHook, /returnFocusElement\.getClientRects\(\)\.length > 0/);
});

test('JD analysis panel uses supported compiled Tailwind utilities', () => {
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
