import React from 'react';
import type { ResumeScoreSuggestion } from '../../../../types/ai';
import { getCompatibleScoreSuggestionAdditions, scoreModuleKey, scoreSuggestionsConflict, sortScoreSuggestionsByPreview } from '../../../../utils/resumeScore.mjs';
import { useScoreAnnotations } from './ScoreAnnotations';

export function ScoreActionList({suggestions, disabled, children}: {
  suggestions: ResumeScoreSuggestion[]; disabled: boolean; children?: React.ReactNode;
}) {
  const annotations=useScoreAnnotations();
  const ordered=sortScoreSuggestionsByPreview(suggestions,annotations.moduleOrder);
  const executable=ordered.filter(s=>s.editable&&!s.executionBlockReason);
  const executableIds=executable.map(s=>s.suggestionId);
  const selectedRows=executable.filter(row=>annotations.selected.includes(row.suggestionId));
  const combinedSkills=selectedRows.some(row=>row.moduleType==='skill_create')&&selectedRows.some(row=>row.moduleType==='skills_order');
  const additions=getCompatibleScoreSuggestionAdditions(ordered,annotations.selected);
  const allSelected=executableIds.length>0&&additions.length===0;
  const hasConflicts=executable.some((row,index)=>executable.slice(index+1).some(other=>scoreSuggestionsConflict(row,other)));
  const card=(row:ResumeScoreSuggestion)=>{
    const conflict=!annotations.selected.includes(row.suggestionId)&&selectedRows.some(other=>scoreSuggestionsConflict(row,other));
    return <article key={row.suggestionId}
    id={row.diagnosticId?`review-${row.diagnosticId}`:undefined} tabIndex={-1}
    className="rounded-xl border border-slate-200 bg-white p-4 text-xs leading-6 focus-within:border-emerald-400 dark:border-slate-700 dark:bg-slate-900">
    <div className="flex items-start gap-3">
      {row.editable&&!row.executionBlockReason&&<input type="checkbox" aria-label={`选择方案：${row.problem}`} disabled={disabled||conflict}
        className="mt-1 h-4 w-4 shrink-0 accent-emerald-600" checked={annotations.selected.includes(row.suggestionId)}
        onChange={()=>annotations.toggle([row.suggestionId])}/>}
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
          <span>{row.executionBlockReason?'方案需核查':row.planningDeferred?'改进建议':row.action==='retain'?'建议保留':({high:'优先处理',medium:'建议改进',low:'可选优化'}[row.severity??'low'])}</span>
          <span>{row.executionBlockReason?'暂不可执行':row.editable?(row.planningDeferred?'优化时制定方案':row.needsFacts?'补充信息后执行':'可直接优化'):row.action==='retain'?'无需执行':'需手动处理'}</span>
          <button type="button" onClick={()=>annotations.locate(scoreModuleKey(row))}
            className="text-left text-emerald-700 hover:underline dark:text-emerald-400">
            {annotations.labelFor(row)}
          </button>
        </div>
        <h6 className="text-[13px] font-semibold leading-6 text-slate-900 dark:text-slate-100">{row.problem}</h6>
        {row.impact&&<p className="mt-1 text-slate-500 dark:text-slate-400">{row.impact}</p>}
        {row.planningDeferred&&<p className="mt-2 text-emerald-800 dark:text-emerald-300">{row.direction}</p>}
        {conflict&&<p className="mt-2 text-amber-800 dark:text-amber-300">与已选方案冲突，请先取消对应的已选方案。</p>}
        {row.needsFacts&&<p className="mt-2 text-amber-800 dark:text-amber-300">{row.editable?'执行前会请你确认缺失信息；跳过或不确定时保留对应原文。':'请先核实缺失信息，再手动调整对应内容。'}</p>}
      </div>
    </div>
  </article>;
  };
  return <section aria-label="可执行的修改方案" className="space-y-3">
    <div><div className="flex items-center justify-between gap-3">
      <h5 className="text-sm font-bold text-slate-900 dark:text-white">修改方案（{executable.length}项可选）</h5>
      <button type="button" disabled={disabled||!executableIds.length} aria-pressed={allSelected}
        onClick={()=>annotations.toggle(allSelected?selectedRows.map(row=>row.suggestionId):additions)}
        className="shrink-0 rounded-md px-2 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed disabled:opacity-40 dark:text-emerald-400 dark:hover:bg-emerald-950">
        {allSelected?'取消选择':hasConflicts?'选择可兼容方案':'全选'}
      </button>
    </div>
      <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">勾选要处理的方案，生成修改预览后再应用。</p>
      {hasConflicts&&<p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">批量选择保留已选项，按显示顺序补选可兼容方案；互斥方案需分次处理。</p>}</div>
    {executable.length?executable.map(card):<p className="text-xs text-slate-500">本次没有可自动执行的修改方案。</p>}
    {combinedSkills&&<p role="status" aria-label="技能合并处理提示" className="text-xs leading-5 text-emerald-800 dark:text-emerald-300">已同时选择技能补充与排序，将合并处理：原有技能按建议排序，确认新增的技能放在末尾；跳过确认则不新增。</p>}
    {children}
  </section>;
}
