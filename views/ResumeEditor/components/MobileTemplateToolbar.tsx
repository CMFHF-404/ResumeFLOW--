import React from 'react';
import { Check } from 'lucide-react';

export default function MobileTemplateToolbar({ saving, ready, error, onCancel, onConfirm }: {
    saving: boolean;
    ready: boolean;
    error: string;
    onCancel: () => void;
    onConfirm: () => void;
}) {
    return <div data-mobile-template-toolbar className="z-30 shrink-0 border-b border-slate-200 bg-white px-4 py-2 dark:border-slate-700 dark:bg-slate-900 md:hidden">
        <div className="flex min-h-11 items-center gap-3">
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800 dark:text-slate-100">选择模板</span>
            <button type="button" disabled={saving} onClick={onCancel} className="min-h-11 rounded-xl border border-slate-200 px-4 text-sm font-medium text-slate-600 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200">取消</button>
            <button type="button" disabled={saving || !ready} onClick={onConfirm} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-semibold text-white disabled:opacity-50"><Check aria-hidden="true" className="h-4 w-4" />{saving ? '确认中…' : '确认'}</button>
        </div>
        {error && <p role="alert" className="pt-1 text-xs text-rose-600">{error}</p>}
    </div>;
}
