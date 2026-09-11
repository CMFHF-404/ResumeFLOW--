import React, { useEffect, useRef } from 'react';
import { Check, SlidersHorizontal } from 'lucide-react';
import { RESUME_TEMPLATE_DEFINITIONS, type ResumeTemplateId } from '../../../constants/resumeTemplates';
import type { ResumeTemplatePresetMap } from '../../../services/resumeTemplateStorage';
import { TemplateThumbnail } from './TemplateSelectorModal';

type Props = {
    selectedTemplateId: ResumeTemplateId;
    presets: ResumeTemplatePresetMap;
    ready: boolean;
    busy: boolean;
    fallbackAvailable: boolean;
    onFallback: () => void;
    onSelect: (id: ResumeTemplateId) => void;
    onCustomize: (id: ResumeTemplateId) => void;
};

export default function MobileTemplateStrip({ selectedTemplateId, presets, ready, busy, fallbackAvailable, onFallback, onSelect, onCustomize }: Props) {
    const stripRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const strip = stripRef.current;
        const selected = strip?.querySelector<HTMLElement>('[aria-pressed="true"]');
        if (strip && selected) strip.scrollLeft = Math.max(0, selected.offsetLeft - strip.clientWidth / 2 + selected.offsetWidth / 2);
    }, []);
    return <section data-mobile-template-strip aria-label="选择简历模板" className="z-30 shrink-0 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_rgba(15,23,42,0.08)] dark:border-slate-700 dark:bg-slate-900 md:hidden">
        <div className="flex items-center justify-between px-4 pt-2 text-xs text-slate-500">
            <span className="font-semibold text-slate-800 dark:text-slate-100">选择模板</span><span>左右滑动 · 点击预览效果</span>
        </div>
        {!ready && <div role="status" className="px-4 pt-2 text-xs text-amber-700 dark:text-amber-300">
            正在同步模板预设…{fallbackAvailable && <button type="button" onClick={onFallback} className="ml-2 min-h-11 underline">使用本地预设</button>}
        </div>}
        <div ref={stripRef} className="relative flex touch-pan-x select-none gap-3 overflow-x-auto overscroll-x-contain px-4 pb-1 pt-2">
            {RESUME_TEMPLATE_DEFINITIONS.map(template => <div data-agent-item={template.id} key={template.id} className="w-[104px] shrink-0">
                <button type="button" disabled={!ready || busy} onClick={() => onSelect(template.id)} aria-label={`选择${template.name}模板`} aria-pressed={selectedTemplateId === template.id}
                    className={`relative block w-full rounded-lg border-2 p-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50 ${selectedTemplateId === template.id ? 'border-primary bg-primary/5' : 'border-slate-200 dark:border-slate-700'}`}>
                    <div className="aspect-[794/1123] overflow-hidden rounded bg-white">
                        <TemplateThumbnail templateId={template.id} />
                    </div>
                    <span className="mt-1 block truncate text-center text-[11px] font-medium text-slate-700 dark:text-slate-200">{template.name}</span>
                    {selectedTemplateId === template.id && <span className="absolute right-1 top-1 rounded-full bg-primary p-0.5 text-white"><Check className="h-3.5 w-3.5" /></span>}
                </button>
                <button type="button" disabled={!ready || busy} onClick={() => onCustomize(template.id)} aria-label={`自定义${template.name}模板`} className="flex min-h-11 w-full items-center justify-center gap-1 text-xs font-medium text-primary disabled:opacity-50">
                    <SlidersHorizontal className="h-3.5 w-3.5" />{presets[template.id] ? '已自定义' : '自定义'}
                </button>
            </div>)}
        </div>
    </section>;
}
