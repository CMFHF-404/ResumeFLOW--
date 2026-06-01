import React from 'react';
import AIPolishToolbar from '../../../components/AIPolishToolbar';
import type { PolishMode } from '../../../services/aiService';
import type { ExperienceEditDraft } from '../../../types/resume';
import FloatingPolishPreviewContent from './FloatingPolishPreviewContent';
import type { SmartCompletionPromptState } from '../smartCompletionUtils';

type ResumePolishMode = Exclude<PolishMode, 'assistant'>;

type SmartCompletionToolbarState = SmartCompletionPromptState & {
    onAnswerChange: (value: string) => void;
};

type ExperiencePolishToolbarsProps = {
    hasEditingItem: boolean;
    isEditingRunning: boolean;
    editingMode: ResumePolishMode;
    editingModeOptions: ResumePolishMode[];
    editingCustomPrompt: string;
    editingSmartCompletionPrompt: SmartCompletionPromptState | null;
    isEditingAssistantDisabled: boolean;
    onEditingModeChange: (mode: ResumePolishMode) => void;
    onEditingCustomPromptChange: (value: string) => void;
    onEditingSmartCompletionAnswerChange: (value: string) => void;
    onRunEditing: () => void;
    onUndoEditing: () => void;
    onConfirmEditing: () => void;
    onOpenEditingAssistant: () => void;

    hasActiveFloatingPolishExperience: boolean;
    isFloatingRunning: boolean;
    floatingMode: ResumePolishMode;
    floatingModeOptions: ResumePolishMode[];
    floatingCustomPrompt: string;
    floatingSmartCompletionPrompt: SmartCompletionPromptState | null;
    isFloatingAssistantDisabled: boolean;
    singlePreviewDraft: ExperienceEditDraft | null;
    onFloatingModeChange: (mode: ResumePolishMode) => void;
    onFloatingCustomPromptChange: (value: string) => void;
    onFloatingSmartCompletionAnswerChange: (value: string) => void;
    onRunFloating: () => void;
    onUndoFloating: () => void;
    onConfirmFloating: () => void;
    onOpenFloatingAssistant: () => void;

    isBatchOpen: boolean;
    batchActiveMode: ResumePolishMode;
    batchModeOptions: ResumePolishMode[];
    batchPreviewItemCount: number | null;
    batchPreviewFailedCount: number;
    onRunBatch: () => void;
    onUndoBatch: () => void;
    onConfirmBatch: () => void;
};

type ExperiencePolishToolbarElements = {
    editingSuggestionToolbar: React.ReactNode;
    floatingPolishToolbar: React.ReactNode;
    batchPolishToolbar: React.ReactNode;
};

const withSmartCompletionAnswerChange = (
    prompt: SmartCompletionPromptState | null,
    onAnswerChange: (value: string) => void
): SmartCompletionToolbarState | null => (
    prompt ? { ...prompt, onAnswerChange } : null
);

const buildBatchPreviewDescription = (itemCount: number | null, failedCount: number) => {
    if (itemCount === null) {
        return '执行后会并发润色当前已选经历，并同步到简历预览等待统一确认。';
    }
    return `已同步 ${itemCount} 条经历到简历预览，请确认是否统一保存。${failedCount > 0 ? ` 本次有 ${failedCount} 条未成功。` : ''}`;
};

const buildExperiencePolishToolbars = ({
    hasEditingItem,
    isEditingRunning,
    editingMode,
    editingModeOptions,
    editingCustomPrompt,
    editingSmartCompletionPrompt,
    isEditingAssistantDisabled,
    onEditingModeChange,
    onEditingCustomPromptChange,
    onEditingSmartCompletionAnswerChange,
    onRunEditing,
    onUndoEditing,
    onConfirmEditing,
    onOpenEditingAssistant,
    hasActiveFloatingPolishExperience,
    isFloatingRunning,
    floatingMode,
    floatingModeOptions,
    floatingCustomPrompt,
    floatingSmartCompletionPrompt,
    isFloatingAssistantDisabled,
    singlePreviewDraft,
    onFloatingModeChange,
    onFloatingCustomPromptChange,
    onFloatingSmartCompletionAnswerChange,
    onRunFloating,
    onUndoFloating,
    onConfirmFloating,
    onOpenFloatingAssistant,
    isBatchOpen,
    batchActiveMode,
    batchModeOptions,
    batchPreviewItemCount,
    batchPreviewFailedCount,
    onRunBatch,
    onUndoBatch,
    onConfirmBatch,
}: ExperiencePolishToolbarsProps): ExperiencePolishToolbarElements => {
    const editingSuggestionToolbar = hasEditingItem ? (
        <AIPolishToolbar
            isPreviewing={false}
            isRunning={isEditingRunning}
            activeMode={editingMode}
            modeOptions={editingModeOptions}
            customPrompt={editingCustomPrompt}
            smartCompletionPrompt={withSmartCompletionAnswerChange(
                editingSmartCompletionPrompt,
                onEditingSmartCompletionAnswerChange
            )}
            hasJdContext
            disabledAssistant={isEditingAssistantDisabled}
            compact
            onModeChange={onEditingModeChange}
            onCustomPromptChange={onEditingCustomPromptChange}
            onRun={onRunEditing}
            onUndo={onUndoEditing}
            onConfirm={onConfirmEditing}
            onOpenAssistant={onOpenEditingAssistant}
        />
    ) : null;

    const floatingPolishToolbar = hasActiveFloatingPolishExperience ? (
        <AIPolishToolbar
            isPreviewing={Boolean(singlePreviewDraft)}
            isRunning={isFloatingRunning}
            activeMode={floatingMode}
            modeOptions={floatingModeOptions}
            customPrompt={floatingCustomPrompt}
            smartCompletionPrompt={withSmartCompletionAnswerChange(
                floatingSmartCompletionPrompt,
                onFloatingSmartCompletionAnswerChange
            )}
            hasJdContext
            disabledAssistant={isFloatingAssistantDisabled}
            previewTitle="AI 润色结果"
            previewDescription="润色结果已同步到简历预览，确认后会保存到当前简历。"
            previewContent={
                singlePreviewDraft ? (
                    <FloatingPolishPreviewContent draft={singlePreviewDraft} />
                ) : undefined
            }
            onModeChange={onFloatingModeChange}
            onCustomPromptChange={onFloatingCustomPromptChange}
            onRun={onRunFloating}
            onUndo={onUndoFloating}
            onConfirm={onConfirmFloating}
            onOpenAssistant={onOpenFloatingAssistant}
        />
    ) : null;

    const batchPolishToolbar = isBatchOpen ? (
        <AIPolishToolbar
            isPreviewing={batchPreviewItemCount !== null}
            isRunning={isFloatingRunning}
            activeMode={batchActiveMode}
            modeOptions={batchModeOptions}
            customPrompt={floatingCustomPrompt}
            smartCompletionPrompt={withSmartCompletionAnswerChange(
                floatingSmartCompletionPrompt,
                onFloatingSmartCompletionAnswerChange
            )}
            hasJdContext
            disabledAssistant
            previewTitle="AI 批量润色结果"
            previewDescription={buildBatchPreviewDescription(batchPreviewItemCount, batchPreviewFailedCount)}
            runButtonLabel="开始批量润色"
            runningLabel="批量润色中..."
            undoLabel="撤销全部"
            confirmLabel="确认全部"
            onModeChange={onFloatingModeChange}
            onCustomPromptChange={onFloatingCustomPromptChange}
            onRun={onRunBatch}
            onUndo={onUndoBatch}
            onConfirm={onConfirmBatch}
            onOpenAssistant={() => {}}
        />
    ) : null;

    return {
        editingSuggestionToolbar,
        floatingPolishToolbar,
        batchPolishToolbar,
    };
};

export default buildExperiencePolishToolbars;
