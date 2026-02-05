import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { sanitizeRichTextHtml, stripRichTextToText } from '../utils/richText';

type RichTextEditorProps = {
    value: string;
    onChange: (value: string) => void;
    className?: string;
    placeholder?: string;
    ariaLabel?: string;
};

type ToolbarState = {
    visible: boolean;
    x: number;
    y: number;
};

type ToolbarButton = {
    id: string;
    label: string;
    title: string;
    className: string;
    onClick: () => void;
};

const TOOLBAR_OFFSET_Y = 12;
const TOOLBAR_MIN_PADDING = 24;
const DEFAULT_LINK_PROTOCOL = 'https://';

const escapeHtml = (value: string) =>
    value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

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

const RichTextToolbar: React.FC<{ state: ToolbarState; buttons: ToolbarButton[] }> = ({ state, buttons }) => {
    if (!state.visible || typeof document === 'undefined') {
        return null;
    }
    return createPortal(
        <div
            className="fixed z-50 flex items-center gap-1 bg-emerald-700 text-white rounded-md shadow-lg px-2 py-1"
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
        window.addEventListener('scroll', handleScroll, true);
        return () => window.removeEventListener('scroll', handleScroll, true);
    }, [hideToolbar]);

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

    const applyLink = useCallback(() => {
        const editor = editorRef.current;
        if (!editor) {
            return;
        }
        editor.focus();
        const selection = window.getSelection();
        const selectedText = selection?.toString() ?? '';
        const label = selectedText || window.prompt('请输入链接文字', '') || '';
        if (!label.trim()) {
            return;
        }
        const hrefInput = window.prompt('请输入链接地址', DEFAULT_LINK_PROTOCOL) || '';
        const href = normalizeLink(hrefInput);
        if (!href) {
            return;
        }
        if (selectedText) {
            document.execCommand('createLink', false, href);
        } else {
            document.execCommand('insertHTML', false, `<a href="${href}">${escapeHtml(label)}</a>`);
        }
        const updated = sanitizeRichTextHtml(editor.innerHTML);
        applyReplacement(updated);
    }, [applyReplacement, editorRef]);

    return { applyWrap, applyLink };
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
}: {
    editorRef: React.RefObject<HTMLDivElement>;
    onChange: (value: string) => void;
    updateSelectionState: () => void;
    hideToolbar: () => void;
    setIsFocused: (state: boolean) => void;
}) => {
    const handleInput = useCallback(() => {
        const editor = editorRef.current;
        if (!editor) {
            return;
        }
        const sanitized = sanitizeRichTextHtml(editor.innerHTML);
        onChange(sanitized);
        updateSelectionState();
    }, [editorRef, onChange, updateSelectionState]);

    const handlePaste = useCallback((event: React.ClipboardEvent<HTMLDivElement>) => {
        event.preventDefault();
        const text = event.clipboardData.getData('text/plain');
        document.execCommand('insertText', false, text);
    }, []);

    const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            document.execCommand('insertLineBreak');
            updateSelectionState();
        }
    }, [updateSelectionState]);

    const handleFocus = useCallback(() => setIsFocused(true), [setIsFocused]);

    const handleBlur = useCallback(() => {
        setIsFocused(false);
        hideToolbar();
        handleInput();
    }, [handleInput, hideToolbar, setIsFocused]);

    return { handleInput, handlePaste, handleKeyDown, handleFocus, handleBlur };
};

const RichTextEditor: React.FC<RichTextEditorProps> = ({
    value,
    onChange,
    className,
    placeholder,
    ariaLabel,
}) => {
    const editorRef = useRef<HTMLDivElement | null>(null);
    const [isFocused, setIsFocused] = useState(false);
    const editorClassName = `${className ?? ''} whitespace-pre-wrap break-words outline-none`;

    useEditorSync(editorRef, value);
    const { toolbar, hideToolbar, updateSelectionState } = useToolbarState(editorRef);
    const { applyWrap, applyLink } = useTextFormatting({
        editorRef,
        onChange,
        updateSelectionState,
    });

    const toolbarButtons = useMemo(
        () => [
            { id: 'bold', label: 'B', title: '加粗', onClick: () => applyWrap('bold'), className: 'font-bold' },
            { id: 'italic', label: 'I', title: '斜体', onClick: () => applyWrap('italic'), className: 'italic' },
            { id: 'underline', label: 'U', title: '下划线', onClick: () => applyWrap('underline'), className: 'underline' },
            { id: 'link', label: 'Link', title: '超链接', onClick: applyLink, className: 'text-xs' },
        ],
        [applyLink, applyWrap]
    );

    const { handleInput, handlePaste, handleKeyDown, handleFocus, handleBlur } = useRichTextHandlers({
        editorRef,
        onChange,
        updateSelectionState,
        hideToolbar,
        setIsFocused,
    });

    const isEmpty = !stripRichTextToText(value).trim();

    return (
        <div className="relative">
            <div
                ref={editorRef}
                className={editorClassName}
                contentEditable
                role="textbox"
                aria-label={ariaLabel}
                data-placeholder={placeholder}
                onInput={handleInput}
                onPaste={handlePaste}
                onKeyDown={handleKeyDown}
                onMouseUp={updateSelectionState}
                onKeyUp={updateSelectionState}
                onFocus={handleFocus}
                onBlur={handleBlur}
                suppressContentEditableWarning
            />
            {isEmpty && !isFocused && placeholder ? (
                <div className="pointer-events-none absolute left-3 top-2 text-sm text-gray-400">
                    {placeholder}
                </div>
            ) : null}
            <RichTextToolbar state={toolbar} buttons={toolbarButtons} />
        </div>
    );
};

export default RichTextEditor;
