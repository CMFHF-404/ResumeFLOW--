import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Check,
    ChevronDown,
    ChevronUp,
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
import JDAttachmentUploader, {
    JDAttachmentPreview,
    isAcceptedJDAttachmentFile,
    prepareJDAttachmentFile,
} from './JDAttachmentUploader';

const JD_PANEL_CONTENT_ID = 'jd-analysis-panel-content';
const JD_ATTACHMENT_SUPPLEMENT_PREFIX = '\n\n补充 JD 说明：\n';

const copyTextToClipboard = async (text: string) => {
    if (navigator.clipboard?.writeText) {
        try {
            await navigator.clipboard.writeText(text);
            return;
        } catch {
            // Continue to the DOM fallback for embedded browsers with blocked clipboard permission.
        }
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(textarea);
    if (!copied) {
        throw new Error('clipboard_unavailable');
    }
};

const normalizeDisplayText = (value: unknown) => (
    typeof value === 'string'
        ? value.replace(/[\u200B-\u200D\uFEFF]/g, '').trim()
        : ''
);

const hasSearchableText = (value: string) => /[\p{L}\p{N}]/u.test(value);

const getText = (value?: string) => normalizeDisplayText(value);

const getArray = <T,>(value: unknown): T[] => (Array.isArray(value) ? value as T[] : []);

type StrategyTitleItem = {
    title: string;
    reason?: string;
    confidence?: number;
};

type StrategySearchQueryItem = {
    label: string;
    query: string;
    includeKeywords?: string[];
    excludeKeywords?: string[];
};

const getRecordText = (value: unknown, keys: string[]) => {
    if (!value || typeof value !== 'object') {
        return '';
    }
    const record = value as Record<string, unknown>;
    for (const key of keys) {
        const text = normalizeDisplayText(record[key]);
        if (text && hasSearchableText(text)) {
            return text;
        }
    }
    return '';
};

const getRecordNumber = (value: unknown, keys: string[]) => {
    if (!value || typeof value !== 'object') {
        return undefined;
    }
    const record = value as Record<string, unknown>;
    for (const key of keys) {
        const rawValue = record[key];
        if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
            return rawValue;
        }
    }
    return undefined;
};

const getRecordStringArray = (value: unknown, keys: string[]) => {
    if (!value || typeof value !== 'object') {
        return [];
    }
    const record = value as Record<string, unknown>;
    for (const key of keys) {
        const rawValue = record[key];
        if (!Array.isArray(rawValue)) {
            continue;
        }
        const values = rawValue
            .map(normalizeDisplayText)
            .filter((text) => text && hasSearchableText(text));
        if (values.length > 0) {
            return values;
        }
    }
    return [];
};

const normalizeStrategyTitles = (value: unknown): StrategyTitleItem[] => (
    getArray<unknown>(value)
        .map((item): StrategyTitleItem | null => {
            if (typeof item === 'string') {
                const title = normalizeDisplayText(item);
                return title && hasSearchableText(title) ? { title } : null;
            }
            const title = getRecordText(item, [
                'title',
                'name',
                'label',
                'text',
                'value',
                'roleTitle',
                'role_title',
                'jobTitle',
                'job_title',
            ]);
            if (!title) {
                return null;
            }
            const reason = getRecordText(item, ['reason', 'evidence', 'description']);
            const confidence = getRecordNumber(item, ['confidence', 'score', 'match']);
            return { title, ...(reason ? { reason } : {}), ...(typeof confidence === 'number' ? { confidence } : {}) };
        })
        .filter((item): item is StrategyTitleItem => item !== null)
);

const normalizeSearchQueries = (value: unknown): StrategySearchQueryItem[] => (
    getArray<unknown>(value)
        .map((item): StrategySearchQueryItem | null => {
            if (typeof item === 'string') {
                const query = normalizeDisplayText(item);
                return query && hasSearchableText(query) ? { label: '搜索词', query } : null;
            }
            const includeKeywords = getRecordStringArray(item, ['includeKeywords', 'include_keywords']);
            const excludeKeywords = getRecordStringArray(item, ['excludeKeywords', 'exclude_keywords']);
            const query = getRecordText(item, ['query', 'searchQuery', 'search_query', 'keyword', 'keywords'])
                || includeKeywords.join(' ');
            if (!query) {
                return null;
            }
            const label = getRecordText(item, ['label', 'name', 'title']) || '搜索词';
            return {
                label,
                query,
                ...(includeKeywords.length > 0 ? { includeKeywords } : {}),
                ...(excludeKeywords.length > 0 ? { excludeKeywords } : {}),
            };
        })
        .filter((item): item is StrategySearchQueryItem => item !== null)
);

const formatSearchQueryLine = (item: StrategySearchQueryItem) => {
    const exclusions = item.excludeKeywords?.length
        ? `（排除：${item.excludeKeywords.join('、')}）`
        : '';
    return `${item.label}: ${item.query}${exclusions}`;
};

const clampConfidence = (value: number) => {
    if (!Number.isFinite(value)) {
        return 0;
    }
    if (value > 1) {
        return Math.max(0, Math.min(100, Math.round(value)));
    }
    return Math.max(0, Math.min(100, Math.round(value * 100)));
};

const buildProfileTags = (interpretation?: JDInterpretation) => {
    if (!interpretation) {
        return [];
    }
    return [
        interpretation.normalizedTitle,
        interpretation.roleFamily,
        interpretation.seniority,
        interpretation.businessDomain,
    ].map(getText).filter(Boolean);
};

const buildAgentJdSourceText = (
    analysisResult: JDAnalysisResult,
    jdText: string
) => {
    const extractedText = getText(analysisResult.extractedJdText);
    let supplementalText = getText(jdText);
    if (extractedText) {
        const prefixedText = `${extractedText}${JD_ATTACHMENT_SUPPLEMENT_PREFIX}`;
        if (supplementalText === extractedText) {
            supplementalText = '';
        } else if (supplementalText.startsWith(prefixedText)) {
            supplementalText = getText(supplementalText.slice(prefixedText.length));
        }
    }
    if (extractedText && supplementalText && extractedText !== supplementalText) {
        return [
            '附件提取 JD：',
            extractedText,
            '',
            '补充 JD 说明：',
            supplementalText,
        ].join('\n');
    }
    return extractedText || supplementalText || '未提供原始 JD 文本';
};

const buildAgentSearchPrompt = (
    analysisResult: JDAnalysisResult,
    jdText: string
) => {
    const interpretation = analysisResult.jdInterpretation;
    const strategy = interpretation?.sameTypeJobStrategy;
    const recommendedTitles = normalizeStrategyTitles(strategy?.recommendedTitles);
    const searchQueries = normalizeSearchQueries(strategy?.searchQueries);
    const avoidTitles = normalizeStrategyTitles(strategy?.avoidTitles);
    const lines = [
        '请使用 ResumeFLOW 求职 SKILL，基于下面的 JD 解读搜索同类岗位。',
        '目标：先用搜索词找 10-30 个真实岗位，校验岗位 URL 和 JD 文本，再调用 /agent/v1/jobs/analyze 批量评分；只对用户确认的高匹配岗位调用 /agent/v1/jobs/generate。',
        '',
        `岗位类型：${getText(interpretation?.roleFamily) || '未识别'}`,
        `标准标题：${getText(interpretation?.normalizedTitle) || getText(analysisResult.jobTitle) || '未识别'}`,
        `职级判断：${getText(interpretation?.seniority) || '不明确'}`,
        `业务属性：${getText(interpretation?.businessDomain) || '未识别'}`,
        `真实诉求：${getText(interpretation?.roleIntent) || getText(analysisResult.summary) || '未生成'}`,
        '',
        '强推荐同投：',
        ...(recommendedTitles.length
            ? recommendedTitles.map((item) => `- ${item.title}${item.reason ? `: ${item.reason}` : ''}`)
            : ['- 暂无，请先刷新 JD 解读']),
        '',
        '推荐搜索词：',
        ...(searchQueries.length
            ? searchQueries.map((item) => `- ${formatSearchQueryLine(item)}`)
            : ['- 暂无，请先刷新 JD 解读']),
        '',
        '不建议混投：',
        ...(avoidTitles.length
            ? avoidTitles.map((item) => `- ${item.title}${item.reason ? `: ${item.reason}` : ''}`)
            : ['- 暂无']),
        '',
        '原始 JD：',
        buildAgentJdSourceText(analysisResult, jdText),
    ];
    return lines.join('\n');
};

const Pill: React.FC<{ children: React.ReactNode; tone?: 'emerald' | 'slate' | 'amber' }> = ({
    children,
    tone = 'slate',
}) => {
    const toneClass = tone === 'emerald'
        ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-900/20 dark:text-emerald-200'
        : tone === 'amber'
            ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800/60 dark:bg-amber-900/20 dark:text-amber-200'
            : 'border-gray-200 bg-white text-gray-600 dark:border-gray-700 dark:bg-gray-900/70 dark:text-gray-300';
    return (
        <span className={`inline-flex max-w-full items-center rounded-md border px-2 py-1 text-[11px] font-medium leading-tight ${toneClass}`}>
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
        <div className="rounded-lg border border-indigo-100 bg-indigo-50/70 p-3 dark:border-indigo-900/50 dark:bg-indigo-950/20">
            <div className="mb-2 flex items-center justify-between gap-3">
                <h4 className="text-[12px] font-bold text-indigo-900 dark:text-indigo-100">
                    可同时投递的岗位方向
                </h4>
                <div className="flex shrink-0 items-center gap-1">
                    <button
                        type="button"
                        onClick={() => onCopyText(queryText, 'queries')}
                        disabled={!queryText}
                        className="inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-white px-2 py-1 text-[10.5px] font-semibold text-indigo-700 transition hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-indigo-800 dark:bg-gray-900 dark:text-indigo-200 dark:hover:bg-indigo-950/40"
                    >
                        <Copy className="h-3 w-3" />
                        复制搜索词
                    </button>
                    <button
                        type="button"
                        onClick={() => onCopyText(buildAgentSearchPrompt(analysisResult, jdText), 'agent')}
                        disabled={!hasStrategy}
                        className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-2 py-1 text-[10.5px] font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        <Search className="h-3 w-3" />
                        让 Agent 搜同类岗位
                    </button>
                </div>
            </div>
            {copyStatus !== 'idle' ? (
                <p className={`mb-2 inline-flex items-center gap-1 text-[10.5px] font-medium ${copyStatus === 'copied' ? 'text-indigo-700 dark:text-indigo-200' : 'text-red-600 dark:text-red-300'}`}>
                    {copyStatus === 'copied' ? <Check className="h-3 w-3" /> : null}
                    {copyStatus === 'copied' ? '已复制，可交给 Agent 或岗位网站搜索框使用' : '复制失败，请从下方手动复制'}
                </p>
            ) : null}
            {copyStatus === 'error' && manualCopyText ? (
                <textarea
                    readOnly
                    value={manualCopyText}
                    className="mb-3 h-28 w-full resize-none rounded-md border border-red-200 bg-white/90 p-2 text-[11px] leading-relaxed text-gray-800 outline-none focus:border-red-300 focus:ring-2 focus:ring-red-100 dark:border-red-900/60 dark:bg-gray-950 dark:text-gray-100 dark:focus:ring-red-950/40"
                    aria-label="手动复制同类岗位搜索内容"
                    onFocus={(event) => event.currentTarget.select()}
                />
            ) : null}
            <div className="space-y-3">
                <div className="space-y-1.5">
                    <p className="text-[10.5px] font-semibold uppercase text-indigo-500 dark:text-indigo-300">
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
                        <p className="text-[10.5px] font-semibold uppercase text-indigo-500 dark:text-indigo-300">
                            搜索词
                        </p>
                        <div className="space-y-1.5">
                            {searchQueries.slice(0, 4).map((item) => (
                                <div
                                    key={`${item.label}-${item.query}`}
                                    className="rounded-md border border-indigo-100 bg-white/80 px-2 py-1.5 text-[11px] leading-relaxed text-indigo-900 dark:border-indigo-900/60 dark:bg-gray-900/70 dark:text-indigo-100"
                                >
                                    <span className="font-semibold">{item.label}：</span>
                                    <span>{item.query}</span>
                                    {item.excludeKeywords?.length ? (
                                        <span className="text-indigo-700/70 dark:text-indigo-300/70">
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
                        <p className="text-[10.5px] font-semibold uppercase text-amber-600 dark:text-amber-300">
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

const clampPercent = (value: unknown) => (
    typeof value === 'number' && Number.isFinite(value)
        ? Math.max(0, Math.min(100, Math.round(value)))
        : 0
);

const getCapabilityRiskTone = (risk: JDCoreCapability['risk']) => (
    risk === 'none'
        ? 'emerald'
        : risk === 'missing' || risk === 'mispositioned'
            ? 'amber'
            : 'slate'
);

const JDInterpretationCard: React.FC<JDInterpretationCardProps> = ({ analysisResult }) => {
    const interpretation = analysisResult.jdInterpretation;
    const profileTags = buildProfileTags(interpretation);
    const coreResponsibilities = getArray(interpretation?.coreResponsibilities);
    const mustHave = getArray(interpretation?.mustHave);
    const hardFilters = getArray(interpretation?.hardFilters);
    const missingKeywords = getArray(analysisResult.missingKeywords);

    return (
        <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-3 dark:border-emerald-800/30 dark:bg-emerald-900/10">
            <div className="mb-2 flex items-center justify-between gap-3">
                <MatchBadge
                    score={analysisResult.matchPercentage ?? 0}
                    trend={analysisResult.matchTrend}
                />
                <span className="text-[11.5px] font-semibold text-emerald-700 dark:text-emerald-300">
                    JD 解读
                </span>
            </div>
            <div className="space-y-3">
                <div className="space-y-1.5">
                    <p className="text-[10.5px] font-semibold uppercase text-emerald-600/80 dark:text-emerald-300/80">
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
                <div className="space-y-1">
                    <p className="text-[10.5px] font-semibold uppercase text-emerald-600/80 dark:text-emerald-300/80">
                        JD 真实诉求
                    </p>
                    <p className="text-[11.5px] leading-relaxed text-emerald-900 dark:text-emerald-200">
                        {getText(interpretation?.roleIntent) || analysisResult.summary || '暂无解读，重新分析后会补齐岗位真实诉求。'}
                    </p>
                </div>
                {(coreResponsibilities.length > 0 || mustHave.length > 0) ? (
                    <div className="space-y-1.5">
                        <p className="text-[10.5px] font-semibold uppercase text-emerald-600/80 dark:text-emerald-300/80">
                            核心要求
                        </p>
                        <div className="space-y-1.5">
                            {[...coreResponsibilities.slice(0, 3), ...mustHave.slice(0, 3)]
                                .slice(0, 5)
                                .map((item) => (
                                    <div
                                        key={`${item.label}-${item.evidence}`}
                                        className="rounded-md border border-emerald-100 bg-white/80 px-2 py-1.5 text-[11px] leading-relaxed text-emerald-900 dark:border-emerald-900/50 dark:bg-gray-900/60 dark:text-emerald-100"
                                    >
                                        <span className="font-semibold">{item.label}</span>
                                        {item.evidence ? <span className="text-emerald-700/80 dark:text-emerald-300/80">：{item.evidence}</span> : null}
                                    </div>
                                ))}
                        </div>
                    </div>
                ) : null}
                {hardFilters.length > 0 ? (
                    <div className="space-y-1.5">
                        <p className="text-[10.5px] font-semibold uppercase text-amber-600 dark:text-amber-300">
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
                        <summary className="cursor-pointer text-[11px] font-medium text-emerald-700/80 transition hover:text-emerald-800 dark:text-emerald-300/80 dark:hover:text-emerald-200">
                            查看底层关键词缺口
                        </summary>
                        <p className="mt-1 text-[11px] leading-relaxed text-emerald-700/70 dark:text-emerald-300/70">
                            {missingKeywords.join('、')}
                        </p>
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
    onOpenAgentPluginConfig?: () => void;
    debugInfo?: any;
    showDebugInfo?: boolean;
    isOutdated?: boolean;
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
                </div>
            </div>
        </div>
    );
};

type CapabilityEvidenceCardProps = {
    analysisResult: JDAnalysisResult;
    compact?: boolean;
};

const getCapabilityFollowUpQuestions = (capabilities: JDCoreCapability[]) => (
    capabilities
        .flatMap((item) => getArray<string>(item.followUpQuestions))
        .map(getText)
        .filter(Boolean)
);

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

    return (
        <div className="rounded-lg border border-amber-100 bg-amber-50/70 p-3 dark:border-amber-900/40 dark:bg-amber-950/20">
            <div className="mb-2 flex items-center justify-between gap-3">
                <div>
                    <h4 className="text-[12px] font-bold text-amber-900 dark:text-amber-100">
                        能力证据诊断
                    </h4>
                    <p className="mt-0.5 text-[10.5px] text-amber-700/80 dark:text-amber-300/80">
                        证据完整度 {completeness}% · 评分置信度 {SCORE_CONFIDENCE_LABELS[analysis.scoreConfidence] ?? '中'}
                    </p>
                </div>
                <Pill tone={completeness >= 75 ? 'emerald' : 'amber'}>
                    {analysis.roleFamily || '岗位能力画像'}
                </Pill>
            </div>
            {warningText.length > 0 ? (
                <p className="mb-2 text-[11.5px] leading-relaxed text-amber-900 dark:text-amber-100">
                    {warningText.slice(0, compact ? 1 : 2).join('；')}
                </p>
            ) : null}
            {!compact && capabilities.length > 0 ? (
                <div className="space-y-1.5">
                    {capabilities.slice(0, 5).map((item) => (
                        <div
                            key={item.id || item.name}
                            className="rounded-md border border-amber-100 bg-white/80 px-2 py-1.5 text-[11px] leading-relaxed text-amber-950 dark:border-amber-900/50 dark:bg-gray-900/70 dark:text-amber-100"
                        >
                            <div className="flex flex-wrap items-center gap-1.5">
                                <span className="font-semibold">{item.name}</span>
                                <Pill tone={getCapabilityRiskTone(item.risk)}>
                                    {EVIDENCE_LEVEL_LABELS[item.resumeEvidenceLevel] ?? '待判断'}
                                </Pill>
                                {item.risk !== 'none' ? (
                                    <Pill tone="amber">{RISK_LABELS[item.risk] ?? item.risk}</Pill>
                                ) : null}
                            </div>
                            {item.resumeEvidenceSummary ? (
                                <p className="mt-1 text-amber-800/80 dark:text-amber-200/80">
                                    {item.resumeEvidenceSummary}
                                </p>
                            ) : null}
                        </div>
                    ))}
                </div>
            ) : null}
            {weakCapabilities.length > 0 || followUpQuestions.length > 0 ? (
                <div className="mt-2 space-y-1">
                    {weakCapabilities.length > 0 ? (
                        <p className="text-[11px] leading-relaxed text-amber-800 dark:text-amber-200">
                            弱证据：{weakCapabilities.slice(0, 5).map((item) => item.name).join('、')}
                        </p>
                    ) : null}
                    {followUpQuestions.length > 0 ? (
                        <p className="text-[11px] leading-relaxed text-amber-800 dark:text-amber-200">
                            建议补充：{followUpQuestions.slice(0, compact ? 1 : 3).join('；')}
                        </p>
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
    onOpenAgentPluginConfig,
    debugInfo,
    showDebugInfo = false,
    isOutdated = false,
}) => {
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
    const [strategyCopyStatus, setStrategyCopyStatus] = useState<StrategyCopyStatus>('idle');
    const [manualStrategyCopyText, setManualStrategyCopyText] = useState('');
    const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
    const [isAttachmentDragOver, setIsAttachmentDragOver] = useState(false);
    const attachmentSelectionVersionRef = useRef(0);
    const copyStatusResetTimerRef = useRef<number | null>(null);
    const copyRequestVersionRef = useRef(0);

    const clearCopyStatusResetTimer = useCallback(() => {
        if (copyStatusResetTimerRef.current !== null) {
            window.clearTimeout(copyStatusResetTimerRef.current);
            copyStatusResetTimerRef.current = null;
        }
    }, []);

    useEffect(() => clearCopyStatusResetTimer, [clearCopyStatusResetTimer]);

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

    const handleCloseDetailsModal = useCallback(() => {
        copyRequestVersionRef.current += 1;
        clearCopyStatusResetTimer();
        setIsDetailsModalOpen(false);
        setStrategyCopyStatus('idle');
        setManualStrategyCopyText('');
    }, [clearCopyStatusResetTimer]);

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
                                    onClick={() => setIsDetailsModalOpen(true)}
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
                            <div className="space-y-3">
                                <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-3 dark:border-emerald-800/30 dark:bg-emerald-900/10">
                                    <div className="mb-2 flex items-center justify-between gap-3">
                                        <MatchBadge
                                            score={analysisResult.matchPercentage ?? 0}
                                            trend={analysisResult.matchTrend}
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setIsDetailsModalOpen(true)}
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
