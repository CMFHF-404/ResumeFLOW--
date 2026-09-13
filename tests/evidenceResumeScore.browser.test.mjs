import assert from 'node:assert/strict';
import {readFileSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import {chromium} from 'playwright';
import tailwindConfig from '../tailwind.config.cjs';

test('evidence report desktop/mobile: action plans without quotations, selection, manual actions and legacy viewing',async()=>{
  const data=JSON.parse(readFileSync('tests/fixtures/resume-evidence-v3.json','utf8'));
  data.assessmentContext.mode='jd';
  data.sources.push({sourceId:'synthetic-jd',path:'jd',text:'INTERNAL_JD_QUOTE_NOT_FOR_REPORT',kind:'text'});
  data.suggestions[0].jdSourceRefs=['synthetic-jd'];
  const manual={...data.suggestions[0],suggestionId:'suggestion-2',moduleType:'read_only',moduleId:'educations',fieldPath:'educations',label:'教育经历',action:'verify',editable:false};
  data.suggestions.push(manual);
  const [{outputFiles},css]=await Promise.all([
    build({stdin:{contents:`import React from 'react'; import {createRoot} from 'react-dom/client';
      import {ResumeScoreReport} from './views/ResumeEditor/components/ResumeEvaluationReport/ResumeScoreReport';
      import {ScoreAnnotationProvider} from './views/ResumeEditor/components/ResumeEvaluationReport/ScoreAnnotations';
      const r=${JSON.stringify(data)}; window.started=[];
      const root=createRoot(document.getElementById('root'));window.renderReport=(legacy=false)=>{
      const report=legacy?{...r,evaluationVersion:'resume_score_v2',scoringVersion:'single_pass_v1'}:r;
      root.render(<main className="mx-auto max-w-xl p-4"><ScoreAnnotationProvider reportKey={report.evaluationVersion} suggestions={report.suggestions}>
        <ResumeScoreReport report={report} outdated={false} enabled busy={false} canStart generating={false} onGenerate={()=>{}} onStart={ids=>window.started.push(ids)}/>
      </ScoreAnnotationProvider></main>)};window.renderReport();`,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,format:'iife',platform:'browser',
      define:{'process.env.NODE_ENV':'"development"','import.meta.env':'{"VITE_ENABLE_EVIDENCE_RESUME_SCORE":"true"}'}}),
    postcss([tailwindcss(tailwindConfig)]).process(readFileSync('styles/tailwind.css','utf8'),{from:'styles/tailwind.css'})]);
  const browser=await chromium.launch({headless:true});
  try{
    for(const [name,width,height] of [['desktop',1280,1000],['mobile',390,844]]){
      const page=await browser.newPage({viewport:{width,height},isMobile:name==='mobile',hasTouch:name==='mobile'});
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.setContent('<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div>');
      await page.addStyleTag({content:css.css});await page.addScriptTag({content:outputFiles[0].text});
      await page.getByRole('heading',{name:'修改方案（1项可选）'}).waitFor();
      assert.ok(await page.getByRole('heading',{name:'值得保留'}).isVisible());
      const button=page.getByRole('button',{name:/执行所选方案|优化所选模块/});assert.equal(await button.isDisabled(),true);
      assert.equal(await page.getByRole('checkbox').count(),1,'manual-only advice has no selectable checkbox');
      await page.getByRole('checkbox').check();assert.equal(await button.isEnabled(),true);
      await button.click();assert.deepEqual(await page.evaluate(()=>window.started),[['suggestion-1']]);
      await page.getByText('六维评分与说明',{exact:true}).click();
      await page.getByText('个人贡献 · 评分说明',{exact:true}).click();
      assert.ok(await page.getByText('承担任务清楚：1/4 档',{exact:true}).isVisible());
      assert.equal(await page.getByText('查看原文依据',{exact:false}).count(),0);
      assert.equal(await page.getByText('INTERNAL_JD_QUOTE_NOT_FOR_REPORT',{exact:true}).count(),0);
      await page.getByText('其他建议（1项）',{exact:true}).click();
      assert.ok(await page.getByText('需手动处理',{exact:true}).isVisible());
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      if(process.env.EVIDENCE_SCREENSHOT_DIR){mkdirSync(process.env.EVIDENCE_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.EVIDENCE_SCREENSHOT_DIR,`${name}.png`),fullPage:true});}
      await page.evaluate(()=>window.renderReport(true));
      await page.getByText('历史评分，请重新评分后再优化；不同版本分数不直接比较。',{exact:true}).waitFor();
      assert.equal(await page.getByRole('checkbox').isDisabled(),true);assert.equal(await button.isDisabled(),true);
      assert.deepEqual(errors,[]);await page.close();
    }
  }finally{await browser.close();}
});
