import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { compileAgentFixture, startAgentHarness, mockAgentApi } from './helpers/agentPageHarness.mjs';
import { sceneQuery, scenes, settle } from './helpers/captureAgentBaseline.mjs';

test('browser agents operate the real UI through names, roles and item IDs', {timeout:180000}, async t=>{
  const harness=await startAgentHarness(await compileAgentFixture());
  t.after(()=>harness.close());
  const open=async(query='',width=1440)=>{
    const page=await harness.browser.newPage({viewport:{width,height:900}});
    page.setDefaultTimeout(10000);
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    const requests=await mockAgentApi(page);
    await page.clock.setFixedTime(new Date('2026-09-11T00:00:00Z'));
    await page.goto(harness.url+query);
    return {page,requests,errors};
  };
  for (const width of [1440,390]) await t.test(`dashboard filter names control the correct fields at ${width}px`,async()=>{
    const {page,errors}=await open('',width);
    try {
      await page.getByRole('button',{name:'筛选简历',exact:true}).click();
      const filters=page.locator('[data-dashboard-filter-popover="advanced"]');
      const sort=filters.getByRole('combobox',{name:'排序',exact:true});
      const time=filters.getByRole('combobox',{name:'创建时间',exact:true});
      const match=filters.getByRole('combobox',{name:'匹配度',exact:true});
      await sort.selectOption('match-asc');
      assert.equal(await time.inputValue(),'all');
      assert.equal(await match.inputValue(),'all');
      await time.selectOption('custom');
      const start=filters.getByLabel('开始日期',{exact:true});
      const end=filters.getByLabel('结束日期',{exact:true});
      await start.fill('2026-09-01');
      await end.fill('2026-09-11');
      assert.equal(await start.inputValue(),'2026-09-01');
      assert.equal(await end.inputValue(),'2026-09-11');
      await match.selectOption('custom');
      const min=filters.getByRole('spinbutton',{name:'最低匹配度',exact:true});
      const max=filters.getByRole('spinbutton',{name:'最高匹配度',exact:true});
      await min.fill('20');
      await max.fill('80');
      assert.equal(await min.inputValue(),'20');
      assert.equal(await max.inputValue(),'80');
      assert.equal(await sort.inputValue(),'match-asc');
      assert.equal(await time.inputValue(),'custom');
      assert.deepEqual(errors,[]);
    } finally {await page.close();}
  });
  await t.test('same-name resumes have distinct actions; rename validation and exactly one write',async()=>{
    const {page,requests,errors}=await open();
    try {
      const card=page.locator('[data-agent-item="resume-b"]:visible');
      await card.getByRole('button',{name:'更多操作 同名简历',exact:true}).click();
      await page.getByRole('button',{name:'重命名',exact:true}).click();
      const dialog=page.getByRole('dialog',{name:'重命名简历'});
      await dialog.getByRole('textbox',{name:'简历名称'}).fill(' ');
      await dialog.getByRole('button',{name:'保存',exact:true}).click();
      assert.equal(await dialog.getByRole('textbox').getAttribute('aria-invalid'),'true');
      assert.equal(await dialog.getByRole('alert').innerText(),'简历名称不能为空');
      assert.equal(requests.filter(r=>r.path==='/resumes/resume-b'&&r.method!=='GET').length,0);
      await dialog.getByRole('textbox').fill('已重命名');
      await dialog.getByRole('button',{name:'保存',exact:true}).click();
      await dialog.waitFor({state:'hidden'});
      assert.equal(requests.filter(r=>r.path==='/resumes/resume-b'&&r.method!=='GET').length,1);
      assert.equal(await page.locator('[data-agent-item="resume-a"]:visible').getByRole('button',{name:'打开 同名简历',exact:true}).count(),1);
      assert.deepEqual(errors,[]);
    } finally {await page.close();}
  });
  for(const width of [1440,390]) await t.test(`navigation, profile labels and scoped save at ${width}px`,async()=>{
    const {page,requests,errors}=await open('',width);
    try {
      const nav=page.getByRole('navigation',{name:'主导航'});
      await nav.getByRole('button',{name:'经历库',exact:true}).click();
      assert.equal(await nav.getByRole('button',{name:'经历库',exact:true}).getAttribute('aria-current'),'page');
      const main=page.getByRole('main',{name:'经历库'});
      await main.getByRole('button',{name:'编辑',exact:true}).click();
      const field=main.getByRole('textbox',{name:'姓名',exact:true});
      assert.equal(await field.count(),1);
      await field.fill('修改后的姓名');
      await main.getByRole('button',{name:'保存',exact:true}).click();
      await main.getByRole('button',{name:'编辑',exact:true}).waitFor();
      assert.equal(requests.filter(r=>r.path==='/profile'&&r.method!=='GET').length,1);
      await nav.getByRole('button',{name:'AI助理',exact:true}).click();
      await page.getByRole('textbox',{name:'消息输入'}).fill('保留我的草稿');
      const [chooser]=await Promise.all([page.waitForEvent('filechooser'),page.getByRole('button',{name:'添加经历或附件'}).click().then(()=>page.getByRole('button',{name:'上传附件',exact:true}).click())]);
      await chooser.setFiles({name:'fixture.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')});
      assert.equal(await page.getByRole('textbox',{name:'消息输入'}).inputValue(),'保留我的草稿');
      await page.getByText('fixture.png',{exact:true}).waitFor();
      assert.deepEqual(errors,[]);
    } finally {await page.close();}
  });
  await t.test('keyboard, rich text, date picker and shared dialogs use existing handlers',async()=>{
    const {page,errors}=await open('?controls=1');
    try {
      await page.getByRole('textbox',{name:'经历描述'}).fill('修改后的经历');
      assert.equal(await page.getByRole('textbox',{name:'经历描述'}).innerText(),'修改后的经历');
      assert.equal(await page.getByRole('textbox',{name:'经历描述'}).getAttribute('aria-multiline'),'true');
      await page.getByRole('button',{name:'开始月份',exact:true}).press('Space');
      assert.equal(await page.getByRole('button',{name:'开始月份',exact:true}).getAttribute('aria-expanded'),'true');
      await page.getByRole('button',{name:'清除开始月份'}).click();
      assert.equal(await page.getByRole('button',{name:'开始月份',exact:true}).getAttribute('data-agent-value'),'');
      await page.getByRole('textbox',{name:'消息输入'}).fill('你好');
      await page.getByRole('button',{name:'发送消息',exact:true}).press('Enter');
      assert.equal(await page.getByRole('status',{name:'发送次数'}).innerText(),'1');
      await page.getByRole('button',{name:'删除简历',exact:true}).click();
      const dialog=page.getByRole('dialog',{name:'删除简历'});
      await dialog.getByRole('button',{name:'取消',exact:true}).click();
      assert.equal(await dialog.count(),0);
      assert.deepEqual(errors,[]);
    } finally {await page.close();}
  });
  await t.test('nested delete does not expand a card; keyboard opens labelled fields and save is observable',async()=>{
    const {page,errors}=await open('?experience=1');
    try {
      const card=page.getByRole('group',{name:'同名公司',exact:true});
      await card.getByRole('button',{name:'删除',exact:true}).press('Enter');
      assert.equal(await page.getByRole('status',{name:'删除次数'}).innerText(),'1');
      assert.equal(await card.getAttribute('data-agent-state'),'collapsed');
      await card.getByRole('button',{name:'展开 同名公司',exact:true}).press('Control+Enter');
      assert.equal(await card.getAttribute('data-agent-state'),'collapsed');
      await card.getByRole('button',{name:'展开 同名公司',exact:true}).press('Space');
      await card.getByRole('textbox',{name:'公司名称'}).fill('更新公司');
      await page.locator('[data-agent-item="experience-a"]').getByRole('textbox',{name:'职位名称'}).fill('更新职位');
      const updated=page.locator('[data-agent-item="experience-a"]');
      await updated.getByRole('button',{name:/保存/}).click();
      assert.equal(await updated.getAttribute('aria-busy'),'true');
      assert.equal(await page.getByRole('status',{name:'保存次数'}).innerText(),'1');
      await page.waitForFunction(()=>document.querySelector('[data-agent-item="experience-a"]').getAttribute('aria-busy')==='false');
      assert.deepEqual(errors,[]);
    } finally {await page.close();}
  });
  await t.test('editor template selection persists and PDF action downloads once',async()=>{
    const {page,requests,errors}=await open('?view=EDITOR');
    try {
      await page.getByRole('main',{name:'简历工厂'}).waitFor();
      assert.equal(await page.getByRole('button',{name:/^选择.*模板$/}).count(),0,'inactive template pane is not exposed');
      await page.getByRole('button',{name:'模板选择',exact:true}).click();
      const template=page.getByRole('button',{name:/^选择.*模板$/,pressed:false}).first();
      const templateName=await template.getAttribute('aria-label');
      const templateId=await template.locator('xpath=ancestor::article').getAttribute('data-agent-item');
      const [saved]=await Promise.all([
        page.waitForResponse(response=>response.request().method()==='PATCH'&&response.url().includes('/resumes/')&&JSON.stringify(response.request().postDataJSON()).includes(templateId)),
        template.click(),
      ]);
      assert.equal(saved.ok(),true);
      assert.equal(await page.getByRole('button',{name:templateName,exact:true}).getAttribute('aria-pressed'),'true');
      await page.getByRole('status',{name:'保存状态'}).filter({hasText:'已保存'}).waitFor();
      assert.equal(await page.getByRole('main').count(),1);
      const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'导出 PDF',exact:true}).click()]);
      assert.equal(download.suggestedFilename(),'fixture.pdf');
      assert.equal(requests.filter(r=>r.path==='/exports/resume-pdf-link').length,1);
      assert.deepEqual(errors,[]);
    } finally {await page.close();}
  });
  await t.test('pending and failed rename stay observable without an extra write',async()=>{
    const {page,errors}=await open();
    let release;
    const responseGate=new Promise(resolve=>{release=resolve;});
    let started;
    const requestStarted=new Promise(resolve=>{started=resolve;});
    let writes=0;
    await page.route('**/api/resumes/resume-b',async route=>{
      if(route.request().method()!=='PATCH')return route.fallback();
      writes++;started();await responseGate;
      await route.fulfill({status:503,json:{detail:'模拟保存失败'}});
    });
    try {
      await page.locator('[data-agent-item="resume-b"]:visible').getByRole('button',{name:'更多操作 同名简历',exact:true}).click();
      await page.getByRole('button',{name:'重命名',exact:true}).click();
      const dialog=page.getByRole('dialog',{name:'重命名简历'});
      await dialog.getByRole('textbox',{name:'简历名称'}).fill('失败时保留草稿');
      await dialog.getByRole('button',{name:'保存',exact:true}).click();
      await requestStarted;
      assert.equal(await dialog.getAttribute('aria-busy'),'true');
      assert.equal(await dialog.getByRole('button',{name:'保存中...'}).isDisabled(),true);
      release();
      await page.getByRole('alert').filter({hasText:'重命名失败'}).waitFor();
      assert.equal(await dialog.getAttribute('aria-busy'),'false');
      assert.equal(await dialog.getByRole('textbox').inputValue(),'失败时保留草稿');
      assert.equal(writes,1);assert.deepEqual(errors,[]);
    } finally {release();await page.close();}
  });
});

test('optional before/after visual matrix of real pages and shared dialogs', {timeout:180000},async t=>{
  const baseline=process.env.AGENT_VISUAL_BASELINE;
  if(!baseline) {t.skip('Set AGENT_VISUAL_BASELINE to the pre-change capture directory.');return;}
  const output=join(tmpdir(),'resumeflow-agent-friendly-current');mkdirSync(output,{recursive:true});
  const harness=await startAgentHarness(await compileAgentFixture());t.after(()=>harness.close());
  for(const width of [1440,390])for(const theme of ['light','dark'])for(const scene of scenes)await t.test(`${scene} ${width} ${theme}`,async()=>{
    const name=`${scene}-${width}-${theme}.png`, path=join(baseline,name);
    assert.ok(existsSync(path),'Capture the baseline before implementation.');
    const page=await harness.browser.newPage({viewport:{width,height:900}});
    try {
      await page.clock.setFixedTime(new Date('2026-09-11T00:00:00Z'));await mockAgentApi(page);
      await page.goto(harness.url+sceneQuery(scene,theme));await settle(page);
      const actual=await page.screenshot({path:join(output,name)});
      const previous=await sharp(readFileSync(path)).raw().toBuffer();
      const current=await sharp(actual).raw().toBuffer();
      assert.equal(current.length,previous.length);
      let changed=0;for(let i=0;i<current.length;i++)if(Math.abs(current[i]-previous[i])>1)changed++;
      assert.equal(changed,0,`${changed} changed channels; inspect ${join(output,name)}`);
    } finally {await page.close();}
  });
});
