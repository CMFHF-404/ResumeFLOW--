import React, { useMemo, type FormEvent } from 'react';

import type {
    ResumeOptimizationAnswer,
    ResumeOptimizationAnswerState,
    ResumeOptimizationQuestion,
} from '../../../../types/resumeOptimization';
import type { ResumeOptimizationAnswerDrafts } from '../../hooks/useResumeOptimizationFlow';
import {
    areResumeOptimizationAnswersComplete,
    isResumeOptimizationAnswerComplete,
} from './optimizationDisplayUtils.mjs';
import { ResumeOptimizationQuestionCard } from './ResumeOptimizationQuestionCard';

export const RESUME_OPTIMIZATION_QUESTIONS_FORM_ID = 'resume-optimization-questions-form';

type ResumeOptimizationQuestionsProps = {
    questions: ResumeOptimizationQuestion[];
    drafts: ResumeOptimizationAnswerDrafts;
    persistedAnswers: ResumeOptimizationAnswer[];
    disabled: boolean;
    submissionFrozen: boolean;
    error: string | null;
    onSetAnswer: (
        questionId: string,
        state: ResumeOptimizationAnswerState,
        value?: string,
        inputSource?: ResumeOptimizationAnswerDrafts[string]['inputSource'],
    ) => void;
    onSubmit: () => unknown;
};

export const ResumeOptimizationQuestions: React.FC<ResumeOptimizationQuestionsProps> = ({
    questions,
    drafts,
    persistedAnswers,
    disabled,
    submissionFrozen,
    error,
    onSetAnswer,
    onSubmit,
}) => {
    const visibleQuestions = questions.slice(0, 5);
    const isQuestionSetValid = questions.length > 0 && questions.length <= 5;
    const persistedIds = useMemo(
        () => new Set(persistedAnswers.map((answer) => answer.questionId)),
        [persistedAnswers],
    );
    const remainingCount = visibleQuestions.filter(
        (question) => !isResumeOptimizationAnswerComplete(drafts[question.questionId]),
    ).length;
    const isComplete = areResumeOptimizationAnswersComplete(questions, drafts);

    if (questions.length === 0) return null;

    if (!isQuestionSetValid) {
        return (
            <section className="space-y-3" aria-label="补充信息异常">
                <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[12px] text-rose-800 dark:border-rose-900/70 dark:bg-rose-950/25 dark:text-rose-200">
                    问题数据异常：一次最多处理 5 个问题。本轮已安全阻止提交，请重新生成优化方案。
                </div>
                {visibleQuestions.map((question) => (
                    <ResumeOptimizationQuestionCard
                        key={question.questionId}
                        question={question}
                        draft={drafts[question.questionId] ?? { state: 'answered', value: '' }}
                        persisted={persistedIds.has(question.questionId)}
                        disabled
                        onChange={() => undefined}
                    />
                ))}
            </section>
        );
    }

    const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (disabled || !areResumeOptimizationAnswersComplete(questions, drafts)) return;
        onSubmit();
    };

    return (
        <form
            id="resume-optimization-questions-form"
            onSubmit={handleSubmit}
            className="space-y-4"
            noValidate
        >
            <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-slate-200/80 bg-white/80 px-4 py-3 dark:border-slate-800 dark:bg-slate-950/50">
                <div>
                    <p className="text-sm font-bold text-slate-950 dark:text-white">补齐可验证事实</p>
                    <p className="mt-1 text-[11px] leading-5 text-slate-500 dark:text-slate-400">
                        不确定时可选择“无法回答”；系统不会自动替你提交空缺。
                    </p>
                </div>
                <p aria-live="polite" className="rounded-full bg-amber-50 px-3 py-1.5 text-[11px] font-bold text-amber-800 dark:bg-amber-950/35 dark:text-amber-200">
                    {isComplete ? '全部问题已完成' : `还需完成 ${remainingCount} 题`}
                </p>
            </div>

            {error ? (
                <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[12px] text-rose-800 dark:border-rose-900/70 dark:bg-rose-950/25 dark:text-rose-200">
                    {error}
                </div>
            ) : null}
            {submissionFrozen ? (
                <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/25 dark:text-amber-100">
                    上次提交结果尚不明确。为避免回答分叉，本次内容已锁定，可直接重试提交。
                </div>
            ) : null}

            {visibleQuestions.map((question) => (
                <ResumeOptimizationQuestionCard
                    key={question.questionId}
                    question={question}
                    draft={drafts[question.questionId] ?? { state: 'answered', value: '' }}
                    persisted={persistedIds.has(question.questionId)}
                    disabled={disabled || submissionFrozen}
                    onChange={(state, value, inputSource) => onSetAnswer(question.questionId, state, value, inputSource)}
                />
            ))}
        </form>
    );
};
