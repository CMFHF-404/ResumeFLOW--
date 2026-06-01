import type { JDAnalysisResult, JDCoreCapability, JDInterpretation } from '../../../../services/aiService';

const JD_ATTACHMENT_SUPPLEMENT_PREFIX = '\n\n补充 JD 说明：\n';

export const copyTextToClipboard = async (text: string) => {
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

export const getText = (value?: string) => normalizeDisplayText(value);

export const getArray = <T,>(value: unknown): T[] => (Array.isArray(value) ? value as T[] : []);

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
export type RequirementItem = {
    label: string;
    evidence?: string;
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

export const normalizeStrategyTitles = (value: unknown): StrategyTitleItem[] => (
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

export const normalizeSearchQueries = (value: unknown): StrategySearchQueryItem[] => (
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

export const formatSearchQueryLine = (item: StrategySearchQueryItem) => {
    const exclusions = item.excludeKeywords?.length
        ? `（排除：${item.excludeKeywords.join('、')}）`
        : '';
    return `${item.label}: ${item.query}${exclusions}`;
};

export const clampConfidence = (value: number) => {
    if (!Number.isFinite(value)) {
        return 0;
    }
    if (value > 1) {
        return Math.max(0, Math.min(100, Math.round(value)));
    }
    return Math.max(0, Math.min(100, Math.round(value * 100)));
};

export const buildProfileTags = (interpretation?: JDInterpretation) => {
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

export const buildAgentSearchPrompt = (
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


export const clampPercent = (value: unknown) => (
    typeof value === 'number' && Number.isFinite(value)
        ? Math.max(0, Math.min(100, Math.round(value)))
        : 0
);

export const getCapabilityRiskTone = (risk: JDCoreCapability['risk']) => (
    risk === 'none'
        ? 'emerald'
        : risk === 'missing' || risk === 'mispositioned'
            ? 'amber'
            : 'slate'
);

export const getCapabilityFollowUpQuestions = (capabilities: JDCoreCapability[]) => (
    capabilities
        .flatMap((item) => getArray<string>(item.followUpQuestions))
        .map(getText)
        .filter(Boolean)
);
