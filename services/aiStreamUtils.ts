import { getApiBaseUrl, getAuthorizationHeader } from './apiClient';
import { dispatchLoginRequired } from './authRedirect';

export type StreamEventBase = {
    type: string;
    message?: string;
};

export const parseNdjsonLines = (chunk: string) => chunk.split('\n').map((line) => line.trim()).filter(Boolean);

export const resolveApiUrl = (path: string) => {
    const base = getApiBaseUrl();
    if (!base) {
        return path;
    }
    const normalizedBase = base.endsWith('/') ? base.slice(0, -1) : base;
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${normalizedBase}${normalizedPath}`;
};

export const ensureStreamResponseOk = (response: Response) => {
    if (response.ok) {
        return;
    }
    if (response.status === 401) {
        dispatchLoginRequired('unauthorized-write');
    }
    throw new Error(`AI stream request failed: ${response.status}`);
};

const createStreamHeaders = async (contentType?: string | null) => {
    const headers = new Headers();
    const authHeader = await getAuthorizationHeader();
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
}: {
    path: string;
    body: BodyInit;
    contentType?: string | null;
    onEvent?: (event: TEvent) => void;
    onParsedEvent?: (event: TEvent) => void;
    getFinalResult: (event: TEvent) => TResult | null;
}): Promise<TResult> => {
    const headers = await createStreamHeaders(contentType);

    const response = await fetch(resolveApiUrl(path), {
        method: 'POST',
        headers,
        body,
    });

    ensureStreamResponseOk(response);
    if (!response.body) {
        throw new Error('AI stream response body is empty');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finalResult: TResult | null = null;

    while (true) {
        const { done, value } = await reader.read();
        if (done) {
            break;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = parseNdjsonLines(buffer);
        const hasTrailingNewline = buffer.endsWith('\n');
        buffer = hasTrailingNewline ? '' : lines.pop() ?? '';

        for (const line of lines) {
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
    return finalResult;
};
