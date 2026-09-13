import React,{useState} from 'react';
import type {SkillActions,SkillItemView} from '../../../types/resume';
export function LocalSkillItem({item,category,actions,selected,onToggle,disabled}:{item:SkillItemView;category:string;actions:SkillActions;selected:boolean;onToggle:(id:string)=>void;disabled?:boolean}){
  const [name,setName]=useState(item.name),[group,setGroup]=useState(category);
  return <div className="w-full rounded-lg border border-emerald-200 p-2 text-xs dark:border-emerald-800">
    <label className="flex gap-2"><input type="checkbox" disabled={disabled} checked={selected} onChange={()=>onToggle(item.id)}/>{item.name}<span className="text-emerald-700">当前简历专属</span></label>
    <details className="mt-2"><summary className="cursor-pointer" onClick={()=>{setName(item.name);setGroup(category);}}>编辑专属技能</summary>
      <label className="mt-2 block">技能文字<input className="w-full rounded border p-2 dark:bg-slate-900" value={name} onChange={e=>setName(e.target.value)} disabled={disabled}/></label>
      <label className="mt-2 block">分类<input className="w-full rounded border p-2 dark:bg-slate-900" value={group} onChange={e=>setGroup(e.target.value)} disabled={disabled}/></label>
      <button type="button" className="mr-4 py-2 text-emerald-700" disabled={disabled||!name.trim()||!group.trim()} onClick={()=>actions.updateLocalSkill?.(item.id,{name:name.trim(),category:group.trim()})}>保存到当前简历</button>
      <button type="button" className="py-2 text-rose-600" disabled={disabled} onClick={()=>actions.deleteLocalSkill?.(item.id)}>移除专属技能</button>
    </details>
  </div>;
}
