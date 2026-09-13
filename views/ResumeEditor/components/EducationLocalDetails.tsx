import React from 'react';
import type {EducationView} from '../../../types/resume';
export function EducationLocalDetails({items,onChange,onReset}:{items:EducationView[];
  onChange:(id:string,field:'courses'|'notes',value:string)=>void;onReset:(id:string)=>void}) {
  return <section className="space-y-2" aria-label="当前简历教育说明">
    {items.map(item=><details key={item.id} className="rounded-lg border border-slate-200 p-3 text-xs dark:border-slate-700">
      <summary className="cursor-pointer font-semibold">{item.school} · 当前简历课程与补充说明</summary>
      <p className="my-2 text-slate-500">修改后自动保存到当前简历，资料库原文保持不变。</p>
      <label className="block">展示课程<textarea className="my-1 w-full rounded border p-2 dark:bg-slate-900" value={item.courses??''} onChange={e=>onChange(item.id,'courses',e.target.value)}/></label>
      <label className="block">教育补充说明<textarea rows={3} className="my-1 w-full rounded border p-2 dark:bg-slate-900" value={item.notes??''} onChange={e=>onChange(item.id,'notes',e.target.value)} placeholder="可填写已经确认的研究主题、个人工作或代表性荣誉"/></label>
      <button type="button" className="py-2 text-emerald-700 underline" onClick={()=>onReset(item.id)}>恢复资料库原文</button>
    </details>)}
  </section>;
}
