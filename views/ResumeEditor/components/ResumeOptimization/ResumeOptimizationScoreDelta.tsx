import React from 'react';

import type {
    GuidanceResumeOptimizationPostEvaluation,
} from '../../../../types/resumeOptimization';

type ResumeOptimizationScoreDeltaProps = {
    overallBandBefore: GuidanceResumeOptimizationPostEvaluation['overallBandBefore'];
    overallBandAfter: GuidanceResumeOptimizationPostEvaluation['overallBandAfter'];
    dimensionStatusChanges: GuidanceResumeOptimizationPostEvaluation['dimensionStatusChanges'];
};

const BAND_LABELS: Record<GuidanceResumeOptimizationPostEvaluation['overallBandBefore'], string> = {
    strong: '优势明显',
    adequate: '基本到位',
    needs_attention: '有明显改进空间',
    insufficient_evidence: '证据不足',
};

const bandTone = (status: GuidanceResumeOptimizationPostEvaluation['overallBandBefore']) => (
    status === 'strong'
        ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/70 dark:bg-emerald-950/30 dark:text-emerald-200'
        : status === 'adequate'
            ? 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900/70 dark:bg-sky-950/30 dark:text-sky-200'
            : status === 'needs_attention'
                ? 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-200'
                : 'border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
);

export const ResumeOptimizationScoreDelta: React.FC<ResumeOptimizationScoreDeltaProps> = ({
    overallBandBefore,
    overallBandAfter,
    dimensionStatusChanges,
}) => (
    <section aria-labelledby="resume-optimization-status-title" className="space-y-4">
        <h3 id="resume-optimization-status-title" className="sr-only">六维指导状态变化</h3>
        <div className="grid grid-cols-2 gap-2 md:gap-3">
            <div className={`rounded-xl border p-3 ${bandTone(overallBandBefore)}`}>
                <p className="text-[10px] font-bold opacity-75">优化前状态</p>
                <p className="mt-1 text-sm font-black">{BAND_LABELS[overallBandBefore]}</p>
            </div>
            <div className={`rounded-xl border p-3 ${bandTone(overallBandAfter)}`}>
                <p className="text-[10px] font-bold opacity-75">优化后状态</p>
                <p className="mt-1 text-sm font-black">{BAND_LABELS[overallBandAfter]}</p>
            </div>
        </div>

        <div className="grid gap-2 rounded-2xl border border-slate-200/80 bg-white/85 p-4 sm:grid-cols-2 dark:border-slate-800 dark:bg-slate-950/55">
            {dimensionStatusChanges.map((item) => (
                <div key={item.dimension} className="rounded-xl border border-slate-200 px-3 py-2 dark:border-slate-800">
                    <p className="text-[11px] font-bold text-slate-700 dark:text-slate-200">{item.dimension}</p>
                    <p className="mt-1 text-[10px] leading-5 text-slate-500 dark:text-slate-400">
                        {BAND_LABELS[item.beforeStatus]} <span aria-hidden="true">→</span>{' '}
                        <span className="font-bold text-slate-700 dark:text-slate-200">{BAND_LABELS[item.afterStatus]}</span>
                    </p>
                </div>
            ))}
        </div>
    </section>
);
