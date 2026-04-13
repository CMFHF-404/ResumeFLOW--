const SAFE_PROTOCOLS = ['http:', 'https:', 'mailto:', 'tel:'];
const ALLOWED_INLINE_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'A', 'BR']);
const ALLOWED_BLOCK_TAGS = new Set(['UL', 'OL', 'LI']);
const BLOCK_TAGS = new Set(['DIV', 'P']);
const LINE_BREAK_TAG = 'BR';
const ORDERED_LIST_LINE_PATTERN = /^\s*\d+[.、)）]\s*(.+)$/;
const UNORDERED_LIST_LINE_PATTERN = /^\s*[-*＊•·]\s*(.+)$/;
const RICH_TEXT_DECODE_PATTERN = /&(lt|gt|amp;lt|amp;gt);/i;
const MAX_HTML_DECODE_PASSES = 2;
const RICH_TEXT_HTML_TAG_PATTERN = /<\/?(?:b|strong|i|em|u|a|br|ul|ol|li)\b/i;
const RICH_TEXT_MARKDOWN_TOKEN_PATTERN = /(\*\*|＊＊|__|\]\(|\*[^*\r\n]+\*)/;

export const RICH_TEXT_INLINE_STYLES_CLASS =
    '[&_b]:font-bold [&_strong]:font-bold [&_i]:italic [&_em]:italic [&_u]:underline [&_a]:text-blue-600 [&_a]:underline';
export const hasRichTextDecoration = (value: string) =>
    RICH_TEXT_HTML_TAG_PATTERN.test(value) || RICH_TEXT_MARKDOWN_TOKEN_PATTERN.test(value);

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

const BOLD_MARKDOWN_PATTERN = /(?:\*\*|＊＊)([^*\r\n＊]+)(?:\*\*|＊＊)/g;
const UNDERLINE_MARKDOWN_PATTERN = /__([^_\r\n]+)__/g;
const HTML_TAG_SPLIT_PATTERN = /(<[^>]+>)/g;

const convertMarkdownLinksToHtml = (input: string) => {
    let output = '';
    let index = 0;

    while (index < input.length) {
        const openBracket = input.indexOf('[', index);
        if (openBracket < 0) {
            output += input.slice(index);
            break;
        }
        const closeBracket = input.indexOf(']', openBracket + 1);
        if (closeBracket < 0 || input[closeBracket + 1] !== '(') {
            output += input.slice(index, openBracket + 1);
            index = openBracket + 1;
            continue;
        }

        let cursor = closeBracket + 2;
        let depth = 1;
        while (cursor < input.length && depth > 0) {
            const ch = input[cursor];
            if (ch === '(') {
                depth += 1;
            } else if (ch === ')') {
                depth -= 1;
            }
            cursor += 1;
        }
        if (depth !== 0) {
            output += input.slice(index, openBracket + 1);
            index = openBracket + 1;
            continue;
        }

        const text = input.slice(openBracket + 1, closeBracket);
        const href = input.slice(closeBracket + 2, cursor - 1).trim();
        output += input.slice(index, openBracket);
        if (!text || !href) {
            output += input.slice(openBracket, cursor);
        } else {
            output += `<a href="${href}">${normalizeMarkdownToken(text)}</a>`;
        }
        index = cursor;
    }

    return output;
};

const applyLegacyMarkdownFormatting = (input: string) => (
    convertMarkdownLinksToHtml(input)
        .replace(BOLD_MARKDOWN_PATTERN, (_match, text) => `<b>${normalizeMarkdownToken(text)}</b>`)
        .replace(UNDERLINE_MARKDOWN_PATTERN, (_match, text) => `<u>${normalizeMarkdownToken(text)}</u>`)
        // 仅匹配同一行内的 *italic*，避免把 `* item1\n* item2` 误判为斜体。
        .replace(/(^|[^*])\*([^\s*](?:[^*\r\n]*?[^\s*])?)\*(?!\*)/g, (_match, prefix, text) => {
            return `${prefix}<i>${normalizeMarkdownToken(text)}</i>`;
        })
);

const maybeConvertLegacyMarkdown = (input: string) => {
    if (!input) {
        return input;
    }
    if (!/(\*\*|＊＊|__|\]\(|\*[^*\r\n]+\*)/g.test(input)) {
        return input;
    }
    if (!/<[^>]+>/.test(input)) {
        return applyLegacyMarkdownFormatting(input);
    }
    return input
        .split(HTML_TAG_SPLIT_PATTERN)
        .map((segment) => (segment.startsWith('<') && segment.endsWith('>') ? segment : applyLegacyMarkdownFormatting(segment)))
        .join('');
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

const extractListLines = (lines: string[], pattern: RegExp) => {
    const matches = lines.map((line) => line.match(pattern));
    if (!matches.length || matches.some((match) => !match)) {
        return null;
    }
    const contents = matches
        .map((match) => match?.[1]?.trim() ?? '')
        .filter(Boolean);
    return contents.length ? contents : null;
};

const splitInlineOrderedList = (line: string) => {
    if (!ORDERED_LIST_LINE_PATTERN.test(line)) {
        return null;
    }
    const parts = line
        .split(/(?=\d+[.、)）]\s+)/)
        .map((segment) => segment.trim())
        .filter(Boolean);
    if (parts.length <= 1) {
        return null;
    }
    return parts;
};

type NormalizeAiRichTextOptions = {
    allowList?: boolean;
};

const ORDERED_LIST_PREFIX_PATTERN = /^\s*(\d+)([.、)）])\s*(.+)$/;
const UNORDERED_LIST_PREFIX_PATTERN = /^\s*([-*＊•·])\s*(.+)$/;

const isPlainItalicMarkdown = (value: string) => /^\*[^*\r\n]+\*$/.test(value.trim());

const isLikelyOrderedListLine = (value: string) => {
    const match = value.match(ORDERED_LIST_PREFIX_PATTERN);
    if (!match) {
        return false;
    }
    const numberPart = match[1];
    const content = match[3]?.trim() ?? '';
    if (!content) {
        return false;
    }
    if (numberPart.length >= 3) {
        return false;
    }
    if (/^\d/.test(content)) {
        return false;
    }
    return true;
};

const isLikelyUnorderedListLine = (value: string) => {
    const match = value.match(UNORDERED_LIST_PREFIX_PATTERN);
    if (!match) {
        return false;
    }
    const bullet = match[1];
    const content = match[2]?.trim() ?? '';
    if (!content) {
        return false;
    }
    if ((bullet === '*' || bullet === '＊') && isPlainItalicMarkdown(value)) {
        return false;
    }
    if (bullet === '-' && /^\d/.test(content)) {
        return false;
    }
    return true;
};

const resolveListPrefixMode = (lines: string[]) => {
    const trimmedLines = lines.map((line) => line.trim()).filter(Boolean);
    if (!trimmedLines.length) {
        return null;
    }
    const orderedHits = trimmedLines.filter((line) => isLikelyOrderedListLine(line)).length;
    if (orderedHits === trimmedLines.length) {
        return 'ordered';
    }
    const unorderedHits = trimmedLines.filter((line) => isLikelyUnorderedListLine(line)).length;
    if (unorderedHits === trimmedLines.length) {
        return 'unordered';
    }
    return null;
};

const joinNormalizedLines = (lines: string[], shouldStrip: boolean, fallback: string) => {
    if (lines.length > 1) {
        const joined = lines.join('<br>');
        return shouldStrip ? stripListPrefixFromHtml(joined) : joined;
    }
    if (lines.length === 1) {
        return shouldStrip ? stripListPrefixFromHtml(lines[0]) : lines[0];
    }
    return fallback;
};

const stripLooseAsteriskPrefix = (value: string) => {
    const trimmedLeft = value.replace(EDGE_WHITESPACE_PATTERN, '');
    if (!(trimmedLeft.startsWith('*') || trimmedLeft.startsWith('＊')) || trimmedLeft.startsWith('**')) {
        return value;
    }
    if (isPlainItalicMarkdown(trimmedLeft)) {
        return value;
    }
    return value.replace(/^[\s\u00a0\u200b\u200c\u200d\u3000\uFEFF]*[\*＊]\s*/, '');
};

const stripListPrefix = (value: string) => {
    const trimmed = value.replace(EDGE_WHITESPACE_PATTERN, '');
    const stripped = trimmed
        .replace(ORDERED_LIST_LINE_PATTERN, '$1')
        .replace(UNORDERED_LIST_LINE_PATTERN, '$1')
        .trim();
    if (stripped !== trimmed) {
        return stripped;
    }
    return stripLooseAsteriskPrefix(trimmed);
};

const stripListPrefixFromHtml = (value: string) => {
    if (!value) {
        return '';
    }
    if (typeof document === 'undefined') {
        return stripListPrefix(value);
    }
    const container = document.createElement('div');
    container.innerHTML = value;
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode() as Text | null;
    while (node) {
        if (typeof node.textContent === 'string' && node.textContent.replace(EDGE_WHITESPACE_PATTERN, '')) {
            node.textContent = stripListPrefix(node.textContent);
            break;
        }
        node = walker.nextNode() as Text | null;
    }
    return container.innerHTML.trim();
};

const normalizeAiPlainText = (input: string) => {
    if (!input) {
        return '';
    }
    const trimmed = input.trim();
    if (!trimmed) {
        return '';
    }
    const sanitized = sanitizeRichTextHtml(trimmed);
    if (/<(ul|ol|li)(\s|>)/i.test(sanitized)) {
        const listLines = splitRichTextLines(sanitized);
        const textLines = listLines.map((line) => stripRichTextToText(line));
        const shouldStrip = resolveListPrefixMode(textLines) !== null;
        const normalizedListLines = listLines
            .map((line) => (shouldStrip ? stripListPrefixFromHtml(line) : line.trim()))
            .filter(Boolean);
        return joinNormalizedLines(
            normalizedListLines,
            false,
            shouldStrip ? stripListPrefixFromHtml(sanitized) : sanitized
        );
    }
    if (/<\/?[a-z][\s\S]*>/i.test(sanitized)) {
        const htmlLines = splitRichTextLines(sanitized);
        const textLines = htmlLines.map((line) => stripRichTextToText(line));
        const shouldStrip = resolveListPrefixMode(textLines) !== null;
        const normalizedHtmlLines = htmlLines
            .map((line) => (shouldStrip ? stripListPrefixFromHtml(line) : line.trim()))
            .filter(Boolean);
        return joinNormalizedLines(normalizedHtmlLines, shouldStrip, shouldStrip ? stripListPrefixFromHtml(sanitized) : sanitized);
    }

    let lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length === 1) {
        const inlineParts = splitInlineOrderedList(lines[0]);
        if (inlineParts) {
            lines = inlineParts;
        }
    }

    const shouldStrip = resolveListPrefixMode(lines) !== null;
    const normalizedLines = lines
        .map((line) => (shouldStrip ? stripListPrefix(line) : line))
        .filter(Boolean)
        .map((line) => sanitizeRichTextHtml(line));

    return joinNormalizedLines(
        normalizedLines,
        shouldStrip,
        shouldStrip ? stripListPrefixFromHtml(sanitizeRichTextHtml(trimmed)) : sanitizeRichTextHtml(trimmed)
    );
};

export const normalizeAiRichText = (input: string, options?: NormalizeAiRichTextOptions) => {
    if (options?.allowList === false) {
        return normalizeAiPlainText(input);
    }
    if (!input) {
        return '';
    }
    const trimmed = input.trim();
    if (!trimmed) {
        return '';
    }
    const sanitized = sanitizeRichTextHtml(trimmed);
    if (/<(ul|ol|li)(\s|>)/i.test(sanitized)) {
        return sanitized;
    }

    let lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length === 1) {
        const inlineParts = splitInlineOrderedList(lines[0]);
        if (inlineParts) {
            lines = inlineParts;
        }
    }

    const orderedLines = extractListLines(lines, ORDERED_LIST_LINE_PATTERN);
    if (orderedLines) {
        const items = orderedLines
            .map((line) => `<li>${sanitizeRichTextHtml(line)}</li>`)
            .join('');
        return `<ol>${items}</ol>`;
    }

    const unorderedLines = extractListLines(lines, UNORDERED_LIST_LINE_PATTERN);
    if (unorderedLines) {
        const items = unorderedLines
            .map((line) => `<li>${sanitizeRichTextHtml(line)}</li>`)
            .join('');
        return `<ul>${items}</ul>`;
    }

    return sanitized;
};

export const decodeRichTextEntities = (value: string) => decodeHtmlEntities(value);

export const decodeRichTextEntitiesDeep = (value: string) => {
    let current = value;
    for (let index = 0; index < MAX_HTML_DECODE_PASSES; index += 1) {
        if (!RICH_TEXT_DECODE_PATTERN.test(current)) {
            break;
        }
        const decoded = decodeHtmlEntities(current);
        if (decoded === current) {
            break;
        }
        current = decoded;
    }
    return current;
};
