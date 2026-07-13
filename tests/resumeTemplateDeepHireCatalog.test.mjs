import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';

const rootDir = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const read = (path) => readFileSync(join(rootDir, path), 'utf8');

const EXPECTED_DEEPHIRE_TEMPLATES = [
  ['deephire-standard', '标准'],
  ['deephire-blue', '青蓝'],
  ['deephire-steady', '沉稳'],
  ['deephire-simple', '简约'],
  ['deephire-deep-blue', '湛青'],
  ['deephire-lucky-red', '幸运红'],
  ['deephire-champion-blue', '冠军蓝'],
  ['deephire-collector-red', '典藏红'],
  ['deephire-minimal', '极简'],
  ['deephire-blue-header', '蓝顶'],
  ['deephire-elegant', '清雅'],
  ['deephire-concise', '简明'],
  ['deephire-table', '表格'],
  ['deephire-ink', '墨韵'],
  ['deephire-retro', '复古'],
  ['deephire-business', '商务'],
  ['deephire-fashion-black', '时尚黑'],
  ['deephire-youth-energy', '活力青春'],
  ['deephire-artistic', '艺术气息'],
  ['deephire-soft-realm', '柔境'],
  ['deephire-forest', '林原'],
  ['deephire-classic-elegance', '典雅'],
  ['deephire-magazine-editorial', '杂志编辑'],
  ['deephire-forest-fresh', '森系清新'],
  ['deephire-cyber-future', '赛博未来'],
  ['deephire-renaissance', '文艺复兴'],
  ['deephire-watercolor', '清新水彩'],
  ['deephire-campus-youth', '青春校园'],
];

const SOURCE_BACKED_DECORATIONS = [
  ['deephire-deep-blue', 'public/resume-templates/deephire/deephire-deep-blue-band.png'],
  ['deephire-lucky-red', 'public/resume-templates/deephire/deephire-lucky-dots.png'],
  ['deephire-champion-blue', 'public/resume-templates/deephire/deephire-champion-honeycomb.png'],
  ['deephire-fashion-black', 'public/resume-templates/deephire/deephire-fashion-rings.png'],
  ['deephire-youth-energy', 'public/resume-templates/deephire/deephire-youth-accent.png'],
  ['deephire-soft-realm', 'public/resume-templates/deephire/deephire-soft-realm-arc.png'],
  ['deephire-forest', 'public/resume-templates/deephire/deephire-forest-band.png'],
  ['deephire-renaissance', 'public/resume-templates/deephire/deephire-renaissance-band.png'],
  ['deephire-watercolor', 'public/resume-templates/deephire/deephire-watercolor-wash.webp'],
  ['deephire-watercolor', 'public/resume-templates/deephire/deephire-watercolor-divider.png'],
  ['deephire-campus-youth', 'public/resume-templates/deephire/deephire-campus-divider.png'],
];

const DEEPHIRE_STRUCTURE_CONTRACT = {
  'deephire-standard': ['avatar', 'avatar-right', 'plain-rule'],
  'deephire-blue': ['avatar', 'avatar-right', 'soft-band'],
  'deephire-steady': ['avatar', 'top-banner-avatar', 'plain-rule'],
  'deephire-simple': ['split', 'split-profile', 'timeline-dot', 'sidebar', 0.305],
  'deephire-deep-blue': ['avatar', 'curved-profile', 'plain-rule'],
  'deephire-lucky-red': ['avatar', 'top-banner-avatar', 'solid-band'],
  'deephire-champion-blue': ['split', 'editorial-split', 'solid-band', 'main', 0.295],
  'deephire-collector-red': ['split', 'split-profile', 'timeline-dot', 'sidebar', 0.295],
  'deephire-minimal': ['avatar', 'avatar-right', 'plain-rule'],
  'deephire-blue-header': ['avatar', 'top-banner-avatar', 'plain-rule'],
  'deephire-elegant': ['avatar', 'avatar-right', 'plain-rule'],
  'deephire-concise': ['split', 'split-profile', 'timeline-dot', 'sidebar', 0.30],
  'deephire-table': ['avatar', 'table-grid', 'table-cell'],
  'deephire-ink': ['avatar', 'avatar-right', 'editorial-tag'],
  'deephire-retro': ['split', 'split-profile', 'plain-rule', 'sidebar', 0.374],
  'deephire-business': ['split', 'split-profile', 'plain-rule', 'sidebar', 0.375],
  'deephire-fashion-black': ['avatar', 'top-banner-avatar', 'heavy-rule'],
  'deephire-youth-energy': ['split', 'editorial-split', 'left-rail', 'page', 0.38],
  'deephire-artistic': ['avatar', 'art-frame', 'editorial-tag'],
  'deephire-soft-realm': ['split', 'split-profile', 'left-rail', 'sidebar', 0.27],
  'deephire-forest': ['avatar', 'top-banner-avatar', 'plain-rule'],
  'deephire-classic-elegance': ['avatar', 'avatar-right', 'plain-rule'],
  'deephire-magazine-editorial': ['split', 'editorial-split', 'editorial-tag', 'sidebar', 0.37],
  'deephire-forest-fresh': ['split', 'editorial-split', 'editorial-tag', 'sidebar', 0.37],
  'deephire-cyber-future': ['avatar', 'dark-technical', 'editorial-tag'],
  'deephire-renaissance': ['avatar', 'avatar-right', 'centered-label'],
  'deephire-watercolor': ['avatar', 'watercolor-profile', 'watercolor-dot'],
  'deephire-campus-youth': ['avatar', 'avatar-right', 'plain-rule'],
};

const loadResumeTemplateCatalog = async () => {
  const result = await build({
    absWorkingDir: rootDir,
    entryPoints: ['constants/resumeTemplates.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
  });
  const outputText = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
};

const loadDeepHireTemplateStyles = async () => {
  const result = await build({
    absWorkingDir: rootDir,
    entryPoints: ['views/ResumeEditor/components/ResumePreview/deepHireTemplateStyles.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
  });
  const outputText = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
};

const loadPreviewRenderUtils = async () => {
  const result = await build({
    absWorkingDir: rootDir,
    entryPoints: ['views/ResumeEditor/components/ResumePreview/previewRenderUtils.tsx'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
  });
  const outputText = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
};

test('DeepHire catalog exposes the exact replicated template set and local assets', async () => {
  const { RESUME_TEMPLATE_DEFINITIONS } = await loadResumeTemplateCatalog();
  const deephireTemplates = RESUME_TEMPLATE_DEFINITIONS.filter(({ id }) => id.startsWith('deephire-'));

  assert.deepEqual(
    deephireTemplates.map(({ id, name }) => [id, name]),
    EXPECTED_DEEPHIRE_TEMPLATES,
    'the DeepHire catalog should stay complete, ordered, and free of renamed or extra entries',
  );

  for (const template of deephireTemplates) {
    assert.equal(
      template.collection,
      'deephire',
      `${template.id} should identify the DeepHire source collection`,
    );
    assert.equal(
      typeof template.thumbnailSrc,
      'string',
      `${template.id} should expose a thumbnailSrc`,
    );
    assert.ok(
      template.thumbnailSrc.startsWith('/')
        || template.thumbnailSrc.startsWith('./')
        || template.thumbnailSrc.startsWith('../'),
      `${template.id} should use a local thumbnail path`,
    );
    assert.doesNotMatch(
      template.thumbnailSrc,
      /^(?:https?:|data:|blob:)/i,
      `${template.id} should not depend on a remote or embedded thumbnail`,
    );
    assert.ok(
      existsSync(join(rootDir, 'public', template.thumbnailSrc.replace(/^\//, ''))),
      `${template.id} should point to a bundled thumbnail that exists`,
    );
  }
});

test('agent template options mirror the frontend DeepHire contract', async () => {
  const { RESUME_TEMPLATE_DEFINITIONS } = await loadResumeTemplateCatalog();
  const deephireTemplates = RESUME_TEMPLATE_DEFINITIONS.filter(({ id }) => id.startsWith('deephire-'));
  const backendSource = read('backend/app/domain/agent/agent_option_helpers.py');
  const apiReference = read('backend/app/domain/agent/skill_bundles/resumeflow-job-search/references/api.md');

  const extractTemplateBlock = (source, templateId) => {
    const start = source.indexOf(`"id": "${templateId}"`);
    assert.notEqual(start, -1, `${templateId} should be present in the agent contract`);
    const next = source.indexOf('"id": "deephire-', start + templateId.length + 8);
    return source.slice(start, next === -1 ? undefined : next);
  };

  for (const template of deephireTemplates) {
    const pythonBlock = extractTemplateBlock(backendSource, template.id);
    const apiBlock = extractTemplateBlock(apiReference, template.id);

    assert.ok(pythonBlock.includes(`"name": "${template.name}"`), `${template.id} backend name should match`);
    assert.ok(pythonBlock.includes(`"description": "${template.description}"`), `${template.id} backend description should match`);
    assert.ok(pythonBlock.includes(`"has_avatar": ${template.hasAvatar ? 'True' : 'False'}`), `${template.id} backend avatar flag should match`);
    assert.ok(
      pythonBlock.includes(`"default_theme_color_preset_id": "${template.defaultThemeColorPresetId}"`),
      `${template.id} backend theme preset should match`,
    );

    assert.ok(apiBlock.includes(`"name": "${template.name}"`), `${template.id} API reference name should match`);
    assert.ok(apiBlock.includes(`"description": "${template.description}"`), `${template.id} API reference description should match`);
    assert.ok(apiBlock.includes(`"has_avatar": ${template.hasAvatar ? 'true' : 'false'}`), `${template.id} API reference avatar flag should match`);
    assert.ok(
      apiBlock.includes(`"default_theme_color_preset_id": "${template.defaultThemeColorPresetId}"`),
      `${template.id} API reference theme preset should match`,
    );
  }
});

test('all 28 DeepHire templates own measured geometry instead of falling back to a generic skin', async () => {
  const { RESUME_TEMPLATE_DEFINITIONS } = await loadResumeTemplateCatalog();
  const deephireTemplates = RESUME_TEMPLATE_DEFINITIONS.filter(({ id }) => id.startsWith('deephire-'));
  const styleSource = read('views/ResumeEditor/components/ResumePreview/deepHireTemplateStyles.ts');
  const renderVariants = new Set();
  const sectionVariants = new Set();

  for (const template of deephireTemplates) {
    renderVariants.add(template.renderVariant);
    sectionVariants.add(template.sectionVariant);

    const [layoutKind, renderVariant, sectionVariant, headerPlacement, sidebarRatio] = DEEPHIRE_STRUCTURE_CONTRACT[template.id];
    assert.equal(template.layoutKind, layoutKind, `${template.id} should keep its measured page skeleton`);
    assert.equal(template.renderVariant, renderVariant, `${template.id} should keep its dedicated header composition`);
    assert.equal(template.sectionVariant, sectionVariant, `${template.id} should keep its section treatment`);

    const insets = template.visualTokens?.pageInsets;
    assert.ok(insets, `${template.id} should define source-measured page insets`);
    for (const edge of ['top', 'right', 'bottom', 'left']) {
      assert.equal(
        Number.isFinite(insets[edge]),
        true,
        `${template.id} should define a finite ${edge} page inset`,
      );
      assert.ok(insets[edge] >= 0, `${template.id} ${edge} page inset should not be negative`);
    }

    const caseNeedle = `case '${template.id}':`;
    const caseStart = styleSource.indexOf(caseNeedle);
    assert.notEqual(caseStart, -1, `${template.id} should have a dedicated template CSS branch`);
    const nextCase = styleSource.indexOf("case 'deephire-", caseStart + caseNeedle.length);
    const defaultBranch = styleSource.indexOf('\n        default:', caseStart + caseNeedle.length);
    const branchEnd = nextCase === -1 ? defaultBranch : nextCase;
    assert.notEqual(branchEnd, -1, `${template.id} CSS branch should terminate before the fallback`);
    const branchSource = styleSource.slice(caseStart, branchEnd);
    assert.match(branchSource, /return\s+`/, `${template.id} should return template-specific CSS`);
    assert.ok(
      branchSource.length >= 180,
      `${template.id} template-specific CSS should contain more than a token color override`,
    );

    if (template.layoutKind === 'split') {
      assert.equal(
        template.visualTokens?.headerPlacement,
        headerPlacement,
        `${template.id} should pin its header to the measured split region`,
      );
      assert.equal(
        template.visualTokens?.sidebarRatio,
        sidebarRatio,
        `${template.id} should preserve its measured sidebar ratio`,
      );
      assert.deepEqual(
        template.visualTokens?.sidebarSectionIds,
        ['certifications', 'skills'],
        `${template.id} should pin certifications and skills to the source sidebar`,
      );
    }
  }

  assert.ok(renderVariants.size >= 9, 'the collection should keep multiple independent header compositions');
  assert.ok(sectionVariants.size >= 9, 'the collection should keep multiple independent section systems');
});

test('source-backed decorative assets are bundled and wired into the preview implementation', () => {
  const styleSource = read('views/ResumeEditor/components/ResumePreview/deepHireTemplateStyles.ts');
  const headerSource = read('views/ResumeEditor/components/ResumePreview/sections/DeepHireHeaderBlock.tsx');
  const implementationSource = `${styleSource}\n${headerSource}`;

  for (const [templateId, assetPath] of SOURCE_BACKED_DECORATIONS) {
    assert.ok(existsSync(join(rootDir, assetPath)), `${templateId} should bundle ${assetPath}`);
    assert.match(
      implementationSource,
      new RegExp(assetPath.split('/').at(-1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      `${templateId} should reference ${assetPath} from the live renderer`,
    );
  }
});

test('DeepHire section spacing remains controlled by the editor layout', () => {
  const styleSource = read('views/ResumeEditor/components/ResumePreview/deepHireTemplateStyles.ts');
  const sectionRulePattern = /\[data-rf-section-id\]:not\(\[data-rf-section-id="basic-info"\]\)\s*\{([^}]*)\}/g;
  const headerRulePattern = /\.rf-deephire-header(?:--[\w-]+)?\s*\{([^}]*)\}/g;
  const headingRulePattern = /^(?:\$\{headingSelector\}|[^\n]*\.rf-template-section-heading[^\n{]*)\s*\{([^}]*)\}/gm;

  for (const match of styleSource.matchAll(sectionRulePattern)) {
    assert.doesNotMatch(
      match[1],
      /margin(?:-bottom)?\s*:[^;]*!important/,
      'DeepHire section wrappers must not override the editor-controlled bottom margin',
    );
  }

  for (const match of styleSource.matchAll(headerRulePattern)) {
    assert.doesNotMatch(
      match[1],
      /margin(?:-bottom)?\s*:[^;]*!important/,
      'DeepHire headers must not override the editor-controlled bottom margin',
    );
  }

  for (const match of styleSource.matchAll(headingRulePattern)) {
    assert.doesNotMatch(
      match[1],
      /margin(?:-bottom)?\s*:[^;]*!important/,
      'DeepHire section headings must not override the editor-controlled title gap',
    );
  }
});

test('PDF export waits for inline and CSS background images before marking the page ready', () => {
  const exportSource = read('views/ResumePdfExportPage.tsx');
  const waitCallIndex = exportSource.indexOf('waitForExportAssets(previewRef.current)');
  const readyCallIndex = exportSource.indexOf('setExportReadyState(true)');

  assert.match(exportSource, /querySelectorAll<HTMLImageElement>\('img'\)/);
  assert.match(exportSource, /getComputedStyle\(element\)\.backgroundImage/);
  assert.match(exportSource, /new Image\(\)/);
  assert.ok(waitCallIndex >= 0, 'the export page should wait for preview assets');
  assert.ok(readyCallIndex > waitCallIndex, 'asset readiness must resolve before rfExportReady is set');
});

test('split placement and fixed section routing are connected to the live preview', () => {
  const previewSource = read('views/ResumeEditor/components/ResumePreview.tsx');
  const utilsSource = read('views/ResumeEditor/components/ResumePreview/previewRenderUtils.tsx');
  const headerSource = read('views/ResumeEditor/components/ResumePreview/sections/HeaderBlock.tsx');
  const styleSource = read('views/ResumeEditor/components/ResumePreview/deepHireTemplateStyles.ts');
  const templateStylesSource = read('views/ResumeEditor/components/ResumePreview/templateStyles.ts');

  assert.match(previewSource, /visualTokens\?\.headerPlacement/);
  assert.match(previewSource, /visualTokens\?\.sidebarSectionIds/);
  assert.match(previewSource, /splitHeaderPlacement === 'page'/);
  assert.match(previewSource, /splitHeaderPlacement === 'sidebar'/);
  assert.match(previewSource, /splitHeaderPlacement === 'main'/);
  assert.match(previewSource, /<style>\{`\$\{previewTypographyCss\}\\n\$\{deepHireTemplateCss\}`\}<\/style>/);
  assert.match(headerSource, /activeTemplate\.collection === 'deephire'/);
  assert.match(headerSource, /<DeepHireHeaderBlock\b/);
  assert.match(utilsSource, /configuredSidebarSectionIds\?:\s*readonly string\[\]/);
  assert.match(utilsSource, /configuredSidebarSet\.has\(sectionId\)/);
  assert.match(previewSource, /buildPreviewContentLayoutClassName\(isSplitTemplate, isReadOnly\)/);
  assert.match(templateStylesSource, /isReadOnly \? 'overflow-hidden' : ''/);
  assert.doesNotMatch(
    styleSource,
    /\.rf-template-content-layout\s*\{\s*overflow:\s*hidden\s*!important;/,
    'DeepHire split layouts must not clip editor drag controls outside read-only previews',
  );
});

test('fixed split routing is deterministic for reordered, missing, unknown, and empty sidebar sections', async () => {
  const { resolveSplitColumnSectionIds } = await loadPreviewRenderUtils();
  const visible = ['project', 'skills', 'unknown', 'certifications', 'education'];

  const configured = resolveSplitColumnSectionIds(visible, true, ['certifications', 'skills']);
  assert.deepEqual(configured.sidebar, ['skills', 'certifications']);
  assert.deepEqual(configured.main, ['project', 'unknown', 'education']);
  assert.deepEqual([...configured.sidebar, ...configured.main].sort(), [...visible].sort());
  assert.equal(new Set([...configured.sidebar, ...configured.main]).size, visible.length);

  const intentionallyEmpty = resolveSplitColumnSectionIds(visible, true, []);
  assert.deepEqual(intentionallyEmpty.sidebar, []);
  assert.deepEqual(intentionallyEmpty.main, visible);

  const notSplit = resolveSplitColumnSectionIds(visible, false, ['skills']);
  assert.deepEqual(notSplit.sidebar, []);
  assert.deepEqual(notSplit.main, visible);
});

test('template selectors render catalog thumbnails instead of generic placeholders', () => {
  for (const path of [
    'views/ResumeEditor/components/TemplateSelectorModal.tsx',
    'views/ResumeEditor/components/ResumeFactorySidebar.tsx',
  ]) {
    const source = read(path);
    assert.match(source, /<TemplateThumbnail\b/);
    assert.match(
      source,
      /thumbnailSrc\s*=\s*\{\s*template\.thumbnailSrc\s*\}/,
      `${path} should pass each catalog entry's thumbnailSrc to TemplateThumbnail`,
    );
  }
});

test('fixed-palette DeepHire templates do not expose misleading theme customization', async () => {
  const {
    resolveResumeThemeColor,
    supportsResumeTemplateThemeColorCustomization,
  } = await loadResumeTemplateCatalog();
  const source = read('views/ResumeEditor/components/TemplateSelectorModal.tsx');

  assert.equal(supportsResumeTemplateThemeColorCustomization('modern-slate'), true);
  assert.equal(supportsResumeTemplateThemeColorCustomization('deephire-blue'), false);
  assert.equal(
    resolveResumeThemeColor('deephire-blue', 'crimson').id,
    'cyan',
    'fixed-palette templates should resolve their declared default palette even with a stale custom preset',
  );
  assert.match(
    source,
    /preferStaticThumbnail=\{!supportsResumeTemplateThemeColorCustomization\(editingTemplate\.id\)\}/,
    'fixed-palette templates should keep their truthful catalog preview',
  );
  assert.match(
    source,
    /supportsResumeTemplateThemeColorCustomization\(editingTemplate\.id\)\s*\?\s*\(/,
    'the preset editor should only render theme controls for templates that support them',
  );

  const workspacePropsSource = read('views/ResumeEditor/hooks/useResumeEditorPreviewWorkspaceProps.ts');
  assert.match(
    workspacePropsSource,
    /isThemeColorCustomizationEnabled:\s*supportsResumeTemplateThemeColorCustomization\(/,
    'layout controls should receive the same template capability',
  );
  assert.match(
    read('views/ResumeEditor/components/LayoutAdjustToolbar.tsx'),
    /isThemeColorCustomizationEnabled\s*\?\s*\([\s\S]*?<ThemeColorDesktopField/,
    'the shared adjustment toolbar should hide theme controls for fixed-palette templates',
  );
  assert.match(
    read('views/ResumeEditor/components/ResumeFactorySidebar.tsx'),
    /layoutAdjustProps\.isThemeColorCustomizationEnabled\s*\?\s*\(/,
    'the factory layout panel should use the same capability',
  );
  const presetActionsSource = read('views/ResumeEditor/hooks/useTemplatePresetActions.ts');
  assert.match(
    presetActionsSource,
    /supportsResumeTemplateThemeColorCustomization\(templateId\)[\s\S]*?resolveDefaultResumeThemeColorPresetId\(templateId\)/,
    'selecting a fixed-palette template should discard stale stored theme choices',
  );
  assert.match(
    presetActionsSource,
    /supportsResumeTemplateThemeColorCustomization\(preset\.templateId\)[\s\S]*?themeColorPresetId:\s*resolveDefaultResumeThemeColorPresetId\(preset\.templateId\)/,
    'saving a fixed-palette template should normalize the persisted theme choice',
  );
});

test('DeepHire styles preserve the configured section order', () => {
  const source = read('views/ResumeEditor/components/ResumePreview/deepHireTemplateStyles.ts');

  assert.doesNotMatch(
    source,
    /\[data-rf-section-id="[^"]+"\]\s*\{[^}]*\border\s*:/s,
    'template CSS should not override the user-configured section order',
  );
});

test('DeepHire preview preserves its measured top inset while applying page-margin adjustments', async () => {
  const { RESUME_TEMPLATE_DEFINITIONS } = await loadResumeTemplateCatalog();
  const { buildDeepHirePreviewStyleOverrides } = await loadDeepHireTemplateStyles();
  const template = RESUME_TEMPLATE_DEFINITIONS.find(({ id }) => id === 'deephire-standard');
  const fullBleedTemplate = RESUME_TEMPLATE_DEFINITIONS.find(({ id }) => id === 'deephire-simple');
  const defaultTopPaddingPx = Number((20 * (96 / 25.4)).toFixed(2));

  assert.ok(template, 'the standard DeepHire template should exist');
  assert.ok(fullBleedTemplate, 'the full-bleed DeepHire template should exist');

  const defaultStyle = buildDeepHirePreviewStyleOverrides(template, defaultTopPaddingPx);
  const compactStyle = buildDeepHirePreviewStyleOverrides(template, defaultTopPaddingPx - 10);
  const spaciousStyle = buildDeepHirePreviewStyleOverrides(template, defaultTopPaddingPx + 10);

  assert.equal(defaultStyle.paddingTop, `${template.visualTokens.pageInsets.top}px`);
  assert.equal(defaultStyle['--rf-template-top-padding'], `${template.visualTokens.pageInsets.top}px`);
  assert.equal(compactStyle.paddingTop, `${template.visualTokens.pageInsets.top - 10}px`);
  assert.equal(spaciousStyle.paddingTop, `${template.visualTokens.pageInsets.top + 10}px`);
  assert.equal(
    buildDeepHirePreviewStyleOverrides(fullBleedTemplate, defaultTopPaddingPx).paddingTop,
    '0px',
    'the default editor setting should preserve a full-bleed source top inset',
  );
  assert.equal(
    buildDeepHirePreviewStyleOverrides(fullBleedTemplate, defaultTopPaddingPx + 10).paddingTop,
    '10px',
    'increasing the page margin should still adjust a full-bleed template',
  );
  assert.equal(
    compactStyle.paddingRight,
    `${template.visualTokens.pageInsets.right}px`,
    'non-top source-measured insets should stay intact',
  );
});

test('DeepHire full-bleed banners keep editor-controlled top padding', () => {
  const styleSource = read('views/ResumeEditor/components/ResumePreview/deepHireTemplateStyles.ts');
  const headerSource = read('views/ResumeEditor/components/ResumePreview/sections/DeepHireHeaderBlock.tsx');
  const bannerRulePattern = /\.rf-deephire-header--banner\s*\{([^}]*)\}/g;

  for (const match of styleSource.matchAll(bannerRulePattern)) {
    assert.doesNotMatch(
      match[1],
      /padding(?:-top)?\s*:[^;]*!important/,
      'DeepHire full-bleed banners must not override the editor-controlled top padding',
    );
  }
  assert.match(
    headerSource,
    /paddingTop:\s*'calc\(var\(--rf-template-top-padding\) \+ 18px\)'/,
  );
});

test('champion metadata is rendered only in its dedicated sidebar block', () => {
  const source = read('views/ResumeEditor/components/ResumePreview/sections/DeepHireHeaderBlock.tsx');

  assert.match(source, /!isChampion && resumeDisplayTitle/);
  assert.match(source, /!isChampion\s*\?\s*renderContactList\(/);
});

test('cyber avatar placeholder keeps readable foreground and background colors', async () => {
  const { RESUME_TEMPLATE_DEFINITIONS } = await loadResumeTemplateCatalog();
  const { buildDeepHireTemplateCss } = await loadDeepHireTemplateStyles();
  const template = RESUME_TEMPLATE_DEFINITIONS.find(({ id }) => id === 'deephire-cyber-future');

  assert.ok(template, 'the cyber template should exist');
  const css = buildDeepHireTemplateCss(template, 'cyber-placeholder');
  assert.match(
    css,
    /\.rf-template-avatar-placeholder\s*\{[^}]*background-color:\s*#0b2039\s*!important;[^}]*color:\s*#e7f7ff\s*!important;/s,
  );
  assert.match(
    read('views/ResumeEditor/components/ResumePreview.tsx'),
    /rf-template-avatar-placeholder/,
  );
});

test('resume preview exposes stable template identity and style hooks', () => {
  const source = read('views/ResumeEditor/components/ResumePreview.tsx');

  assert.match(
    source,
    /data-rf-template-id\s*=\s*\{\s*activeTemplate\.id\s*\}/,
    'the preview root should expose the resolved template id',
  );
  assert.match(
    source,
    /data-rf-template-style\s*=\s*\{\s*activeTemplate\.visualStyle\s*\}/,
    'the preview root should expose a stable resolved template style attribute',
  );
});

test('watercolor template keeps its dedicated source-backed visual treatment', async () => {
  const { RESUME_TEMPLATE_DEFINITIONS } = await loadResumeTemplateCatalog();
  const {
    buildDeepHirePreviewStyleOverrides,
    buildDeepHireTemplateCss,
  } = await loadDeepHireTemplateStyles();
  const watercolor = RESUME_TEMPLATE_DEFINITIONS.find(({ id }) => id === 'deephire-watercolor');

  assert.ok(watercolor, 'the watercolor template should exist');
  assert.equal(watercolor.renderVariant, 'watercolor-profile');
  assert.equal(watercolor.sectionVariant, 'watercolor-dot');
  assert.equal(watercolor.hasAvatar, true);
  assert.ok(
    existsSync(join(rootDir, 'public/resume-templates/deephire/deephire-watercolor-wash.webp')),
    'the watercolor paper wash should be bundled locally',
  );
  assert.ok(
    existsSync(join(rootDir, 'public/resume-templates/deephire/deephire-watercolor-divider.png')),
    'the source-derived watercolor divider should be bundled locally',
  );

  const style = buildDeepHirePreviewStyleOverrides(watercolor, 24);
  assert.match(`${style.background ?? ''}`, /deephire-watercolor-wash\.webp/);
  assert.ok(!('backgroundColor' in style), 'the inline preview style should not mix background shorthands');

  const css = buildDeepHireTemplateCss(watercolor, 'test-preview');
  assert.match(css, /rf-watercolor-heading-dot/);

  const headerSource = read('views/ResumeEditor/components/ResumePreview/sections/DeepHireHeaderBlock.tsx');
  assert.match(headerSource, /renderVariant === 'watercolor-profile'/);
  assert.match(headerSource, /rf-deephire-header--watercolor/);
  assert.match(headerSource, /rf-deephire-avatar--watercolor/);

  const previewSource = read('views/ResumeEditor/components/ResumePreview.tsx');
  assert.match(previewSource, /rf-watercolor-heading-dot/);
});

test('artistic and magazine editorial preserve their source slanted heading cards', async () => {
  const { RESUME_TEMPLATE_DEFINITIONS } = await loadResumeTemplateCatalog();
  const { buildDeepHireTemplateCss } = await loadDeepHireTemplateStyles();
  const artistic = RESUME_TEMPLATE_DEFINITIONS.find(({ id }) => id === 'deephire-artistic');
  const magazine = RESUME_TEMPLATE_DEFINITIONS.find(({ id }) => id === 'deephire-magazine-editorial');

  assert.ok(artistic, 'the artistic template should exist');
  assert.ok(magazine, 'the magazine editorial template should exist');

  const artisticCss = buildDeepHireTemplateCss(artistic, 'artistic-slanted-card');
  assert.match(
    artisticCss,
    /transform:\s*skewX\(-10deg\)/,
    'artistic headings should keep the measured rounded parallelogram silhouette',
  );
  assert.match(artisticCss, /\.rf-template-section-heading > span\s*\{\s*transform:\s*skewX\(10deg\)/);
  assert.match(artisticCss, /border-radius:\s*5px\s*!important/);
  assert.match(artisticCss, /font-style:\s*italic/);
  assert.match(artisticCss, /min-height:\s*36px/);

  const magazineCss = buildDeepHireTemplateCss(magazine, 'magazine-slanted-card');
  assert.match(
    magazineCss,
    /\.rf-template-sidebar \.rf-template-section-heading\s*\{[^}]*clip-path:\s*polygon\(0 0,\s*100% 0,\s*calc\(100% - 5px\) 100%,\s*0 100%\)/s,
    'magazine sidebar headings should keep the source single-cut green card',
  );
  assert.match(
    magazineCss,
    /\.rf-template-sidebar \.rf-heading-marker\s*\{\s*display:\s*none;/,
    'magazine sidebar cards should not retain the main-column square marker',
  );
  assert.match(
    magazineCss,
    /\.rf-template-sidebar \.rf-template-section-heading\s*\{[^}]*background-color:\s*#3eb97f\s*!important;[^}]*color:\s*#ffffff\s*!important;/s,
  );
});
