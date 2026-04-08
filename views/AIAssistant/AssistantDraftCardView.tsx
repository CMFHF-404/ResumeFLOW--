import React from 'react';
import { Check, Sparkles } from 'lucide-react';
import { type AssistantDraftCard } from '../../services/aiService';

export const AssistantDraftCardView: React.FC<{
  card: AssistantDraftCard;
  disabled?: boolean;
  isApplying?: boolean;
  onApply: () => void;
}> = ({ card, disabled, isApplying, onApply }) => {
  const renderContent = () => {
    if (card.type === 'experience') {
      return (
        <div className="space-y-3 mt-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-slate-100 bg-slate-50/50 px-4 py-3">
              <div className="text-[11px] uppercase tracking-wider text-slate-400">类别</div>
              <div className="mt-1 text-sm font-medium text-slate-800">{card.data.category}</div>
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
          <div className="grid gap-3 md:grid-cols-2">
            {([
              ['S', card.data.star.s],
              ['T', card.data.star.t],
              ['A', card.data.star.a],
              ['R', card.data.star.r],
            ] as const).map(([label, value]) => (
              <div key={label} className="rounded-xl border border-slate-100 bg-slate-50/50 px-4 py-3">
                <div className="text-[11px] uppercase tracking-wider text-slate-400">{label}</div>
                <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600">{value || '待补充'}</div>
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
            <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600">{card.data.description || '待补充'}</div>
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
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm mt-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">
            <Sparkles className="h-3.5 w-3.5" />
            可确认草稿
          </div>
          <h4 className="mt-3 text-base font-semibold text-slate-800">{card.summary || 'AI 已整理出可录入初稿'}</h4>
        </div>
        <button
          type="button"
          onClick={onApply}
          disabled={disabled || isApplying}
          className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-55"
        >
          <Check className="h-4 w-4" />
          {isApplying ? '录入中...' : '确认录入'}
        </button>
      </div>
      {renderContent()}
      <p className="mt-4 text-xs text-slate-400">如果还想调整，直接继续聊天描述你要修改的部分即可。</p>
    </div>
  );
};
