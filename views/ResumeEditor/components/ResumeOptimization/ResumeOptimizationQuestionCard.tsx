import React, { useId, useMemo } from 'react';
import { LockKeyhole } from 'lucide-react';

import type {
    ResumeOptimizationAnswerState,
    ResumeOptimizationQuestion,
} from '../../../../types/resumeOptimization';
import type { ResumeOptimizationAnswerDrafts } from '../../hooks/useResumeOptimizationFlow';
import {
    buildResumeOptimizationQuestionChoices,
    formatResumeOptimizationUserCopy,
    RESUME_OPTIMIZATION_TERMINAL_ANSWER_OPTIONS,
} from './optimizationDisplayUtils.mjs';

type ResumeOptimizationQuestionCardProps = {
    question: ResumeOptimizationQuestion;
    draft: ResumeOptimizationAnswerDrafts[string];
    persisted: boolean;
    disabled: boolean;
    onChange: (state: ResumeOptimizationAnswerState, value: string) => void;
};

export const ResumeOptimizationQuestionCard: React.FC<ResumeOptimizationQuestionCardProps> = ({
    question,
    draft,
    persisted,
    disabled,
    onChange,
}) => {
    const instanceId = useId();
    const reasonId = `${instanceId}-reason`;
    const textareaId = `${instanceId}-answer`;
    const groupName = `${instanceId}-answer-mode`;
    const explicitAnswerId = `${instanceId}-explicit-answer`;
    const quickChoices = useMemo(
        () => buildResumeOptimizationQuestionChoices(question.choices),
        [question.choices],
    );
    const questionText = formatResumeOptimizationUserCopy(
        question.text,
        '请补充可确认的相关事实',
    );
    const questionReason = formatResumeOptimizationUserCopy(
        question.reason,
        '这有助于在不补造信息的前提下完成优化。',
    );
    const isQuickChoiceSelected = draft.state === 'answered'
        && quickChoices.some((choice) => choice.draft.value === draft.value);
    const controlsDisabled = disabled || persisted;

    return (
        <fieldset
            disabled={controlsDisabled}
            className="rounded-2xl border border-slate-200/80 bg-white/90 p-4 shadow-sm shadow-slate-200/20 disabled:opacity-70 dark:border-slate-800 dark:bg-slate-950/55 dark:shadow-none md:p-5"
        >
            <legend className="max-w-3xl px-1 text-sm font-bold leading-6 text-slate-950 dark:text-white">
                {questionText}
            </legend>
            <div className="mt-2 rounded-xl border border-amber-200/70 bg-amber-50/65 px-3 py-2.5 dark:border-amber-900/60 dark:bg-amber-950/20">
                <p className="text-[10px] font-bold tracking-wide text-amber-800 dark:text-amber-200">为什么需要补充</p>
                <p id={reasonId} className="mt-1 text-[11px] leading-5 text-amber-900/80 dark:text-amber-100/75">
                    {questionReason}
                </p>
            </div>

            {persisted ? (
                <p className="mt-3 flex items-center gap-2 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                    <LockKeyhole className="h-3.5 w-3.5" aria-hidden="true" />
                    已保存，重试时不可修改
                </p>
            ) : null}

            <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <label htmlFor={explicitAnswerId} className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-[12px] font-semibold text-slate-700 transition hover:border-emerald-300 hover:bg-emerald-50/40 motion-reduce:transition-none dark:border-slate-700 dark:text-slate-200 dark:hover:border-emerald-800 dark:hover:bg-emerald-950/20">
                    <input
                        id={explicitAnswerId}
                        type="radio"
                        name={groupName}
                        checked={draft.state === 'answered' && !isQuickChoiceSelected}
                        onChange={() => onChange('answered', draft.state === 'answered' ? draft.value : '')}
                        aria-describedby={reasonId}
                        className="h-4 w-4 accent-emerald-600"
                    />
                    明确回答
                </label>
                {quickChoices.map((choice, index) => {
                    const quickChoiceId = `${instanceId}-quick-${index}`;
                    return (
                        <label
                            key={choice.label}
                            htmlFor={quickChoiceId}
                            className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-[12px] text-slate-700 transition hover:border-emerald-300 hover:bg-emerald-50/40 motion-reduce:transition-none dark:border-slate-700 dark:text-slate-200 dark:hover:border-emerald-800 dark:hover:bg-emerald-950/20"
                        >
                            <input
                                id={quickChoiceId}
                                type="radio"
                                name={groupName}
                                checked={draft.state === 'answered' && draft.value === choice.draft.value}
                                onChange={() => onChange(
                                    choice.draft.state as ResumeOptimizationAnswerState,
                                    choice.draft.value,
                                )}
                                aria-describedby={reasonId}
                                className="h-4 w-4 accent-emerald-600"
                            />
                            {choice.label}
                        </label>
                    );
                })}
                {RESUME_OPTIMIZATION_TERMINAL_ANSWER_OPTIONS.map((option, index) => {
                    const terminalChoiceId = `${instanceId}-terminal-${index}`;
                    return (
                        <label
                            key={option.state}
                            htmlFor={terminalChoiceId}
                            className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-[12px] text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 motion-reduce:transition-none dark:border-slate-700 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-900"
                        >
                            <input
                                id={terminalChoiceId}
                                type="radio"
                                name={groupName}
                                checked={draft.state === option.state}
                                onChange={() => onChange(option.state, '')}
                                aria-describedby={reasonId}
                                className="h-4 w-4 accent-emerald-600"
                            />
                            {option.label}
                        </label>
                    );
                })}
            </div>

            <div className="mt-4">
                <label htmlFor={textareaId} className="text-[11px] font-bold text-slate-700 dark:text-slate-200">
                    明确回答内容
                </label>
                <textarea
                    id={textareaId}
                    value={draft.state === 'answered' ? draft.value : ''}
                    onChange={(event) => onChange('answered', event.target.value)}
                    disabled={controlsDisabled || draft.state !== 'answered'}
                    aria-describedby={reasonId}
                    rows={3}
                    placeholder="只填写你能确认的职责、动作、范围或结果；不确定时请选择上方状态。"
                    className="mt-2 w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[12px] leading-5 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/20 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500 motion-reduce:transition-none dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:disabled:bg-slate-900/60"
                />
            </div>
        </fieldset>
    );
};
