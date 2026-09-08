import React, { useMemo } from 'react';
import { useScoreAnnotations } from '../ResumeEvaluationReport/ScoreAnnotations';
import { CheckCircle2, LockKeyhole } from 'lucide-react';

import type { ResumeOptimizationChange } from '../../../../types/resumeOptimization';
import {
    buildResumeOptimizationChangePreview,
    buildResumeOptimizationSafetyFindingCopy,
    formatResumeOptimizationModuleLabel,
    formatResumeOptimizationSourceLabel,
    formatResumeOptimizationUserCopy,
    isResumeOptimizationChangeReviewable as isResumeOptimizationChangeSelectable,
} from './optimizationDisplayUtils.mjs';

type ResumeOptimizationDiffCardProps = {
    change: ResumeOptimizationChange;
    selected: boolean;
    readOnly: boolean;
    skillNameById: Record<string, string>;
    onToggleChange: (changeId: string) => void;
    surface?: 'modal' | 'sidebar';
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
                ? 'border-amber-200 bg-amber-50/80 dark:border-amber-900/70 dark:bg-amber-950/30'
                : 'border-emerald-200 bg-emerald-50/80 dark:border-emerald-900/70 dark:bg-emerald-950/30',
        ].join(' ')}
    >
        <p className={[
            'text-[10px] font-bold tracking-wide',
            tone === 'before'
                ? 'text-amber-700 dark:text-amber-300'
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
    surface = 'modal',
}) => {
    const changeSelectable = isResumeOptimizationChangeSelectable(change);
    const selectable = changeSelectable && !readOnly;
    const preview = useMemo(
        () => buildResumeOptimizationChangePreview({
            moduleType: change.moduleType,
            fieldPath: change.fieldPath,
            beforeValue: change.beforeValue,
            targetedValue: change.targetedValue,
        }, skillNameById),
        [change.beforeValue, change.fieldPath, change.moduleType, change.targetedValue, skillNameById],
    );
    const isBlocked = change.safetyStatus === 'blocked';
    const safetyFindings = useMemo(
        () => buildResumeOptimizationSafetyFindingCopy(change.safetyFindings),
        [change.safetyFindings],
    );
    const isOrderPreview = change.moduleType === 'skills_order' || change.moduleType === 'section_order';
    const { experienceNameFor } = useScoreAnnotations();
    const moduleName = change.moduleType === 'experience_star' ? experienceNameFor(change.moduleId) || '未命名经历' : formatResumeOptimizationModuleLabel(change.moduleType, change.fieldPath);
    const rationale = formatResumeOptimizationUserCopy(change.rationale, '该项说明已安全隐藏。');
    const choiceLabel = `${moduleName} · ${formatResumeOptimizationModuleLabel(change.moduleType, change.fieldPath)}是否采用优化`;
    const handleChoiceKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (!selectable || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault();
        const shouldSelect = event.key === 'ArrowRight' || event.key === 'ArrowDown';
        if (shouldSelect !== selected) onToggleChange(change.changeId);
        const radios = Array.from(
            event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled)'),
        );
        radios[shouldSelect ? 1 : 0]?.focus();
    };

    return (
        <article
            className={[
                'rounded-xl border p-4 shadow-sm motion-reduce:transition-none md:p-5',
                isBlocked
                    ? 'border-rose-200 bg-rose-50/45 dark:border-rose-900/70 dark:bg-rose-950/20'
                    : 'border-slate-200/80 bg-white/90 dark:border-slate-800 dark:bg-slate-950/55',
            ].join(' ')}
        >
            <header>
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <h4 className="text-sm font-bold text-slate-950 dark:text-white">
                            {moduleName}
                        </h4>
                        {isBlocked ? (
                            <span className="rounded-full bg-rose-100 px-2 py-1 text-[10px] font-bold text-rose-700 dark:bg-rose-950/60 dark:text-rose-200">
                                安全阻断
                            </span>
                        ) : null}
                    </div>
                    <p className="mt-2 text-[10px] font-bold tracking-wide text-slate-400 dark:text-slate-500">发现的问题</p>
                    <p className="mt-1 text-[11px] leading-5 text-slate-600 dark:text-slate-300">{rationale}</p>
                    {isBlocked ? (
                        <section className="mt-3 rounded-xl border border-rose-200 bg-rose-50/80 px-3 py-2.5 dark:border-rose-900/70 dark:bg-rose-950/30" aria-label="安全阻断说明">
                            <p className="text-[10px] font-bold tracking-wide text-rose-800 dark:text-rose-200">安全阻断说明</p>
                            <ul className="mt-1.5 space-y-1 text-[11px] leading-5 text-rose-800 dark:text-rose-100">
                                {safetyFindings.map((finding) => <li key={finding}>{finding}</li>)}
                            </ul>
                        </section>
                    ) : null}
                </div>
            </header>

            <p className="mt-4 text-[10px] font-bold tracking-wide text-slate-400 dark:text-slate-500">准备优化</p>
            <div className={`mt-2 grid grid-cols-1 gap-3 ${surface === 'modal' ? 'md:grid-cols-2' : ''}`}>
                <ValuePanel title="原内容" lines={preview.before} tone="before" orderPreview={isOrderPreview} />
                <ValuePanel title="优化后" lines={preview.after} tone="after" orderPreview={isOrderPreview} />
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
                    ) : change.safetyStatus === 'not_reviewed' ? (
                        <span>请确认是否采用</span>
                    ) : changeSelectable ? (
                        <><CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" /> 自动规则未发现风险</>
                    ) : (
                        <><LockKeyhole className="h-3.5 w-3.5" aria-hidden="true" /> 此项不可应用</>
                    )}
                </span>
            </footer>

            <div
                role="radiogroup"
                aria-label={choiceLabel}
                onKeyDown={handleChoiceKeyDown}
                className="mt-3 grid grid-cols-2 gap-2"
            >
                <button
                    type="button"
                    role="radio"
                    aria-checked={changeSelectable && !selected}
                    tabIndex={!selected ? 0 : -1}
                    disabled={!selectable}
                    onClick={() => {
                        if (selectable && selected) onToggleChange(change.changeId);
                    }}
                    className={[
                        'min-h-[44px] rounded-xl border px-3 text-[11px] font-bold transition-colors',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 disabled:cursor-not-allowed disabled:opacity-55',
                        changeSelectable && !selected
                            ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/35 dark:text-amber-100'
                            : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300',
                    ].join(' ')}
                >
                    保留原文
                </button>
                <button
                    type="button"
                    role="radio"
                    aria-checked={changeSelectable && selected}
                    tabIndex={selected ? 0 : -1}
                    disabled={!selectable}
                    onClick={() => {
                        if (selectable && !selected) onToggleChange(change.changeId);
                    }}
                    className={[
                        'min-h-[44px] rounded-xl border px-3 text-[11px] font-bold transition-colors',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-55',
                        changeSelectable && selected
                            ? 'border-emerald-300 bg-emerald-600 text-white dark:border-emerald-500 dark:bg-emerald-500 dark:text-slate-950'
                            : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300',
                    ].join(' ')}
                >
                    {readOnly && changeSelectable && selected ? '已应用' : '采用优化'}
                </button>
            </div>
        </article>
    );
};
