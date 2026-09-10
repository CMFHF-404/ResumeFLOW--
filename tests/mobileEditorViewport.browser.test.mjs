import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import { chromium } from 'playwright';
import tailwindConfig from '../tailwind.config.cjs';

// Real layout components and drawer lifecycle, with account-dependent sidebar
// content replaced by a text field. This is not real browser-chrome/IME QA.
const fixture = `
import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import AppViewport from './components/AppViewport';
import ResumeEditorViewport from './views/ResumeEditor/components/ResumeEditorViewport';
import Drawer from './views/ResumeEditor/components/ResumeEditorMobileDrawer';
import Reports from './views/ResumeEditor/components/MobileWorkbenchReports';
import { useMobileEditorDrawer } from './views/ResumeEditor/hooks/useMobileEditorDrawer';
function Fixture() {
  const [editor, setEditor] = useState(true);
  const [busy, setBusy] = useState(true);
  const scrollRef = useRef(null);
  const drawer = useMobileEditorDrawer({ scrollContainerRef: scrollRef,
    mobileDrawerOpenRequest: 0, onMobileDrawerOpenRequestConsumed() {}, setSidebarTab() {} });
  window.switchEditor = setEditor;
  window.setEditorBusy = setBusy;
  window.openWorkbench = drawer.open;
  window.closeWorkbench = drawer.close;
  return <AppViewport isEditor={editor}>
    <nav style={{height: 72, flexShrink: 0}}>原子简历 · 布局验证</nav>
    <div className="flex min-h-0 min-w-0 flex-1">
      {editor ? <ResumeEditorViewport busy={busy} scrollContainerRef={scrollRef} onKeyDownCapture={event => {
        if (event.key === 'Escape' && window.interceptEscape) {
          event.preventDefault(); event.stopPropagation(); window.escapeCaptured = true;
        }
      }} workbench={
        <Drawer {...drawer} busy={busy} onOpen={drawer.open} onClose={drawer.close} sidebarProps={{}}
          analysis={<Reports reportTab={drawer.reportTab} onSelectReport={drawer.setReportTab} panel={{
            hasJdContext: true, jdContextText: 'AI 产品实习生', isOutdated: true,
            analysisResult: {matchPercentage: 84, summary: '移动报告验证', jdInterpretation: {normalizedTitle: 'AI 产品实习生'}},
          }} />} assistant={<textarea aria-label="助手输入" />} />
      }>
        <div style={{flexShrink: 0, padding: '16px 16px calc(5rem + env(safe-area-inset-bottom, 0px))'}}>
          <h1>长简历滚动验证</h1>
          {Array.from({length: 35}, (_, i) => <p key={i} style={{height: 64}}>工作经历 {i + 1}</p>)}
          <p data-last-line>简历最后一行</p>
        </div>
        {busy && <div data-loading-overlay className="absolute inset-0 z-20 flex items-center justify-center bg-white/70 backdrop-blur-[1px]">正在加载简历...</div>}
      </ResumeEditorViewport> : <p>已离开编辑页</p>}
    </div>
  </AppViewport>;
}
const root = createRoot(document.getElementById('root'));
window.unmountFixture = () => root.unmount();
root.render(<React.StrictMode><Fixture /></React.StrictMode>);
`;

test('mobile app isolates scroll across views and keeps drawer viewport adaptation', async () => {
  const [{ outputFiles }, css] = await Promise.all([
    build({
      stdin: { contents: fixture, loader: 'tsx', resolveDir: process.cwd() },
      bundle: true, write: false, format: 'iife', platform: 'browser',
      define: { 'process.env.NODE_ENV': '"development"' },
      plugins: [{ name: 'account-free-sidebar', setup(build) {
        build.onResolve({ filter: /^\.\/EditorSidebar$/ }, () => ({ path: 'sidebar', namespace: 'fixture' }));
        build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          contents: `import React from 'react'; export default () => <textarea aria-label="个人信息输入" />;`,
          loader: 'tsx', resolveDir: process.cwd(),
        }));
      } }],
    }),
    postcss([tailwindcss(tailwindConfig)]).process(readFileSync('styles/tailwind.css', 'utf8'), { from: 'styles/tailwind.css' }),
  ]);
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 740 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<!doctype html><html><head><title>移动编辑器布局验证</title></head><body class="h-screen"><div id="root"></div></body></html>');
    await page.addStyleTag({ content: css.css });
    await page.addScriptTag({ content: outputFiles[0].text });
    const scroller = page.locator('[data-rf-mobile-editor-scroll-root]');
    const dock = page.locator('[data-mobile-workbench-dock]');
    await dock.waitFor();
    const workbenchButton = page.getByRole('button', { name: '工作台', exact: true });
    assert.equal(await workbenchButton.isDisabled(), true, 'loading disables the workbench entry');
    const busyDock = await workbenchButton.boundingBox();
    await page.mouse.click(busyDock.x + busyDock.width / 2, busyDock.y + busyDock.height / 2);
    assert.equal(await page.getByRole('dialog').count(), 0, 'pointer input cannot open the workbench while loading');
    await page.evaluate(() => window.setEditorBusy(false));
    await page.waitForFunction(() => !document.querySelector('[data-loading-overlay]'));
    assert.equal(await workbenchButton.isEnabled(), true);
    const initialDock = await dock.boundingBox();
    assert.ok(initialDock);
    assert.equal(await page.title(), '移动编辑器布局验证');
    assert.equal(await page.locator('h1').innerText(), '长简历滚动验证');
    const metrics = () => page.evaluate(() => {
      const scroll = document.querySelector('[data-rf-mobile-editor-scroll-root]');
      return {
        htmlOverflow: getComputedStyle(document.documentElement).overflowY,
        bodyOverflow: getComputedStyle(document.body).overflowY,
        appHeight: document.querySelector('.rf-app-viewport').getBoundingClientRect().height,
        scrollTop: scroll.scrollTop, scrollHeight: scroll.scrollHeight, clientHeight: scroll.clientHeight,
        containment: getComputedStyle(scroll).overscrollBehaviorY,
        documentTop: document.scrollingElement.scrollTop,
      };
    });
    assert.equal((await metrics()).htmlOverflow, 'hidden');
    assert.equal((await metrics()).bodyOverflow, 'hidden');
    assert.equal((await metrics()).appHeight, 740);
    assert.equal((await metrics()).containment, 'contain');
    await scroller.hover();
    await page.mouse.wheel(0, 600);
    await page.waitForFunction(() => document.querySelector('[data-rf-mobile-editor-scroll-root]').scrollTop > 0);
    await scroller.evaluate(el => { el.scrollTop = el.scrollHeight; });
    await page.mouse.wheel(0, 1000);
    await page.waitForTimeout(200);
    const bottom = await metrics();
    assert.equal(bottom.documentTop, 0);
    assert.equal(bottom.scrollTop, bottom.scrollHeight - bottom.clientHeight);
    assert.deepEqual(await dock.boundingBox(), initialDock);
    const lastLine = await page.locator('[data-last-line]').boundingBox();
    assert.ok(lastLine.y + lastLine.height <= initialDock.y, 'last line clears the workbench dock');

    const focusedBeforeEntry = await workbenchButton.evaluate(async button => {
      button.click();
      await new Promise(requestAnimationFrame);
      return document.activeElement?.hasAttribute('data-workbench-close');
    });
    assert.equal(focusedBeforeEntry, false, 'opening must not focus an off-screen translated control');
    await page.getByRole('dialog').waitFor();
    assert.equal(await scroller.evaluate(el => el.style.overflow), 'hidden');
    await page.getByRole('textbox', { name: '个人信息输入' }).fill('键盘避让回归');
    await page.evaluate(() => { window.interceptEscape = true; });
    await page.getByRole('textbox', { name: '个人信息输入' }).press('Escape');
    assert.equal(await page.evaluate(() => window.escapeCaptured), true, 'portal Escape reaches the editor capture handler');
    assert.equal(await page.getByRole('dialog').isVisible(), true);
    await page.evaluate(() => { window.interceptEscape = false; });
    await page.getByRole('tab', { name: 'AI 助手', exact: true }).click();
    await page.getByRole('textbox', { name: '助手输入' }).fill('保留草稿');
    await page.getByRole('tab', { name: '个人信息', exact: true }).click();
    assert.equal(await page.getByRole('textbox', { name: '个人信息输入' }).inputValue(), '键盘避让回归');

    await page.evaluate(() => window.setEditorBusy(true));
    await page.waitForFunction(() => document.querySelector('[data-loading-overlay]'));
    assert.equal(await workbenchButton.isDisabled(), true);
    assert.equal(await page.getByRole('dialog').isVisible(), false, 'an already-open workbench is unavailable while loading');
    await page.evaluate(() => window.setEditorBusy(false));
    await page.getByRole('dialog').waitFor();
    assert.equal(await page.getByRole('textbox', { name: '个人信息输入' }).inputValue(), '键盘避让回归');

    await page.getByRole('tab', { name: '分析报告', exact: true }).click();
    await page.locator('#jd-report-panel').waitFor();
    await page.locator('#mobile-jd-report-panel').evaluate(el => { el.scrollTop = 80; });
    const reportScroll = await page.locator('#mobile-jd-report-panel').evaluate(el => el.scrollTop);
    // Frame samples catch nested opacity restarts and a dark backdrop left behind
    // after the sheet has already finished closing.
    for (let cycle = 0; cycle < 3; cycle++) {
      const closeFrames = await page.evaluate(async () => {
        const overlay = document.querySelector('[data-mobile-workbench-overlay]');
        const backdrop = overlay.firstElementChild;
        const frames = [];
        window.closeWorkbench();
        const started = performance.now();
        while (performance.now() - started < 300) {
          await new Promise(requestAnimationFrame);
          frames.push({ visible: getComputedStyle(overlay).visibility === 'visible', opacity: Number(getComputedStyle(backdrop).opacity) });
        }
        return frames;
      });
      assert.ok(closeFrames.some(frame => frame.opacity > 0 && frame.opacity < 1), 'backdrop fades instead of snapping');
      const lastVisible = closeFrames.filter(frame => frame.visible).at(-1);
      assert.ok(lastVisible.opacity < .15, 'backdrop is nearly transparent before the overlay is hidden');
      assert.equal(closeFrames.at(-1).visible, false);
      await page.evaluate(() => window.openWorkbench('analysis'));
      await page.locator('#jd-report-panel').waitFor();
      assert.equal(await page.locator('#jd-report-panel').evaluate(el => getComputedStyle(el).animationName), 'none');
      assert.equal(await page.locator('#mobile-jd-report-panel').evaluate(el => getComputedStyle(el).animationName), 'none');
      assert.equal(await page.locator('#mobile-jd-report-panel').evaluate(el => el.scrollTop), reportScroll);
      await page.waitForTimeout(250);
    }
    await page.evaluate(() => window.closeWorkbench());
    await page.waitForTimeout(50);
    await page.evaluate(() => window.openWorkbench('analysis'));
    await page.waitForTimeout(280);
    assert.equal(await page.getByRole('dialog').isVisible(), true, 'a pending close cannot hide a reopened report');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(() => window.closeWorkbench());
    await page.waitForFunction(() => document.querySelector('[data-mobile-workbench-overlay]').style.visibility === 'hidden');
    await page.evaluate(() => window.openWorkbench('analysis'));
    await page.getByRole('dialog').waitFor();
    await page.waitForTimeout(60);
    assert.equal(await page.getByRole('dialog').evaluate(el => getComputedStyle(el).transitionProperty), 'none');
    await page.emulateMedia({ reducedMotion: 'no-preference' });

    // Browser chrome resize while reading must not change the sheet geometry.
    const reportBounds = await page.getByRole('dialog').boundingBox();
    await page.evaluate(() => {
      Object.defineProperty(window.visualViewport, 'height', { configurable: true, value: 420 });
      window.visualViewport.dispatchEvent(new Event('resize'));
    });
    await page.waitForTimeout(60);
    assert.deepEqual(await page.getByRole('dialog').boundingBox(), reportBounds);
    // Keyboard avoidance is still active for an actual focused input.
    await page.getByRole('tab', { name: '个人信息', exact: true }).click();
    await page.getByRole('textbox', { name: '个人信息输入' }).focus();
    await page.waitForFunction(() => document.querySelector('[role="dialog"]').getBoundingClientRect().height === 412);
    assert.equal((await metrics()).appHeight, 740);
    assert.deepEqual(await dock.boundingBox(), initialDock);
    await page.getByRole('button', { name: '收起工作台' }).click();
    await page.waitForFunction(() => document.querySelector('[data-rf-mobile-editor-scroll-root]').style.overflow === '');
    assert.equal((await metrics()).scrollTop, bottom.scrollTop);
    await scroller.evaluate(el => { el.scrollTop = 0; });
    await page.mouse.move(150, 200);
    await page.mouse.wheel(0, -1000);
    await page.waitForTimeout(200);
    assert.equal((await metrics()).documentTop, 0);

    await page.setViewportSize({ width: 767, height: 600 });
    assert.equal((await metrics()).htmlOverflow, 'hidden');
    assert.equal((await metrics()).appHeight, 600);
    await page.setViewportSize({ width: 768, height: 600 });
    assert.equal((await metrics()).htmlOverflow, 'visible');
    assert.equal((await metrics()).bodyOverflow, 'visible');
    assert.equal(await dock.isVisible(), false);
    await page.setViewportSize({ width: 390, height: 740 });
    await page.emulateMedia({ media: 'print' });
    assert.equal((await metrics()).htmlOverflow, 'visible');
    await page.emulateMedia({ media: 'screen' });
    assert.equal((await metrics()).htmlOverflow, 'hidden');
    await page.evaluate(() => window.switchEditor(false));
    await page.getByText('已离开编辑页').waitFor();
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).overflowY), 'hidden');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('nav')).touchAction), 'pan-x pinch-zoom');
    await page.evaluate(() => window.switchEditor(true));
    await dock.waitFor();
    assert.equal((await metrics()).htmlOverflow, 'hidden');
    if (process.env.QA_SCREENSHOT_PATH) await page.screenshot({ path: process.env.QA_SCREENSHOT_PATH });
    await page.evaluate(() => window.unmountFixture());
    assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-rf-app-viewport')), false);
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).overflowY), 'visible');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
