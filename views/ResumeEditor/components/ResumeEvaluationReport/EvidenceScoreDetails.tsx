import React from 'react';
import type { EvidenceCriterion, EvidenceResumeScoreEvaluation, ResumeScoreSuggestion } from '../../../../types/ai';
import { CAREER_STAGES } from '../../../../utils/evidenceResumeScore.mjs';

export function AdviceStrategySteps({suggestion}: {suggestion: ResumeScoreSuggestion}) {
  if(!suggestion.strategySteps?.length)return null;
  return <div className="mt-3 text-xs leading-6">
    <p className="font-medium text-slate-700 dark:text-slate-200">处理步骤</p>
    <ol className="mt-1 list-decimal space-y-1 pl-5 text-slate-600 dark:text-slate-300">{suggestion.strategySteps.map((step,i)=><li key={i}>{step}</li>)}</ol>
  </div>;
}

export function CriterionExplanation({criterion}: {criterion: EvidenceCriterion}) {
  if(!criterion.anchorId)return null;
  return <p className="mt-1 text-xs leading-6 text-slate-500 dark:text-slate-400">本档标准：{criterion.anchorText}</p>;
}

export function EvidenceContext({report}: {report: EvidenceResumeScoreEvaluation}) {
  const c=report.assessmentContext;
  return <div className="mt-3 space-y-2 text-xs leading-5 text-slate-500 dark:text-slate-400">
    <p>{c.mode==='jd'?'依据当前 JD':c.mode==='role_reference'?'岗位方向参考':'通用内容诊断'} · {CAREER_STAGES[c.careerStage]} · {c.assessmentAsOf}</p>
    {c.targetRole&&<p>目标岗位：{c.targetRole}</p>}
    <p className="font-medium text-slate-700 dark:text-slate-200">{report.overallLevel} · 评估当前材料的表达与证据，不代表录用概率</p>
    {report.contextNotice&&<p className="rounded-lg bg-amber-50 p-2 text-amber-800 dark:bg-amber-950 dark:text-amber-200">{report.contextNotice}</p>}
    {report.jdMatch!==null&&<p>独立 JD 匹配：{report.jdMatch}%（不计入六维总分）</p>}
    <p>本次评估文本内容，未评估视觉排版。</p>
    {report.reportStatus==='partial'&&<p role="status" className="rounded-lg bg-amber-50 p-2 text-amber-800 dark:bg-amber-950 dark:text-amber-200">
      已保留有效评分与修改方案，{report.suggestions.filter(s=>s.executionBlockReason).length+(report.unavailableSuggestionCount??0)}条方案未能完整生成，已禁止自动执行。
      {!!report.unavailableSuggestionCount&&`其中${report.unavailableSuggestionCount}条未能定位到有效对象，未纳入方案列表。`}
    </p>}
  </div>;
}

export function EvidenceStrengths({report}: {report: EvidenceResumeScoreEvaluation}) {
  if(!report.strengths.length)return null;
  return <section aria-label="值得保留" className="space-y-2">
    <h5 className="text-sm font-semibold text-slate-900 dark:text-white">值得保留</h5>
    {report.strengths.map((s,i)=><div key={i} className="rounded-xl bg-emerald-50/60 p-3 text-xs leading-6 dark:bg-emerald-950/30">
      <p className="font-semibold text-slate-800 dark:text-slate-200">{s.text}</p><p className="text-slate-600 dark:text-slate-300">{s.reason}</p>
    </div>)}
  </section>;
}

export function EvidenceMethod({report}: {report: EvidenceResumeScoreEvaluation}) {
  return <div className="mt-4 border-t border-slate-100 pt-3 text-xs leading-6 text-slate-500 dark:border-slate-800 dark:text-slate-400">
    <p>每维三个观察项，按 0—4 档判断。维度分＝档位之和 ÷ 12 × 100，总分按未舍入的维度分加权后四舍五入。</p>
    <p>{report.dimensions.map(d=>`${d.dimension} ${d.weight}%`).join(' · ')}</p>
    <p>评分衡量当前材料的表达与证明能力，不代表录用概率；未评估视觉排版。不同版本分数不直接比较，分段标准仍需人审校准。</p>
  </div>;
}
