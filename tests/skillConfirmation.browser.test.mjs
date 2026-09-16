import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from 'esbuild';
import {chromium} from 'playwright';

test('skill decisions, category creation and partial batches work on desktop and mobile',async()=>{
  const {outputFiles}=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{SkillConfirmation}from'./views/ResumeEditor/components/ResumeOptimization/SkillConfirmation';
    const question=window.fixture;
    function App(){const[v,setV]=React.useState('');return <SkillConfirmation question={question} value={v} disabled={false} onChange={(state,value)=>{window.answer={state,value};setV(value)}}/>}createRoot(document.getElementById('root')).render(<App/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'browser',define:{'process.env.NODE_ENV':'"test"'}});
  const browser=await chromium.launch({headless:true});
  try{for(const width of [1280,390]){for(const batch of [false,true]){
    const page=await browser.newPage({viewport:{width,height:850}});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    const fixture={moduleId:'new:prompt',skillOriginal:{name:'Prompt',category:'未分类'},skillCategories:['产品能力','开发工具'],
      ...(batch?{skillCandidates:[{name:'Prompt：有提示词调优实践',category:'产品能力',sourceText:'使用Prompt进行调优'}, {name:'Agent：有项目实践',category:'开发工具',sourceText:'开发Agent工作流'}]}:{})};
    await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div>');
    await page.addStyleTag({content:'*{box-sizing:border-box}textarea,select,input{max-width:100%}'});
    await page.addScriptTag({content:'window.fixture='+JSON.stringify(fixture)});await page.addScriptTag({content:outputFiles[0].text});
    const first=page.getByRole('region',{name:'技能 1',exact:true});
    const text=first.getByRole('textbox',{name:'技能描述与掌握程度'});
    assert.match(await text.inputValue(),/Prompt.*实践/);
    assert.equal(await first.getByRole('combobox',{name:'技能分类',exact:true}).inputValue(),'产品能力');
    assert.equal(await page.getByRole('button',{name:'暂不添加这项技能'}).count(),0);
    await first.getByRole('radio',{name:'不添加',exact:true}).check();
    assert.equal(await text.isDisabled(),true);
    await first.getByRole('radio',{name:'添加',exact:true}).check();
    assert.equal(await text.isEnabled(),true);
    await first.getByRole('combobox').selectOption('__new__');
    assert.equal(await first.getByRole('radio',{name:'添加',exact:true}).isChecked(),false);
    assert.equal((await page.evaluate(()=>window.answer)).value,'');
    await first.getByRole('textbox',{name:'新分类名称'}).fill('AI应用');
    await text.fill('Prompt：能在项目中编写和调优提示词');
    await first.getByRole('radio',{name:'添加',exact:true}).check();
    if(batch){
      assert.equal((await page.evaluate(()=>window.answer)).value,'','unanswered second skill must block submission');
      await page.getByRole('region',{name:'技能 2',exact:true}).getByRole('radio',{name:'不添加',exact:true}).check();
    }
    let answer=await page.evaluate(()=>window.answer);
    assert.equal(answer.state,'answered');
    const result=JSON.parse(answer.value);const chosen=batch?result.skills[0]:result;
    assert.equal(chosen.category,'AI应用');assert.equal(chosen.confirmed,true);
    if(batch){assert.equal(result.skills.length,1);assert.equal(chosen.candidateIndex,0);}
    await first.getByRole('radio',{name:'不添加',exact:true}).check();
    answer=await page.evaluate(()=>window.answer);assert.equal(answer.state,'skipped');assert.equal(answer.value,'');
    assert.equal(await text.inputValue(),'Prompt：能在项目中编写和调优提示词');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.deepEqual(errors,[]);await page.close();
  }}}finally{await browser.close();}
});
