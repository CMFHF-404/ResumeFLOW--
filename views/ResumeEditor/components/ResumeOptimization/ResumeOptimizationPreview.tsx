import React from 'react';

import type { ExperienceCategory } from '../../../../services/experienceService';
import type { ResumeOptimizationPlan } from '../../../../types/resumeOptimization';
import { ResumeOptimizationBankSuggestions } from './ResumeOptimizationBankSuggestions';
import { ResumeOptimizationDiffCard } from './ResumeOptimizationDiffCard';
import {
    isResumeOptimizationChangeReviewable,
    sortResumeOptimizationChangesByResumeOrder,
} from './optimizationDisplayUtils.mjs';

type ResumeOptimizationPreviewProps = {
    resumeId: string;
    runId: string;
    plan: ResumeOptimizationPlan;
    acceptedChangeIds: string[];
    readOnly: boolean;
    skillNameById: Record<string, string>;
    onToggleChange: (changeId: string) => void;
    onAcceptAll?: () => void;
    onViewExperience: (
        category: ExperienceCategory | undefined,
        masterExperienceId: string,
    ) => void;
    onOpenAutoAssembly: () => void;
    surface?: 'modal' | 'sidebar';
    moduleOrder?: string[];
};

export const ResumeOptimizationPreview: React.FC<ResumeOptimizationPreviewProps> = ({
    resumeId,
    runId,
    plan,
    acceptedChangeIds,
    readOnly,
    skillNameById,
    onToggleChange,
    onAcceptAll,
    onViewExperience,
    onOpenAutoAssembly,
    surface = 'modal',
    moduleOrder = [],
}) => {
    const reviewableChanges = sortResumeOptimizationChangesByResumeOrder(
        plan.changes.filter(isResumeOptimizationChangeReviewable),
        moduleOrder,
    );
    const blockedChanges = sortResumeOptimizationChangesByResumeOrder(
        plan.changes.filter((change) => change.safetyStatus === 'blocked'),
        moduleOrder,
    );

    return (
        <div className="space-y-5">
        <section aria-labelledby="resume-optimization-preview-title">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <p className="text-[10px] font-bold tracking-[0.14em] text-emerald-700 dark:text-emerald-300">REVIEW THE DIFF</p>
                    <h3 id="resume-optimization-preview-title" className="mt-1 text-lg font-bold text-slate-950 dark:text-white">对照确认每一项修改</h3>
                </div>
                    <button type="button" onClick={onAcceptAll}
                        disabled={readOnly || !onAcceptAll || reviewableChanges.length === 0 || reviewableChanges.every(change => acceptedChangeIds.includes(change.changeId))}
                        className="min-h-[44px] shrink-0 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                        全部接受
                    </button>
            </div>
            <p className="mt-2 text-[12px] leading-6 text-slate-500 dark:text-slate-400">
                逐项比较原文与改写，选择采用优化或保留原文。
            </p>

            <div className="mt-4 space-y-3">
                {reviewableChanges.length > 0 ? reviewableChanges.map((change) => (
                    <ResumeOptimizationDiffCard
                        key={change.changeId}
                        change={change}
                        selected={acceptedChangeIds.includes(change.changeId)}
                        readOnly={readOnly}
                        skillNameById={skillNameById}
                        onToggleChange={onToggleChange}
                        surface={surface}
                    />
                )) : (
                    <div
                        role="status"
                        className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-5 text-center dark:border-amber-900/70 dark:bg-amber-950/30"
                    >
                        <p className="text-sm font-bold text-amber-900 dark:text-amber-100">
                            没有可安全应用的修改
                        </p>
                        <p className="mt-1 text-[11px] leading-5 text-amber-700 dark:text-amber-300">
                            当前方案中的改写无法安全复核，请重新生成优化方案后再继续。
                        </p>
                    </div>
                )}
            </div>
            {blockedChanges.length > 0 ? (
                <section className="mt-5" aria-labelledby="resume-optimization-blocked-title">
                    <h4 id="resume-optimization-blocked-title" className="text-sm font-bold text-rose-800 dark:text-rose-200">
                        安全阻断说明
                    </h4>
                    <p className="mt-1 text-[11px] leading-5 text-slate-500 dark:text-slate-400">
                        以下改写不会被选择或应用，原文会保持不变。
                    </p>
                    <div className="mt-3 space-y-3">
                        {blockedChanges.map((change) => (
                            <ResumeOptimizationDiffCard
                                key={change.changeId}
                                change={change}
                                selected={false}
                                readOnly={true}
                                skillNameById={skillNameById}
                                onToggleChange={onToggleChange}
                                surface={surface}
                            />
                        ))}
                    </div>
                </section>
            ) : null}
        </section>

        <ResumeOptimizationBankSuggestions
            resumeId={resumeId}
            runId={runId}
            suggestions={plan.bankSuggestions}
            onViewExperience={onViewExperience}
            onOpenAutoAssembly={onOpenAutoAssembly}
        />
        </div>
    );
};
