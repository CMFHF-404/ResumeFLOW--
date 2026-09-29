import { assertAuthCacheKey, captureAuthCacheKey } from './apiClient';

export const createOwnerScopedListCache = <T>(
    requestList: (expectedAuthCacheKey: string) => Promise<T[]>,
    ttlMs: number,
) => {
    let cachedItems: T[] | null = null;
    let cachedAt = 0;
    let inFlightRequest: Promise<T[]> | null = null;
    let cacheRevision = 0;
    let cacheOwnerKey: string | null = null;

    const isCacheFresh = (now: number) => (
        !!cachedItems && now - cachedAt < ttlMs
    );

    const peekList = (options?: { allowStale?: boolean }) => {
        const now = Date.now();
        if (!cachedItems) {
            return null;
        }
        if (!options?.allowStale && !isCacheFresh(now)) {
            return null;
        }
        return cachedItems;
    };

    const clear = () => {
        cacheRevision += 1;
        cachedItems = null;
        cachedAt = 0;
        inFlightRequest = null;
    };

    const ensureCacheOwner = async (expectedAuthCacheKey?: string) => {
        const ownerKey = await captureAuthCacheKey(expectedAuthCacheKey);
        if (cacheOwnerKey !== ownerKey) {
            clear();
            cacheOwnerKey = ownerKey;
        }
        return ownerKey;
    };

    return {
        peekList,
        clear,

        async peekListForCurrentUser(
            options?: { allowStale?: boolean; expectedAuthCacheKey?: string },
        ) {
            await ensureCacheOwner(options?.expectedAuthCacheKey);
            return peekList(options);
        },

        async list(options?: { force?: boolean; expectedAuthCacheKey?: string }) {
            const requestOwnerKey = await ensureCacheOwner(options?.expectedAuthCacheKey);
            const shouldUseCache = !options?.force;
            const now = Date.now();
            if (shouldUseCache && isCacheFresh(now) && cachedItems) {
                return cachedItems;
            }
            // Force bypasses a cached result but still joins an active request.
            if (inFlightRequest) {
                return inFlightRequest;
            }
            const requestRevision = cacheRevision;
            const requestPromise = requestList(requestOwnerKey);
            const guardedPromise = (async () => {
                const data = await requestPromise;
                await assertAuthCacheKey(requestOwnerKey);
                if (cacheRevision === requestRevision) {
                    cachedItems = data;
                    cachedAt = Date.now();
                    return data;
                }
                // A mutation can invalidate this read without cancelling its caller.
                return cachedItems ?? data;
            })();
            inFlightRequest = guardedPromise;
            try {
                return await guardedPromise;
            } finally {
                if (inFlightRequest === guardedPromise) {
                    inFlightRequest = null;
                }
            }
        },
    };
};
