import React, { useMemo } from 'react';
import { ChevronDown, ChevronUp, Copy, MessageSquare, RefreshCw, Target, Wand2 } from 'lucide-react';
import type { JDAnalysisResult } from '../../../services/aiService';
import { JD_PANEL_BOTTOM_SPACING_CLASS, JD_PANEL_STICKY_CLASS } from '../constants';
import { normalizeJobKeywords } from '../helpers';
import { MatchBadge } from './Badges';
import JDAttachmentUploader from './JDAttachmentUploader';

const JD_PANEL_CONTENT_ID = 'jd-analysis-panel-content';

type JDAnalysisPanelProps = {
    jdText: string;
    analysisResult: JDAnalysisResult | null;
    isAnalyzing: boolean;
    isCollapsed: boolean;
    onAnalyze: () => void;
    onToggleCollapse: () => void;

    onJdTextChange: (value: string) => void;
    /** 当前已选的 JD 附件，null 为文字模式 */
    jdFile: File | null;
    /** 附件选取 / 清除回调 */
    onFileChange: (file: File | null) => void;
    /** 当前分析是否依赖一个已丢失的附件 */
    hasMissingAttachmentContext: boolean;
    bossGreeting: string;
    isBossGreetingVisible: boolean;
    isBossGreetingOutdated: boolean;
    isGeneratingBossGreeting: boolean;
    onGenerateBossGreeting: () => void;
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
                <MessageSquare className={`w-3.5 h-3.5 ${isGeneratingBossGreeting ? 'animate-pulse' : ''}`} />
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
                        <button
                            type="button"
                            onClick={onCollapseBossGreeting}
                            className="text-[11px] text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-200"
                        >
                            收起
                        </button>
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
                            <Copy className="w-3 h-3" />
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

    const handleToggleKeyDown = (event: React.KeyboardEvent<HTMLHeadingElement>) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onToggleCollapse();
        }
    };

    return (
        <div
            className={`${JD_PANEL_STICKY_CLASS} border-b border-border-light dark:border-border-dark bg-gray-50/50 dark:bg-gray-800/30 transition-all duration-300 ease-in-out flex flex-col ${JD_PANEL_BOTTOM_SPACING_CLASS} ${isCollapsed ? 'h-auto py-3' : 'h-auto py-4'}`}
        >
            <div className="px-4 flex items-center justify-between mb-2">
                <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
                    <Target className="w-4 h-4 text-primary" />
                    职位分析 (JD Analysis)
                </h3>
                <button
                    onClick={onToggleCollapse}
                    className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                >
                    {isCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                </button>
            </div>
            <div className="px-4" id={JD_PANEL_CONTENT_ID}>
                {isCollapsed ? (
                    <div className="space-y-2">
                        <div className="flex items-center gap-3">
                            <div className="flex items-center gap-2">
                                {isOutdated ? (
                                    <span className="inline-flex items-center whitespace-nowrap text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 border border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700">
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
                                    <RefreshCw className={`w-3 h-3 ${isAnalyzing ? 'animate-spin' : ''}`} />
                                </button>
                            </div>
                            <div className="flex flex-wrap gap-1 overflow-hidden">
                                {jobKeywords.length > 0 ? (
                                    jobKeywords.map((keyword) => (
                                        <span
                                            key={keyword}
                                            className="text-[11.5px] px-2 py-1 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 rounded"
                                        >
                                            {keyword}
                                        </span>
                                    ))
                                ) : (
                                    <span className="text-[11.5px] px-2 py-1 bg-gray-100 dark:bg-gray-800 text-gray-400 rounded">
                                        暂无关键词
                                    </span>
                                )}
                            </div>
                        </div>
                        {analysisResult?.summary ? (
                            <div className="space-y-2">
                                <p className="text-[11.5px] text-emerald-800 dark:text-emerald-300/80 leading-relaxed">
                                    {analysisResult.summary}
                                </p>
                                <BossGreetingSection
                                    analysisResult={analysisResult}
                                    bossGreeting={bossGreeting}
                                    isBossGreetingVisible={isBossGreetingVisible}
                                    isBossGreetingOutdated={isBossGreetingOutdated}
                                    isGeneratingBossGreeting={isGeneratingBossGreeting}
                                    onGenerateBossGreeting={onGenerateBossGreeting}
                                    onCopyBossGreeting={onCopyBossGreeting}
                                    onCollapseBossGreeting={onCollapseBossGreeting}
                                />
                            </div>
                        ) : null}
                    </div>
                ) : (
                    <div className="space-y-3 animate-in fade-in slide-in-from-top-2">
                        {/* 附件上传入口 */}
                        <JDAttachmentUploader
                            file={jdFile}
                            onFileChange={onFileChange}
                            disabled={isAnalyzing}
                        />
                        <div className="relative group">
                            <textarea
                                className="w-full h-24 p-3 text-sm bg-white dark:bg-gray-900 border border-border-light dark:border-border-dark rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent resize-none text-gray-700 dark:text-gray-300 placeholder-gray-400 dark:placeholder-gray-600 shadow-sm"
                                placeholder={jdFile
                                    ? '可选：补充手动输入的 JD 文字说明...'
                                    : '在此粘贴职位要求 (Job Description)...'}
                                value={jdText}
                                onChange={(e) => onJdTextChange(e.target.value)}
                            />
                            <button
                                onClick={onAnalyze}
                                disabled={isAnalyzing || (!hasMissingAttachmentContext && !jdFile && !jdText.trim())}
                                className="absolute bottom-2 right-2 p-1.5 bg-primary text-white rounded-md shadow hover:bg-primary-dark transition-colors flex items-center gap-1 text-[11.5px] font-bold px-2 disabled:opacity-60"
                            >
                                <Wand2 className="w-3 h-3" />
                                {isAnalyzing ? '分析中...' : '开始分析'}
                            </button>
                        </div>
                        {analysisResult ? (
                            <div className="bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-100 dark:border-emerald-800/30 rounded-lg p-3">
                                <div className="flex justify-between items-center mb-2">
                                    <MatchBadge
                                        score={analysisResult.matchPercentage ?? 0}
                                        trend={analysisResult.matchTrend}
                                    />
                                    <span className="text-[11.5px] text-emerald-600/80">
                                        Missing: {(analysisResult.missingKeywords || []).join(', ')}
                                    </span>
                                </div>
                                <div className="space-y-2">
                                    <p className="text-[11.5px] text-emerald-800 dark:text-emerald-300/80 leading-relaxed">
                                        {analysisResult.summary}
                                    </p>
                                    <BossGreetingSection
                                        analysisResult={analysisResult}
                                        bossGreeting={bossGreeting}
                                        isBossGreetingVisible={isBossGreetingVisible}
                                        isBossGreetingOutdated={isBossGreetingOutdated}
                                        isGeneratingBossGreeting={isGeneratingBossGreeting}
                                        onGenerateBossGreeting={onGenerateBossGreeting}
                                        onCopyBossGreeting={onCopyBossGreeting}
                                        onCollapseBossGreeting={onCollapseBossGreeting}
                                    />
                                </div>
                            </div>
                        ) : null}
                    </div>
                )}
                {showDebugInfo && debugInfo && (
                    <div className="mt-2 p-2 bg-red-50 dark:bg-red-900/20 text-[10px] text-red-600 dark:text-red-400 font-mono overflow-x-auto whitespace-pre-wrap rounded">
                        <strong>Debug Info:</strong>
                        {JSON.stringify(debugInfo, null, 2)}
                    </div>
                )}
            </div>
        </div>
    );
};

export default JDAnalysisPanel;
