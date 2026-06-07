import apiClient from './apiClient';

export type LogtoAccountIdentifierType = 'email' | 'phone';

export type LogtoAccountIdentifier = {
    type: LogtoAccountIdentifierType;
    value: string;
};

export type LogtoTokenGetter = (resource?: string) => Promise<string | null | undefined>;

export interface LogtoAccountProfile {
    id: string;
    username?: string | null;
    name?: string | null;
    avatar?: string | null;
    primaryEmail?: string | null;
    primaryPhone?: string | null;
    profile?: Record<string, unknown> | null;
    customData?: Record<string, unknown> | null;
    [key: string]: unknown;
}

export interface LogtoVerificationRecord {
    verificationRecordId: string;
    expiresAt?: string | number | null;
}

export class LogtoAccountApiError extends Error {
    status?: number;
    code?: string;
    retryAfterSeconds?: number;

    constructor(message: string, options?: { status?: number; code?: string; retryAfterSeconds?: number }) {
        super(message);
        this.name = 'LogtoAccountApiError';
        this.status = options?.status;
        this.code = options?.code;
        this.retryAfterSeconds = options?.retryAfterSeconds;
    }
}

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

export const resolveLogtoAccountApiResource = (): string => {
    const configuredBase = import.meta.env.VITE_LOGTO_ACCOUNT_API_RESOURCE?.trim();
    if (configuredBase) {
        return trimTrailingSlash(configuredBase);
    }

    const endpoint = import.meta.env.VITE_LOGTO_ENDPOINT?.trim();
    if (!endpoint) {
        throw new LogtoAccountApiError('缺少 Logto Account API 地址配置');
    }
    return `${trimTrailingSlash(endpoint)}/api`;
};

export const resolveLogtoAccountApiBaseUrl = resolveLogtoAccountApiResource;

const CHINA_MAINLAND_PHONE_PATTERN = /^1[3-9]\d{9}$/;

export const normalizeLogtoPhoneIdentifier = (value: string): string => {
    const digits = value.replace(/\D/g, '');
    const nationalPhone = digits.startsWith('86') ? digits.slice(2) : digits;
    if (CHINA_MAINLAND_PHONE_PATTERN.test(nationalPhone)) {
        return `86${nationalPhone}`;
    }

    return digits;
};

const requireLogtoPhoneIdentifier = (value: string): string => {
    const normalizedPhone = normalizeLogtoPhoneIdentifier(value);
    const nationalPhone = normalizedPhone.startsWith('86') ? normalizedPhone.slice(2) : normalizedPhone;
    if (!CHINA_MAINLAND_PHONE_PATTERN.test(nationalPhone)) {
        throw new LogtoAccountApiError('请输入 11 位中国大陆手机号');
    }
    return normalizedPhone;
};

const normalizeLogtoIdentifier = (identifier: LogtoAccountIdentifier): LogtoAccountIdentifier => {
    if (identifier.type === 'phone') {
        return {
            ...identifier,
            value: requireLogtoPhoneIdentifier(identifier.value),
        };
    }

    return {
        ...identifier,
        value: identifier.value.trim(),
    };
};

const normalizeVerificationRecord = (data: unknown): LogtoVerificationRecord => {
    if (!data || typeof data !== 'object') {
        throw new LogtoAccountApiError('Logto 未返回有效的验证记录');
    }

    const record = data as {
        verificationRecordId?: unknown;
        verificationId?: unknown;
        expiresAt?: unknown;
    };
    const verificationRecordId = typeof record.verificationRecordId === 'string'
        ? record.verificationRecordId
        : typeof record.verificationId === 'string'
            ? record.verificationId
            : '';

    if (!verificationRecordId) {
        throw new LogtoAccountApiError('Logto 未返回验证记录 ID');
    }

    return {
        verificationRecordId,
        expiresAt: typeof record.expiresAt === 'string' || typeof record.expiresAt === 'number'
            ? record.expiresAt
            : null,
    };
};

const extractApiErrorMessage = (payload: unknown): { message: string; code?: string } => {
    if (!payload || typeof payload !== 'object') {
        return { message: '' };
    }

    const data = payload as {
        message?: unknown;
        code?: unknown;
        error?: unknown;
        error_description?: unknown;
        detail?: unknown;
    };

    if (typeof data.detail === 'string') {
        return {
            message: data.detail,
            code: typeof data.code === 'string' ? data.code : undefined,
        };
    }
    if (typeof data.message === 'string') {
        return {
            message: data.message,
            code: typeof data.code === 'string' ? data.code : undefined,
        };
    }
    if (typeof data.error_description === 'string') {
        return {
            message: data.error_description,
            code: typeof data.error === 'string' ? data.error : undefined,
        };
    }
    if (typeof data.error === 'string') {
        return { message: data.error };
    }

    return { message: '' };
};

const parseResponsePayload = async (response: Response): Promise<unknown> => {
    if (response.status === 204) {
        return null;
    }

    const text = await response.text();
    if (!text) {
        return null;
    }

    try {
        return JSON.parse(text) as unknown;
    } catch {
        return text;
    }
};

const requestAccountApi = async <T>(
    tokenGetter: LogtoTokenGetter,
    path: string,
    options?: RequestInit
): Promise<T> => {
    const token = await tokenGetter();
    if (!token) {
        throw new LogtoAccountApiError('登录状态已失效，请重新登录', { status: 401 });
    }

    const headers = new Headers(options?.headers);
    headers.set('Authorization', `Bearer ${token}`);
    if (options?.body && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
    }

    const response = await fetch(`${resolveLogtoAccountApiBaseUrl()}${path}`, {
        ...options,
        headers,
    });
    const payload = await parseResponsePayload(response);

    if (!response.ok) {
        const extracted = extractApiErrorMessage(payload);
        throw new LogtoAccountApiError(
            extracted.message || `Logto Account API 请求失败 (${response.status})`,
            {
                status: response.status,
                code: extracted.code,
            }
        );
    }

    return payload as T;
};

const jsonBody = (value: unknown) => JSON.stringify(value);

const getBackendErrorDetail = (error: unknown): {
    status?: number;
    code?: string;
    message?: string;
    retryAfterSeconds?: number;
} => {
    if (!error || typeof error !== 'object') {
        return {};
    }

    const response = (error as {
        response?: {
            status?: unknown;
            data?: unknown;
        };
    }).response;
    if (!response || typeof response !== 'object') {
        return {};
    }

    const data = response.data as {
        detail?: unknown;
        message?: unknown;
        code?: unknown;
    };
    const detail = data && typeof data.detail === 'object' && data.detail !== null
        ? data.detail as {
            message?: unknown;
            code?: unknown;
            retry_after_seconds?: unknown;
        }
        : null;

    const retryAfterSeconds = typeof detail?.retry_after_seconds === 'number'
        ? detail.retry_after_seconds
        : undefined;

    return {
        status: typeof response.status === 'number' ? response.status : undefined,
        code: typeof detail?.code === 'string'
            ? detail.code
            : typeof data?.code === 'string'
                ? data.code
                : undefined,
        message: typeof detail?.message === 'string'
            ? detail.message
            : typeof data?.message === 'string'
                ? data.message
                : undefined,
        retryAfterSeconds,
    };
};

export const reserveVerificationCodeCooldown = async (
    identifier: LogtoAccountIdentifier
): Promise<{ cooldownSeconds: number; retryAfterSeconds: number }> => {
    try {
        const response = await apiClient.post('/account/verification-code-cooldown', {
            identifier,
        });
        const data = response.data as {
            cooldown_seconds?: unknown;
            retry_after_seconds?: unknown;
        };
        return {
            cooldownSeconds: typeof data.cooldown_seconds === 'number' ? data.cooldown_seconds : 60,
            retryAfterSeconds: typeof data.retry_after_seconds === 'number' ? data.retry_after_seconds : 0,
        };
    } catch (error) {
        const detail = getBackendErrorDetail(error);
        throw new LogtoAccountApiError(
            detail.message || '请稍后再试',
            {
                status: detail.status,
                code: detail.code,
                retryAfterSeconds: detail.retryAfterSeconds,
            }
        );
    }
};

export const releaseVerificationCodeCooldown = async (
    identifier: LogtoAccountIdentifier
): Promise<void> => {
    await apiClient.delete('/account/verification-code-cooldown', {
        data: { identifier },
    });
};

export const getAccountProfile = async (
    tokenGetter: LogtoTokenGetter
): Promise<LogtoAccountProfile> => {
    return requestAccountApi<LogtoAccountProfile>(tokenGetter, '/my-account');
};

export const verifyIdentityByPassword = async (
    tokenGetter: LogtoTokenGetter,
    password: string
): Promise<LogtoVerificationRecord> => {
    const data = await requestAccountApi<unknown>(tokenGetter, '/verifications/password', {
        method: 'POST',
        body: jsonBody({ password }),
    });
    return normalizeVerificationRecord(data);
};

export const sendVerificationCode = async (
    tokenGetter: LogtoTokenGetter,
    identifier: LogtoAccountIdentifier
): Promise<LogtoVerificationRecord> => {
    const normalizedIdentifier = normalizeLogtoIdentifier(identifier);
    await reserveVerificationCodeCooldown(normalizedIdentifier);
    try {
        const data = await requestAccountApi<unknown>(tokenGetter, '/verifications/verification-code', {
            method: 'POST',
            body: jsonBody({ identifier: normalizedIdentifier }),
        });
        return normalizeVerificationRecord(data);
    } catch (sendError) {
        await releaseVerificationCodeCooldown(normalizedIdentifier).catch(() => undefined);
        throw sendError;
    }
};

export const verifyCode = async (
    tokenGetter: LogtoTokenGetter,
    identifier: LogtoAccountIdentifier,
    verificationId: string,
    code: string
): Promise<LogtoVerificationRecord> => {
    const normalizedIdentifier = normalizeLogtoIdentifier(identifier);
    const data = await requestAccountApi<unknown>(tokenGetter, '/verifications/verification-code/verify', {
        method: 'POST',
        body: jsonBody({
            identifier: normalizedIdentifier,
            verificationId,
            code,
        }),
    });

    if (!data) {
        return { verificationRecordId: verificationId };
    }
    return normalizeVerificationRecord(data);
};

const buildVerificationHeaders = (identityVerificationId: string) => ({
    'logto-verification-id': identityVerificationId,
});

export const updatePrimaryEmail = async (
    tokenGetter: LogtoTokenGetter,
    email: string,
    identityVerificationId: string,
    newIdentifierVerificationRecordId: string
): Promise<void> => {
    await requestAccountApi<null>(tokenGetter, '/my-account/primary-email', {
        method: 'POST',
        headers: buildVerificationHeaders(identityVerificationId),
        body: jsonBody({
            email,
            newIdentifierVerificationRecordId,
        }),
    });
};

export const updatePrimaryPhone = async (
    tokenGetter: LogtoTokenGetter,
    phone: string,
    identityVerificationId: string,
    newIdentifierVerificationRecordId: string
): Promise<void> => {
    const normalizedPhone = requireLogtoPhoneIdentifier(phone);
    await requestAccountApi<null>(tokenGetter, '/my-account/primary-phone', {
        method: 'POST',
        headers: buildVerificationHeaders(identityVerificationId),
        body: jsonBody({
            phone: normalizedPhone,
            newIdentifierVerificationRecordId,
        }),
    });
};

export const updatePassword = async (
    tokenGetter: LogtoTokenGetter,
    password: string,
    identityVerificationId: string
): Promise<void> => {
    await requestAccountApi<null>(tokenGetter, '/my-account/password', {
        method: 'POST',
        headers: buildVerificationHeaders(identityVerificationId),
        body: jsonBody({ password }),
    });
};

export const logtoAccountService = {
    getAccountProfile,
    verifyIdentityByPassword,
    reserveVerificationCodeCooldown,
    releaseVerificationCodeCooldown,
    sendVerificationCode,
    verifyCode,
    updatePrimaryEmail,
    updatePrimaryPhone,
    updatePassword,
};
