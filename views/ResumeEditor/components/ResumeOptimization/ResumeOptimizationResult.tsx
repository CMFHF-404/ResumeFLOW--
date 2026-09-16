import React from 'react';
import { CheckCircle2, RotateCcw } from 'lucide-react';
import type { ResumeOptimizationRun } from '../../../../types/resumeOptimization';

type ResumeOptimizationResultProps = {
    run: ResumeOptimizationRun;
    busy: boolean;
    error: string | null;
    onRetry: () => unknown;
    onRevert: () => unknown;
};

export const ResumeOptimizationResult: React.FC<ResumeOptimizationResultProps> = ({run,error,busy,onRetry}) => {
    const updated=run.status==='applied'||run.status==='completed';
    const reverted=run.status==='reverted';
    const needsRecovery=run.status==='applied'&&Boolean(error);
    return <section aria-label="优化结果" className="flex min-h-[280px] flex-col items-center justify-center px-4 py-12 text-center" role="status">
        {(updated||reverted)&&!needsRecovery&&<span className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400">
            {reverted?<RotateCcw className="h-8 w-8" aria-hidden="true"/>:<CheckCircle2 className="h-9 w-9" aria-hidden="true"/>}
        </span>}
        <h3 className="text-xl font-bold text-slate-900 dark:text-white">{needsRecovery?'内容已保存，后续处理未完成':updated?'内容已更新！':reverted?'已撤销本次优化':'内容尚未更新'}</h3>
        {(needsRecovery||(!updated&&!reverted))&&error&&<p role="alert" className="mt-3 text-sm text-amber-700 dark:text-amber-300">{error}</p>}
        {needsRecovery&&<button type="button" disabled={busy} onClick={onRetry} className="mt-6 min-h-11 rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 disabled:opacity-50">重试完成更新</button>}
    </section>;
};
