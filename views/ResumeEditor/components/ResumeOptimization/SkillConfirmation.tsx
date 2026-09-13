import React, {useState} from 'react';
import type {ResumeOptimizationQuestion} from '../../../../types/resumeOptimization';

export function SkillConfirmation({question,value,disabled,onChange}:{question:ResumeOptimizationQuestion;value:string;disabled:boolean;
    onChange:(state:'answered'|'skipped',value:string,inputSource?:'custom')=>void}) {
    let saved:{fragments?:string[];category?:string;confirmed?:boolean}={};
    try{saved=JSON.parse(value||'{}');}catch{/* An unconfirmed draft has no value. */}
    const [parts,setParts]=useState(saved.fragments?.join('\n')??question.skillOriginal?.name??'');
    const [category,setCategory]=useState(saved.category??question.skillOriginal?.category??'');
    const [confirmed,setConfirmed]=useState(saved.confirmed===true);
    const update=(p:string,c:string,confirm:boolean)=>{
        setParts(p);setCategory(c);setConfirmed(confirm);
        onChange(confirm&&p.trim()&&c.trim()?'answered':'skipped',confirm&&p.trim()&&c.trim()?JSON.stringify({fragments:p.split('\n').map(x=>x.trim()).filter(Boolean),category:c.trim(),confirmed:true}):'','custom');
    };
    return <fieldset disabled={disabled} className="space-y-3 rounded-xl border border-emerald-200 p-4 text-sm">
        <legend className="font-semibold">确认当前简历技能</legend>
        <p className="whitespace-pre-wrap text-xs text-slate-500">原文：{question.skillOriginal?.category} · {question.skillOriginal?.name}</p>
        <label className="block">确认的文字片段（每行一项）<textarea rows={4} className="mt-1 w-full rounded border bg-white p-2 text-slate-900 dark:bg-slate-900 dark:text-white" value={parts} onChange={e=>update(e.target.value,category,false)}/></label>
        <p className="text-xs text-slate-500">可填写实际工具、用途和掌握程度；不确定时保留原文。系统只组合你确认的片段。</p>
        <label className="block">当前简历分类<input className="ml-2 max-w-full rounded border bg-white p-2 text-slate-900 dark:bg-slate-900 dark:text-white" value={category} onChange={e=>update(parts,e.target.value,false)}/></label>
        <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} disabled={disabled||!parts.trim()||!category.trim()} onChange={e=>update(parts,category,e.target.checked)}/>以上文字均是我确认的信息，仅修改当前简历</label>
        <button type="button" className="text-xs underline" onClick={()=>update(question.skillOriginal?.name??'',question.skillOriginal?.category??'',false)}>跳过，保留原文</button>
    </fieldset>;
}
