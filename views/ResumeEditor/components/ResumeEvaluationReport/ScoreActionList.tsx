import React from 'react';
import type { ResumeScoreSuggestion } from '../../../../types/ai';
import { EVIDENCE_ACTIONS } from '../../../../utils/evidenceResumeScore.mjs';
import { scoreModuleKey } from '../../../../utils/resumeScore.mjs';
import { useScoreAnnotations } from './ScoreAnnotations';
import { AdviceStrategySteps } from './EvidenceScoreDetails';

const PRIORITY = {high: 0, medium: 1, low: 2};
const ACTION_LABELS:Record<string,string>={education_courses:'课程取舍',education_notes:'完善教育说明',certification_order:'调整顺序',certification_hide:'从当前简历隐藏',experience_order:'调整同类经历顺序',experience_hide:'从当前简历隐藏',experience_restructure:'整段正文重排',skill_create:'确认后创建专属技能'};
export function ScoreActionList({suggestions, disabled, children}: {
  suggestions: ResumeScoreSuggestion[]; disabled: boolean; children?: React.ReactNode;
}) {
  const annotations=useScoreAnnotations();
  const ordered=[...suggestions].sort((a,b)=>(PRIORITY[a.severity??'low']-PRIORITY[b.severity??'low']));
  const executable=ordered.filter(s=>s.editable&&!s.executionBlockReason);
  const manual=ordered.filter(s=>!s.editable||s.executionBlockReason);
  const card=(row:ResumeScoreSuggestion)=><article key={row.suggestionId}
    id={row.diagnosticId?`review-${row.diagnosticId}`:undefined} tabIndex={-1}
    className="rounded-xl border border-slate-200 bg-white p-4 text-xs leading-6 focus-within:border-emerald-400 dark:border-slate-700 dark:bg-slate-900">
    <div className="flex items-start gap-3">
      {row.editable&&!row.executionBlockReason&&<input type="checkbox" aria-label={`选择方案：${row.problem}`} disabled={disabled}
        className="mt-1 h-4 w-4 shrink-0 accent-emerald-600" checked={annotations.selected.includes(row.suggestionId)}
        onChange={()=>annotations.toggle([row.suggestionId])}/>}
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
          <span>{row.executionBlockReason?'方案需核查':row.action==='retain'?'建议保留':({high:'优先处理',medium:'建议改进',low:'可选优化'}[row.severity??'low'])}</span>
          <span>{row.executionBlockReason?'暂不可执行':row.editable?(row.needsFacts?'补充信息后执行':'可直接优化'):row.action==='retain'?'无需执行':'需手动处理'}</span>
          <button type="button" onClick={()=>annotations.locate(scoreModuleKey(row))}
            className="text-left text-emerald-700 hover:underline dark:text-emerald-400">
            {annotations.labelFor(row)}
          </button>
        </div>
        <h6 className="text-[13px] font-semibold leading-6 text-slate-900 dark:text-slate-100">{row.problem}</h6>
        {row.impact&&<p className="mt-1 text-slate-500 dark:text-slate-400">{row.impact}</p>}
        <div className="mt-3 rounded-lg bg-emerald-50/70 p-3 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
          <p className="font-semibold">修改方案{ACTION_LABELS[row.moduleType]?` · ${ACTION_LABELS[row.moduleType]}`:row.action?` · ${EVIDENCE_ACTIONS[row.action]}`:''}</p>
          <p className="mt-1">{row.direction}</p>
        </div>
        <AdviceStrategySteps suggestion={row}/>
        {row.needsFacts&&<p className="mt-2 text-amber-800 dark:text-amber-300">{row.editable?'执行前会请你确认缺失信息；跳过或不确定时保留对应原文。':'请先核实缺失信息，再手动调整对应内容。'}</p>}
      </div>
    </div>
  </article>;
  return <section aria-label="可执行的修改方案" className="space-y-3">
    <div><h5 className="text-sm font-bold text-slate-900 dark:text-white">修改方案（{executable.length}项可选）</h5>
      <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">勾选要处理的方案，生成修改预览后再应用。</p></div>
    {executable.length?executable.map(card):<p className="text-xs text-slate-500">本次没有可自动执行的修改方案。</p>}
    {children}
    {manual.length>0&&<details className="rounded-xl border border-slate-200 p-3 text-xs dark:border-slate-700">
      <summary className="cursor-pointer py-1 font-medium text-slate-600 dark:text-slate-300">其他建议（{manual.length}项）</summary>
      <div className="mt-3 space-y-3">{manual.map(card)}</div>
    </details>}
  </section>;
}
