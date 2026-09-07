import React from 'react';
import ResumeFactorySidebar, { type ResumeFactorySidebarProps } from './ResumeFactorySidebar';
import ResumeEditorLayoutAdjustPanel from './ResumeEditorLayoutAdjustPanel';
import ResumeEditorPreviewStage from './ResumeEditorPreviewStage';
import type { ResumePreviewProps } from './ResumePreview';

type ResumeEditorDesktopWorkspaceProps = {
    factorySidebarProps: ResumeFactorySidebarProps;
    layoutAdjustProps: React.ComponentProps<typeof ResumeEditorLayoutAdjustPanel>;
    previewProps: ResumePreviewProps;
    rightSidebar?: React.ReactNode;
    isRightSidebarOpen?: boolean;
    layoutMode: ResumeEditorWorkspaceLayout;
};

export type ResumeEditorWorkspaceLayout = 'list' | 'triple' | 'ai';

const DEFAULT_RIGHT_SIDEBAR_WIDTH = '390px';
const AI_RIGHT_SIDEBAR_WIDTH = '460px';

const ResumeEditorDesktopWorkspace: React.FC<ResumeEditorDesktopWorkspaceProps> = ({
    factorySidebarProps,
    layoutAdjustProps,
    previewProps,
    rightSidebar,
    isRightSidebarOpen = false,
    layoutMode,
}) => {
    const showRightSidebar = layoutMode !== 'list' && isRightSidebarOpen;
    const hideFactorySidebar = layoutMode === 'ai';
    const rightSidebarWidth = layoutMode === 'ai' ? AI_RIGHT_SIDEBAR_WIDTH : DEFAULT_RIGHT_SIDEBAR_WIDTH;

    return (
      <div className="relative flex flex-1 flex-col overflow-visible md:min-h-0 md:overflow-hidden md:flex-row">
        <div
            aria-hidden={hideFactorySidebar}
            inert={hideFactorySidebar ? true : undefined}
            className={[
                'hidden md:h-full md:min-h-0 md:shrink-0 md:overflow-hidden',
                'transition-[width,opacity] duration-300 ease-in-out',
                hideFactorySidebar
                    ? 'md:w-0 opacity-0 pointer-events-none'
                    : layoutMode === 'triple'
                    ? 'xl:flex xl:w-[460px]'
                    : factorySidebarProps.activeTab === 'templates'
                        ? 'md:flex md:w-[384px] lg:w-[562.5px] xl:w-[607.5px]'
                        : 'md:flex md:w-[562.5px] xl:w-[607.5px]',
            ].join(' ')}
        >
            <ResumeFactorySidebar {...factorySidebarProps} />
        </div>
        <ResumeEditorPreviewStage
            layoutAdjustProps={layoutAdjustProps}
            previewProps={previewProps}
        />
        <div
            data-rf-right-sidebar
            className={[
                'hidden md:flex md:h-full md:min-h-0 md:shrink-0 md:overflow-hidden',
                'border-border-light dark:border-border-dark transition-all duration-300 ease-in-out',
                showRightSidebar
                    ? 'w-[390px] opacity-100 md:border-l shadow-[0_18px_60px_-36px_rgba(15,23,42,0.55)]'
                    : 'w-0 opacity-0 md:border-l-0 pointer-events-none'
            ].join(' ')}
            style={{
                width: showRightSidebar ? rightSidebarWidth : 0,
                opacity: showRightSidebar ? 1 : 0,
                flexShrink: 0,
            }}
        >
            <div className="h-full shrink-0" style={{ width: rightSidebarWidth }}>
                {rightSidebar}
            </div>
        </div>
      </div>
    );
};

export default ResumeEditorDesktopWorkspace;
