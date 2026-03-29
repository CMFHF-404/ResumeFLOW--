import React from 'react';
import { FileText, Wand2 } from 'lucide-react';

type PersonalSummaryPanelProps = {
    value: string;
    isGenerating: boolean;
    canGenerate: boolean;
    onChange: (value: string) => void;
    onGenerate: () => void;
};

const PersonalSummaryPanel: React.FC<PersonalSummaryPanelProps> = ({
    value,
    isGenerating,
    canGenerate,
    onChange,
    onGenerate,
}) => (
    <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" />
                <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                        个人评价
                    </h4>
                    <p className="mt-1 text-[11px] leading-5 text-gray-400 dark:text-gray-500">
                        总结适合写入简历自我评价的核心优势与方向。
                    </p>
                </div>
            </div>
            <button
                type="button"
                onClick={onGenerate}
                disabled={!canGenerate || isGenerating}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-primary/20 bg-primary/10 px-3 py-1.5 text-[11px] font-semibold text-primary transition-colors hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-60"
            >
                <Wand2 className={`h-3.5 w-3.5 ${isGenerating ? 'animate-spin' : ''}`} />
                {isGenerating ? '生成中...' : 'AI 一键生成'}
            </button>
        </div>
        <textarea
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder="可手动填写个人评价，也可根据全部经历一键生成。"
            className="min-h-[132px] w-full resize-y rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm leading-6 text-gray-700 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
        />
    </section>
);

export default PersonalSummaryPanel;
