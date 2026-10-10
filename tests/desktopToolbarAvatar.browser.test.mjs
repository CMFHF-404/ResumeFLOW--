import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { test } from 'node:test';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import { chromium } from 'playwright';
import tailwindConfig from '../tailwind.config.cjs';

const fixture = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import Toolbar from './views/ResumeEditor/components/EditorToolbar';
import { ImageCropModal, ProfileAvatarZone } from './components/ImageCropModal';
function Fixture() {
  const [name, setName] = useState('范例-产品经理通用-2027届-极简留白-窄屏超长标题回归验证'.repeat(3));
  const [guest, setGuest] = useState(false);
  const [saveState, setSaveState] = useState('saved');
  const [layout, setLayout] = useState('list');
  const [crop, setCrop] = useState(null);
  const [photo, setPhoto] = useState(null);
  window.__guest = guest;
  window.setGuest = setGuest;
  window.setSaveState = setSaveState;
  window.openCrop = setCrop;
  return <>
    <div className="md:ml-[72px]">
      <Toolbar isDarkMode={false} onToggleTheme={() => {}} saveState={saveState} lastSavedAt="14:24:22"
        isLayoutModified isSmartPageApplied={false} onAdjustToSinglePage={() => {}}
        onRestoreDefault={() => {window.restored = true}} canCreateResume isCreatingResume={false}
        onCreateResume={() => {window.created = true}} resumeName={name} onResumeNameChange={setName}
        onExportPdf={() => {window.exported = true}} isExportingPdf={false}
        workspaceLayout={layout} onWorkspaceLayoutChange={setLayout} canOpenWorkspacePanels />
      <div className="p-6"><ProfileAvatarZone avatarDataUrl={photo} isClickable size="md" onUploadClick={() => {}} /></div>
    </div>
    <ImageCropModal imageSrc={crop} hasExistingAvatar={!!photo} onConfirm={value => {
      window.croppedImage = value; setPhoto(value); setCrop(null);
    }} onCancel={() => setCrop(null)} onDelete={() => {setPhoto(null); setCrop(null)}} onReplace={() => {}} />
  </>;
}
createRoot(document.getElementById('root')).render(<Fixture />);
`;

test('desktop toolbar stays on one row and portrait cropping retains 3:4 output', async () => {
  const [{ outputFiles }, css] = await Promise.all([
    build({
      stdin: { contents: fixture, loader: 'tsx', resolveDir: process.cwd() },
      bundle: true, write: false, format: 'iife', platform: 'browser',
      define: { 'process.env.NODE_ENV': '"development"', 'import.meta.env': '{}' },
      plugins: [{ name: 'fixture-auth', setup(builder) {
        builder.onResolve({ filter: /^@logto\/react$/ }, () => ({ path: 'auth', namespace: 'fixture' }));
        builder.onResolve({ filter: /analyticsTracker$/ }, () => ({ path: 'analytics', namespace: 'fixture' }));
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({
          contents: args.path === 'auth'
            ? 'export const useLogto = () => ({isAuthenticated: !window.__guest, signIn: async () => {}});'
            : 'export const trackLoginStart = async () => {};', loader: 'js',
        }));
      } }],
    }),
    postcss([tailwindcss(tailwindConfig)]).process(readFileSync('styles/tailwind.css', 'utf8'), { from: 'styles/tailwind.css' }),
  ]);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1091, height: 764 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('http://fixture.test/logo-mark-128.png', route => route.fulfill({
      contentType: 'image/png', body: readFileSync('public/logo-mark-128.png'),
    }));
    await page.setContent('<!doctype html><base href="http://fixture.test/"><div id="root"></div>');
    await page.addStyleTag({ content: css.css });
    await page.addScriptTag({ content: outputFiles[0].text });
    const title = page.locator('header span[title]');
    await title.waitFor();
    for (const guest of [false, true]) {
      await page.evaluate(value => window.setGuest(value), guest);
      for (const width of [768, 1024, 1091, 1280, 1536]) {
        await page.setViewportSize({ width, height: 764 });
        const metrics = await page.locator('header').evaluate(header => {
          const controls = [...header.querySelectorAll('[role="radiogroup"], button[title="编辑简历名称"], button[title="恢复默认"], [aria-label="保存状态"], [data-agent-action="export-pdf"]')];
          const bounds = controls.map(el => { const r = el.getBoundingClientRect(); return {x: r.x, right: r.right, cy: r.y + r.height / 2}; });
          const name = header.querySelector('span[title]');
          return { bounds, left: header.getBoundingClientRect().left, right: header.getBoundingClientRect().right,
            titleWidth: name.clientWidth, titleScroll: name.scrollWidth, overflow: document.documentElement.scrollWidth > innerWidth };
        });
        assert.ok(!metrics.overflow, `${width}px guest=${guest}: no horizontal overflow`);
        assert.ok(metrics.titleWidth > 0, `${width}px: title remains visible`);
        assert.ok(metrics.bounds.every(b => b.x >= metrics.left && b.right <= metrics.right), `${width}px: controls fit`);
        assert.ok(metrics.bounds.every(b => Math.abs(b.cy - metrics.bounds[0].cy) <= 1), `${width}px: controls share a row`);
        if (width <= 1091) assert.ok(metrics.titleScroll > metrics.titleWidth, `${width}px: long title truncates`);
      }
    }
    await page.setViewportSize({ width: 1091, height: 764 });
    await page.evaluate(() => window.setGuest(false));
    if (process.env.RF_QA_SCREENSHOTS) {
      mkdirSync('.artifacts/portrait-qa', { recursive: true });
      await page.screenshot({ path: '.artifacts/portrait-qa/desktop-1091-long-title.png' });
    }
    await page.getByRole('button', { name: '编辑简历名称' }).click();
    await page.getByRole('textbox', { name: '简历名称' }).fill('修改后标题');
    await page.getByRole('textbox', { name: '简历名称' }).press('Enter');
    assert.equal(await title.getAttribute('title'), '修改后标题');
    await page.getByRole('radio', { name: '列表布局' }).press('ArrowRight');
    assert.equal(await page.getByRole('radio', { name: '三栏布局' }).getAttribute('aria-checked'), 'true');
    await page.getByRole('button', { name: '恢复默认', exact: true }).click();
    await page.locator('[data-agent-action="export-pdf"]').click();
    assert.equal(await page.evaluate(() => window.restored && window.exported), true);
    for (const state of ['dirty', 'saving', 'error', 'saved']) {
      await page.evaluate(value => window.setSaveState(value), state);
      await page.waitForFunction(value => document.querySelector('[aria-label="保存状态"]').dataset.agentState === value, state);
      assert.ok(await page.getByRole('status', { name: '保存状态' }).isVisible());
    }
    const source = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 800;
      const context = canvas.getContext('2d');
      context.fillStyle = '#00ff00'; context.fillRect(0, 0, 600, 800);
      context.fillStyle = '#ff0000'; context.fillRect(0, 0, 600, 50);
      context.fillStyle = '#0000ff'; context.fillRect(0, 750, 600, 50);
      return canvas.toDataURL();
    });
    await page.evaluate(value => window.openCrop(value), source);
    await page.getByRole('button', { name: '确认裁剪' }).waitFor();
    await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(b => b.textContent.includes('确认裁剪'))?.disabled);
    await page.getByRole('button', { name: '确认裁剪' }).click();
    const photo = await page.evaluate(async () => {
      const img = new Image(); img.src = window.croppedImage; await img.decode();
      const canvas = document.createElement('canvas'); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
      return { width: img.naturalWidth, height: img.naturalHeight, top: [...ctx.getImageData(192, 10, 1, 1).data], bottom: [...ctx.getImageData(192, 500, 1, 1).data] };
    });
    assert.equal(photo.width, 384); assert.equal(photo.height, 512);
    assert.ok(photo.top[0] > 240 && photo.bottom[2] > 240, 'portrait crop keeps both ends of the matching source');
    const zone = await page.getByAltText('个人照片').locator('..').boundingBox();
    assert.equal(zone.width / zone.height, 3 / 4);
    if (process.env.RF_QA_SCREENSHOTS) {
      mkdirSync('.artifacts/portrait-qa', { recursive: true });
      await page.screenshot({ path: '.artifacts/portrait-qa/desktop-1091.png' });
    }
    await page.setViewportSize({ width: 320, height: 740 });
    await page.evaluate(value => window.openCrop(value), source);
    const dialog = await page.getByRole('dialog', { name: '裁剪头像' }).boundingBox();
    assert.ok(dialog.x >= 0 && dialog.x + dialog.width <= 320, 'crop modal fits the smallest mobile viewport');
    await page.getByRole('slider', { name: '头像缩放' }).press('End');
    const surface = page.locator('.cursor-grab');
    const box = await surface.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down(); await page.mouse.move(box.x + 1000, box.y + 1000); await page.mouse.up();
    await page.getByRole('button', { name: '确认裁剪' }).click();
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('every avatar template renders and exports a portrait without clipping the photo', async () => {
  const templateFixture = `
    import React, { useRef, useState, useEffect } from 'react';
    import { createRoot } from 'react-dom/client';
    import Document from './views/ResumeEditor/components/ResumePdfDocument';
    import { buildResumeTemplatePreviewSnapshot } from './views/resumeTemplatePreviewFixture';
    import { RESUME_TEMPLATE_DEFINITIONS } from './constants/resumeTemplates';
    import { waitForResumeRenderReady } from './utils/resumeRenderReadiness';
    window.avatarTemplates = RESUME_TEMPLATE_DEFINITIONS.filter(t => t.hasAvatar).map(t => t.id);
    function Fixture() {
      const [id, setId] = useState(window.avatarTemplates[0]);
      const preview = useRef(null);
      window.selectTemplate = setId;
      useEffect(() => {
        const controller = new AbortController();
        window.templateReady = '';
        waitForResumeRenderReady(preview.current, {signal: controller.signal, deadlineMs: Date.now() + 10000})
          .then(() => {window.templateReady = id}).catch(error => {
            if (!controller.signal.aborted) window.templateError = error.message;
          });
        return () => controller.abort();
      }, [id]);
      return <Document snapshot={buildResumeTemplatePreviewSnapshot(id)} previewRef={preview} />;
    }
    createRoot(document.getElementById('root')).render(<Fixture />);
  `;
  const [{outputFiles}, css] = await Promise.all([
    build({stdin: {contents: templateFixture, loader: 'tsx', resolveDir: process.cwd()}, bundle: true,
      write: false, format: 'iife', platform: 'browser',
      define: {'process.env.NODE_ENV': '"development"', 'import.meta.env': '{}'} }),
    postcss([tailwindcss(tailwindConfig)]).process(readFileSync('styles/tailwind.css', 'utf8'), {from: 'styles/tailwind.css'}),
  ]);
  const browser = await chromium.launch({headless: true});
  try {
    const page = await browser.newPage({viewport: {width: 900, height: 1280}});
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('http://fixture.test/**', route => {
      const pathname = new URL(route.request().url()).pathname;
      if (!/^\/(fonts|resume-templates|resume-template-previews)\/[a-zA-Z0-9/_.-]+$/.test(pathname)) return route.abort();
      return route.fulfill({path: resolve('public', '.' + pathname)});
    });
    const baseCss = readFileSync('index.html', 'utf8').match(/<style>([\s\S]*?)<\/style>/)[1];
    await page.setContent('<!doctype html><base href="http://fixture.test/"><div id="root"></div>');
    await page.addStyleTag({content: css.css + baseCss});
    await page.addScriptTag({content: outputFiles[0].text});
    await page.waitForFunction(() => window.avatarTemplates?.length > 0);
    const templates = await page.evaluate(() => window.avatarTemplates);
    for (const id of templates) {
      await page.evaluate(id => window.selectTemplate(id), id);
      await page.waitForFunction(id => window.templateReady === id || !!window.templateError, id);
      assert.equal(await page.evaluate(() => window.templateError ?? ''), '', id);
      const avatar = page.locator('.rf-template-avatar');
      assert.equal(await avatar.count(), 1, id);
      const metrics = await avatar.evaluate(el => {
        const r = el.getBoundingClientRect(); const img = el.querySelector('img');
        const page = el.closest('.a4-preview').getBoundingClientRect();
        return {ratio: r.width / r.height, fit: getComputedStyle(img).objectFit,
          imageLoaded: img.naturalWidth > 0, radius: getComputedStyle(el).borderRadius,
          contained: r.left >= page.left && r.right <= page.right && r.top >= page.top && r.bottom <= page.bottom};
      });
      assert.ok(Math.abs(metrics.ratio - 3 / 4) < 0.002, id + ': 3:4 frame');
      assert.equal(metrics.fit, 'contain', id + ': full photo visible');
      assert.ok(metrics.imageLoaded, id);
      assert.ok(metrics.contained, id + ': portrait fits the page');
      assert.ok(!metrics.radius.includes('%'), id + ': portrait corners do not form a circle');
      if (process.env.RF_QA_SCREENSHOTS) {
        mkdirSync('.artifacts/portrait-qa', {recursive: true});
        await page.locator('.a4-preview[data-rf-template-id]').screenshot({path: '.artifacts/portrait-qa/' + id + '.png'});
      }
    }
    process.stdout.write('Verified ' + templates.length + ' portrait templates.\n');
    assert.ok(templates.length >= 20, 'covers all native and DeepHire avatar templates');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
