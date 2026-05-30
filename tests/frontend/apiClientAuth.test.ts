import {
    clearCachedLogtoAccessTokens,
    removeCachedLogtoAccessTokenEntries,
} from '../../services/apiClientAuth.js';

class MemoryStorage implements Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
    private readonly values = new Map<string, string>();

    getItem(key: string): string | null {
        return this.values.get(key) ?? null;
    }

    setItem(key: string, value: string): void {
        this.values.set(key, value);
    }

    removeItem(key: string): void {
        this.values.delete(key);
    }
}

const assert = (condition: unknown, message: string) => {
    if (!condition) {
        throw new Error(message);
    }
};

const matchingResourceTokenMap = {
    'openid profile@https://api.example.com': {
        token: 'stale-api-token',
        expiresAt: 4_102_444_800,
    },
    'openid profile@https://other.example.com': {
        token: 'other-token',
        expiresAt: 4_102_444_800,
    },
};

const nextMap = removeCachedLogtoAccessTokenEntries(
    matchingResourceTokenMap,
    'https://api.example.com'
);

assert(
    !nextMap['openid profile@https://api.example.com'],
    'removes the access token for the unauthorized resource'
);
assert(
    nextMap['openid profile@https://other.example.com']?.token === 'other-token',
    'keeps cached tokens for other resources'
);

const storage = new MemoryStorage();
storage.setItem('logto:resume-app:accessToken', JSON.stringify(matchingResourceTokenMap));

const didClear = clearCachedLogtoAccessTokens(
    'resume-app',
    'https://api.example.com',
    storage
);
const storedMap = JSON.parse(storage.getItem('logto:resume-app:accessToken') || '{}') as Record<
    string,
    { token?: string }
>;

assert(didClear, 'reports that a cached token was cleared');
assert(
    !storedMap['openid profile@https://api.example.com'],
    'writes back the cache without the unauthorized resource token'
);
assert(
    storedMap['openid profile@https://other.example.com']?.token === 'other-token',
    'does not clear unrelated resource tokens from localStorage'
);
