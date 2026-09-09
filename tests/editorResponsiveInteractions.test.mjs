import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import postcss from 'postcss';
import tailwind from 'tailwindcss';

async function browserFor(t) {
  const candidates = process.platform === 'win32' ? [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ].filter(existsSync) : [];
  for (const executablePath of [undefined, ...candidates]) {
    try { return await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) }); }
    catch { /* Try an existing system browser. */ }
  }
  t.skip('Requires an installed Chromium runtime.');
}

async function mount(page, contents) {
  const bundle = await build({ stdin: { contents, loader: 'tsx', resolveDir: process.cwd() },
    bundle: true, write: false, format: 'iife', platform: 'browser',
    define: { 'process.env.NODE_ENV': '"production"' } });
  await page.setContent('<title>Editor interaction regression</title><div id="root"></div>');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
}

test('compact menu delete and polish hit the intended unselected card', async t => {
  const browser = await browserFor(t); if (!browser) return;
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await mount(page, `import React from 'react'; import {createRoot} from 'react-dom/client';
      import Card from './views/ResumeEditor/components/ExperienceList/ExperienceCard';
      window.actions=[]; const noop=()=>{};
      createRoot(document.getElementById('root')).render(<div className="space-y-3 p-3">
        {['first','second','third'].map(id=><Card key={id} compact
          item={{id,company:id,title:'产品经理',date:'2024.01 - 至今',category:'work'}}
          isSelected={false} themeStyles={{}} onToggleSelection={noop}
          onDelete={()=>window.actions.push('delete-'+id)} onEdit={()=>window.actions.push('edit-'+id)}
          onPolish={()=>window.actions.push('polish-'+id)} deletingIds={new Set()} staleExperienceIds={new Set()}/>)}</div>);`);
    const css = await postcss([tailwind('./tailwind.config.cjs')]).process('@tailwind base; @tailwind utilities;', { from: undefined });
    await page.addStyleTag({ content: css.css });
    for (const [name, action] of [['删除', 'delete-first'], ['AI 润色', 'polish-first']]) {
      await page.getByRole('button', { name: '更多经历操作' }).first().click();
      const box = await page.getByRole('button', { name, exact: true }).boundingBox();
      assert.ok(box);
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      assert.equal(await page.evaluate(() => window.actions.at(-1)), action);
    }
    assert.deepEqual(await page.evaluate(() => window.actions), ['delete-first', 'polish-first']);
  } finally { await browser.close(); }
});

test('assistant portal preserves a pending draft through breakpoint changes and resets for a new owner', async t => {
  const browser = await browserFor(t); if (!browser) return;
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 844 } });
    await mount(page, `import React,{useState,useEffect} from 'react'; import {createRoot} from 'react-dom/client';
      import Portal from './views/ResumeEditor/components/PersistentAssistantPortal';
      window.mounts=0; window.unmounts=0;
      function Assistant(){const [text,setText]=useState(''); const [done,setDone]=useState(false);
        useEffect(()=>{window.mounts++;const timer=setTimeout(()=>setDone(true),500);return()=>{window.unmounts++;clearTimeout(timer);};},[]);
        return <><textarea aria-label="draft" value={text} onChange={e=>setText(e.target.value)}/><span>{done?'complete':'pending'}</span></>;}
      function App(){const [mobile,setMobile]=useState(innerWidth<768);const [owner,setOwner]=useState('a');
        const [desktopSlot,setDesktopSlot]=useState(null);const [mobileSlot,setMobileSlot]=useState(null);
        useEffect(()=>{const resize=()=>setMobile(innerWidth<768);window.addEventListener('resize',resize);return()=>window.removeEventListener('resize',resize);},[]);
        return <><button onClick={()=>setOwner('b')}>switch owner</button>
          {mobile?<div key="mobile" data-slot="mobile" ref={setMobileSlot}/>:<div key="desktop" data-slot="desktop" ref={setDesktopSlot}/>}
          <Portal key={owner} container={mobile?mobileSlot:desktopSlot}><Assistant/></Portal></>;}
      createRoot(document.getElementById('root')).render(<App/>);`);
    await page.getByRole('textbox').fill('尚未发送的简历问题');
    for (const width of [390, 1000, 390, 1000]) {
      await page.setViewportSize({ width, height: 844 });
      const slot = width < 768 ? 'mobile' : 'desktop';
      await page.locator(`[data-slot="${slot}"] textarea`).waitFor();
      assert.equal(await page.getByRole('textbox').inputValue(), '尚未发送的简历问题');
    }
    await page.getByText('complete', { exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => [window.mounts, window.unmounts]), [1, 0]);
    await page.getByRole('button', { name: 'switch owner' }).click();
    assert.equal(await page.getByRole('textbox').inputValue(), '');
    assert.deepEqual(await page.evaluate(() => [window.mounts, window.unmounts]), [2, 1]);
  } finally { await browser.close(); }
});

test('editor uses one persistent assistant for both layout slots', () => {
  const source = readFileSync(new URL('../views/ResumeEditor/index.tsx', import.meta.url), 'utf8');
  assert.equal((source.match(/<AIAssistant\b/g) ?? []).length, 1);
  assert.match(source, /container=\{isMobileAnalysisViewport \? mobileAssistantContainer : desktopAssistantContainer\}/);
  assert.match(source, /ref=\{setDesktopAssistantContainer\}/);
  assert.match(source, /ref=\{setMobileAssistantContainer\}/);
  assert.match(source, /surface=\{isMobileAnalysisViewport \? 'workbench' : 'sidebar'\}/);
  assert.match(source, /matches && isAssistantSidebarMounted/);
});
