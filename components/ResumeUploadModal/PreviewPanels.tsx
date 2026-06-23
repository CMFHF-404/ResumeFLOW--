import React, { useMemo } from 'react';
import {
  AlertTriangle,
  Brain,
  CheckCircle2,
  FileText,
  LoaderCircle,
  UploadCloud,
  Zap,
  X,
} from 'lucide-react';

import type {
  ParsedExperienceItem,
  ParsedPersonalInfo,
  ParsedPersonalInfoSelection,
} from '../../services/parserService';
import { stripRichTextToText } from '../../utils/richText';
import {
  clampThinkingText,
  extractThinkingHeadline,
  formatDateRange,
  normalizeParsedOptionalText,
  normalizeParsedText,
  type ParseStage,
  type ThinkingNode,
} from './parseUtils';
import {
  flattenSkillTags,
  type ParsedCertificationView,
  type ParsedSkillGroupView,
  type ParsedSkillTagView,
} from './derivedData';

const CATEGORY_LABELS: Record<string, string> = {
  work: '工作经历',
  education: '教育经历',
  project: '项目经历',
};
const DUPLICATE_LABEL = '可能重复';

const STAGE_LABELS = {
  uploading: '上传中',
  parsing: '解析中',
  analyzing: '查重中',
  ready: '完成',
  error: '失败',
  idle: '待上传',
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
  isDuplicate: boolean;
  onToggle: () => void;
}> = ({ item, checked, isDuplicate, onToggle }) => {
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
          {isDuplicate && (
            <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
              {DUPLICATE_LABEL}
            </span>
          )}
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
        {DUPLICATE_LABEL}
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
  duplicateIds: Set<string>;
  onToggleItem: (id: string) => void;
  onToggleAll: () => void;
}> = ({ items, selectedIds, duplicateIds, onToggleItem, onToggleAll }) => {
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
              isDuplicate={duplicateIds.has(item.id)}
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

export const ModalHeader: React.FC<{
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
    className={`relative rounded-2xl border-2 border-dashed px-5 py-6 text-center transition-all sm:px-6 sm:py-8 [@media(max-height:560px)]:py-2 ${isDragging
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
  <div className="space-y-3 rounded-2xl border border-gray-100 bg-white/80 p-4 dark:border-gray-800 dark:bg-gray-900/60 [@media(max-height:560px)]:space-y-2 [@media(max-height:560px)]:p-3">
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

const ThinkingTraceCardBody: React.FC<{
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

  return (
    <>
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
    </>
  );
};

const ParseModeCard: React.FC<{
  stage: ParseStage;
  nodes: ThinkingNode[];
  enableThinking: boolean;
  onEnableThinkingChange: (next: boolean) => void;
}> = ({ stage, nodes, enableThinking, onEnableThinkingChange }) => {
  const isWorking = stage === 'uploading' || stage === 'parsing' || stage === 'analyzing';
  const disableModeChange = stage !== 'idle' && stage !== 'error';
  const frontStatus = stage === 'error'
    ? '解析遇到问题，可重新上传后再试'
    : stage === 'ready'
      ? '解析完成，可检查并导入'
      : isWorking
        ? '正在解析，结果会自动更新'
        : '默认更快，点击切换专家模式';
  const backStatus = isWorking ? '正在显示模型思考过程' : '实时思考过程';
  const cardTone = stage === 'error'
    ? 'border-red-100/80 bg-gradient-to-r from-red-50/95 via-white to-rose-50/80'
    : enableThinking
      ? 'border-violet-200/80 bg-[linear-gradient(120deg,rgba(245,243,255,0.96),rgba(255,255,255,0.92),rgba(237,233,254,0.95),rgba(224,231,255,0.92))] bg-[length:220%_220%]'
      : 'border-emerald-100/80 bg-gradient-to-r from-emerald-50/95 via-white to-cyan-50/80';
  const faceBaseClassName = 'absolute inset-0 flex h-full w-full flex-col justify-center gap-2 px-4 py-3 transition-transform duration-500 [backface-visibility:hidden] [@media(max-height:560px)]:py-2';

  return (
    <div className={`relative h-[96px] overflow-hidden rounded-2xl border [@media(max-height:560px)]:h-[86px] ${cardTone}`}>
      <div
        className={`relative h-full w-full transition-transform duration-500 [transform-style:preserve-3d] ${enableThinking ? '[transform:rotateY(180deg)]' : ''}`}
      >
        <div
          className={`${faceBaseClassName} ${enableThinking ? 'pointer-events-none' : ''}`}
          aria-hidden={enableThinking}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">快速模式</p>
              <p className="truncate text-xs text-gray-500 dark:text-gray-400">{frontStatus}</p>
            </div>
            <button
              type="button"
              className={`relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/85 shadow-sm ring-1 transition hover:scale-105 disabled:cursor-not-allowed ${isWorking
                ? 'text-emerald-600 ring-emerald-100'
                : 'text-violet-600 ring-violet-100 hover:text-violet-700 disabled:text-gray-300'
                }`}
              disabled={disableModeChange}
              tabIndex={enableThinking ? -1 : 0}
              onClick={() => onEnableThinkingChange(true)}
              aria-label="切换到专家模式"
            >
              {isWorking ? (
                <>
                  <span className="absolute inset-0 rounded-full border-2 border-emerald-100 border-t-emerald-500 border-r-cyan-400 animate-spin" />
                  <LoaderCircle className="relative h-4 w-4 animate-spin" />
                </>
              ) : (
                <Brain className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>
        <div
          className={`${faceBaseClassName} [transform:rotateY(180deg)] ${enableThinking ? '' : 'pointer-events-none'}`}
          aria-hidden={!enableThinking}
        >
          <div className="relative flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-violet-900 dark:text-violet-100">专家模式</p>
              <p className="truncate text-xs text-violet-500 dark:text-violet-300">{backStatus}</p>
            </div>
            <button
              type="button"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/85 text-emerald-600 shadow-sm ring-1 ring-emerald-100 transition hover:scale-105 hover:text-emerald-700 disabled:cursor-not-allowed disabled:text-gray-300"
              disabled={disableModeChange}
              tabIndex={enableThinking ? 0 : -1}
              onClick={() => onEnableThinkingChange(false)}
              aria-label="切换到快速模式"
            >
              <Zap className="h-4 w-4" />
            </button>
          </div>
          <ThinkingTraceCardBody stage={stage} nodes={nodes} />
        </div>
      </div>
    </div>
  );
};

export const UploadPanel: React.FC<{
  file: File | null;
  stage: ParseStage;
  progress: number;
  errorMessage: string | null;
  thinkingNodes: ThinkingNode[];
  enableThinking: boolean;
  isDragging: boolean;
  inputRef: React.RefObject<HTMLInputElement>;
  onFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onDrop: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragState: (next: boolean) => void;
  onEnableThinkingChange: (next: boolean) => void;
  onReupload: () => void;
  modeCardPlacement?: 'afterDropzone' | 'bottom';
  showStatusCard?: boolean;
  showReupload?: boolean;
}> = ({
  file,
  stage,
  progress,
  errorMessage,
  thinkingNodes,
  enableThinking,
  isDragging,
  inputRef,
  onFileChange,
  onDrop,
  onDragState,
  onEnableThinkingChange,
  onReupload,
  modeCardPlacement = 'afterDropzone',
  showStatusCard = true,
  showReupload = true,
}) => {
  const modeCard = (
    <ParseModeCard
      stage={stage}
      nodes={thinkingNodes}
      enableThinking={enableThinking}
      onEnableThinkingChange={onEnableThinkingChange}
    />
  );

  return (
    <div className="space-y-4 [@media(max-height:560px)]:space-y-3">
      <UploadDropzone
        isDragging={isDragging}
        inputRef={inputRef}
        onFileChange={onFileChange}
        onDrop={onDrop}
        onDragState={onDragState}
      />
      {modeCardPlacement === 'afterDropzone' ? modeCard : null}
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
      {modeCardPlacement === 'bottom' ? modeCard : null}
    </div>
  );
};

export const PreviewPanel: React.FC<{
  personalInfo?: ParsedPersonalInfo;
  personalInfoSelection: ParsedPersonalInfoSelection;
  onTogglePersonalInfo: (field: keyof ParsedPersonalInfoSelection) => void;
  items: ParsedExperienceItem[];
  selectedExperienceIds: Set<string>;
  onToggleExperience: (id: string) => void;
  onToggleExperienceGroup: (ids: string[]) => void;
  certifications: ParsedCertificationView[];
  selectedCertificationIds: Set<string>;
  duplicateCertificationIds: Set<string>;
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
  duplicateCertificationIds,
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
      <div className="flex h-full min-h-0 flex-col space-y-4">
        <SectionTitle title="解析结果预览" />
        <div className="min-h-0 flex-1 touch-pan-y space-y-6 overflow-y-auto overscroll-contain pb-6 pr-2 [-webkit-overflow-scrolling:touch]">
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
            duplicateIds={duplicateCertificationIds}
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

export const ModalFooter: React.FC<{
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

