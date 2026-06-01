import { useCallback, useRef } from 'react';
import { aiService } from '../../../services/aiService';
import {
    clearPendingAssistantManualSaveDraft,
    type PendingAssistantManualSaveDraft,
} from '../../assistantManualSaveStorage';
import type { AssistantDraftApplyMeta } from '../../AIAssistant/types';
import {
    trackAiAssistantDraftApplied,
    trackAiPolishApplied,
} from '../../../utils/analyticsTracker';
import { buildPendingAssistantManualSaveDraftKey } from '../assistantDraftApplyUtils';
import { readErrorStatus } from '../snapshotUtils';

type UsePendingExperienceApplyStateParams = {
    resumeId: string | null;
    showToastError: (message: string, duration?: number) => string;
};

export const usePendingExperienceApplyState = ({
    resumeId,
    showToastError,
}: UsePendingExperienceApplyStateParams) => {
    const pendingAssistantApplyRef = useRef(new Map<string, AssistantDraftApplyMeta['persistApplied']>());
    const trackedPendingAssistantApplyRef = useRef(new Set<string>());
    const pendingAiPolishApplyRef = useRef(new Set<string>());
    const activeManualSaveDraftRef = useRef<PendingAssistantManualSaveDraft | null>(null);
    const appliedManualSaveDraftKeyRef = useRef<string | null>(null);

    const movePendingExperienceAssistantApply = useCallback((draftMasterId: string, savedMasterId: string) => {
        const pending = pendingAssistantApplyRef.current.get(draftMasterId);
        if (!pending || draftMasterId === savedMasterId) {
            return;
        }
        pendingAssistantApplyRef.current.delete(draftMasterId);
        pendingAssistantApplyRef.current.set(savedMasterId, pending);
        if (trackedPendingAssistantApplyRef.current.has(draftMasterId)) {
            trackedPendingAssistantApplyRef.current.delete(draftMasterId);
            trackedPendingAssistantApplyRef.current.add(savedMasterId);
        }
    }, []);

    const movePendingExperienceAiPolishApply = useCallback((draftMasterId: string, savedMasterId: string) => {
        if (draftMasterId === savedMasterId || !pendingAiPolishApplyRef.current.has(draftMasterId)) {
            return;
        }
        pendingAiPolishApplyRef.current.delete(draftMasterId);
        pendingAiPolishApplyRef.current.add(savedMasterId);
    }, []);

    const markPendingExperienceAiPolishApply = useCallback((masterId: string) => {
        pendingAiPolishApplyRef.current.add(masterId);
    }, []);

    const handleExperienceSaveSuccess = useCallback(async (masterId: string) => {
        let hasTrackedAssistantApply = false;
        const pending = pendingAssistantApplyRef.current.get(masterId);
        if (pending) {
            const shouldTrackAssistantApply = !trackedPendingAssistantApplyRef.current.has(masterId);
            try {
                await pending();
                pendingAssistantApplyRef.current.delete(masterId);
                trackedPendingAssistantApplyRef.current.delete(masterId);
            } catch (error) {
                if (shouldTrackAssistantApply) {
                    trackedPendingAssistantApplyRef.current.add(masterId);
                }
                console.error('[ResumeEditor] 同步 AI 草稿状态失败:', error);
                showToastError('已保存，但 AI 草稿状态同步失败，请稍后重试');
            }
            if (shouldTrackAssistantApply) {
                trackAiAssistantDraftApplied({
                    source: 'resume_editor',
                    cardType: 'experience',
                    callbackOnly: true,
                });
                hasTrackedAssistantApply = true;
            }
        }
        const activeManualSaveDraft = activeManualSaveDraftRef.current;
        const pendingManualSaveDraft = (
            activeManualSaveDraft
            && activeManualSaveDraft.resumeId === resumeId
            && activeManualSaveDraft.masterId === masterId
        )
            ? activeManualSaveDraft
            : null;
        if (pendingManualSaveDraft) {
            try {
                await aiService.markAssistantMessageApplied(
                    pendingManualSaveDraft.sessionId,
                    pendingManualSaveDraft.messageId,
                    { skipApply: true },
                );
                clearPendingAssistantManualSaveDraft({
                    sessionId: pendingManualSaveDraft.sessionId,
                    messageId: pendingManualSaveDraft.messageId,
                });
                activeManualSaveDraftRef.current = null;
                appliedManualSaveDraftKeyRef.current = null;
                if (!hasTrackedAssistantApply) {
                    trackAiAssistantDraftApplied({
                        source: 'resume_editor',
                        cardType: 'experience',
                        callbackOnly: true,
                    });
                }
            } catch (error) {
                const status = readErrorStatus(error);
                if (status === 404) {
                    clearPendingAssistantManualSaveDraft({
                        sessionId: pendingManualSaveDraft.sessionId,
                        messageId: pendingManualSaveDraft.messageId,
                    });
                    activeManualSaveDraftRef.current = null;
                    appliedManualSaveDraftKeyRef.current = null;
                    if (!hasTrackedAssistantApply) {
                        trackAiAssistantDraftApplied({
                            source: 'resume_editor',
                            cardType: 'experience',
                            callbackOnly: true,
                        });
                    }
                    return;
                }
                console.error('[ResumeEditor] 同步 AI 草稿状态失败:', error);
                showToastError('已保存，但 AI 草稿状态同步失败，请稍后重试');
                activeManualSaveDraftRef.current = pendingManualSaveDraft;
            }
        }
        if (pendingAiPolishApplyRef.current.has(masterId)) {
            trackAiPolishApplied({ source: 'resume_editor', field: 'all' });
            pendingAiPolishApplyRef.current.delete(masterId);
        }
    }, [resumeId, showToastError]);

    const clearPendingExperienceState = useCallback((masterId: string | null) => {
        if (!masterId) {
            return;
        }
        pendingAssistantApplyRef.current.delete(masterId);
        trackedPendingAssistantApplyRef.current.delete(masterId);
        pendingAiPolishApplyRef.current.delete(masterId);
        const activeManualSaveDraft = activeManualSaveDraftRef.current;
        if (
            activeManualSaveDraft
            && activeManualSaveDraft.resumeId === resumeId
            && activeManualSaveDraft.masterId === masterId
        ) {
            activeManualSaveDraftRef.current = null;
            appliedManualSaveDraftKeyRef.current = buildPendingAssistantManualSaveDraftKey(activeManualSaveDraft);
        }
    }, [resumeId]);

    return {
        activeManualSaveDraftRef,
        appliedManualSaveDraftKeyRef,
        clearPendingExperienceState,
        handleExperienceSaveSuccess,
        markPendingExperienceAiPolishApply,
        movePendingExperienceAiPolishApply,
        movePendingExperienceAssistantApply,
        pendingAiPolishApplyRef,
        pendingAssistantApplyRef,
        trackedPendingAssistantApplyRef,
    };
};
