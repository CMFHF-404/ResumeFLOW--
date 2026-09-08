import React, { useMemo } from 'react';
import { useScoreAnnotations } from '../ResumeEvaluationReport/ScoreAnnotations';

import type { ResumeOptimizationPlan } from '../../../../types/resumeOptimization';
import {
    buildResumeOptimizationSafetyFindingCopy,
    formatResumeOptimizationModuleLabel,
    formatResumeOptimizationSourceLabel,
    formatResumeOptimizationUserCopy,
    isResumeOptimizationChangeReviewable,
    sortResumeOptimizationChangesByResumeOrder,
} from './optimizationDisplayUtils.mjs';

type ResumeOptimizationOverviewProps = {
    plan: ResumeOptimizationPlan;
    moduleOrder?: string[];
};

export const ResumeOptimizationOverview: React.FC<ResumeOptimizationOverviewProps> = ({ plan, moduleOrder = [] }) => {
    const { experienceNameFor } = useScoreAnnotations();
    const priorities = useMemo(
        () => sortResumeOptimizationChangesByResumeOrder(
            plan.changes.filter(isResumeOptimizationChangeReviewable),
            moduleOrder,
        ),
        [moduleOrder, plan.changes],
    );
    const blockedChanges = useMemo(
        () => sortResumeOptimizationChangesByResumeOrder(
            plan.changes.filter((change) => change.safetyStatus === 'blocked'),
            moduleOrder,
        ),
        [moduleOrder, plan.changes],
    );

    return (
        <div className="space-y-5">
            <section aria-labelledby="resume-optimization-overview-title">
                <div className="max-w-2xl">
                    <p className="text-[10px] font-bold tracking-[0.14em] text-emerald-700 dark:text-emerald-300">
                        PLAN AT A GLANCE
                    </p>
                    <h3
                        id="resume-optimization-overview-title"
                        className="mt-1 text-lg font-bold text-slate-950 dark:text-white"
                    >
                        查看优化计划
                    </h3>
                    <p className="mt-2 text-[12px] leading-6 text-slate-500 dark:text-slate-400">
                        查看所选模块的改写与补充问题，逐项确认后应用。
                    </p>
                </div>


            </section>

            {blockedChanges.length > 0 ? (
                <section
                    aria-labelledby="resume-optimization-blocked-overview-title"
                    className="overflow-hidden rounded-2xl border border-rose-200/80 bg-rose-50/45 dark:border-rose-900/70 dark:bg-rose-950/20"
                >
                    <div className="border-b border-rose-200/80 px-4 py-3 dark:border-rose-900/70 md:px-5">
                        <h3 id="resume-optimization-blocked-overview-title" className="text-sm font-bold text-rose-900 dark:text-rose-100">
                            安全阻断说明
                        </h3>
                        <p className="mt-1 text-[11px] text-rose-800 dark:text-rose-200">以下改写不会被应用，原文会保持不变。</p>
                    </div>
                    <ul className="divide-y divide-rose-200/80 dark:divide-rose-900/60">
                        {blockedChanges.map((change) => (
                            <li key={change.changeId} className="px-4 py-3 md:px-5">
                                <p className="text-[11px] font-bold text-slate-800 dark:text-slate-100">
                                    {formatResumeOptimizationModuleLabel(change.moduleType, change.fieldPath).replace(/^经历 STAR · /, '')}
                                </p>
                                <ul className="mt-1.5 space-y-1 text-[11px] leading-5 text-rose-800 dark:text-rose-100">
                                    {buildResumeOptimizationSafetyFindingCopy(change.safetyFindings).map((finding) => (
                                        <li key={finding}>{finding}</li>
                                    ))}
                                </ul>
                            </li>
                        ))}
                    </ul>
                </section>
            ) : null}

            <section
                aria-labelledby="resume-optimization-priority-title"
                className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white/85 dark:border-slate-800 dark:bg-slate-950/50"
            >
                <div className="border-b border-slate-200/80 px-4 py-3 dark:border-slate-800 md:px-5">
                    <h3 id="resume-optimization-priority-title" className="text-sm font-bold text-slate-900 dark:text-white">
                        处理顺序
                    </h3>
                    <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">按简历内容中的出现顺序排列</p>
                </div>
                {priorities.length > 0 ? (
                    <ol className="divide-y divide-slate-100 dark:divide-slate-800/80">
                        {priorities.map((change, index) => (
                            <li key={change.changeId} className="flex gap-3 px-4 py-4 md:px-5">
                                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-slate-100 text-[11px] font-black text-slate-600 dark:bg-slate-800 dark:text-slate-200">
                                    {index + 1}
                                </span>
                                <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700 dark:bg-emerald-950/45 dark:text-emerald-200">
                                            {change.moduleType === 'experience_star' ? experienceNameFor(change.moduleId) || '未命名经历' : formatResumeOptimizationModuleLabel(change.moduleType, change.fieldPath)}
                                        </span>
                                        <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                                            {formatResumeOptimizationModuleLabel(change.moduleType, change.fieldPath).replace(/^经历 STAR · /, '')}
                                        </span>
                                    </div>
                                    <p className="mt-2 text-[12px] leading-5 text-slate-700 dark:text-slate-200">
                                        {formatResumeOptimizationUserCopy(
                                            change.rationale,
                                            '该项会在事实边界内改善简历表达。',
                                        )}
                                    </p>
                                    {change.sourceLabels.length > 0 ? (
                                        <p className="mt-2 text-[10px] text-slate-400 dark:text-slate-500">
                                            依据：{change.sourceLabels.map(formatResumeOptimizationSourceLabel).join(' · ')}
                                        </p>
                                    ) : null}
                                </div>
                            </li>
                        ))}
                    </ol>
                ) : (
                    <p className="px-5 py-8 text-center text-[12px] text-slate-500 dark:text-slate-400">
                        没有可安全应用的修改，请重新生成优化方案。
                    </p>
                )}
            </section>
        </div>
    );
};
