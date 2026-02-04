import React, { useCallback, useMemo, useState } from 'react';
import { Sparkles, X } from 'lucide-react';
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
    onRemove: (tag: string) => void;
}> = ({ tags, onRemove }) => (
    <>
        {tags.map((tag) => (
            <span
                key={tag}
                className="group inline-flex items-center gap-1 rounded-md bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 px-2.5 py-1 text-xs font-medium text-gray-700 dark:text-gray-300 shadow-sm"
            >
                {tag}
                <button
                    type="button"
                    onClick={() => onRemove(tag)}
                    className="hidden group-hover:inline-flex text-gray-400 hover:text-red-500 transition-colors ml-0.5"
                >
                    <X className="w-3 h-3" />
                </button>
            </span>
        ))}
    </>
);

const TagInputField: React.FC<{
    tags: string[];
    draft: string;
    placeholder: string;
    onDraftChange: (value: string) => void;
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
    onRemove: (tag: string) => void;
    onAiFill?: () => void;
    isAiLoading?: boolean;
}> = ({ tags, draft, placeholder, onDraftChange, onKeyDown, onRemove, onAiFill, isAiLoading }) => (
    <div className="flex flex-wrap items-center gap-2 p-2 rounded-lg border border-transparent hover:border-gray-200 dark:hover:border-gray-700 transition-colors bg-gray-50/50 dark:bg-gray-800/20">
        <TagChipList tags={tags} onRemove={onRemove} />
        <input
            className="flex-1 min-w-[120px] bg-transparent text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 border-none focus:ring-0 focus:outline-none py-1 px-1"
            placeholder={tags.length > 0 ? '' : placeholder}
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={onKeyDown}
        />
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
        (tag: string) => {
            onChange(value.filter((item) => normalizeTagKey(item) !== normalizeTagKey(tag)));
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

    return (
        <div className="space-y-2">
            <TagInputField
                tags={value}
                draft={draft}
                placeholder={placeholder}
                onDraftChange={setDraft}
                onKeyDown={handleKeyDown}
                onRemove={handleRemove}
                onAiFill={onAiFill}
                isAiLoading={isAiLoading}
            />

            <TagSuggestionList suggestions={suggestionList} onSelect={handleSuggestionClick} themeColor={themeColor} />
        </div>
    );
};

export default TagInput;
