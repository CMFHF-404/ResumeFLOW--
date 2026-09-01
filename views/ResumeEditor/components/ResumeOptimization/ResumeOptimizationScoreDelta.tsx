import React from 'react';

import type { ResumeOptimizationDimensionDelta } from '../../../../types/resumeOptimization';

type ResumeOptimizationScoreDeltaProps = {
    beforeScore: number;
    afterScore: number;
    scoreDelta: number;
    dimensionDeltas: ResumeOptimizationDimensionDelta[];
};

const clampScore = (value: number) => Math.max(0, Math.min(100, value));

const deltaTone = (delta: number) => (
    delta > 0
        ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/70 dark:bg-emerald-950/30 dark:text-emerald-200'
        : delta < 0
            ? 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-200'
            : 'border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
);

const formatDelta = (delta: number) => delta > 0 ? `+${delta}` : String(delta);

export const ResumeOptimizationScoreDelta: React.FC<ResumeOptimizationScoreDeltaProps> = ({
    beforeScore,
    afterScore,
    scoreDelta,
    dimensionDeltas,
}) => (
    <section aria-labelledby="resume-optimization-score-title" className="space-y-4">
        <h3 id="resume-optimization-score-title" className="sr-only">六维复评分数变化</h3>
        <div className="grid grid-cols-3 gap-2 md:gap-3">
            <div className="rounded-xl border border-slate-200 bg-slate-100/80 p-3 dark:border-slate-700 dark:bg-slate-900">
                <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400">优化前总分</p>
                <p className="mt-1 text-2xl font-black tabular-nums text-slate-900 dark:text-white">{beforeScore}</p>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 p-3 dark:border-emerald-900/70 dark:bg-emerald-950/30">
                <p className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300">优化后总分</p>
                <p className="mt-1 text-2xl font-black tabular-nums text-emerald-800 dark:text-emerald-100">{afterScore}</p>
            </div>
            <div className={`rounded-xl border p-3 ${deltaTone(scoreDelta)}`}>
                <p className="text-[10px] font-bold opacity-75">分数差</p>
                <p className="mt-1 text-2xl font-black tabular-nums">{formatDelta(scoreDelta)}</p>
            </div>
        </div>

        <div className="space-y-3 rounded-2xl border border-slate-200/80 bg-white/85 p-4 dark:border-slate-800 dark:bg-slate-950/55">
            {dimensionDeltas.map((item) => (
                <div key={item.dimension}>
                    <div className="flex items-center justify-between gap-3 text-[11px]">
                        <span className="font-bold text-slate-700 dark:text-slate-200">{item.dimension}</span>
                        <span className="tabular-nums text-slate-500 dark:text-slate-400">
                            {item.beforeScore} → {item.afterScore}
                            <span className={`ml-2 font-bold ${item.delta > 0 ? 'text-emerald-700 dark:text-emerald-300' : item.delta < 0 ? 'text-amber-700 dark:text-amber-300' : 'text-slate-500'}`}>
                                {formatDelta(item.delta)}
                            </span>
                        </span>
                    </div>
                    <div className="relative mt-2 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800" aria-hidden="true">
                        <span
                            className="absolute inset-y-0 left-0 rounded-full bg-slate-400/70"
                            style={{ width: `${clampScore(item.beforeScore)}%` }}
                        />
                        <span
                            className={`absolute inset-y-0 left-0 rounded-full ${item.delta < 0 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                            style={{ width: `${clampScore(item.afterScore)}%` }}
                        />
                    </div>
                </div>
            ))}
        </div>
    </section>
);
