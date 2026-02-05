const SAFE_PROTOCOLS = ['http:', 'https:', 'mailto:', 'tel:'];
const ALLOWED_INLINE_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'A', 'BR']);
const ALLOWED_BLOCK_TAGS = new Set(['UL', 'OL', 'LI']);
const BLOCK_TAGS = new Set(['DIV', 'P']);
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

const EDGE_WHITESPACE_PATTERN = /^[\s\u00a0\u200b\u200c\u200d\u3000\uFEFF]+|[\s\u00a0\u200b\u200c\u200d\u3000\uFEFF]+$/g;

const normalizeMarkdownToken = (value: string) =>
    value.replace(/[\u00a0\u3000]/g, ' ').replace(EDGE_WHITESPACE_PATTERN, '');

const maybeConvertLegacyMarkdown = (input: string) => {
    if (!input || /<[^>]+>/.test(input)) {
        return input;
    }
    if (!/(\*\*|__|\]\(|\*[^*\r\n]+\*)/g.test(input)) {
        return input;
    }
    return input
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, text, href) => {
            return `<a href="${href}">${normalizeMarkdownToken(text)}</a>`;
        })
        .replace(/\*\*([^*]+)\*\*/g, (_match, text) => `<b>${normalizeMarkdownToken(text)}</b>`)
        .replace(/__([^_]+)__/g, (_match, text) => `<u>${normalizeMarkdownToken(text)}</u>`)
        // 仅匹配同一行内的 *italic*，避免把 `* item1\n* item2` 误判为斜体。
        .replace(/(^|[^*])\*([^\s*](?:[^*\r\n]*?[^\s*])?)\*(?!\*)/g, (_match, prefix, text) => {
            return `${prefix}<i>${normalizeMarkdownToken(text)}</i>`;
        });
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

        if (ALLOWED_BLOCK_TAGS.has(tag)) {
            const block = document.createElement(tag.toLowerCase());
            sanitizeNodeList(Array.from(element.childNodes), block);
            parent.appendChild(block);
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

export type RichTextListType = 'ordered' | 'unordered';

type RichTextListData = {
    lines: string[];
    listType: RichTextListType;
};

const isIgnorableRootNode = (node: ChildNode) => {
    if (node.nodeType === Node.TEXT_NODE) {
        return !(node.textContent ?? '').trim();
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
        return true;
    }
    return (node as HTMLElement).tagName.toUpperCase() === LINE_BREAK_TAG;
};

const resolveRootListElement = (container: HTMLElement) => {
    const meaningfulNodes = Array.from(container.childNodes).filter((node) => !isIgnorableRootNode(node));
    if (meaningfulNodes.length !== 1) {
        return null;
    }
    const candidate = meaningfulNodes[0];
    if (candidate instanceof HTMLOListElement || candidate instanceof HTMLUListElement) {
        return candidate;
    }
    return null;
};

const extractListData = (sanitized: string): RichTextListData | null => {
    if (typeof document !== 'undefined') {
        const container = document.createElement('div');
        container.innerHTML = sanitized;
        const listElement = resolveRootListElement(container);
        if (!(listElement instanceof HTMLOListElement || listElement instanceof HTMLUListElement)) {
            return null;
        }
        const listType = listElement.tagName.toLowerCase() === 'ol' ? 'ordered' : 'unordered';
        const items = Array.from(listElement.children).filter((child): child is HTMLLIElement => child instanceof HTMLLIElement);
        if (!items.length) {
            return null;
        }
        return {
            listType,
            lines: items
                .map((item) => item.innerHTML.trim())
                .filter(Boolean),
        };
    }
    const listType: RichTextListType | null = /<ol/i.test(sanitized)
        ? 'ordered'
        : /<ul/i.test(sanitized)
            ? 'unordered'
            : null;
    if (!listType) {
        return null;
    }
    const matches = sanitized.match(/<li[^>]*>[\s\S]*?<\/li>/gi);
    if (!matches) {
        return null;
    }
    const lines = matches
        .map((match) => match.replace(/<\/?li[^>]*>/gi, '').trim())
        .filter(Boolean);
    if (!lines.length) {
        return null;
    }
    return { lines, listType };
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
    container.querySelectorAll('li').forEach((li) => {
        li.appendChild(document.createTextNode('\n'));
    });
    container.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
    return normalizeTextNode(container.textContent ?? '');
};

export const splitRichTextLines = (input: string) => {
    const sanitized = sanitizeRichTextHtml(input);
    if (!sanitized) {
        return [];
    }
    const listData = extractListData(sanitized);
    if (listData) {
        return listData.lines;
    }
    return sanitized
        .split(/<br\s*\/?>/i)
        .map((line) => line.trim())
        .filter(Boolean);
};

export const parseRichTextList = (input: string): RichTextListData | null => {
    if (!input) {
        return null;
    }
    const sanitized = sanitizeRichTextHtml(input);
    if (!sanitized) {
        return null;
    }
    return extractListData(sanitized);
};
