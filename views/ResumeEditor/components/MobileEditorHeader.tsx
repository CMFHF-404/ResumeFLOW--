import React, { useMemo, useState, useRef, useCallback, useEffect } from 'react';
import {
    Check,
    ChevronDown,
    ChevronLeft,
    ChevronUp,
    Copy,
    Download,
    Edit2,
    LayoutTemplate,
    MessageSquare,
    Plus,
    RefreshCw,
    SlidersHorizontal,
    Sparkles,
    Wand2,
    X,
} from 'lucide-react';
import type { JDAnalysisResult, JDCoreCapability } from '../../../services/aiService';
import { StaleBadge } from './Badges';
import {
    getMobileCapabilityFollowUpQuestion,
    SUMMARY_CLAMP_STYLE,
    useMobileAnalysisCardMotion,
} from './mobileHeaderUtils';
import JDAttachmentUploader, {
    JDAttachmentPreview,
    isAcceptedJDAttachmentFile,
    prepareJDAttachmentFile,
} from './JDAttachmentUploader';
import { useJDAnalysisMotion } from './jdAnalysisMotion';

export type MobileEditorHeaderProps = {
    resumeId?: string | null;
    resumeName: string;
    onResumeNameChange: (name: string) => void;
    analysisResult: JDAnalysisResult | null;
    isOutdated: boolean;
    isAnalyzing: boolean;
    onAnalyze: () => void;
    onExportPdf: () => void;
    isExportingPdf: boolean;
    isPreviewOverflowing?: boolean;
    canBatchPolish: boolean;
    selectedExperienceCount: number;
    isBatchPolishing: boolean;
    hasBlockingPolishState?: boolean;
    batchPolishToolbar?: React.ReactNode;
    onBatchPolish: () => void;
    onCloseBatchPolishToolbar?: () => void;
    onAutoAssemble: () => void;
    isAutoAssembling: boolean;
    onCreateResume: () => void;
    canCreateResume: boolean;
    isCreatingResume: boolean;
    isLayoutModified: boolean;
    isSmartPageApplied: boolean;
    isLayoutAdjustToolbarOpen: boolean;
    onToggleLayoutAdjustToolbar: () => void;
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
    onOpenTemplateSelector: () => void;
    onLaunchAssistant?: () => void;
    canLaunchAssistant?: boolean;
    thinkingText?: string;
    onStopAnalyze?: () => void;
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
    isExportingPdf,
    isPreviewOverflowing = false,
    canBatchPolish,
    selectedExperienceCount,
    isBatchPolishing,
    hasBlockingPolishState = false,
    batchPolishToolbar,
    onBatchPolish,
    onCloseBatchPolishToolbar,
    onAutoAssemble,
    isAutoAssembling,
    onCreateResume,
    canCreateResume,
    isCreatingResume,
    isLayoutModified,
    isSmartPageApplied,
    isLayoutAdjustToolbarOpen,
    onToggleLayoutAdjustToolbar,
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
    onOpenTemplateSelector,
    onLaunchAssistant,
    canLaunchAssistant = false,
    thinkingText,
    onStopAnalyze,
}) => {
    const jdAnalysisMotion = useJDAnalysisMotion(isAnalyzing);
    const [isEditing, setIsEditing] = useState(false);
    const [draftName, setDraftName] = useState(resumeName);
    const [isEditingJd, setIsEditingJd] = useState(false);
    const [isAnalysisCollapsed, setIsAnalysisCollapsed] = useState(false);

    const showJdInput = !isJDCollapsed;
    const {
        analysisCardContentRef,
        summaryCardRef,
        batchPolishCardRef,
        isBatchPolishCardVisible,
        analysisFlipDurationMs,
        analysisFlipCardHeight,
        analysisCardMotionStyle,
        handleCloseBatchPolishCard,
    } = useMobileAnalysisCardMotion({
        showJdInput,
        isAnalysisCollapsed,
        batchPolishToolbar,
        onCloseBatchPolishToolbar,
    });

    useEffect(() => {
        if (isJDCollapsed) {
            setIsEditingJd(false);
        }
    }, [isJDCollapsed]);

    useEffect(() => {
        setIsEditingJd(false);
        setIsAnalysisCollapsed(false);
    }, [resumeId]);

    useEffect(() => {
        if (showJdInput || isAnalyzing || isGeneratingBossGreeting || isEditingJd) {
            setIsAnalysisCollapsed(false);
        }
    }, [showJdInput, isAnalyzing, isGeneratingBossGreeting, isEditingJd]);

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
    const followUpQuestion = useMemo(
        () => getMobileCapabilityFollowUpQuestion(analysisResult),
        [analysisResult]
    );

    const bossGreetingButtonLabel = isGeneratingBossGreeting
        ? '生成中...'
        : bossGreeting && isBossGreetingOutdated
            ? '重新生成 BOSS 招呼语'
            : '生成 BOSS 招呼语';
    const isCreateResumeDisabled = isCreatingResume || !canCreateResume;
    const canRestoreDefault = isLayoutModified || isSmartPageApplied;
    const createResumeTitle = isCreatingResume
        ? '新增中...'
        : canCreateResume
            ? '新增简历'
            : '当前简历加载中';
    const exportButtonTitle = isPreviewOverflowing
        ? '当前预览已超出单页 A4，导出时可能失败'
        : (isExportingPdf ? '导出中...' : '导出 PDF');

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

    const handleBatchPolishClick = useCallback(() => {
        if (showJdInput) {
            setIsEditingJd(false);
            onJDCollapseChange(true);
        }
        onBatchPolish();
    }, [onBatchPolish, onJDCollapseChange, showJdInput]);

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
                                    title="编辑简历名称"
                                >
                                    <Edit2 className="h-4 w-4" />
                                </button>
                                <button
                                    type="button"
                                    onClick={onCreateResume}
                                    disabled={isCreateResumeDisabled}
                                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-primary/10 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-500"
                                    aria-label={createResumeTitle}
                                    title={createResumeTitle}
                                >
                                    <Plus className="h-4 w-4" />
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                <div className="relative">
                    <div
                        className={isAnalysisCollapsed ? 'overflow-hidden pointer-events-none' : 'overflow-visible'}
                        style={analysisCardMotionStyle}
                        aria-hidden={isAnalysisCollapsed}
                    >
                        <div
                            ref={analysisCardContentRef}
                            id="mobile-analysis-card"
                            className="rounded-2xl border border-gray-200 bg-white/90 p-3 dark:border-gray-800 dark:bg-gray-900/80"
                        >
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
                                    onClick={onLaunchAssistant}
                                    disabled={!canLaunchAssistant}
                                    className="ai-active-gradient inline-flex h-10 items-center justify-center gap-1.5 rounded-xl px-3 text-[11px] font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                                    aria-label="打开 AI 助理"
                                    title={canLaunchAssistant ? '带着当前简历打开 AI 助理' : '当前简历加载中'}
                                >
                                    <Sparkles className="h-4 w-4" />
                                    AI
                                </button>
                                <button
                                    type="button"
                                    onClick={onOpenTemplateSelector}
                                    className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 text-[11px] font-semibold text-gray-700 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                                    aria-label="选择简历模板"
                                    title="选择简历模板"
                                >
                                    <LayoutTemplate className="h-4 w-4" />
                                    模板
                                </button>
                                <button
                                    type="button"
                                    onClick={onExportPdf}
                                    disabled={isExportingPdf}
                                    className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-primary px-3 text-[11px] font-semibold text-white shadow-sm transition-colors hover:bg-primary-dark disabled:opacity-60"
                                    title={exportButtonTitle}
                                >
                                    <Download className="h-4 w-4" />
                                    {isExportingPdf ? '导出中' : '导出'}
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
                                    {jdAnalysisMotion.shouldRenderStatus ? (
                                        <div className={`absolute bottom-3 right-3 left-3 flex items-center justify-between gap-3 rounded-lg border border-primary/20 bg-primary/5 px-2.5 py-1.5 backdrop-blur-sm dark:bg-primary-dark/10 transition-all duration-300 ${jdAnalysisMotion.statusMotionClass}`}>
                                            <div className="flex min-w-0 flex-1 items-center gap-1.5 text-[11px] text-gray-700 dark:text-gray-300">
                                                <Wand2 className="h-3 w-3 shrink-0 animate-spin text-primary" />
                                                <span className="min-w-0 flex-1 whitespace-normal break-words font-medium leading-relaxed">
                                                    思考中：{thinkingText || '正在分析岗位要求...'}
                                                </span>
                                            </div>
                                            {onStopAnalyze ? (
                                                <button
                                                    type="button"
                                                    onClick={onStopAnalyze}
                                                    disabled={!isAnalyzing}
                                                    className="flex shrink-0 items-center gap-1 rounded bg-red-50 px-2 py-0.5 text-[10.5px] font-semibold text-red-600 transition hover:bg-red-100 disabled:opacity-60 dark:bg-red-950/40 dark:text-red-400"
                                                >
                                                    停止
                                                </button>
                                            ) : null}
                                        </div>
                                    ) : (
                                        <div className={`absolute bottom-3 right-3 flex items-center gap-2 ${jdAnalysisMotion.idleControlsMotionClass}`}>
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
                                                开始分析
                                            </button>
                                        </div>
                                    )}
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
                            <div className="mb-3 [perspective:1600px]">
                                <div
                                    className="grid items-start overflow-hidden transition-[height] duration-[420ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
                                    style={{
                                        ...(analysisFlipCardHeight ? { height: `${analysisFlipCardHeight}px` } : {}),
                                        transitionDuration: `${analysisFlipDurationMs}ms`,
                                    }}
                                >
                                    <div
                                        ref={summaryCardRef}
                                        className={[
                                            'col-start-1 row-start-1 w-full self-start rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-3 transition-all duration-[420ms] ease-[cubic-bezier(0.22,1,0.36,1)] dark:border-emerald-800/30 dark:bg-emerald-900/10 [backface-visibility:hidden] [transform-style:preserve-3d] [will-change:transform,opacity]',
                                            isBatchPolishCardVisible
                                                ? 'pointer-events-none opacity-0 [transform:rotateY(-180deg)_scale(0.985)]'
                                                : 'opacity-100 [transform:rotateY(0deg)_scale(1)]',
                                        ].join(' ')}
                                        style={{ transitionDuration: `${analysisFlipDurationMs}ms` }}
                                    >
                                        <div className="space-y-3">
                                            <div className="flex items-center justify-between gap-2">
                                                <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-400">
                                                    评价
                                                </span>
                                                <div className="flex items-center gap-0.5">
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
                                            {followUpQuestion ? (
                                                <p className="text-[12.5px] leading-5 text-amber-800 dark:text-amber-200">
                                                    建议补充：{followUpQuestion}
                                                </p>
                                            ) : null}
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
                                    {batchPolishToolbar ? (
                                        <div
                                            ref={batchPolishCardRef}
                                            className={[
                                                'col-start-1 row-start-1 w-full self-start rounded-xl border border-violet-200/80 bg-[linear-gradient(180deg,rgba(248,245,255,0.98),rgba(255,255,255,0.98))] px-3 py-3 transition-all duration-[420ms] ease-[cubic-bezier(0.22,1,0.36,1)] dark:border-violet-500/20 dark:bg-[linear-gradient(180deg,rgba(46,16,101,0.32),rgba(17,24,39,0.92))] [backface-visibility:hidden] [transform-style:preserve-3d] [will-change:transform,opacity]',
                                                isBatchPolishCardVisible
                                                    ? 'opacity-100 [transform:rotateY(0deg)_scale(1)]'
                                                    : 'pointer-events-none opacity-0 [transform:rotateY(180deg)_scale(0.985)]',
                                            ].join(' ')}
                                            style={{ transitionDuration: `${analysisFlipDurationMs}ms` }}
                                        >
                                            <div className="space-y-3">
                                                <div className="flex items-start justify-between gap-3">
                                                    <div className="min-w-0">
                                                        <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-violet-700 dark:text-violet-300">
                                                            AI 批量润色
                                                        </div>
                                                        <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">
                                                            当前已选 {selectedExperienceCount} 条经历
                                                        </div>
                                                        <div className="mt-1 text-[12.5px] leading-5 text-slate-500 dark:text-slate-300">
                                                            结果会先同步到简历预览，确认后统一保存到当前简历。
                                                        </div>
                                                    </div>
                                                    {onCloseBatchPolishToolbar ? (
                                                        <button
                                                            type="button"
                                                            onClick={handleCloseBatchPolishCard}
                                                            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-violet-100 bg-white/90 text-slate-500 transition hover:border-violet-200 hover:text-slate-900 dark:border-violet-400/20 dark:bg-white/10 dark:text-slate-300 dark:hover:border-violet-300/30 dark:hover:text-white"
                                                            aria-label="关闭批量润色卡片"
                                                            title="关闭批量润色卡片"
                                                        >
                                                            <X className="h-4 w-4" />
                                                        </button>
                                                    ) : null}
                                                </div>
                                                <div className="[&>div]:shadow-none">
                                                    {batchPolishToolbar}
                                                </div>
                                            </div>
                                        </div>
                                    ) : null}
                                </div>
                            </div>
                        )}

                        <div className={`flex w-full items-stretch gap-2 ${showJdInput ? 'mt-4' : ''}`}>
                            <div className="flex min-w-[112px] flex-[1.08]">
                                <button
                                    type="button"
                                    onClick={onToggleLayoutAdjustToolbar}
                                    className={[
                                        'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-l-xl rounded-r-none border border-r-0 transition-colors',
                                        isLayoutAdjustToolbarOpen
                                            ? 'border-primary bg-primary/10 text-primary'
                                            : 'border-primary/20 bg-white text-primary hover:bg-primary/8 dark:border-primary/30 dark:bg-gray-900 dark:text-primary dark:hover:bg-primary/12',
                                    ].join(' ')}
                                    aria-label="打开手动调节工具栏"
                                    aria-pressed={isLayoutAdjustToolbarOpen}
                                >
                                    <SlidersHorizontal className="h-4 w-4" />
                                </button>
                                <button
                                    type="button"
                                    onClick={canRestoreDefault ? onRestoreDefault : onAdjustToSinglePage}
                                    className={[
                                        'min-w-0 flex-1 inline-flex h-10 items-center justify-center gap-1 rounded-r-xl rounded-l-none border px-2.5 text-[11.5px] font-semibold whitespace-nowrap transition-colors disabled:opacity-60',
                                        canRestoreDefault
                                            ? 'border-gray-200 text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-700'
                                            : 'border-primary/20 bg-primary/8 text-primary hover:bg-primary/12',
                                    ].join(' ')}
                                >
                                    <LayoutTemplate className="h-4 w-4" />
                                    {canRestoreDefault ? '恢复默认' : '智能一页'}
                                </button>
                            </div>
                            <button
                                type="button"
                                onClick={handleBatchPolishClick}
                                disabled={!canBatchPolish || isBatchPolishing || hasBlockingPolishState}
                                className={[
                                    'flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-xl border px-2 py-2.5 text-[11.5px] font-semibold whitespace-nowrap transition-colors disabled:opacity-60',
                                    'border-violet-500 bg-violet-600 text-white hover:bg-violet-700 disabled:cursor-not-allowed dark:border-violet-400 dark:bg-violet-500 dark:hover:bg-violet-400',
                                ].join(' ')}
                                title={
                                    hasBlockingPolishState
                                        ? '请先确认或撤销当前润色结果'
                                        : canBatchPolish
                                        ? '批量润色当前已选经历'
                                        : '请先填写 JD 并至少选中一条经历'
                                }
                            >
                                <Sparkles className={`h-4 w-4 ${isBatchPolishing ? 'animate-spin' : ''}`} />
                                {isBatchPolishing ? '润色中' : '一键润色'}
                            </button>
                            <button
                                type="button"
                                onClick={onAutoAssemble}
                                disabled={isAutoAssembling || hasBlockingPolishState}
                                className={[
                                    'flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-xl border px-2 py-2.5 text-[11.5px] font-semibold whitespace-nowrap transition-colors',
                                    'border-emerald-500 bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60 dark:border-emerald-400 dark:bg-emerald-500 dark:hover:bg-emerald-400',
                                ].join(' ')}
                                title={hasBlockingPolishState ? '请先确认或撤销当前润色结果' : '一键组装当前简历'}
                            >
                                <Wand2 className={`h-4 w-4 ${isAutoAssembling ? 'animate-pulse' : ''}`} />
                                {isAutoAssembling ? '组装中' : '一键组装'}
                            </button>
                        </div>
                    </div>
                        </div>
                    </div>

                    {isAnalysisCollapsed ? (
                        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 pb-1 pt-1.5">
                            <div className="min-w-0 justify-self-start px-1">
                                {isOutdated ? (
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-[12px] font-semibold text-amber-500 dark:text-amber-300">
                                            待更新
                                        </span>
                                        <button
                                            type="button"
                                            onClick={onAnalyze}
                                            disabled={isAnalyzing}
                                            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-primary/10 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
                                            aria-label="刷新 JD 分析"
                                            title="刷新 JD 分析"
                                        >
                                            <RefreshCw className={`h-3.5 w-3.5 ${isAnalyzing ? 'animate-spin' : ''}`} />
                                        </button>
                                    </div>
                                ) : analysisResult ? (
                                    <div className="leading-none text-emerald-600 dark:text-emerald-400">
                                        <span className="text-[24px] font-black tracking-tight">
                                            {analysisResult.matchPercentage ?? 0}
                                        </span>
                                        <span className="ml-0.5 text-[12px] font-bold">%</span>
                                    </div>
                                ) : (
                                    <span className="text-[22px] font-black tracking-tight text-gray-300 dark:text-gray-600">
                                        --
                                    </span>
                                )}
                            </div>

                            <button
                                type="button"
                                onClick={() => setIsAnalysisCollapsed(false)}
                                aria-controls="mobile-analysis-card"
                                aria-expanded={false}
                                className="inline-flex items-center gap-1.5 px-3 py-1 text-[11px] font-semibold text-gray-600 transition-colors hover:text-primary dark:text-gray-300 dark:hover:text-primary"
                            >
                                <ChevronDown className="h-3.5 w-3.5" />
                                展开分析卡片
                            </button>

                            <button
                                type="button"
                                onClick={onExportPdf}
                                disabled={isExportingPdf}
                                className="inline-flex h-10 justify-self-end items-center justify-center gap-1.5 rounded-xl bg-primary px-3 text-[11px] font-semibold text-white shadow-sm transition-colors hover:bg-primary-dark disabled:opacity-60"
                                title={exportButtonTitle}
                            >
                                <Download className="h-4 w-4" />
                                {isExportingPdf ? '导出中' : '导出'}
                            </button>
                        </div>
                    ) : (
                        <div className="mt-0.5 flex justify-center pb-0 pt-0">
                            <button
                                type="button"
                                onClick={() => setIsAnalysisCollapsed(true)}
                                aria-controls="mobile-analysis-card"
                                aria-expanded={true}
                                className="inline-flex translate-y-1 items-center gap-1.5 px-3 py-1 text-[11px] font-semibold text-gray-600 transition-colors hover:text-primary dark:text-gray-300 dark:hover:text-primary"
                            >
                                <ChevronUp className="h-3.5 w-3.5" />
                                收起分析卡片
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default MobileEditorHeader;
