import React, { useCallback } from 'react';
import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import MonthPicker from '../components/MonthPicker';
import { resolveCardMotionClass } from './experienceUtils';

export type CertificationCardData = {
    name: string;
    issuer: string;
    date: string;
    // We can add description here if we want to show it in the future
    description?: string;
};

type CertificationCardProps = {
    data: CertificationCardData;
    isExpanded: boolean;
    isCollapsing: boolean;
    isModified: boolean;
    isSaving: boolean;
    onToggle: () => void;
    onDelete: () => void;
    onSave: () => void;
    onCancel: () => void;
    onFieldChange: (field: keyof CertificationCardData, value: string) => void;
};

const CollapsedCertificationCard: React.FC<{
    data: CertificationCardData;
    onToggle: () => void;
    onDelete: () => void;
}> = ({ data, onToggle, onDelete }) => {
    const handleDelete = useCallback(
        (event: React.MouseEvent<HTMLButtonElement>) => {
            event.stopPropagation();
            onDelete();
        },
        [onDelete]
    );

    return (
        <div
            className="p-5 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
            onClick={onToggle}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => event.key === 'Enter' && onToggle()}
        >
            <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1">
                        <h3 className="font-bold text-gray-900 dark:text-white truncate">
                            {data.name || '未填写证书名称'}
                        </h3>
                        <span className="text-gray-300 dark:text-gray-600">|</span>
                        <span className="text-gray-700 dark:text-gray-300 font-medium truncate">
                            {data.issuer || '未填写颁发机构'}
                        </span>
                    </div>
                    <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
                        {data.date}
                    </p>
                </div>
                <div className="text-right shrink-0 flex items-center gap-2">
                    <button
                        onClick={handleDelete}
                        className="text-gray-400 hover:text-red-500 transition-colors p-1 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                        title="删除"
                        type="button"
                    >
                        <Trash2 className="w-4 h-4" />
                    </button>
                    <ChevronDown className="w-5 h-5 text-gray-400" />
                </div>
            </div>
        </div>
    );
};

const ExpandedCertificationCard: React.FC<{
    data: CertificationCardData;
    isCollapsing: boolean;
    isModified: boolean;
    isSaving: boolean;
    onToggle: () => void;
    onDelete: () => void;
    onSave: () => void;
    onCancel: () => void;
    onFieldChange: (field: keyof CertificationCardData, value: string) => void;
}> = ({
    data,
    isCollapsing,
    isModified,
    isSaving,
    onToggle,
    onDelete,
    onSave,
    onCancel,
    onFieldChange,
}) => (
        <div className={resolveCardMotionClass(isCollapsing)}>
            <div className="p-6 border-b border-gray-50 dark:border-gray-800/50">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="md:col-span-2">
                        <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1 block">
                            证书名称
                        </label>
                        <input
                            className="fluid-input text-lg font-bold text-gray-900 dark:text-white placeholder-gray-300 w-full"
                            placeholder="例如: PMP 项目管理专业人士"
                            value={data.name}
                            onChange={(e) => onFieldChange('name', e.target.value)}
                        />
                    </div>
                    <div>
                        <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1 block">
                            颁发机构
                        </label>
                        <input
                            className="fluid-input text-base text-gray-700 dark:text-gray-300 placeholder-gray-300 w-full"
                            placeholder="例如: PMI"
                            value={data.issuer}
                            onChange={(e) => onFieldChange('issuer', e.target.value)}
                        />
                    </div>
                    <div>
                        <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1 block">
                            获得时间
                        </label>
                        <div className="h-[46px]">
                            <MonthPicker
                                value={data.date}
                                onChange={(val) => onFieldChange('date', val)}
                                placeholder="获得时间"
                                className="w-full h-full"
                            />
                        </div>
                    </div>
                </div>
            </div>

            <div className="bg-gray-50 dark:bg-gray-800/50 px-6 py-3 border-t border-gray-100 dark:border-gray-800 flex items-center justify-end">
                <div className="flex items-center gap-2">
                    <button
                        onClick={onDelete}
                        className="text-gray-400 hover:text-red-500 transition-colors p-2 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg mr-2"
                        title="删除"
                        type="button"
                    >
                        <Trash2 className="w-4 h-4" />
                    </button>

                    {isModified ? (
                        <>
                            <button
                                onClick={onCancel}
                                className="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white transition-colors text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
                                disabled={isSaving}
                                type="button"
                            >
                                取消
                            </button>
                            <button
                                onClick={onSave}
                                className="flex items-center gap-2 text-sm font-medium text-white bg-amber-500 hover:bg-amber-600 px-6 py-2 rounded-lg transition-colors shadow-sm shadow-amber-500/20 disabled:opacity-50"
                                disabled={isSaving}
                                type="button"
                            >
                                {isSaving ? '保存中...' : '保存'}
                            </button>
                        </>
                    ) : (
                        <button
                            onClick={onToggle}
                            className="flex items-center gap-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white px-4 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                            type="button"
                        >
                            折叠
                            <ChevronUp className="w-4 h-4" />
                        </button>
                    )}
                </div>
            </div>
        </div>
    );

const CertificationCard: React.FC<CertificationCardProps> = ({
    data,
    isExpanded,
    isCollapsing,
    isModified,
    isSaving,
    onToggle,
    onDelete,
    onSave,
    onCancel,
    onFieldChange,
}) => {
    const showExpanded = isExpanded || isCollapsing;

    return (
        <div className="bg-white dark:bg-surface-dark rounded-xl border border-amber-500/30 shadow-sm hover:shadow-md transition-all duration-300 overflow-hidden">
            {!showExpanded ? (
                <CollapsedCertificationCard
                    data={data}
                    onToggle={onToggle}
                    onDelete={onDelete}
                />
            ) : (
                <ExpandedCertificationCard
                    data={data}
                    isCollapsing={isCollapsing}
                    isModified={isModified}
                    isSaving={isSaving}
                    onToggle={onToggle}
                    onDelete={onDelete}
                    onSave={onSave}
                    onCancel={onCancel}
                    onFieldChange={onFieldChange}
                />
            )}
        </div>
    );
};

export default CertificationCard;
