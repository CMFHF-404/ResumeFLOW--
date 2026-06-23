import type {
  ParsedExperienceVersion,
  ParsedPersonalInfoSelection,
  ResumeParseProgressNode,
} from '../../services/parserService';

export type ParseStage = 'idle' | 'uploading' | 'parsing' | 'analyzing' | 'ready' | 'error';
export type ThinkingNodeStatus = 'streaming' | 'done' | 'error';

export type ThinkingNode = {
  id: string;
  text: string;
  status: ThinkingNodeStatus;
};

const THINKING_NODE_BREAK_REGEX = /[\n\r]|[。！？.!?；;]\s*$/;
const THINKING_TITLE_REGEX = /\*\*([^*\n]+?)(?:\*\*|$)/;
const THINKING_CARD_MAX_TEXT_LENGTH = 28;
const CJK_CHAR_PATTERN = '\\u4e00-\\u9fff\\u3400-\\u4dbf';
const CJK_PUNCT_PATTERN = '\\u3000-\\u303f\\uff00-\\uffef·•';
const CJK_INLINE_PATTERN = `${CJK_CHAR_PATTERN}${CJK_PUNCT_PATTERN}`;
const CJK_PUNCT_ADJ_PATTERN = '()（）\\[\\]【】《》<>·•';
const CJK_INLINE_REGEX = new RegExp(`([${CJK_INLINE_PATTERN}])\\s+([${CJK_INLINE_PATTERN}])`, 'g');
const CJK_LEFT_PUNCT_REGEX = new RegExp(`([${CJK_CHAR_PATTERN}])\\s+([${CJK_PUNCT_ADJ_PATTERN}])`, 'g');
const CJK_RIGHT_PUNCT_REGEX = new RegExp(`([${CJK_PUNCT_ADJ_PATTERN}])\\s+([${CJK_CHAR_PATTERN}])`, 'g');

export const buildEmptySet = () => new Set<string>();

export const buildEmptyPersonalInfoSelection = (): ParsedPersonalInfoSelection => ({
  full_name: false,
  email: false,
  phone: false,
  location: false,
});

export const sleep = (duration: number) => new Promise((resolve) => setTimeout(resolve, duration));

export const formatDateRange = (start?: string, end?: string, isCurrent?: boolean) => {
  const startLabel = start || '未知时间';
  if (isCurrent && !end) {
    return `${startLabel} - 至今`;
  }
  return `${startLabel} - ${end || '至今'}`;
};

export const buildEmptyThinkingNodes = (): ThinkingNode[] => [];

export const getStageForTraceNode = (node: ResumeParseProgressNode): ParseStage => {
  if (node === 'receive_file') {
    return 'uploading';
  }
  if (node === 'dedupe_result' || node === 'finalize') {
    return 'analyzing';
  }
  return 'parsing';
};

export const appendThinkingDelta = (nodes: ThinkingNode[], rawSummary: string): ThinkingNode[] => {
  const summary = rawSummary.replace(/\r/g, '');
  const summaryPreview = summary.trim();
  if (!summaryPreview) {
    return nodes;
  }
  const next = [...nodes];
  const lastNode = next[next.length - 1];
  if (!lastNode || lastNode.status !== 'streaming') {
    next.push({
      id: `thinking-${Date.now()}-${next.length}`,
      text: summary.trimStart(),
      status: THINKING_NODE_BREAK_REGEX.test(summaryPreview) ? 'done' : 'streaming',
    });
    return next;
  }

  const mergedText = `${lastNode.text}${summary}`;
  next[next.length - 1] = {
    ...lastNode,
    text: mergedText,
    status:
      THINKING_NODE_BREAK_REGEX.test(summaryPreview) || mergedText.trim().length >= 140
        ? 'done'
        : 'streaming',
  };
  return next;
};

export const completeThinkingNodes = (nodes: ThinkingNode[]): ThinkingNode[] =>
  nodes.map((item) => ({ ...item, status: item.status === 'error' ? 'error' : 'done' }));

export const failThinkingNodes = (nodes: ThinkingNode[]): ThinkingNode[] => {
  if (!nodes.length) {
    return nodes;
  }
  return nodes.map((item, index) =>
    index === nodes.length - 1 ? { ...item, status: 'error' } : item
  );
};

export const extractThinkingHeadline = (text: string) => {
  const normalized = text.replace(/\r/g, '\n').trim();
  if (!normalized) {
    return '';
  }
  const markdownTitle = normalized.match(THINKING_TITLE_REGEX)?.[1]?.trim();
  if (markdownTitle) {
    return markdownTitle;
  }
  const firstLine = normalized
    .split('\n')
    .map((line) => line.replace(/\*/g, '').trim())
    .find(Boolean);
  return firstLine || '';
};

export const normalizeCjkSpacing = (value: string) => {
  const normalized = value.normalize('NFKC');
  const compact = normalized.replace(/\s+/g, ' ').trim();
  return compact
    .replace(CJK_INLINE_REGEX, '$1$2')
    .replace(CJK_LEFT_PUNCT_REGEX, '$1$2')
    .replace(CJK_RIGHT_PUNCT_REGEX, '$1$2');
};

export const clampThinkingText = (value: string, maxLength = THINKING_CARD_MAX_TEXT_LENGTH) => {
  const normalized = normalizeCjkSpacing(value);
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength).trimEnd()}...`;
};

export const normalizeParsedText = (value?: string) => {
  if (!value) {
    return '';
  }
  return normalizeCjkSpacing(value);
};

export const normalizeParsedOptionalText = (value?: string) => {
  const cleaned = normalizeParsedText(value);
  return cleaned || undefined;
};

export const normalizeParsedList = (items?: string[]) => {
  if (!items) {
    return [];
  }
  return items.map((item) => normalizeParsedText(item)).filter(Boolean);
};

export const normalizeImportVersion = (version: ParsedExperienceVersion) => ({
  title: normalizeParsedText(version.title),
  org: normalizeParsedOptionalText(version.org),
  location: normalizeParsedOptionalText(version.location),
  start_date: version.start_date || undefined,
  end_date: version.end_date || undefined,
  is_current: Boolean(version.is_current),
  summary: normalizeParsedOptionalText(version.summary),
  highlights: normalizeParsedList(version.highlights),
  star: version.star || {},
});

export const normalizeKey = (value: string) => normalizeParsedText(value).toLowerCase();
