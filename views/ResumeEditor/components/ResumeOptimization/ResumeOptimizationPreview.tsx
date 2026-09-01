import React from 'react';

import type { ExperienceCategory } from '../../../../services/experienceService';
import type { ResumeOptimizationPlan } from '../../../../types/resumeOptimization';
import { ResumeOptimizationBankSuggestions } from './ResumeOptimizationBankSuggestions';
import { ResumeOptimizationDiffCard } from './ResumeOptimizationDiffCard';

type ResumeOptimizationPreviewProps = {
    plan: ResumeOptimizationPlan;
    acceptedChangeIds: string[];
    readOnly: boolean;
    skillNameById: Record<string, string>;
    onToggleChange: (changeId: string) => void;
    onViewExperience: (
        category: ExperienceCategory | undefined,
        masterExperienceId: string,
    ) => void;
    onOpenAutoAssembly: () => void;
};

export const ResumeOptimizationPreview: React.FC<ResumeOptimizationPreviewProps> = ({
    plan,
    acceptedChangeIds,
    readOnly,
    skillNameById,
    onToggleChange,
    onViewExperience,
    onOpenAutoAssembly,
}) => (
    <div className="space-y-5">
        <section aria-labelledby="resume-optimization-preview-title">
            <div className="max-w-2xl">
                <p className="text-[10px] font-bold tracking-[0.14em] text-emerald-700 dark:text-emerald-300">
                    REVIEW THE DIFF
                </p>
                <h3 id="resume-optimization-preview-title" className="mt-1 text-lg font-bold text-slate-950 dark:text-white">
                    对照确认每一项修改
                </h3>
                <p className="mt-2 text-[12px] leading-6 text-slate-500 dark:text-slate-400">
                    修改后始终展示当前目标稿；标签仅说明适用范围。未勾选或被安全阻断的项目会保留原文。
                </p>
            </div>

            <div className="mt-4 space-y-3">
                {plan.changes.map((change) => (
                    <ResumeOptimizationDiffCard
                        key={change.changeId}
                        change={change}
                        selected={acceptedChangeIds.includes(change.changeId)}
                        readOnly={readOnly}
                        skillNameById={skillNameById}
                        onToggleChange={onToggleChange}
                    />
                ))}
            </div>
        </section>

        <ResumeOptimizationBankSuggestions
            suggestions={plan.bankSuggestions}
            onViewExperience={onViewExperience}
            onOpenAutoAssembly={onOpenAutoAssembly}
        />
    </div>
);
