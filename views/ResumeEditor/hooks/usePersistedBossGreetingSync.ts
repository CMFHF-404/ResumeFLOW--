import { useEffect, useMemo, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { ResumeBossGreeting } from '../../../types/resume';
import {
    normalizePersistedBossGreeting,
    type PendingPersistedBossGreeting,
} from '../snapshotUtils';

type BossGreetingUiState = {
    text: string;
    signature: string;
    isVisible: boolean;
};

type UsePersistedBossGreetingSyncParams = {
    resumeId: string | null;
    persistedConfigBossGreeting: unknown;
    pendingPersistedBossGreetingRef: MutableRefObject<PendingPersistedBossGreeting | null>;
    bossGreetingUiStateRef: MutableRefObject<BossGreetingUiState>;
    setBossGreeting: Dispatch<SetStateAction<string>>;
    setBossGreetingSignature: Dispatch<SetStateAction<string>>;
    setIsBossGreetingVisible: Dispatch<SetStateAction<boolean>>;
};

export const usePersistedBossGreetingSync = ({
    resumeId,
    persistedConfigBossGreeting,
    pendingPersistedBossGreetingRef,
    bossGreetingUiStateRef,
    setBossGreeting,
    setBossGreetingSignature,
    setIsBossGreetingVisible,
}: UsePersistedBossGreetingSyncParams) => {
    const persistedBossGreeting = useMemo(
        () => normalizePersistedBossGreeting(persistedConfigBossGreeting as ResumeBossGreeting | null | undefined),
        [persistedConfigBossGreeting]
    );

    useEffect(() => {
        const nextGreeting = persistedBossGreeting?.greeting ?? '';
        const nextSignature = persistedBossGreeting?.signature ?? '';
        const pendingBossGreeting = pendingPersistedBossGreetingRef.current;
        if (
            pendingBossGreeting
            && pendingBossGreeting.resumeId === resumeId
            && (
                nextGreeting !== pendingBossGreeting.greeting
                || nextSignature !== (pendingBossGreeting.signature ?? '')
            )
        ) {
            return;
        }
        pendingPersistedBossGreetingRef.current = null;
        const shouldResetVisibility = (
            nextGreeting !== bossGreetingUiStateRef.current.text
            || nextSignature !== bossGreetingUiStateRef.current.signature
        );
        if (nextGreeting !== bossGreetingUiStateRef.current.text) {
            setBossGreeting(nextGreeting);
        }
        if (nextSignature !== bossGreetingUiStateRef.current.signature) {
            setBossGreetingSignature(nextSignature);
        }
        if (shouldResetVisibility) {
            setIsBossGreetingVisible(false);
        }
    }, [
        bossGreetingUiStateRef,
        pendingPersistedBossGreetingRef,
        persistedBossGreeting,
        resumeId,
        setBossGreeting,
        setBossGreetingSignature,
        setIsBossGreetingVisible,
    ]);
};
