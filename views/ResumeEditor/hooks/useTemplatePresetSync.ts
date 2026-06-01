import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { resolveAuthUserKeyFromActiveSession } from '../../../services/apiClient';
import { profileService, type Profile } from '../../../services/profileService';
import {
    loadResumeTemplatePresetMap,
    syncResumeTemplatePresetsFromProfile,
    type ResumeTemplatePresetMap,
} from '../../resumeTemplateStorage';

const TEMPLATE_PRESET_SYNC_TIMEOUT_MS = 1500;

type UseTemplatePresetSyncResult = {
    templatePresetMap: ResumeTemplatePresetMap;
    setTemplatePresetMap: Dispatch<SetStateAction<ResumeTemplatePresetMap>>;
    isTemplatePresetMapReady: boolean;
    isTemplatePresetFallbackAvailable: boolean;
    templatePresetFallbackOwnerKey: string | null;
    handleOpenTemplateSelector: () => void;
    unlockTemplatePresetMapWithLocalFallback: (requestedAuthUserKey?: string | null) => void;
    refreshTemplatePresetMapForCurrentUser: (requestedAuthUserKey?: string | null) => void;
};

export const useTemplatePresetSync = (
    authUserKey: string | null,
    setIsTemplateSelectorOpen: Dispatch<SetStateAction<boolean>>
): UseTemplatePresetSyncResult => {
    const [templatePresetMap, setTemplatePresetMap] = useState(() => loadResumeTemplatePresetMap(authUserKey));
    const [isTemplatePresetMapReady, setIsTemplatePresetMapReady] = useState(false);
    const [isTemplatePresetFallbackAvailable, setIsTemplatePresetFallbackAvailable] = useState(false);
    const [templatePresetFallbackOwnerKey, setTemplatePresetFallbackOwnerKey] = useState<string | null>(authUserKey);
    const latestAuthUserKeyRef = useRef<string | null>(authUserKey);
    const templatePresetRequestIdRef = useRef(0);
    const templatePresetCompletedRequestIdRef = useRef(0);

    const applyTemplatePresetMapForCurrentUser = useCallback(async (
        requestId: number,
        requestedAuthUserKey: string | null | undefined,
        currentProfile?: Profile | null
    ) => {
        const ownerId = currentProfile?.user_id
            ?? requestedAuthUserKey
            ?? await resolveAuthUserKeyFromActiveSession();
        if (
            templatePresetRequestIdRef.current !== requestId
            || latestAuthUserKeyRef.current !== (requestedAuthUserKey ?? null)
        ) {
            return;
        }
        templatePresetCompletedRequestIdRef.current = requestId;
        const nextPresetMap = currentProfile?.extra_json
            ? syncResumeTemplatePresetsFromProfile(currentProfile.extra_json, ownerId)
            : loadResumeTemplatePresetMap(ownerId);
        setTemplatePresetMap(nextPresetMap);
        setIsTemplatePresetMapReady(Boolean(ownerId));
        setIsTemplatePresetFallbackAvailable(false);
        setTemplatePresetFallbackOwnerKey(ownerId ?? null);
    }, []);

    const unlockTemplatePresetMapWithLocalFallback = useCallback((requestedAuthUserKey?: string | null) => {
        const ownerId = requestedAuthUserKey ?? null;
        if (!ownerId) {
            return;
        }
        setTemplatePresetMap(loadResumeTemplatePresetMap(ownerId));
        setIsTemplatePresetMapReady(Boolean(ownerId));
        setIsTemplatePresetFallbackAvailable(false);
        setTemplatePresetFallbackOwnerKey(ownerId ?? null);
    }, []);

    const refreshTemplatePresetMapForCurrentUser = useCallback((requestedAuthUserKey?: string | null) => {
        const requestId = ++templatePresetRequestIdRef.current;
        setIsTemplatePresetMapReady(false);
        setIsTemplatePresetFallbackAvailable(false);
        setTemplatePresetFallbackOwnerKey(requestedAuthUserKey ?? null);
        const profilePromise = profileService
            .getProfile({ force: true })
            .catch(() => profileService.peekProfileForCurrentUser());
        let timeoutId: number | null = null;
        if (typeof window !== 'undefined') {
            timeoutId = window.setTimeout(async () => {
                const ownerId = requestedAuthUserKey ?? await resolveAuthUserKeyFromActiveSession();
                if (
                    templatePresetCompletedRequestIdRef.current === requestId
                    || templatePresetRequestIdRef.current !== requestId
                    || latestAuthUserKeyRef.current !== (requestedAuthUserKey ?? null)
                ) {
                    return;
                }
                setTemplatePresetFallbackOwnerKey(ownerId ?? null);
                setIsTemplatePresetFallbackAvailable(Boolean(ownerId));
            }, TEMPLATE_PRESET_SYNC_TIMEOUT_MS);
        }
        void profilePromise.then((currentProfile) => {
            if (timeoutId !== null && typeof window !== 'undefined') {
                window.clearTimeout(timeoutId);
            }
            void applyTemplatePresetMapForCurrentUser(requestId, requestedAuthUserKey, currentProfile);
        });
    }, [applyTemplatePresetMapForCurrentUser]);

    useEffect(() => {
        latestAuthUserKeyRef.current = authUserKey;
        const requestId = ++templatePresetRequestIdRef.current;
        setTemplatePresetMap(loadResumeTemplatePresetMap(authUserKey));
        setIsTemplatePresetMapReady(false);
        setIsTemplatePresetFallbackAvailable(false);
        setTemplatePresetFallbackOwnerKey(authUserKey ?? null);
        let cancelled = false;
        let timeoutId: number | null = null;
        const profilePromise = profileService
            .getProfile({ force: true })
            .catch(() => profileService.peekProfileForCurrentUser());
        if (typeof window !== 'undefined') {
            timeoutId = window.setTimeout(async () => {
                const ownerId = authUserKey ?? await resolveAuthUserKeyFromActiveSession();
                if (
                    templatePresetCompletedRequestIdRef.current === requestId
                    || templatePresetRequestIdRef.current !== requestId
                    || cancelled
                    || latestAuthUserKeyRef.current !== authUserKey
                ) {
                    return;
                }
                setTemplatePresetFallbackOwnerKey(ownerId ?? null);
                setIsTemplatePresetFallbackAvailable(Boolean(ownerId));
            }, TEMPLATE_PRESET_SYNC_TIMEOUT_MS);
        }
        void profilePromise.then((currentProfile) => {
            if (timeoutId !== null && typeof window !== 'undefined') {
                window.clearTimeout(timeoutId);
            }
            if (cancelled) {
                return;
            }
            void applyTemplatePresetMapForCurrentUser(requestId, authUserKey, currentProfile);
        });
        return () => {
            cancelled = true;
            if (timeoutId !== null && typeof window !== 'undefined') {
                window.clearTimeout(timeoutId);
            }
        };
    }, [applyTemplatePresetMapForCurrentUser, authUserKey]);

    const handleOpenTemplateSelector = useCallback(() => {
        setIsTemplateSelectorOpen(true);
        refreshTemplatePresetMapForCurrentUser(authUserKey);
    }, [authUserKey, refreshTemplatePresetMapForCurrentUser, setIsTemplateSelectorOpen]);

    return {
        templatePresetMap,
        setTemplatePresetMap,
        isTemplatePresetMapReady,
        isTemplatePresetFallbackAvailable,
        templatePresetFallbackOwnerKey,
        handleOpenTemplateSelector,
        unlockTemplatePresetMapWithLocalFallback,
        refreshTemplatePresetMapForCurrentUser,
    };
};
