import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
    ChevronDown,
    ChevronUp,
    Copy,
    MessageSquare,
    RefreshCw,
    Target,
    Wand2,
} from 'lucide-react';
import type { JDAnalysisResult } from '../../../services/aiService';
import { JD_PANEL_BOTTOM_SPACING_CLASS, JD_PANEL_STICKY_CLASS } from '../constants';
import { normalizeJobKeywords } from '../helpers';
import { MatchBadge } from './Badges';
import JDAttachmentUploader, {
    JDAttachmentPreview,
    isAcceptedJDAttachmentFile,
    prepareJDAttachmentFile,
} from './JDAttachmentUploader';

const JD_PANEL_CONTENT_ID = 'jd-analysis-panel-content';

type JDAnalysisPanelProps = {
    jdText: string;
    analysisResult: JDAnalysisResult | null;
    isAnalyzing: boolean;
    isCollapsed: boolean;
    onAnalyze: () => void;
    onToggleCollapse: () => void;
    onJdTextChange: (value: string) => void;
    jdFile: File | null;
    onFileChange: (file: File | null) => void;
    hasMissingAttachmentContext: boolean;
    bossGreeting: string;
    isBossGreetingVisible: boolean;
    isBossGreetingOutdated: boolean;
    isGeneratingBossGreeting: boolean;
    onGenerateBossGreeting: () => void;
    onRefreshBossGreeting: () => void;
    onCopyBossGreeting: () => void;
    onCollapseBossGreeting: () => void;
    debugInfo?: any;
    showDebugInfo?: boolean;
    isOutdated?: boolean;
};

type BossGreetingSectionProps = {
    analysisResult: JDAnalysisResult | null;
    bossGreeting: string;
    isBossGreetingVisible: boolean;
    isBossGreetingOutdated: boolean;
    isGeneratingBossGreeting: boolean;
    onGenerateBossGreeting: () => void;
    onRefreshBossGreeting: () => void;
    onCopyBossGreeting: () => void;
    onCollapseBossGreeting: () => void;
};

const BossGreetingSection: React.FC<BossGreetingSectionProps> = ({
    analysisResult,
    bossGreeting,
    isBossGreetingVisible,
    isBossGreetingOutdated,
    isGeneratingBossGreeting,
    onGenerateBossGreeting,
    onRefreshBossGreeting,
    onCopyBossGreeting,
    onCollapseBossGreeting,
}) => {
    const hasSummary = Boolean(analysisResult?.summary?.trim());
    const buttonLabel = isGeneratingBossGreeting
        ? '生成中...'
        : bossGreeting && isBossGreetingOutdated
            ? '重新生成 BOSS 招呼语'
            : '生成 BOSS 招呼语';

    if (!hasSummary) {
        return null;
    }

    return (
        <div className="space-y-2">
            <button
                type="button"
                onClick={onGenerateBossGreeting}
                disabled={isGeneratingBossGreeting}
                className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-emerald-700 transition-colors hover:text-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
                <MessageSquare className={`h-3.5 w-3.5 ${isGeneratingBossGreeting ? 'animate-pulse' : ''}`} />
                {buttonLabel}
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
    );
};

const JDAnalysisPanel: React.FC<JDAnalysisPanelProps> = ({
    jdText,
    analysisResult,
    isAnalyzing,
    isCollapsed,
    onAnalyze,
    onToggleCollapse,
    onJdTextChange,
    jdFile,
    onFileChange,
    hasMissingAttachmentContext,
    bossGreeting,
    isBossGreetingVisible,
    isBossGreetingOutdated,
    isGeneratingBossGreeting,
    onGenerateBossGreeting,
    onRefreshBossGreeting,
    onCopyBossGreeting,
    onCollapseBossGreeting,
    debugInfo,
    showDebugInfo = false,
    isOutdated = false,
}) => {
    const jobKeywords = useMemo(
        () => normalizeJobKeywords(analysisResult?.jobKeywords),
        [analysisResult?.jobKeywords]
    );
    const [isAttachmentDragOver, setIsAttachmentDragOver] = useState(false);
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

    const handleAttachmentDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
        if (isAnalyzing) {
            return;
        }
        const draggedFile = event.dataTransfer.files?.[0];
        if (!draggedFile || !isAcceptedJDAttachmentFile(draggedFile)) {
            return;
        }
        event.preventDefault();
        setIsAttachmentDragOver(true);
    }, [isAnalyzing]);

    const handleAttachmentDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
            return;
        }
        setIsAttachmentDragOver(false);
    }, []);

    const handleAttachmentDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        setIsAttachmentDragOver(false);
        if (isAnalyzing) {
            return;
        }
        const droppedFile = event.dataTransfer.files?.[0];
        if (!droppedFile || !isAcceptedJDAttachmentFile(droppedFile)) {
            return;
        }
        void handleAttachmentSelect(droppedFile);
    }, [handleAttachmentSelect, isAnalyzing]);

    return (
        <div
            className={`${JD_PANEL_STICKY_CLASS} flex flex-col border-b border-border-light bg-gray-50/50 transition-all duration-300 ease-in-out dark:border-border-dark dark:bg-gray-800/30 ${JD_PANEL_BOTTOM_SPACING_CLASS} ${isCollapsed ? 'h-auto py-3' : 'h-auto py-4'}`}
        >
            <div className="mb-2 flex items-center justify-between px-4">
                <h3 className="flex items-center gap-2 text-sm font-bold text-gray-900 dark:text-white">
                    <Target className="h-4 w-4 text-primary" />
                    职位分析 (JD Analysis)
                </h3>
                <button
                    onClick={onToggleCollapse}
                    className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                >
                    {isCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
                </button>
            </div>
            <div className="px-4" id={JD_PANEL_CONTENT_ID}>
                {isCollapsed ? (
                    <div className="space-y-2">
                        <div className="flex items-center gap-3">
                            <div className="flex items-center gap-2">
                                {isOutdated ? (
                                    <span className="inline-flex items-center whitespace-nowrap rounded-full border border-gray-200 bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
                                        待更新
                                    </span>
                                ) : (
                                    <MatchBadge
                                        score={analysisResult?.matchPercentage ?? 0}
                                        trend={analysisResult?.matchTrend}
                                    />
                                )}
                                <button
                                    onClick={onAnalyze}
                                    disabled={isAnalyzing}
                                    className="p-1 text-gray-400 hover:text-emerald-600"
                                >
                                    <RefreshCw className={`h-3 w-3 ${isAnalyzing ? 'animate-spin' : ''}`} />
                                </button>
                            </div>
                            <div className="flex flex-wrap gap-1 overflow-hidden">
                                {jobKeywords.length > 0 ? (
                                    jobKeywords.map((keyword) => (
                                        <span
                                            key={keyword}
                                            className="rounded bg-gray-100 px-2 py-1 text-[11.5px] text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                                        >
                                            {keyword}
                                        </span>
                                    ))
                                ) : (
                                    <span className="rounded bg-gray-100 px-2 py-1 text-[11.5px] text-gray-400 dark:bg-gray-800">
                                        暂无关键词
                                    </span>
                                )}
                            </div>
                        </div>
                        {analysisResult?.summary ? (
                            <div className="space-y-2">
                                <p className="text-[11.5px] leading-relaxed text-emerald-800 dark:text-emerald-300/80">
                                    {analysisResult.summary}
                                </p>
                                <BossGreetingSection
                                    analysisResult={analysisResult}
                                    bossGreeting={bossGreeting}
                                    isBossGreetingVisible={isBossGreetingVisible}
                                    isBossGreetingOutdated={isBossGreetingOutdated}
                                    isGeneratingBossGreeting={isGeneratingBossGreeting}
                                    onGenerateBossGreeting={onGenerateBossGreeting}
                                    onRefreshBossGreeting={onRefreshBossGreeting}
                                    onCopyBossGreeting={onCopyBossGreeting}
                                    onCollapseBossGreeting={onCollapseBossGreeting}
                                />
                            </div>
                        ) : null}
                    </div>
                ) : (
                    <div className="animate-in space-y-3 fade-in slide-in-from-top-2">
                        <div
                            className={[
                                'relative rounded-xl border bg-white/90 p-2 shadow-sm transition-colors dark:bg-gray-900/80',
                                isAttachmentDragOver
                                    ? 'border-emerald-300 bg-emerald-50/70 dark:border-emerald-700 dark:bg-emerald-900/20'
                                    : 'border-border-light dark:border-border-dark',
                            ].join(' ')}
                            onDragOver={handleAttachmentDragOver}
                            onDragLeave={handleAttachmentDragLeave}
                            onDrop={handleAttachmentDrop}
                        >
                            <textarea
                                className="h-28 w-full resize-none rounded-lg border border-transparent bg-transparent p-3 pr-28 text-sm text-gray-700 outline-none transition placeholder:text-gray-400 focus:border-primary/20 focus:ring-2 focus:ring-primary/20 dark:text-gray-300 dark:placeholder:text-gray-600"
                                placeholder={jdFile
                                    ? '可选：补充手动输入的 JD 说明；分析成功后会自动转成文本版 JD。'
                                    : '在此粘贴职位要求，或直接粘贴截图 / 拖入图片、PDF、DOCX...'}
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
                                    onClick={onAnalyze}
                                    disabled={isAnalyzing || (!hasMissingAttachmentContext && !jdFile && !jdText.trim())}
                                    className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-[11.5px] font-bold text-white shadow transition-colors hover:bg-primary-dark disabled:opacity-60"
                                >
                                    <Wand2 className="h-3 w-3" />
                                    {isAnalyzing ? '分析中...' : '开始分析'}
                                </button>
                            </div>
                            {isAttachmentDragOver ? (
                                <div className="pointer-events-none absolute inset-2 flex items-center justify-center rounded-lg border border-dashed border-emerald-300 bg-emerald-50/70 text-xs font-medium text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300">
                                    松开以上传为 JD 附件
                                </div>
                            ) : null}
                        </div>
                        {jdFile ? (
                            <JDAttachmentPreview
                                file={jdFile}
                                onClear={() => onFileChange(null)}
                                disabled={isAnalyzing}
                            />
                        ) : (
                            <p className="text-[11px] leading-5 text-gray-400 dark:text-gray-500">
                                支持点击附件图标、拖拽文件到文本框，或直接在文本框里粘贴图片。{hasMissingAttachmentContext ? ' 当前缓存依赖的附件已丢失，重新上传后可继续更新分析。' : ''}
                            </p>
                        )}
                        {analysisResult ? (
                            <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-3 dark:border-emerald-800/30 dark:bg-emerald-900/10">
                                <div className="mb-2 flex items-center justify-between gap-3">
                                    <MatchBadge
                                        score={analysisResult.matchPercentage ?? 0}
                                        trend={analysisResult.matchTrend}
                                    />
                                    <span className="text-[11.5px] text-emerald-600/80">
                                        Missing: {(analysisResult.missingKeywords || []).join(', ')}
                                    </span>
                                </div>
                                <div className="space-y-2">
                                    <p className="text-[11.5px] leading-relaxed text-emerald-800 dark:text-emerald-300/80">
                                        {analysisResult.summary}
                                    </p>
                                    <BossGreetingSection
                                        analysisResult={analysisResult}
                                        bossGreeting={bossGreeting}
                                        isBossGreetingVisible={isBossGreetingVisible}
                                        isBossGreetingOutdated={isBossGreetingOutdated}
                                        isGeneratingBossGreeting={isGeneratingBossGreeting}
                                        onGenerateBossGreeting={onGenerateBossGreeting}
                                        onRefreshBossGreeting={onRefreshBossGreeting}
                                        onCopyBossGreeting={onCopyBossGreeting}
                                        onCollapseBossGreeting={onCollapseBossGreeting}
                                    />
                                </div>
                            </div>
                        ) : null}
                    </div>
                )}
                {showDebugInfo && debugInfo ? (
                    <div className="mt-2 overflow-x-auto whitespace-pre-wrap rounded bg-red-50 p-2 font-mono text-[10px] text-red-600 dark:bg-red-900/20 dark:text-red-400">
                        <strong>Debug Info:</strong>
                        {JSON.stringify(debugInfo, null, 2)}
                    </div>
                ) : null}
            </div>
        </div>
    );
};

export default JDAnalysisPanel;
