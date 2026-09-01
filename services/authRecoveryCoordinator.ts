import { dispatchLoginRequired } from './authRedirect';

const AUTH_RECOVERY_STORAGE_KEY = 'resumeflow:auth-recovery-cycle:v1';
const AUTH_RECOVERY_ISSUE_EVENT = 'app:auth-recovery-issue';
const PAGE_INSTANCE_ID = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
const UNKNOWN_AUTHENTICATED_OWNER = '__authenticated_unknown_owner__';

export const AUTH_DEPENDENCY_MAX_PROBE_ATTEMPTS = 3;
const AUTH_DEPENDENCY_PROBE_DELAYS_MS = [1_500, 3_000, 6_000] as const;

export type AuthRecoveryIssue = {
    kind: 'dependency-unavailable' | 'reauth-failed' | 'auth-response-rejected';
    code: string;
    message: string;
};

type AuthRecoveryCycle = {
    ownerKey: string;
    pageInstanceId: string;
    status: 'login-requested' | 'blocked';
};

export type AuthFailureInput = {
    status?: number;
    data?: unknown;
    sessionOwnerKey?: string | null;
    isAuthenticated?: boolean;
    isCurrentSession: boolean;
};

export type AuthFailureOutcome =
    | 'ignored'
    | 'dependency-unavailable'
    | 'login-requested'
    | 'already-requested'
    | 'blocked';

let inMemoryCycle: AuthRecoveryCycle | null = null;
let hasInMemoryCycleAuthority = false;
let storageReadCapability: 'unknown' | 'available' | 'failed' = 'unknown';
let inMemoryIssue: AuthRecoveryIssue | null = null;

const getSessionStorage = (): Storage | null => {
    if (typeof window === 'undefined') {
        return null;
    }
    try {
        return window.sessionStorage;
    } catch {
        return null;
    }
};

const readCycle = (): AuthRecoveryCycle | null => {
    if (hasInMemoryCycleAuthority) {
        return inMemoryCycle;
    }
    const storage = getSessionStorage();
    if (!storage) {
        if (typeof window !== 'undefined') {
            storageReadCapability = 'failed';
        }
        return inMemoryCycle;
    }
    try {
        const raw = storage.getItem(AUTH_RECOVERY_STORAGE_KEY);
        storageReadCapability = 'available';
        if (!raw) {
            hasInMemoryCycleAuthority = true;
            inMemoryCycle = null;
            return inMemoryCycle;
        }
        const value = JSON.parse(raw) as Partial<AuthRecoveryCycle>;
        if (
            typeof value.ownerKey !== 'string'
            || typeof value.pageInstanceId !== 'string'
            || (value.status !== 'login-requested' && value.status !== 'blocked')
        ) {
            storage.removeItem(AUTH_RECOVERY_STORAGE_KEY);
            hasInMemoryCycleAuthority = true;
            inMemoryCycle = null;
            return inMemoryCycle;
        }
        inMemoryCycle = value as AuthRecoveryCycle;
        hasInMemoryCycleAuthority = true;
        return inMemoryCycle;
    } catch {
        storageReadCapability = 'failed';
        return inMemoryCycle;
    }
};

const writeCycle = (cycle: AuthRecoveryCycle | null): boolean => {
    inMemoryCycle = cycle;
    hasInMemoryCycleAuthority = true;
    if (typeof window === 'undefined') {
        return true;
    }
    if (storageReadCapability !== 'available') {
        return false;
    }
    const storage = getSessionStorage();
    if (!storage) {
        return false;
    }
    try {
        if (cycle) {
            storage.setItem(AUTH_RECOVERY_STORAGE_KEY, JSON.stringify(cycle));
        } else {
            storage.removeItem(AUTH_RECOVERY_STORAGE_KEY);
        }
        return true;
    } catch {
        if (cycle === null) {
            try {
                // Some restricted storage implementations reject removal but
                // still allow replacing the value. An empty tombstone is read
                // as no active recovery cycle on the next page.
                storage.setItem(AUTH_RECOVERY_STORAGE_KEY, '');
                return true;
            } catch {
                // Keep the persistent blocked record authoritative.
            }
        }
        // The in-memory fallback still protects the current page.
        return false;
    }
};

const isSameRecoveryOwner = (storedOwnerKey: string, currentOwnerKey: string) => (
    storedOwnerKey === currentOwnerKey
    || storedOwnerKey === UNKNOWN_AUTHENTICATED_OWNER
    || currentOwnerKey === UNKNOWN_AUTHENTICATED_OWNER
);

export const scheduleAuthDependencyProbe = (
    attempt: number,
    probe: () => void | Promise<void>,
): (() => void) | null => {
    if (
        !Number.isInteger(attempt)
        || attempt < 0
        || attempt >= AUTH_DEPENDENCY_MAX_PROBE_ATTEMPTS
    ) {
        return null;
    }
    const timer = setTimeout(() => {
        try {
            const result = probe();
            if (result && typeof result.catch === 'function') {
                void result.catch(() => undefined);
            }
        } catch {
            // The caller owns visible retry state; a failed probe never starts login.
        }
    }, AUTH_DEPENDENCY_PROBE_DELAYS_MS[attempt]);
    return () => clearTimeout(timer);
};

const publishIssue = (issue: AuthRecoveryIssue | null) => {
    inMemoryIssue = issue;
    if (typeof window === 'undefined') {
        return;
    }
    window.dispatchEvent(new CustomEvent(AUTH_RECOVERY_ISSUE_EVENT, {
        detail: issue,
    }));
};

const readString = (value: unknown): string => (
    typeof value === 'string' ? value.trim() : ''
);

const readObject = (value: unknown): Record<string, unknown> | null => (
    value !== null && typeof value === 'object'
        ? value as Record<string, unknown>
        : null
);

export const readAuthErrorCode = (data: unknown): string | null => {
    let candidate = data;
    if (typeof candidate === 'string') {
        try {
            candidate = JSON.parse(candidate);
        } catch {
            return null;
        }
    }
    const payload = readObject(candidate);
    const error = readObject(payload?.error);
    const detail = readObject(payload?.detail);
    const detailError = readObject(detail?.error);
    return (
        readString(error?.code)
        || readString(detailError?.code)
        || readString(detail?.code)
        || readString(payload?.code)
        || null
    );
};

const readAuthErrorMessage = (data: unknown): string => {
    let candidate = data;
    if (typeof candidate === 'string') {
        try {
            candidate = JSON.parse(candidate);
        } catch {
            return readString(candidate);
        }
    }
    const payload = readObject(candidate);
    const error = readObject(payload?.error);
    const detail = readObject(payload?.detail);
    const detailError = readObject(detail?.error);
    return (
        readString(error?.message)
        || readString(detailError?.message)
        || readString(detail?.message)
        || readString(payload?.message)
        || readString(payload?.detail)
    );
};

const isAuthDependencyFailure = (status: number | undefined, code: string | null, data: unknown) => {
    if (code === 'auth_dependency_unavailable') {
        return true;
    }
    const message = readAuthErrorMessage(data).toLowerCase();
    return (
        message.includes('jwks fetch failed')
        || (status === 503 && message.includes('auth dependency'))
    );
};

export const readAuthRecoveryIssue = (): AuthRecoveryIssue | null => {
    if (inMemoryIssue) {
        return inMemoryIssue;
    }
    const cycle = readCycle();
    if (cycle?.status === 'blocked') {
        return {
            kind: 'reauth-failed',
            code: 'reauth_cycle_blocked',
            message: '重新登录后认证仍未恢复。请手动重试或重新登录。',
        };
    }
    return null;
};

export const subscribeAuthRecoveryIssue = (
    handler: (issue: AuthRecoveryIssue | null) => void,
) => {
    if (typeof window === 'undefined') {
        return () => undefined;
    }
    const listener = (event: Event) => {
        handler((event as CustomEvent<AuthRecoveryIssue | null>).detail ?? null);
    };
    window.addEventListener(AUTH_RECOVERY_ISSUE_EVENT, listener as EventListener);
    return () => window.removeEventListener(
        AUTH_RECOVERY_ISSUE_EVENT,
        listener as EventListener,
    );
};

export const resetAuthRecoveryCycle = (): boolean => {
    if (!writeCycle(null)) {
        publishIssue({
            kind: 'reauth-failed',
            code: 'auth_recovery_storage_unavailable',
            message: '浏览器无法清除认证恢复状态。请检查浏览器存储权限后重试。',
        });
        return false;
    }
    publishIssue(null);
    return true;
};

export const handleAuthFailure = ({
    status,
    data,
    sessionOwnerKey,
    isAuthenticated = false,
    isCurrentSession,
}: AuthFailureInput): AuthFailureOutcome => {
    const recoveryOwnerKey = sessionOwnerKey
        ?? (isAuthenticated ? UNKNOWN_AUTHENTICATED_OWNER : null);
    if (!isCurrentSession || !recoveryOwnerKey) {
        return 'ignored';
    }

    const code = readAuthErrorCode(data);
    if (isAuthDependencyFailure(status, code, data)) {
        publishIssue({
            kind: 'dependency-unavailable',
            code: code ?? 'auth_dependency_unavailable',
            message: '认证服务暂时不可用，请稍后重试。当前登录状态不会被清除。',
        });
        return 'dependency-unavailable';
    }

    if (status !== 401) {
        return 'ignored';
    }

    const activeCycle = readCycle();
    if (
        activeCycle
        && isSameRecoveryOwner(activeCycle.ownerKey, recoveryOwnerKey)
        && activeCycle.pageInstanceId === PAGE_INSTANCE_ID
    ) {
        return 'already-requested';
    }

    if (code !== 'invalid_token' && code !== 'session_invalid') {
        publishIssue({
            kind: 'auth-response-rejected',
            code: code ?? 'unclassified_unauthorized',
            message: '认证请求被拒绝，但服务未确认令牌已失效。请稍后重试。',
        });
        return 'ignored';
    }

    if (activeCycle && isSameRecoveryOwner(activeCycle.ownerKey, recoveryOwnerKey)) {
        writeCycle({
            ...activeCycle,
            status: 'blocked',
        });
        publishIssue({
            kind: 'reauth-failed',
            code: 'reauth_cycle_blocked',
            message: '重新登录后认证仍未恢复。请手动重试或重新登录。',
        });
        return 'blocked';
    }

    const recoveryCycle: AuthRecoveryCycle = {
        ownerKey: recoveryOwnerKey,
        pageInstanceId: PAGE_INSTANCE_ID,
        status: 'login-requested',
    };
    if (!writeCycle(recoveryCycle)) {
        inMemoryCycle = {
            ...recoveryCycle,
            status: 'blocked',
        };
        hasInMemoryCycleAuthority = true;
        publishIssue({
            kind: 'reauth-failed',
            code: 'auth_recovery_storage_unavailable',
            message: '浏览器无法保存认证恢复状态。为避免重复跳转，请手动重试或重新登录。',
        });
        return 'blocked';
    }
    publishIssue(null);
    dispatchLoginRequired(
        code === 'session_invalid' ? 'session-invalid' : 'invalid-token',
    );
    return 'login-requested';
};

export const handleFetchAuthFailure = async (
    response: Response,
    sessionOwnerKey: string | null | undefined,
    isCurrentSession: boolean,
): Promise<AuthFailureOutcome> => {
    let data: unknown = null;
    try {
        data = await response.clone().json();
    } catch {
        try {
            data = await response.clone().text();
        } catch {
            data = null;
        }
    }
    return handleAuthFailure({
        status: response.status,
        data,
        sessionOwnerKey,
        isCurrentSession,
    });
};

export const markProtectedAuthSuccess = (
    url: string | undefined,
    status: number,
    sessionOwnerKey: string | null | undefined,
): boolean => {
    if (
        status < 200
        || status >= 300
        || !sessionOwnerKey
        || !url
        || !/\/(?:api\/)?profile\/?(?:[?#]|$)/.test(url)
    ) {
        return false;
    }
    const cycle = readCycle();
    if (cycle && !isSameRecoveryOwner(cycle.ownerKey, sessionOwnerKey)) {
        return false;
    }
    if (!cycle && !inMemoryIssue) {
        return false;
    }
    return resetAuthRecoveryCycle();
};
