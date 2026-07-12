import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    AlertTriangle,
    Award,
    Check,
    ChevronDown,
    ChevronUp,
    Compass,
    Copy,
    MessageSquare,
    RefreshCw,
    Search,
    Target,
    Wand2,
    X,
} from 'lucide-react';
import type { JDAnalysisResult, JDCoreCapability, JDInterpretation } from '../../../services/aiService';
import { JD_PANEL_BOTTOM_SPACING_CLASS, JD_PANEL_STICKY_CLASS } from '../constants';
import { MatchBadge } from './Badges';
import {
    buildAgentSearchPrompt,
    buildProfileTags,
    clampConfidence,
    clampPercent,
    copyTextToClipboard,
    formatSearchQueryLine,
    getArray,
    getCapabilityFollowUpQuestions,
    getCapabilityRiskTone,
    getText,
    normalizeSearchQueries,
    normalizeStrategyTitles,
    type RequirementItem,
} from './JDAnalysisPanel/analysisUtils';
import JDAttachmentUploader, {
    JDAttachmentPreview,
} from './JDAttachmentUploader';
import { isAcceptedJDAttachmentFile } from '../../../utils/jdAttachment';
import { useJDAnalysisMotion } from './jdAnalysisMotion';

const JD_PANEL_CONTENT_ID = 'jd-analysis-panel-content';
const Pill: React.FC<{ children: React.ReactNode; tone?: 'emerald' | 'slate' | 'amber' }> = ({
    children,
    tone = 'slate',
}) => {
    const toneClass = tone === 'emerald'
        ? 'border-emerald-100/80 bg-emerald-50/80 text-emerald-700 dark:border-emerald-800/40 dark:bg-emerald-950/30 dark:text-emerald-300 shadow-[0_1px_2px_rgba(16,185,129,0.05)]'
        : tone === 'amber'
            ? 'border-amber-100/80 bg-amber-50/80 text-amber-700 dark:border-amber-800/40 dark:bg-amber-950/30 dark:text-amber-300 shadow-[0_1px_2px_rgba(245,158,11,0.05)]'
            : 'border-gray-200/80 bg-gray-50/60 text-gray-600 dark:border-gray-800/60 dark:bg-gray-900/40 dark:text-gray-400 shadow-[0_1px_2px_rgba(0,0,0,0.02)]';
    return (
        <span className={`inline-flex max-w-full items-center rounded-lg border px-2 py-1 text-[11px] font-medium leading-tight backdrop-blur-[1px] transition-all duration-200 hover:scale-[1.03] hover:shadow-sm select-none cursor-default ${toneClass}`}>
            {children}
        </span>
    );
};

type StrategyCopyStatus = 'idle' | 'copied' | 'error';

type SameTypeJobStrategyCardProps = {
    interpretation?: JDInterpretation;
    analysisResult: JDAnalysisResult;
    jdText: string;
    copyStatus: StrategyCopyStatus;
    manualCopyText: string;
    onCopyText: (text: string, mode: 'queries' | 'agent') => void;
};

const SameTypeJobStrategyCard: React.FC<SameTypeJobStrategyCardProps> = ({
    interpretation,
    analysisResult,
    jdText,
    copyStatus,
    manualCopyText,
    onCopyText,
}) => {
    const strategy = interpretation?.sameTypeJobStrategy;
    const recommendedTitles = normalizeStrategyTitles(strategy?.recommendedTitles);
    const searchQueries = normalizeSearchQueries(strategy?.searchQueries);
    const avoidTitles = normalizeStrategyTitles(strategy?.avoidTitles);
    const queryText = searchQueries
        .map(formatSearchQueryLine)
        .join('\n');
    const hasStrategy = recommendedTitles.length > 0 || searchQueries.length > 0 || avoidTitles.length > 0;

    return (
        <div className="rounded-xl border border-indigo-100/50 bg-gradient-to-br from-indigo-50/50 via-violet-50/15 to-transparent p-4 shadow-[0_8px_30px_rgba(99,102,241,0.03)] dark:border-indigo-900/30 dark:from-indigo-950/20 dark:via-violet-950/5 dark:to-transparent">
            <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-1.5 text-indigo-900 dark:text-indigo-100">
                    <Compass className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                    <h4 className="text-[12px] font-bold">
                        可同时投递的岗位方向
                    </h4>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                    <button
                        type="button"
                        onClick={() => onCopyText(queryText, 'queries')}
                        disabled={!queryText}
                        className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-white px-2.5 py-1 text-[10.5px] font-semibold text-indigo-700 shadow-sm transition hover:bg-indigo-50/70 disabled:cursor-not-allowed disabled:opacity-50 dark:border-indigo-800 dark:bg-gray-900 dark:text-indigo-200 dark:hover:bg-indigo-950/30"
                    >
                        <Copy className="h-3 w-3" />
                        复制搜索词
                    </button>
                    <button
                        type="button"
                        onClick={() => onCopyText(buildAgentSearchPrompt(analysisResult, jdText), 'agent')}
                        disabled={!hasStrategy}
                        className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1 text-[10.5px] font-bold text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        <Search className="h-3 w-3" />
                        让 Agent 搜同类岗位
                    </button>
                </div>
            </div>
            {copyStatus !== 'idle' ? (
                <p className={`mb-3 inline-flex items-center gap-1 text-[10.5px] font-medium ${copyStatus === 'copied' ? 'text-indigo-700 dark:text-indigo-200' : 'text-red-600 dark:text-red-400'}`}>
                    {copyStatus === 'copied' ? <Check className="h-3 w-3" /> : null}
                    {copyStatus === 'copied' ? '已复制，可交给 Agent 或岗位网站搜索框使用' : '复制失败，请从下方手动复制'}
                </p>
            ) : null}
            {copyStatus === 'error' && manualCopyText ? (
                <textarea
                    readOnly
                    value={manualCopyText}
                    className="mb-3 h-28 w-full resize-none rounded-lg border border-red-200 bg-white/90 p-2.5 text-[11px] leading-relaxed text-gray-800 outline-none focus:border-red-300 focus:ring-2 focus:ring-red-100 dark:border-red-900/60 dark:bg-gray-950 dark:text-gray-100 dark:focus:ring-red-950/40"
                    aria-label="手动复制同类岗位搜索内容"
                    onFocus={(event) => event.currentTarget.select()}
                />
            ) : null}
            <div className="space-y-3.5">
                <div className="space-y-1.5">
                    <p className="text-[11px] font-bold tracking-wider text-gray-400/90 dark:text-gray-500/90 uppercase">
                        强推荐同投
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                        {recommendedTitles.length > 0 ? (
                            recommendedTitles.slice(0, 8).map((item) => (
                                <Pill key={`${item.title}-${item.reason}`} tone="emerald">
                                    {item.title}
                                    {typeof item.confidence === 'number' ? ` ${clampConfidence(item.confidence)}%` : ''}
                                </Pill>
                            ))
                        ) : (
                            <span className="text-[11px] text-indigo-500 dark:text-indigo-300">
                                刷新分析后生成同类岗位方向
                            </span>
                        )}
                    </div>
                </div>
                {searchQueries.length > 0 ? (
                    <div className="space-y-1.5">
                        <p className="text-[11px] font-bold tracking-wider text-gray-400/90 dark:text-gray-500/90 uppercase">
                            搜索词
                        </p>
                        <div className="space-y-2">
                            {searchQueries.slice(0, 4).map((item) => (
                                <div
                                    key={`${item.label}-${item.query}`}
                                    className="group rounded-r-lg border-l-2 border-indigo-500 bg-white/60 p-2.5 text-[11px] leading-relaxed text-indigo-950 shadow-[0_1px_2px_rgba(99,102,241,0.02)] transition-all duration-200 hover:bg-white dark:border-indigo-900/30 dark:bg-gray-900/50 dark:text-indigo-100 dark:hover:bg-gray-900"
                                >
                                    <span className="font-semibold">{item.label}：</span>
                                    <span>{item.query}</span>
                                    {item.excludeKeywords?.length ? (
                                        <span className="text-indigo-700/70 dark:text-indigo-300/75">
                                            {' '}排除：{item.excludeKeywords.join('、')}
                                        </span>
                                    ) : null}
                                </div>
                            ))}
                        </div>
                    </div>
                ) : null}
                {avoidTitles.length > 0 ? (
                    <div className="space-y-1.5">
                        <p className="text-[11px] font-bold tracking-wider text-gray-400/90 dark:text-gray-500/90 uppercase">
                            不建议混投
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                            {avoidTitles.slice(0, 6).map((item) => (
                                <Pill key={`${item.title}-${item.reason}`} tone="amber">
                                    {item.title}
                                </Pill>
                            ))}
                        </div>
                    </div>
                ) : null}
            </div>
        </div>
    );
};

type JDInterpretationCardProps = {
    analysisResult: JDAnalysisResult;
};

const EVIDENCE_LEVEL_LABELS: Record<JDCoreCapability['resumeEvidenceLevel'], string> = {
    0: '无证据',
    1: '仅关键词',
    2: '有动作',
    3: '动作+产出',
    4: '决策+验证',
};

const RISK_LABELS: Record<JDCoreCapability['risk'], string> = {
    none: '证据充分',
    weak_evidence: '证据偏弱',
    keyword_only: '只有关键词',
    missing: '缺失',
    mispositioned: '定位错位',
};

const SCORE_CONFIDENCE_LABELS = {
    high: '高',
    medium: '中',
    low: '低',
} as const;

const JDInterpretationCard: React.FC<JDInterpretationCardProps> = ({ analysisResult }) => {
    const interpretation = analysisResult.jdInterpretation;
    const profileTags = buildProfileTags(interpretation);
    const coreResponsibilities = getArray<RequirementItem>(interpretation?.coreResponsibilities);
    const mustHave = getArray<RequirementItem>(interpretation?.mustHave);
    const hardFilters = getArray<RequirementItem>(interpretation?.hardFilters);
    const missingKeywords = getArray(analysisResult.missingKeywords);

    return (
        <div className="rounded-xl border border-emerald-100/50 bg-gradient-to-br from-emerald-50/50 via-teal-50/15 to-transparent p-4 shadow-[0_8px_30px_rgba(16,185,129,0.03)] dark:border-emerald-900/30 dark:from-emerald-950/20 dark:via-teal-950/5 dark:to-transparent">
            <div className="mb-3.5 flex items-center justify-between gap-3">
                <MatchBadge
                    score={analysisResult.matchPercentage ?? 0}
                    trend={analysisResult.matchTrend}
                    variant="solid"
                    className="border border-emerald-200/40 shadow-sm transition-all duration-300 hover:scale-105"
                />
                <div className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-300">
                    <Target className="h-3.5 w-3.5" />
                    <span className="text-[12px] font-bold tracking-wide uppercase">
                        JD 解读
                    </span>
                </div>
            </div>
            <div className="space-y-4">
                <div className="space-y-1.5">
                    <p className="text-[11px] font-bold tracking-wider text-gray-400/90 dark:text-gray-500/90 uppercase">
                        岗位画像
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                        {profileTags.length > 0 ? (
                            profileTags.map((tag) => <Pill key={tag} tone="emerald">{tag}</Pill>)
                        ) : (
                            <span className="text-[11.5px] text-emerald-700 dark:text-emerald-300">
                                刷新分析后生成岗位画像
                            </span>
                        )}
                    </div>
                </div>
                <div className="space-y-1.5">
                    <p className="text-[11px] font-bold tracking-wider text-gray-400/90 dark:text-gray-500/90 uppercase">
                        JD 真实诉求
                    </p>
                    <div className="relative rounded-r-lg border-l-2 border-emerald-500/60 bg-emerald-50/20 px-3 py-2 text-[11.5px] leading-relaxed text-emerald-900/90 dark:bg-emerald-950/10 dark:text-emerald-200/90">
                        {getText(interpretation?.roleIntent) || analysisResult.summary || '暂无解读，重新分析后会补齐岗位真实诉求。'}
                    </div>
                </div>
                {(coreResponsibilities.length > 0 || mustHave.length > 0) ? (
                    <div className="space-y-2">
                        <p className="text-[11px] font-bold tracking-wider text-gray-400/90 dark:text-gray-500/90 uppercase">
                            核心要求
                        </p>
                        <div className="space-y-2">
                            {[...coreResponsibilities.slice(0, 3), ...mustHave.slice(0, 3)]
                                .slice(0, 5)
                                .map((item) => (
                                    <div
                                        key={`${item.label}-${item.evidence}`}
                                        className="group flex flex-col rounded-lg border border-emerald-100/50 bg-white/60 p-2.5 text-[11.5px] leading-relaxed text-emerald-950 shadow-[0_1px_2px_rgba(16,185,129,0.02)] transition-all duration-200 hover:bg-white dark:border-emerald-900/30 dark:bg-gray-900/50 dark:text-emerald-100 dark:hover:bg-gray-900"
                                    >
                                        <div className="flex items-start gap-1.5 font-semibold text-emerald-900 dark:text-emerald-100">
                                            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                                            <span>{item.label}</span>
                                        </div>
                                        {item.evidence ? (
                                            <p className="mt-1 border-l border-emerald-100/80 pl-3 text-[11px] leading-relaxed text-emerald-700/80 dark:border-emerald-800/40 dark:text-emerald-300/80">
                                                {item.evidence}
                                            </p>
                                        ) : null}
                                    </div>
                                ))}
                        </div>
                    </div>
                ) : null}
                {hardFilters.length > 0 ? (
                    <div className="space-y-1.5">
                        <p className="text-[11px] font-bold tracking-wider text-gray-400/90 dark:text-gray-500/90 uppercase">
                            硬门槛
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                            {hardFilters.slice(0, 4).map((item) => (
                                <Pill key={`${item.label}-${item.evidence}`} tone="amber">
                                    {item.label}
                                </Pill>
                            ))}
                        </div>
                    </div>
                ) : null}
                {missingKeywords.length > 0 ? (
                    <details className="group">
                        <summary className="flex cursor-pointer list-none items-center gap-1 text-[11px] font-semibold text-emerald-700/80 transition hover:text-emerald-800 dark:text-emerald-300/80 dark:hover:text-emerald-200 [&::-webkit-details-marker]:hidden">
                            <span>查看底层关键词缺口</span>
                            <ChevronDown className="h-3 w-3 transition-transform duration-200 group-open:rotate-180" />
                        </summary>
                        <div className="mt-2 flex flex-wrap gap-1.5 rounded-lg border border-dashed border-emerald-100/80 bg-emerald-50/20 p-2.5 dark:border-emerald-900/40 dark:bg-emerald-950/5">
                            {missingKeywords.map((kw) => {
                                const kwStr = String(kw);
                                return (
                                    <span
                                        key={kwStr}
                                        className="inline-flex items-center rounded bg-rose-50/50 px-1.5 py-0.5 text-[10px] font-medium text-rose-600 dark:bg-rose-950/25 dark:text-rose-400"
                                    >
                                        {kwStr}
                                    </span>
                                );
                            })}
                        </div>
                    </details>
                ) : null}
            </div>
        </div>
    );
};

type JDAnalysisPanelProps = {
    jdText: string;
    analysisResult: JDAnalysisResult | null;
    isAnalyzing: boolean;
    isCollapsed: boolean;
    onAnalyze: () => void;
    onToggleCollapse: () => void;
    onJdTextChange: (value: string) => void;
    jdFile: File | null;
    onFileSelect: (file: File) => Promise<void>;
    onFileClear: () => void;
    hasMissingAttachmentContext: boolean;
    bossGreeting: string;
    isBossGreetingVisible: boolean;
    isBossGreetingOutdated: boolean;
    isGeneratingBossGreeting: boolean;
    onGenerateBossGreeting: () => void;
    onRefreshBossGreeting: () => void;
    onCopyBossGreeting: () => void;
    onCollapseBossGreeting: () => void;
    onOpenAgentPluginConfig?: () => void;
    debugInfo?: any;
    showDebugInfo?: boolean;
    isOutdated?: boolean;
    thinkingText?: string;
    onStopAnalyze?: () => void;
    onOpenDetailsSidebar?: () => void;
};

type JDAnalysisDetailsModalProps = {
    isOpen: boolean;
    analysisResult: JDAnalysisResult | null;
    jdText: string;
    copyStatus: StrategyCopyStatus;
    manualCopyText: string;
    onCopyText: (text: string, mode: 'queries' | 'agent') => void;
    onClose: () => void;
};

const useJDStrategyCopyState = (onOpenAgentPluginConfig?: () => void) => {
    const [strategyCopyStatus, setStrategyCopyStatus] = useState<StrategyCopyStatus>('idle');
    const [manualStrategyCopyText, setManualStrategyCopyText] = useState('');
    const copyStatusResetTimerRef = useRef<number | null>(null);
    const copyRequestVersionRef = useRef(0);

    const clearCopyStatusResetTimer = useCallback(() => {
        if (copyStatusResetTimerRef.current !== null) {
            window.clearTimeout(copyStatusResetTimerRef.current);
            copyStatusResetTimerRef.current = null;
        }
    }, []);

    useEffect(() => clearCopyStatusResetTimer, [clearCopyStatusResetTimer]);

    const resetStrategyCopyState = useCallback(() => {
        copyRequestVersionRef.current += 1;
        clearCopyStatusResetTimer();
        setStrategyCopyStatus('idle');
        setManualStrategyCopyText('');
    }, [clearCopyStatusResetTimer]);

    const handleCopyStrategyText = useCallback(async (text: string, mode: 'queries' | 'agent') => {
        if (!text.trim()) {
            return;
        }
        const requestVersion = copyRequestVersionRef.current + 1;
        copyRequestVersionRef.current = requestVersion;
        clearCopyStatusResetTimer();
        let shouldAutoResetStatus = false;
        try {
            await copyTextToClipboard(text);
            if (copyRequestVersionRef.current !== requestVersion) {
                return;
            }
            setStrategyCopyStatus('copied');
            setManualStrategyCopyText('');
            shouldAutoResetStatus = true;
        } catch (error) {
            if (copyRequestVersionRef.current !== requestVersion) {
                return;
            }
            console.error('[JDAnalysisPanel] 复制同投策略失败:', error);
            setStrategyCopyStatus('error');
            setManualStrategyCopyText(text);
        }
        if (mode === 'agent') {
            onOpenAgentPluginConfig?.();
        }
        if (shouldAutoResetStatus) {
            copyStatusResetTimerRef.current = window.setTimeout(() => {
                setStrategyCopyStatus('idle');
                copyStatusResetTimerRef.current = null;
            }, 2200);
        }
    }, [clearCopyStatusResetTimer, onOpenAgentPluginConfig]);

    return {
        strategyCopyStatus,
        manualStrategyCopyText,
        handleCopyStrategyText,
        resetStrategyCopyState,
    };
};

type JDAnalysisDetailsContentProps = {
    analysisResult: JDAnalysisResult;
    jdText: string;
    copyStatus: StrategyCopyStatus;
    manualCopyText: string;
    onCopyText: (text: string, mode: 'queries' | 'agent') => void;
};

const JDAnalysisDetailsContent: React.FC<JDAnalysisDetailsContentProps> = ({
    analysisResult,
    jdText,
    copyStatus,
    manualCopyText,
    onCopyText,
}) => (
    <div className="space-y-4">
        <JDInterpretationCard analysisResult={analysisResult} />
        <CapabilityEvidenceCard analysisResult={analysisResult} />
        <SameTypeJobStrategyCard
            interpretation={analysisResult.jdInterpretation}
            analysisResult={analysisResult}
            jdText={jdText}
            copyStatus={copyStatus}
            manualCopyText={manualCopyText}
            onCopyText={onCopyText}
        />
    </div>
);

type JDAnalysisDetailsSidebarProps = {
    analysisResult: JDAnalysisResult | null;
    jdText: string;
    onClose: () => void;
    onOpenAgentPluginConfig?: () => void;
};

export const JDAnalysisDetailsSidebar: React.FC<JDAnalysisDetailsSidebarProps> = ({
    analysisResult,
    jdText,
    onClose,
    onOpenAgentPluginConfig,
}) => {
    const {
        strategyCopyStatus,
        manualStrategyCopyText,
        handleCopyStrategyText,
        resetStrategyCopyState,
    } = useJDStrategyCopyState(onOpenAgentPluginConfig);

    const handleClose = useCallback(() => {
        resetStrategyCopyState();
        onClose();
    }, [onClose, resetStrategyCopyState]);

    if (!analysisResult) {
        return null;
    }

    return (
        <section
            className="flex h-full min-h-0 w-full flex-col bg-white dark:bg-slate-950"
            aria-labelledby="jd-analysis-details-sidebar-title"
        >
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-800">
                <div className="min-w-0">
                    <h3 id="jd-analysis-details-sidebar-title" className="truncate text-sm font-bold text-gray-950 dark:text-white">
                        JD 分析详情
                    </h3>
                    <p className="mt-1 truncate text-[11.5px] text-gray-500 dark:text-gray-400">
                        {getText(analysisResult.jdInterpretation?.normalizedTitle)
                            || getText(analysisResult.jobTitle)
                            || '岗位画像与同投策略'}
                    </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                    <button
                        type="button"
                        onClick={handleClose}
                        aria-label="关闭 JD 分析详情"
                        className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-100"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
                <JDAnalysisDetailsContent
                    analysisResult={analysisResult}
                    jdText={jdText}
                    copyStatus={strategyCopyStatus}
                    manualCopyText={manualStrategyCopyText}
                    onCopyText={handleCopyStrategyText}
                />
            </div>
        </section>
    );
};

const JDAnalysisDetailsModal: React.FC<JDAnalysisDetailsModalProps> = ({
    isOpen,
    analysisResult,
    jdText,
    copyStatus,
    manualCopyText,
    onCopyText,
    onClose,
}) => {
    if (!isOpen || !analysisResult) {
        return null;
    }

    return (
        <div
            className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-950/45 px-4 py-6 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="jd-analysis-details-title"
            onClick={onClose}
        >
            <div
                className="flex max-h-[min(760px,calc(100vh-48px))] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-950"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="flex shrink-0 items-center justify-between gap-4 border-b border-gray-200 px-5 py-4 dark:border-gray-800">
                    <div className="min-w-0">
                        <h3 id="jd-analysis-details-title" className="truncate text-base font-bold text-gray-950 dark:text-white">
                            JD 分析详情
                        </h3>
                        <p className="mt-1 truncate text-[12px] text-gray-500 dark:text-gray-400">
                            {getText(analysisResult.jdInterpretation?.normalizedTitle)
                                || getText(analysisResult.jobTitle)
                                || '岗位画像与同投策略'}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="关闭 JD 分析详情"
                        className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-100"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                    <JDAnalysisDetailsContent
                        analysisResult={analysisResult}
                        jdText={jdText}
                        copyStatus={copyStatus}
                        manualCopyText={manualCopyText}
                        onCopyText={onCopyText}
                    />
                </div>
            </div>
        </div>
    );
};

type CapabilityEvidenceCardProps = {
    analysisResult: JDAnalysisResult;
    compact?: boolean;
};

const CapabilityFollowUpCommentLine: React.FC<{
    analysisResult: JDAnalysisResult;
    limit?: number;
}> = ({ analysisResult, limit = 1 }) => {
    const capabilities = getArray<JDCoreCapability>(analysisResult.capabilityAnalysis?.coreCapabilities);
    const followUpQuestions = getCapabilityFollowUpQuestions(capabilities);

    if (followUpQuestions.length === 0) {
        return null;
    }

    return (
        <span className="mt-1 block text-amber-800 dark:text-amber-200">
            建议补充：{followUpQuestions.slice(0, limit).join('；')}
        </span>
    );
};

const CapabilityEvidenceCard: React.FC<CapabilityEvidenceCardProps> = ({
    analysisResult,
    compact = false,
}) => {
    const analysis = analysisResult.capabilityAnalysis;
    if (!analysis) {
        return null;
    }
    const completeness = clampPercent(analysis.overallEvidenceCompleteness);
    const capabilities = getArray<JDCoreCapability>(analysis.coreCapabilities);
    const warningText = getArray<string>(analysis.scoreWarnings)
        .map(getText)
        .filter(Boolean);
    const followUpQuestions = getCapabilityFollowUpQuestions(capabilities);
    const weakCapabilities = capabilities.filter((item) => item.resumeEvidenceLevel <= 2 || item.risk !== 'none');

    const dotColor = analysis.scoreConfidence === 'high' ? 'bg-emerald-500' : analysis.scoreConfidence === 'low' ? 'bg-rose-500' : 'bg-amber-500';
    const textColor = analysis.scoreConfidence === 'high' ? 'text-emerald-700 dark:text-emerald-400' : analysis.scoreConfidence === 'low' ? 'text-rose-700 dark:text-rose-400' : 'text-amber-700 dark:text-amber-400';

    return (
        <div className="rounded-xl border border-amber-100/50 bg-gradient-to-br from-amber-50/50 via-orange-50/15 to-transparent p-4 shadow-[0_8px_30px_rgba(245,158,11,0.03)] dark:border-amber-900/30 dark:from-amber-950/20 dark:via-orange-950/5 dark:to-transparent">
            <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5 text-amber-900 dark:text-amber-100">
                        <Award className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                        <h4 className="text-[12px] font-bold">
                            能力证据诊断
                        </h4>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-[10.5px]">
                        <div className="flex items-center gap-1.5">
                            <span className="text-amber-700/80 dark:text-amber-300/80">完整度 {completeness}%</span>
                            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-amber-100/70 dark:bg-amber-950/50">
                                <div
                                    className="h-full rounded-full bg-gradient-to-r from-amber-400 to-amber-500 transition-all duration-500"
                                    style={{ width: `${completeness}%` }}
                                />
                            </div>
                        </div>
                        <div className="flex items-center gap-1">
                            <span className="text-amber-700/80 dark:text-amber-300/80">置信度</span>
                            <span className={`inline-flex items-center gap-1 rounded bg-white/85 px-1.5 py-0.5 text-[10px] font-bold shadow-[0_1px_2px_rgba(0,0,0,0.02)] dark:bg-gray-900/70 ${textColor}`}>
                                <span className={`h-1 w-1 rounded-full ${dotColor} animate-pulse`} />
                                {SCORE_CONFIDENCE_LABELS[analysis.scoreConfidence] ?? '中'}
                            </span>
                        </div>
                    </div>
                </div>
                <Pill tone={completeness >= 75 ? 'emerald' : 'amber'}>
                    {analysis.roleFamily || '岗位能力画像'}
                </Pill>
            </div>
            {warningText.length > 0 ? (
                <p className="mb-3 text-[11.5px] leading-relaxed text-amber-900 dark:text-amber-100">
                    {warningText.slice(0, compact ? 1 : 2).join('；')}
                </p>
            ) : null}
            {!compact && capabilities.length > 0 ? (
                <div className="space-y-2">
                    {capabilities.slice(0, 5).map((item) => (
                        <div
                            key={item.id || item.name}
                            className="group flex flex-col rounded-lg border border-amber-100/50 bg-white/60 p-2.5 text-[11.5px] leading-relaxed text-amber-950 shadow-[0_1px_2px_rgba(245,158,11,0.02)] transition-all duration-200 hover:bg-white dark:border-amber-900/30 dark:bg-gray-900/50 dark:text-amber-100 dark:hover:bg-gray-900"
                        >
                            <div className="flex flex-wrap items-center gap-1.5">
                                <span className="font-semibold text-amber-950 dark:text-amber-50">{item.name}</span>
                                <Pill tone={getCapabilityRiskTone(item.risk)}>
                                    {EVIDENCE_LEVEL_LABELS[item.resumeEvidenceLevel] ?? '待判断'}
                                </Pill>
                                {item.risk !== 'none' ? (
                                    <span className="inline-flex items-center gap-0.5 rounded-md border border-amber-100 bg-amber-50/50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:border-amber-900/30 dark:bg-amber-950/20 dark:text-amber-400">
                                        <AlertTriangle className="h-2.5 w-2.5 text-amber-500" />
                                        {RISK_LABELS[item.risk] ?? item.risk}
                                    </span>
                                ) : null}
                            </div>
                            {item.resumeEvidenceSummary ? (
                                <p className="mt-1.5 border-t border-dashed border-amber-100/60 pt-1.5 text-[11px] leading-relaxed text-amber-800/80 dark:border-amber-900/20 dark:text-amber-200/80">
                                    {item.resumeEvidenceSummary}
                                </p>
                            ) : null}
                        </div>
                    ))}
                </div>
            ) : null}
            {(weakCapabilities.length > 0 || followUpQuestions.length > 0) ? (
                <div className="mt-3.5 space-y-2 rounded-lg border border-dashed border-amber-200/50 bg-amber-50/20 p-2.5 dark:border-amber-900/40 dark:bg-amber-950/10">
                    {weakCapabilities.length > 0 ? (
                        <div className="flex items-start gap-1.5 text-[11px] leading-relaxed text-amber-900 dark:text-amber-200">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                            <span>
                                <strong className="font-semibold text-amber-950 dark:text-amber-100">弱证据：</strong>
                                {weakCapabilities.slice(0, 5).map((item) => item.name).join('、')}
                            </span>
                        </div>
                    ) : null}
                    {followUpQuestions.length > 0 ? (
                        <div className="flex items-start gap-1.5 text-[11px] leading-relaxed text-amber-900 dark:text-amber-200">
                            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                            <span>
                                <strong className="font-semibold text-amber-950 dark:text-amber-100">建议补充：</strong>
                                {followUpQuestions.slice(0, compact ? 1 : 3).join('；')}
                            </span>
                        </div>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
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
    onFileSelect,
    onFileClear,
    hasMissingAttachmentContext,
    bossGreeting,
    isBossGreetingVisible,
    isBossGreetingOutdated,
    isGeneratingBossGreeting,
    onGenerateBossGreeting,
    onRefreshBossGreeting,
    onCopyBossGreeting,
    onCollapseBossGreeting,
    onOpenAgentPluginConfig,
    debugInfo,
    showDebugInfo = false,
    isOutdated = false,
    thinkingText,
    onStopAnalyze,
    onOpenDetailsSidebar,
}) => {
    const jdAnalysisMotion = useJDAnalysisMotion(isAnalyzing);
    const collapsedProfileTags = useMemo(
        () => buildProfileTags(analysisResult?.jdInterpretation),
        [analysisResult?.jdInterpretation]
    );
    const sameTypeJobCount = normalizeStrategyTitles(analysisResult?.jdInterpretation?.sameTypeJobStrategy?.recommendedTitles).length;
    const collapsedTitle = getText(analysisResult?.jdInterpretation?.normalizedTitle)
        || getText(analysisResult?.jobTitle)
        || 'JD 解读待生成';
    const collapsedMeta = [
        getText(analysisResult?.jdInterpretation?.roleFamily),
        getText(analysisResult?.jdInterpretation?.seniority),
        sameTypeJobCount > 0 ? `同投方向 ${sameTypeJobCount} 个` : '',
    ].filter(Boolean).join(' · ');
    const {
        strategyCopyStatus,
        manualStrategyCopyText,
        handleCopyStrategyText,
        resetStrategyCopyState,
    } = useJDStrategyCopyState(onOpenAgentPluginConfig);
    const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
    const [isAttachmentDragOver, setIsAttachmentDragOver] = useState(false);

    const handleOpenDetails = useCallback(() => {
        if (onOpenDetailsSidebar) {
            onOpenDetailsSidebar();
            return;
        }
        setIsDetailsModalOpen(true);
    }, [onOpenDetailsSidebar]);

    const handleCloseDetailsModal = useCallback(() => {
        setIsDetailsModalOpen(false);
        resetStrategyCopyState();
    }, [resetStrategyCopyState]);

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
        void onFileSelect(pastedFile);
    }, [isAnalyzing, onFileSelect]);

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
        void onFileSelect(droppedFile);
    }, [isAnalyzing, onFileSelect]);

    return (
        <>
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
                    jdAnalysisMotion.shouldRenderStatus ? (
                        <div className={`flex items-center justify-between gap-3 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 dark:bg-primary-dark/10 transition-all duration-300 ease-in-out ${jdAnalysisMotion.statusMotionClass}`}>
                            <div className="flex min-w-0 flex-1 items-center gap-2 text-[12px] text-gray-700 dark:text-gray-300">
                                <Wand2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
                                <span
                                    className="min-w-0 flex-1 truncate font-medium leading-5"
                                    title={`思考中：${thinkingText || '正在分析岗位要求...'}`}
                                >
                                    思考中：{thinkingText || '正在分析岗位要求...'}
                                </span>
                            </div>
                            <button
                                type="button"
                                onClick={onStopAnalyze}
                                disabled={!isAnalyzing || !onStopAnalyze}
                                className="flex shrink-0 items-center gap-1 rounded bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-600 transition hover:bg-red-100 disabled:opacity-60 dark:bg-red-950/40 dark:text-red-400 dark:hover:bg-red-950/60"
                            >
                                <X className="h-3 w-3" />
                                停止
                            </button>
                        </div>
                    ) : (
                        <div className={`space-y-2 ${jdAnalysisMotion.idleControlsMotionClass}`}>
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
                                <div className="min-w-0 flex-1 space-y-1 overflow-hidden">
                                    <div className="truncate text-[12px] font-semibold text-gray-800 dark:text-gray-100">
                                        {collapsedTitle}
                                    </div>
                                    {collapsedMeta ? (
                                        <div className="truncate text-[11px] text-gray-500 dark:text-gray-400">
                                            {collapsedMeta}
                                        </div>
                                    ) : (
                                        <div className="flex flex-wrap gap-1 overflow-hidden">
                                            {collapsedProfileTags.length > 0 ? (
                                                collapsedProfileTags.slice(0, 3).map((tag) => (
                                                    <span
                                                        key={tag}
                                                        className="rounded bg-gray-100 px-2 py-1 text-[11.5px] text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                                                    >
                                                        {tag}
                                                    </span>
                                                ))
                                            ) : (
                                                <span className="rounded bg-gray-100 px-2 py-1 text-[11.5px] text-gray-400 dark:bg-gray-800">
                                                    暂无 JD 解读
                                                </span>
                                            )}
                                        </div>
                                    )}
                                </div>
                                {analysisResult ? (
                                    <button
                                        type="button"
                                        onClick={handleOpenDetails}
                                        className="shrink-0 rounded-md border border-emerald-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-50 dark:border-emerald-800/70 dark:bg-gray-900 dark:text-emerald-300 dark:hover:bg-emerald-950/30"
                                    >
                                        查看分析详情
                                    </button>
                                ) : null}
                            </div>
                            {analysisResult?.summary ? (
                                <div className="space-y-2">
                                    <p className="text-[11.5px] leading-relaxed text-emerald-800 dark:text-emerald-300/80">
                                        {analysisResult.summary}
                                        <CapabilityFollowUpCommentLine analysisResult={analysisResult} />
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
                    )
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
                            {jdAnalysisMotion.shouldRenderStatus ? (
                                <div className={`absolute bottom-3 right-3 left-3 flex items-center justify-between gap-3 rounded-lg border border-primary/20 bg-primary/5 px-3 py-1.5 backdrop-blur-sm dark:bg-primary-dark/10 transition-all duration-300 ease-in-out ${jdAnalysisMotion.statusMotionClass}`}>
                                    <div className="flex min-w-0 flex-1 items-center gap-2 text-[11.5px] text-gray-700 dark:text-gray-300">
                                        <Wand2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
                                        <span
                                            className="min-w-0 flex-1 truncate font-medium leading-5"
                                            title={`思考中：${thinkingText || '正在分析岗位要求...'}`}
                                        >
                                            思考中：{thinkingText || '正在分析岗位要求...'}
                                        </span>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={onStopAnalyze}
                                        disabled={!isAnalyzing || !onStopAnalyze}
                                        className="flex shrink-0 items-center gap-1 rounded bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-600 transition hover:bg-red-100 disabled:opacity-60 dark:bg-red-950/40 dark:text-red-400 dark:hover:bg-red-950/60"
                                    >
                                        <X className="h-3 w-3" />
                                        停止
                                    </button>
                                </div>
                            ) : (
                                <div className={`absolute bottom-3 right-3 flex items-center gap-2 ${jdAnalysisMotion.idleControlsMotionClass}`}>
                                    <JDAttachmentUploader
                                        file={jdFile}
                                        onFileSelect={onFileSelect}
                                        disabled={isAnalyzing}
                                    />
                                    <button
                                        onClick={onAnalyze}
                                        disabled={isAnalyzing || (!hasMissingAttachmentContext && !jdFile && !jdText.trim())}
                                        className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-[11.5px] font-bold text-white shadow transition-colors hover:bg-primary-dark disabled:opacity-60"
                                    >
                                        <Wand2 className="h-3 w-3" />
                                        开始分析
                                    </button>
                                </div>
                            )}
                            {isAttachmentDragOver ? (
                                <div className="pointer-events-none absolute inset-2 flex items-center justify-center rounded-lg border border-dashed border-emerald-300 bg-emerald-50/70 text-xs font-medium text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300">
                                    松开以上传为 JD 附件
                                </div>
                            ) : null}
                        </div>
                        {jdFile ? (
                            <JDAttachmentPreview
                                file={jdFile}
                                onClear={onFileClear}
                                disabled={isAnalyzing}
                            />
                        ) : (
                            <p className="text-[11px] leading-5 text-gray-400 dark:text-gray-500">
                                支持点击附件图标、拖拽文件到文本框，或直接在文本框里粘贴图片。{hasMissingAttachmentContext ? ' 当前缓存依赖的附件已丢失，重新上传后可继续更新分析。' : ''}
                            </p>
                        )}
                        {analysisResult ? (
                            <div className="space-y-3">
                                <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-3 dark:border-emerald-800/30 dark:bg-emerald-900/10">
                                    <div className="mb-2 flex items-center justify-between gap-3">
                                        <MatchBadge
                                            score={analysisResult.matchPercentage ?? 0}
                                            trend={analysisResult.matchTrend}
                                        />
                                        <button
                                            type="button"
                                            onClick={handleOpenDetails}
                                            className="rounded-md border border-emerald-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-50 dark:border-emerald-800/70 dark:bg-gray-900 dark:text-emerald-300 dark:hover:bg-emerald-950/30"
                                        >
                                            查看分析详情
                                        </button>
                                    </div>
                                    <p className="text-[11.5px] leading-relaxed text-emerald-800 dark:text-emerald-300/80">
                                        {analysisResult.summary}
                                        <CapabilityFollowUpCommentLine analysisResult={analysisResult} />
                                    </p>
                                </div>
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
                )}
                {showDebugInfo && debugInfo ? (
                    <div className="mt-2 overflow-x-auto whitespace-pre-wrap rounded bg-red-50 p-2 font-mono text-[10px] text-red-600 dark:bg-red-900/20 dark:text-red-400">
                        <strong>Debug Info:</strong>
                        {JSON.stringify(debugInfo, null, 2)}
                    </div>
                ) : null}
            </div>
        </div>
            <JDAnalysisDetailsModal
                isOpen={isDetailsModalOpen}
                analysisResult={analysisResult}
                jdText={jdText}
                copyStatus={strategyCopyStatus}
                manualCopyText={manualStrategyCopyText}
                onCopyText={handleCopyStrategyText}
                onClose={handleCloseDetailsModal}
            />
        </>
    );
};

export default JDAnalysisPanel;
