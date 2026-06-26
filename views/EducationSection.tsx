import React from 'react';
import { GraduationCap, Plus, ChevronDown } from 'lucide-react';
import ConfirmDialog from '../components/ConfirmDialog';
import EducationCard from '../components/EducationCard';
import type { EducationManager } from '../hooks/useEducationManager';
import type { AssistantDraftApplyNavigation } from '../services/aiService';

type EducationSectionProps = {
    model: EducationManager;
    onCountChange?: (count: number | null) => void;
    focusRequest?: {
        requestId: number;
        category?: AssistantDraftApplyNavigation['category'];
        targetId?: string;
    } | null;
};

const EducationSectionHeader: React.FC<{
    isLoading: boolean;
    count: number;
    isCollapsed: boolean;
    onToggle: () => void;
}> = ({ isLoading, count, isCollapsed, onToggle }) => (
    <div className="flex items-center justify-between">
        <h2
            className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2 cursor-pointer select-none"
            onClick={onToggle}
        >
            <div className={`p-1 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors`}>
                <ChevronDown
                    className={`w-5 h-5 text-gray-400 transition-transform duration-200 ${isCollapsed ? '-rotate-90' : 'rotate-0'}`}
                />
            </div>
            <GraduationCap className="w-5 h-5 text-sky-500" />
            教育经历
            <span className="text-sm font-normal text-gray-400 ml-2">Education</span>
        </h2>
        <span className="text-xs font-mono text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">
            {isLoading ? '加载中...' : `${count} items`}
        </span>
    </div>
);

const AddEducationButton: React.FC<{
    onClick: () => void;
    disabled: boolean;
}> = ({ onClick, disabled }) => (
    <button
        onClick={onClick}
        disabled={disabled}
        className="w-full group border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-xl p-4 flex items-center justify-center gap-2 text-gray-500 hover:text-sky-600 hover:border-sky-500 hover:bg-sky-50 dark:hover:bg-sky-900/10 transition-all duration-300 disabled:opacity-60 disabled:cursor-not-allowed"
    >
        <div className="p-1 rounded-full bg-gray-200 dark:bg-gray-800 group-hover:bg-white group-hover:text-sky-600 transition-colors">
            <Plus className="w-5 h-5" />
        </div>
        <span className="font-medium">新增教育经历</span>
    </button>
);

const EducationCardList: React.FC<{ model: EducationManager }> = ({ model }) => (
    <>
        {model.sortedEducations.map((edu) => {
            const eduId = edu.master.id;
            const data = model.getEduCardData(edu);
            return (
                <EducationCard
                    key={eduId}
                    eduId={eduId}
                    data={data}
                    dateLabel={model.buildDateLabel(data)}
                    isExpanded={model.expandedEduCards.has(eduId)}
                    isCollapsing={model.collapsingEduCards.has(eduId)}
                    isModified={model.modifiedEduCards.has(eduId)}
                    isSaving={model.savingEduIds.has(eduId)}
                    onToggle={() => model.toggleEduCard(eduId)}
                    onDelete={() => model.requestDeleteEdu(eduId)}
                    onSave={() => model.handleSaveEdu(eduId)}
                    onCancel={() => model.handleCancelEditEdu(eduId)}
                    onFieldChange={(field, value) => model.updateEduField(eduId, field, value)}
                    setCardRef={model.setCardRef}
                />
            );
        })}
    </>
);

const DeleteDialog: React.FC<{
    isOpen: boolean;
    onCancel: () => void;
    onConfirm: () => void;
}> = ({ isOpen, onCancel, onConfirm }) => (
    <ConfirmDialog
        isOpen={isOpen}
        title="确认删除"
        description={
            <>
                确定要删除这条教育经历吗？
                <br />
                此操作无法撤销。
            </>
        }
        onCancel={onCancel}
        onConfirm={onConfirm}
    />
);

const EducationSection: React.FC<EducationSectionProps> = ({ model, onCountChange, focusRequest }) => {
    const [isCollapsed, setIsCollapsed] = React.useState(false);
    const lastFocusRequestIdRef = React.useRef<number | null>(null);

    React.useEffect(() => {
        onCountChange?.(model.isLoading ? null : model.educations.length);
    }, [model.educations.length, model.isLoading, onCountChange]);

    React.useEffect(() => {
        if (!focusRequest || focusRequest.category !== 'education' || !focusRequest.targetId || model.isLoading) {
            return;
        }
        if (lastFocusRequestIdRef.current === focusRequest.requestId) {
            return;
        }
        const targetExists = model.educations.some((item) => item.master.id === focusRequest.targetId);
        if (!targetExists) {
            return;
        }
        lastFocusRequestIdRef.current = focusRequest.requestId;
        setIsCollapsed(false);
        model.focusEduCard(focusRequest.targetId);
    }, [focusRequest, model]);

    return (
        <section className="space-y-6 pt-6 border-t border-gray-200 dark:border-gray-800">
            <EducationSectionHeader
                isLoading={model.isLoading}
                count={model.educations.length}
                isCollapsed={isCollapsed}
                onToggle={() => setIsCollapsed(!isCollapsed)}
            />
            {!isCollapsed && (
                <>
                    <AddEducationButton
                        onClick={model.handleAddEdu}
                        disabled={model.isLoading || model.isCreating}
                    />
                    <EducationCardList model={model} />
                </>
            )}
            <DeleteDialog
                isOpen={Boolean(model.deletingEduId)}
                onCancel={model.handleCancelDelete}
                onConfirm={model.handleConfirmDelete}
            />
        </section>
    );
};

export default EducationSection;
