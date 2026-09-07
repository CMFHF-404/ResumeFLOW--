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
    availableSteps: ResumeOptimizationStepId[];
    onStepSelect: (step: ResumeOptimizationStepId) => void;
};

export const ResumeOptimizationStepRail: React.FC<ResumeOptimizationStepRailProps> = ({
    activeStep,
    hasQuestions,
    variant,
    availableSteps,
    onStepSelect,
}) => {
    const steps = buildResumeOptimizationSteps(hasQuestions);
    return (
        <nav aria-label="简历优化步骤" className="w-full overflow-hidden">
            <ol
                className={variant === 'mobile' ? 'grid w-full gap-1 px-3 py-2' : 'space-y-2 p-4'}
                style={variant === 'mobile' ? {
                    gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))`,
                } : undefined}
            >
                {steps.map((step) => {
                    const isActive = step.id === activeStep;
                    const isAvailable = availableSteps.includes(step.id);
                    const content = (
                        <>
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
                        </>
                    );
                    return (
                        <li
                            key={step.id}
                            aria-current={isActive ? 'step' : undefined}
                        >
                            {isAvailable ? (
                                <button
                                    type="button"
                                    onClick={() => onStepSelect(step.id)}
                                    className={[
                                        'flex min-h-[44px] w-full items-center gap-2 rounded-xl border text-left text-[12px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 motion-reduce:transition-none',
                                        variant === 'mobile' ? 'justify-center gap-1 px-1 py-1.5 text-center text-[11px]' : 'px-3 py-2.5',
                                        isActive
                                            ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/70 dark:bg-emerald-950/35 dark:text-emerald-200'
                                            : 'border-transparent text-slate-500 hover:border-slate-200 hover:bg-white dark:text-slate-400 dark:hover:border-slate-700 dark:hover:bg-slate-900',
                                    ].join(' ')}
                                >
                                    {content}
                                </button>
                            ) : (
                                <div
                                    className={[
                                        'flex min-h-[44px] items-center gap-2 rounded-xl border border-transparent text-[12px] font-semibold text-slate-400 opacity-65 dark:text-slate-600',
                                        variant === 'mobile' ? 'justify-center gap-1 px-1 py-1.5 text-center text-[11px]' : 'px-3 py-2.5',
                                    ].join(' ')}
                                >
                                    {content}
                                </div>
                            )}
                        </li>
                    );
                })}
            </ol>
        </nav>
    );
};
