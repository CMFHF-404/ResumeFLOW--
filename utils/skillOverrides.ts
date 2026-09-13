import type { SkillGroupView, ResumeEditorConfig } from '../types/resume';
import { stripRichTextToText } from './richText';
import { applyExplicitOrder } from './explicitOrder';
export type SkillOverrides = NonNullable<ResumeEditorConfig['skillOverrides']>;
export function normalizeSkillOverrides(raw: unknown): SkillOverrides {
  if (!raw || typeof raw!=='object' || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw).flatMap(([id,v])=>{
    if (!v || typeof v!=='object' || typeof v.name!=='string' || typeof v.category!=='string') return [];
    const name=stripRichTextToText(v.name).trim(),category=stripRichTextToText(v.category).trim();
    return name && category ? [[id,{name,category}]] : [];
  }));
}
export function normalizeLocalSkills(raw:unknown):SkillOverrides {
  return Object.fromEntries(Object.entries(normalizeSkillOverrides(raw)).filter(([id])=>/^resume-skill:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)));
}
export function applySkillGroupOverrides(groups: SkillGroupView[], raw: unknown, local:unknown={}, order: string[] = []): SkillGroupView[] {
  const overrides=normalizeSkillOverrides(raw), result=new Map<string,SkillGroupView>();
  const localGroups=Object.entries(normalizeLocalSkills(local)).map(([id,s])=>({name:s.category,skills:[{id,name:s.name}]}));
  for (const group of [...groups,...localGroups]) for (const skill of group.skills) {
    const value=overrides[skill.id], category=value?.category??group.name;
    if (!result.has(category)) result.set(category,{name:category,skills:[]});
    result.get(category)!.skills.push({...skill,name:value?.name??skill.name});
  }
  return applyExplicitOrder([...result.values()], group => group.name, order);
}

export function renameSkillCategories(items: SkillOverrides, ids: string[], category: string): SkillOverrides {
  const selected = new Set(ids);
  return Object.fromEntries(Object.entries(items).map(([id, item]) => [id, selected.has(id) ? { ...item, category } : item]));
}

export function removeSkillEntries(items: SkillOverrides, ids: string[]): SkillOverrides {
  const selected = new Set(ids);
  return Object.fromEntries(Object.entries(items).filter(([id]) => !selected.has(id)));
}

export type EducationOverrides=NonNullable<ResumeEditorConfig['educationOverrides']>;
export function normalizeEducationOverrides(raw:unknown):EducationOverrides {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return {};
  return Object.fromEntries(Object.entries(raw).flatMap(([id,value])=>{
    if(!value||typeof value!=='object')return [];
    const item=Object.fromEntries(['courses','notes'].filter(k=>typeof value[k]==='string').map(k=>[k,stripRichTextToText(value[k])]));
    return [[id,item]];
  }));
}
export function applyEducationOverrides<T extends {id:string}>(items:T[],raw:unknown):T[]{
  const overrides=normalizeEducationOverrides(raw);return items.map(item=>({...item,...overrides[item.id]}));
}
