import { useEffect, useRef } from 'react';

export type ResumeEditorExperienceFocusRequest = {
    requestId: number;
    targetId?: string;
} | null;

export type ResumeEditorExperienceFocusState = {
    handledRequestKey: string | null;
    openedRequestKey: string | null;
    missingNoticeRequestKey: string | null;
};

export type ResumeEditorExperienceFocusDecision = {
    kind: 'idle' | 'pending' | 'missing' | 'focus';
    requestId: number | null;
    targetId: string | null;
    shouldOpen: boolean;
    shouldNotifyMissing: boolean;
    nextState: ResumeEditorExperienceFocusState;
};

const INITIAL_FOCUS_STATE: ResumeEditorExperienceFocusState = {
    handledRequestKey: null,
    openedRequestKey: null,
    missingNoticeRequestKey: null,
};

export const resolveResumeEditorExperienceFocusDecision = ({
    request,
    isLoading,
    targetExists,
    state,
}: {
    request: ResumeEditorExperienceFocusRequest;
    isLoading: boolean;
    targetExists: boolean;
    state: ResumeEditorExperienceFocusState;
}): ResumeEditorExperienceFocusDecision => {
    const requestId = request?.requestId ?? null;
    const targetId = request?.targetId ?? null;
    const requestKey = requestId === null || !targetId
        ? null
        : `${requestId}:${targetId}`;
    if (!requestKey || state.handledRequestKey === requestKey) {
        return {
            kind: 'idle',
            requestId,
            targetId,
            shouldOpen: false,
            shouldNotifyMissing: false,
            nextState: requestId === null ? INITIAL_FOCUS_STATE : state,
        };
    }
    if (isLoading) {
        return {
            kind: 'pending',
            requestId,
            targetId,
            shouldOpen: false,
            shouldNotifyMissing: false,
            nextState: state,
        };
    }

    const shouldOpen = state.openedRequestKey !== requestKey;
    if (!targetExists) {
        const shouldNotifyMissing = state.missingNoticeRequestKey !== requestKey;
        return {
            kind: 'missing',
            requestId,
            targetId,
            shouldOpen,
            shouldNotifyMissing,
            nextState: {
                ...state,
                openedRequestKey: requestKey,
                missingNoticeRequestKey: requestKey,
            },
        };
    }

    return {
        kind: 'focus',
        requestId,
        targetId,
        shouldOpen: true,
        shouldNotifyMissing: false,
        nextState: {
            ...state,
            handledRequestKey: requestKey,
            openedRequestKey: requestKey,
        },
    };
};

type UseResumeEditorExperienceFocusRequestOptions = {
    request: ResumeEditorExperienceFocusRequest;
    isLoading: boolean;
    experienceItems: readonly { id: string }[];
    onOpenExperienceEditor: () => void;
    onStartEditing: (targetId: string) => void;
    onMissingTarget: () => void;
    onHandled?: (requestId: number) => void;
};

export const useResumeEditorExperienceFocusRequest = ({
    request,
    isLoading,
    experienceItems,
    onOpenExperienceEditor,
    onStartEditing,
    onMissingTarget,
    onHandled,
}: UseResumeEditorExperienceFocusRequestOptions): void => {
    const stateRef = useRef<ResumeEditorExperienceFocusState>(INITIAL_FOCUS_STATE);
    const onOpenExperienceEditorRef = useRef(onOpenExperienceEditor);
    const onStartEditingRef = useRef(onStartEditing);
    const onMissingTargetRef = useRef(onMissingTarget);
    const onHandledRef = useRef(onHandled);

    onOpenExperienceEditorRef.current = onOpenExperienceEditor;
    onStartEditingRef.current = onStartEditing;
    onMissingTargetRef.current = onMissingTarget;
    onHandledRef.current = onHandled;

    const requestId = request?.requestId ?? null;
    const targetId = request?.targetId ?? null;

    useEffect(() => {
        const targetExists = Boolean(
            targetId && experienceItems.some((item) => item.id === targetId),
        );
        const decision = resolveResumeEditorExperienceFocusDecision({
            request: requestId === null ? null : { requestId, targetId: targetId ?? undefined },
            isLoading,
            targetExists,
            state: stateRef.current,
        });
        stateRef.current = decision.nextState;

        if (decision.shouldOpen) {
            onOpenExperienceEditorRef.current();
        }
        if (decision.shouldNotifyMissing) {
            onMissingTargetRef.current();
        }
        if (decision.kind === 'focus' && decision.targetId) {
            onStartEditingRef.current(decision.targetId);
            if (decision.requestId !== null) {
                onHandledRef.current?.(decision.requestId);
            }
        }
    }, [experienceItems, isLoading, requestId, targetId]);
};
