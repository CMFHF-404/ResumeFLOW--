import React, { useEffect, useRef } from 'react';
import { FileWarning, ListChecks, Wand2 } from 'lucide-react';
import { normalizeResumeEvaluationDisplay } from './evaluationReportUtils.mjs';
import {
    trackResumeOptimizationCtaClick,
    trackResumeOptimizationCtaView,
} from '../../../../utils/analyticsTracker';

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
    onStartOptimization?: () => void;
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
    const optimizationCtaRef = useRef<HTMLButtonElement | null>(null);
    const ctaViewTrackedRef = useRef(false);
    const isGuidance = report?.kind === 'guidance';

    useEffect(() => {
        const node = optimizationCtaRef.current;
        if (!isGuidance || !canStartOptimization || isOutdated || isOptimizationBusy) {
            return undefined;
        }
        if (!report || !isOptimizationEnabled || !onStartOptimization || !node || ctaViewTrackedRef.current) {
            return undefined;
        }
        const trackIfVisible = (isIntersecting: boolean) => {
            if (!isIntersecting || ctaViewTrackedRef.current || node.getClientRects().length === 0) return;
            if (node.closest('[inert], [aria-hidden="true"]')) return;
            const style = window.getComputedStyle(node);
            if (style.display === 'none' || style.visibility === 'hidden') return;
            ctaViewTrackedRef.current = true;
            trackResumeOptimizationCtaView();
        };
        if (typeof IntersectionObserver === 'function') {
            const observer = new IntersectionObserver((entries) => {
                trackIfVisible(Boolean(entries[0]?.isIntersecting));
            });
            observer.observe(node);
            return () => observer.disconnect();
        }
        const frame = window.requestAnimationFrame(() => trackIfVisible(true));
        return () => window.cancelAnimationFrame(frame);
    }, [
        canStartOptimization, isGuidance, isOptimizationBusy, isOptimizationEnabled,
        isOutdated, onStartOptimization, report,
    ]);

    if (!report) {
        const placeholderContent = <>
            <FileWarning className="mx-auto h-5 w-5 text-slate-400" />
            <span className="mt-2 block text-[12px] font-bold text-slate-700 dark:text-slate-200">简历改进指导待更新</span>
            <span className="mt-1 block text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">基于六大维度给出有证据支持的改进建议</span>
            <span className="mt-3 inline-flex rounded-md border border-emerald-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-emerald-700 dark:border-emerald-800 dark:bg-slate-900 dark:text-emerald-300">
                {isGenerating ? (thinkingText ? `生成中：${thinkingText}` : '正在生成简历改进指导…') : '获取简历改进指导'}
            </span>
            {error ? <span role="alert" className="mt-2 block text-[11px] text-rose-600 dark:text-rose-300">{error}</span> : null}
        </>;
        if (onGenerate && !isGenerating) {
            return (
                <button
                    type="button"
                    onClick={onGenerate}
                    aria-label="获取简历改进指导"
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

    const resolvedOptimizationDisabledReason = report.kind === 'legacy'
        ? '历史数值报告不能用于新的优化，请重新生成简历改进指导。'
        : isOutdated
            ? '简历改进指导已过期，请重新生成后再优化。'
            : isOptimizationBusy
                ? '简历优化正在进行，请稍候。'
                : !canStartOptimization
                    ? (optimizationDisabledReason || '当前暂不满足优化条件。')
                    : null;

    return (
        <section className="space-y-3" aria-label="简历改进指导">
            {isOutdated ? (
                <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-medium leading-relaxed text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-200">
                    这是较早版本简历的历史指导；当前内容已变化，请重新生成后再据此优化。
                </div>
            ) : null}
            <div className="overflow-hidden rounded-xl border border-emerald-100/70 bg-gradient-to-br from-emerald-50/75 via-white to-amber-50/30 p-4 shadow-[0_10px_28px_rgba(16,185,129,0.045)] dark:border-emerald-900/35 dark:from-emerald-950/25 dark:via-slate-950 dark:to-amber-950/10">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <p className="text-[10.5px] font-bold tracking-[0.12em] text-emerald-700/75 dark:text-emerald-300/75">RESUME GUIDANCE</p>
                        <h4 className="mt-1 text-[13px] font-bold text-slate-900 dark:text-white">简历改进指导{report.kind === 'legacy' ? ' · 历史报告' : ''}</h4>
                    </div>
                    <span className="rounded-md bg-emerald-100/75 px-2 py-1 text-[10.5px] font-semibold text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">
                        整体状态：{BAND_LABELS[report.overallBand] || report.overallBand}
                    </span>
                </div>
                {report.kind === 'guidance' ? <p className="mt-2 text-[10.5px] text-slate-500 dark:text-slate-400">{CONFIDENCE_LABELS[report.confidence]}</p> : null}
                {summary ? <p className="mt-3 border-l-2 border-emerald-500/60 pl-3 text-[11.5px] leading-relaxed text-slate-700 dark:text-slate-300">{summary}</p> : null}
                {isOptimizationEnabled && onStartOptimization ? (
                    <div className="mt-3 flex flex-col items-start gap-1.5">
                        <p className="text-[10.5px] leading-relaxed text-slate-500 dark:text-slate-400">
                            本次优化按实际模型用量消耗 Token，改写会保持在可核实的事实边界内。
                        </p>
                        <button
                            ref={optimizationCtaRef}
                            type="button"
                            onClick={() => {
                                trackResumeOptimizationCtaClick();
                                onStartOptimization?.();
                            }}
                            data-resume-optimization-focus-return="true"
                            disabled={!isGuidance || isOutdated || isOptimizationBusy || !canStartOptimization}
                            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-[11px] font-bold text-white shadow-sm transition-colors hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:focus-visible:ring-offset-slate-950"
                        >
                            <Wand2 className="h-3.5 w-3.5" aria-hidden="true" />
                            根据指导优化
                        </button>
                        {resolvedOptimizationDisabledReason ? (
                            <p role="status" className="text-[10.5px] leading-relaxed text-slate-500 dark:text-slate-400">
                                {resolvedOptimizationDisabledReason}
                            </p>
                        ) : null}
                    </div>
                ) : null}
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
                >{isGenerating ? '正在重新生成简历改进指导…' : '重新生成简历改进指导'}</button> : null}
                {error ? <p role="alert" className="mt-2 text-[11px] text-rose-600 dark:text-rose-300">{error}</p> : null}
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
        </section>
    );
};
