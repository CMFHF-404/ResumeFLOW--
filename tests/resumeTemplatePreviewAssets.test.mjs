import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';
import sharp from 'sharp';

const rootDir = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const read = (path) => readFileSync(join(rootDir, path), 'utf8');

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

test('all resume templates expose one generated local A4 preview asset', async () => {
  const {
    RESUME_TEMPLATE_DEFINITIONS,
    shouldUseStaticResumeTemplateThumbnail,
  } = await loadResumeTemplateCatalog();
  assert.equal(RESUME_TEMPLATE_DEFINITIONS.length, 37);

  assert.equal(shouldUseStaticResumeTemplateThumbnail('modern-slate', 'slate'), true);
  assert.equal(shouldUseStaticResumeTemplateThumbnail('modern-slate', 'emerald'), false);
  assert.equal(shouldUseStaticResumeTemplateThumbnail('deephire-standard', 'emerald'), true);
  assert.equal(shouldUseStaticResumeTemplateThumbnail('modern-slate', 'slate', false), false);

  const thumbnailPaths = RESUME_TEMPLATE_DEFINITIONS.map((template) => template.thumbnailSrc);
  assert.equal(new Set(thumbnailPaths).size, 37, 'thumbnail paths must be unique');

  for (const template of RESUME_TEMPLATE_DEFINITIONS) {
    assert.match(template.thumbnailSrc, /^\/resume-templates\/(?:deephire|native)\/[a-z0-9-]+\.webp$/);
    const assetPath = join(rootDir, 'public', template.thumbnailSrc.replace(/^\//, ''));
    assert.ok(existsSync(assetPath), `${template.id} should have a generated preview asset`);
    const metadata = await sharp(assetPath).metadata();
    assert.equal(metadata.format, 'webp', `${template.id} should use WebP`);
    assert.equal(metadata.width, 480, `${template.id} preview width`);
    assert.equal(metadata.height, 679, `${template.id} preview height`);
  }
});

test('template preview generation uses the fixed fictional fixture and a development-only route', () => {
  const fixtureSource = read('views/resumeTemplatePreviewFixture.ts');
  const pageSource = read('views/ResumeTemplatePreviewDevPage.tsx');
  const entrySource = read('index.tsx');
  const generatorSource = read('tools/generate-resume-template-previews.mjs');
  const selectorSource = read('views/ResumeEditor/components/TemplateSelectorModal.tsx');

  for (const expected of [
    "name: '林澈'",
    "email: 'lin.che@example.com'",
    "linkedin: 'portfolio.example.com/lin-che'",
    "location: '杭州'",
    "avatarDataUrl: TEMPLATE_PREVIEW_AVATAR_SRC",
    "selectedWorkItems:",
    "selectedProjectItems:",
    "educations:",
    "sortedCertifications:",
    "selectedSkillGroups:",
  ]) {
    assert.match(fixtureSource, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  assert.match(entrySource, /import\.meta\.env\.DEV && window\.location\.pathname === '\/__dev\/resume-template-preview'/);
  assert.match(pageSource, /waitForPreviewAssets\(previewRef\.current\)/);
  assert.match(pageSource, /rfTemplatePreviewOverflowPx/);
  assert.match(pageSource, /overflowPx > OVERFLOW_TOLERANCE_PX/);
  assert.match(generatorSource, /resize\(\{ width: 480, height: 679, fit: 'fill' \}\)/);
  assert.match(generatorSource, /webp\(\{ quality: 82, smartSubsample: true \}\)/);
  assert.match(generatorSource, /const targetTemplateFlagIndex = process\.argv\.indexOf\('--template'\)/);
  assert.match(generatorSource, /if \(targetTemplateFlagIndex >= 0 && !targetTemplateId\)/);
  assert.match(generatorSource, /--template 需要提供模板 ID/);
  assert.equal((fixtureSource.match(/id: 'fixture-work-/g) ?? []).length, 2);
  assert.equal((fixtureSource.match(/id: 'fixture-project-/g) ?? []).length, 2);
  assert.equal((fixtureSource.match(/id: 'fixture-certification-/g) ?? []).length, 2);
  assert.equal((fixtureSource.match(/name: '(?:产品能力|数据与 AI|协作工具)'/g) ?? []).length, 3);
  assert.match(selectorSource, /TEMPLATE_THUMBNAIL_REVISION = '20260801-3'/);
  assert.match(selectorSource, /src=\{withTemplateThumbnailRevision\(resolvedThumbnailSrc\)\}/);
  assert.match(
    selectorSource,
    /shouldUseStaticResumeTemplateThumbnail\([\s\S]*?themeColorPresetId,[\s\S]*?preferStaticThumbnail/,
  );
});
