import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import tailwindConfig from '../tailwind.config.cjs';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = resolve(rootDir, 'public');
const targetTemplateFlagIndex = process.argv.indexOf('--template');
const targetTemplateId = targetTemplateFlagIndex >= 0
  ? process.argv[targetTemplateFlagIndex + 1]
  : null;
const avatarsOnly = process.argv.includes('--avatars-only');
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

let renderServer;
let browser;

try {
  const catalogBuild = await build({
    absWorkingDir: rootDir, entryPoints: ['constants/resumeTemplates.ts'],
    bundle: true, platform: 'node', format: 'esm', write: false,
  });
  const catalogModule = await import(`data:text/javascript;base64,${Buffer.from(catalogBuild.outputFiles[0].text).toString('base64')}`);
  const catalog = catalogModule.RESUME_TEMPLATE_DEFINITIONS;
  const templates = targetTemplateId
    ? catalog.filter((template) => template.id === targetTemplateId)
    : avatarsOnly ? catalog.filter((template) => template.hasAvatar) : catalog;

  if (targetTemplateId && templates.length !== 1) {
    throw new Error(`未知模板 ID：${targetTemplateId}`);
  }

  // Render the production PDF component directly. Thumbnail generation does
  // not need the application shell, authentication or API initialization.
  const fixture = `
    import React, {useEffect, useRef} from 'react';
    import {createRoot} from 'react-dom/client';
    import ResumePdfDocument from './views/ResumeEditor/components/ResumePdfDocument';
    import {buildResumeTemplatePreviewSnapshot} from './views/resumeTemplatePreviewFixture';
    import {waitForResumeRenderReady} from './utils/resumeRenderReadiness';
    const templateId = new URLSearchParams(location.search).get('templateId');
    function Fixture() {
      const previewRef = useRef(null);
      const contentRef = useRef(null);
      useEffect(() => {
        const controller = new AbortController();
        waitForResumeRenderReady(previewRef.current, {signal: controller.signal, deadlineMs: Date.now() + 15000})
          .then(() => {
            const overflow = Math.max(0, previewRef.current.scrollHeight - previewRef.current.clientHeight,
              contentRef.current.getBoundingClientRect().bottom - previewRef.current.getBoundingClientRect().bottom);
            if (overflow > 2) throw new Error(templateId + ' 的固定预览数据超出 A4 ' + overflow.toFixed(2) + 'px。');
            document.body.dataset.rfTemplatePreviewReady = 'true';
          }).catch(error => {document.body.dataset.rfTemplatePreviewError = error.message});
        return () => controller.abort();
      }, []);
      return <ResumePdfDocument snapshot={buildResumeTemplatePreviewSnapshot(templateId)}
        previewRef={previewRef} previewContentRef={contentRef} />;
    }
    createRoot(document.getElementById('root')).render(<Fixture />);
  `;
  const [fixtureBuild, css, indexHtml] = await Promise.all([
    build({stdin: {contents: fixture, loader: 'tsx', resolveDir: rootDir}, bundle: true,
      write: false, format: 'iife', platform: 'browser',
      define: {'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}'}}),
    postcss([tailwindcss(tailwindConfig)]).process(await readFile(join(rootDir, 'styles/tailwind.css'), 'utf8'), {from: join(rootDir, 'styles/tailwind.css')}),
    readFile(join(rootDir, 'index.html'), 'utf8'),
  ]);
  const baseCss = indexHtml.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
  const html = `<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><style>${css.css}${baseCss}</style><body><div id="root"></div><script src="/fixture.js"></script></body></html>`;
  renderServer = createHttpServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
      if (pathname === '/__dev/resume-template-preview') {
        response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(html); return;
      }
      if (pathname === '/fixture.js') {
        response.setHeader('Content-Type', 'application/javascript'); response.end(fixtureBuild.outputFiles[0].text); return;
      }
      // Only public font and template assets are needed by the render fixture.
      if (!/^\/(fonts|resume-templates|resume-template-previews)\/[a-zA-Z0-9/_.-]+$/.test(pathname)) {
        response.writeHead(404); response.end(); return;
      }
      response.end(await readFile(resolveOutputPath(pathname)));
    } catch {
      response.writeHead(404); response.end();
    }
  });
  await new Promise((resolveListen, rejectListen) => {
    renderServer.once('error', rejectListen);
    renderServer.listen(0, '127.0.0.1', resolveListen);
  });
  const origin = `http://127.0.0.1:${renderServer.address().port}`;
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
    ), undefined, {timeout: 20000});

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
  if (renderServer) {
    renderServer.closeAllConnections();
    await new Promise(resolveClose => renderServer.close(resolveClose));
  }
}
