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

    constructor(message: string, options?: { status?: number; code?: string }) {
        super(message);
        this.name = 'LogtoAccountApiError';
        this.status = options?.status;
        this.code = options?.code;
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
    const token = await tokenGetter(resolveLogtoAccountApiResource());
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
    const data = await requestAccountApi<unknown>(tokenGetter, '/verifications/verification-code', {
        method: 'POST',
        body: jsonBody({ identifier }),
    });
    return normalizeVerificationRecord(data);
};

export const verifyCode = async (
    tokenGetter: LogtoTokenGetter,
    identifier: LogtoAccountIdentifier,
    verificationId: string,
    code: string
): Promise<LogtoVerificationRecord> => {
    const data = await requestAccountApi<unknown>(tokenGetter, '/verifications/verification-code/verify', {
        method: 'POST',
        body: jsonBody({
            identifier,
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
    await requestAccountApi<null>(tokenGetter, '/my-account/primary-phone', {
        method: 'POST',
        headers: buildVerificationHeaders(identityVerificationId),
        body: jsonBody({
            phone,
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
    sendVerificationCode,
    verifyCode,
    updatePrimaryEmail,
    updatePrimaryPhone,
    updatePassword,
};
