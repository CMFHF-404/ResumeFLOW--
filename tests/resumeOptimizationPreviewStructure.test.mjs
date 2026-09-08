import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'esbuild';

const rootDir = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const read = (path) => readFileSync(join(rootDir, path), 'utf8');

const loadPreview = async () => {
  const tempDir = mkdtempSync(join(rootDir, 'tests/.tmp-resume-optimization-preview-'));
  const outputPath = join(tempDir, 'ResumeOptimizationPreview.mjs');
  try {
    await build({
      entryPoints: [join(rootDir, 'views/ResumeEditor/components/ResumeOptimization/ResumeOptimizationPreview.tsx')],
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'node20',
      outfile: outputPath,
      external: ['react', 'react/jsx-runtime', 'lucide-react'],
      logLevel: 'silent',
      plugins: [{
        name: 'resume-optimization-flow-rule-stub',
        setup(buildContext) {
          buildContext.onResolve({ filter: /useResumeOptimizationFlow$/ }, () => ({
            path: 'flow-rules',
            namespace: 'stub',
          }));
          buildContext.onLoad({ filter: /^flow-rules$/, namespace: 'stub' }, () => ({
            loader: 'js',
            contents: `
              export const isResumeOptimizationChangeSelectable = (change) => (
                change.safetyStatus === 'allowed'
                && (change.actionKind === 'rewrite_now' || change.actionKind === 'ask_user')
                && change.targetedValue !== null
              );
            `,
          }));
        },
      }],
    });
    const module = await import(`${pathToFileURL(outputPath).href}?${Math.random()}`);
    return {
      ResumeOptimizationPreview: module.ResumeOptimizationPreview,
      cleanup: () => rmSync(tempDir, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(tempDir, { recursive: true, force: true });
    throw error;
  }
};

const change = (overrides) => ({
  changeId: 'change-safe',
  issueIds: [],
  dimension: 'STAR应用',
  moduleType: 'experience_star',
  moduleId: 'private-module-id',
  fieldPath: '/currentResume/private/path',
  actionKind: 'rewrite_now',
  scope: 'general',
  beforeValue: '<b>原始行动</b>',
  generalValue: '不得展示的通用稿',
  targetedValue: '<b>定向行动</b>',
  sourceLabels: ['本轮补充信息', '已选经历原始版本'],
  introducedTerms: [],
  rationale: '保留可核验事实并提高可读性',
  defaultSelected: true,
  safetyStatus: 'allowed',
  safetyFindings: [],
  ...overrides,
});

test('diff and bank components expose safe responsive controls and documented labels', () => {
  const preview = read('views/ResumeEditor/components/ResumeOptimization/ResumeOptimizationPreview.tsx');
  const card = read('views/ResumeEditor/components/ResumeOptimization/ResumeOptimizationDiffCard.tsx');
  const overview = read('views/ResumeEditor/components/ResumeOptimization/ResumeOptimizationOverview.tsx');
  const bank = read('views/ResumeEditor/components/ResumeOptimization/ResumeOptimizationBankSuggestions.tsx');
  const utility = read('views/ResumeEditor/components/ResumeOptimization/optimizationDisplayUtils.mjs');

  assert.match(card, /原内容/);
  assert.match(card, /优化后/);
  assert.match(card, /beforeValue/);
  assert.match(card, /targetedValue/);
  assert.doesNotMatch(card, /generalValue/);
  assert.match(card, /isResumeOptimizationChangeSelectable/);
  assert.match(card, /role="radiogroup"/);
  assert.ok((card.match(/role="radio"/g) ?? []).length >= 2);
  assert.match(card, /disabled=\{!selectable\}/);
  assert.match(card, /readOnly/);
  assert.match(card, /保留原文/);
  assert.match(card, /buildResumeOptimizationSafetyFindingCopy/);
  assert.match(card, /自动规则未发现风险/);
  assert.doesNotMatch(card, /已通过事实检查/);
  assert.match(card, /grid-cols-1[\s\S]*md:grid-cols-2/);
  assert.match(preview, /plan\.changes\.filter\(isResumeOptimizationChangeReviewable\)/);
  assert.match(preview, /plan\.changes\.filter\(\(change\) => change\.safetyStatus === 'blocked'\)/);
  assert.match(overview, /plan\.changes\.filter\(isResumeOptimizationChangeReviewable\)/);
  assert.match(overview, /plan\.changes\.filter\(\(change\) => change\.safetyStatus === 'blocked'\)/);
  assert.match(overview, /buildResumeOptimizationSafetyFindingCopy/);
  assert.match(overview, /查看所选模块的改写与补充问题，逐项确认后应用。/);
  assert.doesNotMatch(overview, /所有改写都受事实边界约束/);
  assert.doesNotMatch(`${overview}\n${card}`, /预计提升|expectedScoreGain|sortResumeOptimizationChangesByExpectedGain/);
  assert.match(card, /bg-slate/);
  assert.match(card, /bg-emerald/);
  assert.match(card, /border-rose|bg-rose/);
  for (const label of ['通用优化', 'JD定向', '来自补充信息', '从总经历补回', '安全阻断']) {
    assert.match(`${preview}\n${card}\n${utility}`, new RegExp(label));
  }
  assert.match(utility, /stripRichTextToText/);
  assert.doesNotMatch(`${preview}\n${card}\n${bank}`, /dangerouslySetInnerHTML|JSON\.stringify|\.innerHTML/);
  assert.doesNotMatch(card, />\{change\.moduleId\}|>\{change\.fieldPath\}/);

  assert.match(bank, /经历库可补强素材/);
  assert.match(bank, /indigo/);
  assert.match(bank, /onViewExperience/);
  assert.match(bank, /onOpenAutoAssembly/);
  assert.match(bank, /查看经历/);
  assert.match(bank, /前往一键组装/);
  assert.doesNotMatch(bank, /type="checkbox"|acceptedChangeIds|onToggleChange/);
});

test('preview SSR uses targeted values, human order labels, and no internal identifiers', async () => {
  const { ResumeOptimizationPreview, cleanup } = await loadPreview();
  try {
    const plan = {
      changes: [
        change({}),
        change({
          changeId: 'change-skills',
          moduleType: 'skills_order',
          moduleId: 'skills-private',
          fieldPath: 'selection.skillIds',
          beforeValue: ['private-skill-a', 'private-skill-unknown'],
          generalValue: ['private-skill-unknown', 'private-skill-a'],
          targetedValue: ['private-skill-unknown', 'private-skill-a'],
        }),
        change({
          changeId: 'change-sections',
          moduleType: 'section_order',
          moduleId: 'sections-private',
          fieldPath: 'sectionOrder',
          beforeValue: ['summary', 'work', 'skills'],
          generalValue: ['skills', 'work', 'summary'],
          targetedValue: ['work', 'summary', 'skills'],
          scope: 'jd_targeted',
        }),
        change({
          changeId: 'change-blocked',
          safetyStatus: 'blocked',
          actionKind: 'leave_unchanged',
          targetedValue: null,
          rationale: '请核对 /currentResume/private/path',
        }),
      ],
      questions: [],
      bankSuggestions: [{
        suggestionId: 'private-suggestion-id',
        masterExperienceId: 'private-master-experience-id',
        category: 'project',
        title: '增长实验项目',
        org: '产品团队',
        matchScore: 92,
        reason: '可补强实验设计能力',
        capabilities: ['实验设计', '数据分析'],
      }],
      safetySummary: {
        allowedChangeIds: ['change-safe', 'change-skills', 'change-sections'],
        blockedChangeIds: ['change-blocked'],
        pendingChangeIds: [],
        findings: [],
      },
    };
    const html = renderToStaticMarkup(React.createElement(ResumeOptimizationPreview, {
      plan,
      acceptedChangeIds: ['change-safe', 'change-skills', 'change-sections'],
      readOnly: false,
      skillNameById: { 'private-skill-a': '用户研究' },
      onToggleChange: () => undefined,
      onViewExperience: () => undefined,
      onOpenAutoAssembly: () => undefined,
    }));

    assert.match(html, /原始行动/);
    assert.match(html, /定向行动/);
    assert.doesNotMatch(html, /不得展示的通用稿|<strong>|<b>/);
    assert.match(html, /用户研究/);
    assert.match(html, /未知技能/);
    assert.doesNotMatch(html, /private-skill/);
    assert.match(html, /个人评价.*→.*工作经历.*→.*技能清单/);
    assert.match(html, /工作经历.*→.*个人评价.*→.*技能清单/);
    assert.match(html, /经历库可补强素材/);
    assert.match(html, /查看经历/);
    assert.match(html, /前往一键组装/);
    assert.equal((html.match(/role="radio"/g) ?? []).length, 8);
    assert.equal((html.match(/disabled=""/g) ?? []).length, 2);
    assert.doesNotMatch(html, /请核对/);
    assert.doesNotMatch(
      html,
      /private-module|private-master|private-suggestion|\/currentResume|selection\.skillIds|sectionOrder/,
    );

    const historyHtml = renderToStaticMarkup(React.createElement(ResumeOptimizationPreview, {
      plan,
      acceptedChangeIds: ['change-safe'],
      readOnly: true,
      skillNameById: { 'private-skill-a': '用户研究' },
      onToggleChange: () => {
        throw new Error('historical previews must stay read only');
      },
      onViewExperience: () => undefined,
      onOpenAutoAssembly: () => undefined,
    }));
    assert.equal((historyHtml.match(/role="radio"/g) ?? []).length, 8);
    assert.equal((historyHtml.match(/disabled=""/g) ?? []).length, 8);
    assert.match(historyHtml, /已应用/);
  } finally {
    cleanup();
  }
});

test('blocked changes retain their original text while exposing a safe safety explanation', async () => {
  const { ResumeOptimizationPreview, cleanup } = await loadPreview();
  try {
    const basePlan = {
      questions: [],
      bankSuggestions: [],
      safetySummary: {
        allowedChangeIds: [],
        blockedChangeIds: ['change-blocked'],
        pendingChangeIds: [],
        findings: [],
      },
    };
    const blockedChange = change({
      changeId: 'change-blocked',
      safetyStatus: 'blocked',
      actionKind: 'leave_unchanged',
      targetedValue: null,
      safetyFindings: [
        '改写会引入无法验证的业务结果',
        '请核对 /currentResume/experiences/private-id/star/a',
      ],
    });
    const renderBlocked = (safetyFindings) => renderToStaticMarkup(React.createElement(
      ResumeOptimizationPreview,
      {
        plan: { ...basePlan, changes: [{ ...blockedChange, safetyFindings }] },
        acceptedChangeIds: [],
        readOnly: false,
        skillNameById: {},
        onToggleChange: () => {
          throw new Error('blocked changes must not be selectable');
        },
        onViewExperience: () => undefined,
        onOpenAutoAssembly: () => undefined,
      },
    ));

    const html = renderBlocked(blockedChange.safetyFindings);
    assert.match(html, /安全阻断说明/);
    assert.match(html, /改写会引入无法验证的业务结果/);
    assert.match(html, /保留原文/);
    assert.match(html, /此项不可应用/);
    assert.equal((html.match(/role="radio"/g) ?? []).length, 2);
    assert.equal((html.match(/disabled=""/g) ?? []).length, 2);
    assert.doesNotMatch(html, /private-id|\/currentResume|自动规则未发现风险/);

    const fallbackHtml = renderBlocked(['{"issueId":"ISS_PRIVATE","evidenceId":"E_PRIVATE"}']);
    assert.match(fallbackHtml, /该项未通过自动安全规则，已保留原文。/);
    assert.doesNotMatch(fallbackHtml, /ISS_PRIVATE|E_PRIVATE/);
  } finally {
    cleanup();
  }
});

test('legacy duplicate targets remain fully reviewable instead of hiding a candidate', async () => {
  const { ResumeOptimizationPreview, cleanup } = await loadPreview();
  try {
    const plan = {
      changes: [
        change({
          changeId: 'duplicate-first',
          moduleId: 'shared-experience',
          fieldPath: 'star.a',
          targetedValue: '<b>第一候选行动</b>',
          rationale: '第一条问题说明',
        }),
        change({
          changeId: 'duplicate-second',
          moduleId: 'shared-experience',
          fieldPath: 'star.a',
          targetedValue: '<b>第二候选行动</b>',
          rationale: '第二条问题说明',
        }),
      ],
      questions: [],
      bankSuggestions: [],
      safetySummary: {
        allowedChangeIds: ['duplicate-first', 'duplicate-second'],
        blockedChangeIds: [],
        pendingChangeIds: [],
        findings: [],
      },
    };
    const html = renderToStaticMarkup(React.createElement(ResumeOptimizationPreview, {
      resumeId: 'resume-1',
      runId: 'legacy-run',
      plan,
      acceptedChangeIds: ['duplicate-second'],
      readOnly: false,
      skillNameById: {},
      onToggleChange: () => undefined,
      onViewExperience: () => undefined,
      onOpenAutoAssembly: () => undefined,
    }));

    assert.match(html, /第一候选行动/);
    assert.match(html, /第二候选行动/);
    assert.match(html, /第一条问题说明/);
    assert.match(html, /第二条问题说明/);
    assert.equal((html.match(/role="radiogroup"/g) ?? []).length, 2);
    assert.equal((html.match(/role="radio"/g) ?? []).length, 4);
  } finally {
    cleanup();
  }
});

test('all-unsafe legacy plans explain that regeneration is required', async () => {
  const { ResumeOptimizationPreview, cleanup } = await loadPreview();
  try {
    const plan = {
      changes: [change({
        changeId: 'unsafe-rich-text',
        beforeValue: '<strong>原内容</strong>',
        targetedValue: '丢失格式的新内容',
      })],
      questions: [],
      bankSuggestions: [],
      safetySummary: {
        allowedChangeIds: ['unsafe-rich-text'],
        blockedChangeIds: [],
        pendingChangeIds: [],
        findings: [],
      },
    };
    const html = renderToStaticMarkup(React.createElement(ResumeOptimizationPreview, {
      resumeId: 'resume-1',
      runId: 'legacy-run',
      plan,
      acceptedChangeIds: [],
      readOnly: false,
      skillNameById: {},
      onToggleChange: () => undefined,
      onViewExperience: () => undefined,
      onOpenAutoAssembly: () => undefined,
    }));

    assert.match(html, /没有可安全应用的修改/);
    assert.match(html, /重新生成优化方案/);
    assert.doesNotMatch(html, /role="radiogroup"/);
  } finally {
    cleanup();
  }
});

test('inline A4 comparisons expose only the yellow and green content cards', () => {
  const renderUtils = read('views/ResumeEditor/components/ResumePreview/previewRenderUtils.tsx');
  const comparisonBlock = renderUtils.slice(
    renderUtils.indexOf('export const renderOptimizationTextComparison'),
    renderUtils.indexOf('export const renderStarBlocks'),
  );

  assert.match(comparisonBlock, /className="my-2 space-y-2"/);
  assert.doesNotMatch(comparisonBlock, /rounded-xl border border-slate|selectionLabel|准备采用|保留原文|已应用/);
  assert.equal((comparisonBlock.match(/rounded-lg border/g) ?? []).length, 2);
});

test('workspace and editor wire navigation through guarded close without invoking editor actions', () => {
  const app = read('App.tsx');
  const editor = read('views/ResumeEditor/index.tsx');
  const workspace = read('views/ResumeEditor/components/ResumeOptimization/ResumeOptimizationWorkspace.tsx');
  const experienceTab = read('views/ResumeEditor/components/ExperienceTab.tsx');
  const mobileHeader = read('views/ResumeEditor/components/MobileEditorHeader.tsx');

  assert.match(app, /onJumpToExperienceBank=\{handleJumpToExperienceBank\}/);
  assert.match(editor, /onJumpToExperienceBank\?:/);
  assert.match(editor, /resumeOptimizationNavigationInFlightRef/);
  assert.match(editor, /resumeOptimizationSuppressReturnFocusRef/);
  assert.match(editor, /await resumeOptimizationFlow\.closeWorkspace\(\)/);
  assert.match(editor, /if \(!didClose\) \{/);
  assert.match(editor, /resumeOptimizationShouldRestoreReportRef\.current = false/);
  assert.match(editor, /resumeOptimizationReturnFocusRef\.current = null/);
  assert.match(editor, /onJumpToExperienceBank\?\.\(category, masterExperienceId\)/);
  assert.match(editor, /setSidebarTab\('experience'\)/);
  assert.match(editor, /setFactorySidebarTab\('edit'\)/);
  assert.match(editor, /setResumeOptimizationAutoAssemblyFocusRequest/);

  const bankNavigation = editor.slice(
    editor.indexOf('const handleResumeOptimizationViewExperience'),
    editor.indexOf('const handleResumeOptimizationOpenAutoAssembly'),
  );
  assert.doesNotMatch(bankNavigation, /startEditingExperience|focusExperienceRequest/);
  const autoAssemblyNavigation = editor.slice(
    editor.indexOf('const handleResumeOptimizationOpenAutoAssembly'),
    editor.indexOf('const commitLayoutSnapshot'),
  );
  assert.match(autoAssemblyNavigation, /experience\.editingExpId/);
  assert.match(autoAssemblyNavigation, /请先保存当前经历或返回列表/);
  assert.doesNotMatch(autoAssemblyNavigation, /handleAutoAssemble|\.click\(/);

  assert.match(workspace, /ResumeOptimizationPreview/);
  assert.match(workspace, /suppressReturnFocusRef/);
  assert.match(workspace, /onViewExperience/);
  assert.match(workspace, /onOpenAutoAssembly/);
  assert.match(workspace, /skillNameById/);
  assert.match(workspace, /readOnly=\{run\?\.status !== 'preview_ready'\}/);

  assert.match(experienceTab, /autoAssemblyFocusRequest/);
  assert.match(experienceTab, /autoAssemblyButtonRef/);
  assert.match(experienceTab, /scrollIntoView/);
  assert.match(experienceTab, /\.focus\(\)/);
  assert.match(experienceTab, /matchMedia\('\(prefers-reduced-motion: reduce\)'\)/);
  assert.match(experienceTab, /prefersReducedMotion \? 'auto' : 'smooth'/);
  const desktopFocusedButton = experienceTab.slice(
    experienceTab.indexOf('ref={autoAssemblyButtonRef}'),
    experienceTab.indexOf('</button>', experienceTab.indexOf('ref={autoAssemblyButtonRef}')),
  );
  assert.match(desktopFocusedButton, /onClick=\{handleAutoAssembleClick\}/);
  assert.doesNotMatch(experienceTab, /autoAssemblyFocusRequest[\s\S]{0,240}\.click\(/);
  assert.match(experienceTab, /返回优化方案/);
  assert.match(experienceTab, /onReturnToOptimizationPlan/);
  assert.match(mobileHeader, /autoAssemblyFocusRequest/);
  assert.match(mobileHeader, /autoAssemblyButtonRef/);
  assert.match(mobileHeader, /matchMedia\('\(prefers-reduced-motion: reduce\)'\)/);
  assert.match(mobileHeader, /prefersReducedMotion \? 'auto' : 'smooth'/);
  const mobileFocusedButton = mobileHeader.slice(
    mobileHeader.indexOf('ref={autoAssemblyButtonRef}'),
    mobileHeader.indexOf('</button>', mobileHeader.indexOf('ref={autoAssemblyButtonRef}')),
  );
  assert.match(mobileFocusedButton, /onClick=\{onAutoAssemble\}/);
  assert.match(mobileHeader, /返回优化方案/);
  assert.match(editor, /resumeOptimizationFlow\.reopenLatestRun/);
});

test('navigation suppresses workspace return focus before close can unmount it and restores on refusal', () => {
  const editor = read('views/ResumeEditor/index.tsx');
  const navigation = editor.slice(
    editor.indexOf('const runResumeOptimizationNavigation'),
    editor.indexOf('const handleResumeOptimizationViewExperience'),
  );
  const markIndex = navigation.indexOf('resumeOptimizationSuppressReturnFocusRef.current = true');
  const closeIndex = navigation.indexOf('await resumeOptimizationFlow.closeWorkspace()');

  assert.ok(markIndex >= 0 && markIndex < closeIndex, 'return-focus suppression must be visible before close');
  assert.match(navigation, /if \(!didClose\) \{[\s\S]*resumeOptimizationSuppressReturnFocusRef\.current = false;[\s\S]*return false;[\s\S]*\}/);
  assert.match(navigation, /catch[\s\S]*resumeOptimizationSuppressReturnFocusRef\.current = false/);
});
