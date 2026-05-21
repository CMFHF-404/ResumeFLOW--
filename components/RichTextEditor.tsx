import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { RICH_TEXT_INLINE_STYLES_CLASS, sanitizeRichTextHtml, stripRichTextToText } from '../utils/richText';

type RichTextEditorProps = {
    value: string;
    onChange: (value: string) => void;
    className?: string;
    placeholder?: string;
    ariaLabel?: string;
    enableList?: boolean;
    onUndo?: () => boolean;
    readOnly?: boolean;
};

type ToolbarState = {
    visible: boolean;
    x: number;
    y: number;
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

type MarkdownHandleResult = 'handled' | 'not_handled' | 'abort';

const TOOLBAR_OFFSET_Y = 12;
const TOOLBAR_MIN_PADDING = 24;
const LINK_POPOVER_OFFSET_Y = 10;
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

const clampPositionX = (x: number) =>
    Math.min(Math.max(x, TOOLBAR_MIN_PADDING), window.innerWidth - TOOLBAR_MIN_PADDING);

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

const RichTextToolbar: React.FC<{ state: ToolbarState; buttons: ToolbarButton[] }> = ({ state, buttons }) => {
    if (!state.visible || typeof document === 'undefined') {
        return null;
    }
    return createPortal(
        <div
            className="fixed z-[90] flex items-center gap-1 bg-emerald-700 text-white rounded-md shadow-lg px-2 py-1"
            style={{ left: state.x, top: state.y, transform: 'translate(-50%, -100%)' }}
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
        </div>,
        document.body
    );
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

const useToolbarState = (editorRef: React.RefObject<HTMLDivElement>) => {
    const [toolbar, setToolbar] = useState<ToolbarState>({ visible: false, x: 0, y: 0 });

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
        const x = clampPositionX(rect.left + rect.width / 2);
        const y = rect.top - TOOLBAR_OFFSET_Y;
        setToolbar({ visible: true, x, y });
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

const useEditorSync = (editorRef: React.RefObject<HTMLDivElement>, value: string) => {
    useEffect(() => {
        const editor = editorRef.current;
        if (!editor) {
            return;
        }
        const sanitized = sanitizeRichTextHtml(value);
        if (editor.innerHTML !== sanitized) {
            editor.innerHTML = sanitized;
        }
    }, [editorRef, value]);
};

const useRichTextHandlers = ({
    editorRef,
    onChange,
    updateSelectionState,
    hideToolbar,
    setIsFocused,
    enableList,
    onUndo,
}: {
    editorRef: React.RefObject<HTMLDivElement>;
    onChange: (value: string) => void;
    updateSelectionState: () => void;
    hideToolbar: () => void;
    setIsFocused: (state: boolean) => void;
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
        onChange(sanitized);
    }, [editorRef, onChange]);

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
        const text = event.clipboardData.getData('text/plain');
        document.execCommand('insertText', false, text);
    }, []);

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

    return { handleInput, handlePaste, handleKeyDown, handleFocus, handleBlur };
};

const RichTextEditor: React.FC<RichTextEditorProps> = ({
    value,
    onChange,
    className,
    placeholder,
    ariaLabel,
    enableList = true,
    onUndo,
    readOnly = false,
}) => {
    const editorRef = useRef<HTMLDivElement | null>(null);
    const [isFocused, setIsFocused] = useState(false);
    const listStylesClass =
        '[&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5 [&_li]:my-1';
    const editorClassName = `${className ?? ''} whitespace-pre-wrap break-words outline-none overflow-y-auto ${listStylesClass} ${RICH_TEXT_INLINE_STYLES_CLASS}`;

    useEditorSync(editorRef, value);
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
            {
                id: 'ordered-list',
                label: '1.',
                title: '有序列表',
                onClick: () => applyList('insertOrderedList'),
                className: 'text-xs',
            },
            baseButtons[3],
        ];
    }, [applyList, applyWrap, enableList, openLinkPopover]);

    const { handleInput, handlePaste, handleKeyDown, handleFocus, handleBlur } = useRichTextHandlers({
        editorRef,
        onChange,
        updateSelectionState,
        hideToolbar,
        setIsFocused,
        enableList,
        onUndo,
    });

    const isEmpty = !stripRichTextToText(value).trim();

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
                onInput={readOnly ? undefined : handleInput}
                onPaste={readOnly ? undefined : handlePaste}
                onKeyDown={readOnly ? undefined : handleKeyDown}
                onMouseUp={readOnly ? undefined : updateSelectionState}
                onTouchEnd={readOnly ? undefined : updateSelectionState}
                onKeyUp={readOnly ? undefined : updateSelectionState}
                onScroll={hideToolbar}
                onFocus={readOnly ? undefined : handleFocus}
                onBlur={readOnly ? undefined : handleBlur}
                suppressContentEditableWarning
            />
            {isEmpty && !isFocused && placeholder ? (
                <div className="pointer-events-none absolute left-3 top-2 text-sm text-gray-400">
                    {placeholder}
                </div>
            ) : null}
            {!readOnly ? <RichTextToolbar state={toolbar} buttons={toolbarButtons} /> : null}
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
