import React from 'react';
import { ArrowUpRight, Database, Wand2 } from 'lucide-react';

import type { ResumeOptimizationBankSuggestion } from '../../../../types/resumeOptimization';
import type { ExperienceCategory } from '../../../../services/experienceService';
import { trackResumeOptimizationBankSuggestionClick } from '../../../../utils/analyticsTracker';
import {
    formatResumeOptimizationUserCopy,
    resolveResumeOptimizationExperienceCategory,
} from './optimizationDisplayUtils.mjs';

type ResumeOptimizationBankSuggestionsProps = {
    resumeId: string;
    runId: string;
    suggestions: ResumeOptimizationBankSuggestion[];
    onViewExperience: (
        category: ExperienceCategory | undefined,
        masterExperienceId: string,
    ) => void;
    onOpenAutoAssembly: () => void;
};

const CATEGORY_LABELS: Record<ExperienceCategory, string> = {
    work: '工作经历',
    project: '项目经历',
    education: '教育经历',
};

export const ResumeOptimizationBankSuggestions: React.FC<ResumeOptimizationBankSuggestionsProps> = ({
    resumeId,
    runId,
    suggestions,
    onViewExperience,
    onOpenAutoAssembly,
}) => {
    if (suggestions.length === 0) return null;

    return (
        <section
            aria-labelledby="resume-optimization-bank-title"
            className="overflow-hidden rounded-2xl border border-indigo-200/80 bg-indigo-50/45 dark:border-indigo-900/70 dark:bg-indigo-950/20"
        >
            <div className="flex items-center gap-3 border-b border-indigo-200/70 px-4 py-3 dark:border-indigo-900/60 md:px-5">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-indigo-100 text-indigo-700 dark:bg-indigo-950/70 dark:text-indigo-200">
                    <Database className="h-4 w-4" aria-hidden="true" />
                </span>
                <div>
                    <h3 id="resume-optimization-bank-title" className="text-sm font-bold text-indigo-950 dark:text-indigo-100">
                        经历库可补强素材
                    </h3>
                    <p className="mt-0.5 text-[10px] text-indigo-700/75 dark:text-indigo-300/75">
                        仅供查看与重新组装参考，不会加入本次应用项。
                    </p>
                </div>
            </div>

            <div className="grid gap-3 p-4 lg:grid-cols-2 md:p-5">
                {suggestions.map((suggestion) => {
                    const category = resolveResumeOptimizationExperienceCategory(suggestion.category) as ExperienceCategory | undefined;
                    const title = formatResumeOptimizationUserCopy(suggestion.title, '未命名经历');
                    const org = formatResumeOptimizationUserCopy(suggestion.org, '未填写组织');
                    const reason = formatResumeOptimizationUserCopy(suggestion.reason, '该素材与当前目标存在能力关联。');
                    const capabilities = suggestion.capabilities
                        .map((item) => formatResumeOptimizationUserCopy(item))
                        .filter(Boolean);
                    const matchScore = Math.max(0, Math.min(100, Math.round(suggestion.matchScore)));
                    return (
                        <article key={suggestion.suggestionId} className="rounded-xl border border-indigo-200/80 bg-white/85 p-4 dark:border-indigo-900/65 dark:bg-slate-950/65">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <h4 className="truncate text-sm font-bold text-slate-950 dark:text-white">{title}</h4>
                                    <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                                        {category ? CATEGORY_LABELS[category] : '经历素材'} · {org}
                                    </p>
                                </div>
                                <span className="shrink-0 rounded-full bg-indigo-100 px-2 py-1 text-[10px] font-black text-indigo-700 dark:bg-indigo-950/70 dark:text-indigo-200">
                                    匹配 {matchScore}%
                                </span>
                            </div>
                            <p className="mt-3 text-[11px] leading-5 text-slate-600 dark:text-slate-300">{reason}</p>
                            {capabilities.length > 0 ? (
                                <div className="mt-3 flex flex-wrap gap-1.5">
                                    {capabilities.map((capability) => (
                                        <span key={capability} className="rounded-full bg-indigo-50 px-2 py-1 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-950/45 dark:text-indigo-200">
                                            {capability}
                                        </span>
                                    ))}
                                </div>
                            ) : null}
                            <div className="mt-4 grid grid-cols-2 gap-2">
                                <button
                                    type="button"
                                    onClick={() => {
                                        trackResumeOptimizationBankSuggestionClick({
                                            resumeId,
                                            runId,
                                            action: 'view_experience',
                                            bankSuggestionCount: suggestions.length,
                                        });
                                        onViewExperience(category, suggestion.masterExperienceId);
                                    }}
                                    className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-indigo-200 bg-white px-3 text-[11px] font-bold text-indigo-700 transition hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 motion-reduce:transition-none dark:border-indigo-800 dark:bg-slate-900 dark:text-indigo-200 dark:hover:bg-indigo-950/40"
                                >
                                    查看经历
                                    <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        trackResumeOptimizationBankSuggestionClick({
                                            resumeId,
                                            runId,
                                            action: 'open_auto_assembly',
                                            bankSuggestionCount: suggestions.length,
                                        });
                                        onOpenAutoAssembly();
                                    }}
                                    className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-3 text-[11px] font-bold text-white transition hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 motion-reduce:transition-none dark:bg-indigo-500 dark:text-slate-950 dark:hover:bg-indigo-400"
                                >
                                    <Wand2 className="h-3.5 w-3.5" aria-hidden="true" />
                                    前往一键组装
                                </button>
                            </div>
                        </article>
                    );
                })}
            </div>
        </section>
    );
};
