import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import { chromium } from 'playwright';
import tailwindConfig from '../tailwind.config.cjs';

test('template strip accepts native touch swipes without snapping or selecting a template', async () => {
  const [{outputFiles}, css] = await Promise.all([
    build({stdin: {contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import Strip from './views/ResumeEditor/components/MobileTemplateStrip';
      import {RESUME_TEMPLATE_DEFINITIONS} from './constants/resumeTemplates';
      window.selections = [];
      createRoot(document.getElementById('root')).render(<Strip selectedTemplateId={RESUME_TEMPLATE_DEFINITIONS[0].id}
        presets={{}} ready busy={false} fallbackAvailable={false} onFallback={() => {}}
        onSelect={id => window.selections.push(id)} onCustomize={() => {}} />);
    `, loader: 'tsx', resolveDir: process.cwd()}, bundle:true, write:false, format:'iife', platform:'browser',
      define:{'process.env.NODE_ENV':'"development"'}}),
    postcss([tailwindcss(tailwindConfig)]).process(readFileSync('styles/tailwind.css','utf8'),{from:'styles/tailwind.css'}),
  ]);
  const browser = await chromium.launch({headless:true});
  try {
    const page = await browser.newPage({viewport:{width:344,height:745},isMobile:true,hasTouch:true});
    const errors=[]; page.on('pageerror',e=>errors.push(e.message));
    await page.setContent('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>模板触摸验证</title><div id="root"></div>');
    // Exercise actual thumbnails without requesting an authenticated app session.
    await page.route('**/resume-templates/**', route => route.fulfill({status:200,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="104" height="146"><rect width="104" height="146" fill="white"/></svg>'}));
    await page.addStyleTag({content:css.css});
    await page.addScriptTag({content:outputFiles[0].text});
    const strip=page.locator('[data-mobile-template-strip] .overflow-x-auto');
    await strip.waitFor();
    assert.equal(await strip.evaluate(el=>getComputedStyle(el).scrollSnapType),'none');
    assert.equal(await strip.evaluate(el=>getComputedStyle(el).touchAction),'pan-x');
    const cdp=await page.context().newCDPSession(page);
    const swipe=async (y, stepDelay) => {
      await strip.evaluate(el=>{el.scrollLeft=120;});
      const start=await strip.evaluate(el=>el.scrollLeft);
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:295,y}]});
      for(let i=1;i<=7;i++) {
        await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:295-i*30,y:y+i}]});
        await page.waitForTimeout(stepDelay);
      }
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      await page.waitForTimeout(350);
      assert.ok((await strip.evaluate(el=>el.scrollLeft))-start>100,'both slow and fast diagonal swipes scroll freely');
    };
    const bounds=await strip.boundingBox();
    await swipe(bounds.y+60,16);
    await swipe(bounds.y+155,45);
    assert.deepEqual(await page.evaluate(()=>window.selections),[],'swiping over a card must not select it');
    assert.deepEqual(errors,[]);
  } finally {await browser.close();}
});
