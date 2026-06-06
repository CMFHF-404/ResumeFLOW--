import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { PolishMode } from '../../../services/aiService';
import type { ExperienceEditDraft, PolishPreviewState } from '../../../types/resume';
import type { SmartCompletionPromptState } from '../smartCompletionUtils';

export type ResumePolishMode = Exclude<PolishMode, 'assistant'>;

export const DEFAULT_RESUME_POLISH_MODE: ResumePolishMode = 'default';

type UseResumeEditorExperiencePolishControlsParams = {
    editingExperienceId: string | null;
    setFloatingSmartCompletionPrompt: Dispatch<SetStateAction<SmartCompletionPromptState | null>>;
};

export function useResumeEditorExperiencePolishControls({
    editingExperienceId,
    setFloatingSmartCompletionPrompt,
}: UseResumeEditorExperiencePolishControlsParams) {
    const [experiencePolishMode, setExperiencePolishMode] =
        useState<ResumePolishMode>(DEFAULT_RESUME_POLISH_MODE);
    const [experienceCustomPrompt, setExperienceCustomPrompt] = useState('');
    const [experienceSmartCompletionPrompt, setExperienceSmartCompletionPrompt] =
        useState<SmartCompletionPromptState | null>(null);
    const [experiencePolishPreview, setExperiencePolishPreview] =
        useState<PolishPreviewState<ExperienceEditDraft> | null>(null);
    const [isEditingExperiencePolishRunning, setIsEditingExperiencePolishRunning] = useState(false);
    const editingExperiencePolishRunningRef = useRef(false);
    const [floatingPolishMode, setFloatingPolishMode] =
        useState<ResumePolishMode>(DEFAULT_RESUME_POLISH_MODE);
    const [floatingPolishCustomPrompt, setFloatingPolishCustomPrompt] = useState('');
    const [pendingPolishAutoAnalyzeSeq, setPendingPolishAutoAnalyzeSeq] = useState(0);

    useEffect(() => {
        setExperiencePolishMode(DEFAULT_RESUME_POLISH_MODE);
        setExperienceCustomPrompt('');
        setExperienceSmartCompletionPrompt(null);
        setExperiencePolishPreview(null);
        setIsEditingExperiencePolishRunning(false);
        editingExperiencePolishRunningRef.current = false;
    }, [editingExperienceId]);

    const handleExperiencePolishModeChange = useCallback((mode: ResumePolishMode) => {
        setExperiencePolishMode(mode);
        if (mode !== 'smart_complete') {
            setExperienceSmartCompletionPrompt(null);
        }
    }, []);

    const handleFloatingPolishModeChange = useCallback((mode: ResumePolishMode) => {
        setFloatingPolishMode(mode);
        if (mode !== 'smart_complete') {
            setFloatingSmartCompletionPrompt(null);
        }
    }, [setFloatingSmartCompletionPrompt]);

    return {
        experiencePolishMode,
        setExperiencePolishMode,
        experienceCustomPrompt,
        setExperienceCustomPrompt,
        experienceSmartCompletionPrompt,
        setExperienceSmartCompletionPrompt,
        experiencePolishPreview,
        setExperiencePolishPreview,
        isEditingExperiencePolishRunning,
        setIsEditingExperiencePolishRunning,
        editingExperiencePolishRunningRef,
        floatingPolishMode,
        setFloatingPolishMode,
        floatingPolishCustomPrompt,
        setFloatingPolishCustomPrompt,
        pendingPolishAutoAnalyzeSeq,
        setPendingPolishAutoAnalyzeSeq,
        handleExperiencePolishModeChange,
        handleFloatingPolishModeChange,
    };
}
