import React, { useCallback, useMemo, useState } from 'react';
import { Check, Edit3, Sparkles, X } from 'lucide-react';
import { buildTagSuggestions, buildTagsFromInput, mergeTags, normalizeTagKey } from './tagUtils';

const TAG_INPUT_PLACEHOLDER = '输入技能标签，回车添加';
const TAG_AI_BUTTON_LABEL = '填充';

const getThemeClasses = (color: string = 'primary') => {
    if (color === 'primary') {
        return {
            tag: 'hover:text-primary hover:border-primary hover:bg-primary/5',
        };
    }
    return {
        tag: `hover:text-${color}-600 hover:border-${color}-600 hover:bg-${color}-50`,
    };
};

export type TagInputProps = {
    value: string[];
    suggestions: readonly string[];
    onChange: (next: string[]) => void;
    onAiFill?: () => void;
    isAiLoading?: boolean;
    themeColor?: string;
    placeholder?: string;
};

const getTagVisualUnits = (value: string) => Array.from(value.trim()).reduce((sum, char) => (
    /[\u0000-\u00ff]/.test(char) ? sum + 1 : sum + 2
), 0);

const getAdaptiveTagWidth = (value: string, fallback = '') => {
    const units = Math.max(getTagVisualUnits(value), getTagVisualUnits(fallback), 10);
    return `${Math.min(Math.max(units + 4, 12), 48)}ch`;
};

const replaceTagAtIndex = (tags: string[], targetIndex: number, nextTag: string) => {
    const cleanedNextTag = nextTag.trim();
    const originalTag = tags[targetIndex] ?? '';
    const originalKey = normalizeTagKey(originalTag);
    const nextKey = normalizeTagKey(cleanedNextTag);
    if (nextKey === originalKey) {
        return tags.map((tag, index) => (
            index === targetIndex ? (cleanedNextTag || tag.trim()) : tag
        ));
    }
    const hasDuplicateOutsideTarget = tags.some((tag, index) => (
        index !== targetIndex && normalizeTagKey(tag) === nextKey
    ));
    return tags.flatMap((tag, index) => {
        if (index !== targetIndex) {
            return [tag];
        }
        if (!cleanedNextTag || hasDuplicateOutsideTarget) {
            return [];
        }
        return [cleanedNextTag];
    });
};

const removeTagAtIndex = (tags: string[], targetIndex: number) => (
    tags.filter((_, index) => index !== targetIndex)
);

const TagSuggestionList: React.FC<{
    suggestions: string[];
    onSelect: (tag: string) => void;
    themeColor?: string;
}> = ({ suggestions, onSelect, themeColor }) => {
    if (!suggestions.length) {
        return null;
    }
    return (
        <div className="flex flex-wrap gap-2">
            {suggestions.map((tag) => (
                <button
                    key={tag}
                    type="button"
                    onClick={() => onSelect(tag)}
                    className={`text-xs px-3 py-1 rounded-full border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-300 transition-colors ${getThemeClasses(themeColor).tag}`}
                >
                    + {tag}
                </button>
            ))}
        </div>
    );
};

const TagChipList: React.FC<{
    tags: string[];
    editingIndex: number | null;
    editingDraft: string;
    onStartEdit: (index: number, tag: string) => void;
    onEditDraftChange: (value: string) => void;
    onCommitEdit: (index: number) => void;
    onCancelEdit: () => void;
    onRemove: (index: number) => void;
}> = ({
    tags,
    editingIndex,
    editingDraft,
    onStartEdit,
    onEditDraftChange,
    onCommitEdit,
    onCancelEdit,
    onRemove,
}) => (
    <>
        {tags.map((tag, index) => {
            const isEditing = editingIndex === index;
            return isEditing ? (
                <span
                    key={`${tag}-${index}`}
                    className="inline-flex max-w-full items-center gap-1 rounded-md border border-rose-300 bg-rose-50 px-2 py-1 text-xs font-medium text-rose-700 shadow-sm"
                >
                    <input
                        autoFocus
                        value={editingDraft}
                        className="min-w-[12ch] max-w-[48ch] bg-transparent border-none p-0 text-xs font-medium text-rose-700 outline-none focus:ring-0"
                        style={{ width: getAdaptiveTagWidth(editingDraft, tag) }}
                        onChange={(event) => onEditDraftChange(event.target.value)}
                        onBlur={() => onCommitEdit(index)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                                event.preventDefault();
                                onCommitEdit(index);
                            } else if (event.key === 'Escape') {
                                event.preventDefault();
                                onCancelEdit();
                            }
                        }}
                    />
                    <button
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => onCommitEdit(index)}
                        className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-emerald-600 transition-colors hover:bg-emerald-100"
                        aria-label={`确认重命名标签 ${tag}`}
                        title="确认重命名"
                    >
                        <Check className="w-3 h-3" />
                    </button>
                    <button
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={onCancelEdit}
                        className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                        aria-label={`取消重命名标签 ${tag}`}
                        title="取消重命名"
                    >
                        <X className="w-3 h-3" />
                    </button>
                </span>
            ) : (
                <span
                    key={`${tag}-${index}`}
                    className="group inline-flex max-w-full items-center gap-1 rounded-md bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 px-2.5 py-1 text-xs font-medium text-gray-700 dark:text-gray-300 shadow-sm"
                >
                    <span className="truncate">{tag}</span>
                    <button
                        type="button"
                        onClick={() => onStartEdit(index, tag)}
                        className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-slate-100 hover:text-slate-600 ml-0.5"
                        aria-label={`重命名标签 ${tag}`}
                        title={`重命名标签 ${tag}`}
                    >
                        <Edit3 className="w-3 h-3" />
                    </button>
                    <button
                        type="button"
                        onClick={() => onRemove(index)}
                        className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 ml-0.5"
                        aria-label={`删除标签 ${tag}`}
                        title={`删除标签 ${tag}`}
                    >
                        <X className="w-3 h-3" />
                    </button>
                </span>
            );
        })}
    </>
);

const TagInputField: React.FC<{
    tags: string[];
    editingIndex: number | null;
    editingDraft: string;
    draft: string;
    hasDraft: boolean;
    placeholder: string;
    onDraftChange: (value: string) => void;
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
    onStartEdit: (index: number, tag: string) => void;
    onEditDraftChange: (value: string) => void;
    onCommitEdit: (index: number) => void;
    onCancelEdit: () => void;
    onRemove: (index: number) => void;
    onSubmitDraft: () => void;
    onClearDraft: () => void;
    onAiFill?: () => void;
    isAiLoading?: boolean;
}> = ({
    tags,
    editingIndex,
    editingDraft,
    draft,
    hasDraft,
    placeholder,
    onDraftChange,
    onKeyDown,
    onStartEdit,
    onEditDraftChange,
    onCommitEdit,
    onCancelEdit,
    onRemove,
    onSubmitDraft,
    onClearDraft,
    onAiFill,
    isAiLoading,
}) => (
    <div className="flex flex-wrap items-center gap-2 p-2 rounded-lg border border-transparent hover:border-gray-200 dark:hover:border-gray-700 transition-colors bg-gray-50/50 dark:bg-gray-800/20">
        <TagChipList
            tags={tags}
            editingIndex={editingIndex}
            editingDraft={editingDraft}
            onStartEdit={onStartEdit}
            onEditDraftChange={onEditDraftChange}
            onCommitEdit={onCommitEdit}
            onCancelEdit={onCancelEdit}
            onRemove={onRemove}
        />
        <div className="flex min-w-0 flex-[1_1_12rem] items-center gap-2">
            <input
                className="min-w-0 flex-1 bg-transparent text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 border-none focus:ring-0 focus:outline-none py-1 px-1"
                placeholder={tags.length > 0 ? '' : placeholder}
                value={draft}
                onChange={(event) => onDraftChange(event.target.value)}
                onKeyDown={onKeyDown}
            />
            {hasDraft && (
                <div className="inline-flex items-center gap-1 md:hidden">
                    <button
                        type="button"
                        onClick={onClearDraft}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-500 transition-colors hover:border-gray-300 hover:text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-gray-600 dark:hover:text-white"
                        aria-label="取消添加技能"
                        title="取消"
                    >
                        <X className="h-4 w-4" />
                    </button>
                    <button
                        type="button"
                        onClick={onSubmitDraft}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-rose-500 text-white transition-colors hover:bg-rose-600"
                        aria-label="确认添加技能"
                        title="确认"
                    >
                        <Check className="h-4 w-4" />
                    </button>
                </div>
            )}
        </div>
        {onAiFill && (
            <button
                type="button"
                onClick={onAiFill}
                disabled={isAiLoading}
                className="shrink-0 flex items-center gap-1.5 text-xs font-medium text-amber-600 bg-amber-50 hover:bg-amber-100 dark:text-amber-400 dark:bg-amber-900/20 dark:hover:bg-amber-900/30 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 ml-auto"
            >
                <Sparkles className="w-3.5 h-3.5" />
                {isAiLoading ? '...' : TAG_AI_BUTTON_LABEL}
            </button>
        )}
    </div>
);

const TagInput: React.FC<TagInputProps> = ({
    value,
    suggestions,
    onChange,
    onAiFill,
    isAiLoading,
    themeColor,
    placeholder = TAG_INPUT_PLACEHOLDER
}) => {
    const [draft, setDraft] = useState('');
    const [editingIndex, setEditingIndex] = useState<number | null>(null);
    const [editingDraft, setEditingDraft] = useState('');
    const hasDraft = draft.trim().length > 0;
    const suggestionList = useMemo(
        () => buildTagSuggestions(value, suggestions, draft),
        [value, suggestions, draft]
    );

    const handleAddFromInput = useCallback(() => {
        const next = buildTagsFromInput(draft);
        if (!next.length) {
            return;
        }
        onChange(mergeTags(value, next));
        setDraft('');
    }, [draft, onChange, value]);

    const handleKeyDown = useCallback(
        (event: React.KeyboardEvent<HTMLInputElement>) => {
            if (event.key === 'Enter' || event.key === ',' || event.key === '，') {
                event.preventDefault();
                handleAddFromInput();
            }
        },
        [handleAddFromInput]
    );

    const handleRemove = useCallback(
        (index: number) => {
            setEditingIndex((currentEditingIndex) => {
                if (currentEditingIndex === null) {
                    return currentEditingIndex;
                }
                if (currentEditingIndex === index) {
                    setEditingDraft('');
                    return null;
                }
                return currentEditingIndex > index ? currentEditingIndex - 1 : currentEditingIndex;
            });
            onChange(removeTagAtIndex(value, index));
        },
        [onChange, value]
    );

    const handleSuggestionClick = useCallback(
        (tag: string) => {
            onChange(mergeTags(value, [tag]));
            setDraft('');
        },
        [onChange, value]
    );

    const handleClearDraft = useCallback(() => {
        setDraft('');
    }, []);

    const handleStartEdit = useCallback((index: number, tag: string) => {
        setEditingIndex(index);
        setEditingDraft(tag);
    }, []);

    const handleCancelEdit = useCallback(() => {
        setEditingIndex(null);
        setEditingDraft('');
    }, []);

    const handleCommitEdit = useCallback((index: number) => {
        onChange(replaceTagAtIndex(value, index, editingDraft));
        setEditingIndex(null);
        setEditingDraft('');
    }, [editingDraft, onChange, value]);

    return (
        <div className="space-y-2">
            <TagInputField
                tags={value}
                editingIndex={editingIndex}
                editingDraft={editingDraft}
                draft={draft}
                hasDraft={hasDraft}
                placeholder={placeholder}
                onDraftChange={setDraft}
                onKeyDown={handleKeyDown}
                onStartEdit={handleStartEdit}
                onEditDraftChange={setEditingDraft}
                onCommitEdit={handleCommitEdit}
                onCancelEdit={handleCancelEdit}
                onRemove={handleRemove}
                onSubmitDraft={handleAddFromInput}
                onClearDraft={handleClearDraft}
                onAiFill={onAiFill}
                isAiLoading={isAiLoading}
            />

            <TagSuggestionList suggestions={suggestionList} onSelect={handleSuggestionClick} themeColor={themeColor} />
        </div>
    );
};

export default TagInput;
