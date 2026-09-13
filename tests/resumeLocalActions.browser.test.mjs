import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from 'esbuild';
import {chromium} from 'playwright';

test('visible local and overridden skill groups support drag reorder and cancellation', async () => {
  const {outputFiles} = await build({stdin: {contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {useResumeEditorReorder} from './views/ResumeEditor/hooks/useResumeEditorReorder';
    import {applySkillGroupOverrides} from './utils/skillOverrides';
    const bank=[{name:'Languages',skills:[{id:'bank-1',name:'English'}]},{name:'Code',skills:[{id:'bank-2',name:'Python'}]}];
    const local={'resume-skill:88888888-8888-8888-8888-888888888888':{name:'Local Python',category:'Tools'}};
    const overrides={'bank-2':{name:'Basic Python',category:'Analysis'}};
    const noop=()=>{};
    function App(){
      const [order,setOrder]=React.useState([]);
      const groups=applySkillGroupOverrides(bank,overrides,local,order);
      const reorder=useResumeEditorReorder({authUserKey:null,experienceItems:[],setExperienceItems:noop,
        educations:[],setEducations:noop,certifications:[],setCertifications:noop,
        skillGroups:groups,sourceSkillGroups:bank,skillGroupOrder:order,setSkillGroupOrder:setOrder,
        setSkillGroups:()=>{throw Error('unexpected bank write')},sectionOrder:['skills'],setSectionOrder:noop});
      window.startPending=()=>reorder.startItemReorder('skillGroup:Analysis');
      window.movePending=()=>reorder.handleItemDragHover('skillGroup:Tools','before');
      return <main><div aria-label="Skill groups">{groups.map(group=><div key={group.name} data-group={group.name}
        draggable onDragStart={event=>reorder.handleDragStart(event,'skillGroup:'+group.name)}
        onDragOver={event=>{event.preventDefault();reorder.handleItemDragHover('skillGroup:'+group.name,'before')}}
        onDrop={reorder.handleItemDrop} onDragEnd={reorder.finishDragInteraction}>
        {group.name}: {group.skills.map(s=>s.name).join(',')}
      </div>)}</div><button onClick={reorder.cancelTouchDragInteraction}>Cancel pending reorder</button>
      <output>{JSON.stringify(order)}</output></main>;
    }
    createRoot(document.getElementById('root')).render(<App/>);
  `,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,platform:'browser',
    define:{'process.env.NODE_ENV':'"test"','import.meta.env':'{}'}});
  const browser=await chromium.launch({headless:true});
  try { for(const width of [1280,390]) {
    const page=await browser.newPage({viewport:{width,height:900}});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.setContent('<div id="root"></div>');
    await page.addStyleTag({content:'main{max-width:340px;margin:auto}[data-group]{padding:24px;border:1px solid;margin:10px}'});
    await page.addScriptTag({content:outputFiles[0].text});
    await page.locator('[data-group="Tools"]').dragTo(page.locator('[data-group="Languages"]'));
    const names=()=>page.locator('[data-group]').evaluateAll(items=>items.map(item=>item.dataset.group));
    assert.deepEqual(await names(),['Tools','Languages','Analysis']);
    assert.equal(await page.locator('output').textContent(),'["Tools","Languages","Analysis"]');
    await page.evaluate(()=>window.startPending());
    await page.evaluate(()=>window.movePending());
    assert.deepEqual(await names(),['Analysis','Tools','Languages']);
    await page.getByRole('button',{name:'Cancel pending reorder'}).click();
    assert.deepEqual(await names(),['Tools','Languages','Analysis']);
    assert.deepEqual(errors,[]);
    await page.close();
  }} finally { await browser.close(); }
});

test('desktop/mobile local education editing and local skill controls preserve shared data',async()=>{
  const {outputFiles}=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';
    import{EducationLocalDetails}from'./views/ResumeEditor/components/EducationLocalDetails';import{LocalSkillItem}from'./views/ResumeEditor/components/LocalSkillItem';
    function App(){const[edu,setEdu]=React.useState({id:'edu',school:'测试大学',courses:'程序设计、体育',notes:''});const[skill,setSkill]=React.useState({id:'local',name:'Python基础'});const[category,setCategory]=React.useState('开发');const[selected,setSelected]=React.useState(true);
      return <main><EducationLocalDetails items={[edu]} onChange={(id,field,value)=>{setEdu(s=>({...s,[field]:value}));window.edu={...edu,[field]:value}}} onReset={()=>{setEdu({id:'edu',school:'测试大学',courses:'程序设计、体育',notes:''});window.reset=true}}/>
      {skill&&<LocalSkillItem item={skill} category={category} selected={selected} onToggle={()=>setSelected(!selected)} actions={{updateLocalSkill:(id,value)=>{setSkill({id,name:value.name});setCategory(value.category);window.saved=value},deleteLocalSkill:()=>{setSkill(null);window.removed=true}}}/>}</main>}
    createRoot(document.getElementById('root')).render(<App/>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,platform:'browser',define:{'process.env.NODE_ENV':'"test"'}});
  const browser=await chromium.launch({headless:true});try{for(const width of [1280,390]){
    const page=await browser.newPage({viewport:{width,height:900}});await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>');await page.addStyleTag({content:'*{box-sizing:border-box}input,textarea{max-width:100%}main{max-width:600px;margin:auto}label{display:block}'});await page.addScriptTag({content:outputFiles[0].text});
    await page.getByText('测试大学 · 当前简历课程与补充说明').click();await page.getByRole('textbox',{name:'教育补充说明'}).fill('本人完成研究数据核查。');assert.equal((await page.evaluate(()=>window.edu)).notes,'本人完成研究数据核查。');
    await page.getByRole('button',{name:'恢复资料库原文'}).click();assert.equal(await page.getByRole('textbox',{name:'教育补充说明'}).inputValue(),'');
    await page.getByText('编辑专属技能',{exact:true}).click();await page.getByRole('textbox',{name:'技能文字'}).fill('Python用于已完成的数据核查');await page.getByRole('button',{name:'保存到当前简历'}).click();assert.equal((await page.evaluate(()=>window.saved)).name,'Python用于已完成的数据核查');
    await page.getByRole('button',{name:'移除专属技能'}).click();assert.equal(await page.evaluate(()=>window.removed),true);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.close();
  }}finally{await browser.close();}
});
