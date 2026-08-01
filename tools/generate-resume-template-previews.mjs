import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { createServer } from 'vite';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = resolve(rootDir, 'public');
const targetTemplateFlagIndex = process.argv.indexOf('--template');
const targetTemplateId = targetTemplateFlagIndex >= 0
  ? process.argv[targetTemplateFlagIndex + 1]
  : null;
if (targetTemplateFlagIndex >= 0 && !targetTemplateId) {
  throw new Error('--template 需要提供模板 ID。');
}

const resolveOutputPath = (thumbnailSrc) => {
  const normalizedPath = thumbnailSrc.replace(/^\/+/, '');
  const outputPath = resolve(publicDir, normalizedPath);
  const relativePath = relative(publicDir, outputPath);
  if (isAbsolute(relativePath) || relativePath.startsWith(`..${sep}`) || relativePath === '..') {
    throw new Error(`缩略图输出路径越界：${thumbnailSrc}`);
  }
  return outputPath;
};

let viteServer;
let browser;

try {
  viteServer = await createServer({
    root: rootDir,
    logLevel: 'error',
    server: {
      host: '127.0.0.1',
      port: 0,
      strictPort: true,
    },
  });
  await viteServer.listen();

  const address = viteServer.httpServer?.address();
  if (!address || typeof address === 'string') {
    throw new Error('无法确定模板预览开发服务器端口。');
  }
  const origin = `http://127.0.0.1:${address.port}`;
  const catalogModule = await viteServer.ssrLoadModule('/constants/resumeTemplates.ts');
  const catalog = catalogModule.RESUME_TEMPLATE_DEFINITIONS;
  const templates = targetTemplateId
    ? catalog.filter((template) => template.id === targetTemplateId)
    : catalog;

  if (targetTemplateId && templates.length !== 1) {
    throw new Error(`未知模板 ID：${targetTemplateId}`);
  }

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 900, height: 1280 },
    deviceScaleFactor: 1,
  });

  for (const template of templates) {
    const pageUrl = `${origin}/__dev/resume-template-preview?templateId=${encodeURIComponent(template.id)}`;
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => (
      document.body.dataset.rfTemplatePreviewReady === 'true'
      || Boolean(document.body.dataset.rfTemplatePreviewError)
    ));

    const pageError = await page.evaluate(() => document.body.dataset.rfTemplatePreviewError ?? '');
    if (pageError) {
      throw new Error(`${template.id}: ${pageError}`);
    }

    const preview = page.locator('.a4-preview[data-rf-template-id]');
    if (await preview.count() !== 1) {
      throw new Error(`${template.id}: 未找到唯一的 A4 预览节点。`);
    }

    const screenshot = await preview.screenshot({
      type: 'png',
      animations: 'disabled',
    });
    const webp = await sharp(screenshot)
      .resize({ width: 480, height: 679, fit: 'fill' })
      .webp({ quality: 82, smartSubsample: true })
      .toBuffer();
    const outputPath = resolveOutputPath(template.thumbnailSrc);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, webp);
    process.stdout.write(`${template.id} -> ${relative(rootDir, outputPath)}\n`);
  }

  process.stdout.write(`Generated ${templates.length} resume template preview(s).\n`);
} finally {
  await browser?.close();
  await viteServer?.close();
}
