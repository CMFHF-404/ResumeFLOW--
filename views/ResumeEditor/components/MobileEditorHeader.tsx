import React, { useMemo, useState, useRef, useCallback, useEffect } from 'react';
import {
    Check,
    ChevronLeft,
    Copy,
    CopyPlus,
    Download,
    Edit2,
    LayoutTemplate,
    MessageSquare,
    RefreshCw,
    Wand2,
    X,
} from 'lucide-react';
import type { JDAnalysisResult } from '../../../services/aiService';
import { StaleBadge } from './Badges';
import JDAttachmentUploader, {
    JDAttachmentPreview,
    isAcceptedJDAttachmentFile,
    prepareJDAttachmentFile,
} from './JDAttachmentUploader';

export type MobileEditorHeaderProps = {
    resumeId?: string | null;
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
    canCreateResume: boolean;
    isCreatingResume: boolean;
    isSmartPageApplied: boolean;
    onAdjustToSinglePage: () => void;
    onRestoreDefault: () => void;
    bossGreeting: string;
    isBossGreetingVisible: boolean;
    isBossGreetingOutdated: boolean;
    isGeneratingBossGreeting: boolean;
    onGenerateBossGreeting: () => void;
    onRefreshBossGreeting: () => void;
    onCopyBossGreeting: () => void;
    onCollapseBossGreeting: () => void;
    jdText: string;
    onJdTextChange: (value: string) => void;
    jdFile: File | null;
    onFileChange: (file: File | null) => void;
    hasMissingAttachmentContext: boolean;
    isJDCollapsed: boolean;
    onJDCollapseChange: (collapsed: boolean) => void;
};

const SUMMARY_CLAMP_STYLE: React.CSSProperties = {
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: 4,
    overflow: 'hidden',
};

const MobileEditorHeader: React.FC<MobileEditorHeaderProps> = ({
    resumeId,
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
    canCreateResume,
    isCreatingResume,
    isSmartPageApplied,
    onAdjustToSinglePage,
    onRestoreDefault,
    bossGreeting,
    isBossGreetingVisible,
    isBossGreetingOutdated,
    isGeneratingBossGreeting,
    onGenerateBossGreeting,
    onRefreshBossGreeting,
    onCopyBossGreeting,
    onCollapseBossGreeting,
    jdText,
    onJdTextChange,
    jdFile,
    onFileChange,
    hasMissingAttachmentContext,
    isJDCollapsed,
    onJDCollapseChange,
}) => {
    const [isEditing, setIsEditing] = useState(false);
    const [draftName, setDraftName] = useState(resumeName);
    const [isEditingJd, setIsEditingJd] = useState(false);

    const showJdInput = !isJDCollapsed;

    useEffect(() => {
        if (isJDCollapsed) {
            setIsEditingJd(false);
        }
    }, [isJDCollapsed]);

    useEffect(() => {
        setIsEditingJd(false);
    }, [resumeId]);

    const attachmentSelectionVersionRef = useRef(0);

    const handleAttachmentSelect = useCallback(async (file: File) => {
        const requestVersion = attachmentSelectionVersionRef.current + 1;
        attachmentSelectionVersionRef.current = requestVersion;
        const preparedFile = await prepareJDAttachmentFile(file);
        if (attachmentSelectionVersionRef.current !== requestVersion || !preparedFile) {
            return;
        }
        onFileChange(preparedFile);
    }, [onFileChange]);

    const handleTextareaPaste = useCallback((event: React.ClipboardEvent<HTMLTextAreaElement>) => {
        if (isAnalyzing) {
            return;
        }
        const pastedImageItem = Array.from(event.clipboardData.items).find((item) => (
            item.kind === 'file' && item.type.startsWith('image/')
        ));
        const pastedFile = pastedImageItem?.getAsFile();
        if (!pastedFile || !isAcceptedJDAttachmentFile(pastedFile)) {
            return;
        }
        event.preventDefault();
        void handleAttachmentSelect(pastedFile);
    }, [handleAttachmentSelect, isAnalyzing]);

    const hasSummary = Boolean(analysisResult?.summary?.trim());
    const summaryText = useMemo(() => {
        const value = analysisResult?.summary?.trim();
        if (value) {
            return value;
        }
        return '在底部抽屉补充 JD 后，这里会展示匹配评价与简历建议。';
    }, [analysisResult?.summary]);
    
    const bossGreetingButtonLabel = isGeneratingBossGreeting
        ? '生成中...'
        : bossGreeting && isBossGreetingOutdated
            ? '重新生成 BOSS 招呼语'
            : '生成 BOSS 招呼语';
    const isCreateResumeDisabled = isCreatingResume || !canCreateResume;
    const hasSourceResume = Boolean(resumeId);
    const createResumeLabel = isCreatingResume
        ? (hasSourceResume ? '副本中' : '新建中')
        : (hasSourceResume ? '副本' : '新建');
    const createResumeTitle = isCreatingResume
        ? (hasSourceResume ? '副本中...' : '新建中...')
        : canCreateResume
            ? (hasSourceResume ? '创建副本' : '新建简历')
            : '当前简历加载中';

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
                    <div className="flex flex-col">
                        <div className="flex items-start justify-between gap-2 px-1 mb-3">
                            {showJdInput ? (
                                <div className="min-w-0 shrink-0 pt-1.5 flex-1">
                                    <div className="mb-1 flex items-center text-[12.5px] font-semibold text-gray-700 dark:text-gray-200 uppercase tracking-wide">
                                        {isEditingJd ? (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setIsEditingJd(false);
                                                    onJDCollapseChange(true);
                                                }}
                                                className="inline-flex h-6 w-6 -ml-1 mr-1 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-200 transition-colors"
                                                aria-label="返回"
                                            >
                                                <ChevronLeft className="h-4 w-4" />
                                            </button>
                                        ) : null}
                                        职位要求 (JD)
                                    </div>
                                </div>
                            ) : (
                                <div className="min-w-0 shrink-0">
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
                            )}

                            <div className={`flex items-center justify-end gap-1.5 sm:gap-2 ${showJdInput ? 'pt-1' : ''}`}>
                                <button
                                    type="button"
                                    onClick={onCreateResume}
                                    disabled={isCreateResumeDisabled}
                                    className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 text-[11px] font-semibold text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                                    aria-label={createResumeTitle}
                                    title={createResumeTitle}
                                >
                                    <CopyPlus className="h-4 w-4" />
                                    {createResumeLabel}
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

                        {showJdInput ? (
                            <div className="space-y-3">
                                <div className="relative rounded-xl border border-border-light bg-white/90 p-2 shadow-sm transition-colors dark:border-border-dark dark:bg-gray-900/80">
                                    <textarea
                                        className="h-28 w-full resize-none rounded-lg border border-transparent bg-transparent p-3 pr-28 text-sm text-gray-700 outline-none transition placeholder:text-gray-400 focus:border-primary/20 focus:ring-2 focus:ring-primary/20 dark:text-gray-300 dark:placeholder:text-gray-600"
                                        placeholder={jdFile
                                            ? '可选：补充手动输入的 JD 说明；分析成功后会自动转成文本版 JD。'
                                            : '在此粘贴职位要求或截图...'}
                                        value={jdText}
                                        onChange={(event) => onJdTextChange(event.target.value)}
                                        onPaste={handleTextareaPaste}
                                    />
                                    <div className="absolute bottom-3 right-3 flex items-center gap-2">
                                        <JDAttachmentUploader
                                            file={jdFile}
                                            onFileChange={onFileChange}
                                            disabled={isAnalyzing}
                                        />
                                        <button
                                            type="button"
                                            onClick={() => {
                                                onAnalyze();
                                            }}
                                            disabled={isAnalyzing || (!hasMissingAttachmentContext && !jdFile && !jdText.trim())}
                                            className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-[11.5px] font-bold text-white shadow transition-colors hover:bg-primary-dark disabled:opacity-60"
                                        >
                                            <Wand2 className="h-3 w-3" />
                                            {isAnalyzing ? '分析中...' : '开始分析'}
                                        </button>
                                    </div>
                                </div>
                                {jdFile && (
                                    <JDAttachmentPreview
                                        file={jdFile}
                                        onClear={() => onFileChange(null)}
                                        disabled={isAnalyzing}
                                    />
                                )}
                            </div>
                        ) : (
                            <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-3 dark:border-emerald-800/30 dark:bg-emerald-900/10 mb-3">
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-400">
                                            评价
                                        </span>
                                        <div className="flex items-center gap-0.5">
                                            {/* 编辑 JD 图标按钮，位于刷新按钮左侧 */}
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setIsEditingJd(true);
                                                    onJDCollapseChange(false);
                                                }}
                                                className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-primary/10 hover:text-primary"
                                                aria-label="编辑 JD"
                                                title="编辑 JD"
                                            >
                                                <Edit2 className="h-3.5 w-3.5" />
                                            </button>
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
                                    </div>
                                    <p
                                        className="text-[12.5px] leading-5 text-emerald-800 dark:text-emerald-300/80"
                                        style={isBossGreetingVisible ? undefined : SUMMARY_CLAMP_STYLE}
                                    >
                                        {summaryText}
                                    </p>
                                    {hasSummary ? (
                                        <div className="space-y-2">
                                            <button
                                                type="button"
                                                onClick={onGenerateBossGreeting}
                                                disabled={isGeneratingBossGreeting}
                                                className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-emerald-700 transition-colors hover:text-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
                                            >
                                                <MessageSquare className={`h-3.5 w-3.5 ${isGeneratingBossGreeting ? 'animate-pulse' : ''}`} />
                                                {bossGreetingButtonLabel}
                                            </button>
                                            {isBossGreetingVisible ? (
                                                <div className="rounded-lg border border-emerald-200 bg-white/90 p-3 shadow-sm dark:border-emerald-800/50 dark:bg-gray-900/70">
                                                    <div className="mb-2 flex items-center justify-between gap-3">
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                                                                BOSS 招呼语
                                                            </span>
                                                            {isBossGreetingOutdated && bossGreeting ? (
                                                                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                                                                    已过期
                                                                </span>
                                                            ) : null}
                                                        </div>
                                                        <div className="flex items-center gap-1">
                                                            <button
                                                                type="button"
                                                                onClick={onRefreshBossGreeting}
                                                                disabled={isGeneratingBossGreeting}
                                                                aria-label="刷新 BOSS 招呼语"
                                                                className="rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-emerald-600 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-gray-800 dark:hover:text-emerald-300"
                                                            >
                                                                <RefreshCw className={`h-3.5 w-3.5 ${isGeneratingBossGreeting ? 'animate-spin' : ''}`} />
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={onCollapseBossGreeting}
                                                                className="text-[11px] text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-200"
                                                            >
                                                                收起
                                                            </button>
                                                        </div>
                                                    </div>
                                                    <div className="space-y-3">
                                                        {isGeneratingBossGreeting && !bossGreeting ? (
                                                            <p className="text-[11.5px] leading-relaxed text-gray-500 dark:text-gray-400">
                                                                正在根据 JD 分析与已选经历生成招呼语...
                                                            </p>
                                                        ) : (
                                                            <p className="text-[11.5px] leading-relaxed text-gray-700 dark:text-gray-200">
                                                                {bossGreeting || '暂无可用招呼语'}
                                                            </p>
                                                        )}
                                                        <button
                                                            type="button"
                                                            onClick={onCopyBossGreeting}
                                                            disabled={!bossGreeting.trim()}
                                                            className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 px-2.5 py-1 text-[11px] font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                                                        >
                                                            <Copy className="h-3 w-3" />
                                                            一键复制
                                                        </button>
                                                    </div>
                                                </div>
                                            ) : null}
                                        </div>
                                    ) : null}
                                </div>
                            </div>
                        )}

                        <div className={`flex gap-2 w-full ${showJdInput ? 'mt-4' : ''}`}>
                            <button
                                type="button"
                                onClick={isSmartPageApplied ? onRestoreDefault : onAdjustToSinglePage}
                                className={[
                                    'flex-1 inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border px-3 text-[12px] font-semibold transition-colors disabled:opacity-60',
                                    isSmartPageApplied
                                        ? 'border-gray-200 text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-700'
                                        : 'border-primary/20 bg-primary/8 text-primary hover:bg-primary/12',
                                ].join(' ')}
                            >
                                <LayoutTemplate className="h-4 w-4" />
                                {isSmartPageApplied ? '还原一页' : '智能一页'}
                            </button>
                            <button
                                type="button"
                                onClick={onAutoAssemble}
                                disabled={isAutoAssembling}
                                className={[
                                    'flex flex-[2] items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-[12px] font-semibold transition-colors',
                                    'border-emerald-500 bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60 dark:border-emerald-400 dark:bg-emerald-500 dark:hover:bg-emerald-400',
                                ].join(' ')}
                            >
                                <Wand2 className={`h-4 w-4 ${isAutoAssembling ? 'animate-pulse' : ''}`} />
                                {isAutoAssembling ? '组装中' : '一键组装'}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default MobileEditorHeader;
