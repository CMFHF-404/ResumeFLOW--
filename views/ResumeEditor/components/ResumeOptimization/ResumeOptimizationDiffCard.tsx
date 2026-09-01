import React, { useMemo } from 'react';
import { CheckCircle2, LockKeyhole } from 'lucide-react';

import type { ResumeOptimizationChange } from '../../../../types/resumeOptimization';
import { isResumeOptimizationChangeSelectable } from '../../hooks/useResumeOptimizationFlow';
import {
    buildResumeOptimizationChangePreview,
    formatResumeOptimizationDimensionLabel,
    formatResumeOptimizationModuleLabel,
    formatResumeOptimizationSourceLabel,
    formatResumeOptimizationUserCopy,
} from './optimizationDisplayUtils.mjs';

type ResumeOptimizationDiffCardProps = {
    change: ResumeOptimizationChange;
    selected: boolean;
    readOnly: boolean;
    skillNameById: Record<string, string>;
    onToggleChange: (changeId: string) => void;
};

const ValuePanel: React.FC<{
    title: string;
    lines: string[];
    tone: 'before' | 'after';
    orderPreview: boolean;
}> = ({ title, lines, tone, orderPreview }) => (
    <section
        aria-label={title}
        className={[
            'min-w-0 rounded-xl border p-3.5',
            tone === 'before'
                ? 'border-slate-200 bg-slate-100/75 dark:border-slate-700 dark:bg-slate-900/80'
                : 'border-emerald-200 bg-emerald-50/80 dark:border-emerald-900/70 dark:bg-emerald-950/30',
        ].join(' ')}
    >
        <p className={[
            'text-[10px] font-bold tracking-wide',
            tone === 'before'
                ? 'text-slate-500 dark:text-slate-400'
                : 'text-emerald-700 dark:text-emerald-300',
        ].join(' ')}>
            {title}
        </p>
        {orderPreview ? (
            <p className="mt-2 break-words text-[12px] font-semibold leading-6 text-slate-800 dark:text-slate-100">
                {lines.join(' → ')}
            </p>
        ) : (
            <ul className="mt-2 space-y-1.5 text-[12px] leading-5 text-slate-800 dark:text-slate-100">
                {lines.map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}
            </ul>
        )}
    </section>
);

export const ResumeOptimizationDiffCard: React.FC<ResumeOptimizationDiffCardProps> = ({
    change,
    selected,
    readOnly,
    skillNameById,
    onToggleChange,
}) => {
    const changeSelectable = isResumeOptimizationChangeSelectable(change);
    const selectable = changeSelectable && !readOnly;
    const preview = useMemo(
        () => buildResumeOptimizationChangePreview({
            moduleType: change.moduleType,
            beforeValue: change.beforeValue,
            targetedValue: change.targetedValue,
        }, skillNameById),
        [change.beforeValue, change.moduleType, change.targetedValue, skillNameById],
    );
    const isBlocked = change.safetyStatus === 'blocked';
    const isOrderPreview = change.moduleType === 'skills_order' || change.moduleType === 'section_order';
    const scopeLabel = change.scope === 'jd_targeted' ? 'JD定向' : '通用优化';
    const rationale = formatResumeOptimizationUserCopy(change.rationale, '该项说明已安全隐藏。');

    return (
        <article
            className={[
                'rounded-xl border p-4 shadow-sm motion-reduce:transition-none md:p-5',
                isBlocked
                    ? 'border-rose-200 bg-rose-50/45 dark:border-rose-900/70 dark:bg-rose-950/20'
                    : 'border-slate-200/80 bg-white/90 dark:border-slate-800 dark:bg-slate-950/55',
            ].join(' ')}
        >
            <header className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <h4 className="text-sm font-bold text-slate-950 dark:text-white">
                            {formatResumeOptimizationModuleLabel(change.moduleType, change.fieldPath)}
                        </h4>
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                            {formatResumeOptimizationDimensionLabel(change.dimension)}
                        </span>
                        <span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700 dark:bg-emerald-950/45 dark:text-emerald-200">
                            {scopeLabel}
                        </span>
                        {isBlocked ? (
                            <span className="rounded-full bg-rose-100 px-2 py-1 text-[10px] font-bold text-rose-700 dark:bg-rose-950/60 dark:text-rose-200">
                                安全阻断
                            </span>
                        ) : null}
                    </div>
                    <p className="mt-2 text-[11px] leading-5 text-slate-500 dark:text-slate-400">{rationale}</p>
                </div>

                <label className="flex min-h-[44px] shrink-0 cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-bold text-slate-700 focus-within:ring-2 focus-within:ring-emerald-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                    <input
                        type="checkbox"
                        checked={changeSelectable && selected}
                        disabled={!selectable}
                        onChange={() => {
                            if (selectable) onToggleChange(change.changeId);
                        }}
                        className="h-4 w-4 rounded border-slate-300 accent-emerald-600 disabled:cursor-not-allowed"
                    />
                    {readOnly
                        ? changeSelectable && selected ? '已应用' : '保留原文'
                        : selectable && selected ? '应用此项' : '保留原文'}
                </label>
            </header>

            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                <ValuePanel title="修改前" lines={preview.before} tone="before" orderPreview={isOrderPreview} />
                <ValuePanel title="修改后" lines={preview.after} tone="after" orderPreview={isOrderPreview} />
            </div>

            <footer className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-200/70 pt-3 dark:border-slate-800">
                {change.sourceLabels.map((sourceLabel) => (
                    <span key={sourceLabel} className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        {formatResumeOptimizationSourceLabel(sourceLabel)}
                    </span>
                ))}
                <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                    {readOnly && changeSelectable && selected ? (
                        <><CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" /> 已应用</>
                    ) : changeSelectable ? (
                        <><CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" /> 已通过事实检查</>
                    ) : (
                        <><LockKeyhole className="h-3.5 w-3.5" aria-hidden="true" /> 此项不可应用</>
                    )}
                </span>
            </footer>
        </article>
    );
};
