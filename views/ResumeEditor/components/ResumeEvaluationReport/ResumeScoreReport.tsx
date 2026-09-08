import React, { useEffect, useRef } from 'react';
import { RefreshCw, Square } from 'lucide-react';
import { trackResumeOptimizationCtaView, trackResumeOptimizationCtaClick } from '../../../../utils/analyticsTracker';
import type { ResumeScoreEvaluation } from '../../../../types/ai';
import { groupScoreSuggestions } from '../../../../utils/resumeScore.mjs';
import { useScoreAnnotations } from './ScoreAnnotations';

export function ScoreRadar({ dimensions, pending = false }: { dimensions: { dimension: string; score: number }[]; pending?: boolean }) {
  const point = (index: number, radius: number) => { const angle = index * Math.PI / 3 - Math.PI / 2; return [150 + Math.cos(angle) * radius, 135 + Math.sin(angle) * radius]; };
  const points = (values: number[]) => values.map((v, i) => point(i, v * .82).join(',')).join(' ');
  return <svg viewBox="0 0 300 275" role="img" aria-label={pending ? "六维评分雷达图，尚未评分" : `六维简历评估雷达图：${dimensions.map(row => `${row.dimension} ${row.score} 分`).join('，')}`} className="mx-auto w-full max-w-[360px] text-slate-200 dark:text-slate-700">
    {[50, 100].map(v => <polygon key={v} points={points(Array(6).fill(v))} fill="none" stroke="currentColor" />)}
    {dimensions.map((row, i) => { const [x, y] = point(i, 110); const [ax, ay] = point(i, 82); return <g key={row.dimension}>
      <line x1="150" y1="135" x2={ax} y2={ay} stroke="currentColor" strokeOpacity="0.45" />
      <text x={x} y={y} textAnchor="middle" className="fill-slate-600 text-[11px] dark:fill-slate-200">{row.dimension}<tspan x={x} dy="17" className="fill-slate-900 text-[13px] font-semibold dark:fill-white">{pending ? '待评分' : `${row.score} 分`}</tspan></text>
    </g>; })}
    {!pending && <polygon points={points(dimensions.map(row => row.score))} fill="rgba(16,185,129,.10)" stroke="#059669" strokeWidth="2" strokeLinejoin="round" />}
    {!pending && dimensions.map((row, i) => { const [x, y] = point(i, row.score * .82); return <circle key={row.dimension} cx={x} cy={y} r="3" fill="#059669" stroke="white" strokeWidth="1.5" />; })}
  </svg>;
}

export function ResumeScoreReport({ report, outdated, enabled, busy, canStart, disabledReason, onStart, onGenerate, generating, onStop, error }: {
  report: ResumeScoreEvaluation; outdated: boolean; enabled: boolean; busy: boolean; canStart: boolean;
  disabledReason?: string | null; onStart?: (ids: string[]) => void; onGenerate?: () => void; generating: boolean; onStop?: () => void; error?: string | null;
}) {
  const annotations = useScoreAnnotations();
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const ctaViewTrackedRef = useRef(false);
  useEffect(() => {
    const node = buttonRef.current;
    if (!node || !enabled || !canStart || outdated || busy || ctaViewTrackedRef.current) return;
    const record = () => { if (!ctaViewTrackedRef.current && node.getClientRects().length && !node.closest('[inert], [aria-hidden="true"]')) { ctaViewTrackedRef.current = true; trackResumeOptimizationCtaView(); } };
    if (typeof IntersectionObserver === 'function') {
      const observer = new IntersectionObserver(entries => { if (entries[0]?.isIntersecting) record(); });
      observer.observe(node); return () => observer.disconnect();
    }
    const frame = requestAnimationFrame(record); return () => cancelAnimationFrame(frame);
  }, [enabled, canStart, outdated, busy]);
  const groups = groupScoreSuggestions(report.suggestions) as [string, ResumeScoreEvaluation['suggestions']][];
  return <section aria-label="六维简历评分" className="space-y-4">
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950">
      <div className="flex items-center justify-between gap-3">
        <div><p className="mb-1 text-[10px] font-semibold tracking-widest text-emerald-700 dark:text-emerald-400">简历诊断</p><h4 className="text-base font-bold text-slate-900 dark:text-white">六维简历评分</h4></div>
        <div className="flex shrink-0 items-center gap-2">
          {(onGenerate || (generating && onStop)) && <button type="button" aria-label={generating ? '停止生成' : '重新评分'} title={generating ? '停止生成' : '重新评分'}
            disabled={generating ? !onStop : busy} onClick={generating ? onStop : onGenerate}
            className={`flex h-11 w-11 items-center justify-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 disabled:opacity-40 ${generating
              ? 'bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-500'
              : 'text-slate-500 hover:bg-emerald-50 hover:text-emerald-700 focus-visible:ring-emerald-500 dark:text-slate-400 dark:hover:bg-slate-800'}`}>
            {generating ? <Square aria-hidden="true" className="h-4 w-4" /> : <RefreshCw aria-hidden="true" className="h-4 w-4" />}
          </button>}
          <span className="text-4xl font-bold tabular-nums tracking-tight text-emerald-700 dark:text-emerald-400">{report.overallScore}<small className="ml-1 text-xs font-medium">分</small></span>
        </div>
      </div>
      {generating && <p role="status" className="mt-2 text-xs text-emerald-700 dark:text-emerald-400">正在生成六维评分…</p>}
      <p className="mt-4 border-l-2 border-emerald-400 pl-3 text-[13px] leading-6 text-slate-600 dark:text-slate-300">{report.summary}</p>
      {error ? <p role="alert" className="mt-2 text-xs text-rose-600 dark:text-rose-400">{error}</p>
        : outdated ? <p role="status" className="mt-2 text-xs text-amber-700">简历内容已变化，请重新评分后再选择优化。</p> : null}
      <ScoreRadar dimensions={report.dimensions} />
      <div className="divide-y divide-slate-100 border-t border-slate-100 dark:divide-slate-800 dark:border-slate-800">{report.dimensions.map(row => <div key={row.dimension} className="py-3"><div className="mb-1 flex items-center justify-between"><h5 className="text-xs font-semibold text-slate-900 dark:text-slate-100">{row.dimension}</h5><span className="text-xs font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">{row.score}<span className="ml-1 font-normal text-slate-400">分</span></span></div><p className="text-xs leading-5 text-slate-500 dark:text-slate-400">{row.comment}</p></div>)}</div>
    </div>
    <h5 className="text-sm font-bold text-slate-900 dark:text-white">选择需要优化的模块</h5>
    {groups.length === 0 && <p className="text-xs text-slate-500">本次未发现需要优化的模块。</p>}
    {groups.map(([key, rows]) => { const ids = rows.filter(row => row.editable).map(row => row.suggestionId); return <div key={key} className="rounded-xl border border-slate-200 bg-white p-4 transition focus-within:border-emerald-400 dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-center gap-2">
        {ids.length > 0 && <input type="checkbox" aria-label={`选择优化 ${annotations.labelFor(rows[0])}`} disabled={outdated || busy || generating} checked={ids.every(id => annotations.selected.includes(id))} onChange={() => annotations.toggle(ids)} />}
        <button type="button" className="text-left text-[13px] font-semibold leading-5 text-slate-900 hover:text-emerald-700 dark:text-slate-100" onClick={() => annotations.locate(key)}>{annotations.labelFor(rows[0])}</button>
        {!ids.length && <span className="text-[10px] text-slate-500">手动修改</span>}
      </div>
      {rows.map(row => <div key={row.suggestionId} className="mt-2 text-xs leading-relaxed"><p className="text-slate-500 dark:text-slate-400">{row.problem}</p><p className="mt-2 rounded-lg bg-emerald-50/70 p-2.5 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"><span className="mb-1 block text-[10px] font-bold tracking-wide">改进方向</span>{row.direction}</p></div>)}
    </div>; })}
    {enabled && onStart && <button ref={buttonRef} type="button" disabled={outdated || busy || generating || !canStart || annotations.selected.length === 0} onClick={() => { trackResumeOptimizationCtaClick(); onStart(annotations.selected); }}
      data-resume-optimization-focus-return="true" className="min-h-11 w-full rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">优化所选模块（{annotations.selected.length}）</button>}
    {disabledReason && <p className="text-xs text-slate-500">{disabledReason}</p>}
  </section>;
}
