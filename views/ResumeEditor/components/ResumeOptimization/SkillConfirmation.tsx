import React, {useId, useState} from 'react';
import type {ResumeOptimizationQuestion, ResumeOptimizationAnswerState} from '../../../../types/resumeOptimization';

type Entry={parts:string;category:string;decision:boolean|null;custom:boolean};
type SavedSkill={fragments?:string[];category?:string;confirmed?:boolean;candidateIndex?:number};
export function SkillConfirmation({question,value,answerState,disabled,onChange}:{question:ResumeOptimizationQuestion;value:string;answerState?:ResumeOptimizationAnswerState;disabled:boolean;
    onChange:(state:'answered'|'skipped',value:string,inputSource?:'custom')=>void}) {
    const id=useId();
    const isNew=question.moduleId?.startsWith('new:')||question.moduleId==='new';
    const batch=isNew&&Boolean(question.skillCandidates?.length);
    const categories=[...new Set((question.skillCategories??[]).filter(Boolean))];
    const candidates=batch?question.skillCandidates!:[{name:question.skillOriginal?.name??'',category:question.skillOriginal?.category??'未分类',sourceText:''}];
    let saved:SavedSkill&{skills?:SavedSkill[]}={};
    try{saved=JSON.parse(value||'{}');}catch{/* Keep an unanswered draft editable. */}
    const [entries,setEntries]=useState<Entry[]>(()=>candidates.map((candidate,index)=>{
        const prior=batch?saved.skills?.find((item,i)=>(item.candidateIndex??i)===index):saved;
        const suggestedCategory=candidate.category==='未分类'&&categories.length?categories[0]:candidate.category;
        const category=prior?.category??suggestedCategory;
        return {parts:prior?.fragments?.join('\n')??(isNew&&!batch?`${candidate.name}：有项目实践经验`:candidate.name),category,
            decision:prior?.confirmed===true?true:answerState==='skipped'||(batch&&saved.skills)?false:null,
            custom:!categories.includes(category)&&category!=='未分类'};
    }));
    const inputClass='mt-2 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm leading-6 text-slate-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15 disabled:cursor-not-allowed dark:border-slate-700 dark:bg-slate-900 dark:text-white';
    const update=(index:number,patch:Partial<Entry>)=>{
        const next=entries.map((entry,i)=>i===index?{...entry,...patch}:entry);setEntries(next);
        if(next.some(entry=>entry.decision===null||(entry.decision&&(!entry.parts.trim()||!entry.category.trim())))){onChange('answered','','custom');return;}
        const selected=next.flatMap((entry,i)=>entry.decision?[{fragments:entry.parts.split('\n').map(part=>part.trim()).filter(Boolean),category:entry.category.trim(),confirmed:true,candidateIndex:i}]:[]);
        if(!selected.length){onChange('skipped','','custom');return;}
        const {candidateIndex,...single}=selected[0];
        onChange('answered',JSON.stringify(batch?{skills:selected}:single),'custom');
    };
    const title=isNew?'确认要新增的技能':'确认技能修改';
    return <fieldset disabled={disabled} className="min-w-0 space-y-4 rounded-2xl border border-slate-200/80 bg-white/90 p-4 shadow-sm disabled:opacity-70 dark:border-slate-800 dark:bg-slate-950/55 md:p-5">
        <legend className="sr-only">{title}</legend>
        <div><span className="inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">{isNew?`${entries.length} 项技能草稿`:'调整已有技能'}</span>
            <h3 aria-hidden="true" className="mt-2 text-sm font-bold leading-6 text-slate-950 dark:text-white">{title}</h3>
            <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">已预填技能描述、掌握程度和分类，供你核对。掌握程度是待确认的草稿，可按实际情况修改；逐项选择后进入修改预览。</p></div>
        {entries.map((entry,index)=><section key={index} aria-label={`技能 ${index+1}`} className="space-y-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
            <fieldset disabled={disabled||entry.decision===false} className={`min-w-0 space-y-3 ${entry.decision===false?'opacity-45 grayscale':''}`}>
                <legend className="sr-only">技能 {index+1} 内容</legend>
                {candidates[index].sourceText&&<details className="rounded-lg bg-emerald-50/70 p-2.5 text-xs leading-5 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200"><summary className="cursor-pointer font-medium">查看经历依据</summary><p className="mt-2 whitespace-pre-wrap">{candidates[index].sourceText}</p></details>}
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200">技能描述与掌握程度
                    <textarea rows={3} className={inputClass+' resize-y'} value={entry.parts} onChange={e=>update(index,{parts:e.target.value,decision:null})}/></label>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200">技能分类
                    <select className={inputClass} value={entry.custom?'__new__':entry.category} onChange={e=>update(index,e.target.value==='__new__'?{custom:true,category:'',decision:null}:{custom:false,category:e.target.value,decision:null})}>
                        {[...new Set([...categories,'未分类'])].map(category=><option key={category} value={category}>{category}</option>)}
                        <option value="__new__">＋ 新增分类</option>
                    </select></label>
                {entry.custom&&<label className="block text-xs font-semibold text-slate-700 dark:text-slate-200">新分类名称<input className={inputClass} value={entry.category} onChange={e=>update(index,{category:e.target.value,decision:null})}/></label>}
            </fieldset>
            <div role="radiogroup" aria-label={`技能 ${index+1} 是否${isNew?'添加':'修改'}`} className="grid grid-cols-2 gap-2">
                {[false,true].map(choice=><label key={String(choice)} className={`flex min-h-[44px] cursor-pointer items-center justify-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold focus-within:ring-2 focus-within:ring-emerald-500/30 ${entry.decision===choice?'border-emerald-400 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200':'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300'}`}>
                    <input type="radio" name={`${id}-${index}`} className="h-4 w-4 accent-emerald-600" checked={entry.decision===choice} onChange={()=>update(index,{decision:choice})}/>
                    {isNew?(choice?'添加':'不添加'):(choice?'修改':'不修改')}
                </label>)}
            </div>
            {entry.decision===null&&<p className="text-[11px] text-slate-500">请核对后选择{isNew?'“不添加”或“添加”':'“不修改”或“修改”'}。</p>}
        </section>)}
        <p className="text-[11px] leading-5 text-slate-500 dark:text-slate-400">下一步先查看修改效果，点击应用后才会更新当前简历。</p>
    </fieldset>;
}
