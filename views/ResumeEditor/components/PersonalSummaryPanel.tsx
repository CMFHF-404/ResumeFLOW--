import React, { useState } from 'react';
import { Check, ChevronDown, FileText, Wand2 } from 'lucide-react';

type PersonalSummaryPanelProps = {
    value: string;
    isVisible: boolean;
    isGenerating: boolean;
    canGenerate: boolean;
    onChange: (value: string) => void;
    onVisibilityChange: (value: boolean) => void;
    onGenerate: () => void;
};

const PersonalSummaryPanel: React.FC<PersonalSummaryPanelProps> = ({
    value,
    isVisible,
    isGenerating,
    canGenerate,
    onChange,
    onVisibilityChange,
    onGenerate,
}) => {
    const [isCollapsed, setIsCollapsed] = useState(false);
    const hasValue = value.trim().length > 0;

    return (
        <section className="space-y-3">
            <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => setIsCollapsed((prev) => !prev)}
                        className="p-0.5 -ml-1 text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-200"
                        aria-label={isCollapsed ? '展开个人评价' : '收起个人评价'}
                    >
                        <ChevronDown
                            className={`h-3.5 w-3.5 transition-transform duration-200 ${isCollapsed ? '-rotate-90' : 'rotate-0'}`}
                        />
                    </button>
                    <FileText className="h-3.5 w-3.5 text-primary" />
                    <h4
                        className="cursor-pointer text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400"
                        onClick={() => setIsCollapsed((prev) => !prev)}
                    >
                        个人评价
                    </h4>
                </div>
            </div>

            {!isCollapsed ? (
                <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
                    <div className="mb-3 flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3">
                            <button
                                type="button"
                                onClick={() => onVisibilityChange(!isVisible)}
                                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors ${
                                    isVisible
                                        ? 'border-primary bg-primary text-white'
                                        : 'border-gray-300 bg-white text-transparent hover:border-primary/50'
                                }`}
                                aria-pressed={isVisible}
                                aria-label={isVisible ? '取消显示个人评价' : '显示个人评价'}
                            >
                                <Check className="h-3.5 w-3.5" />
                            </button>
                            <div>
                                <p className="text-[11px] leading-5 text-gray-400 dark:text-gray-500">
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
                        placeholder="可手动填写个人评价，也可根据全部经历和 JD 一键生成。"
                        className="min-h-[132px] w-full resize-y rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm leading-6 text-gray-700 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
                    />
                </div>
            ) : hasValue ? (
                <p className="px-1 text-[11px] leading-5 text-gray-400 dark:text-gray-500">
                    已折叠，当前{isVisible ? '会显示在简历中' : '不会显示在简历中'}。
                </p>
            ) : (
                <p className="px-1 text-[11px] leading-5 text-gray-400 dark:text-gray-500">
                    已折叠，当前{isVisible ? '会显示在简历中' : '不会显示在简历中'}。
                </p>
            )}
        </section>
    );
};

export default PersonalSummaryPanel;
