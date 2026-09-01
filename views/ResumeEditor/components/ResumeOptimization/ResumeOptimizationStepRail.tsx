import React from 'react';

export type ResumeOptimizationStepId = 'overview' | 'questions' | 'preview' | 'result';

type ResumeOptimizationStep = {
    id: ResumeOptimizationStepId;
    number: number;
    label: string;
};

const RESUME_OPTIMIZATION_STEPS: ResumeOptimizationStep[] = [
    { id: 'overview', number: 1, label: '优化方案' },
    { id: 'questions', number: 2, label: '补充信息' },
    { id: 'preview', number: 3, label: '对照确认' },
    { id: 'result', number: 4, label: '优化结果' },
];

export const buildResumeOptimizationSteps = (hasQuestions: boolean) => (
    RESUME_OPTIMIZATION_STEPS.filter((step) => hasQuestions || step.id !== 'questions')
);

type ResumeOptimizationStepRailProps = {
    activeStep: ResumeOptimizationStepId;
    hasQuestions: boolean;
    variant: 'desktop' | 'mobile';
};

export const ResumeOptimizationStepRail: React.FC<ResumeOptimizationStepRailProps> = ({
    activeStep,
    hasQuestions,
    variant,
}) => {
    const steps = buildResumeOptimizationSteps(hasQuestions);
    return (
        <nav aria-label="简历优化步骤" className={variant === 'mobile' ? 'overflow-x-auto' : 'w-full'}>
            <ol className={variant === 'mobile' ? 'flex min-w-max gap-2 px-4 py-3' : 'space-y-2 p-4'}>
                {steps.map((step) => {
                    const isActive = step.id === activeStep;
                    return (
                        <li
                            key={step.id}
                            aria-current={isActive ? 'step' : undefined}
                            className={[
                                'flex items-center gap-2 rounded-xl border text-[12px] font-semibold transition-colors motion-reduce:transition-none',
                                variant === 'mobile' ? 'whitespace-nowrap px-3 py-2' : 'px-3 py-3',
                                isActive
                                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/70 dark:bg-emerald-950/35 dark:text-emerald-200'
                                    : 'border-transparent text-slate-500 dark:text-slate-400',
                            ].join(' ')}
                        >
                            <span
                                aria-hidden="true"
                                className={[
                                    'grid h-6 w-6 place-items-center rounded-full text-[10px] font-bold',
                                    isActive
                                        ? 'bg-emerald-600 text-white'
                                        : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300',
                                ].join(' ')}
                            >
                                {step.number}
                            </span>
                            <span>{step.label}</span>
                        </li>
                    );
                })}
            </ol>
        </nav>
    );
};
