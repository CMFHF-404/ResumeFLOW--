import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
test('resume skill overrides affect visible snapshot and signature without changing bank or other resumes',async()=>{
  const result=await build({stdin:{contents:`export * from './utils/skillOverrides';export * from './utils/resumeEvaluationSnapshot';`,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'esm',platform:'node'});
  const {applySkillGroupOverrides,buildResumeEvaluationSnapshot}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
  const bank=[{name:'编程',skills:[{id:'s1',name:'Python基础'},{id:'s2',name:'仅了解veRL'}]}];const original=structuredClone(bank);
  const overridden=applySkillGroupOverrides(bank,{s1:{name:'Python用于课程数据整理',category:'课程工具'},deleted:{name:'PyTorch',category:'不存在'}});
  assert.equal(overridden[0].name,'课程工具');assert.equal(overridden[0].skills[0].name,'Python用于课程数据整理');assert.equal(overridden.length,2);
  assert.deepEqual(bank,original);assert.deepEqual(applySkillGroupOverrides(bank,{}),original);
  const params={profile:{},personalSummary:'',hasPersonalSummaryOverride:false,isSummaryVisible:false,targetRole:'',experiences:[],selectedExperienceIds:new Set(),educations:[],selectedEducationIds:new Set(),certifications:[],selectedCertificationIds:new Set(),selectedSkillIds:new Set(['s1'])};
  const before=buildResumeEvaluationSnapshot({...params,skillGroups:bank}),after=buildResumeEvaluationSnapshot({...params,skillGroups:overridden});
  assert.notDeepEqual(after.resume,before.resume);assert.equal(after.resume.skills[0].category,'课程工具');assert.equal(after.resume.skills.length,1);
  assert.equal(after.fact_metadata.find(f=>f.source==='resume.skills[0].name').content,'Python用于课程数据整理');
});

test('resume-local education and created skills reach snapshots and dashboard preview without changing the bank',async()=>{
  const result=await build({stdin:{contents:`export * from './utils/skillOverrides';export * from './utils/resumeEvaluationSnapshot';export {buildDashboardResumePreviewState} from './views/Dashboard/resumePreviewState';`,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'cjs',platform:'node',define:{'import.meta.env':'{}'}});
  const module={exports:{}};new Function('require','module','exports',result.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
  const {applyEducationOverrides,applySkillGroupOverrides,buildResumeEvaluationSnapshot,buildDashboardResumePreviewState}=module.exports;
  const id='resume-skill:88888888-8888-8888-8888-888888888888';
  const localSkills={[id]:{name:'Python用于课程数据清洗',category:'分析工具'}};
  const overrides={edu:{courses:'程序设计',notes:'已确认的研究问题与本人方法。'}};
  const bank=[{id:'edu',school:'大学',major:'计算机',degree:'本科',startDate:'2024-09',endDate:'2028-06',courses:'程序设计、体育'}];
  const education=applyEducationOverrides(bank,overrides);const groups=applySkillGroupOverrides([],{},localSkills);
  const snapshot=buildResumeEvaluationSnapshot({profile:{},personalSummary:'',hasPersonalSummaryOverride:false,isSummaryVisible:false,targetRole:'',experiences:[],selectedExperienceIds:new Set(),educations:education,selectedEducationIds:new Set(['edu']),certifications:[],selectedCertificationIds:new Set(),skillGroups:groups,selectedSkillIds:new Set([id])});
  assert.equal(snapshot.resume.educations[0].notes,overrides.edu.notes);assert.equal(snapshot.resume.educations[0].courses,'程序设计');
  assert.equal(snapshot.resume.skills[0].id,id);assert.ok(snapshot.fact_metadata.some(f=>f.source==='resume.educations[0].notes'));
  assert.equal(bank[0].courses,'程序设计、体育');assert.equal(bank[0].notes,undefined);
  const detail={resume:{id:'r',config:{educationOverrides:overrides,localSkills,selection:{educationIds:['edu'],experienceIds:[],skillIds:[id],certificationIds:[]}}},items:[]};
  const source=[{master:{id:'edu',category:'education'},latest_version:{org:'大学',title:'计算机',star:{degree:'本科',courses:'程序设计、体育'}}}];
  const preview=buildDashboardResumePreviewState(detail,null,[],source,[],[]);
  assert.equal(preview.selectedSkillGroups[0].skills[0].name,'Python用于课程数据清洗');
  assert.equal(preview.educations[0].notes,overrides.edu.notes);
});
