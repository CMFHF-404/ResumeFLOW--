import React, { useEffect, useRef } from 'react';
import { trackResumeOptimizationCtaView, trackResumeOptimizationCtaClick } from '../../../../utils/analyticsTracker';
import type { ResumeScoreEvaluation } from '../../../../types/ai';
import { groupScoreSuggestions } from '../../../../utils/resumeScore.mjs';
import { useScoreAnnotations } from './ScoreAnnotations';

export function ScoreRadar({ dimensions, pending = false }: { dimensions: { dimension: string; score: number }[]; pending?: boolean }) {
  const point = (index: number, radius: number) => { const angle = index * Math.PI / 3 - Math.PI / 2; return [150 + Math.cos(angle) * radius, 135 + Math.sin(angle) * radius]; };
  const points = (values: number[]) => values.map((v, i) => point(i, v * .82).join(',')).join(' ');
  return <svg viewBox="0 0 300 275" role="img" aria-label={pending ? "六维评分雷达图，尚未评分" : `六维简历评估雷达图：${dimensions.map(row => `${row.dimension} ${row.score} 分`).join('，')}`} className="mx-auto w-full max-w-[360px] text-amber-300">
    {[25, 50, 75, 100].map(v => <polygon key={v} points={points(Array(6).fill(v))} fill="none" stroke="currentColor" />)}
    {dimensions.map((row, i) => { const [x, y] = point(i, 110); const [ax, ay] = point(i, 82); return <g key={row.dimension}>
      <line x1="150" y1="135" x2={ax} y2={ay} stroke="currentColor" />
      <text x={x} y={y} textAnchor="middle" className="fill-slate-600 text-[11px] dark:fill-slate-200">{row.dimension}<tspan x={x} dy="15">{pending ? '待评分' : `${row.score} 分`}</tspan></text>
    </g>; })}
    {!pending && <polygon points={points(dimensions.map(row => row.score))} fill="rgba(16,185,129,.18)" stroke="#059669" strokeWidth="2" />}
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
  return <section aria-label="六维简历评分" className="space-y-3">
    <div className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-4 dark:border-emerald-900 dark:bg-slate-950">
      <div className="flex items-center justify-between"><h4 className="text-sm font-bold">六维简历评分</h4><span className="text-3xl font-black text-emerald-700">{report.overallScore}<small className="ml-1 text-xs">分</small></span></div>
      <p className="mt-2 text-xs leading-relaxed">{report.summary}</p>
      {outdated && <p role="status" className="mt-2 text-xs text-amber-700">简历内容已变化，请重新评分后再选择优化。</p>}
      <ScoreRadar dimensions={report.dimensions} />
      <div className="space-y-1">{report.dimensions.map(row => <p key={row.dimension} className="text-xs"><strong>{row.dimension}：</strong>{row.comment}</p>)}</div>
    </div>
    <h5 className="text-xs font-bold">选择需要优化的模块</h5>
    {groups.length === 0 && <p className="text-xs text-slate-500">本次未发现需要优化的模块。</p>}
    {groups.map(([key, rows]) => { const ids = rows.filter(row => row.editable).map(row => row.suggestionId); return <div key={key} className="rounded-xl border border-amber-200/60 p-3">
      <div className="flex items-center gap-2">
        {ids.length > 0 && <input type="checkbox" aria-label={`选择优化 ${rows[0].label}`} disabled={outdated || busy} checked={ids.every(id => annotations.selected.includes(id))} onChange={() => annotations.toggle(ids)} />}
        <button type="button" className="text-left text-xs font-bold underline decoration-dotted underline-offset-4" onClick={() => annotations.locate(key)}>{rows[0].label}</button>
        {!ids.length && <span className="text-[10px] text-slate-500">手动修改</span>}
      </div>
      {rows.map(row => <div key={row.suggestionId} className="mt-2 text-xs leading-relaxed"><p>{row.problem}</p><p className="text-emerald-700 dark:text-emerald-300">改进方向：{row.direction}</p></div>)}
    </div>; })}
    {enabled && onStart && <p className="text-[11px] text-slate-500">本次优化按实际模型用量消耗 Token。</p>}
    {enabled && onStart && <button ref={buttonRef} type="button" disabled={outdated || busy || !canStart || annotations.selected.length === 0} onClick={() => { trackResumeOptimizationCtaClick(); onStart(annotations.selected); }}
      data-resume-optimization-focus-return="true" className="min-h-11 w-full rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">优化所选模块（{annotations.selected.length}）</button>}
    {disabledReason && <p className="text-xs text-slate-500">{disabledReason}</p>}
    {onGenerate && <button type="button" className="min-h-11 rounded-lg border px-3 text-xs" disabled={generating || busy} onClick={onGenerate}>{generating ? '正在评分…' : '重新评分'}</button>}
    {generating && onStop && <button type="button" className="ml-2 min-h-11 text-xs" onClick={onStop}>停止生成</button>}
    {error && <p role="alert" className="text-xs text-rose-600">{error}</p>}
  </section>;
}
