import React, { useMemo, useState } from 'react';
import { Check, CopyPlus, Download, Edit2, RefreshCw, Wand2, X } from 'lucide-react';
import type { JDAnalysisResult } from '../../../services/aiService';
import { StaleBadge } from './Badges';

type MobileEditorHeaderProps = {
    resumeName: string;
    onResumeNameChange: (name: string) => void;
    analysisResult: JDAnalysisResult | null;
    isOutdated: boolean;
    isAnalyzing: boolean;
    onAnalyze: () => void;
    onExportPdf: () => void;
    onAutoAssemble: () => void;
    isAutoAssembling: boolean;
    onCreateResume: () => void;
    isCreatingResume: boolean;
};

const SUMMARY_CLAMP_STYLE: React.CSSProperties = {
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: 4,
    overflow: 'hidden',
};

const MobileEditorHeader: React.FC<MobileEditorHeaderProps> = ({
    resumeName,
    onResumeNameChange,
    analysisResult,
    isOutdated,
    isAnalyzing,
    onAnalyze,
    onExportPdf,
    onAutoAssemble,
    isAutoAssembling,
    onCreateResume,
    isCreatingResume,
}) => {
    const [isEditing, setIsEditing] = useState(false);
    const [draftName, setDraftName] = useState(resumeName);

    const summaryText = useMemo(() => {
        const value = analysisResult?.summary?.trim();
        if (value) {
            return value;
        }
        return '在底部抽屉补充 JD 后，这里会展示匹配评价与简历建议。';
    }, [analysisResult?.summary]);

    const handleStartEdit = () => {
        setDraftName(resumeName);
        setIsEditing(true);
    };

    const handleCommitEdit = () => {
        const nextName = draftName.trim();
        if (nextName) {
            onResumeNameChange(nextName);
        }
        setIsEditing(false);
    };

    const handleCancelEdit = () => {
        setDraftName(resumeName);
        setIsEditing(false);
    };

    const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter') {
            handleCommitEdit();
        }
        if (event.key === 'Escape') {
            handleCancelEdit();
        }
    };

    return (
        <div className="border-b border-border-light bg-surface-light px-4 py-4 dark:border-border-dark dark:bg-surface-dark md:hidden">
            <div className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                        {isEditing ? (
                            <div className="flex items-center gap-2">
                                <input
                                    type="text"
                                    value={draftName}
                                    onChange={(event) => setDraftName(event.target.value)}
                                    onKeyDown={handleKeyDown}
                                    onBlur={handleCommitEdit}
                                    autoFocus
                                    className="w-full rounded-xl border border-primary bg-white px-3 py-2 text-sm font-semibold text-gray-900 outline-none ring-0 focus:border-primary focus:ring-2 focus:ring-primary/10 dark:bg-gray-900 dark:text-white"
                                />
                                <button
                                    type="button"
                                    onMouseDown={(event) => event.preventDefault()}
                                    onClick={handleCancelEdit}
                                    className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-gray-200 text-gray-500 dark:border-gray-700 dark:text-gray-300"
                                    aria-label="取消编辑名称"
                                >
                                    <X className="h-4 w-4" />
                                </button>
                                <button
                                    type="button"
                                    onMouseDown={(event) => event.preventDefault()}
                                    onClick={handleCommitEdit}
                                    className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-white"
                                    aria-label="确认编辑名称"
                                >
                                    <Check className="h-4 w-4" />
                                </button>
                            </div>
                        ) : (
                            <div className="flex items-center gap-2">
                                <h1 className="min-w-0 truncate text-xl font-bold tracking-tight text-gray-900 dark:text-white">
                                    {resumeName}
                                </h1>
                                <button
                                    type="button"
                                    onClick={handleStartEdit}
                                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-primary/10 hover:text-primary dark:text-gray-500"
                                    aria-label="编辑简历名称"
                                >
                                    <Edit2 className="h-4 w-4" />
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                <div className="rounded-2xl border border-gray-200 bg-white/90 p-3 shadow-sm dark:border-gray-800 dark:bg-gray-900/80">
                    <div className="space-y-3">
                        <div className="flex items-start justify-between gap-3 px-1">
                            <div className="min-w-0 flex-1">
                                <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-400">
                                    匹配度
                                </div>
                                <div className="flex min-h-[40px] items-end">
                                    {isOutdated ? (
                                        <StaleBadge />
                                    ) : analysisResult ? (
                                        <div className="leading-none">
                                            <div className="text-[31px] font-black tracking-tight text-emerald-600 dark:text-emerald-400">
                                                {analysisResult.matchPercentage ?? 0}
                                                <span className="ml-0.5 text-[16px] font-bold">%</span>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="leading-none">
                                            <div className="text-[28px] font-black tracking-tight text-gray-300 dark:text-gray-600">
                                                --
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-2 pt-1">
                                <button
                                    type="button"
                                    onClick={onCreateResume}
                                    disabled={isCreatingResume}
                                    className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                                    aria-label={isCreatingResume ? '创建副本中' : '创建副本'}
                                    title={isCreatingResume ? '创建副本中...' : '创建副本'}
                                >
                                    <CopyPlus className="h-4 w-4" />
                                </button>
                                <button
                                    type="button"
                                    onClick={onAutoAssemble}
                                    disabled={isAutoAssembling}
                                    className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-primary/20 bg-primary/8 px-3 text-[11px] font-semibold text-primary transition-colors hover:bg-primary/12 disabled:opacity-60"
                                >
                                    <Wand2 className={`h-4 w-4 ${isAutoAssembling ? 'animate-pulse' : ''}`} />
                                    {isAutoAssembling ? '组装中' : '组装'}
                                </button>
                                <button
                                    type="button"
                                    onClick={onExportPdf}
                                    className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-primary px-3 text-[11px] font-semibold text-white shadow-sm transition-colors hover:bg-primary-dark"
                                >
                                    <Download className="h-4 w-4" />
                                    导出
                                </button>
                            </div>
                        </div>

                        <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-3 dark:border-emerald-800/30 dark:bg-emerald-900/10">
                            <div className="mb-2 flex items-center justify-between gap-2">
                                <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-400">
                                    评价
                                </span>
                                <button
                                    type="button"
                                    onClick={onAnalyze}
                                    disabled={isAnalyzing}
                                    className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-primary/10 hover:text-primary disabled:opacity-50"
                                    aria-label="刷新 JD 分析"
                                >
                                    <RefreshCw className={`h-3.5 w-3.5 ${isAnalyzing ? 'animate-spin' : ''}`} />
                                </button>
                            </div>
                            <p
                                className="text-[12.5px] leading-5 text-emerald-800 dark:text-emerald-300/80"
                                style={SUMMARY_CLAMP_STYLE}
                            >
                                {summaryText}
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default MobileEditorHeader;
