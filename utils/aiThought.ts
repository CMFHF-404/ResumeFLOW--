export const extractThoughtHeadline = (summary?: string | null) => {
    const text = summary?.trim();
    if (!text) {
        return '';
    }

    const boldMatch = text.match(/\*\*([^*\n]+?)(?:\*\*|$)/);
    if (boldMatch?.[1]) {
        return boldMatch[1].trim();
    }

    const firstLine = text
        .split('\n')
        .map((line) => line.replace(/\*/g, '').trim())
        .find(Boolean);

    return firstLine ?? '';
};

export type ThoughtDisplayEventLike = {
    type?: string;
    summary?: string | null;
    title?: string | null;
    node?: string | null;
};

export type ThoughtDisplayResolution =
    | { kind: 'model_thought'; text: string; persist: true }
    | { kind: 'status'; text: string; persist: false }
    | { kind: 'reset' };

export type ThoughtDisplayOptions = {
    includeProgress?: boolean;
    progressTitleByNode?: Partial<Record<string, string>>;
};

export type AppendThoughtDisplayTextOptions = {
    separator?: string;
    maxLength?: number;
    dedupeStrategy?: 'last' | 'all';
};

const normalizeThoughtDisplayText = (value: string) => value
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');

const resolveThoughtText = (summary?: string | null) => {
    const text = summary?.trim();
    if (!text) {
        return '';
    }
    return extractThoughtHeadline(text) || normalizeThoughtDisplayText(text);
};

export const resolveThoughtDisplayEvent = (
    event: ThoughtDisplayEventLike,
    options: ThoughtDisplayOptions = {}
): ThoughtDisplayResolution | null => {
    if (event.type === 'thought_reset') {
        return { kind: 'reset' };
    }
    if (event.type === 'thought') {
        const text = resolveThoughtText(event.summary);
        return text ? { kind: 'model_thought', text, persist: true } : null;
    }
    if (event.type === 'thought_status') {
        const text = resolveThoughtText(event.summary);
        return text ? { kind: 'status', text, persist: false } : null;
    }
    if (event.type === 'progress' && options.includeProgress) {
        const text = (event.node ? options.progressTitleByNode?.[event.node]?.trim() : '')
            || event.title?.trim()
            || '';
        return text ? { kind: 'status', text, persist: false } : null;
    }
    return null;
};

export const appendThoughtDisplayText = (
    current: string,
    rawText: string,
    options: AppendThoughtDisplayTextOptions = {}
) => {
    const separator = options.separator ?? '\n';
    const text = normalizeThoughtDisplayText(rawText);
    if (!text) {
        return current;
    }

    let parts = current
        .split(separator)
        .map((item) => normalizeThoughtDisplayText(item))
        .filter(Boolean);

    if (options.dedupeStrategy === 'all') {
        parts = parts.filter((item) => item !== text);
    } else if (parts[parts.length - 1] === text) {
        return parts.join(separator);
    }
    parts.push(text);

    let next = parts.join(separator);
    const maxLength = options.maxLength;
    if (typeof maxLength === 'number' && maxLength > 0) {
        while (parts.length > 1 && next.length > maxLength) {
            parts.shift();
            next = parts.join(separator);
        }
        if (next.length > maxLength) {
            return next.slice(-maxLength).trimStart();
        }
    }

    return next;
};
