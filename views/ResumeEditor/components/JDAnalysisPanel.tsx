import React, { useMemo } from 'react';
import { ChevronDown, ChevronUp, RefreshCw, Target, Wand2 } from 'lucide-react';
import type { JDAnalysisResult } from '../../../services/aiService';
import { JD_PANEL_BOTTOM_SPACING_CLASS, JD_PANEL_STICKY_CLASS } from '../constants';
import { normalizeJobKeywords } from '../helpers';
import { MatchBadge } from './Badges';

const JD_PANEL_CONTENT_ID = 'jd-analysis-panel-content';

type JDAnalysisPanelProps = {
    jdText: string;
    analysisResult: JDAnalysisResult | null;
    isAnalyzing: boolean;
    isCollapsed: boolean;
    onAnalyze: () => void;
    onToggleCollapse: () => void;

    onJdTextChange: (value: string) => void;
    debugInfo?: any;
    showDebugInfo?: boolean;
    isOutdated?: boolean;
};

const JDAnalysisPanel: React.FC<JDAnalysisPanelProps> = ({
    jdText,
    analysisResult,
    isAnalyzing,
    isCollapsed,
    onAnalyze,
    onToggleCollapse,

    onJdTextChange,
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
                            <p className="text-[11.5px] text-emerald-800 dark:text-emerald-300/80 leading-relaxed">
                                {analysisResult.summary}
                            </p>
                        ) : null}
                    </div>
                ) : (
                    <div className="space-y-3 animate-in fade-in slide-in-from-top-2">
                        <div className="relative group">
                            <textarea
                                className="w-full h-24 p-3 text-sm bg-white dark:bg-gray-900 border border-border-light dark:border-border-dark rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent resize-none text-gray-700 dark:text-gray-300 placeholder-gray-400 dark:placeholder-gray-600 shadow-sm"
                                placeholder="在此粘贴职位要求 (Job Description)..."
                                value={jdText}
                                onChange={(e) => onJdTextChange(e.target.value)}
                            />
                            <button
                                onClick={onAnalyze}
                                disabled={isAnalyzing}
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
                                <p className="text-[11.5px] text-emerald-800 dark:text-emerald-300/80 leading-relaxed">
                                    {analysisResult.summary}
                                </p>
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
