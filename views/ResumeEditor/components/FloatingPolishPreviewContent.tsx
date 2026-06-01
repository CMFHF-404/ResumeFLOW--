import React from 'react';
import type { ExperienceEditDraft } from '../../../types/resume';
import {
    sanitizeRichTextHtml,
    stripRichTextToText,
} from '../../../utils/richText';

const FLOATING_POLISH_PREVIEW_FIELDS: Array<{ key: keyof ExperienceEditDraft['star']; label: string }> = [
    { key: 's', label: '情境' },
    { key: 't', label: '任务' },
    { key: 'a', label: '行动' },
    { key: 'r', label: '结果' },
];

const FloatingPolishPreviewContent: React.FC<{ draft: ExperienceEditDraft }> = ({ draft }) => {
    const rows = FLOATING_POLISH_PREVIEW_FIELDS
        .map(({ key, label }) => {
            const html = sanitizeRichTextHtml(draft.star[key] ?? '');
            return stripRichTextToText(html).trim() ? { key, label, html } : null;
        })
        .filter((item): item is { key: keyof ExperienceEditDraft['star']; label: string; html: string } => Boolean(item));

    if (!rows.length) {
        return (
            <div className="rounded-2xl border border-emerald-100 bg-white/80 px-3 py-3 text-sm leading-6 text-emerald-900">
                暂无可预览的正文内容。
            </div>
        );
    }

    return (
        <div className="space-y-3">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
                修改后文本
            </div>
            <div className="space-y-2">
                {rows.map((row) => (
                    <div key={row.key} className="rounded-2xl border border-emerald-100 bg-white/86 px-3 py-2 shadow-sm">
                        <div className="text-[11px] font-semibold text-emerald-700">{row.label}</div>
                        <div
                            className="mt-1 text-sm leading-6 text-slate-800"
                            dangerouslySetInnerHTML={{ __html: row.html }}
                        />
                    </div>
                ))}
            </div>
        </div>
    );
};

export default FloatingPolishPreviewContent;
