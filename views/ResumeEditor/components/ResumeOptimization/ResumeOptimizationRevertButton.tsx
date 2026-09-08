import React, { useId, useRef } from 'react';
import { RotateCcw } from 'lucide-react';

export const ResumeOptimizationRevertButton: React.FC<{
    busy: boolean;
    onRevert: () => unknown;
    label?: string;
    className?: string;
}> = ({ busy, onRevert, label = '撤销结果', className }) => {
    const dialogRef = useRef<HTMLDialogElement>(null);
    const titleId = useId();
    const descriptionId = useId();
    return <>
        <button type="button" disabled={busy} onClick={() => dialogRef.current?.showModal()} className={className}>{label}</button>
        <dialog ref={dialogRef} aria-labelledby={titleId} aria-describedby={descriptionId}
            onKeyDown={event => event.stopPropagation()}
            className="m-auto w-11/12 max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-left text-slate-900 shadow-2xl backdrop:bg-slate-950/40 dark:border-slate-700 dark:bg-slate-900 dark:text-white">
            <span className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"><RotateCcw className="h-5 w-5" aria-hidden="true" /></span>
            <h3 id={titleId} className="text-lg font-bold">撤销本次优化？</h3>
            <p id={descriptionId} className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">撤销后将恢复优化前的简历内容。仅在应用后未继续手工编辑时可以撤销。</p>
            <div className="mt-6 flex justify-end gap-3">
                <button type="button" autoFocus disabled={busy} onClick={() => dialogRef.current?.close()}
                    className="min-h-11 rounded-xl border border-slate-200 px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:border-slate-700">取消</button>
                <button type="button" disabled={busy} onClick={() => {
                    if (busy) return;
                    dialogRef.current?.close();
                    void onRevert();
                }} className="min-h-11 rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 disabled:opacity-50">确认撤销</button>
            </div>
        </dialog>
    </>;
};
