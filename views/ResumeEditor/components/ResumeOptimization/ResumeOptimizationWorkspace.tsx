import React, { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { ShieldCheck, X } from 'lucide-react';

import type { ExperienceCategory } from '../../../../services/experienceService';
import type { useResumeOptimizationFlow } from '../../hooks/useResumeOptimizationFlow';
import type { ResumeOptimizationStatus, ResumeOptimizationUiState } from '../../../../types/resumeOptimization';
import { ResumeOptimizationOverview } from './ResumeOptimizationOverview';
import { ResumeOptimizationPreview } from './ResumeOptimizationPreview';
import { ResumeOptimizationProgress } from './ResumeOptimizationProgress';
import { ResumeOptimizationQuestions } from './ResumeOptimizationQuestions';
import {
    ResumeOptimizationStepRail,
    type ResumeOptimizationStepId,
} from './ResumeOptimizationStepRail';
import { areResumeOptimizationAnswersComplete } from './optimizationDisplayUtils.mjs';

type ResumeOptimizationFlowSlice = ReturnType<typeof useResumeOptimizationFlow>;

type ResumeOptimizationFutureContentProps = Pick<ResumeOptimizationFlowSlice,
    | 'uiState'
    | 'run'
    | 'progressNode'
    | 'progressText'
    | 'error'
    | 'answerDrafts'
    | 'setAnswer'
    | 'submitAnswers'
    | 'acceptedChangeIds'
    | 'toggleChange'
    | 'applyAcceptedChanges'
    | 'retryRescore'
    | 'revertRun'
>;

type ResumeOptimizationWorkspaceProps = ResumeOptimizationFlowSlice & ResumeOptimizationFutureContentProps & {
    onRequestClose: () => boolean | Promise<boolean>;
    returnFocusRef: MutableRefObject<HTMLElement | null>;
    suppressReturnFocusRef: MutableRefObject<boolean>;
    skillNameById: Record<string, string>;
    onViewExperience: (
        category: ExperienceCategory | undefined,
        masterExperienceId: string,
    ) => void;
    onOpenAutoAssembly: () => void;
};

const FOCUSABLE_SELECTOR = [
    'button:not([disabled])',
    '[href]',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(',');

const resolveStepFromRunStatus = (
    status: ResumeOptimizationStatus | undefined,
    hasQuestions: boolean,
): ResumeOptimizationStepId => {
    if (status === 'awaiting_answers') return hasQuestions ? 'questions' : 'preview';
    if (status === 'preview_ready' || status === 'stale') return 'preview';
    if (['applying', 'applied', 'rescoring', 'completed', 'reverted', 'cancelled'].includes(status ?? '')) {
        return 'result';
    }
    return 'overview';
};

export const resolveResumeOptimizationActiveStep = (
    uiState: ResumeOptimizationUiState,
    runStatus: ResumeOptimizationStatus | undefined,
    hasQuestions: boolean,
): ResumeOptimizationStepId => {
    if (uiState === 'error' || uiState === 'stale') {
        return resolveStepFromRunStatus(runStatus, hasQuestions);
    }
    if (uiState === 'awaiting_answers' || uiState === 'answering') {
        return hasQuestions ? 'questions' : 'preview';
    }
    if (uiState === 'preview' || uiState === 'applying') return 'preview';
    if (uiState === 'rescoring' || uiState === 'completed') return 'result';
    return 'overview';
};

const isVisibleFocusable = (element: HTMLElement) => (
    element.isConnected
    && element.getClientRects().length > 0
    && element.getAttribute('aria-hidden') !== 'true'
    && !(element instanceof HTMLButtonElement && element.disabled)
);

const ResumeOptimizationPlaceholder: React.FC<{
    activeStep: ResumeOptimizationStepId;
    error: string | null;
    uiState: ResumeOptimizationUiState;
}> = ({ activeStep, error, uiState }) => {
    const title = activeStep === 'questions'
        ? '补充信息区域'
        : activeStep === 'preview'
            ? '方案对照区域'
            : activeStep === 'result'
                ? '优化结果区域'
                : '优化方案区域';
    return (
        <section className="rounded-2xl border border-slate-200/80 bg-white/80 p-6 dark:border-slate-800 dark:bg-slate-950/45">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">{title}</h3>
            <p className="mt-2 text-[12px] leading-relaxed text-slate-500 dark:text-slate-400">
                {uiState === 'stale'
                    ? '当前简历或报告已变化，请返回并重新生成优化方案。'
                    : error || '此步骤的详细内容将在后续流程中呈现。'}
            </p>
        </section>
    );
};

export const ResumeOptimizationWorkspace: React.FC<ResumeOptimizationWorkspaceProps> = ({
    uiState,
    run,
    progressText,
    error,
    answerDrafts,
    persistedAnswerIds,
    isAnswerSubmissionFrozen,
    setAnswer,
    submitAnswers,
    acceptedChangeIds,
    toggleChange,
    onRequestClose,
    returnFocusRef,
    suppressReturnFocusRef,
    skillNameById,
    onViewExperience,
    onOpenAutoAssembly,
}) => {
    const overlayRef = useRef<HTMLDivElement>(null);
    const dialogRef = useRef<HTMLElement>(null);
    const headingRef = useRef<HTMLHeadingElement>(null);
    const closeRequestInFlightRef = useRef(false);
    const plan = run ? run.result ?? run.plan : null;
    const hasQuestions = Boolean(plan?.questions.length);
    const resolvedActiveStep = resolveResumeOptimizationActiveStep(uiState, run?.status, hasQuestions);
    const [displayStep, setDisplayStep] = useState<ResumeOptimizationStepId>(() => resolvedActiveStep);
    const previousUiStateRef = useRef(uiState);
    const isCloseBlocked = uiState === 'applying' || uiState === 'rescoring';
    const isProgressVisible = ['starting', 'answering', 'applying', 'rescoring'].includes(uiState);
    const isQuestionRetry = uiState === 'error' && run?.status === 'awaiting_answers';
    const canRenderQuestions = Boolean(
        plan
        && displayStep === 'questions'
        && uiState !== 'stale',
    );
    const canEditQuestions = Boolean(
        canRenderQuestions
        && run?.status === 'awaiting_answers'
        && (uiState === 'awaiting_answers' || isQuestionRetry),
    );
    const canSubmitAnswers = Boolean(
        plan
        && canEditQuestions
        && areResumeOptimizationAnswersComplete(plan.questions, answerDrafts),
    );
    const visibleSteps = useMemo(() => (
        (['overview', 'questions', 'preview', 'result'] as ResumeOptimizationStepId[])
            .filter((step) => hasQuestions || step !== 'questions')
    ), [hasQuestions]);
    const availableSteps = useMemo(() => {
        const resolvedIndex = visibleSteps.indexOf(resolvedActiveStep);
        return resolvedIndex < 0 ? [visibleSteps[0]] : visibleSteps.slice(0, resolvedIndex + 1);
    }, [resolvedActiveStep, visibleSteps]);

    const requestClose = useCallback(async () => {
        if (isCloseBlocked || closeRequestInFlightRef.current) return false;
        closeRequestInFlightRef.current = true;
        try {
            return await onRequestClose();
        } finally {
            closeRequestInFlightRef.current = false;
        }
    }, [isCloseBlocked, onRequestClose]);

    const handleStepSelect = useCallback((step: ResumeOptimizationStepId) => {
        if (availableSteps.includes(step)) setDisplayStep(step);
    }, [availableSteps]);

    const handleContinueFromOverview = useCallback(() => {
        setDisplayStep(hasQuestions ? 'questions' : 'preview');
    }, [hasQuestions]);

    const getFocusableElements = useCallback(() => {
        const dialog = dialogRef.current;
        if (!dialog) return [];
        return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
            .filter(isVisibleFocusable);
    }, []);

    const handleDialogKeyDown = useCallback((event: React.KeyboardEvent) => {
        event.stopPropagation();
        if (event.key === 'Escape') {
            event.preventDefault();
            if (!isCloseBlocked) void requestClose();
            return;
        }
        if (event.key !== 'Tab') return;
        const dialog = dialogRef.current;
        const focusableElements = getFocusableElements();
        if (!dialog || focusableElements.length === 0) {
            event.preventDefault();
            headingRef.current?.focus();
            return;
        }
        const firstFocusable = focusableElements[0];
        const lastFocusable = focusableElements[focusableElements.length - 1];
        if (
            event.shiftKey
            && (
                document.activeElement === firstFocusable
                || document.activeElement === headingRef.current
            )
        ) {
            event.preventDefault();
            lastFocusable.focus();
        } else if (!event.shiftKey && document.activeElement === lastFocusable) {
            event.preventDefault();
            firstFocusable.focus();
        }
    }, [getFocusableElements, isCloseBlocked, requestClose]);

    useEffect(() => {
        if (uiState === 'error' || uiState === 'stale') {
            previousUiStateRef.current = uiState;
            return;
        }
        if (
            previousUiStateRef.current === 'starting'
            && (uiState === 'awaiting_answers' || uiState === 'preview')
        ) {
            previousUiStateRef.current = uiState;
            setDisplayStep('overview');
            return;
        }
        previousUiStateRef.current = uiState;
        setDisplayStep(resolvedActiveStep);
    }, [resolvedActiveStep, uiState]);

    useEffect(() => {
        const dialog = dialogRef.current;
        if (dialog && !dialog.contains(document.activeElement)) {
            headingRef.current?.focus();
        }
    }, [displayStep, uiState]);

    useEffect(() => {
        const overlay = overlayRef.current;
        const dialog = dialogRef.current;
        if (!overlay || !dialog) return undefined;
        const activeElementAtOpen = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        if (!returnFocusRef.current) returnFocusRef.current = activeElementAtOpen;
        const siblings = Array.from(overlay.parentElement?.children ?? [])
            .filter((element): element is HTMLElement => element instanceof HTMLElement && element !== overlay);
        const siblingStates = siblings.map((element) => ({
            element,
            inert: element.inert,
            ariaHidden: element.getAttribute('aria-hidden'),
        }));
        siblingStates.forEach(({ element }) => {
            element.inert = true;
            element.setAttribute('aria-hidden', 'true');
        });
        const previousBodyOverflow = document.body.style.overflow;
        const previousHtmlOverflow = document.documentElement.style.overflow;
        document.body.style.overflow = 'hidden';
        document.documentElement.style.overflow = 'hidden';
        const focusHeadingFrame = window.requestAnimationFrame(() => headingRef.current?.focus());
        const handleExternalFocus = (event: FocusEvent) => {
            if (event.target instanceof Node && !dialog.contains(event.target)) {
                headingRef.current?.focus();
            }
        };
        document.addEventListener('focusin', handleExternalFocus);

        return () => {
            window.cancelAnimationFrame(focusHeadingFrame);
            document.removeEventListener('focusin', handleExternalFocus);
            document.body.style.overflow = previousBodyOverflow;
            document.documentElement.style.overflow = previousHtmlOverflow;
            siblingStates.forEach(({ element, inert, ariaHidden }) => {
                element.inert = inert;
                if (ariaHidden === null) element.removeAttribute('aria-hidden');
                else element.setAttribute('aria-hidden', ariaHidden);
            });
            const savedReturnFocus = returnFocusRef.current;
            returnFocusRef.current = null;
            if (suppressReturnFocusRef.current) {
                suppressReturnFocusRef.current = false;
                return;
            }
            window.requestAnimationFrame(() => {
                const fallbackReturnFocus = Array.from(
                    document.querySelectorAll<HTMLElement>('[data-resume-optimization-focus-return]:not([disabled])')
                ).find(isVisibleFocusable);
                const returnTarget = savedReturnFocus && isVisibleFocusable(savedReturnFocus)
                    ? savedReturnFocus
                    : fallbackReturnFocus;
                returnTarget?.focus();
            });
        };
    }, [returnFocusRef, suppressReturnFocusRef]);

    const footerStatus = useMemo(() => (
        isCloseBlocked ? '应用与复评期间暂不可关闭' : '可随时返回，未应用的方案会保留'
    ), [isCloseBlocked]);

    return (
        <div
            ref={overlayRef}
            className="fixed inset-0 z-[100] flex h-[100dvh] items-center justify-center bg-slate-950/50 backdrop-blur-sm motion-reduce:transition-none md:p-4"
            onKeyDown={handleDialogKeyDown}
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) void requestClose();
            }}
        >
            <section
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="resume-optimization-workspace-title"
                tabIndex={-1}
                className="flex h-[100dvh] w-full flex-col overflow-hidden bg-slate-50 shadow-2xl dark:bg-slate-950 md:max-h-[min(900px,calc(100vh-32px))] md:max-w-6xl md:rounded-2xl md:border md:border-slate-200/80 md:dark:border-slate-800"
                onMouseDown={(event) => event.stopPropagation()}
            >
                <header className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-200 bg-white/90 px-4 py-3 dark:border-slate-800 dark:bg-slate-950/90 md:px-6">
                    <div className="min-w-0">
                        <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300">
                            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                            <span className="text-[10px] font-bold tracking-[0.14em]">RESUME OPTIMIZATION</span>
                        </div>
                        <h2
                            ref={headingRef}
                            id="resume-optimization-workspace-title"
                            tabIndex={-1}
                            className="mt-1 truncate text-base font-bold text-slate-950 outline-none dark:text-white"
                        >
                            根据六维报告优化简历
                        </h2>
                    </div>
                    <button
                        type="button"
                        aria-label="关闭简历优化工作区"
                        disabled={isCloseBlocked}
                        onClick={() => void requestClose()}
                        className="grid min-h-[44px] min-w-[44px] place-items-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
                    >
                        <X className="h-5 w-5" aria-hidden="true" />
                    </button>
                </header>

                <div className="min-h-0 flex-1 overflow-hidden md:flex">
                    <aside className="hidden w-[220px] shrink-0 border-r border-slate-200 bg-white/60 dark:border-slate-800 dark:bg-slate-950/55 md:block">
                        <ResumeOptimizationStepRail
                            activeStep={displayStep}
                            hasQuestions={hasQuestions}
                            variant="desktop"
                            availableSteps={availableSteps}
                            onStepSelect={handleStepSelect}
                        />
                    </aside>
                    <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
                        <div className="shrink-0 border-b border-slate-200 bg-white/70 dark:border-slate-800 dark:bg-slate-950/70 md:hidden">
                            <ResumeOptimizationStepRail
                                activeStep={displayStep}
                                hasQuestions={hasQuestions}
                                variant="mobile"
                                availableSteps={availableSteps}
                                onStepSelect={handleStepSelect}
                            />
                        </div>
                        <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
                            {isProgressVisible ? (
                                <ResumeOptimizationProgress progressText={progressText} />
                            ) : displayStep === 'overview' && plan ? (
                                <ResumeOptimizationOverview plan={plan} />
                            ) : canRenderQuestions && plan ? (
                                <ResumeOptimizationQuestions
                                    questions={plan.questions}
                                    drafts={answerDrafts}
                                    persistedAnswers={run?.answers ?? []}
                                    disabled={!canEditQuestions}
                                    submissionFrozen={isAnswerSubmissionFrozen}
                                    error={isQuestionRetry ? error : null}
                                    onSetAnswer={setAnswer}
                                    onSubmit={submitAnswers}
                                />
                            ) : displayStep === 'preview' && plan && uiState !== 'stale' ? (
                                <ResumeOptimizationPreview
                                    plan={plan}
                                    acceptedChangeIds={acceptedChangeIds}
                                    readOnly={run?.status !== 'preview_ready'}
                                    skillNameById={skillNameById}
                                    onToggleChange={toggleChange}
                                    onViewExperience={onViewExperience}
                                    onOpenAutoAssembly={onOpenAutoAssembly}
                                />
                            ) : (
                                <ResumeOptimizationPlaceholder activeStep={displayStep} error={error} uiState={uiState} />
                            )}
                        </div>
                    </main>
                </div>

                <footer className="sticky bottom-0 z-10 flex shrink-0 items-center justify-between gap-3 border-t border-slate-200 bg-white/95 px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur dark:border-slate-800 dark:bg-slate-950/95 md:px-6 md:pb-3">
                    <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">{footerStatus}</p>
                    <div className="flex shrink-0 items-center gap-2">
                        <button
                            type="button"
                            disabled={isCloseBlocked}
                            onClick={() => void requestClose()}
                            className="min-h-[44px] rounded-xl border border-slate-200 px-4 text-[12px] font-semibold text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-900"
                        >
                            返回编辑器
                        </button>
                        {displayStep === 'overview' && plan && uiState !== 'stale' ? (
                            <button
                                type="button"
                                onClick={handleContinueFromOverview}
                                className="min-h-[44px] rounded-xl bg-emerald-600 px-4 text-[12px] font-bold text-white shadow-sm shadow-emerald-900/10 transition hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 motion-reduce:transition-none dark:bg-emerald-500 dark:text-slate-950 dark:hover:bg-emerald-400"
                            >
                                {hasQuestions ? '继续补充信息' : '查看优化方案'}
                            </button>
                        ) : canRenderQuestions && canEditQuestions ? (
                            <button
                                type="submit"
                                form="resume-optimization-questions-form"
                                disabled={!canSubmitAnswers || (isAnswerSubmissionFrozen && !isQuestionRetry)}
                                className="min-h-[44px] rounded-xl bg-emerald-600 px-4 text-[12px] font-bold text-white shadow-sm shadow-emerald-900/10 transition hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 disabled:shadow-none motion-reduce:transition-none dark:bg-emerald-500 dark:text-slate-950 dark:hover:bg-emerald-400 dark:disabled:bg-slate-800 dark:disabled:text-slate-500"
                            >
                                {isQuestionRetry ? '重试提交' : '提交并生成方案'}
                            </button>
                        ) : null}
                    </div>
                </footer>
            </section>
        </div>
    );
};
