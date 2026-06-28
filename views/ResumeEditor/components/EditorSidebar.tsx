import React from 'react';
import { ChevronDown, Database, User } from 'lucide-react';
import type { ResumeExperienceView } from '../../../types/resume';
import {
    EDITING_SUGGESTION_NAV_CLASS,
    STALE_EXPERIENCE_TIP,
} from '../constants';
import { MatchBadge, StaleBadge } from './Badges';
import JDAnalysisPanel from './JDAnalysisPanel';
import ExperienceTab from './ExperienceTab';
import ProfileTab from './ProfileTab';

type EditingSuggestionProps = {
    editingItem?: ResumeExperienceView;
    staleExperienceIds: Set<string>;
    toolbar?: React.ReactNode;
};

export type EditorSidebarProps = {
    sidebarTab: 'profile' | 'experience';
    onSelectTab: (tab: 'profile' | 'experience') => void;
    onProfileTabSelected: () => void;
    jdPanelProps: React.ComponentProps<typeof JDAnalysisPanel>;
    profileTabProps: React.ComponentProps<typeof ProfileTab>;
    experienceTabProps: React.ComponentProps<typeof ExperienceTab>;
    editingSuggestion: EditingSuggestionProps;
    layoutMode?: 'inline' | 'drawer';
    showJDPanel?: boolean;
};

const resolveExperienceSuggestion = (
    item: ResumeExperienceView | undefined,
    staleExperienceIds: Set<string>
) => {
    if (item && staleExperienceIds.has(item.id)) {
        return STALE_EXPERIENCE_TIP;
    }
    if (item?.matchReason?.trim()) {
        return item.matchReason;
    }
    return '暂无润色建议';
};

export const EditingSuggestionNav: React.FC<EditingSuggestionProps> = ({
    editingItem,
    staleExperienceIds,
    toolbar,
}) => {
    const [isPolishCardCollapsed, setIsPolishCardCollapsed] = React.useState(true);
    if (!editingItem) {
        return null;
    }
    const suggestion = resolveExperienceSuggestion(editingItem, staleExperienceIds);
    const matchBadge = typeof editingItem.matchScore === 'number' ? (
        <MatchBadge
            score={editingItem.matchScore}
            trend={editingItem.matchTrend}
            variant="solid"
        />
    ) : staleExperienceIds.has(editingItem.id) ? (
        <StaleBadge />
    ) : (
        <span className="text-[11px] font-semibold text-gray-400">匹配度 --</span>
    );
    const renderToggleButton = (className = '') => {
        if (!toolbar) {
            return null;
        }
        return (
            <button
                type="button"
                onClick={() => setIsPolishCardCollapsed((current) => !current)}
                className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200${className ? ` ${className}` : ''}`}
                aria-label={isPolishCardCollapsed ? '展开 AI 润色工具栏' : '折叠 AI 润色工具栏'}
                title={isPolishCardCollapsed ? '展开 AI 润色工具栏' : '折叠 AI 润色工具栏'}
            >
                <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${isPolishCardCollapsed ? '-rotate-90' : 'rotate-0'}`} />
            </button>
        );
    };

    return (
        <div className={EDITING_SUGGESTION_NAV_CLASS}>
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/60">
                <div
                    className={`${isPolishCardCollapsed ? 'flex items-start gap-3' : 'flex items-start justify-between gap-3 md:items-center'} ${
                        isPolishCardCollapsed ? 'flex-col md:flex-row md:items-start' : ''
                    }`}
                >
                    {isPolishCardCollapsed ? (
                        <>
                            <div className="flex items-center justify-between gap-2 md:block md:shrink-0">
                                <div className="shrink-0">
                                    {matchBadge}
                                </div>
                                {renderToggleButton('md:hidden')}
                            </div>
                            <div className="w-full min-w-0 rounded-md bg-white/80 px-3 py-2.5 text-[11px] leading-relaxed text-gray-500 dark:bg-black/10 dark:text-gray-300 md:flex-1">
                                {suggestion}
                            </div>
                            {renderToggleButton('hidden md:inline-flex')}
                        </>
                    ) : (
                        <>
                            <div className="shrink-0">
                                {matchBadge}
                            </div>
                            <div className="min-w-0 flex-1 text-[11px] font-semibold text-primary">
                                AI 润色工具栏
                            </div>
                            {renderToggleButton()}
                        </>
                    )}
                </div>
                <div
                    aria-hidden={isPolishCardCollapsed}
                    className={`grid overflow-hidden transition-[grid-template-rows,opacity] duration-200 ease-out ${
                        isPolishCardCollapsed ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100'
                    }`}
                >
                    <div className="min-h-0 overflow-hidden">
                        <div className="mt-3 w-full rounded-md bg-white/80 px-3 py-2.5 text-[11px] leading-relaxed text-gray-500 dark:bg-black/10 dark:text-gray-300 md:bg-transparent md:px-0 md:py-0">
                            {suggestion}
                        </div>
                        {!isPolishCardCollapsed && toolbar ? <div className="mt-3">{toolbar}</div> : null}
                    </div>
                </div>
                <span className="sr-only">折叠后仅显示匹配度与润色建议</span>
            </div>
        </div>
    );
};

const EditorSidebar: React.FC<EditorSidebarProps> = ({
    sidebarTab,
    onSelectTab,
    onProfileTabSelected,
    jdPanelProps,
    profileTabProps,
    experienceTabProps,
    editingSuggestion,
    layoutMode = 'inline',
    showJDPanel = true,
}) => {
    const scrollContainerRef = React.useRef<HTMLDivElement | null>(null);
    const asideClassName = layoutMode === 'drawer'
        ? 'flex h-full min-h-0 w-full flex-col overflow-hidden bg-surface-light dark:bg-surface-dark'
        : 'flex h-full min-h-0 w-full shrink-0 flex-col overflow-hidden border-b border-border-light bg-surface-light z-10 dark:border-border-dark dark:bg-surface-dark md:border-b-0 md:border-r';

    return (
        <aside
            className={asideClassName}
        >
            {showJDPanel ? <JDAnalysisPanel {...jdPanelProps} /> : null}
            <div className="border-b border-border-light dark:border-border-dark bg-white dark:bg-surface-dark">
                <div className="flex">
                    <button
                        className={`flex flex-1 items-center justify-center gap-2 border-b-2 py-3 text-xs font-medium transition-colors sm:text-sm ${sidebarTab === 'experience' ? 'border-primary text-primary bg-primary/5' : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}
                        onClick={() => onSelectTab('experience')}
                    >
                        <Database className="w-4 h-4" /> 经历库
                    </button>
                    <button
                        className={`flex flex-1 items-center justify-center gap-2 border-b-2 py-3 text-xs font-medium transition-colors sm:text-sm ${sidebarTab === 'profile' ? 'border-primary text-primary bg-primary/5' : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}
                        onClick={() => {
                            onSelectTab('profile');
                            onProfileTabSelected();
                        }}
                    >
                        <User className="w-4 h-4" /> 个人档案
                    </button>
                </div>
                <EditingSuggestionNav {...editingSuggestion} />
            </div>
            <div
                ref={scrollContainerRef}
                className="flex-1 space-y-4 overflow-y-auto bg-gray-50/30 p-4 dark:bg-black/20 md:p-5"
            >
                {sidebarTab === 'profile' ? (
                    <ProfileTab {...profileTabProps} />
                ) : (
                    <ExperienceTab
                        {...experienceTabProps}
                        layoutMode={layoutMode}
                        scrollContainerRef={scrollContainerRef}
                    />
                )}
            </div>
        </aside>
    );
};

export default EditorSidebar;
