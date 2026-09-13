import assert from 'node:assert/strict';
import {readFileSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import {chromium} from 'playwright';
import tailwindConfig from '../tailwind.config.cjs';

test('v4 desktop/mobile prioritizes individually executable plans and hides internal quotations',async()=>{
  const report=JSON.parse(readFileSync('tests/fixtures/resume-evidence-v4-balanced.json','utf8'));
  report.sources.push({sourceId:'internal-only',path:'resume.test_note',text:'INTERNAL_RESUME_QUOTE_NOT_FOR_REPORT',kind:'text'});
  assert.equal(report.evidenceSpans,undefined);
  report.suggestions[0].sourceRefs.push('internal-only');
  report.suggestions.push({...report.suggestions[0],suggestionId:'suggestion-2',diagnosticId:'diag-2',problem:'重复背景分散重点',direction:'合并重复背景，前置已有交付结果。',strategySteps:['合并重复的背景说明','将已有交付结果放在本段前部'],severity:'high',needsFacts:false,handling:'organize',factGaps:[],action:'compress'});
  report.suggestions.push({...report.suggestions[0],suggestionId:'manual',diagnosticId:'manual-diag',moduleType:'read_only',moduleId:'educations',fieldPath:'educations',label:'教育经历',problem:'需要核实课程名称',direction:'请在教育经历中手动核实课程名称。',editable:false,handling:'manual_review',action:'verify'});
  const partial=JSON.parse(readFileSync('tests/fixtures/resume-evidence-v4-balanced-partial.json','utf8'));
  report.suggestions.push({...partial.suggestions[1],suggestionId:'blocked-item',diagnosticId:'blocked-item',editable:true});
  report.reportStatus='partial';report.unavailableSuggestionCount=1;
  const [{outputFiles},css]=await Promise.all([
    build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';
      import{ResumeScoreReport}from'./views/ResumeEditor/components/ResumeEvaluationReport/ResumeScoreReport';
      import{ScoreAnnotationProvider,useScoreAnnotations}from'./views/ResumeEditor/components/ResumeEvaluationReport/ScoreAnnotations';
      const r=${JSON.stringify(report)};window.started=[];function Controls(){window.togglePlans=useScoreAnnotations().toggle;return null;}
      const root=createRoot(document.getElementById('root'));window.renderReport=(outdated=false,flags={})=>root.render(<main className="mx-auto max-w-xl p-4"><ScoreAnnotationProvider reportKey="v4" suggestions={r.suggestions} experiences={[{id:"exp1",company:"隔离测试企业"}]}><Controls/><ResumeScoreReport report={r} outdated={outdated} enabled busy={flags.busy??false} canStart={flags.canStart??true} generating={flags.generating??false} onStart={ids=>window.started.push(ids)}/></ScoreAnnotationProvider></main>);window.renderReport();`,
      resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',define:{'process.env.NODE_ENV':'"development"','import.meta.env':'{"VITE_ENABLE_EVIDENCE_RESUME_SCORE":"true","VITE_ENABLE_RESUME_REVIEW_V4":"true"}'}}),
    postcss([tailwindcss(tailwindConfig)]).process(readFileSync('styles/tailwind.css','utf8'),{from:'styles/tailwind.css'})]);
  const browser=await chromium.launch({headless:true});
  try{
    for(const width of [1280,390]){
      const page=await browser.newPage({viewport:{width,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.setContent('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>');
      await page.addStyleTag({content:css.css});await page.addScriptTag({content:outputFiles[0].text});
      const plans=page.getByRole('region',{name:'可执行的修改方案'});
      await plans.getByRole('heading',{name:'修改方案（2项可选）'}).waitFor();
      assert.equal(await plans.getByRole('checkbox').count(),2);
      assert.equal(await plans.getByRole('article').first().getByRole('heading').textContent(),'重复背景分散重点');
      assert.ok(await page.getByText('合并重复的背景说明',{exact:true}).isVisible());
      const first=plans.getByRole('checkbox',{name:'选择方案：'+report.suggestions[0].problem});
      await first.check();
      assert.equal(await plans.getByRole('checkbox',{name:'选择方案：重复背景分散重点'}).isChecked(),false);
      await page.getByRole('button',{name:'执行所选方案（1）',exact:true}).click();
      assert.deepEqual(await page.evaluate(()=>window.started),[['suggestion-1']]);
      for(const flags of [{busy:true},{generating:true},{canStart:false}]){
        await page.evaluate(flags=>window.renderReport(false,flags),flags);
        await page.waitForFunction(()=>document.querySelector('[data-resume-optimization-focus-return]')?.disabled);
        assert.equal(await page.getByRole('button',{name:'执行所选方案（1）',exact:true}).isDisabled(),true);
      }
      await page.evaluate(()=>window.renderReport());
      await page.waitForFunction(()=>document.querySelector('[data-resume-optimization-focus-return]')?.disabled===false);
      assert.ok(await page.getByText('补充信息后执行',{exact:true}).isVisible());
      await page.getByText('其他建议（2项）',{exact:true}).click();
      assert.ok(await page.getByText('需手动处理',{exact:true}).isVisible());
      assert.ok(await page.getByText('暂不可执行',{exact:true}).isVisible());
      assert.ok(await page.getByRole('button',{name:'隔离测试企业 · 费用审核实习',exact:true}).isVisible());
      await page.evaluate(()=>window.togglePlans(['blocked-item']));
      assert.ok(await page.getByRole('button',{name:'执行所选方案（1）',exact:true}).isVisible());
      assert.equal(await page.getByRole('checkbox',{name:'选择方案：该对象的修改方案暂不可执行'}).count(),0);
      assert.ok(await page.getByRole('status').filter({hasText:'已保留有效评分与修改方案'}).isVisible());
      await page.getByText('六维评分与说明',{exact:true}).click();
      await page.getByText('个人贡献 · 评分说明',{exact:true}).click();
      assert.ok(await page.getByRole('img',{name:/六维简历评估雷达图/}).isVisible());
      await page.evaluate(()=>document.querySelectorAll('details').forEach(d=>d.open=true));
      assert.equal(await page.getByText('INTERNAL_RESUME_QUOTE_NOT_FOR_REPORT',{exact:true}).count(),0);
      assert.equal(await page.getByRole('region',{name:'表达策略与指标审阅'}).count(),0);
      assert.equal(await page.getByRole('region',{name:'逐项审阅结果'}).count(),0);
      assert.equal(await page.getByText(/查看原文依据|查看对应原文/).count(),0);
      assert.equal(await page.getByText(report.suggestions[0].factGaps[0].question,{exact:true}).count(),0,'fact questions belong to the selected-plan confirmation flow');
      if(process.env.EVIDENCE_SCREENSHOT_DIR){await page.evaluate(()=>document.querySelectorAll('details').forEach(d=>d.open=false));mkdirSync(process.env.EVIDENCE_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.EVIDENCE_SCREENSHOT_DIR,`action-plans-${width}.png`),fullPage:true});}
      await page.evaluate(()=>window.renderReport(true));
      await page.getByText('简历内容已变化，请重新评分后再选择优化。',{exact:true}).waitFor();
      assert.equal(await first.isDisabled(),true);
      assert.equal(await page.getByRole('button',{name:'执行所选方案（1）',exact:true}).isDisabled(),true);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
      await page.close();
    }
  }finally{await browser.close();}
});
