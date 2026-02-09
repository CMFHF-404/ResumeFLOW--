import React from 'react';
import { ArrowUpDown, Award, Edit3, Plus, Trash2, ChevronDown } from 'lucide-react';
import MonthPicker, { DEFAULT_DATE_PICKER_PORTAL_ID } from '../../../components/MonthPicker';
import type { MatchTrend } from '../../../types/analysis';
import type { CertificationEditDraft, CertificationView } from '../../../types/resume';
import { ADD_CERTIFICATION_LABEL } from '../constants';
import { MatchBadge } from './Badges';

type CertificationListSectionProps = {
    title: string;
    items: CertificationView[];
    selectedIds: Set<string>;
    matchScores: Map<string, number>;
    matchTrends: Map<string, MatchTrend>;
    onToggleSelection: (id: string) => void;
    onBeginCreate: () => void;
    onBeginEdit: (id: string) => void;
    onCancelEdit: () => void;
    onSave: () => void;
    onDelete: (id: string) => void;
    onUpdateDraft: (field: keyof CertificationEditDraft, value: string) => void;
    draft: CertificationEditDraft | null;
    editingId: string | null;
    deletingIds: Set<string>;
    isSaving: boolean;
    onResetSort?: () => void;
};

const resolveCertificationMatchRate = (
    cert: CertificationView,
    matchScores: Map<string, number>
) => {
    const score = matchScores.get(cert.id);
    return typeof score === 'number' ? score : cert.matchRate;
};

const resolveCertificationMatchTrend = (
    cert: CertificationView,
    matchTrends: Map<string, MatchTrend>
) => matchTrends.get(cert.id);

const CertificationHeader: React.FC<{
    title: string;
    onCreate: () => void;
    onResetSort?: () => void;
    isCollapsed: boolean;
    onToggle: () => void;
}> = ({ title, onCreate, onResetSort, isCollapsed, onToggle }) => (
    <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
            <button
                onClick={onToggle}
                className="p-0.5 -ml-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
            >
                <ChevronDown
                    className={`w-3.5 h-3.5 transition-transform duration-200 ${isCollapsed ? '-rotate-90' : 'rotate-0'}`}
                />
            </button>
            <Award className="w-3.5 h-3.5 text-amber-500" />
            <h4
                className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer select-none"
                onClick={onToggle}
            >
                {title}
            </h4>
        </div>
        <div className="flex items-center gap-1">
            {onResetSort ? (
                <button
                    onClick={onResetSort}
                    title="重置为时间倒序"
                    aria-label="重置排序"
                    className="flex items-center justify-center text-gray-500 hover:text-amber-600 p-1 rounded-md hover:bg-amber-50"
                >
                    <ArrowUpDown className="w-3.5 h-3.5" />
                </button>
            ) : null}
            <button
                onClick={onCreate}
                title={ADD_CERTIFICATION_LABEL}
                aria-label={ADD_CERTIFICATION_LABEL}
                className="flex items-center justify-center text-gray-500 hover:text-amber-600 p-1 rounded-md hover:bg-amber-50"
            >
                <Plus className="w-3.5 h-3.5" />
            </button>
        </div>
    </div>
);

const CertificationForm: React.FC<{
    draft: CertificationEditDraft;
    onUpdate: (field: keyof CertificationEditDraft, value: string) => void;
}> = ({ draft, onUpdate }) => (
    <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
            <div>
                <label className="text-[10px] text-gray-400">证书名称</label>
                <input
                    className="w-full text-xs mt-0.5 p-2 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-1 focus:ring-amber-400 focus:border-amber-400"
                    value={draft.name}
                    onChange={(event) => onUpdate('name', event.target.value)}
                />
            </div>
            <div>
                <label className="text-[10px] text-gray-400">颁发机构</label>
                <input
                    className="w-full text-xs mt-0.5 p-2 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-1 focus:ring-amber-400 focus:border-amber-400"
                    value={draft.issuer}
                    onChange={(event) => onUpdate('issuer', event.target.value)}
                />
            </div>
        </div>
        <div>
            <label className="text-[10px] text-gray-400">取得时间 (YYYY.MM)</label>
            <div className="h-9 mt-0.5">
                <MonthPicker
                    value={draft.issueDate}
                    onChange={(val) => onUpdate('issueDate', val)}
                    placeholder="2026.07"
                    className="w-full h-full text-xs bg-white dark:bg-gray-900"
                    portalId={DEFAULT_DATE_PICKER_PORTAL_ID}
                />
            </div>
        </div>
    </div>
);

const CertificationEditCard: React.FC<{
    draft: CertificationEditDraft | null;
    onUpdateDraft: (field: keyof CertificationEditDraft, value: string) => void;
    onCancelEdit: () => void;
    onSave: () => void;
    isSaving: boolean;
}> = ({ draft, onUpdateDraft, onCancelEdit, onSave, isSaving }) => (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-amber-200/60 dark:border-amber-800/40 p-3 space-y-2">
        {draft ? <CertificationForm draft={draft} onUpdate={onUpdateDraft} /> : null}
        <div className="flex items-center justify-end gap-2">
            <button
                onClick={onCancelEdit}
                className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded"
                disabled={isSaving}
            >
                取消
            </button>
            <button
                onClick={onSave}
                className="text-xs font-semibold text-white bg-amber-500 hover:bg-amber-600 px-3 py-1 rounded disabled:opacity-60"
                disabled={isSaving}
            >
                {isSaving ? '保存中...' : '保存'}
            </button>
        </div>
    </div>
);

const CertificationItem: React.FC<{
    cert: CertificationView;
    isSelected: boolean;
    matchRate?: number;
    matchTrend?: MatchTrend;
    isEditing: boolean;
    draft: CertificationEditDraft | null;
    onToggleSelection: (id: string) => void;
    onBeginEdit: (id: string) => void;
    onCancelEdit: () => void;
    onSave: () => void;
    onDelete: (id: string) => void;
    onUpdateDraft: (field: keyof CertificationEditDraft, value: string) => void;
    deletingIds: Set<string>;
    isSaving: boolean;
}> = ({
    cert,
    isSelected,
    matchRate,
    isEditing,
    draft,
    onToggleSelection,
    onBeginEdit,
    onCancelEdit,
    onSave,
    onDelete,
    onUpdateDraft,
    deletingIds,
    isSaving,
    matchTrend,
}) => {
        if (isEditing) {
            return (
                <CertificationEditCard
                    draft={draft}
                    onUpdateDraft={onUpdateDraft}
                    onCancelEdit={onCancelEdit}
                    onSave={onSave}
                    isSaving={isSaving}
                />
            );
        }

        return (
            <CertificationDisplayCard
                cert={cert}
                isSelected={isSelected}
                matchRate={matchRate}
                matchTrend={matchTrend}
                onToggleSelection={onToggleSelection}
                onBeginEdit={onBeginEdit}
                onDelete={onDelete}
                deletingIds={deletingIds}
            />
        );
    };

const CertificationDisplayCard: React.FC<{
    cert: CertificationView;
    isSelected: boolean;
    matchRate?: number;
    matchTrend?: MatchTrend;
    onToggleSelection: (id: string) => void;
    onBeginEdit: (id: string) => void;
    onDelete: (id: string) => void;
    deletingIds: Set<string>;
}> = ({
    cert,
    isSelected,
    matchRate,
    matchTrend,
    onToggleSelection,
    onBeginEdit,
    onDelete,
    deletingIds,
}) => (
        <div
            className={`bg-white dark:bg-gray-800 rounded-xl border p-3 shadow-sm transition-all group relative cursor-pointer ${isSelected
                ? 'border-amber-500 ring-1 ring-amber-500/20'
                : 'border-amber-500/30 hover:shadow-md'
                }`}
            onClick={() => onToggleSelection(cert.id)}
        >
            <div className="flex items-start gap-3 group/card">
                <div className="flex flex-col items-center pt-1 shrink-0">
                    <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => onToggleSelection(cert.id)}
                        className="w-4 h-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500 cursor-pointer"
                        onClick={(event) => event.stopPropagation()}
                    />
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start mb-1">
                        <h4
                            className={`font-bold text-sm truncate ${isSelected ? 'text-gray-900 dark:text-white' : 'text-gray-700 dark:text-gray-200'}`}
                        >
                            {cert.name}
                        </h4>
                        <div className="flex items-center gap-1 shrink-0 ml-2">
                            <button
                                className="p-1 text-gray-300 rounded hover:text-red-500 hover:bg-red-50"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    onDelete(cert.id);
                                }}
                                disabled={deletingIds.has(cert.id)}
                                title="删除证书"
                                aria-label="删除证书"
                            >
                                <Trash2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                                className="p-1 text-gray-300 rounded hover:text-amber-600 hover:bg-amber-50"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    onBeginEdit(cert.id);
                                }}
                                title="编辑证书"
                                aria-label="编辑证书"
                            >
                                <Edit3 className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    </div>
                    {cert.issuer ? (
                        <p className="text-xs text-gray-500 dark:text-gray-400 mb-2 truncate">{cert.issuer}</p>
                    ) : null}
                    <div className="flex items-center justify-between mt-2">
                        <p className="text-[10px] text-gray-400 font-mono">{cert.date}</p>
                        {typeof matchRate === 'number' && matchRate > 0 ? (
                            <MatchBadge score={matchRate} trend={matchTrend} />
                        ) : null}
                    </div>
                </div>
            </div>
        </div>
    );

const CertificationListSection: React.FC<CertificationListSectionProps> = ({
    title,
    items,
    selectedIds,
    matchScores,
    matchTrends,
    onToggleSelection,
    onBeginCreate,
    onBeginEdit,
    onCancelEdit,
    onSave,
    onDelete,
    onUpdateDraft,
    draft,
    editingId,
    deletingIds,
    isSaving,
    onResetSort,
}) => {
    const [isCollapsed, setIsCollapsed] = React.useState(false);

    if (!items.length) {
        return (
            <div className="space-y-3">
                <CertificationHeader
                    title={title}
                    onCreate={onBeginCreate}
                    onResetSort={onResetSort}
                    isCollapsed={isCollapsed}
                    onToggle={() => setIsCollapsed(!isCollapsed)}
                />
                {!isCollapsed && <p className="text-xs text-gray-400">暂无证书</p>}
            </div>
        );
    }

    return (
        <div className="space-y-3">
            <CertificationHeader
                title={title}
                onCreate={onBeginCreate}
                onResetSort={onResetSort}
                isCollapsed={isCollapsed}
                onToggle={() => setIsCollapsed(!isCollapsed)}
            />
            {!isCollapsed && items.map((cert) => (
                <div key={cert.id} data-rf-edit-target={`certification:${cert.id}`}>
                    <CertificationItem
                        cert={cert}
                        isSelected={selectedIds.has(cert.id)}
                        matchRate={resolveCertificationMatchRate(cert, matchScores)}
                        matchTrend={resolveCertificationMatchTrend(cert, matchTrends)}
                        isEditing={editingId === cert.id && !!draft}
                        draft={draft}
                        onToggleSelection={onToggleSelection}
                        onBeginEdit={onBeginEdit}
                        onCancelEdit={onCancelEdit}
                        onSave={onSave}
                        onDelete={onDelete}
                        onUpdateDraft={onUpdateDraft}
                        deletingIds={deletingIds}
                        isSaving={isSaving}
                    />
                </div>
            ))}
        </div>
    );
};

export default CertificationListSection;
