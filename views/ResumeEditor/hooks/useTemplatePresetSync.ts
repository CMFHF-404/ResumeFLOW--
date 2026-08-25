import { useCallback, useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { isAuthContextChangedError } from '../../../services/apiClient';
import { profileService, type Profile } from '../../../services/profileService';
import {
    loadResumeTemplatePresetMap,
    syncResumeTemplatePresetsFromProfile,
    type ResumeTemplatePresetMap,
} from '../../../services/resumeTemplateStorage';

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
        const expectedAuthCacheKey = requestedAuthUserKey ?? null;
        const ownerId = currentProfile?.user_id ?? expectedAuthCacheKey;
        if (
            !expectedAuthCacheKey
            || !ownerId
            || ownerId !== expectedAuthCacheKey
            || templatePresetRequestIdRef.current !== requestId
            || latestAuthUserKeyRef.current !== expectedAuthCacheKey
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
        if (!ownerId || latestAuthUserKeyRef.current !== ownerId) {
            return;
        }
        setTemplatePresetMap(loadResumeTemplatePresetMap(ownerId));
        setIsTemplatePresetMapReady(Boolean(ownerId));
        setIsTemplatePresetFallbackAvailable(false);
        setTemplatePresetFallbackOwnerKey(ownerId ?? null);
    }, []);

    const refreshTemplatePresetMapForCurrentUser = useCallback((requestedAuthUserKey?: string | null) => {
        const expectedAuthCacheKey = requestedAuthUserKey ?? authUserKey;
        if (!expectedAuthCacheKey || expectedAuthCacheKey !== authUserKey) {
            return;
        }
        const requestId = ++templatePresetRequestIdRef.current;
        setIsTemplatePresetMapReady(false);
        setIsTemplatePresetFallbackAvailable(false);
        setTemplatePresetFallbackOwnerKey(expectedAuthCacheKey);
        const profilePromise = profileService
            .getProfile({ force: true, expectedAuthCacheKey })
            .catch((error) => {
                if (isAuthContextChangedError(error)) {
                    throw error;
                }
                return profileService.peekProfileForCurrentUser({ expectedAuthCacheKey });
            });
        let timeoutId: number | null = null;
        if (typeof window !== 'undefined') {
            timeoutId = window.setTimeout(() => {
                if (
                    templatePresetCompletedRequestIdRef.current === requestId
                    || templatePresetRequestIdRef.current !== requestId
                    || latestAuthUserKeyRef.current !== expectedAuthCacheKey
                ) {
                    return;
                }
                setTemplatePresetFallbackOwnerKey(expectedAuthCacheKey);
                setIsTemplatePresetFallbackAvailable(true);
            }, TEMPLATE_PRESET_SYNC_TIMEOUT_MS);
        }
        void profilePromise.then((currentProfile) => {
            if (timeoutId !== null && typeof window !== 'undefined') {
                window.clearTimeout(timeoutId);
            }
            void applyTemplatePresetMapForCurrentUser(requestId, expectedAuthCacheKey, currentProfile);
        }).catch((error) => {
            if (timeoutId !== null && typeof window !== 'undefined') {
                window.clearTimeout(timeoutId);
            }
            if (!isAuthContextChangedError(error)) {
                console.error('[ResumeEditor] 同步简历模板偏好失败:', error);
            }
        });
    }, [applyTemplatePresetMapForCurrentUser, authUserKey]);

    useLayoutEffect(() => {
        latestAuthUserKeyRef.current = authUserKey;
        const requestId = ++templatePresetRequestIdRef.current;
        setTemplatePresetMap(loadResumeTemplatePresetMap(authUserKey));
        setIsTemplatePresetMapReady(false);
        setIsTemplatePresetFallbackAvailable(false);
        setTemplatePresetFallbackOwnerKey(authUserKey ?? null);
        if (!authUserKey) {
            return;
        }
        let cancelled = false;
        let timeoutId: number | null = null;
        const profilePromise = profileService
            .getProfile({ force: true, expectedAuthCacheKey: authUserKey })
            .catch((error) => {
                if (isAuthContextChangedError(error)) {
                    throw error;
                }
                return profileService.peekProfileForCurrentUser({
                    expectedAuthCacheKey: authUserKey,
                });
            });
        if (typeof window !== 'undefined') {
            timeoutId = window.setTimeout(() => {
                if (
                    templatePresetCompletedRequestIdRef.current === requestId
                    || templatePresetRequestIdRef.current !== requestId
                    || cancelled
                    || latestAuthUserKeyRef.current !== authUserKey
                ) {
                    return;
                }
                setTemplatePresetFallbackOwnerKey(authUserKey);
                setIsTemplatePresetFallbackAvailable(true);
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
        }).catch((error) => {
            if (!isAuthContextChangedError(error)) {
                console.error('[ResumeEditor] 加载简历模板偏好失败:', error);
            }
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
