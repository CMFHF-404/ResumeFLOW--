import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from 'esbuild';
import {chromium} from 'playwright';
test('desktop/mobile skill confirmation starts unconfirmed, resets on edit and preserves skips',async()=>{
  const {outputFiles}=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{SkillConfirmation}from'./views/ResumeEditor/components/ResumeOptimization/SkillConfirmation';
    const question={skillOriginal:{name:'Python基础；了解veRL',category:'编程'}};
    function App(){const[v,setV]=React.useState('');return <SkillConfirmation question={question} value={v} disabled={false} onChange={(state,value)=>{window.answer={state,value};setV(value)}}/>}createRoot(document.getElementById('root')).render(<App/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'browser',define:{'process.env.NODE_ENV':'"test"'}});
  const browser=await chromium.launch({headless:true});try{for(const width of [1280,390]){
    const page=await browser.newPage({viewport:{width,height:850}});await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div>');await page.addStyleTag({content:'*{box-sizing:border-box}textarea{display:block;width:100%}input{max-width:90%}'});await page.addScriptTag({content:outputFiles[0].text});
    const checkbox=page.getByRole('checkbox');assert.equal(await checkbox.isChecked(),false);
    assert.equal(await page.getByRole('textbox',{name:/确认的文字片段/}).inputValue(),'Python基础；了解veRL');
    await checkbox.check();let answer=await page.evaluate(()=>window.answer);assert.equal(answer.state,'answered');assert.equal(JSON.parse(answer.value).confirmed,true);
    await page.getByRole('textbox',{name:/确认的文字片段/}).fill('Python用于课程实验\nveRL用于已完成的项目');assert.equal(await checkbox.isChecked(),false);assert.equal((await page.evaluate(()=>window.answer)).state,'skipped');
    await checkbox.check();answer=await page.evaluate(()=>window.answer);assert.equal(JSON.parse(answer.value).fragments.length,2);
    await page.getByRole('button',{name:'跳过，保留原文'}).click();assert.equal((await page.evaluate(()=>window.answer)).value,'');assert.equal(await checkbox.isChecked(),false);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.close();
  }}finally{await browser.close();}
});
