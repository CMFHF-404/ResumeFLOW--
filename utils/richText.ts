const SAFE_PROTOCOLS = ['http:', 'https:', 'mailto:', 'tel:'];
const ALLOWED_INLINE_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'A', 'BR']);
const BLOCK_TAGS = new Set(['DIV', 'P', 'LI', 'UL', 'OL']);
const LINE_BREAK_TAG = 'BR';

const escapeHtml = (value: string) =>
    value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

const decodeHtmlEntities = (value: string) => {
    if (typeof document === 'undefined') {
        return value
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'");
    }
    const textarea = document.createElement('textarea');
    textarea.innerHTML = value;
    return textarea.value;
};

const normalizeTextNode = (value: string) => value.replace(/\u00a0/g, ' ');

const maybeConvertLegacyMarkdown = (input: string) => {
    if (!input || /<[^>]+>/.test(input)) {
        return input;
    }
    if (!/(\*\*|__|\]\()/g.test(input)) {
        return input;
    }
    return input
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
        .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
        .replace(/__([^_]+)__/g, '<u>$1</u>')
        .replace(/\*([^*]+)\*/g, '<i>$1</i>');
};

const isSafeHref = (value: string | null) => {
    if (!value) {
        return false;
    }
    try {
        const url = new URL(value, 'https://fallback.local');
        return SAFE_PROTOCOLS.includes(url.protocol);
    } catch {
        return false;
    }
};

const appendLineBreak = (parent: HTMLElement) => {
    const last = parent.lastChild;
    if (last && last.nodeType === Node.ELEMENT_NODE && (last as HTMLElement).tagName === LINE_BREAK_TAG) {
        return;
    }
    parent.appendChild(document.createElement('br'));
};

const appendText = (parent: HTMLElement, text: string) => {
    const parts = normalizeTextNode(text).split(/\r?\n/);
    parts.forEach((part, index) => {
        if (part) {
            parent.appendChild(document.createTextNode(part));
        }
        if (index < parts.length - 1) {
            appendLineBreak(parent);
        }
    });
};

const mapInlineTag = (tag: string) => {
    if (tag === 'STRONG') {
        return 'B';
    }
    if (tag === 'EM') {
        return 'I';
    }
    return tag;
};

const sanitizeNodeList = (nodes: ChildNode[], parent: HTMLElement) => {
    nodes.forEach((node) => {
        if (node.nodeType === Node.TEXT_NODE) {
            appendText(parent, node.textContent ?? '');
            return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) {
            return;
        }

        const element = node as HTMLElement;
        const tag = element.tagName.toUpperCase();

        if (tag === LINE_BREAK_TAG) {
            appendLineBreak(parent);
            return;
        }

        if (ALLOWED_INLINE_TAGS.has(tag)) {
            const mappedTag = mapInlineTag(tag);
            if (mappedTag === 'A') {
                const href = element.getAttribute('href');
                if (!isSafeHref(href)) {
                    sanitizeNodeList(Array.from(element.childNodes), parent);
                    return;
                }
                const link = document.createElement('a');
                link.setAttribute('href', href as string);
                link.setAttribute('target', '_blank');
                link.setAttribute('rel', 'noreferrer');
                sanitizeNodeList(Array.from(element.childNodes), link);
                parent.appendChild(link);
                return;
            }

            const inline = document.createElement(mappedTag.toLowerCase());
            sanitizeNodeList(Array.from(element.childNodes), inline);
            parent.appendChild(inline);
            return;
        }

        const isBlock = BLOCK_TAGS.has(tag);
        sanitizeNodeList(Array.from(element.childNodes), parent);
        if (isBlock) {
            appendLineBreak(parent);
        }
    });
};

const trimTrailingLineBreaks = (parent: HTMLElement) => {
    while (parent.lastChild && parent.lastChild.nodeType === Node.ELEMENT_NODE) {
        const element = parent.lastChild as HTMLElement;
        if (element.tagName !== LINE_BREAK_TAG) {
            break;
        }
        parent.removeChild(element);
    }
};

export const sanitizeRichTextHtml = (input: string) => {
    if (!input) {
        return '';
    }
    const normalized = maybeConvertLegacyMarkdown(input);
    if (typeof document === 'undefined') {
        return escapeHtml(normalized).replace(/\r?\n/g, '<br>');
    }
    const container = document.createElement('div');
    container.innerHTML = normalized;
    const output = document.createElement('div');
    sanitizeNodeList(Array.from(container.childNodes), output);
    trimTrailingLineBreaks(output);
    return output.innerHTML;
};

export const stripRichTextToText = (input: string) => {
    if (!input) {
        return '';
    }
    if (typeof document === 'undefined') {
        const normalized = maybeConvertLegacyMarkdown(input);
        return decodeHtmlEntities(normalized.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, ''));
    }
    const container = document.createElement('div');
    container.innerHTML = sanitizeRichTextHtml(input);
    container.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
    return normalizeTextNode(container.textContent ?? '');
};

export const splitRichTextLines = (input: string) => {
    const sanitized = sanitizeRichTextHtml(input);
    if (!sanitized) {
        return [];
    }
    return sanitized
        .split(/<br\s*\/?>/i)
        .map((line) => line.trim())
        .filter(Boolean);
};
