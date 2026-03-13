import React from 'react';
import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import MonthPicker from './MonthPicker';
import type { EduCardData } from '../utils/educationUtils';
import { resolveCardMotionClass } from '../views/experienceUtils';

type EducationCardProps = {
    eduId: string;
    data: EduCardData;
    isExpanded: boolean;
    isCollapsing: boolean;
    isModified: boolean;
    isSaving: boolean;
    dateLabel: string;
    onToggle: () => void;
    onDelete: () => void;
    onSave: () => void;
    onCancel: () => void;
    onFieldChange: (field: keyof EduCardData, value: string) => void;
    setCardRef: (eduId: string, element: HTMLDivElement | null) => void;
};

const EducationTextField: React.FC<{
    label: string;
    value: string;
    placeholder?: string;
    onChange: (value: string) => void;
    className?: string;
    inputClassName?: string;
}> = ({ label, value, placeholder, onChange, className, inputClassName }) => (
    <div className={className}>
        <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1 block">{label}</label>
        <input
            className={`fluid-input ${inputClassName || 'text-base text-gray-700 dark:text-gray-300 placeholder-gray-300'} w-full`}
            placeholder={placeholder}
            value={value}
            onChange={(event) => onChange(event.target.value)}
        />
    </div>
);

const EducationMonthField: React.FC<{
    label: string;
    value: string;
    placeholder: string;
    onChange: (value: string) => void;
}> = ({ label, value, placeholder, onChange }) => (
    <div>
        <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1 block">{label}</label>
        <div className="h-[46px]">
            <MonthPicker
                value={value}
                onChange={onChange}
                placeholder={placeholder}
                className="w-full h-full"
            />
        </div>
    </div>
);

const EducationFields: React.FC<{
    data: EduCardData;
    onFieldChange: (field: keyof EduCardData, value: string) => void;
}> = ({ data, onFieldChange }) => (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <EducationTextField
            label="学校名称"
            value={data.school}
            placeholder="例如: 清华大学"
            onChange={(value) => onFieldChange('school', value)}
            className="md:col-span-2"
            inputClassName="text-lg font-bold text-gray-900 dark:text-white placeholder-gray-300"
        />
        <EducationTextField
            label="专业名称"
            value={data.major}
            placeholder="例如: 计算机科学与技术"
            onChange={(value) => onFieldChange('major', value)}
        />
        <EducationTextField
            label="学位/学历"
            value={data.degree}
            placeholder="例如: 本科 / 硕士"
            onChange={(value) => onFieldChange('degree', value)}
        />
        <EducationMonthField
            label="开始时间"
            value={data.startDate}
            placeholder="开始时间"
            onChange={(value) => onFieldChange('startDate', value)}
        />
        <EducationMonthField
            label="结束时间"
            value={data.endDate}
            placeholder="结束时间"
            onChange={(value) => onFieldChange('endDate', value)}
        />
        <EducationTextField
            label="GPA"
            value={data.gpa}
            placeholder="例如: 3.8/4.0"
            onChange={(value) => onFieldChange('gpa', value)}
        />
        <EducationTextField
            label="核心课程"
            value={data.courses}
            placeholder="例如: 数据结构、操作系统"
            onChange={(value) => onFieldChange('courses', value)}
        />
    </div>
);

const EducationCardCollapsed: React.FC<{
    data: EduCardData;
    dateLabel: string;
    isSaving: boolean;
    onToggle: () => void;
    onDelete: () => void;
}> = ({ data, dateLabel, isSaving, onToggle, onDelete }) => (
    <div
        className="p-5 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
        onClick={onToggle}
    >
        <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-1 min-w-0">
                    <h3 className="font-bold text-gray-900 dark:text-white truncate min-w-0 shrink">
                        {data.school || '未填写学校'}
                    </h3>
                    <span className="shrink-0 text-gray-300 dark:text-gray-600">|</span>
                    <span className="text-gray-700 dark:text-gray-300 font-medium truncate min-w-0 shrink">
                        {data.major || '未填写专业'}
                    </span>
                </div>
                {data.degree ? (
                    <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
                        {data.degree}
                    </p>
                ) : null}
                {dateLabel ? (
                    <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
                        {dateLabel}
                    </p>
                ) : null}
            </div>
            <div className="text-right shrink-0 flex items-center gap-2">
                <button
                    onClick={(event) => {
                        event.stopPropagation();
                        onDelete();
                    }}
                    className="text-gray-400 hover:text-red-500 transition-colors p-1 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                    title="删除"
                    disabled={isSaving}
                >
                    <Trash2 className="w-4 h-4" />
                </button>
                <ChevronDown className="w-5 h-5 text-gray-400" />
            </div>
        </div>
    </div>
);

const EducationCardActions: React.FC<{
    isModified: boolean;
    isSaving: boolean;
    onDelete: () => void;
    onSave: () => void;
    onCancel: () => void;
    onToggle: () => void;
}> = ({ isModified, isSaving, onDelete, onSave, onCancel, onToggle }) => (
    <div className="bg-gray-50 dark:bg-gray-800/50 px-6 py-3 border-t border-gray-100 dark:border-gray-800 flex items-center justify-end">
        <div className="flex items-center gap-2">
            <button
                onClick={onDelete}
                className="text-gray-400 hover:text-red-500 transition-colors p-2 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg mr-2"
                title="删除"
                disabled={isSaving}
            >
                <Trash2 className="w-4 h-4" />
            </button>

            {isModified ? (
                <>
                    <button
                        onClick={onCancel}
                        className="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white transition-colors text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
                        disabled={isSaving}
                    >
                        取消
                    </button>
                    <button
                        onClick={onSave}
                        className="flex items-center gap-2 text-sm font-medium text-white bg-primary hover:bg-sky-700 px-6 py-2 rounded-lg transition-colors shadow-sm shadow-sky-500/20 disabled:opacity-50"
                        disabled={isSaving}
                    >
                        {isSaving ? '保存中...' : '保存'}
                    </button>
                </>
            ) : (
                <button
                    onClick={onToggle}
                    className="flex items-center gap-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white px-4 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                    折叠
                    <ChevronUp className="w-4 h-4" />
                </button>
            )}
        </div>
    </div>
);

const EducationCardExpanded: React.FC<{
    data: EduCardData;
    isCollapsing: boolean;
    isModified: boolean;
    isSaving: boolean;
    onToggle: () => void;
    onDelete: () => void;
    onSave: () => void;
    onCancel: () => void;
    onFieldChange: (field: keyof EduCardData, value: string) => void;
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
            <EducationFields data={data} onFieldChange={onFieldChange} />
        </div>
        <EducationCardActions
            isModified={isModified}
            isSaving={isSaving}
            onDelete={onDelete}
            onSave={onSave}
            onCancel={onCancel}
            onToggle={onToggle}
        />
    </div>
);

const EducationCard: React.FC<EducationCardProps> = ({
    eduId,
    data,
    isExpanded,
    isCollapsing,
    isModified,
    isSaving,
    dateLabel,
    onToggle,
    onDelete,
    onSave,
    onCancel,
    onFieldChange,
    setCardRef,
}) => {
    const showExpanded = isExpanded || isCollapsing;

    return (
        <div
            ref={(element) => setCardRef(eduId, element)}
            className="bg-white dark:bg-surface-dark rounded-xl border border-sky-500/30 shadow-sm hover:shadow-md transition-all duration-300 overflow-hidden"
        >
            {showExpanded ? (
                <EducationCardExpanded
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
            ) : (
                <EducationCardCollapsed
                    data={data}
                    dateLabel={dateLabel}
                    isSaving={isSaving}
                    onToggle={onToggle}
                    onDelete={onDelete}
                />
            )}
        </div>
    );
};

export default EducationCard;
