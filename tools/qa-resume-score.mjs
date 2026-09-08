// Local synthetic UI/export acceptance. No login, provider, or database calls.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const origin = process.env.RESUME_SCORE_QA_ORIGIN || 'http://127.0.0.1:5173';
if (!['localhost', '127.0.0.1'].includes(new URL(origin).hostname)) throw Error('QA must use a local fixture');
const output = resolve('docs/qa/resume-score-local');
mkdirSync(output, {recursive:true});
let browser;
for (const executablePath of [undefined, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe']) {
  if (executablePath && !existsSync(executablePath)) continue;
  try { browser = await chromium.launch({headless:true, ...(executablePath ? {executablePath} : {})}); break; } catch {}
}
if (!browser) throw Error('Chromium unavailable');
try {
  const page = await browser.newPage({viewport:{width:1280,height:900}});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const url = `${origin}/__dev/resume-template-preview?templateId=modern-slate&scoreReview=1`;
  await page.goto(url);
  await page.getByRole('heading',{name:'选择需要优化的模块'}).waitFor();
  assert.equal(await page.locator('[data-model-calls]').getAttribute('data-model-calls'), '0');
  assert.equal(await page.getByRole('button',{name:'优化所选模块（0）'}).isEnabled(),false);
  await page.screenshot({path:resolve(output,'desktop.png'),fullPage:true});
  await page.getByRole('checkbox',{name:'选择优化 个人总结',exact:true}).check();
  assert.equal(await page.locator('[data-model-calls]').getAttribute('data-model-calls'), '0');
  await page.getByRole('button',{name:'优化所选模块（1）'}).click();
  await page.getByRole('button',{name:'继续查看改写'}).click();
  assert.equal(await page.locator('[data-model-calls]').getAttribute('data-model-calls'), '1');
  await page.getByRole('radio',{name:'采用优化',exact:true}).click();
  await page.getByRole('button',{name:'应用所选修改',exact:true}).click();
  await page.getByText('内容已应用，原评分已过期。').waitFor();
  assert.equal(await page.locator('[data-model-calls]').getAttribute('data-model-calls'), '1');
  assert.equal(await page.locator('[data-score-module]').count(),0);
  await page.setViewportSize({width:390,height:844});
  await page.reload();
  await page.getByRole('heading',{name:'选择需要优化的模块'}).scrollIntoViewIfNeeded();
  await page.screenshot({path:resolve(output,'mobile.png')});
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true);
  await page.goto(`${url}&scorePrint=1`);
  await page.getByRole('heading',{name:'林澈',exact:true}).waitFor();
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.locator('[data-score-module]').count(),0);
  await page.pdf({path:resolve(output,'print.pdf'),printBackground:true,preferCSSPageSize:true});
  assert.deepEqual(errors,[]);
  writeFileSync(resolve(output,'checks.json'),JSON.stringify({fixtureOnly:true,desktop:true,mobile:true,emptySelectionCalls:0,planningCalls:1,skippedAnswerCalls:0,applyCallsToAI:0,exportAnnotationNodes:0,pageErrors:errors},null,2));
  console.log('Synthetic desktop/mobile flow and PDF generation passed.');
} finally { await browser.close(); }
