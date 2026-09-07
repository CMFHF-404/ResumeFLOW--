import {
    AuthContextChangedError,
    getAuthorizationHeader,
    type AuthOwnerOptions,
} from './apiClient';
import {
    isAuthSessionSnapshotCurrent,
    readAuthSessionSnapshot,
} from './authTokenProvider';
import { dispatchLoginRequired } from './authRedirect';
import { handleFetchAuthFailure } from './authRecoveryCoordinator';
import { parseNdjsonLines, resolveApiUrl } from './apiStreamUtils';
import {
    DEFAULT_QUOTA_PURCHASE_MESSAGE,
    dispatchQuotaPurchaseRequired,
} from './quotaPurchasePrompt';

export { parseNdjsonLines, resolveApiUrl } from './apiStreamUtils';

export type StreamEventBase = {
    type: string;
    message?: string;
    code?: string;
    requestId?: string;
    statusCode?: number;
    retryable?: boolean;
};

export class StreamRequestError extends Error {
    readonly code: string;
    readonly statusCode: number;
    readonly retryable: boolean;
    readonly requestId?: string;

    constructor(
        message: string,
        {
            code = 'stream_request_failed',
            statusCode = 500,
            retryable = false,
            requestId,
        }: {
            code?: string;
            statusCode?: number;
            retryable?: boolean;
            requestId?: string;
        } = {},
    ) {
        super(message);
        this.name = 'StreamRequestError';
        this.code = code;
        this.statusCode = statusCode;
        this.retryable = retryable;
        this.requestId = requestId;
    }
}

const readStreamErrorDetail = async (response: Response) => {
    try {
        const payload = await response.clone().json();
        const detail = payload?.detail;
        if (typeof detail === 'string' && detail.trim()) {
            return { message: detail.trim() };
        }
        const detailError = detail && typeof detail === 'object'
            ? detail.error
            : undefined;
        const publicError = payload?.error ?? detailError ?? detail;
        if (
            publicError
            && typeof publicError === 'object'
            && typeof publicError.message === 'string'
            && publicError.message.trim()
        ) {
            return {
                code: typeof publicError.code === 'string'
                    ? publicError.code
                    : undefined,
                message: publicError.message.trim(),
                requestId: typeof publicError.requestId === 'string'
                    ? publicError.requestId
                    : undefined,
                retryable: typeof publicError.retryable === 'boolean'
                    ? publicError.retryable
                    : undefined,
            };
        }
    } catch {
        return {};
    }
    return {};
};

const AI_TOKEN_QUOTA_EXHAUSTED_CODE = 'ai_token_quota_exhausted';

export const ensureStreamResponseOk = async (
    response: Response,
    sessionOwnerKey?: string | null,
    isCurrentSession = false,
) => {
    if (response.ok) {
        return;
    }
    if (response.status === 401 || response.status === 503) {
        await handleFetchAuthFailure(response, sessionOwnerKey, isCurrentSession);
    }
    const detail = await readStreamErrorDetail(response);
    if (response.status === 402) {
        const quotaMessage = DEFAULT_QUOTA_PURCHASE_MESSAGE;
        const hasKnownQuotaCode = detail.code === AI_TOKEN_QUOTA_EXHAUSTED_CODE;
        dispatchQuotaPurchaseRequired(quotaMessage);
        throw new StreamRequestError(quotaMessage, {
            code: AI_TOKEN_QUOTA_EXHAUSTED_CODE,
            statusCode: response.status,
            retryable: false,
            requestId: hasKnownQuotaCode ? detail.requestId : undefined,
        });
    }
    const message = detail.message || `AI stream request failed: ${response.status}`;
    throw new StreamRequestError(message, {
        code: detail.code || 'http_error',
        statusCode: response.status,
        retryable: detail.retryable ?? (
            response.status === 503 || response.status === 504
        ),
        requestId: detail.requestId,
    });
};

const createStreamHeaders = async (
    contentType?: string | null,
    expectedAuthCacheKey?: string,
    initialHeaders?: HeadersInit,
) => {
    // Let the platform validate caller-supplied names/values (including CR/LF)
    // before any auth work or network dispatch.
    const headers = new Headers(initialHeaders);
    const authHeader = await getAuthorizationHeader(expectedAuthCacheKey);
    if (!authHeader) {
        dispatchLoginRequired('write-operation');
        throw new Error('Authentication required for write operation');
    }
    headers.set('Authorization', authHeader);
    if (contentType !== null) {
        headers.set('Content-Type', contentType ?? 'application/json');
    } else {
        headers.delete('Content-Type');
    }
    return headers;
};

export const postStreamRequest = async <TEvent extends StreamEventBase, TResult>({
    path,
    body,
    contentType,
    onEvent,
    onParsedEvent,
    getFinalResult,
    signal,
    expectedAuthCacheKey,
    headers: initialHeaders,
}: {
    path: string;
    body: BodyInit;
    contentType?: string | null;
    headers?: HeadersInit;
    onEvent?: (event: TEvent) => void;
    onParsedEvent?: (event: TEvent) => void;
    getFinalResult: (event: TEvent) => TResult | null;
    signal?: AbortSignal;
} & AuthOwnerOptions): Promise<TResult> => {
    const headers = await createStreamHeaders(
        contentType,
        expectedAuthCacheKey,
        initialHeaders,
    );
    const dispatchSession = readAuthSessionSnapshot();
    const assertStreamSessionCurrent = () => {
        if (
            !isAuthSessionSnapshotCurrent(dispatchSession)
            || (expectedAuthCacheKey && dispatchSession.ownerKey !== expectedAuthCacheKey)
        ) {
            throw new AuthContextChangedError();
        }
    };
    assertStreamSessionCurrent();

    const response = await fetch(resolveApiUrl(path), {
        method: 'POST',
        headers,
        body,
        signal,
    });

    assertStreamSessionCurrent();
    await ensureStreamResponseOk(
        response,
        dispatchSession.ownerKey,
        isAuthSessionSnapshotCurrent(dispatchSession),
    );
    if (!response.body) {
        throw new Error('AI stream response body is empty');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finalResult: TResult | null = null;

    while (true) {
        const { done, value } = await reader.read();
        assertStreamSessionCurrent();
        if (done) {
            break;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = parseNdjsonLines(buffer);
        const hasTrailingNewline = buffer.endsWith('\n');
        buffer = hasTrailingNewline ? '' : lines.pop() ?? '';

        for (const line of lines) {
            assertStreamSessionCurrent();
            let parsed: TEvent;
            try {
                parsed = JSON.parse(line) as TEvent;
            } catch {
                console.warn('Failed to parse stream line');
                continue;
            }
            onEvent?.(parsed);
            onParsedEvent?.(parsed);
            if (parsed.type === 'error') {
                throw new StreamRequestError(parsed.message || 'AI stream error', {
                    code: parsed.code || 'stream_error',
                    statusCode: typeof parsed.statusCode === 'number'
                        ? parsed.statusCode
                        : 500,
                    retryable: parsed.retryable === true,
                    requestId: parsed.requestId,
                });
            }
            const result = getFinalResult(parsed);
            if (result) {
                finalResult = result;
            }
        }
    }

    if (!finalResult) {
        throw new Error('AI stream did not return final result');
    }
    assertStreamSessionCurrent();
    return finalResult;
};
