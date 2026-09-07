import React from 'react';
import { AlertTriangle, CheckCircle2, RotateCcw, RefreshCw, ShieldCheck } from 'lucide-react';

import type { ResumeOptimizationRun } from '../../../../types/resumeOptimization';
import { ResumeOptimizationScoreDelta } from './ResumeOptimizationScoreDelta';

type ResumeOptimizationResultProps = {
    run: ResumeOptimizationRun;
    busy: boolean;
    error: string | null;
    onRetry: () => unknown;
    onRevert: () => unknown;
};

const Metric: React.FC<{ label: string; value: number | string; tone?: 'emerald' | 'amber' | 'slate' }> = ({
    label,
    value,
    tone = 'slate',
}) => (
    <div className={`rounded-xl border p-3 ${
        tone === 'emerald'
            ? 'border-emerald-200 bg-emerald-50/75 dark:border-emerald-900/70 dark:bg-emerald-950/25'
            : tone === 'amber'
                ? 'border-amber-200 bg-amber-50/75 dark:border-amber-900/70 dark:bg-amber-950/25'
                : 'border-slate-200 bg-white/80 dark:border-slate-800 dark:bg-slate-950/55'
    }`}>
        <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">{label}</p>
        <p className="mt-1 text-lg font-black tabular-nums text-slate-900 dark:text-white">{value}</p>
    </div>
);

export const ResumeOptimizationResult: React.FC<ResumeOptimizationResultProps> = ({
    run,
    busy,
    error,
    onRetry,
    onRevert,
}) => {
    const plan = run.result ?? run.plan;
    const evaluation = run.postEvaluation;
    const guidanceEvaluation = evaluation?.version === 'guidance_optimization_post_v1'
        ? evaluation
        : null;
    const isApplied = run.status === 'applied';
    const canRevert = run.status === 'applied' || run.status === 'completed';
    const acceptedCount = evaluation?.acceptedChangeCount ?? run.acceptedChangeIds.length;
    const blockedCount = evaluation?.blockedChangeCount ?? plan.safetySummary.blockedChangeIds.length;
    const bankCount = evaluation?.bankSuggestionCount ?? plan.bankSuggestions.length;

    const requestRevert = () => {
        if (!window.confirm('撤销仅适用于应用后未继续手工编辑的简历；后续手工编辑后将不可撤销。是否继续？')) {
            return;
        }
        onRevert();
    };

    return (
        <section aria-labelledby="resume-optimization-result-title" className="space-y-5">
            <div className="rounded-2xl border border-emerald-200/80 bg-gradient-to-br from-emerald-50 via-white to-slate-50 p-5 dark:border-emerald-900/65 dark:from-emerald-950/35 dark:via-slate-950 dark:to-slate-950">
                <div className="flex items-start gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-200">
                        {evaluation ? <CheckCircle2 className="h-5 w-5" aria-hidden="true" /> : <ShieldCheck className="h-5 w-5" aria-hidden="true" />}
                    </span>
                    <div className="min-w-0">
                        <p className="text-[10px] font-bold tracking-[0.14em] text-emerald-700 dark:text-emerald-300">VERIFIED RESULT</p>
                        <h3 id="resume-optimization-result-title" className="mt-1 text-lg font-black text-slate-950 dark:text-white">
                            {evaluation ? '优化与六维指导审核已完成' : '内容已应用，审核尚未完成'}
                        </h3>
                        <p className="mt-2 text-[12px] leading-6 text-slate-600 dark:text-slate-300">
                            {evaluation
                                ? '以下等级和问题状态来自应用后实际简历的独立审核。'
                                : '已确认的文字不会自动回滚；审核可以安全重试。'}
                        </p>
                    </div>
                </div>
            </div>

            {guidanceEvaluation ? (
                <ResumeOptimizationScoreDelta
                    overallBandBefore={guidanceEvaluation.overallBandBefore}
                    overallBandAfter={guidanceEvaluation.overallBandAfter}
                    dimensionStatusChanges={guidanceEvaluation.dimensionStatusChanges}
                />
            ) : null}

            <div className="grid grid-cols-2 gap-2 md:grid-cols-5 md:gap-3">
                <Metric label="已接受修改" value={acceptedCount} tone="emerald" />
                <Metric
                    label="已解决问题"
                    value={guidanceEvaluation?.issueSummary.resolved
                        ?? (evaluation?.version === 'resume_optimization_post_evaluation_v1'
                            ? evaluation.issueCounts.resolved
                            : '待审核')}
                    tone="emerald"
                />
                <Metric label="事实缺口" value={evaluation?.unresolvedFactGapCount ?? '待审核'} tone="amber" />
                <Metric label="安全阻断" value={blockedCount} tone={blockedCount > 0 ? 'amber' : 'slate'} />
                <Metric label="经历库机会" value={bankCount} />
            </div>

            {error ? (
                <div role="alert" className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[11px] leading-5 text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/25 dark:text-amber-200">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>{error}</span>
                </div>
            ) : null}

            {canRevert ? (
                <p className="text-right text-[10px] leading-5 text-slate-500 dark:text-slate-400">
                    仅在应用后没有后续手工编辑时可撤销，避免覆盖新内容。
                </p>
            ) : null}

            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                {isApplied ? (
                    <button
                        type="button"
                        disabled={busy}
                        onClick={onRetry}
                        className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-[12px] font-bold text-white transition hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none dark:bg-emerald-500 dark:text-slate-950 dark:hover:bg-emerald-400"
                    >
                        <RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden="true" />
                        重试审核
                    </button>
                ) : null}
                {canRevert ? (
                    <button
                        type="button"
                        disabled={busy}
                        onClick={requestRevert}
                        className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-[12px] font-bold text-slate-700 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                        <RotateCcw className="h-4 w-4" aria-hidden="true" />
                        撤销本次应用
                    </button>
                ) : null}
            </div>
        </section>
    );
};
