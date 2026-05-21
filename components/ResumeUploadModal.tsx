import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  LoaderCircle,
  UploadCloud,
  X,
} from 'lucide-react';

import { experienceService } from '../services/experienceService';
import { certificationsService } from '../services/certificationsService';
import { skillsService, type UserSkill } from '../services/skillsService';
import {
  ParsedExperienceItem,
  ParsedPersonalInfo,
  ParsedPersonalInfoSelection,
  ParsedExperienceVersion,
  ParsedCertification,
  ParsedSkillGroup,
  type ResumeParseProgressNode,
  parserService,
} from '../services/parserService';
import { stripRichTextToText } from '../utils/richText';
import { convertDateToISO } from '../views/experienceUtils';
import { trackExperienceBankImported } from '../utils/analyticsTracker';

const SUPPORTED_EXTENSIONS = ['pdf', 'docx'];
const STAGE_TRANSITION_DELAY_MS = 180;

const CATEGORY_LABELS: Record<string, string> = {
  work: '工作经历',
  education: '教育经历',
  project: '项目经历',
};
const DEFAULT_SKILL_CATEGORY = '未分类';
const SKILL_DUPLICATE_LABEL = '可能重复';

const STAGE_LABELS = {
  uploading: '上传中',
  parsing: '解析中',
  analyzing: '查重中',
  ready: '完成',
  error: '失败',
  idle: '待上传',
};

type ParseStage = 'idle' | 'uploading' | 'parsing' | 'analyzing' | 'ready' | 'error';
type ThinkingNodeStatus = 'streaming' | 'done' | 'error';

type ThinkingNode = {
  id: string;
  text: string;
  status: ThinkingNodeStatus;
};

const STAGE_PROGRESS: Record<ParseStage, number> = {
  idle: 0,
  uploading: 20,
  parsing: 60,
  analyzing: 85,
  ready: 100,
  error: 0,
};
// Keep the client-side timeout above backend AI_TIMEOUT_SECONDS (300s),
// so the backend can return the real parser/Gemini error instead of the
// browser aborting the stream first.
const PARSE_TIMEOUT_MS = 360_000;
const TIMEOUT_ERROR_NAME = 'ResumeParseTimeout';
const LONG_PARSE_NOTICE_DELAY_MS = 4000;
const LONG_PARSE_NOTICE_DURATION_MS = 8000;
const LONG_PARSE_NOTICE_MESSAGE = '检测到简历内容较长，本次解析可能需要更长时间，请耐心等待。';
const PARSE_SUCCESS_MESSAGE = '简历解析完成';
const REPEATED_PARSE_ERROR_HINT =
  '如果简历文本过长或者含有图片（如模板）可能造成简历无法解析，请使用其他AI助手整理出干净文本再解析';
const THINKING_NODE_BREAK_REGEX = /[\n\r]|[。！？.!?；;]\s*$/;
const THINKING_TITLE_REGEX = /\*\*([^*\n]+?)(?:\*\*|$)/;
const THINKING_CARD_MAX_TEXT_LENGTH = 28;

type ToastHandlers = {
  success: (message: string, duration?: number) => void;
  error: (message: string, duration?: number) => void;
  info: (message: string, duration?: number) => void;
  loading: (message: string) => string;
  updateToast: (id: string, updates: { message?: string; type?: 'success' | 'error'; duration?: number }) => void;
};

interface ResumeUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImported: (
    parsedPersonalInfo?: ParsedPersonalInfo,
    personalInfoSelection?: ParsedPersonalInfoSelection
  ) => Promise<void> | void;
  profileSnapshot?: {
    name?: string;
    email?: string;
    phone?: string;
    location?: string;
  };
  toast: ToastHandlers;
}

type ParsedCertificationView = ParsedCertification & { id: string };

type ParsedSkillTagView = {
  id: string;
  name: string;
  category: string;
};

type ParsedSkillGroupView = {
  category: string;
  tags: ParsedSkillTagView[];
};

const buildEmptySet = () => new Set<string>();
const buildEmptyPersonalInfoSelection = (): ParsedPersonalInfoSelection => ({
  full_name: false,
  email: false,
  phone: false,
  location: false,
});

const sleep = (duration: number) => new Promise((resolve) => setTimeout(resolve, duration));

const formatDateRange = (start?: string, end?: string, isCurrent?: boolean) => {
  const startLabel = start || '未知时间';
  if (isCurrent && !end) {
    return `${startLabel} - 至今`;
  }
  return `${startLabel} - ${end || '至今'}`;
};

const buildEmptyThinkingNodes = (): ThinkingNode[] => [];

const getStageForTraceNode = (node: ResumeParseProgressNode): ParseStage => {
  if (node === 'receive_file') {
    return 'uploading';
  }
  if (node === 'dedupe_result' || node === 'finalize') {
    return 'analyzing';
  }
  return 'parsing';
};

const appendThinkingDelta = (nodes: ThinkingNode[], rawSummary: string): ThinkingNode[] => {
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

const completeThinkingNodes = (nodes: ThinkingNode[]): ThinkingNode[] =>
  nodes.map((item) => ({ ...item, status: item.status === 'error' ? 'error' : 'done' }));

const failThinkingNodes = (nodes: ThinkingNode[]): ThinkingNode[] => {
  if (!nodes.length) {
    return nodes;
  }
  return nodes.map((item, index) =>
    index === nodes.length - 1 ? { ...item, status: 'error' } : item
  );
};

const extractThinkingHeadline = (text: string) => {
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

const clampThinkingText = (value: string, maxLength = THINKING_CARD_MAX_TEXT_LENGTH) => {
  const normalized = normalizeCjkSpacing(value);
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength).trimEnd()}...`;
};

const CJK_CHAR_PATTERN = '\\u4e00-\\u9fff\\u3400-\\u4dbf';
const CJK_PUNCT_PATTERN = '\\u3000-\\u303f\\uff00-\\uffef·•';
const CJK_INLINE_PATTERN = `${CJK_CHAR_PATTERN}${CJK_PUNCT_PATTERN}`;
const CJK_PUNCT_ADJ_PATTERN = '()（）\\[\\]【】《》<>·•';
const CJK_INLINE_REGEX = new RegExp(`([${CJK_INLINE_PATTERN}])\\s+([${CJK_INLINE_PATTERN}])`, 'g');
const CJK_LEFT_PUNCT_REGEX = new RegExp(`([${CJK_CHAR_PATTERN}])\\s+([${CJK_PUNCT_ADJ_PATTERN}])`, 'g');
const CJK_RIGHT_PUNCT_REGEX = new RegExp(`([${CJK_PUNCT_ADJ_PATTERN}])\\s+([${CJK_CHAR_PATTERN}])`, 'g');

const normalizeCjkSpacing = (value: string) => {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact
    .replace(CJK_INLINE_REGEX, '$1$2')
    .replace(CJK_LEFT_PUNCT_REGEX, '$1$2')
    .replace(CJK_RIGHT_PUNCT_REGEX, '$1$2');
};

const normalizeParsedText = (value?: string) => {
  if (!value) {
    return '';
  }
  return normalizeCjkSpacing(value);
};

const normalizeParsedOptionalText = (value?: string) => {
  const cleaned = normalizeParsedText(value);
  return cleaned || undefined;
};

const normalizeParsedList = (items?: string[]) => {
  if (!items) {
    return [];
  }
  return items.map((item) => normalizeParsedText(item)).filter(Boolean);
};

const normalizeImportVersion = (version: ParsedExperienceVersion) => ({
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

const normalizeKey = (value: string) => normalizeParsedText(value).toLowerCase();

const normalizeSkillCategoryName = (value?: string) => value?.trim() || DEFAULT_SKILL_CATEGORY;

const buildCertificationViewId = (item: ParsedCertification, index: number) => {
  const name = item.name?.trim() || 'cert';
  return `cert-${index}-${normalizeKey(name)}`;
};

const buildSkillTagId = (category: string, tag: string) =>
  `${normalizeKey(category)}::${normalizeKey(tag)}`;

const buildParsedCertifications = (items: ParsedCertification[]) => {
  return items.map((item, index) => ({
    ...item,
    id: buildCertificationViewId(item, index),
  }));
};

const buildParsedSkillGroups = (items: ParsedSkillGroup[]): ParsedSkillGroupView[] => {
  const groups = new Map<string, ParsedSkillGroupView>();
  const order: string[] = [];
  items.forEach((entry) => {
    const category = normalizeParsedText(normalizeSkillCategoryName(entry.category)) || DEFAULT_SKILL_CATEGORY;
    const categoryKey = normalizeKey(category);
    if (!groups.has(categoryKey)) {
      groups.set(categoryKey, { category, tags: [] });
      order.push(categoryKey);
    }
    const group = groups.get(categoryKey);
    if (!group) {
      return;
    }
    const seen = new Set(group.tags.map((tag) => tag.id));
    const nextTags = Array.isArray(entry.tags) ? entry.tags : [];
    nextTags.forEach((rawTag) => {
      const tag = normalizeParsedText(rawTag);
      if (!tag) {
        return;
      }
      const tagId = buildSkillTagId(category, tag);
      if (seen.has(tagId)) {
        return;
      }
      seen.add(tagId);
      group.tags.push({ id: tagId, name: tag, category });
    });
  });
  return order.map((key) => groups.get(key)!).filter(Boolean);
};

const flattenSkillTags = (groups: ParsedSkillGroupView[]) =>
  groups.flatMap((group) => group.tags);

const buildPersonalInfoSelection = (
  info?: ParsedPersonalInfo,
  profileSnapshot?: {
    name?: string;
    email?: string;
    phone?: string;
    location?: string;
  }
): ParsedPersonalInfoSelection => ({
  full_name: Boolean(info?.full_name?.trim()) && !profileSnapshot?.name?.trim(),
  email: Boolean(info?.email?.trim()) && !profileSnapshot?.email?.trim(),
  phone: Boolean(info?.phone?.trim()) && !profileSnapshot?.phone?.trim(),
  location: Boolean(info?.location?.trim()) && !profileSnapshot?.location?.trim(),
});

const normalizeCertificationDate = (value?: string) => {
  if (!value) {
    return '';
  }
  return convertDateToISO(value) || value.trim();
};

const buildCertificationSignature = (item: {
  name: string;
  issuer?: string;
  issue_date?: string;
}) => {
  return [
    normalizeKey(item.name),
    normalizeKey(item.issuer || ''),
    normalizeKey(normalizeCertificationDate(item.issue_date)),
  ].join('::');
};

const buildSkillSignature = (item: { name: string; category?: string }) => {
  return [
    normalizeKey(normalizeSkillCategoryName(item.category)),
    normalizeKey(item.name),
  ].join('::');
};

const buildSkillDuplicateIds = (
  groups: ParsedSkillGroupView[],
  existingSkills: UserSkill[]
) => {
  if (!groups.length || !existingSkills.length) {
    return buildEmptySet();
  }
  const existingSignatures = new Set(
    existingSkills.map((skill) =>
      buildSkillSignature({ name: skill.name, category: skill.category })
    )
  );
  const duplicates = new Set<string>();
  flattenSkillTags(groups).forEach((tag) => {
    const signature = buildSkillSignature({ name: tag.name, category: tag.category });
    if (existingSignatures.has(signature)) {
      duplicates.add(tag.id);
    }
  });
  return duplicates;
};

const dedupeBySignature = <T,>(items: T[], getSignature: (item: T) => string) => {
  const seen = new Set<string>();
  const output: T[] = [];
  items.forEach((item) => {
    const signature = getSignature(item);
    if (!signature || seen.has(signature)) {
      return;
    }
    seen.add(signature);
    output.push(item);
  });
  return output;
};

const countSelectedPersonalInfo = (selection?: ParsedPersonalInfoSelection) => {
  if (!selection) {
    return 0;
  }
  return Object.values(selection).filter(Boolean).length;
};

const buildCertificationImportPayloads = async (items: ParsedCertificationView[]) => {
  const validItems = items.filter((item) => item.name?.trim());
  if (!validItems.length) {
    return [];
  }
  const existing = await certificationsService.list({ force: true });
  const existingSignatures = new Set(
    existing.map((cert) =>
      buildCertificationSignature({
        name: cert.name,
        issuer: cert.issuer,
        issue_date: cert.issue_date || undefined,
      })
    )
  );
  return dedupeBySignature<ParsedCertificationView>(validItems, buildCertificationSignature)
    .filter((item) => !existingSignatures.has(buildCertificationSignature(item)))
    .map((item) => ({
      name: normalizeParsedText(item.name),
      issuer: normalizeParsedOptionalText(item.issuer),
      issue_date: normalizeCertificationDate(item.issue_date) || undefined,
      expiry_date: normalizeCertificationDate(item.expiry_date) || undefined,
      credential_id: normalizeParsedOptionalText(item.credential_id),
      credential_url: normalizeParsedOptionalText(item.credential_url),
      description: normalizeParsedOptionalText(item.description),
    }));
};

const buildSkillImportPayloads = async (items: ParsedSkillTagView[]) => {
  const validItems = items.filter((item) => item.name?.trim());
  if (!validItems.length) {
    return [];
  }
  const existing = await skillsService.list({ force: true });
  const existingSignatures = new Set(
    existing.map((skill) =>
      buildSkillSignature({
        name: skill.name,
        category: skill.category,
      })
    )
  );
  return dedupeBySignature(
    validItems,
    (item) => buildSkillSignature({ name: item.name, category: item.category })
  )
    .filter(
      (item) =>
        !existingSignatures.has(
          buildSkillSignature({ name: item.name, category: item.category })
        )
    )
    .map((item) => ({
      name: normalizeParsedText(item.name),
      category: normalizeParsedText(normalizeSkillCategoryName(item.category)),
    }));
};

const isSupportedFile = (file: File) => {
  const extension = file.name.split('.').pop()?.toLowerCase();
  return extension ? SUPPORTED_EXTENSIONS.includes(extension) : false;
};

const buildDefaultSelection = (items: ParsedExperienceItem[]) => {
  return new Set(items.filter((item) => !item.duplicate?.is_duplicate).map((item) => item.id));
};

const createTimeoutError = () => {
  const error = new Error('解析超时');
  error.name = TIMEOUT_ERROR_NAME;
  return error;
};

const withTimeout = async <T,>(
  task: Promise<T>,
  timeoutMs: number,
  onTimeout?: () => void
): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => {
      onTimeout?.();
      reject(createTimeoutError());
    }, timeoutMs);
  });

  try {
    return await Promise.race([task, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};

const isAbortLikeError = (error: unknown) => {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.name === 'AbortError' || /aborted|abort/i.test(error.message);
};

const USER_VISIBLE_PARSE_ERROR_PATTERNS = [
  /无法读取附件中的文本内容/,
  /文件为空，无法解析/,
  /不支持的文件类型/,
  /文件过大，无法直接解析/,
  /文件无法读取，请确认文件未损坏、未加密且内容可解析/,
] as const;

const resolveParseErrorMessage = (error: unknown) => {
  if (error instanceof Error && error.name === TIMEOUT_ERROR_NAME) {
    return '解析超时，请稍后重试。';
  }
  if (error instanceof Error && error.message.trim()) {
    const message = error.message.trim();
    if (USER_VISIBLE_PARSE_ERROR_PATTERNS.some((pattern) => pattern.test(message))) {
      return message;
    }
  }
  return '解析失败，请检查文件内容或稍后重试。';
};

const isHttpNotFoundError = (error: unknown) => {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const response = (error as { response?: { status?: number } }).response;
  return response?.status === 404;
};

const buildParseErrorMessage = (error: unknown, errorCount: number) => {
  const baseMessage = resolveParseErrorMessage(error);
  if (errorCount < 2) {
    return baseMessage;
  }
  if (
    baseMessage.includes(REPEATED_PARSE_ERROR_HINT)
    || baseMessage.includes('无法读取附件中的文本内容')
  ) {
    return baseMessage;
  }
  return `${baseMessage} ${REPEATED_PARSE_ERROR_HINT}`;
};

const ProgressSteps: React.FC<{ stage: ParseStage }> = ({ stage }) => {
  const steps = [
    { key: 'uploading', label: STAGE_LABELS.uploading },
    { key: 'parsing', label: STAGE_LABELS.parsing },
    { key: 'analyzing', label: STAGE_LABELS.analyzing },
  ] as const;
  const activeIndex = steps.findIndex((step) => step.key === stage);
  const resolvedIndex = stage === 'ready' ? steps.length - 1 : activeIndex;

  return (
    <div className="flex items-center gap-3">
      {steps.map((step, index) => {
        const isActive = resolvedIndex >= index && stage !== 'error';
        return (
          <div key={step.key} className="flex items-center gap-2">
            <span
              className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold ${isActive
                ? 'bg-emerald-500 text-white shadow-emerald-500/30 shadow'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-500'
                }`}
            >
              {isActive ? <CheckCircle2 className="w-4 h-4" /> : index + 1}
            </span>
            <span className={`text-xs ${isActive ? 'text-emerald-600' : 'text-gray-400'}`}>
              {step.label}
            </span>
            {index < steps.length - 1 && (
              <span className="w-8 h-px bg-gray-200 dark:bg-gray-700" />
            )}
          </div>
        );
      })}
    </div>
  );
};

const ResumeItemCard: React.FC<{
  item: ParsedExperienceItem;
  checked: boolean;
  onToggle: () => void;
}> = ({ item, checked, onToggle }) => {
  const { version, duplicate } = item;
  const headline = `${normalizeParsedText(version.org || '未知机构')} · ${normalizeParsedText(version.title)}`;
  const isDuplicate = duplicate?.is_duplicate;

  return (
    <label
      className={`group flex items-start gap-4 rounded-xl border px-4 py-4 transition-all ${checked
        ? 'border-emerald-400 bg-emerald-50/50 dark:bg-emerald-900/10'
        : 'border-gray-200 dark:border-gray-700 bg-white/60 dark:bg-surface-dark'
        }`}
    >
      <input
        type="checkbox"
        className="mt-1 h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
        checked={checked}
        onChange={onToggle}
      />
      <div className="flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs px-2 py-1 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
            {CATEGORY_LABELS[item.category] || item.category}
          </span>
          {isDuplicate && (
            <span className="text-xs px-2 py-1 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
              可能重复 {duplicate.match_score ? `(${duplicate.match_score})` : ''}
            </span>
          )}
          <span className="text-sm font-semibold text-gray-900 dark:text-white">
            {headline}
          </span>
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400">
          {formatDateRange(version.start_date, version.end_date, version.is_current)}
        </div>
        {(version.star?.s || version.summary) && (
          <p className="text-sm text-gray-600 dark:text-gray-300 line-clamp-2">
            {normalizeParsedText(stripRichTextToText(version.star?.s ?? '') || version.summary || '')}
          </p>
        )}
        {version.highlights && version.highlights.length > 0 && (
          <div className="flex flex-wrap gap-2 text-xs text-gray-500">
            {version.highlights.slice(0, 3).map((itemText, index) => (
              <span
                key={`${item.id}-highlight-${index}`}
                className="px-2 py-1 rounded-full bg-gray-100 dark:bg-gray-800"
              >
                {normalizeParsedText(itemText)}
              </span>
            ))}
          </div>
        )}
      </div>
    </label>
  );
};

const SectionTitle: React.FC<{
  title: string;
  meta?: string;
  actionLabel?: string;
  onAction?: () => void;
  isActionDisabled?: boolean;
}> = ({ title, meta, actionLabel, onAction, isActionDisabled }) => (
  <div className="flex items-center justify-between">
    <div className="flex items-center gap-2">
      <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-200">{title}</h4>
      {meta && (
        <span className="text-xs text-gray-400">{meta}</span>
      )}
    </div>
    {actionLabel && onAction && (
      <button
        type="button"
        onClick={onAction}
        disabled={isActionDisabled}
        className="text-xs text-emerald-600 hover:text-emerald-500 disabled:opacity-50"
      >
        {actionLabel}
      </button>
    )}
  </div>
);

const EmptyPreviewCard: React.FC<{ label: string }> = ({ label }) => (
  <div className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-white/70 dark:bg-gray-900/40 p-6 text-center text-sm text-gray-400">
    {label}
  </div>
);

const PersonalInfoPreview: React.FC<{
  info?: ParsedPersonalInfo;
  selection: ParsedPersonalInfoSelection;
  onToggle: (field: keyof ParsedPersonalInfoSelection) => void;
}> = ({ info, selection, onToggle }) => {
  const entries = [
    { key: 'full_name', label: '姓名', value: normalizeParsedText(info?.full_name) },
    { key: 'email', label: '邮箱', value: normalizeParsedText(info?.email) },
    { key: 'phone', label: '电话', value: normalizeParsedText(info?.phone) },
    { key: 'location', label: '地点', value: normalizeParsedText(info?.location) },
  ]
    .filter((item) => item.value && item.value.trim())
    .map((item) => ({
      ...item,
      key: item.key as keyof ParsedPersonalInfoSelection,
    }));

  const links = (info?.links || []).filter((link) => link.trim());
  const hasContent = entries.length > 0 || links.length > 0;

  if (!hasContent) {
    return <EmptyPreviewCard label="未解析到个人信息" />;
  }

  return (
    <div className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-white/70 dark:bg-gray-900/40 p-4 space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm text-gray-600 dark:text-gray-300">
        {entries.map((item) => (
          <label key={item.label} className="flex items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
              checked={selection[item.key]}
              onChange={() => onToggle(item.key)}
            />
            <span className="text-xs text-gray-400">{item.label}</span>
            <span className="font-medium text-gray-800 dark:text-gray-100">{item.value}</span>
          </label>
        ))}
      </div>
      {links.length > 0 && (
        <div className="flex flex-wrap gap-2 text-xs text-gray-500">
          {links.map((link, index) => (
            <span
              key={`parsed-link-${index}`}
              className="px-2 py-1 rounded-full bg-gray-100 dark:bg-gray-800"
            >
              {link}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

const CertificationItemCard: React.FC<{
  item: ParsedCertificationView;
  checked: boolean;
  onToggle: () => void;
}> = ({ item, checked, onToggle }) => {
  const dateLabel = normalizeParsedText(item.issue_date) || '未知时间';
  const issuer = normalizeParsedOptionalText(item.issuer);
  return (
    <label
      className={`group flex items-start gap-4 rounded-xl border px-4 py-4 transition-all ${checked
        ? 'border-emerald-400 bg-emerald-50/50 dark:bg-emerald-900/10'
        : 'border-gray-200 dark:border-gray-700 bg-white/60 dark:bg-surface-dark'
        }`}
    >
      <input
        type="checkbox"
        className="mt-1 h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
        checked={checked}
        onChange={onToggle}
      />
      <div className="flex-1 space-y-2">
        <div className="text-sm font-semibold text-gray-900 dark:text-white">
          {normalizeParsedText(item.name)}
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400">
          {issuer ? `${issuer} · ${dateLabel}` : dateLabel}
        </div>
      </div>
    </label>
  );
};

const SkillTagItem: React.FC<{
  item: ParsedSkillTagView;
  checked: boolean;
  isDuplicate: boolean;
  onToggle: () => void;
}> = ({ item, checked, isDuplicate, onToggle }) => (
  <label
    className={`flex items-center gap-2 rounded-full px-3 py-1 text-xs border transition ${checked
      ? 'border-emerald-400 bg-emerald-50/50 text-emerald-700 dark:bg-emerald-900/10 dark:text-emerald-300'
      : 'border-gray-200 bg-white/60 text-gray-600 dark:border-gray-700 dark:bg-surface-dark dark:text-gray-300'
      }`}
  >
    <input
      type="checkbox"
      className="h-3.5 w-3.5 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
      checked={checked}
      onChange={onToggle}
    />
    <span>{normalizeParsedText(item.name)}</span>
    {isDuplicate && (
      <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
        {SKILL_DUPLICATE_LABEL}
      </span>
    )}
  </label>
);

const ExperiencePreviewSection: React.FC<{
  title: string;
  emptyLabel: string;
  items: ParsedExperienceItem[];
  selectedIds: Set<string>;
  onToggleItem: (id: string) => void;
  onToggleGroup: (ids: string[]) => void;
}> = ({ title, emptyLabel, items, selectedIds, onToggleItem, onToggleGroup }) => {
  const selectedCount = items.filter((item) => selectedIds.has(item.id)).length;
  const actionLabel = items.length
    ? selectedCount === items.length ? '取消全选' : '全选'
    : undefined;

  return (
    <div className="space-y-3">
      <SectionTitle
        title={title}
        meta={items.length ? `${selectedCount}/${items.length}` : undefined}
        actionLabel={actionLabel}
        onAction={items.length ? () => onToggleGroup(items.map((item) => item.id)) : undefined}
      />
      <div className="space-y-3">
        {!items.length ? (
          <EmptyPreviewCard label={emptyLabel} />
        ) : (
          items.map((item) => (
            <ResumeItemCard
              key={item.id}
              item={item}
              checked={selectedIds.has(item.id)}
              onToggle={() => onToggleItem(item.id)}
            />
          ))
        )}
      </div>
    </div>
  );
};

const CertificationPreviewSection: React.FC<{
  items: ParsedCertificationView[];
  selectedIds: Set<string>;
  onToggleItem: (id: string) => void;
  onToggleAll: () => void;
}> = ({ items, selectedIds, onToggleItem, onToggleAll }) => {
  const selectedCount = items.filter((item) => selectedIds.has(item.id)).length;
  const actionLabel = items.length
    ? selectedCount === items.length ? '取消全选' : '全选'
    : undefined;

  return (
    <div className="space-y-3">
      <SectionTitle
        title="证书资质"
        meta={items.length ? `${selectedCount}/${items.length}` : undefined}
        actionLabel={actionLabel}
        onAction={items.length ? onToggleAll : undefined}
      />
      <div className="space-y-3">
        {!items.length ? (
          <EmptyPreviewCard label="未解析到证书资质" />
        ) : (
          items.map((item) => (
            <CertificationItemCard
              key={item.id}
              item={item}
              checked={selectedIds.has(item.id)}
              onToggle={() => onToggleItem(item.id)}
            />
          ))
        )}
      </div>
    </div>
  );
};

const SkillPreviewSection: React.FC<{
  groups: ParsedSkillGroupView[];
  selectedIds: Set<string>;
  duplicateIds: Set<string>;
  onToggleItem: (id: string) => void;
  onToggleAll: () => void;
}> = ({ groups, selectedIds, duplicateIds, onToggleItem, onToggleAll }) => {
  const allTags = flattenSkillTags(groups);
  const selectedCount = allTags.filter((tag) => selectedIds.has(tag.id)).length;
  const actionLabel = allTags.length
    ? selectedCount === allTags.length ? '取消全选' : '全选'
    : undefined;

  return (
    <div className="space-y-3">
      <SectionTitle
        title="专业技能"
        meta={allTags.length ? `${selectedCount}/${allTags.length}` : undefined}
        actionLabel={actionLabel}
        onAction={allTags.length ? onToggleAll : undefined}
      />
      {!groups.length ? (
        <EmptyPreviewCard label="未解析到专业技能" />
      ) : (
        <div className="space-y-3">
          {groups.map((group) => (
            <div
              key={group.category}
              className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-white/70 dark:bg-gray-900/40 p-4 space-y-2"
            >
              <div className="text-xs font-semibold text-gray-500 dark:text-gray-400">
                {group.category}
              </div>
              <div className="flex flex-wrap gap-2">
                {group.tags.map((tag) => (
                  <SkillTagItem
                    key={tag.id}
                    item={tag}
                    checked={selectedIds.has(tag.id)}
                    isDuplicate={duplicateIds.has(tag.id)}
                    onToggle={() => onToggleItem(tag.id)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const ModalHeader: React.FC<{
  onClose: () => void;
  actionLabel?: string;
  onAction?: () => void;
  hideDescription?: boolean;
}> = ({ onClose, actionLabel, onAction, hideDescription = false }) => (
  <div className="flex items-start justify-between gap-4">
    <div className="min-w-0">
      <p className="text-xs uppercase tracking-[0.3em] text-emerald-500">Resume Intake</p>
      <h3 className="text-2xl font-bold text-gray-900 dark:text-white">导入简历经验池</h3>
      {!hideDescription ? (
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          上传 PDF/DOCX，自动拆解 STAR 并智能查重。AI 深度分析约需 40-60 秒，请耐心等待。
        </p>
      ) : null}
    </div>
    <div className="flex shrink-0 items-center gap-2">
      {actionLabel && onAction ? (
        <button
          type="button"
          onClick={onAction}
          className="rounded-lg px-3 py-2 text-sm font-medium text-emerald-700 transition hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-900/20"
        >
          {actionLabel}
        </button>
      ) : null}
      <button
        type="button"
        onClick={onClose}
        className="rounded-full p-2 text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white transition"
      >
        <X className="w-5 h-5" />
      </button>
    </div>
  </div>
);

const UploadDropzone: React.FC<{
  isDragging: boolean;
  inputRef: React.RefObject<HTMLInputElement>;
  onFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onDrop: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragState: (next: boolean) => void;
}> = ({ isDragging, inputRef, onFileChange, onDrop, onDragState }) => (
  <div
    className={`relative rounded-2xl border-2 border-dashed px-6 py-8 text-center transition-all ${isDragging
      ? 'border-emerald-400 bg-emerald-50/70 dark:bg-emerald-900/20'
      : 'border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-900/40'
      }`}
    onDragOver={(event) => {
      event.preventDefault();
      onDragState(true);
    }}
    onDragLeave={() => onDragState(false)}
    onDrop={onDrop}
  >
    <UploadCloud className="w-10 h-10 text-emerald-500 mx-auto" />
    <p className="mt-3 text-sm font-medium text-gray-700 dark:text-gray-200">
      拖拽简历到这里，或点击选择文件
    </p>
    <p className="mt-1 text-xs text-gray-400">支持 PDF / DOCX</p>
    <input
      type="file"
      accept=".pdf,.docx"
      className="absolute inset-0 opacity-0 cursor-pointer"
      onClick={(event) => {
        event.currentTarget.value = '';
      }}
      onChange={onFileChange}
      ref={inputRef}
    />
  </div>
);

const FileStatusCard: React.FC<{
  file: File | null;
  stage: ParseStage;
  progress: number;
  errorMessage: string | null;
}> = ({ file, stage, progress, errorMessage }) => (
  <div className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-white/80 dark:bg-gray-900/60 p-4 space-y-3">
    <div className="flex items-center gap-3">
      <FileText className="w-5 h-5 text-gray-400" />
      <div className="flex-1">
        <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">
          {file ? file.name : '尚未选择文件'}
        </p>
        <p className="text-xs text-gray-400">状态：{STAGE_LABELS[stage]}</p>
      </div>
    </div>
    <ProgressSteps stage={stage} />
    <div className="h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
      <div
        className="h-full bg-emerald-500 transition-all duration-500"
        style={{ width: `${progress}%` }}
      />
    </div>
    {errorMessage && (
      <div className="flex items-start gap-2 rounded-lg bg-red-50 dark:bg-red-900/20 p-3 text-xs text-red-600 dark:text-red-300">
        <AlertTriangle className="w-4 h-4 mt-0.5" />
        <span>{errorMessage}</span>
      </div>
    )}
  </div>
);

const ThinkingTraceCard: React.FC<{
  stage: ParseStage;
  nodes: ThinkingNode[];
}> = ({ stage, nodes }) => {
  const latestNode = useMemo(() => {
    const candidates = [...nodes].reverse();
    return candidates.find((item) => extractThinkingHeadline(item.text)) || candidates[0] || null;
  }, [nodes]);
  const latestHeadline = latestNode ? extractThinkingHeadline(latestNode.text) : '';
  const displayText = latestHeadline
    || (stage === 'error'
      ? '思考流已中断'
      : stage === 'ready'
        ? '解析已完成'
        : '等待模型思考...');
  const clampedDisplayText = clampThinkingText(displayText);
  const animationKey = latestNode ? `${latestNode.id}-${latestHeadline}` : `idle-${stage}`;
  const isWorking = stage === 'uploading' || stage === 'parsing' || stage === 'analyzing';
  const isError = stage === 'error' || latestNode?.status === 'error';
  const renderedPrefix = isWorking ? '思考中 ·' : '';
  const iconClassName = isError
    ? 'text-red-500'
    : isWorking
      ? 'text-violet-600'
      : 'text-emerald-600';
  const cardClassName = isError
    ? 'border-red-100/80 bg-gradient-to-r from-red-50/95 via-white to-rose-50/80 shadow-[0_12px_30px_rgba(239,68,68,0.08)]'
    : isWorking
      ? 'border-violet-200/80 bg-[linear-gradient(120deg,rgba(245,243,255,0.96),rgba(255,255,255,0.92),rgba(237,233,254,0.95),rgba(224,231,255,0.92))] bg-[length:220%_220%] shadow-[0_16px_40px_rgba(124,58,237,0.16)]'
      : 'border-emerald-100/80 bg-gradient-to-r from-emerald-50/95 via-white to-teal-50/80 shadow-[0_12px_30px_rgba(16,185,129,0.08)]';

  return (
    <div className={`relative h-[70px] overflow-hidden rounded-2xl border px-4 py-3 ${cardClassName}`}>
      <style>{`
        @keyframes thinkingRollIn {
          0% {
            opacity: 0;
            transform: translateY(18px);
          }
          100% {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes thinkingCardGradient {
          0% {
            background-position: 0% 50%;
          }
          50% {
            background-position: 100% 50%;
          }
          100% {
            background-position: 0% 50%;
          }
        }
      `}</style>
      {isWorking ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(196,181,253,0.32),transparent_38%),radial-gradient(circle_at_bottom_right,rgba(129,140,248,0.24),transparent_42%)] opacity-90"
          style={{ animation: 'thinkingCardGradient 5s ease-in-out infinite' }}
        />
      ) : null}
      <div className="relative flex h-[44px] items-center gap-3">
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/85 shadow-sm ring-1 ${isWorking ? 'ring-violet-200/80' : 'ring-white/60'} ${iconClassName}`}>
          {isError ? (
            <AlertTriangle className="h-4.5 w-4.5" />
          ) : isWorking ? (
            <LoaderCircle className="h-4.5 w-4.5 animate-spin" />
          ) : (
            <CheckCircle2 className="h-4.5 w-4.5" />
          )}
        </div>
        <div className="min-w-0 flex-1 overflow-hidden">
          <div
            key={animationKey}
            className={`min-w-0 ${isError ? 'text-red-600' : isWorking ? 'bg-gradient-to-r from-violet-700 via-fuchsia-600 to-indigo-600 bg-[length:200%_auto] bg-clip-text text-transparent' : 'text-gray-900'}`}
            style={{
              animation: isWorking
                ? 'thinkingRollIn 360ms cubic-bezier(0.22, 1, 0.36, 1), thinkingCardGradient 3s linear infinite'
                : 'thinkingRollIn 360ms cubic-bezier(0.22, 1, 0.36, 1)',
            }}
          >
            <p className="flex items-center gap-1 overflow-hidden whitespace-nowrap text-sm font-semibold">
              {renderedPrefix ? (
                <span className="shrink-0">
                  {renderedPrefix}
                </span>
              ) : null}
              <span className="min-w-0 truncate">
                {clampedDisplayText}
              </span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

const UploadPanel: React.FC<{
  file: File | null;
  stage: ParseStage;
  progress: number;
  errorMessage: string | null;
  thinkingNodes: ThinkingNode[];
  isDragging: boolean;
  inputRef: React.RefObject<HTMLInputElement>;
  onFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onDrop: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragState: (next: boolean) => void;
  onReupload: () => void;
  showStatusCard?: boolean;
  showReupload?: boolean;
  showThinkingTrace?: boolean;
}> = ({
  file,
  stage,
  progress,
  errorMessage,
  thinkingNodes,
  isDragging,
  inputRef,
  onFileChange,
  onDrop,
  onDragState,
  onReupload,
  showStatusCard = true,
  showReupload = true,
  showThinkingTrace = true,
}) => (
    <div className="space-y-4">
      <UploadDropzone
        isDragging={isDragging}
        inputRef={inputRef}
        onFileChange={onFileChange}
        onDrop={onDrop}
        onDragState={onDragState}
      />
      {showStatusCard ? (
        <FileStatusCard file={file} stage={stage} progress={progress} errorMessage={errorMessage} />
      ) : errorMessage ? (
        <div className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-xs text-red-600 dark:bg-red-900/20 dark:text-red-300">
          <AlertTriangle className="mt-0.5 h-4 w-4" />
          <span>{errorMessage}</span>
        </div>
      ) : null}
      {showReupload ? (
        <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
          <span>默认已勾选非重复条目</span>
          <button type="button" onClick={onReupload} className="hover:text-emerald-600 transition">
            重新上传
          </button>
        </div>
      ) : null}
      {showThinkingTrace ? <ThinkingTraceCard stage={stage} nodes={thinkingNodes} /> : null}
    </div>
  );

const PreviewPanel: React.FC<{
  personalInfo?: ParsedPersonalInfo;
  personalInfoSelection: ParsedPersonalInfoSelection;
  onTogglePersonalInfo: (field: keyof ParsedPersonalInfoSelection) => void;
  items: ParsedExperienceItem[];
  selectedExperienceIds: Set<string>;
  onToggleExperience: (id: string) => void;
  onToggleExperienceGroup: (ids: string[]) => void;
  certifications: ParsedCertificationView[];
  selectedCertificationIds: Set<string>;
  onToggleCertification: (id: string) => void;
  onToggleAllCertifications: () => void;
  skillGroups: ParsedSkillGroupView[];
  selectedSkillIds: Set<string>;
  duplicateSkillIds: Set<string>;
  onToggleSkill: (id: string) => void;
  onToggleAllSkills: () => void;
}> = ({
  personalInfo,
  personalInfoSelection,
  onTogglePersonalInfo,
  items,
  selectedExperienceIds,
  onToggleExperience,
  onToggleExperienceGroup,
  certifications,
  selectedCertificationIds,
  onToggleCertification,
  onToggleAllCertifications,
  skillGroups,
  selectedSkillIds,
  duplicateSkillIds,
  onToggleSkill,
  onToggleAllSkills,
}) => {
    const workItems = items.filter((item) => item.category === 'work');
    const projectItems = items.filter((item) => item.category === 'project');
    const educationItems = items.filter((item) => item.category === 'education');

    return (
      <div className="space-y-4">
        <SectionTitle title="解析结果预览" />
        <div className="space-y-6 max-h-[420px] overflow-y-auto pr-2">
          <div className="space-y-3">
            <SectionTitle title="个人信息" />
            <PersonalInfoPreview
              info={personalInfo}
              selection={personalInfoSelection}
              onToggle={onTogglePersonalInfo}
            />
          </div>

          <ExperiencePreviewSection
            title="工作经历"
            emptyLabel="未解析到工作经历"
            items={workItems}
            selectedIds={selectedExperienceIds}
            onToggleItem={onToggleExperience}
            onToggleGroup={onToggleExperienceGroup}
          />

          <ExperiencePreviewSection
            title="项目经历"
            emptyLabel="未解析到项目经历"
            items={projectItems}
            selectedIds={selectedExperienceIds}
            onToggleItem={onToggleExperience}
            onToggleGroup={onToggleExperienceGroup}
          />

          <ExperiencePreviewSection
            title="教育背景"
            emptyLabel="未解析到教育背景"
            items={educationItems}
            selectedIds={selectedExperienceIds}
            onToggleItem={onToggleExperience}
            onToggleGroup={onToggleExperienceGroup}
          />

          <CertificationPreviewSection
            items={certifications}
            selectedIds={selectedCertificationIds}
            onToggleItem={onToggleCertification}
            onToggleAll={onToggleAllCertifications}
          />

          <SkillPreviewSection
            groups={skillGroups}
            selectedIds={selectedSkillIds}
            duplicateIds={duplicateSkillIds}
            onToggleItem={onToggleSkill}
            onToggleAll={onToggleAllSkills}
          />
        </div>
      </div>
    );
  };

const ModalFooter: React.FC<{
  selectedCount: number;
  onClose: () => void;
  onImport: () => void;
  isImporting: boolean;
}> = ({ selectedCount, onClose, onImport, isImporting }) => (
  <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
    <div className="text-sm text-gray-500 dark:text-gray-400">
      已选择 <span className="text-gray-900 dark:text-white font-semibold">{selectedCount}</span> 条
    </div>
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={onClose}
        className="px-4 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
      >
        取消
      </button>
      <button
        type="button"
        onClick={onImport}
        disabled={!selectedCount || isImporting}
        className="px-6 py-2 text-sm rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 transition disabled:opacity-50"
      >
        {isImporting ? '导入中...' : '导入所选'}
      </button>
    </div>
  </div>
);

const useResumeItems = () => {
  const [items, setItems] = useState<ParsedExperienceItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(buildEmptySet);

  const selectedItems = useMemo(
    () => items.filter((item) => selectedIds.has(item.id)),
    [items, selectedIds]
  );

  const applyParsedItems = useCallback((nextItems: ParsedExperienceItem[]) => {
    setItems(nextItems);
    setSelectedIds(buildDefaultSelection(nextItems));
  }, []);

  const resetSelection = useCallback(() => {
    setItems([]);
    setSelectedIds(buildEmptySet());
  }, []);

  const toggleSelection = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      if (prev.size === items.length) {
        return buildEmptySet();
      }
      return new Set(items.map((item) => item.id));
    });
  }, [items]);

  const toggleSelectionBatch = useCallback((ids: string[]) => {
    if (!ids.length) {
      return;
    }
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const isAllSelected = ids.every((id) => next.has(id));
      ids.forEach((id) => {
        if (isAllSelected) {
          next.delete(id);
        } else {
          next.add(id);
        }
      });
      return next;
    });
  }, []);

  return {
    items,
    selectedIds,
    selectedItems,
    applyParsedItems,
    resetSelection,
    toggleSelection,
    toggleSelectAll,
    toggleSelectionBatch,
  };
};

const useParsedCertifications = () => {
  const [items, setItems] = useState<ParsedCertificationView[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(buildEmptySet);

  const selectedItems = useMemo(
    () => items.filter((item) => selectedIds.has(item.id)),
    [items, selectedIds]
  );

  const applyParsedCertifications = useCallback((nextItems: ParsedCertification[]) => {
    const next = buildParsedCertifications(nextItems);
    setItems(next);
    setSelectedIds(new Set(next.map((item) => item.id)));
  }, []);

  const resetSelection = useCallback(() => {
    setItems([]);
    setSelectedIds(buildEmptySet());
  }, []);

  const toggleSelection = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      if (prev.size === items.length) {
        return buildEmptySet();
      }
      return new Set(items.map((item) => item.id));
    });
  }, [items]);

  return {
    items,
    selectedIds,
    selectedItems,
    applyParsedCertifications,
    resetSelection,
    toggleSelection,
    toggleSelectAll,
  };
};

const useParsedSkills = () => {
  const [groups, setGroups] = useState<ParsedSkillGroupView[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(buildEmptySet);
  const [duplicateIds, setDuplicateIds] = useState<Set<string>>(buildEmptySet);

  const allTags = useMemo(() => flattenSkillTags(groups), [groups]);
  const selectedTags = useMemo(
    () => allTags.filter((tag) => selectedIds.has(tag.id)),
    [allTags, selectedIds]
  );

  const applyParsedSkills = useCallback((
    nextItems: ParsedSkillGroup[],
    existingSkills?: UserSkill[]
  ) => {
    const nextGroups = buildParsedSkillGroups(nextItems);
    setGroups(nextGroups);
    const nextDuplicates = existingSkills
      ? buildSkillDuplicateIds(nextGroups, existingSkills)
      : buildEmptySet();
    setDuplicateIds(nextDuplicates);
    const nextSelected = new Set(
      flattenSkillTags(nextGroups)
        .filter((tag) => !nextDuplicates.has(tag.id))
        .map((tag) => tag.id)
    );
    setSelectedIds(nextSelected);
  }, []);

  const resetSelection = useCallback(() => {
    setGroups([]);
    setSelectedIds(buildEmptySet());
    setDuplicateIds(buildEmptySet());
  }, []);

  const toggleSelection = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      if (prev.size === allTags.length) {
        return buildEmptySet();
      }
      return new Set(allTags.map((tag) => tag.id));
    });
  }, [allTags]);

  return {
    groups,
    selectedIds,
    selectedTags,
    duplicateIds,
    applyParsedSkills,
    resetSelection,
    toggleSelection,
    toggleSelectAll,
  };
};

const useResumeParsing = (
  applyParsedItems: (items: ParsedExperienceItem[]) => void,
  applyParsedPersonalInfo: (info?: ParsedPersonalInfo) => void,
  applyParsedCertifications: (items: ParsedCertification[]) => void,
  applyParsedSkills: (items: ParsedSkillGroup[], existingSkills?: UserSkill[]) => void,
  toast: ToastHandlers
) => {
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<ParseStage>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [thinkingNodes, setThinkingNodes] = useState<ThinkingNode[]>(buildEmptyThinkingNodes);
  const longParseNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const parseErrorCountRef = useRef(0);
  const activeParseControllerRef = useRef<AbortController | null>(null);
  const parseRunIdRef = useRef(0);

  const clearLongParseNotice = useCallback(() => {
    if (longParseNoticeTimerRef.current) {
      clearTimeout(longParseNoticeTimerRef.current);
      longParseNoticeTimerRef.current = null;
    }
  }, []);

  const cancelActiveParse = useCallback(() => {
    const currentController = activeParseControllerRef.current;
    if (!currentController) {
      return;
    }
    activeParseControllerRef.current = null;
    currentController.abort();
  }, []);

  const resetParsing = useCallback(() => {
    cancelActiveParse();
    clearLongParseNotice();
    parseErrorCountRef.current = 0;
    setFile(null);
    setStage('idle');
    setErrorMessage(null);
    setIsDragging(false);
    setThinkingNodes(buildEmptyThinkingNodes());
  }, [cancelActiveParse, clearLongParseNotice]);

  const scheduleLongParseNotice = useCallback(() => {
    clearLongParseNotice();
    longParseNoticeTimerRef.current = setTimeout(() => {
      toast.info(LONG_PARSE_NOTICE_MESSAGE, LONG_PARSE_NOTICE_DURATION_MS);
      longParseNoticeTimerRef.current = null;
    }, LONG_PARSE_NOTICE_DELAY_MS);
  }, [clearLongParseNotice, toast]);

  const fetchExistingSkills = useCallback(async () => {
    try {
      return await skillsService.list({ force: true });
    } catch (error) {
      console.error('[ResumeUploadModal] Failed to fetch skills for dedupe:', error);
      return [];
    }
  }, []);

  const handleFileParse = useCallback(
    async (nextFile: File) => {
      cancelActiveParse();
      clearLongParseNotice();
      applyParsedItems([]);
      applyParsedPersonalInfo(undefined);
      applyParsedCertifications([]);
      applyParsedSkills([]);
      if (!isSupportedFile(nextFile)) {
        setErrorMessage('仅支持 PDF 或 DOCX 格式的简历。');
        setStage('error');
        return;
      }
      setErrorMessage(null);
      setStage('uploading');
      setFile(nextFile);
      setThinkingNodes(buildEmptyThinkingNodes());
      const currentRunId = parseRunIdRef.current + 1;
      parseRunIdRef.current = currentRunId;
      const abortController = new AbortController();
      let didTimeout = false;
      const isCurrentParseRun = () =>
        parseRunIdRef.current === currentRunId
        && activeParseControllerRef.current === abortController;

      try {
        activeParseControllerRef.current = abortController;
        await sleep(STAGE_TRANSITION_DELAY_MS);
        if (!isCurrentParseRun()) {
          return;
        }
        setStage('parsing');
        scheduleLongParseNotice();
        const response = await withTimeout(
          parserService.parseResume(
            nextFile,
            (event) => {
              if (!isCurrentParseRun()) {
                return;
              }
              if (event.type === 'progress') {
                setStage(getStageForTraceNode(event.node));
                return;
              }
              if (event.type === 'thought_reset') {
                setThinkingNodes(buildEmptyThinkingNodes());
                return;
              }
              if (event.type === 'thought') {
                setThinkingNodes((prev) => appendThinkingDelta(prev, event.summary));
              }
            },
            abortController.signal
          ),
          PARSE_TIMEOUT_MS,
          () => {
            didTimeout = true;
            abortController.abort();
          }
        );
        if (!isCurrentParseRun()) {
          return;
        }
        await sleep(STAGE_TRANSITION_DELAY_MS);
        if (!isCurrentParseRun()) {
          return;
        }
        setStage('analyzing');
        await sleep(STAGE_TRANSITION_DELAY_MS);
        if (!isCurrentParseRun()) {
          return;
        }
        applyParsedItems(response.items || []);
        applyParsedPersonalInfo(response.personal_info);
        applyParsedCertifications(response.certifications || []);
        const existingSkills = await fetchExistingSkills();
        if (!isCurrentParseRun()) {
          return;
        }
        applyParsedSkills(response.skills || [], existingSkills);
        setThinkingNodes((prev) => completeThinkingNodes(prev));
        setStage('ready');
        toast.success(PARSE_SUCCESS_MESSAGE);
        parseErrorCountRef.current = 0;
      } catch (error) {
        if (parseRunIdRef.current !== currentRunId) {
          return;
        }
        if (isAbortLikeError(error) && !didTimeout) {
          return;
        }
        const resolvedError =
          didTimeout && isAbortLikeError(error) ? createTimeoutError() : error;
        console.error('[ResumeUploadModal] Failed to parse resume:', error);
        parseErrorCountRef.current += 1;
        const message = buildParseErrorMessage(resolvedError, parseErrorCountRef.current);
        setErrorMessage(message);
        setThinkingNodes((prev) => failThinkingNodes(prev));
        setStage('error');
        toast.error(message);
      } finally {
        if (activeParseControllerRef.current === abortController) {
          activeParseControllerRef.current = null;
        }
        if (parseRunIdRef.current === currentRunId) {
          clearLongParseNotice();
        }
      }
    },
    [
      applyParsedItems,
      applyParsedPersonalInfo,
      applyParsedCertifications,
      applyParsedSkills,
      cancelActiveParse,
      clearLongParseNotice,
      fetchExistingSkills,
      scheduleLongParseNotice,
      toast,
    ]
  );

  const handleFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const nextFile = event.target.files?.[0];
      event.target.value = '';
      if (nextFile) {
        handleFileParse(nextFile);
      }
    },
    [handleFileParse]
  );

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const nextFile = event.dataTransfer.files?.[0];
      setIsDragging(false);
      if (nextFile) {
        handleFileParse(nextFile);
      }
    },
    [handleFileParse]
  );

  return {
    file,
    stage,
    errorMessage,
    isDragging,
    thinkingNodes,
    setIsDragging,
    handleFileChange,
    handleDrop,
    resetParsing,
  };
};

const useResumeImport = (
  selectedItems: ParsedExperienceItem[],
  selectedCertifications: ParsedCertificationView[],
  selectedSkillTags: ParsedSkillTagView[],
  personalInfoSelection: ParsedPersonalInfoSelection,
  toast: ToastHandlers,
  onImported: () => Promise<void> | void,
  onClose: () => void
) => {
  const [isImporting, setIsImporting] = useState(false);

  const handleImport = useCallback(async () => {
    const personalInfoSelectedCount = countSelectedPersonalInfo(personalInfoSelection);
    const totalSelected =
      selectedItems.length
      + selectedCertifications.length
      + selectedSkillTags.length
      + personalInfoSelectedCount;
    if (!totalSelected) {
      toast.error('请选择要导入的内容');
      return;
    }

    let toastId: string | null = null;
    try {
      setIsImporting(true);
      toastId = toast.loading('正在导入选择的内容...');
      let experienceCount = 0;
      let certificationCount = 0;
      let skillCount = 0;
      const unavailableModules: string[] = [];
      for (const item of selectedItems) {
        await experienceService.create({
          category: item.category,
          version: normalizeImportVersion(item.version),
        });
        experienceCount += 1;
      }
      let certificationPayloads: Awaited<ReturnType<typeof buildCertificationImportPayloads>> = [];
      try {
        certificationPayloads = await buildCertificationImportPayloads(selectedCertifications);
      } catch (error) {
        if (isHttpNotFoundError(error)) {
          unavailableModules.push('证书');
          console.warn('[ResumeUploadModal] Certifications API unavailable, skip import.', error);
        } else {
          throw error;
        }
      }
      let skillPayloads: Awaited<ReturnType<typeof buildSkillImportPayloads>> = [];
      try {
        skillPayloads = await buildSkillImportPayloads(selectedSkillTags);
      } catch (error) {
        if (isHttpNotFoundError(error)) {
          unavailableModules.push('技能');
          console.warn('[ResumeUploadModal] Skills API unavailable, skip import.', error);
        } else {
          throw error;
        }
      }
      for (const payload of certificationPayloads) {
        try {
          await certificationsService.create(payload);
        } catch (error) {
          if (isHttpNotFoundError(error)) {
            if (!unavailableModules.includes('证书')) {
              unavailableModules.push('证书');
            }
            console.warn('[ResumeUploadModal] Certifications API unavailable during create, skip rest.', error);
            break;
          }
          throw error;
        }
        certificationCount += 1;
      }
      for (const payload of skillPayloads) {
        try {
          await skillsService.create(payload);
        } catch (error) {
          if (isHttpNotFoundError(error)) {
            if (!unavailableModules.includes('技能')) {
              unavailableModules.push('技能');
            }
            console.warn('[ResumeUploadModal] Skills API unavailable during create, skip rest.', error);
            break;
          }
          throw error;
        }
        skillCount += 1;
      }
      const summaryParts = [];
      if (experienceCount > 0) {
        summaryParts.push(`已导入 ${experienceCount} 条经历`);
      }
      if (certificationCount > 0) {
        summaryParts.push(`已导入 ${certificationCount} 张证书`);
      }
      if (skillCount > 0) {
        summaryParts.push(`已导入 ${skillCount} 项技能`);
      }
      if (personalInfoSelectedCount > 0) {
        summaryParts.push(`已更新 ${personalInfoSelectedCount} 项个人信息`);
      }
      if (unavailableModules.length > 0) {
        summaryParts.push(`${unavailableModules.join('、')}模块暂不可用，已自动跳过`);
      }
      const summary = summaryParts.length ? summaryParts.join(' / ') : '没有新内容可导入';
      if (toastId) {
        toast.updateToast(toastId, {
          message: summary,
          type: 'success',
          duration: 2500,
        });
      } else {
        toast.success(summary);
      }
      trackExperienceBankImported({
        experienceCount,
        certificationCount,
        skillCount,
        personalInfoCount: personalInfoSelectedCount,
        totalSelected,
      });
      await onImported();
      onClose();
    } catch (error) {
      console.error('[ResumeUploadModal] Import failed:', error);
      if (toastId) {
        toast.updateToast(toastId, {
          message: '导入失败，请稍后重试',
          type: 'error',
          duration: 3000,
        });
      } else {
        toast.error('导入失败，请稍后重试');
      }
    } finally {
      setIsImporting(false);
    }
  }, [
    onClose,
    onImported,
    selectedItems,
    selectedCertifications,
    selectedSkillTags,
    personalInfoSelection,
    toast,
  ]);

  return { isImporting, handleImport };
};

const ResumeUploadModal: React.FC<ResumeUploadModalProps> = ({
  isOpen,
  onClose,
  onImported,
  profileSnapshot,
  toast,
}) => {
  const {
    items,
    selectedIds,
    selectedItems,
    applyParsedItems,
    resetSelection,
    toggleSelection,
    toggleSelectionBatch,
  } = useResumeItems();
  const {
    items: parsedCertifications,
    selectedIds: selectedCertificationIds,
    selectedItems: selectedCertifications,
    applyParsedCertifications,
    resetSelection: resetCertifications,
    toggleSelection: toggleCertification,
    toggleSelectAll: toggleAllCertifications,
  } = useParsedCertifications();
  const {
    groups: parsedSkillGroups,
    selectedIds: selectedSkillIds,
    selectedTags: selectedSkillTags,
    duplicateIds: duplicateSkillIds,
    applyParsedSkills,
    resetSelection: resetSkills,
    toggleSelection: toggleSkill,
    toggleSelectAll: toggleAllSkills,
  } = useParsedSkills();
  const [parsedPersonalInfo, setParsedPersonalInfo] = useState<ParsedPersonalInfo | undefined>(undefined);
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  const [personalInfoSelection, setPersonalInfoSelection] = useState<ParsedPersonalInfoSelection>(
    buildEmptyPersonalInfoSelection()
  );
  const hasTouchedPersonalInfoSelectionRef = useRef(false);
  const applyParsedPersonalInfo = useCallback(
    (info?: ParsedPersonalInfo) => {
      setParsedPersonalInfo(info);
      hasTouchedPersonalInfoSelectionRef.current = false;
      setPersonalInfoSelection(buildPersonalInfoSelection(info, profileSnapshot));
    },
    [profileSnapshot]
  );
  const togglePersonalInfoSelection = useCallback(
    (field: keyof ParsedPersonalInfoSelection) => {
      hasTouchedPersonalInfoSelectionRef.current = true;
      setPersonalInfoSelection((prev) => ({ ...prev, [field]: !prev[field] }));
    },
    []
  );
  useEffect(() => {
    if (!parsedPersonalInfo || hasTouchedPersonalInfoSelectionRef.current) {
      return;
    }
    setPersonalInfoSelection(buildPersonalInfoSelection(parsedPersonalInfo, profileSnapshot));
  }, [parsedPersonalInfo, profileSnapshot]);
  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 767px)');
    const handleChange = (event: MediaQueryListEvent) => {
      setIsMobile(event.matches);
    };
    setIsMobile(mediaQuery.matches);
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }
    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, []);
  const {
    file,
    stage,
    errorMessage,
    isDragging,
    thinkingNodes,
    setIsDragging,
    handleFileChange,
    handleDrop,
    resetParsing,
  } = useResumeParsing(
    applyParsedItems,
    applyParsedPersonalInfo,
    applyParsedCertifications,
    applyParsedSkills,
    toast
  );
  const { isImporting, handleImport } = useResumeImport(
    selectedItems,
    selectedCertifications,
    selectedSkillTags,
    personalInfoSelection,
    toast,
    () => onImported(parsedPersonalInfo, personalInfoSelection),
    onClose
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const progress = STAGE_PROGRESS[stage];
  const selectedTotalCount =
    selectedItems.length
    + selectedCertifications.length
    + selectedSkillTags.length
    + countSelectedPersonalInfo(personalInfoSelection);
  const resetAll = useCallback(() => {
    resetParsing();
    resetSelection();
    resetCertifications();
    resetSkills();
    setParsedPersonalInfo(undefined);
    setPersonalInfoSelection(buildEmptyPersonalInfoSelection());
    hasTouchedPersonalInfoSelectionRef.current = false;
  }, [resetParsing, resetSelection, resetCertifications, resetSkills]);
  const handleResetToUpload = useCallback(() => {
    resetAll();
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [resetAll]);
  const handleReupload = useCallback(() => {
    resetAll();
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  }, [resetAll]);
  const handleFileChangeWithReset = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const nextFile = event.target.files?.[0];
      if (nextFile) {
        resetAll();
      }
      handleFileChange(event);
    },
    [handleFileChange, resetAll]
  );
  const handleDropWithReset = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      const nextFile = event.dataTransfer.files?.[0];
      if (nextFile) {
        resetAll();
      }
      handleDrop(event);
    },
    [handleDrop, resetAll]
  );
  useEffect(() => {
    if (!isOpen) {
      resetAll();
    }
  }, [isOpen, resetAll]);
  const isReady = stage === 'ready';
  const shouldShowMobilePreview = isMobile && isReady;
  const shouldShowDesktopSplitLayout = !isMobile;
  const shouldShowFooter = !isMobile || isReady;
  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/50 backdrop-blur-md px-4">
      <div className="relative w-full max-w-5xl rounded-3xl border border-white/20 bg-gradient-to-br from-white/95 via-white/85 to-emerald-50/80 dark:from-gray-900 dark:via-gray-900/95 dark:to-emerald-900/20 shadow-2xl">
        <div className="absolute inset-x-0 -top-20 h-40 rounded-full bg-emerald-400/20 blur-3xl" />
        <div className="relative p-6">
          <ModalHeader
            onClose={onClose}
            actionLabel={shouldShowMobilePreview ? '重新上传' : undefined}
            onAction={shouldShowMobilePreview ? handleResetToUpload : undefined}
            hideDescription={shouldShowMobilePreview}
          />
          {shouldShowDesktopSplitLayout ? (
            <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1.1fr_1.9fr]">
              <UploadPanel
                file={file}
                stage={stage}
                progress={progress}
                errorMessage={errorMessage}
                thinkingNodes={thinkingNodes}
                isDragging={isDragging}
                inputRef={fileInputRef}
                onFileChange={handleFileChangeWithReset}
                onDrop={handleDropWithReset}
                onDragState={setIsDragging}
                onReupload={handleReupload}
              />
              <PreviewPanel
                personalInfo={parsedPersonalInfo}
                personalInfoSelection={personalInfoSelection}
                onTogglePersonalInfo={togglePersonalInfoSelection}
                items={items}
                selectedExperienceIds={selectedIds}
                onToggleExperience={toggleSelection}
                onToggleExperienceGroup={toggleSelectionBatch}
                certifications={parsedCertifications}
                selectedCertificationIds={selectedCertificationIds}
                onToggleCertification={toggleCertification}
                onToggleAllCertifications={toggleAllCertifications}
                skillGroups={parsedSkillGroups}
                selectedSkillIds={selectedSkillIds}
                duplicateSkillIds={duplicateSkillIds}
                onToggleSkill={toggleSkill}
                onToggleAllSkills={toggleAllSkills}
              />
            </div>
          ) : (
            <div className="mt-6">
              {shouldShowMobilePreview ? (
                <PreviewPanel
                  personalInfo={parsedPersonalInfo}
                  personalInfoSelection={personalInfoSelection}
                  onTogglePersonalInfo={togglePersonalInfoSelection}
                  items={items}
                  selectedExperienceIds={selectedIds}
                  onToggleExperience={toggleSelection}
                  onToggleExperienceGroup={toggleSelectionBatch}
                  certifications={parsedCertifications}
                  selectedCertificationIds={selectedCertificationIds}
                  onToggleCertification={toggleCertification}
                  onToggleAllCertifications={toggleAllCertifications}
                  skillGroups={parsedSkillGroups}
                  selectedSkillIds={selectedSkillIds}
                  duplicateSkillIds={duplicateSkillIds}
                  onToggleSkill={toggleSkill}
                  onToggleAllSkills={toggleAllSkills}
                />
              ) : (
                <UploadPanel
                  file={file}
                  stage={stage}
                  progress={progress}
                  errorMessage={errorMessage}
                  thinkingNodes={thinkingNodes}
                  isDragging={isDragging}
                  inputRef={fileInputRef}
                  onFileChange={handleFileChangeWithReset}
                  onDrop={handleDropWithReset}
                  onDragState={setIsDragging}
                  onReupload={handleReupload}
                  showStatusCard={false}
                  showReupload={false}
                  showThinkingTrace={stage !== 'idle'}
                />
              )}
            </div>
          )}
          {shouldShowFooter ? (
            <ModalFooter
              selectedCount={selectedTotalCount}
              onClose={onClose}
              onImport={handleImport}
              isImporting={isImporting}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default ResumeUploadModal;
