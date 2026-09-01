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
};

const readStreamErrorMessage = async (response: Response) => {
    try {
        const payload = await response.clone().json();
        const detail = payload?.detail;
        if (typeof detail === 'string' && detail.trim()) {
            return detail;
        }
        if (detail && typeof detail.message === 'string' && detail.message.trim()) {
            return detail.message;
        }
    } catch {
        return '';
    }
    return '';
};

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
    const message = await readStreamErrorMessage(response);
    if (response.status === 402) {
        const quotaMessage = message || DEFAULT_QUOTA_PURCHASE_MESSAGE;
        dispatchQuotaPurchaseRequired(quotaMessage);
        throw new Error(quotaMessage);
    }
    throw new Error(message || `AI stream request failed: ${response.status}`);
};

const createStreamHeaders = async (
    contentType?: string | null,
    expectedAuthCacheKey?: string,
) => {
    const headers = new Headers();
    const authHeader = await getAuthorizationHeader(expectedAuthCacheKey);
    if (!authHeader) {
        dispatchLoginRequired('write-operation');
        throw new Error('Authentication required for write operation');
    }
    headers.set('Authorization', authHeader);
    if (contentType !== null) {
        headers.set('Content-Type', contentType ?? 'application/json');
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
}: {
    path: string;
    body: BodyInit;
    contentType?: string | null;
    onEvent?: (event: TEvent) => void;
    onParsedEvent?: (event: TEvent) => void;
    getFinalResult: (event: TEvent) => TResult | null;
    signal?: AbortSignal;
} & AuthOwnerOptions): Promise<TResult> => {
    const headers = await createStreamHeaders(contentType, expectedAuthCacheKey);
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
            } catch (error) {
                console.warn('Failed to parse stream line', error);
                continue;
            }
            onEvent?.(parsed);
            onParsedEvent?.(parsed);
            if (parsed.type === 'error') {
                throw new Error(parsed.message || 'AI stream error');
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
