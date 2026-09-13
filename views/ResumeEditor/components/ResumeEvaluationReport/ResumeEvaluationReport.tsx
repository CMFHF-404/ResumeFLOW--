import { ResumeScoreReport, ScoreRadar } from './ResumeScoreReport';
import { normalizeResumeScore, EVIDENCE_SCORE_ENABLED } from '../../../../utils/resumeScore.mjs';
import { EVIDENCE_DIMENSIONS } from '../../../../utils/evidenceResumeScore.mjs';
import type { ResumeScoreEvaluation } from '../../../../types/ai';
import React from 'react';
import { ListChecks } from 'lucide-react';
import { EVALUATION_DIMENSIONS, normalizeResumeEvaluationDisplay } from './evaluationReportUtils.mjs';

type ResumeEvaluationReportProps = {
    evaluation: unknown;
    summary?: string;
    isOutdated?: boolean;
    isGenerating?: boolean;
    error?: string | null;
    thinkingText?: string;
    onGenerate?: () => void;
    onStop?: () => void;
    isOptimizationEnabled?: boolean;
    isOptimizationBusy?: boolean;
    canStartOptimization?: boolean;
    optimizationDisabledReason?: string | null;
    onStartOptimization?: (ids: string[]) => void;
};

const BAND_LABELS: Record<string, string> = {
    strong: '表现扎实',
    adequate: '基本完整',
    needs_attention: '有明显改进空间',
    insufficient_evidence: '现有信息不足',
    legacy: '历史报告',
};

const CONFIDENCE_LABELS: Record<string, string> = {
    high: '依据充分',
    medium: '依据有限',
    low: '需要补充信息',
};

const ReportList: React.FC<{
    title: string;
    items: string[];
    tone: 'emerald' | 'amber' | 'rose' | 'slate';
    emptyText: string;
}> = ({ title, items, tone, emptyText }) => {
    const toneClass = tone === 'emerald'
        ? 'border-emerald-100/70 bg-emerald-50/35 text-emerald-950 dark:border-emerald-900/35 dark:bg-emerald-950/15 dark:text-emerald-100'
        : tone === 'rose'
            ? 'border-rose-100/70 bg-rose-50/35 text-rose-950 dark:border-rose-900/35 dark:bg-rose-950/15 dark:text-rose-100'
            : tone === 'slate'
                ? 'border-slate-200/70 bg-slate-50/55 text-slate-900 dark:border-slate-800 dark:bg-slate-900/30 dark:text-slate-100'
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

export const ResumeEvaluationReport: React.FC<ResumeEvaluationReportProps> = ({
    evaluation,
    summary,
    isOutdated = false,
    isGenerating = false,
    error,
    thinkingText,
    onGenerate,
    onStop,
    isOptimizationEnabled = false,
    isOptimizationBusy = false,
    canStartOptimization = false,
    optimizationDisabledReason,
    onStartOptimization,
}) => {
    const report = normalizeResumeEvaluationDisplay(evaluation);
    const numericReport = normalizeResumeScore(evaluation);
    if (numericReport) return <ResumeScoreReport report={numericReport as ResumeScoreEvaluation} outdated={isOutdated}
        enabled={isOptimizationEnabled} busy={isOptimizationBusy} canStart={canStartOptimization}
        disabledReason={optimizationDisabledReason} onStart={onStartOptimization} onGenerate={onGenerate}
        generating={isGenerating} onStop={onStop} error={error} />;
    const hasHistoricalScores = report?.kind === 'legacy' && Array.isArray((evaluation as any)?.dimensions);
    const scoreEntry = <section className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-4 dark:border-emerald-900 dark:bg-slate-950" aria-label="六维简历评分" aria-busy={isGenerating}>
        <div className="flex items-center justify-between gap-3">
            <h4 className="text-sm font-bold text-slate-900 dark:text-white">六维简历评分</h4>
            {hasHistoricalScores ? <span className="text-xl font-bold text-emerald-700">{(evaluation as any).overallScore} 分<span className="ml-1 text-[10px]">历史评分</span></span> : <span className="text-xs text-slate-500">待评分</span>}
        </div>
        <ScoreRadar pending={!hasHistoricalScores} dimensions={hasHistoricalScores ? (evaluation as any).dimensions : (EVIDENCE_SCORE_ENABLED ? EVIDENCE_DIMENSIONS.map(([,name])=>name) : EVALUATION_DIMENSIONS).map(dimension => ({dimension, score: 0}))} />
        <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
            {report?.kind === 'guidance' ? '当前保存的是旧版文字指导，没有六维分数。生成六维评分后，将显示总分、雷达图和可选择的优化模块。'
                : hasHistoricalScores ? '这是历史数值报告。重新评分后可选择需要优化的模块。' : '评分同时标注可优化模块和改进方向。'}
        </p>
        {(onGenerate || (isGenerating && onStop)) && <button type="button" onClick={isGenerating ? onStop : onGenerate} disabled={isGenerating ? !onStop : isOptimizationBusy}
            className={`mt-3 min-h-[44px] w-full rounded-lg px-3 py-2 text-xs font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50 ${isGenerating
                ? 'bg-red-600 hover:bg-red-700 focus-visible:ring-red-500'
                : 'bg-emerald-600 hover:bg-emerald-700 focus-visible:ring-emerald-500'}`}>
            {isGenerating ? '停止生成' : hasHistoricalScores ? '重新进行六维评分' : '生成六维评分'}
        </button>}
        {isGenerating && thinkingText && <p className="mt-2 text-xs text-slate-500">{thinkingText}</p>}
        {error && <p role="alert" className="mt-2 text-xs text-rose-600">{error}</p>}
    </section>;
    if (!report) return scoreEntry;

    return (
        <section className="space-y-3" aria-label="六维评分与历史报告">
            {scoreEntry}
            <details className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
            <summary className="cursor-pointer text-xs font-semibold text-slate-600 dark:text-slate-300">{report.kind === 'guidance' ? '查看历史文字指导（无数值评分）' : '查看历史评分评语'}</summary>
            <div className="mt-3 space-y-3">
            {isOutdated ? (
                <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-medium leading-relaxed text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-200">
                    这是较早版本简历的历史指导；当前内容已变化，请重新生成后再据此优化。
                </div>
            ) : null}
            <div className="overflow-hidden rounded-xl border border-emerald-100/70 bg-gradient-to-br from-emerald-50/75 via-white to-amber-50/30 p-4 shadow-[0_10px_28px_rgba(16,185,129,0.045)] dark:border-emerald-900/35 dark:from-emerald-950/25 dark:via-slate-950 dark:to-amber-950/10">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <p className="text-[10.5px] font-bold tracking-[0.12em] text-emerald-700/75 dark:text-emerald-300/75">HISTORICAL REPORT</p>
                        <h4 className="mt-1 text-[13px] font-bold text-slate-900 dark:text-white">{report.kind === 'guidance' ? '历史文字指导' : '历史评分评语'}</h4>
                    </div>
                    <span className="rounded-md bg-emerald-100/75 px-2 py-1 text-[10.5px] font-semibold text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">
                        整体状态：{BAND_LABELS[report.overallBand] || report.overallBand}
                    </span>
                </div>
                {report.kind === 'guidance' ? <p className="mt-2 text-[10.5px] text-slate-500 dark:text-slate-400">{CONFIDENCE_LABELS[report.confidence]}</p> : null}
                {summary ? <p className="mt-3 border-l-2 border-emerald-500/60 pl-3 text-[11.5px] leading-relaxed text-slate-700 dark:text-slate-300">{summary}</p> : null}

            </div>

            <div className="space-y-2">
                <ReportList title="优先改善" items={report.topPriorities} tone="amber" emptyText="暂未列出优先改善项" />
                <ReportList title="可以直接整理" items={report.safeCleanup} tone="emerald" emptyText="暂无可直接整理项" />
                <ReportList title="需要补充信息" items={report.informationNeeded} tone="slate" emptyText="当前没有待补信息" />
                <ReportList title="风险提示" items={report.riskFlags} tone="rose" emptyText="未发现额外风险提示" />
            </div>

            <div className="space-y-2">
                <div className="flex items-center gap-1.5 text-slate-800 dark:text-slate-100"><ListChecks className="h-4 w-4 text-emerald-600 dark:text-emerald-400" /><h4 className="text-[12px] font-bold">六维改进指导</h4></div>
                {report.dimensions.map((item) => (
                    <details key={item.dimension} className="group rounded-xl border border-slate-200/75 bg-white/70 dark:border-slate-800 dark:bg-slate-900/30">
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-3 text-[11.5px] [&::-webkit-details-marker]:hidden"><span className="font-semibold text-slate-800 dark:text-slate-100">{item.dimension}</span><span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-slate-600 dark:bg-slate-800 dark:text-slate-300">{item.unavailable ? '待补充' : BAND_LABELS[item.status] || item.status}</span></summary>
                        <div className="space-y-2 border-t border-slate-100 px-3 py-3 text-[11px] leading-relaxed dark:border-slate-800">
                            <ReportList title="优势" items={item.strengths} tone="emerald" emptyText="暂无明确优势" />
                            <ReportList title="问题" items={item.issues} tone="amber" emptyText="暂无明确问题" />
                            <ReportList title="建议" items={item.actions} tone="slate" emptyText="暂无进一步建议" />
                        </div>
                    </details>
                ))}
            </div>
            </div>
            </details>
        </section>
    );
};
