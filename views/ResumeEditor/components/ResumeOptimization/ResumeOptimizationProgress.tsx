import React from 'react';
import { LoaderCircle, ShieldCheck } from 'lucide-react';

type ResumeOptimizationProgressProps = {
    progressText: string;
};

export const ResumeOptimizationProgress: React.FC<ResumeOptimizationProgressProps> = ({
    progressText,
}) => (
    <section
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="mx-auto flex max-w-xl flex-col items-center rounded-2xl border border-emerald-100/80 bg-gradient-to-br from-emerald-50/70 via-white to-slate-50/70 px-6 py-10 text-center dark:border-emerald-900/40 dark:from-emerald-950/25 dark:via-slate-950 dark:to-slate-900/40"
    >
        <span className="relative grid h-12 w-12 place-items-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-200">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
            <LoaderCircle className="absolute h-12 w-12 animate-spin text-emerald-500/70 motion-reduce:animate-none" aria-hidden="true" />
        </span>
        <h3 className="mt-4 text-sm font-bold text-slate-900 dark:text-white">正在准备优化工作区</h3>
        <p className="mt-2 text-[12px] leading-relaxed text-slate-600 dark:text-slate-300">
            {progressText || '正在准备优化方案…'}
        </p>
        <p className="mt-3 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
            我们会先固定当前版本，再检查事实边界。
        </p>
    </section>
);
