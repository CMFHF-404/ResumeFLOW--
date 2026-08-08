import React from 'react';
import { FileWarning, ListChecks } from 'lucide-react';
import {
    buildRadarAxis,
    buildRadarPoints,
    EVALUATION_DIMENSIONS,
    normalizeResumeEvaluation,
} from './evaluationReportUtils.mjs';

type ResumeEvaluationReportProps = {
    evaluation: unknown;
    summary?: string;
    isOutdated?: boolean;
    isGenerating?: boolean;
    error?: string | null;
    thinkingText?: string;
    onGenerate?: () => void;
    onStop?: () => void;
};

const ReportList: React.FC<{
    title: string;
    items: string[];
    tone: 'emerald' | 'amber' | 'rose';
    emptyText: string;
}> = ({ title, items, tone, emptyText }) => {
    const toneClass = tone === 'emerald'
        ? 'border-emerald-100/70 bg-emerald-50/35 text-emerald-950 dark:border-emerald-900/35 dark:bg-emerald-950/15 dark:text-emerald-100'
        : tone === 'rose'
            ? 'border-rose-100/70 bg-rose-50/35 text-rose-950 dark:border-rose-900/35 dark:bg-rose-950/15 dark:text-rose-100'
            : 'border-amber-100/70 bg-amber-50/35 text-amber-950 dark:border-amber-900/35 dark:bg-amber-950/15 dark:text-amber-100';
    return (
        <section className={`rounded-xl border p-3 ${toneClass}`}>
            <h5 className="text-[11px] font-bold tracking-wide">{title}</h5>
            {items.length ? (
                <ul className="mt-2 space-y-1.5 text-[11px] leading-relaxed">
                    {items.map((item, index) => <li key={`${item}-${index}`} className="flex gap-1.5"><span aria-hidden="true">•</span><span>{item}</span></li>)}
                </ul>
            ) : <p className="mt-2 text-[11px] opacity-70">{emptyText}</p>}
        </section>
    );
};

const ResumeEvaluationRadar: React.FC<{
    dimensions: Array<{ dimension: string; score: number; unavailable?: boolean }>;
}> = ({ dimensions }) => {
    const scores = dimensions.map((item) => item.score);
    const polygonPoints = buildRadarPoints(scores);
    const rings = [25, 50, 75, 100];
    const label = `六维简历评估雷达图：${dimensions.map((item) => `${item.dimension} ${item.score} 分`).join('，')}`;

    return (
        <div className="rounded-xl border border-amber-100/70 bg-gradient-to-br from-amber-50/55 via-white to-emerald-50/25 p-3 dark:border-amber-900/35 dark:from-amber-950/15 dark:via-slate-950 dark:to-emerald-950/10">
            <svg viewBox="-14 -7 128 114" role="img" aria-label={label} className="mx-auto block w-full max-w-[320px] overflow-visible">
                <title>{label}</title>
                {rings.map((ring) => <polygon key={ring} points={buildRadarPoints(Array(6).fill(ring))} fill="none" stroke="currentColor" strokeWidth="0.45" className="text-amber-200/80 dark:text-amber-900/60" />)}
                {EVALUATION_DIMENSIONS.map((dimension, index) => {
                    const axis = buildRadarAxis(index);
                    const text = buildRadarAxis(index, 49);
                    const item = dimensions[index];
                    const scoreText = item?.unavailable ? '待评' : `${item?.score ?? 0} 分`;
                    const anchor = text.x < 43 ? 'end' : text.x > 57 ? 'start' : 'middle';
                    return <g key={dimension}>
                        <line x1="50" y1="50" x2={axis.x} y2={axis.y} stroke="currentColor" strokeWidth="0.45" className="text-amber-200/80 dark:text-amber-900/60" />
                        <text x={text.x} y={text.y} textAnchor={anchor} className="text-[4px]">
                            <tspan x={text.x} dy="-1.5" className="fill-slate-500 font-medium dark:fill-slate-400">{dimension}</tspan>
                            <tspan x={text.x} dy="4.8" className="fill-amber-700 font-bold dark:fill-amber-300">{scoreText}</tspan>
                        </text>
                    </g>;
                })}
                <polygon points={polygonPoints} fill="rgba(245, 158, 11, 0.22)" stroke="rgb(217, 119, 6)" strokeWidth="1.25" strokeLinejoin="round" className="dark:fill-amber-400/20 dark:stroke-amber-300" />
                {scores.map((score, index) => {
                    const point = buildRadarAxis(index, 42 * score / 100);
                    return <circle key={EVALUATION_DIMENSIONS[index]} cx={point.x} cy={point.y} r="1.35" className="fill-amber-600 dark:fill-amber-300" />;
                })}
            </svg>
        </div>
    );
};

export const ResumeEvaluationReport: React.FC<ResumeEvaluationReportProps> = ({
    evaluation,
    summary,
    isOutdated = false,
    isGenerating = false,
    error,
    thinkingText,
    onGenerate,
    onStop,
}) => {
    const report = normalizeResumeEvaluation(evaluation);
    if (!report) {
        const placeholderContent = <>
            <FileWarning className="mx-auto h-5 w-5 text-slate-400" />
            <span className="mt-2 block text-[12px] font-bold text-slate-700 dark:text-slate-200">六维报告待更新</span>
            <span className="mt-1 block text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">基于六大维度，对简历质量进行深度评价</span>
            <span className="mt-3 inline-flex rounded-md border border-emerald-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-emerald-700 dark:border-emerald-800 dark:bg-slate-900 dark:text-emerald-300">
                {isGenerating ? (thinkingText ? `生成中：${thinkingText}` : '正在生成六维报告…') : '获取六维报告'}
            </span>
            {error ? <span role="alert" className="mt-2 block text-[11px] text-rose-600 dark:text-rose-300">{error}</span> : null}
        </>;
        if (onGenerate && !isGenerating) {
            return (
                <button
                    type="button"
                    onClick={onGenerate}
                    aria-label="获取六维报告"
                    className="block w-full rounded-xl border border-dashed border-slate-200 bg-slate-50/55 p-4 text-center transition hover:border-emerald-300 hover:bg-emerald-50/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70 dark:border-slate-800 dark:bg-slate-900/35 dark:hover:border-emerald-800 dark:focus-visible:ring-offset-slate-950"
                >
                    {placeholderContent}
                </button>
            );
        }
        return (
            <section className="rounded-xl border border-dashed border-slate-200 bg-slate-50/55 p-4 text-center dark:border-slate-800 dark:bg-slate-900/35" aria-busy={isGenerating}>
                {placeholderContent}
                {isGenerating && onStop ? <button
                    type="button"
                    onClick={onStop}
                    className="mt-3 rounded-md border border-rose-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2 dark:border-rose-900 dark:bg-slate-900 dark:text-rose-300 dark:focus-visible:ring-offset-slate-950"
                >停止生成</button> : null}
            </section>
        );
    }

    return (
        <section className="space-y-3" aria-label="简历分析报告">
            {isOutdated ? (
                <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-medium leading-relaxed text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-200">
                    这是较早版本简历的历史评分；当前内容已变化，请重新评分后再据此判断。
                </div>
            ) : null}
            <div className="overflow-hidden rounded-xl border border-emerald-100/70 bg-gradient-to-br from-emerald-50/75 via-white to-amber-50/30 p-4 shadow-[0_10px_28px_rgba(16,185,129,0.045)] dark:border-emerald-900/35 dark:from-emerald-950/25 dark:via-slate-950 dark:to-amber-950/10">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <p className="text-[10.5px] font-bold tracking-[0.12em] text-emerald-700/75 dark:text-emerald-300/75">RESUME EVALUATION</p>
                        <h4 className="mt-1 text-[13px] font-bold text-slate-900 dark:text-white">简历分析报告{isOutdated ? ' · 历史评分' : ''}</h4>
                    </div>
                    <div className="text-right"><strong className="text-3xl font-black tracking-tight text-emerald-700 dark:text-emerald-300">{report.overallScore}</strong><span className="ml-1 text-[11px] font-bold text-emerald-700 dark:text-emerald-300">分</span></div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5 text-[10.5px]">
                    <span className="rounded-md bg-emerald-100/75 px-2 py-1 font-semibold text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">{report.overallLevel || '综合等级待标注'}</span>
                </div>
                {summary ? <p className="mt-3 border-l-2 border-emerald-500/60 pl-3 text-[11.5px] leading-relaxed text-slate-700 dark:text-slate-300">{summary}</p> : null}
                {isGenerating && onStop ? <button
                    type="button"
                    onClick={onStop}
                    className="mt-3 text-[11px] font-semibold text-rose-700 underline decoration-rose-300 underline-offset-2 dark:text-rose-300"
                >停止生成</button> : onGenerate ? <button
                    type="button"
                    onClick={onGenerate}
                    disabled={isGenerating}
                    aria-busy={isGenerating}
                    className="mt-3 text-[11px] font-semibold text-emerald-700 underline decoration-emerald-300 underline-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:text-emerald-300"
                >{isGenerating ? '正在重新生成六维报告…' : '重新生成六维报告'}</button> : null}
                {error ? <p role="alert" className="mt-2 text-[11px] text-rose-600 dark:text-rose-300">{error}</p> : null}
            </div>

            <div className="space-y-3">
                <ResumeEvaluationRadar dimensions={report.dimensions} />
                <div className="space-y-2">
                    <ReportList title="优先改进" items={report.topPriorities} tone="amber" emptyText="暂未列出优先改进项" />
                    <ReportList title="待补信息" items={report.missingInformation} tone="emerald" emptyText="当前没有待补信息" />
                    <ReportList title="风险提示" items={report.riskFlags} tone="rose" emptyText="未发现额外风险提示" />
                </div>
            </div>

            {report.issues.length ? <ReportList title="总体问题" items={report.issues} tone="amber" emptyText="暂无总体问题" /> : null}

            <div className="space-y-2">
                <div className="flex items-center gap-1.5 text-slate-800 dark:text-slate-100"><ListChecks className="h-4 w-4 text-emerald-600 dark:text-emerald-400" /><h4 className="text-[12px] font-bold">六维评分明细</h4></div>
                {report.dimensions.map((item) => (
                    <details key={item.dimension} className="group rounded-xl border border-slate-200/75 bg-white/70 dark:border-slate-800 dark:bg-slate-900/30">
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-3 text-[11.5px] [&::-webkit-details-marker]:hidden"><span className="font-semibold text-slate-800 dark:text-slate-100">{item.dimension}</span><span className="flex items-center gap-2"><span className="text-slate-500 dark:text-slate-400">{item.level || (item.unavailable ? '待评' : '未标注')}</span><strong className="rounded-md bg-amber-50 px-1.5 py-0.5 text-amber-700 dark:bg-amber-950/35 dark:text-amber-300">{item.unavailable ? '—' : `${item.score} 分`}</strong></span></summary>
                        <div className="space-y-2 border-t border-slate-100 px-3 py-3 text-[11px] leading-relaxed dark:border-slate-800">
                            {item.unavailable ? <p className="text-slate-500 dark:text-slate-400">该维度尚未返回评分，重新评分后会补齐。</p> : <>
                                <ReportList title="亮点" items={item.strengths} tone="emerald" emptyText="暂无明确亮点" />
                                <ReportList title="问题" items={item.issues} tone="amber" emptyText="暂无明确问题" />
                                <ReportList title="改进问题" items={item.improvementQuestions} tone="rose" emptyText="暂无追问" />
                                {item.subscores.length ? <p className="text-slate-500 dark:text-slate-400">子项：{item.subscores.join(' · ')}</p> : null}
                            </>}
                        </div>
                    </details>
                ))}
            </div>
        </section>
    );
};
