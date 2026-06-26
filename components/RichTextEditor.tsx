import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
    RICH_TEXT_INLINE_STYLES_CLASS,
    resolveClipboardPasteHtml,
    sanitizeRichTextHtml,
    stripRichTextToText,
} from '../utils/richText';

type RichTextEditorProps = {
    value: string;
    onChange: (value: string) => void;
    className?: string;
    placeholder?: string;
    ariaLabel?: string;
    enableList?: boolean;
    showLineBulletCue?: boolean;
    onUndo?: () => boolean;
    readOnly?: boolean;
};

type ToolbarPlacement = 'selection' | 'editor-bottom';

type ToolbarState = {
    visible: boolean;
    x: number;
    y: number;
    placement: ToolbarPlacement;
};

type ToolbarRect = Pick<DOMRect, 'bottom' | 'left' | 'top' | 'width'>;

type ToolbarViewportInfo = {
    width: number;
    isCoarsePointer: boolean;
};

type LinkPopoverState = {
    visible: boolean;
    x: number;
    y: number;
    url: string;
    text: string;
    isEditing: boolean;
};

type ToolbarButton = {
    id: string;
    label: string;
    title: string;
    className: string;
    onClick: () => void;
};

type TextSegment = {
    node: Text;
    startOffset: number;
    endOffset: number;
    text: string;
};

type LineBulletTop = {
    lineIndex: number;
    top: number;
};

type MarkdownHandleResult = 'handled' | 'not_handled' | 'abort';

const TOOLBAR_OFFSET_Y = 12;
const TOOLBAR_MIN_PADDING = 24;
const MOBILE_SELECTION_TOOLBAR_MAX_VIEWPORT_WIDTH = 767;
const MOBILE_SELECTION_TOOLBAR_BOTTOM_OFFSET_Y = 8;
const LINK_POPOVER_OFFSET_Y = 10;
const LINE_BULLET_LAYOUT_REFRESH_DELAYS_MS = [80, 320];
const DEFAULT_LINK_PROTOCOL = 'https://';
const LINK_URL_PLACEHOLDER = '请输入链接地址';
const LINK_TEXT_PLACEHOLDER = '请输入链接文字（可选）';
const SPACE_KEY = ' ';
const ENTER_KEY = 'Enter';
const NON_BREAKING_SPACE_PATTERN = /[\u00a0\u3000]/g;
const EDGE_WHITESPACE_PATTERN = /^[\s\u00a0\u200b\u200c\u200d\u3000\uFEFF]+|[\s\u00a0\u200b\u200c\u200d\u3000\uFEFF]+$/g;
const UNORDERED_LIST_MARKER = '*';
const ORDERED_LIST_PATTERN = /^\d+\.$/;
const LINE_BOUNDARY_TAGS = new Set(['BR', 'LI', 'UL', 'OL', 'DIV', 'P']);
const MARKDOWN_EDGE_WHITESPACE = '[\\s\\u00a0\\u200b\\u200c\\u200d\\u3000\\uFEFF]*';
const MARKDOWN_BOLD_PATTERN = new RegExp(`\\*\\*${MARKDOWN_EDGE_WHITESPACE}([^*]+?)${MARKDOWN_EDGE_WHITESPACE}\\*\\*${MARKDOWN_EDGE_WHITESPACE}$`);
const MARKDOWN_ITALIC_PATTERN = new RegExp(`\\*${MARKDOWN_EDGE_WHITESPACE}([^*]+?)${MARKDOWN_EDGE_WHITESPACE}\\*${MARKDOWN_EDGE_WHITESPACE}$`);

const escapeHtml = (value: string) =>
    value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

const normalizeMarkdownContent = (value: string) =>
    value.replace(NON_BREAKING_SPACE_PATTERN, ' ').replace(EDGE_WHITESPACE_PATTERN, '');

const normalizeMarkerText = (value: string) =>
    value.replace(NON_BREAKING_SPACE_PATTERN, ' ').trim();

const normalizeTriggerKey = (key: string) => (key === 'Spacebar' || key === 'Space' ? SPACE_KEY : key);

const getSelectionRect = (selection: Selection | null) => {
    if (!selection || selection.rangeCount === 0) {
        return null;
    }
    const range = selection.getRangeAt(0);
    if (range.collapsed) {
        return null;
    }
    const rect = range.getBoundingClientRect();
    if (rect && (rect.width || rect.height)) {
        return rect;
    }
    const rects = range.getClientRects();
    return rects.length > 0 ? rects[0] : null;
};

const getDeepestRightmostNode = (node: Node) => {
    let current = node;
    while (current.lastChild) {
        current = current.lastChild;
    }
    return current;
};

const resolveNodeBeforeCursor = (range: Range, editor: HTMLDivElement) => {
    const container = range.startContainer;
    if (container.nodeType === Node.TEXT_NODE) {
        return { node: container as Text, offset: range.startOffset };
    }
    if (container.nodeType !== Node.ELEMENT_NODE) {
        return null;
    }
    const element = container as Element;
    if (range.startOffset === 0) {
        return null;
    }
    const previous = element.childNodes[range.startOffset - 1];
    if (!previous) {
        return null;
    }
    if (isLineBoundaryNode(previous, editor)) {
        return { node: previous, offset: 0 };
    }
    const lastNode = getDeepestRightmostNode(previous);
    if (lastNode.nodeType === Node.TEXT_NODE) {
        return { node: lastNode as Text, offset: (lastNode as Text).data.length };
    }
    return { node: lastNode, offset: 0 };
};

const getPreviousNode = (node: Node, root: HTMLDivElement) => {
    if (node === root) {
        return null;
    }
    if (node.previousSibling) {
        if (isLineBoundaryNode(node.previousSibling, root)) {
            return node.previousSibling;
        }
        return getDeepestRightmostNode(node.previousSibling);
    }
    return node.parentNode ?? null;
};

const isLineBoundaryNode = (node: Node, editor: HTMLDivElement) => {
    if (node === editor) {
        return true;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
        return false;
    }
    const tagName = (node as HTMLElement).tagName;
    return LINE_BOUNDARY_TAGS.has(tagName);
};

// 使用 DOM 文本节点反向收集，避免 Range.toString 规范化导致的长度偏差。
const getLineContextBeforeCursor = (editor: HTMLDivElement, range: Range) => {
    const start = resolveNodeBeforeCursor(range, editor);
    if (!start) {
        return { segments: [] as TextSegment[], lineText: '' };
    }
    const segments: TextSegment[] = [];
    let current: Node | null = start.node;
    let offset = start.offset;
    let isFirst = true;

    while (current) {
        if (isLineBoundaryNode(current, editor)) {
            break;
        }
        if (current.nodeType === Node.TEXT_NODE) {
            const textNode = current as Text;
            const endOffset = isFirst ? Math.min(offset, textNode.data.length) : textNode.data.length;
            if (endOffset > 0) {
                segments.push({
                    node: textNode,
                    startOffset: 0,
                    endOffset,
                    text: textNode.data.slice(0, endOffset),
                });
            }
        }
        current = getPreviousNode(current, editor);
        isFirst = false;
    }

    segments.reverse();
    return { segments, lineText: segments.map((segment) => segment.text).join('') };
};

const isSelectionInsideList = (selection: Selection | null) => {
    const node = selection?.anchorNode;
    if (!node) {
        return false;
    }
    const element =
        node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : (node.parentElement as HTMLElement | null);
    return Boolean(element?.closest('li'));
};

const resolveListItemFromSelection = (selection: Selection | null) => {
    const node = selection?.anchorNode;
    if (!node) {
        return null;
    }
    const element =
        node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : (node.parentElement as HTMLElement | null);
    const listItem = element?.closest('li');
    return listItem instanceof HTMLLIElement ? listItem : null;
};

const isSelectionAtListItemStart = (selection: Selection | null, listItem: HTMLLIElement) => {
    if (!selection || selection.rangeCount === 0) {
        return false;
    }
    const range = selection.getRangeAt(0).cloneRange();
    range.setStart(listItem, 0);
    const textBefore = range.toString().replace(NON_BREAKING_SPACE_PATTERN, ' ').trim();
    return textBefore.length === 0;
};

const unwrapListItem = (listItem: HTMLLIElement) => {
    const list = listItem.parentElement;
    if (!list || !(list instanceof HTMLUListElement || list instanceof HTMLOListElement)) {
        return;
    }
    const listTag = list.tagName.toLowerCase();
    const parent = list.parentElement;
    if (!parent) {
        return;
    }
    const anchorNode = list.nextSibling;

    const beforeList = document.createElement(listTag);
    while (list.firstChild && list.firstChild !== listItem) {
        beforeList.appendChild(list.firstChild);
    }

    const afterList = document.createElement(listTag);
    while (listItem.nextSibling) {
        afterList.appendChild(listItem.nextSibling);
    }

    const contentWrapper = document.createElement('div');
    if (listItem.childNodes.length) {
        while (listItem.firstChild) {
            contentWrapper.appendChild(listItem.firstChild);
        }
    } else {
        contentWrapper.appendChild(document.createElement('br'));
    }

    listItem.remove();
    if (beforeList.childNodes.length) {
        parent.insertBefore(beforeList, anchorNode);
    }
    parent.insertBefore(contentWrapper, anchorNode);
    if (afterList.childNodes.length) {
        parent.insertBefore(afterList, anchorNode);
    }
    list.remove();

    const selection = window.getSelection();
    if (selection) {
        const range = document.createRange();
        range.selectNodeContents(contentWrapper);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
    }
};

const mapLineOffsetToPosition = (segments: TextSegment[], offset: number, preferNext: boolean) => {
    let count = 0;
    for (let index = 0; index < segments.length; index += 1) {
        const segment = segments[index];
        const nextCount = count + segment.text.length;
        if (offset < nextCount || (offset === nextCount && !preferNext)) {
            return { node: segment.node, offset: segment.startOffset + (offset - count) };
        }
        count = nextCount;
    }
    if (!segments.length) {
        return null;
    }
    const last = segments[segments.length - 1];
    return { node: last.node, offset: last.endOffset };
};

const createRangeFromLineOffsets = (segments: TextSegment[], startOffset: number, endOffset: number) => {
    const start = mapLineOffsetToPosition(segments, startOffset, true);
    const end = mapLineOffsetToPosition(segments, endOffset, false);
    if (!start || !end) {
        return null;
    }
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    return range;
};

const replaceRangeWithHtml = (range: Range, html: string) => {
    const selection = window.getSelection();
    if (!selection) {
        return false;
    }
    selection.removeAllRanges();
    selection.addRange(range);
    range.deleteContents();
    if (html) {
        document.execCommand('insertHTML', false, html);
    }
    return true;
};

const isNodeWithinEditor = (node: Node | null, editor: HTMLDivElement) =>
    Boolean(node && (node === editor || editor.contains(node)));

const isSelectionWithinEditor = (selection: Selection, editor: HTMLDivElement) =>
    isNodeWithinEditor(selection.anchorNode, editor) && isNodeWithinEditor(selection.focusNode, editor);

const ensureEditorSelection = (selection: Selection, editor: HTMLDivElement) => {
    if (selection.rangeCount > 0 && isSelectionWithinEditor(selection, editor)) {
        return selection.getRangeAt(0);
    }
    editor.focus();
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
    return range;
};

const insertClipboardContent = (editor: HTMLDivElement, html: string) => {
    const selection = window.getSelection();
    if (!selection || !html) {
        return false;
    }
    ensureEditorSelection(selection, editor);
    return document.execCommand('insertHTML', false, html);
};

const findMarkdownMatchInLine = (lineText: string, segments: TextSegment[], pattern: RegExp) => {
    const match = lineText.match(pattern);
    if (!match || typeof match.index !== 'number') {
        return null;
    }
    const startOffset = match.index;
    const endOffset = startOffset + match[0].length;
    const range = createRangeFromLineOffsets(segments, startOffset, endOffset);
    if (!range) {
        return null;
    }
    return { range, content: match[1] ?? '' };
};

const insertTrailingTrigger = (triggerKey: string) => {
    if (triggerKey === SPACE_KEY) {
        document.execCommand('insertText', false, ' ');
        return;
    }
    if (triggerKey === ENTER_KEY) {
        document.execCommand('insertLineBreak');
    }
};

const applyListCommand = (command: 'insertUnorderedList' | 'insertOrderedList') => {
    const applied = document.execCommand(command, false);
    if (!applied) {
        const html = command === 'insertOrderedList' ? '<ol><li></li></ol>' : '<ul><li></li></ul>';
        document.execCommand('insertHTML', false, html);
    }
};

const clampPositionXForViewport = (x: number, viewportWidth: number) => {
    const maxX = Math.max(TOOLBAR_MIN_PADDING, viewportWidth - TOOLBAR_MIN_PADDING);
    return Math.min(Math.max(x, TOOLBAR_MIN_PADDING), maxX);
};

const clampPositionX = (x: number) => clampPositionXForViewport(x, window.innerWidth);

export const shouldUseMobileSelectionToolbar = ({ width, isCoarsePointer }: ToolbarViewportInfo) =>
    isCoarsePointer || width <= MOBILE_SELECTION_TOOLBAR_MAX_VIEWPORT_WIDTH;

export const resolveRichTextToolbarState = (
    selectionRect: ToolbarRect,
    editorRect: ToolbarRect,
    viewportInfo: ToolbarViewportInfo
): ToolbarState => {
    if (shouldUseMobileSelectionToolbar(viewportInfo)) {
        return {
            visible: true,
            x: clampPositionXForViewport(editorRect.left + editorRect.width / 2, viewportInfo.width),
            y: editorRect.bottom + MOBILE_SELECTION_TOOLBAR_BOTTOM_OFFSET_Y,
            placement: 'editor-bottom',
        };
    }
    return {
        visible: true,
        x: clampPositionXForViewport(selectionRect.left + selectionRect.width / 2, viewportInfo.width),
        y: selectionRect.top - TOOLBAR_OFFSET_Y,
        placement: 'selection',
    };
};

const getToolbarViewportInfo = (): ToolbarViewportInfo => ({
    width: window.innerWidth,
    isCoarsePointer: Boolean(
        window.matchMedia?.('(pointer: coarse)').matches || window.matchMedia?.('(hover: none)').matches
    ),
});

const normalizeLink = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
        return '';
    }
    if (/^(https?:\/\/|mailto:|tel:)/i.test(trimmed)) {
        return trimmed;
    }
    return `${DEFAULT_LINK_PROTOCOL}${trimmed}`;
};

const getClosestLinkElement = (node: Node | null, editor: HTMLDivElement) => {
    if (!node) {
        return null;
    }
    const element = node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement;
    if (!element) {
        return null;
    }
    const link = element.closest('a');
    if (!(link instanceof HTMLAnchorElement) || !editor.contains(link)) {
        return null;
    }
    return link;
};

const resolveLinkFromSelection = (selection: Selection, editor: HTMLDivElement) => {
    const anchorLink = getClosestLinkElement(selection.anchorNode, editor);
    const focusLink = getClosestLinkElement(selection.focusNode, editor);
    if (anchorLink && focusLink && anchorLink === focusLink) {
        return anchorLink;
    }
    if (selection.isCollapsed && anchorLink) {
        return anchorLink;
    }
    return null;
};

const createRangeFromNode = (node: Node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    return range;
};

const restoreSelectionRange = (range: Range | null) => {
    const selection = window.getSelection();
    if (!selection || !range) {
        return null;
    }
    selection.removeAllRanges();
    selection.addRange(range);
    return selection;
};

const updateLinkElement = (link: HTMLAnchorElement, href: string, label: string, shouldUpdateText: boolean) => {
    link.setAttribute('href', href);
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noreferrer');
    if (shouldUpdateText && label) {
        link.textContent = label;
    }
};

const RichTextToolbar: React.FC<{
    state: ToolbarState;
    buttons: ToolbarButton[];
    inline?: boolean;
}> = ({ state, buttons, inline = false }) => {
    if (!state.visible || typeof document === 'undefined') {
        return null;
    }
    const toolbar = (
        <div
            className={`${inline ? 'absolute left-1/2 top-full z-20 mt-2' : 'fixed z-[90]'} flex max-w-[calc(100vw-16px)] items-center gap-1 rounded-md bg-emerald-700 px-2 py-1 text-white shadow-lg`}
            style={inline ? { transform: 'translateX(-50%)' } : { left: state.x, top: state.y, transform: 'translate(-50%, -100%)' }}
            onMouseDown={(event) => event.preventDefault()}
        >
            {buttons.map((button) => (
                <button
                    key={button.id}
                    type="button"
                    title={button.title}
                    aria-label={button.title}
                    className={`px-1.5 py-0.5 rounded hover:bg-emerald-600 transition-colors ${button.className}`}
                    onClick={button.onClick}
                >
                    {button.label}
                </button>
            ))}
        </div>
    );
    return inline ? toolbar : createPortal(toolbar, document.body);
};

const RichTextLinkPopover: React.FC<{
    state: LinkPopoverState;
    onClose: () => void;
    onSubmit: () => void;
    onRemove: () => void;
    onUrlChange: (value: string) => void;
    onTextChange: (value: string) => void;
}> = ({ state, onClose, onSubmit, onRemove, onUrlChange, onTextChange }) => {
    if (!state.visible || typeof document === 'undefined') {
        return null;
    }

    const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === ENTER_KEY) {
            event.preventDefault();
            onSubmit();
        }
        if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
        }
    };

    return createPortal(
        <div
            className="fixed z-[90] w-72 rounded-lg border border-emerald-200 bg-white shadow-xl px-3 py-2 space-y-2 text-sm"
            style={{ left: state.x, top: state.y, transform: 'translate(-50%, -100%)' }}
        >
            <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-emerald-700">超链接</span>
                <button
                    type="button"
                    className="text-gray-400 hover:text-gray-700 transition-colors"
                    aria-label="关闭"
                    onClick={onClose}
                >
                    X
                </button>
            </div>
            <input
                className="w-full border border-gray-200 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200"
                placeholder={LINK_URL_PLACEHOLDER}
                value={state.url}
                onChange={(event) => onUrlChange(event.target.value)}
                onKeyDown={handleKeyDown}
            />
            <input
                className="w-full border border-gray-200 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200"
                placeholder={LINK_TEXT_PLACEHOLDER}
                value={state.text}
                onChange={(event) => onTextChange(event.target.value)}
                onKeyDown={handleKeyDown}
            />
            <div className="flex items-center justify-end gap-2 pt-1">
                {state.isEditing ? (
                    <button
                        type="button"
                        className="mr-auto px-2 py-1 text-xs text-rose-500 hover:text-rose-600"
                        onClick={onRemove}
                    >
                        解除链接
                    </button>
                ) : null}
                <button
                    type="button"
                    className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700"
                    onClick={onClose}
                >
                    取消
                </button>
                <button
                    type="button"
                    className="px-3 py-1 text-xs font-semibold text-white bg-emerald-600 rounded-md hover:bg-emerald-700"
                    onClick={onSubmit}
                >
                    应用
                </button>
            </div>
        </div>,
        document.body
    );
};

const collectTextNodes = (root: Node) => {
    const nodes: Text[] = [];
    const visit = (node: Node) => {
        if (node.nodeType === Node.TEXT_NODE) {
            nodes.push(node as Text);
            return;
        }
        node.childNodes.forEach(visit);
    };
    visit(root);
    return nodes;
};

const resolveTextPosition = (nodes: Text[], targetOffset: number) => {
    let offset = targetOffset;
    for (const node of nodes) {
        if (offset <= node.data.length) {
            return { node, offset };
        }
        offset -= node.data.length;
    }
    const lastNode = nodes[nodes.length - 1];
    return lastNode ? { node: lastNode, offset: lastNode.data.length } : null;
};

const getEditorLineHeight = (editor: HTMLDivElement) => {
    const styles = getComputedStyle(editor);
    const lineHeight = parseFloat(styles.lineHeight);
    if (Number.isFinite(lineHeight)) {
        return lineHeight;
    }
    const fontSize = parseFloat(styles.fontSize);
    return Number.isFinite(fontSize) ? fontSize * 1.5 : 20;
};

const getCollapsedRangeTop = (range: Range, editor: HTMLDivElement) => {
    const editorRect = editor.getBoundingClientRect();
    const rects = Array.from(range.getClientRects());
    const rect = rects.find((item) => item.width || item.height) ?? range.getBoundingClientRect();
    if (rect && (rect.width || rect.height)) {
        return rect.top - editorRect.top + editor.scrollTop;
    }
    return null;
};

export const resolvePlainLineBulletCueIndices = (
    lines: string[],
    includeCaretLine: boolean,
    caretLineIndex: number | null
) => {
    const indices = new Set<number>();
    lines.forEach((line, index) => {
        if (line.trim()) {
            indices.add(index);
        }
    });
    if (
        includeCaretLine &&
        caretLineIndex !== null &&
        caretLineIndex >= 0 &&
        caretLineIndex < lines.length &&
        !(lines[caretLineIndex] ?? '').trim()
    ) {
        indices.add(caretLineIndex);
    }
    return Array.from(indices).sort((a, b) => a - b);
};

const inferLineBulletTop = (editor: HTMLDivElement, measuredLineTops: LineBulletTop[], lineIndex: number) => {
    const lineHeight = getEditorLineHeight(editor);
    const exactLine = measuredLineTops.find((entry) => entry.lineIndex === lineIndex);
    if (exactLine) {
        return exactLine.top;
    }
    const previousLines = measuredLineTops.filter((entry) => entry.lineIndex < lineIndex);
    const previousLine = previousLines[previousLines.length - 1];
    if (previousLine) {
        return previousLine.top + (lineIndex - previousLine.lineIndex) * lineHeight;
    }
    const nextLine = measuredLineTops.find((entry) => entry.lineIndex > lineIndex);
    if (nextLine) {
        return nextLine.top - (nextLine.lineIndex - lineIndex) * lineHeight;
    }
    return editor.scrollTop;
};

const resolveCaretLineIndex = (editor: HTMLDivElement) => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) {
        return null;
    }
    const anchorNode = selection.anchorNode;
    if (!anchorNode || !editor.contains(anchorNode) || isSelectionInsideList(selection)) {
        return null;
    }

    const range = selection.getRangeAt(0).cloneRange();
    const beforeRange = document.createRange();
    beforeRange.selectNodeContents(editor);
    try {
        beforeRange.setEnd(range.startContainer, range.startOffset);
    } catch {
        return null;
    }

    return beforeRange.toString().split('\n').length - 1;
};

const measureCaretBulletTop = (
    editor: HTMLDivElement,
    measuredLineTops: LineBulletTop[],
    lines: string[],
    caretLineIndex: number
) => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) {
        return null;
    }
    const anchorNode = selection.anchorNode;
    if (!anchorNode || !editor.contains(anchorNode) || isSelectionInsideList(selection)) {
        return null;
    }

    const range = selection.getRangeAt(0).cloneRange();
    const lineIndex = caretLineIndex;
    const isBlankCaretLine = !(lines[lineIndex] ?? '').trim();
    if (!isBlankCaretLine) {
        const measuredTop = getCollapsedRangeTop(range, editor);
        if (measuredTop !== null) {
            return measuredTop;
        }
    }

    return inferLineBulletTop(editor, measuredLineTops, lineIndex);
};

const measurePlainLineBulletTops = (editor: HTMLDivElement, includeCaretLine = false) => {
    if (editor.querySelector('li')) {
        return [];
    }

    const text = editor.innerText || editor.textContent || '';
    const lines = text.split('\n');
    const caretLineIndex = includeCaretLine ? resolveCaretLineIndex(editor) : null;
    const cueLineIndices = resolvePlainLineBulletCueIndices(lines, includeCaretLine, caretLineIndex);
    if (!cueLineIndices.length) {
        return [];
    }

    const textNodes = collectTextNodes(editor);
    if (!textNodes.length && cueLineIndices.some((lineIndex) => (lines[lineIndex] ?? '').trim())) {
        return [];
    }

    const editorRect = editor.getBoundingClientRect();
    const tops: number[] = [];
    const measuredLineTops: LineBulletTop[] = [];
    const cueLineIndexSet = new Set(cueLineIndices);
    let textOffset = 0;

    for (const [lineIndex, line] of lines.entries()) {
        if (!cueLineIndexSet.has(lineIndex)) {
            textOffset += line.length + 1;
            continue;
        }
        const firstTextIndex = line.search(/\S/);
        if (firstTextIndex >= 0) {
            const position = resolveTextPosition(textNodes, textOffset + firstTextIndex);
            if (position) {
                const range = document.createRange();
                range.setStart(position.node, position.offset);
                range.setEnd(position.node, Math.min(position.offset + 1, position.node.data.length));
                const rect = range.getBoundingClientRect();
                if (rect && (rect.width || rect.height)) {
                    const top = rect.top - editorRect.top + editor.scrollTop;
                    if (!tops.some((value) => Math.abs(value - top) < 1)) {
                        tops.push(top);
                        measuredLineTops.push({ lineIndex, top });
                    }
                }
            }
        }
        textOffset += line.length + 1;
    }

    if (
        includeCaretLine &&
        caretLineIndex !== null &&
        cueLineIndexSet.has(caretLineIndex) &&
        !(lines[caretLineIndex] ?? '').trim()
    ) {
        const caretTop = measureCaretBulletTop(editor, measuredLineTops, lines, caretLineIndex);
        if (caretTop !== null && !tops.some((value) => Math.abs(value - caretTop) < 1)) {
            tops.push(caretTop);
        }
    }

    return tops.sort((a, b) => a - b);
};

const useLineBulletCueTops = (
    editorRef: React.RefObject<HTMLDivElement>,
    enabled: boolean,
    value: string,
    isFocused: boolean
) => {
    const [tops, setTops] = useState<number[]>([]);

    const updateTops = useCallback(() => {
        const editor = editorRef.current;
        if (!enabled || !editor) {
            setTops((prev) => (prev.length ? [] : prev));
            return;
        }
        const selection = window.getSelection();
        const hasEditorFocus =
            document.activeElement === editor ||
            Boolean(selection?.anchorNode && editor.contains(selection.anchorNode));
        const nextTops = measurePlainLineBulletTops(editor, isFocused || hasEditorFocus);
        setTops((prev) => {
            if (prev.length === nextTops.length && prev.every((top, index) => Math.abs(top - nextTops[index]) < 0.5)) {
                return prev;
            }
            return nextTops;
        });
    }, [editorRef, enabled, isFocused]);

    useEffect(() => {
        updateTops();
        const frameId = requestAnimationFrame(updateTops);
        return () => cancelAnimationFrame(frameId);
    }, [updateTops, value, isFocused]);

    useEffect(() => {
        if (!enabled) {
            return;
        }
        const editor = editorRef.current;
        if (!editor) {
            return;
        }

        let cancelled = false;
        const frameIds = new Set<number>();
        const timeoutIds = new Set<number>();

        const scheduleUpdate = () => {
            if (cancelled) {
                return;
            }
            const frameId = requestAnimationFrame(() => {
                frameIds.delete(frameId);
                if (!cancelled) {
                    updateTops();
                }
            });
            frameIds.add(frameId);
        };

        LINE_BULLET_LAYOUT_REFRESH_DELAYS_MS.forEach((delay) => {
            const timeoutId = window.setTimeout(() => {
                timeoutIds.delete(timeoutId);
                scheduleUpdate();
            }, delay);
            timeoutIds.add(timeoutId);
        });

        document.fonts?.ready.then(scheduleUpdate).catch(() => undefined);

        const resizeObserver =
            typeof ResizeObserver === 'undefined'
                ? null
                : new ResizeObserver(scheduleUpdate);
        resizeObserver?.observe(editor);

        return () => {
            cancelled = true;
            resizeObserver?.disconnect();
            frameIds.forEach((frameId) => cancelAnimationFrame(frameId));
            timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
        };
    }, [editorRef, enabled, updateTops, value]);

    useEffect(() => {
        if (!enabled) {
            return;
        }
        const editor = editorRef.current;
        if (!editor) {
            return;
        }
        const handleResize = () => updateTops();
        window.addEventListener('resize', handleResize);
        editor.addEventListener('scroll', handleResize);
        return () => {
            window.removeEventListener('resize', handleResize);
            editor.removeEventListener('scroll', handleResize);
        };
    }, [editorRef, enabled, updateTops]);

    return { tops, updateTops };
};

const useToolbarState = (editorRef: React.RefObject<HTMLDivElement>) => {
    const [toolbar, setToolbar] = useState<ToolbarState>({
        visible: false,
        x: 0,
        y: 0,
        placement: 'selection',
    });

    const hideToolbar = useCallback(() => {
        setToolbar((prev) => (prev.visible ? { ...prev, visible: false } : prev));
    }, []);

    const updateSelectionState = useCallback(() => {
        const editor = editorRef.current;
        if (!editor) {
            return;
        }
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) {
            hideToolbar();
            return;
        }
        const anchorNode = selection.anchorNode;
        const focusNode = selection.focusNode;
        if (!anchorNode || !focusNode || !editor.contains(anchorNode) || !editor.contains(focusNode)) {
            hideToolbar();
            return;
        }
        const rect = getSelectionRect(selection);
        if (!rect) {
            hideToolbar();
            return;
        }
        const editorRect = editor.getBoundingClientRect();
        setToolbar(resolveRichTextToolbarState(rect, editorRect, getToolbarViewportInfo()));
    }, [editorRef, hideToolbar]);

    useEffect(() => {
        const handleScroll = () => hideToolbar();
        const handleSelectionChange = () => {
            updateSelectionState();
        };
        document.addEventListener('selectionchange', handleSelectionChange);
        window.addEventListener('scroll', handleScroll, true);
        return () => {
            document.removeEventListener('selectionchange', handleSelectionChange);
            window.removeEventListener('scroll', handleScroll, true);
        };
    }, [hideToolbar, updateSelectionState]);

    return { toolbar, hideToolbar, updateSelectionState };
};

const useTextFormatting = ({
    editorRef,
    onChange,
    updateSelectionState,
}: {
    editorRef: React.RefObject<HTMLDivElement>;
    onChange: (value: string) => void;
    updateSelectionState: () => void;
}) => {
    const applyReplacement = useCallback(
        (nextValue: string) => {
            onChange(nextValue);
            updateSelectionState();
        },
        [onChange, updateSelectionState]
    );

    const applyWrap = useCallback(
        (command: 'bold' | 'italic' | 'underline') => {
            const editor = editorRef.current;
            if (!editor) {
                return;
            }
            editor.focus();
            document.execCommand(command, false);
            const updated = sanitizeRichTextHtml(editor.innerHTML);
            applyReplacement(updated);
        },
        [applyReplacement, editorRef]
    );

    const applyList = useCallback(
        (command: 'insertUnorderedList' | 'insertOrderedList') => {
            const editor = editorRef.current;
            if (!editor) {
                return;
            }
            editor.focus();
            applyListCommand(command);
            const updated = sanitizeRichTextHtml(editor.innerHTML);
            applyReplacement(updated);
        },
        [applyReplacement, editorRef]
    );

    return { applyWrap, applyList };
};

const useEditorSync = (
    editorRef: React.RefObject<HTMLDivElement>,
    value: string,
    isFocused: boolean,
    lastLocalValueRef: React.MutableRefObject<string | null>
) => {
    useEffect(() => {
        const editor = editorRef.current;
        if (!editor) {
            return;
        }
        const sanitized = sanitizeRichTextHtml(value);
        if (isFocused && sanitized === lastLocalValueRef.current) {
            return;
        }
        if (editor.innerHTML !== sanitized) {
            editor.innerHTML = sanitized;
            lastLocalValueRef.current = null;
        }
    }, [editorRef, value, isFocused, lastLocalValueRef]);
};

const useRichTextHandlers = ({
    editorRef,
    onChange,
    updateSelectionState,
    hideToolbar,
    setIsFocused,
    lastLocalValueRef,
    enableList,
    onUndo,
}: {
    editorRef: React.RefObject<HTMLDivElement>;
    onChange: (value: string) => void;
    updateSelectionState: () => void;
    hideToolbar: () => void;
    setIsFocused: (state: boolean) => void;
    lastLocalValueRef: React.MutableRefObject<string | null>;
    enableList: boolean;
    onUndo?: () => boolean;
}) => {
    // 抽取保存内容逻辑，避免在blur时触发selection更新
    const saveContent = useCallback(() => {
        const editor = editorRef.current;
        if (!editor) {
            return;
        }
        const sanitized = sanitizeRichTextHtml(editor.innerHTML);
        lastLocalValueRef.current = sanitized;
        onChange(sanitized);
    }, [editorRef, lastLocalValueRef, onChange]);

    const handleInput = useCallback(() => {
        saveContent();
        updateSelectionState();
    }, [saveContent, updateSelectionState]);

    const persistMarkdownChange = useCallback(
        (triggerKey: string, isInList: boolean) => {
            if (!(triggerKey === ENTER_KEY && isInList)) {
                insertTrailingTrigger(triggerKey);
            }
            saveContent();
            updateSelectionState();
        },
        [saveContent, updateSelectionState]
    );

    const tryApplyListMarker = useCallback(
        (
            command: 'insertUnorderedList' | 'insertOrderedList',
            segments: TextSegment[],
            lineText: string
        ) => {
            const removalRange = createRangeFromLineOffsets(segments, 0, lineText.length);
            if (!removalRange) {
                return false;
            }
            if (!replaceRangeWithHtml(removalRange, '')) {
                return false;
            }
            applyListCommand(command);
            saveContent();
            updateSelectionState();
            return true;
        },
        [saveContent, updateSelectionState]
    );

    const tryReplaceInlineMarkdown = useCallback(
        (
            pattern: RegExp,
            htmlTag: 'b' | 'i',
            lineText: string,
            segments: TextSegment[],
            triggerKey: string,
            isInList: boolean
        ): MarkdownHandleResult => {
            const match = findMarkdownMatchInLine(lineText, segments, pattern);
            if (!match) {
                return 'not_handled';
            }
            const normalized = normalizeMarkdownContent(match.content);
            if (!normalized) {
                return 'abort';
            }
            const replaced = replaceRangeWithHtml(
                match.range,
                `<${htmlTag}>${escapeHtml(normalized)}</${htmlTag}>`
            );
            if (!replaced) {
                return 'not_handled';
            }
            persistMarkdownChange(triggerKey, isInList);
            return 'handled';
        },
        [persistMarkdownChange]
    );

    const handleMarkdownInput = useCallback(
        (triggerKey: string, isInList: boolean) => {
            const editor = editorRef.current;
            if (!editor) {
                return false;
            }
            const selection = window.getSelection();
            if (!selection || selection.rangeCount === 0) {
                return false;
            }
            const range = selection.getRangeAt(0);
            if (!range.collapsed) {
                return false;
            }

            const { segments, lineText } = getLineContextBeforeCursor(editor, range);
            if (!segments.length) {
                return false;
            }
            if (enableList && triggerKey === SPACE_KEY) {
                const normalizedLineText = normalizeMarkerText(lineText);
                if (normalizedLineText === UNORDERED_LIST_MARKER) {
                    const handled = tryApplyListMarker('insertUnorderedList', segments, lineText);
                    if (handled) {
                        return true;
                    }
                }
                if (ORDERED_LIST_PATTERN.test(normalizedLineText)) {
                    const handled = tryApplyListMarker('insertOrderedList', segments, lineText);
                    if (handled) {
                        return true;
                    }
                }
            }

            const boldResult = tryReplaceInlineMarkdown(
                MARKDOWN_BOLD_PATTERN,
                'b',
                lineText,
                segments,
                triggerKey,
                isInList
            );
            if (boldResult === 'handled') {
                return true;
            }
            if (boldResult === 'abort') {
                return false;
            }

            const italicResult = tryReplaceInlineMarkdown(
                MARKDOWN_ITALIC_PATTERN,
                'i',
                lineText,
                segments,
                triggerKey,
                isInList
            );
            if (italicResult === 'handled') {
                return true;
            }
            if (italicResult === 'abort') {
                return false;
            }

            return false;
        },
        [editorRef, enableList, tryApplyListMarker, tryReplaceInlineMarkdown]
    );

    const handlePaste = useCallback((event: React.ClipboardEvent<HTMLDivElement>) => {
        event.preventDefault();
        const editor = event.currentTarget;
        const html = event.clipboardData.getData('text/html');
        const text = event.clipboardData.getData('text/plain');
        insertClipboardContent(editor, resolveClipboardPasteHtml(html, text));
        saveContent();
        updateSelectionState();
    }, [saveContent, updateSelectionState]);

    const handleCopy = useCallback((event: React.ClipboardEvent<HTMLDivElement>) => {
        const editor = editorRef.current;
        const selection = window.getSelection();
        if (!editor || !selection || selection.rangeCount === 0 || selection.isCollapsed) {
            return;
        }
        const anchorNode = selection.anchorNode;
        const focusNode = selection.focusNode;
        if (!anchorNode || !focusNode || !editor.contains(anchorNode) || !editor.contains(focusNode)) {
            return;
        }
        const container = document.createElement('div');
        container.appendChild(selection.getRangeAt(0).cloneContents());
        const html = sanitizeRichTextHtml(container.innerHTML);
        if (!html) {
            return;
        }
        event.clipboardData.setData('text/html', html);
        event.clipboardData.setData('text/plain', stripRichTextToText(html));
        event.preventDefault();
    }, [editorRef]);

    const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
        const isUndo = (event.ctrlKey || event.metaKey)
            && !event.shiftKey
            && !event.altKey
            && event.key.toLowerCase() === 'z';
        if (isUndo && onUndo?.()) {
            event.preventDefault();
            return;
        }
        const triggerKey = normalizeTriggerKey(event.key);
        const selection = window.getSelection();
        const isInList = isSelectionInsideList(selection);
        if (triggerKey === SPACE_KEY || triggerKey === ENTER_KEY) {
            const handled = handleMarkdownInput(triggerKey, isInList);
            if (handled) {
                if (!(triggerKey === ENTER_KEY && isInList)) {
                    event.preventDefault();
                }
                return;
            }
        }

        if (triggerKey === ENTER_KEY) {
            if (isInList) {
                return;
            }
            event.preventDefault();
            document.execCommand('insertLineBreak');
            saveContent();
            updateSelectionState();
        }
        if (event.key === 'Backspace') {
            const selection = window.getSelection();
            if (!selection || selection.rangeCount === 0 || !selection.getRangeAt(0).collapsed) {
                return;
            }
            const listItem = resolveListItemFromSelection(selection);
            if (!listItem) {
                return;
            }
            if (!isSelectionAtListItemStart(selection, listItem)) {
                return;
            }
            event.preventDefault();
            unwrapListItem(listItem);
            saveContent();
            updateSelectionState();
        }
    }, [handleMarkdownInput, onUndo, saveContent, updateSelectionState]);

    const handleFocus = useCallback(() => setIsFocused(true), [setIsFocused]);

    const handleBlur = useCallback(() => {
        setIsFocused(false);
        hideToolbar();
        // 只保存内容，不触发selection更新，避免浮窗重新出现
        saveContent();
    }, [saveContent, hideToolbar, setIsFocused]);

    return { handleInput, handlePaste, handleCopy, handleKeyDown, handleFocus, handleBlur };
};

const RichTextEditor: React.FC<RichTextEditorProps> = ({
    value,
    onChange,
    className,
    placeholder,
    ariaLabel,
    enableList = true,
    showLineBulletCue = false,
    onUndo,
    readOnly = false,
}) => {
    const editorRef = useRef<HTMLDivElement | null>(null);
    const lastLocalValueRef = useRef<string | null>(null);
    const [isFocused, setIsFocused] = useState(false);
    const listStylesClass =
        '[&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5 [&_li]:my-1';
    const editorClassName = `${className ?? ''} whitespace-pre-wrap break-words outline-none overflow-y-auto ${listStylesClass} ${RICH_TEXT_INLINE_STYLES_CLASS}`;

    useEditorSync(editorRef, value, isFocused, lastLocalValueRef);
    const { tops: lineBulletCueTops, updateTops: updateLineBulletCueTops } = useLineBulletCueTops(
        editorRef,
        showLineBulletCue,
        value,
        isFocused
    );
    const { toolbar, hideToolbar, updateSelectionState } = useToolbarState(editorRef);
    const { applyWrap, applyList } = useTextFormatting({
        editorRef,
        onChange,
        updateSelectionState,
    });
    const linkRangeRef = useRef<Range | null>(null);
    const linkElementRef = useRef<HTMLAnchorElement | null>(null);
    const [linkPopover, setLinkPopover] = useState<LinkPopoverState>({
        visible: false,
        x: 0,
        y: 0,
        url: '',
        text: '',
        isEditing: false,
    });

    const closeLinkPopover = useCallback(() => {
        setLinkPopover((prev) => (prev.visible ? { ...prev, visible: false } : prev));
        linkRangeRef.current = null;
        linkElementRef.current = null;
    }, []);

    const openLinkPopover = useCallback(() => {
        const editor = editorRef.current;
        if (!editor) {
            return;
        }
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) {
            return;
        }
        const anchorNode = selection.anchorNode;
        const focusNode = selection.focusNode;
        if (!anchorNode || !focusNode || !editor.contains(anchorNode) || !editor.contains(focusNode)) {
            return;
        }
        const range = selection.getRangeAt(0);
        const existingLink = resolveLinkFromSelection(selection, editor);
        const linkRange = existingLink ? createRangeFromNode(existingLink) : range.cloneRange();
        linkRangeRef.current = linkRange;
        linkElementRef.current = existingLink;
        const selectionRect = getSelectionRect(selection);
        const rangeRect = linkRange.getBoundingClientRect();
        const fallbackRect = editor.getBoundingClientRect();
        const rect =
            selectionRect && (selectionRect.width || selectionRect.height)
                ? selectionRect
                : rangeRect && (rangeRect.width || rangeRect.height)
                    ? rangeRect
                    : fallbackRect;
        const x = clampPositionX(rect.left + rect.width / 2);
        const y = rect.top - LINK_POPOVER_OFFSET_Y;
        const selectionText = selection.toString();
        const existingText = existingLink?.textContent ?? '';
        const existingUrl = existingLink?.getAttribute('href') ?? '';
        setLinkPopover({
            visible: true,
            x,
            y,
            url: existingUrl || DEFAULT_LINK_PROTOCOL,
            text: existingLink ? existingText : selectionText,
            isEditing: Boolean(existingLink),
        });
        hideToolbar();
    }, [editorRef, hideToolbar]);

    const updateLinkPopover = useCallback((updates: Partial<LinkPopoverState>) => {
        setLinkPopover((prev) => ({ ...prev, ...updates }));
    }, []);

    const applyLinkFromPopover = useCallback(() => {
        const editor = editorRef.current;
        if (!editor) {
            return;
        }
        const href = normalizeLink(linkPopover.url);
        if (!href) {
            closeLinkPopover();
            return;
        }
        const range = linkRangeRef.current;
        const existingLink = linkElementRef.current;
        const selectedText = range?.toString() ?? '';
        const existingText = existingLink?.textContent ?? '';
        const inputText = linkPopover.text.trim();
        const fallbackText = selectedText.trim() || existingText.trim();
        const label = inputText || fallbackText;
        if (!label) {
            closeLinkPopover();
            return;
        }
        editor.focus();
        if (existingLink && editor.contains(existingLink)) {
            const shouldUpdateText = Boolean(inputText) && inputText !== existingText.trim();
            updateLinkElement(existingLink, href, label, shouldUpdateText);
        } else {
            const selection = restoreSelectionRange(range);
            if (selection && selection.toString()) {
                document.execCommand('createLink', false, href);
            } else {
                document.execCommand('insertHTML', false, `<a href="${href}">${escapeHtml(label)}</a>`);
            }
        }
        const updated = sanitizeRichTextHtml(editor.innerHTML);
        onChange(updated);
        updateSelectionState();
        closeLinkPopover();
    }, [closeLinkPopover, editorRef, linkPopover.text, linkPopover.url, onChange, updateSelectionState]);

    const removeLinkFromPopover = useCallback(() => {
        const editor = editorRef.current;
        if (!editor) {
            return;
        }
        const existingLink = linkElementRef.current;
        if (!existingLink || !editor.contains(existingLink)) {
            closeLinkPopover();
            return;
        }
        editor.focus();
        const range = createRangeFromNode(existingLink);
        const selection = restoreSelectionRange(range);
        if (selection) {
            document.execCommand('unlink');
        }
        const updated = sanitizeRichTextHtml(editor.innerHTML);
        onChange(updated);
        updateSelectionState();
        closeLinkPopover();
    }, [closeLinkPopover, editorRef, onChange, updateSelectionState]);

    const toolbarButtons = useMemo(() => {
        const baseButtons = [
            { id: 'bold', label: 'B', title: '加粗', onClick: () => applyWrap('bold'), className: 'font-bold' },
            { id: 'italic', label: 'I', title: '斜体', onClick: () => applyWrap('italic'), className: 'italic' },
            { id: 'underline', label: 'U', title: '下划线', onClick: () => applyWrap('underline'), className: 'underline' },
            { id: 'link', label: 'Link', title: '超链接', onClick: openLinkPopover, className: 'text-xs' },
        ];
        if (!enableList) {
            return baseButtons;
        }
        return [
            ...baseButtons.slice(0, 3),
            {
                id: 'unordered-list',
                label: '•',
                title: '无序列表',
                onClick: () => applyList('insertUnorderedList'),
                className: 'text-sm',
            },
            baseButtons[3],
        ];
    }, [applyList, applyWrap, enableList, openLinkPopover]);

    const { handleInput, handlePaste, handleCopy, handleKeyDown, handleFocus, handleBlur } = useRichTextHandlers({
        editorRef,
        onChange,
        updateSelectionState,
        hideToolbar,
        setIsFocused,
        lastLocalValueRef,
        enableList,
        onUndo,
    });

    const handleEditorInput = useCallback(
        () => {
            handleInput();
            if (showLineBulletCue) {
                requestAnimationFrame(updateLineBulletCueTops);
            }
        },
        [handleInput, showLineBulletCue, updateLineBulletCueTops]
    );

    const handleEditorKeyDown = useCallback(
        (event: React.KeyboardEvent<HTMLDivElement>) => {
            handleKeyDown(event);
            if (showLineBulletCue) {
                requestAnimationFrame(updateLineBulletCueTops);
            }
        },
        [handleKeyDown, showLineBulletCue, updateLineBulletCueTops]
    );

    const isEmpty = !stripRichTextToText(value).trim();
    const hasInlineToolbar = toolbar.visible && toolbar.placement === 'editor-bottom';

    useEffect(() => {
        if (!readOnly) {
            return;
        }
        hideToolbar();
        closeLinkPopover();
        setIsFocused(false);
    }, [closeLinkPopover, hideToolbar, readOnly]);

    return (
        <div className="relative">
            <div
                ref={editorRef}
                className={editorClassName}
                contentEditable={!readOnly}
                role="textbox"
                aria-label={ariaLabel}
                aria-readonly={readOnly}
                data-placeholder={placeholder}
                onInput={readOnly ? undefined : handleEditorInput}
                onCopy={readOnly ? undefined : handleCopy}
                onPaste={readOnly ? undefined : handlePaste}
                onKeyDown={readOnly ? undefined : handleEditorKeyDown}
                onMouseUp={readOnly ? undefined : updateSelectionState}
                onTouchEnd={readOnly ? undefined : updateSelectionState}
                onKeyUp={readOnly ? undefined : updateSelectionState}
                onScroll={hideToolbar}
                onFocus={readOnly ? undefined : handleFocus}
                onBlur={readOnly ? undefined : handleBlur}
                suppressContentEditableWarning
            />
            {showLineBulletCue && lineBulletCueTops.length ? (
                <div className="rich-text-line-bullet-cues" aria-hidden="true">
                    {lineBulletCueTops.map((top, index) => (
                        <span
                            key={`${index}-${Math.round(top)}`}
                            className="rich-text-line-bullet-cue-dot"
                            style={{ top }}
                        >
                            •
                        </span>
                    ))}
                </div>
            ) : null}
            {isEmpty && !isFocused && placeholder ? (
                <div className="pointer-events-none absolute left-3 top-2 text-sm text-gray-400">
                    {placeholder}
                </div>
            ) : null}
            {!readOnly ? <RichTextToolbar state={toolbar} buttons={toolbarButtons} inline={hasInlineToolbar} /> : null}
            {!readOnly ? (
                <RichTextLinkPopover
                    state={linkPopover}
                    onClose={closeLinkPopover}
                    onSubmit={applyLinkFromPopover}
                    onRemove={removeLinkFromPopover}
                    onUrlChange={(value) => updateLinkPopover({ url: value })}
                    onTextChange={(value) => updateLinkPopover({ text: value })}
                />
            ) : null}
        </div>
    );
};

export default RichTextEditor;
