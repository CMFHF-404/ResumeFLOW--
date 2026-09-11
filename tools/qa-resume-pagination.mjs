import assert from 'node:assert/strict';
import {readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {createServer} from 'vite';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import tailwindConfig from '../tailwind.config.cjs';
import {chromium} from 'playwright';
import {spawnSync} from 'node:child_process';

const cases = ['geometry', ...['modern-slate','avatar-split','timeline-blue'].flatMap(id=>[`short-${id}`,`long-${id}`]), 'resources', 'heading', 'boundary', ...['none','ordered','unordered'].map(id=>`natural-${id}`)];
const currentCase = process.env.PAGINATION_CASE;
if (!currentCase) {
  for (const name of cases) {
    const run=spawnSync(process.execPath,['tools/qa-resume-pagination.mjs'],{env:{...process.env,PAGINATION_CASE:name},encoding:'utf8',timeout:90000});
    process.stdout.write(run.stdout || '');
    process.stderr.write(run.stderr || '');
    assert.equal(run.status,0,`${name}: ${run.error?.message || 'failed'}`);
  }
  console.log(`All ${cases.length} pagination scenarios passed.`);
  process.exit(0);
}
const output = 'artifacts/resume-pagination';
mkdirSync(output,{recursive:true});
// Reuse production index styles and real components through a local Vite entry.
const [{outputFiles},css] = await Promise.all([
  build({entryPoints:['tools/fixtures/resume-pagination/main.tsx'],bundle:true,write:false,format:'iife',loader:{'.css':'empty'},define:{'process.env.NODE_ENV':'"development"'}}),
  postcss([tailwindcss(tailwindConfig)]).process(readFileSync('styles/tailwind.css','utf8'),{from:'styles/tailwind.css'}),
]);
const html = readFileSync('index.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'')
  .replace('</head>',`<style>${css.css}</style></head>`);
const server = await createServer({configFile:false,optimizeDeps:{noDiscovery:true},server:{host:'127.0.0.1',port:5187},plugins:[{
  name:'pagination-fixture',configureServer(server){
    server.middlewares.use('/fonts',(req,res)=>{
      const name=req.url.split('?')[0].split('/').pop();
      if (!['Arial.ttf','Arial-Bold.ttf','NotoSansSC-VF.ttf'].includes(name)) {res.statusCode=404;res.end();return;}
      res.setHeader('Content-Type','font/ttf');res.end(readFileSync(`public/fonts/${name}`));
    });
    server.middlewares.use('/pagination-qa',(req,res)=>{
    res.setHeader('Content-Type','text/html');res.end(html);
  });},
}]});
await server.listen();
const launch = () => chromium.launch({headless:true,...(process.env.PAGINATION_BROWSER ? {executablePath:process.env.PAGINATION_BROWSER}: {})});
let browser;
const results=[];
try {
  let page;
  const freshPage = async () => {
  browser=await launch();
  page=await browser.newPage();
  page.on('pageerror',error=>console.error(error));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/,route=>route.abort());
  await page.route('**/fonts/*.ttf',route=>{
    const name=new URL(route.request().url()).pathname.split('/').pop();
    return route.fulfill({contentType:'font/ttf',body:readFileSync(`public/fonts/${name}`)});
  });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/pagination-qa`,{waitUntil:'domcontentloaded'});
  await page.addScriptTag({content:outputFiles[0].text});
  await page.waitForFunction(()=>window.paginationQA && document.querySelector('#pdf .a4-preview'));
  await page.addStyleTag({content:'@media print { #measure { display:none!important; } }'});
  };
  await freshPage();
  if(currentCase==='geometry') {
  for (const templateId of ['modern-slate','avatar-split','timeline-blue']) {
    await page.evaluate(id=>window.paginationQA.render({templateId:id}),templateId);
    for (const scope of ['measure','pdf']) assert.equal(await page.evaluate(s=>window.paginationQA.measure(s).fits,scope),true,`${templateId} short ${scope}`);
  }
  await page.evaluate(()=>window.paginationQA.render());
  for (const delta of [-4,-2.5,-2,-1.5,-1,-0.5,0,0.5,1,1.5,2,2.5,4]) {
    const readings = await page.evaluate(delta=>{
      return ['measure','pdf'].map(scope=>{
        const root=document.querySelector(`#${scope} .rf-template-content-layout`);
        root.querySelector('[data-rf-print-flow="probe"]')?.remove();
        const node=document.createElement('div');node.dataset.rfPrintFlow='probe';
        root.append(node);
        const bounds=window.paginationQA.measure(scope);
        const page=document.querySelector(`#${scope} .a4-preview`);
        node.style.height=`${bounds.printableBottom + delta - (node.getBoundingClientRect().top-page.getBoundingClientRect().top)}px`;
        return window.paginationQA.measure(scope);
      });
    },delta);
    for(const r of readings) assert.equal(r.fits,delta<=-2,`boundary ${delta}: ${JSON.stringify(r)}`);
    results.push({delta,readings});
  }
  await page.evaluate(()=>{for(const scope of ['measure','pdf'])document.querySelector(`#${scope} [data-rf-print-flow="probe"]`).style.height='2000px';});
  assert.equal(await page.evaluate(()=>window.paginationQA.measure('pdf').fits),false);
  assert.ok(await page.evaluate(()=>window.paginationQA.measure('pdf').printableBottom<1123));
  }
  const inspectPdf = async (name) => {
    await page.emulateMedia({media:'print'});
    await page.evaluate(()=>window.paginationQA.ready(document.querySelector('#pdf'),{signal:new AbortController().signal,deadlineMs:Date.now()+10000}));
    const cdp=await page.context().newCDPSession(page);
    const printed=await cdp.send('Page.printToPDF',{printBackground:true,preferCSSPageSize:true,paperWidth:210/25.4,paperHeight:297/25.4,marginTop:0,marginBottom:0,marginLeft:0,marginRight:0});
    writeFileSync(`${output}/${name}.pdf`,Buffer.from(printed.data,'base64'));
    await cdp.detach();
    const parsed=spawnSync(process.env.PYTHON || 'python',['-B','-c',
      'import json,sys; from pypdf import PdfReader; print(json.dumps([p.extract_text() for p in PdfReader(sys.argv[1]).pages],ensure_ascii=True))',`${output}/${name}.pdf`],{encoding:'utf8',timeout:10000});
    assert.equal(parsed.status,0,parsed.stderr);
    const rendered=spawnSync('pdftoppm',['-scale-to','1000','-png',`${output}/${name}.pdf`,`${output}/${name}-page`],{encoding:'utf8',timeout:10000});
    assert.equal(rendered.status,0,rendered.stderr);
    return JSON.parse(parsed.stdout);
  };
  for (const templateId of ['modern-slate','avatar-split','timeline-blue'].filter(id=>currentCase===`short-${id}`)) {
    await page.evaluate(id=>window.paginationQA.render({templateId:id}),templateId);
    assert.equal((await inspectPdf(`${templateId}-short`)).length,1,`${templateId} short PDF`);
  }
  // Long rich-text paragraphs and nested list items must remain in the flow.
  for (const templateId of ['modern-slate','avatar-split','timeline-blue'].filter(id=>currentCase===`long-${id}`)) {
    const tokens=Array.from({length:180},(_,i)=>`TOKEN${String(i).padStart(3,'0')}`);
    await page.evaluate(async ({templateId,tokens})=>{
      const qa=window.paginationQA;
      await qa.render({templateId,selectedWorkItems:[{...qa.snapshot.selectedWorkItems[0],star:{s:`<p>PARAGRAPH START</p><ol><li>${tokens.join(' repeat words for natural wrapping ')}</li><li>SECOND ITEM<ul><li>NESTED END</li></ul></li></ol>`,t:'',a:'',r:'FINAL END'}}]});
    },{templateId,tokens});
    const pages=await inspectPdf(`${templateId}-long-rich`);
    assert.ok(pages.length>=2,`${templateId} long body spans pages`);
    assert.deepEqual(pages.join('\n').match(/TOKEN\d+/g),tokens,`${templateId} long body tokens intact`);
    assert.ok(pages.at(-1).includes('FINAL END'));
  }
  if(currentCase==='resources') {
  await page.evaluate(()=>window.paginationQA.render({templateId:'avatar-split',profile:{...window.paginationQA.snapshot.profile,summary:'SIDE '.repeat(1800)}}));
  for(const scope of ['measure','pdf']) assert.equal(await page.evaluate(s=>window.paginationQA.measure(s).fits,scope),false,'long sidebar overflow');
  await page.evaluate(()=>window.paginationQA.render());
  await page.route('**/qa-delay.svg',async route=>{
    await new Promise(resolve=>setTimeout(resolve,180));
    await route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="80" height="180"><rect width="80" height="180" fill="blue"/></svg>'});
  });
  const resourceResult=await page.evaluate(async()=>{
    const root=document.querySelector('#pdf .rf-template-content-layout');
    const image=document.createElement('img');image.src='/qa-delay.svg';image.dataset.rfPrintFlow='probe';root.append(image);
    const before=image.getBoundingClientRect().height;
    await window.paginationQA.ready(root,{signal:new AbortController().signal,deadlineMs:Date.now()+5000});
    const after=image.getBoundingClientRect().height;
    return {before,after};
  });
  assert.ok(resourceResult.after>resourceResult.before,'readiness waits for delayed image geometry');
  await page.route('**/qa-font.ttf',async route=>{
    await new Promise(resolve=>setTimeout(resolve,180));
    await route.fulfill({contentType:'font/ttf',body:readFileSync('public/fonts/Arial.ttf')});
  });
  const fontResult=await page.evaluate(async()=>{
    const root=document.querySelector('#pdf');
    const face=new FontFace('QA delayed',`url(${location.origin}/qa-font.ttf)`);document.fonts.add(face);
    const probe=document.createElement('span');probe.textContent='i'.repeat(100);
    probe.style.cssText='display:inline-block;white-space:nowrap;font:20px "QA delayed",monospace';root.append(probe);
    const before=probe.getBoundingClientRect().width;
    await window.paginationQA.ready(root,{signal:new AbortController().signal,deadlineMs:Date.now()+5000});
    return {before,after:probe.getBoundingClientRect().width,status:face.status};
  });
  assert.equal(fontResult.status,'loaded');assert.ok(fontResult.after<fontResult.before,'cold font changes layout before readiness resolves');
  assert.equal(await page.evaluate(async()=>{
    const controller=new AbortController();controller.abort();
    try {await window.paginationQA.ready(document.querySelector('#pdf'),{signal:controller.signal,deadlineMs:Date.now()+1000});return false;} catch {return true;}
  }),true,'cancelled resources unavailable');
  }
  if(currentCase==='boundary') {
    await page.evaluate(()=>{
      const root=document.querySelector('#pdf .rf-template-content-layout');
      const node=document.createElement('div');node.dataset.rfPrintFlow='probe';root.append(node);
      const paper=document.querySelector('#pdf .a4-preview');
      const bounds=window.paginationQA.measure('pdf');
      node.style.height=`${bounds.printableBottom-2-(node.getBoundingClientRect().top-paper.getBoundingClientRect().top)}px`;
    });
    assert.equal(await page.evaluate(()=>window.paginationQA.measure('pdf').fits),true);
    assert.equal((await inspectPdf('safe-boundary')).length,1);
  }
  if(currentCase==='heading') {
    await page.evaluate(()=>{
      const work=document.querySelector('#pdf [data-rf-section-id="work"]');
      const paper=document.querySelector('#pdf .a4-preview');
      work.style.marginTop=`${1070-(work.getBoundingClientRect().top-paper.getBoundingClientRect().top)}px`;
    });
    const pages=await inspectPdf('heading-boundary');
    const headingPage=pages.findIndex(text=>text.includes('COMPANY'));
    assert.ok(headingPage>=0);assert.ok(pages[headingPage].includes('LINE 01'),'company/role stay with body opening');
  }
  for (const marker of ['none','ordered','unordered'].filter(id=>currentCase===`natural-${id}`)) {
    await page.evaluate(async marker=>{
      const qa=window.paginationQA;
      await qa.render({experienceListMarkerStyle:marker,selectedWorkItems:[{...qa.snapshot.selectedWorkItems[0],star:{s:'',t:'',a:Array.from({length:15},(_,i)=>`LINE ${String(i+1).padStart(2,'0')}`).join('\n'),r:''}}]});
      const work=document.querySelector('#pdf [data-rf-section-id="work"]');
      const paper=document.querySelector('#pdf .a4-preview');
      work.style.marginTop=`${900-(work.getBoundingClientRect().top-paper.getBoundingClientRect().top)}px`;
    },marker);
    const pages=await inspectPdf(`natural-${marker}`);
    assert.equal(pages.length,2,`${marker} pages`);
    assert.ok(pages[0].includes('LINE 01'),`${marker} body starts on page one`);
    assert.ok(pages[1].includes('LINE 15'),`${marker} body ends on page two`);
    assert.deepEqual(pages.join('\n').match(/LINE\s+\d+/g).map(s=>s.replace(/\s+/g,' ')),Array.from({length:15},(_,i)=>`LINE ${String(i+1).padStart(2,'0')}`));
    const expected=await page.locator('#pdf').innerText();
    const normalize=value=>value.normalize('NFKC').replace(/\d+\.(?=\s*LINE)/g,'').replace(/\s+/g,'');
    assert.equal(normalize(pages.join('\n')),normalize(expected),`${marker} full text intact`);
    if(marker==='ordered') {
      for(let i=1;i<=15;i++) assert.match(pages.join('\n'),new RegExp(`${i}\\.\\s*LINE\\s+${String(i).padStart(2,'0')}`));
    }
    if(marker==='none') {
      const legacy=await page.addStyleTag({content:'@media print {.rf-print-preview-shell [data-rf-section-id],.rf-print-preview-shell [data-rf-item-id]{break-inside:avoid!important;page-break-inside:avoid!important;}}'});
      const oldPages=await inspectPdf('legacy-policy-counterexample');
      assert.ok(!oldPages[0].includes('LINE 01'),'old policy moves the entire body');
      await legacy.evaluate(el=>el.remove());
    }
  }
  writeFileSync(`${output}/${currentCase}-results.json`,JSON.stringify({browser:browser.version(),results},null,2));
  console.log(`${currentCase} passed; Chromium ${browser.version()}`);
} catch(error) { console.error(error); process.exitCode=1; }
finally {
  server.httpServer.closeAllConnections();
  await Promise.race([Promise.all([browser?.close(),server.close()]),new Promise(resolve=>setTimeout(resolve,3000))]);
  process.exit(process.exitCode || 0);
}
