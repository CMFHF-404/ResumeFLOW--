import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { compileAgentFixture, startAgentHarness, mockAgentApi } from './agentPageHarness.mjs';
export const baselineDir=join(tmpdir(),'resumeflow-agent-friendly-baseline');
export const scenes=['DASHBOARD','EXPERIENCE_BANK','EDITOR','AI_ASSISTANT','guest','rename','confirm'];
export function sceneQuery(scene,theme) {
  return `?theme=${theme}&`+(['rename','confirm'].includes(scene)?`controls=1&dialog=${scene}`:scene==='guest'?'guest=1&view=EDITOR':`view=${scene}`);
}
export async function settle(page) {
  await page.waitForTimeout(1300);
  const params=new URL(page.url()).searchParams;
  if(params.get('view')==='EDITOR'&&!params.has('guest')) {
    await page.getByText(/^已保存 /).first().waitFor({state:'attached',timeout:10000});
  }
  await page.evaluate(()=>document.fonts.ready);
  await page.addStyleTag({content:'*,*::before,*::after { animation: none !important; transition: none !important; caret-color: transparent !important; }'});
  await page.mouse.move(0,0);
}
if(process.argv.includes('--capture')) {
  mkdirSync(baselineDir,{recursive:true});
  const bundle=process.argv.includes('--saved') ? JSON.parse(readFileSync(join(baselineDir,'bundle.json'),'utf8')) : await compileAgentFixture();
  bundle.js=bundle.js.replace('DEV: false','DEV: true');
  writeFileSync(join(baselineDir,'bundle.json'),JSON.stringify(bundle));
  const harness=await startAgentHarness(bundle);
  try {
    for(const width of [1440,390]) for(const theme of ['light','dark']) for(const scene of scenes) {
      const page=await harness.browser.newPage({viewport:{width,height:900}});
      await page.clock.setFixedTime(new Date('2026-09-11T00:00:00Z'));
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await mockAgentApi(page);await page.goto(harness.url+sceneQuery(scene,theme));await settle(page);
      await page.screenshot({path:join(baselineDir,`${scene}-${width}-${theme}.png`)});
      console.log(scene,width,theme,JSON.stringify(errors), (await page.locator('body').innerText()).slice(0,100));
      await page.close();
    }
  } finally {await harness.close();}
  console.log(baselineDir);
}
