import React, { useState } from 'react';
import { Check, ChevronDown, ChevronUp, Sparkles } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { type AssistantDraftCard } from '../../services/aiService';

const markdownComponents = {
  p: ({node, ...props}: any) => <p className="m-0 whitespace-pre-wrap" {...props} />,
  strong: ({node, ...props}: any) => <strong className="font-bold text-slate-900" {...props} />,
  ul: ({node, ...props}: any) => <ul className="list-disc pl-5 m-0 space-y-1.5 marker:text-slate-400" {...props} />,
  ol: ({node, ...props}: any) => <ol className="list-decimal pl-5 m-0 space-y-1.5 marker:text-slate-400 marker:font-medium" {...props} />,
  li: ({node, ...props}: any) => <li className="pl-1 whitespace-pre-wrap" {...props} />,
  a: ({node, ...props}: any) => <a className="text-emerald-600 hover:underline hover:text-emerald-700 font-medium transition-colors" target="_blank" rel="noopener noreferrer" {...props} />,
  h1: ({node, ...props}: any) => <h1 className="text-lg font-bold text-slate-900 mt-4 mb-2" {...props} />,
  h2: ({node, ...props}: any) => <h2 className="text-base font-bold text-slate-900 mt-4 mb-2" {...props} />,
  h3: ({node, ...props}: any) => <h3 className="text-sm font-bold text-slate-900 mt-3 mb-1.5" {...props} />,
  blockquote: ({node, ...props}: any) => <blockquote className="border-l-4 border-slate-200 pl-4 italic text-slate-600 my-2 whitespace-pre-wrap" {...props} />,
  code: ({node, inline, ...props}: any) => inline 
    ? <code className="bg-slate-100 text-slate-800 px-1.5 py-0.5 rounded text-[13px] font-mono" {...props} />
    : <code className="block bg-slate-50 border border-slate-100 text-slate-800 p-3 rounded-lg text-[13px] font-mono overflow-x-auto whitespace-pre my-2 shadow-inner" {...props} />,
};

const EXPERIENCE_CATEGORY_LABELS = {
  work: '工作经历',
  project: '项目经历',
  education: '教育经历',
} as const;

export const AssistantDraftCardView: React.FC<{
  card: AssistantDraftCard;
  disabled?: boolean;
  isApplying?: boolean;
  onApply: () => void;
}> = ({ card, disabled, isApplying, onApply }) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const experienceApplyHint = card.type === 'experience'
    ? (card.data.targetMasterId ? '将更新现有经历' : '将新建经历')
    : null;
  const experienceCategoryLabel = card.type === 'experience'
    ? (EXPERIENCE_CATEGORY_LABELS[card.data.category] || card.data.category)
    : null;

  const renderContent = () => {
    if (card.type === 'experience') {
      return (
        <div className="space-y-3 mt-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-slate-100 bg-slate-50/50 px-4 py-3">
              <div className="text-[11px] uppercase tracking-wider text-slate-400">类别</div>
              <div className="mt-1 text-sm font-medium text-slate-800">{experienceCategoryLabel}</div>
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50/50 px-4 py-3">
              <div className="text-[11px] uppercase tracking-wider text-slate-400">时间</div>
              <div className="mt-1 text-sm font-medium text-slate-800">
                {card.data.startDate || '待补充'} - {card.data.isCurrent ? '至今' : (card.data.endDate || '待补充')}
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50/50 px-4 py-3">
            <div className="text-[11px] uppercase tracking-wider text-slate-400">主体</div>
            <div className="mt-1 text-base font-medium text-slate-800">{card.data.org || '待补充组织'} / {card.data.title || '待补充角色'}</div>
          </div>
          {!card.data.targetMasterId ? (
            <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 px-4 py-3">
              <div className="text-[11px] uppercase tracking-wider text-slate-500">录入方式</div>
              <div className="mt-1 text-sm font-medium text-slate-800">{experienceApplyHint}</div>
            </div>
          ) : null}
          <div className="grid gap-3">
            {([
              ['S', card.data.star.s],
              ['T', card.data.star.t],
              ['A', card.data.star.a],
              ['R', card.data.star.r],
            ] as const).map(([label, value]) => (
              <div key={label} className="rounded-xl border border-slate-100 bg-slate-50/50 px-4 py-3">
                <div className="text-[11px] uppercase tracking-wider text-slate-400">{label}</div>
                <div className="mt-2 text-sm leading-6 text-slate-600 space-y-2 break-words overflow-hidden">
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
            <div key={label} className="rounded-xl border border-slate-100 bg-slate-50/50 px-4 py-3">
              <div className="text-[11px] uppercase tracking-wider text-slate-400">{label}</div>
              <div className="mt-1 break-all text-sm font-medium text-slate-800">{value || '待补充'}</div>
            </div>
          ))}
          <div className="rounded-xl border border-slate-100 bg-slate-50/50 px-4 py-3 md:col-span-2">
            <div className="text-[11px] uppercase tracking-wider text-slate-400">描述</div>
            <div className="mt-2 text-sm leading-6 text-slate-600 space-y-2 break-words overflow-hidden">
              <ReactMarkdown components={markdownComponents}>
                {card.data.description || '待补充'}
              </ReactMarkdown>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-3 mt-4">
        <div className="rounded-xl border border-slate-100 bg-slate-50/50 px-4 py-3">
          <div className="text-[11px] uppercase tracking-wider text-slate-400">技能分类</div>
          <div className="mt-1 text-base font-medium text-slate-800">{card.data.category || '待补充'}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          {card.data.skills.map((skill) => (
            <div key={`${card.data.category}-${skill.name}`} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700">
              {skill.name}
              {typeof skill.proficiency === 'number' ? ` · ${skill.proficiency}` : ''}
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-all duration-300">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-600 border border-emerald-100">
            <Sparkles className="h-3 w-3" />
            可确认草稿
          </div>
          {experienceApplyHint ? (
            <div className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium border ${
              card.data.targetMasterId
                ? 'border-amber-200 bg-amber-50 text-amber-700'
                : 'border-sky-200 bg-sky-50 text-sky-700'
            }`}>
              {experienceApplyHint}
            </div>
          ) : null}
        </div>
          <h4 className="mt-1 text-sm font-semibold text-slate-800 truncate" title={card.summary}>
            {card.summary || 'AI 已整理出可录入初稿'}
          </h4>
        </div>
        
        <div className="flex shrink-0 items-center justify-between gap-1.5 sm:justify-end">
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-colors flex items-center gap-1"
            title={isExpanded ? '折叠' : '展开'}
          >
            {isExpanded ? (
              <>
                <span className="text-[11px]">收起</span>
                <ChevronUp className="h-3.5 w-3.5" />
              </>
            ) : (
              <>
                <span className="text-[11px]">展开</span>
                <ChevronDown className="h-3.5 w-3.5" />
              </>
            )}
          </button>
          
          <button
            type="button"
            onClick={onApply}
            disabled={disabled || isApplying}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm shadow-emerald-100 transition-all hover:bg-emerald-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-55"
          >
            <Check className="h-3.5 w-3.5" />
            {isApplying ? '录入中...' : '确认录入'}
          </button>
        </div>
      </div>
      
      {isExpanded && (
        <div className="animate-in fade-in slide-in-from-top-2 duration-300">
          {renderContent()}
          <p className="mt-4 text-[11px] text-slate-400 border-t border-slate-50 pt-3">
            如果还想调整，直接继续聊天描述你要修改的部分即可。
          </p>
        </div>
      )}
    </div>
  );
};
