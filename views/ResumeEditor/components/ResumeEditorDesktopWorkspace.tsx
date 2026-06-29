import React from 'react';
import ResumeFactorySidebar, { type ResumeFactorySidebarProps } from './ResumeFactorySidebar';
import ResumeEditorLayoutAdjustPanel from './ResumeEditorLayoutAdjustPanel';
import ResumeEditorPreviewStage from './ResumeEditorPreviewStage';
import type { ResumePreviewProps } from './ResumePreview';
import type { TokenQuotaSummary } from '../../../services/billingService';

type ResumeEditorDesktopWorkspaceProps = {
    factorySidebarProps: ResumeFactorySidebarProps;
    layoutAdjustProps: React.ComponentProps<typeof ResumeEditorLayoutAdjustPanel>;
    previewProps: ResumePreviewProps;
    assistantSidebar?: React.ReactNode;
    isAssistantSidebarOpen?: boolean;
    quotaSummary?: TokenQuotaSummary | null;
    onOpenTokenQuota?: () => void;
};

const ASSISTANT_SIDEBAR_WIDTH = '390px';

const ResumeEditorDesktopWorkspace: React.FC<ResumeEditorDesktopWorkspaceProps> = ({
    factorySidebarProps,
    layoutAdjustProps,
    previewProps,
    assistantSidebar,
    isAssistantSidebarOpen = false,
}) => (
    <div className="relative flex flex-1 flex-col overflow-visible md:min-h-0 md:overflow-hidden md:flex-row">
        <div
            className={[
                'hidden md:flex md:h-full md:min-h-0 md:shrink-0 md:overflow-hidden',
                'transition-[width] duration-300 ease-in-out',
                isAssistantSidebarOpen
                    ? 'md:w-[430px] xl:w-[460px]'
                    : 'md:w-[562.5px] xl:w-[607.5px]',
            ].join(' ')}
        >
            <ResumeFactorySidebar {...factorySidebarProps} />
        </div>
        <ResumeEditorPreviewStage
            layoutAdjustProps={layoutAdjustProps}
            previewProps={previewProps}
        />
        <div
            data-rf-assistant-sidebar
            className={[
                'hidden md:flex md:h-full md:min-h-0 md:shrink-0 md:overflow-hidden',
                'border-border-light dark:border-border-dark transition-all duration-300 ease-in-out',
                isAssistantSidebarOpen
                    ? 'w-[390px] opacity-100 md:border-l shadow-[0_18px_60px_-36px_rgba(15,23,42,0.55)]'
                    : 'w-0 opacity-0 md:border-l-0 pointer-events-none'
            ].join(' ')}
            style={{
                width: isAssistantSidebarOpen ? ASSISTANT_SIDEBAR_WIDTH : 0,
                opacity: isAssistantSidebarOpen ? 1 : 0,
                flexShrink: 0,
            }}
        >
            <div className="h-full shrink-0" style={{ width: ASSISTANT_SIDEBAR_WIDTH }}>
                {assistantSidebar}
            </div>
        </div>
    </div>
);

export default ResumeEditorDesktopWorkspace;
