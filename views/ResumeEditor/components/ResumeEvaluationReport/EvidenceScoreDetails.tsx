import React from 'react';
import type { EvidenceResumeScoreEvaluation } from '../../../../types/ai';

export function EvidenceStrengths({report}: {report: EvidenceResumeScoreEvaluation}) {
  if(!report.strengths.length)return null;
  return <section aria-label="值得保留" className="space-y-2">
    <h5 className="text-sm font-semibold text-slate-900 dark:text-white">值得保留</h5>
    {report.strengths.map((s,i)=><div key={i} className="rounded-xl bg-emerald-50/60 p-3 text-xs leading-6 dark:bg-emerald-950/30">
      <p className="font-semibold text-slate-800 dark:text-slate-200">{s.text}</p><p className="text-slate-600 dark:text-slate-300">{s.reason}</p>
    </div>)}
  </section>;
}
