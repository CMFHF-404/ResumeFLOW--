import React from 'react';
import { Database, User, Wand2 } from 'lucide-react';
import type { ResumeExperienceView } from '../../../types/resume';
import {
    EDITING_SUGGESTION_NAV_CLASS,
    SIDEBAR_WIDTH_CLASS,
    STALE_EXPERIENCE_TIP,
} from '../constants';
import { MatchBadge, StaleBadge } from './Badges';
import JDAnalysisPanel from './JDAnalysisPanel';
import ExperienceTab from './ExperienceTab';
import ProfileTab from './ProfileTab';

type EditingSuggestionProps = {
    editingItem?: ResumeExperienceView;
    staleExperienceIds: Set<string>;
    jdText: string;
    isPolishing: boolean;
    onPolish: () => void;
};

export type EditorSidebarProps = {
    sidebarTab: 'profile' | 'experience';
    onSelectTab: (tab: 'profile' | 'experience') => void;
    onProfileTabSelected: () => void;
    jdPanelProps: React.ComponentProps<typeof JDAnalysisPanel>;
    profileTabProps: React.ComponentProps<typeof ProfileTab>;
    experienceTabProps: React.ComponentProps<typeof ExperienceTab>;
    editingSuggestion: EditingSuggestionProps;
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

const EditingSuggestionNav: React.FC<EditingSuggestionProps> = ({
    editingItem,
    staleExperienceIds,
    jdText,
    isPolishing,
    onPolish,
}) => {
    if (!editingItem) {
        return null;
    }
    const suggestion = resolveExperienceSuggestion(editingItem, staleExperienceIds);
    return (
        <div className={EDITING_SUGGESTION_NAV_CLASS}>
            <div className="bg-gray-50 dark:bg-gray-900/60 p-3 rounded-lg border border-gray-200 dark:border-gray-700 flex items-center gap-3">
                <div className="shrink-0">
                    {typeof editingItem.matchScore === 'number' ? (
                        <MatchBadge
                            score={editingItem.matchScore}
                            trend={editingItem.matchTrend}
                            variant="solid"
                        />
                    ) : staleExperienceIds.has(editingItem.id) ? (
                        <StaleBadge />
                    ) : (
                        <span className="text-[10px] text-gray-400">匹配度 --</span>
                    )}
                </div>
                <div className="flex-1 text-[10px] text-gray-500 leading-relaxed">{suggestion}</div>
                <button
                    onClick={onPolish}
                    disabled={isPolishing || !jdText.trim()}
                    className="shrink-0 flex items-center justify-center gap-1.5 text-[10px] font-semibold text-primary bg-primary/10 hover:bg-primary/20 px-2.5 py-1.5 rounded-md transition-colors disabled:opacity-60"
                >
                    <Wand2 className="w-3.5 h-3.5" />
                    {isPolishing ? '润色中...' : '基于 JD 润色'}
                </button>
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
}) => {
    const scrollContainerRef = React.useRef<HTMLDivElement | null>(null);

    return (
        <aside
            className={`${SIDEBAR_WIDTH_CLASS} flex w-full min-h-0 max-h-[46vh] shrink-0 flex-col overflow-hidden border-b border-border-light bg-surface-light z-10 dark:border-border-dark dark:bg-surface-dark md:max-h-none md:border-b-0 md:border-r`}
        >
            <JDAnalysisPanel {...jdPanelProps} />
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
                        scrollContainerRef={scrollContainerRef}
                    />
                )}
            </div>
        </aside>
    );
};

export default EditorSidebar;
