import React, { useState } from 'react';
import { Check, ChevronDown, ChevronUp, Sparkles } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { type AssistantDraftCard } from '../../services/aiService';
import { getAssistantActionPreviewLines, getAssistantEducationDraftFields } from '../../utils/assistantDraft';

const markdownComponents = {
  p: ({node, ...props}: any) => <p className="m-0 whitespace-pre-wrap" {...props} />,
  strong: ({node, ...props}: any) => <strong className="font-bold text-slate-900 dark:text-slate-100" {...props} />,
  ul: ({node, ...props}: any) => <ul className="list-disc pl-5 m-0 space-y-1.5 marker:text-slate-400 dark:marker:text-slate-500" {...props} />,
  ol: ({node, ...props}: any) => <ol className="list-decimal pl-5 m-0 space-y-1.5 marker:text-slate-400 marker:font-medium dark:marker:text-slate-500" {...props} />,
  li: ({node, ...props}: any) => <li className="pl-1 whitespace-pre-wrap" {...props} />,
  a: ({node, ...props}: any) => <a className="text-emerald-600 hover:underline hover:text-emerald-700 font-medium transition-colors dark:text-emerald-300 dark:hover:text-emerald-200" target="_blank" rel="noopener noreferrer" {...props} />,
  h1: ({node, ...props}: any) => <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100 mt-4 mb-2" {...props} />,
  h2: ({node, ...props}: any) => <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 mt-4 mb-2" {...props} />,
  h3: ({node, ...props}: any) => <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mt-3 mb-1.5" {...props} />,
  blockquote: ({node, ...props}: any) => <blockquote className="border-l-4 border-slate-200 pl-4 italic text-slate-600 my-2 whitespace-pre-wrap dark:border-slate-700 dark:text-slate-300" {...props} />,
  code: ({node, inline, ...props}: any) => inline 
    ? <code className="bg-slate-100 text-slate-800 px-1.5 py-0.5 rounded text-[13px] font-mono dark:bg-slate-800 dark:text-slate-100" {...props} />
    : <code className="block bg-slate-50 border border-slate-100 text-slate-800 p-3 rounded-lg text-[13px] font-mono overflow-x-auto whitespace-pre my-2 shadow-inner dark:border-slate-700 dark:bg-slate-900/90 dark:text-slate-100" {...props} />,
};

const EXPERIENCE_CATEGORY_LABELS = {
  work: '工作经历',
  project: '项目经历',
  education: '教育经历',
} as const;

export const AssistantDraftCardView: React.FC<{
  card: AssistantDraftCard;
  disabled?: boolean;
  defaultExpanded?: boolean;
  expanded?: boolean;
  isApplied?: boolean;
  isApplying?: boolean;
  isManualSaveMode?: boolean;
  showManualSaveHint?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  onJumpToEditor?: () => void;
  onViewAppliedDraft?: () => void;
  onApply: () => void;
}> = ({ card, disabled, defaultExpanded = true, expanded, isApplied, isApplying, isManualSaveMode, showManualSaveHint, onExpandedChange, onJumpToEditor, onViewAppliedDraft, onApply }) => {
  const [uncontrolledExpanded, setUncontrolledExpanded] = useState(defaultExpanded);
  const isExpanded = expanded ?? uncontrolledExpanded;
  const setIsExpanded = (nextExpanded: boolean) => {
    if (expanded === undefined) {
      setUncontrolledExpanded(nextExpanded);
    }
    onExpandedChange?.(nextExpanded);
  };
  // 仅在 experience 类型时读取这两个字段，避免联合类型无法收窄的 TS 报错
  const hasTargetMaster = card.type === 'experience' && Boolean(card.data.targetMasterId);
  const experienceApplyHint = card.type === 'experience'
    ? (hasTargetMaster ? '将更新现有经历' : '将新建经历')
    : null;
  const skillGroupApplyHint = card.type === 'skill_group'
    ? '将合并更新技能组'
    : null;
  const applyButtonLabel = isApplying
    ? '录入中...'
    : isApplied && onViewAppliedDraft
      ? '查看经历'
      : isApplied
        ? '已录入'
      : showManualSaveHint
        ? '已同步'
        : '确认录入';
  const handlePrimaryAction = isApplied && onViewAppliedDraft ? onViewAppliedDraft : onApply;
  const isPrimaryActionDisabled = isApplying || (disabled && !(isApplied && onViewAppliedDraft));
  const experienceCategoryLabel = card.type === 'experience'
    ? (EXPERIENCE_CATEGORY_LABELS[card.data.category] || card.data.category)
    : null;
  const actionPreviewLines = getAssistantActionPreviewLines(card);
  const educationDraftFields = card.type === 'experience' && card.data.category === 'education'
    ? getAssistantEducationDraftFields(card)
    : [];

  const renderContent = () => {
    if (card.type === 'experience') {
      if (card.data.category === 'education') {
        return (
          <div className="space-y-3 mt-4">
            <div className="grid grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-slate-100 bg-slate-50/50 px-4 py-3 dark:border-slate-700 dark:bg-slate-900/80">
                <div className="text-[11px] uppercase tracking-wider text-slate-400 dark:text-slate-500">类别</div>
                <div className="mt-1 break-words text-sm font-medium text-slate-800 dark:text-slate-100">{experienceCategoryLabel}</div>
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50/50 px-4 py-3 dark:border-slate-700 dark:bg-slate-900/80">
                <div className="text-[11px] uppercase tracking-wider text-slate-400 dark:text-slate-500">时间</div>
                <div className="mt-1 break-words text-sm font-medium text-slate-800 dark:text-slate-100">
                  {card.data.startDate || '待补充'} - {card.data.isCurrent ? '至今' : (card.data.endDate || '待补充')}
                </div>
              </div>
            </div>
            {!card.data.targetMasterId ? (
              <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 px-4 py-3 dark:border-emerald-500/30 dark:bg-emerald-950/30">
                <div className="text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400">录入方式</div>
                <div className="mt-1 text-sm font-medium text-slate-800 dark:text-slate-100">{experienceApplyHint}</div>
              </div>
            ) : null}
            <div className="grid gap-3 md:grid-cols-2">
              {educationDraftFields.map(([label, value]) => (
                <div key={label} className={`rounded-xl border border-slate-100 bg-slate-50/50 px-4 py-3 dark:border-slate-700 dark:bg-slate-900/80 ${label === '课程' ? 'md:col-span-2' : ''}`}>
                  <div className="text-[11px] uppercase tracking-wider text-slate-400 dark:text-slate-500">{label}</div>
                  <div className="mt-2 text-sm leading-6 text-slate-600 space-y-2 break-words overflow-hidden dark:text-slate-300">
                    <ReactMarkdown components={markdownComponents}>
                      {value || '待补充'}
                    </ReactMarkdown>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      }

      return (
        <div className="space-y-3 mt-4">
          <div className="grid grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-slate-100 bg-slate-50/50 px-4 py-3 dark:border-slate-700 dark:bg-slate-900/80">
              <div className="text-[11px] uppercase tracking-wider text-slate-400 dark:text-slate-500">类别</div>
              <div className="mt-1 break-words text-sm font-medium text-slate-800 dark:text-slate-100">{experienceCategoryLabel}</div>
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50/50 px-4 py-3 dark:border-slate-700 dark:bg-slate-900/80">
              <div className="text-[11px] uppercase tracking-wider text-slate-400 dark:text-slate-500">时间</div>
              <div className="mt-1 break-words text-sm font-medium text-slate-800 dark:text-slate-100">
                {card.data.startDate || '待补充'} - {card.data.isCurrent ? '至今' : (card.data.endDate || '待补充')}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-[minmax(0,1.35fr)_minmax(0,0.65fr)] gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-slate-100 bg-slate-50/50 px-4 py-3 dark:border-slate-700 dark:bg-slate-900/80">
              <div className="text-[11px] uppercase tracking-wider text-slate-400 dark:text-slate-500">项目/公司名称</div>
              <div className="mt-1 break-words text-base font-medium text-slate-800 dark:text-slate-100">{card.data.org || '待补充组织'}</div>
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50/50 px-4 py-3 dark:border-slate-700 dark:bg-slate-900/80">
              <div className="text-[11px] uppercase tracking-wider text-slate-400 dark:text-slate-500">岗位/身份</div>
              <div className="mt-1 break-words text-base font-medium text-slate-800 dark:text-slate-100">{card.data.title || '待补充角色'}</div>
            </div>
          </div>
          {!card.data.targetMasterId ? (
            <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 px-4 py-3 dark:border-emerald-500/30 dark:bg-emerald-950/30">
              <div className="text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400">录入方式</div>
              <div className="mt-1 text-sm font-medium text-slate-800 dark:text-slate-100">{experienceApplyHint}</div>
            </div>
          ) : null}
          <div className="grid gap-3">
            {([
              ['S', card.data.star.s],
              ['T', card.data.star.t],
              ['A', card.data.star.a],
              ['R', card.data.star.r],
            ] as const).map(([label, value]) => (
              <div key={label} className="rounded-xl border border-slate-100 bg-slate-50/50 px-4 py-3 dark:border-slate-700 dark:bg-slate-900/80">
                <div className="text-[11px] uppercase tracking-wider text-slate-400 dark:text-slate-500">{label}</div>
                <div className="mt-2 text-sm leading-6 text-slate-600 space-y-2 break-words overflow-hidden dark:text-slate-300">
                  {label === 'A' && actionPreviewLines.length > 0 ? (
                    <div className="space-y-2">
                      {actionPreviewLines.map((line, index) => (
                        <div key={`action-${index}`} className="flex items-start gap-2.5">
                          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300 dark:bg-slate-600" />
                          <div
                            className="min-w-0 flex-1 whitespace-pre-wrap"
                            dangerouslySetInnerHTML={{ __html: line }}
                          />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <ReactMarkdown components={markdownComponents}>
                      {value || '待补充'}
                    </ReactMarkdown>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    }

    if (card.type === 'certification') {
      return (
        <div className="grid gap-3 md:grid-cols-2 mt-4">
          {[
            ['证书名称', card.data.name],
            ['颁发机构', card.data.issuer],
            ['获得时间', card.data.issueDate],
            ['到期时间', card.data.expiryDate],
            ['证书编号', card.data.credentialId],
            ['证书链接', card.data.credentialUrl],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border border-slate-100 bg-slate-50/50 px-4 py-3 dark:border-slate-700 dark:bg-slate-900/80">
              <div className="text-[11px] uppercase tracking-wider text-slate-400 dark:text-slate-500">{label}</div>
              <div className="mt-1 break-all text-sm font-medium text-slate-800 dark:text-slate-100">{value || '待补充'}</div>
            </div>
          ))}
          <div className="rounded-xl border border-slate-100 bg-slate-50/50 px-4 py-3 md:col-span-2 dark:border-slate-700 dark:bg-slate-900/80">
            <div className="text-[11px] uppercase tracking-wider text-slate-400 dark:text-slate-500">描述</div>
            <div className="mt-2 text-sm leading-6 text-slate-600 space-y-2 break-words overflow-hidden dark:text-slate-300">
              <ReactMarkdown components={markdownComponents}>
                {card.data.description || '待补充'}
              </ReactMarkdown>
            </div>
          </div>
        </div>
      );
    }

    if (card.type === 'skill_group') {
      return (
      <div className="space-y-3 mt-4">
        <div className="rounded-xl border border-slate-100 bg-slate-50/50 px-4 py-3 dark:border-slate-700 dark:bg-slate-900/80">
          <div className="text-[11px] uppercase tracking-wider text-slate-400 dark:text-slate-500">技能分类</div>
          <div className="mt-1 text-base font-medium text-slate-800 dark:text-slate-100">{card.data.category || '待补充'}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          {card.data.skills.map((skill) => (
            <div key={`${card.data.category}-${skill.name}`} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
              {skill.name}
            </div>
          ))}
        </div>
      </div>
      );
    }

    return null;
  };

  return (
    <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-all duration-300 dark:border-slate-700 dark:bg-slate-950 dark:shadow-[0_20px_60px_-30px_rgba(2,6,23,0.95)]">
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-100 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:border-emerald-500/30 dark:bg-emerald-950/40 dark:text-emerald-300">
              <Sparkles className="h-3 w-3" />
              可确认草稿
            </div>
            {isManualSaveMode ? (
              <div className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-300">
                单独保存
              </div>
            ) : null}
            {experienceApplyHint ? (
              <div className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium border ${
                hasTargetMaster
                  ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-300'
                  : 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/30 dark:bg-sky-950/40 dark:text-sky-300'
              }`}>
                {experienceApplyHint}
              </div>
            ) : null}
            {skillGroupApplyHint ? (
              <div className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-950/40 dark:text-emerald-300">
                {skillGroupApplyHint}
              </div>
            ) : null}
          </div>
          <h4 className="mt-1 truncate text-sm font-semibold text-slate-800 dark:text-slate-100" title={card.summary}>
            {card.summary || 'AI 已整理出可录入初稿'}
          </h4>
        </div>
      </div>
      
      {isExpanded && (
        <div className="animate-in fade-in slide-in-from-top-2 duration-300">
          {renderContent()}
        </div>
      )}

      <div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-800">
        {showManualSaveHint ? (
          <div className="mb-3 rounded-xl border border-amber-100 bg-amber-50/80 px-3 py-2 text-[11px] leading-5 text-amber-700 dark:border-amber-500/20 dark:bg-amber-950/30 dark:text-amber-200">
            这张草稿已经同步到编辑区，仍需在编辑区点击保存后才会正式生效。
            {onJumpToEditor ? (
              <button
                type="button"
                onClick={onJumpToEditor}
                className="ml-1 font-medium underline underline-offset-2 transition-colors hover:text-amber-800 dark:hover:text-amber-100"
              >
                点击前往
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="m-0 min-w-0 flex-1 text-[11px] leading-5 text-slate-400 dark:text-slate-500">
            如果还想调整，直接继续聊天描述你要修改的部分即可。
          </p>
          <div className="flex shrink-0 items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-900 dark:hover:text-slate-100"
            title={isExpanded ? '折叠' : '展开'}
          >
            <span className="text-[11px]">{isExpanded ? '收起' : '展开'}</span>
            {isExpanded ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </button>

          <button
            type="button"
            onClick={handlePrimaryAction}
            disabled={isPrimaryActionDisabled}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium shadow-sm transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-55 ${
              isApplied && onViewAppliedDraft
                ? 'border border-emerald-200 bg-white text-emerald-700 shadow-slate-100 hover:border-emerald-300 hover:bg-emerald-50 dark:border-emerald-500/30 dark:bg-slate-950 dark:text-emerald-200 dark:shadow-none dark:hover:bg-emerald-500/10'
                : 'bg-emerald-600 text-white shadow-emerald-100 hover:bg-emerald-700 dark:shadow-emerald-950/60'
            }`}
          >
            <Check className="h-3.5 w-3.5" />
            {applyButtonLabel}
          </button>
          </div>
        </div>
      </div>
    </div>
  );
};
