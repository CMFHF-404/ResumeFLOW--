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

const ResumeEditorDesktopWorkspace: React.FC<ResumeEditorDesktopWorkspaceProps> = ({
    factorySidebarProps,
    layoutAdjustProps,
    previewProps,
    assistantSidebar,
    isAssistantSidebarOpen = false,
}) => (
    <div className="flex flex-1 flex-col overflow-visible md:min-h-0 md:overflow-hidden md:flex-row">
        <div className="hidden md:flex md:h-full md:min-h-0 md:w-[430px] md:shrink-0 md:overflow-hidden xl:w-[460px]">
            <ResumeFactorySidebar {...factorySidebarProps} />
        </div>
        <ResumeEditorPreviewStage
            layoutAdjustProps={layoutAdjustProps}
            previewProps={previewProps}
        />
        <div
            className={[
                'hidden md:flex md:h-full md:min-h-0 md:shrink-0 md:overflow-hidden',
                'border-border-light dark:border-border-dark transition-all duration-300 ease-in-out',
                isAssistantSidebarOpen
                    ? 'w-[390px] opacity-100 md:border-l 2xl:w-[420px]'
                    : 'w-0 opacity-0 md:border-l-0 pointer-events-none'
            ].join(' ')}
        >
            <div className="h-full w-[390px] shrink-0 2xl:w-[420px]">
                {assistantSidebar}
            </div>
        </div>
    </div>
);

export default ResumeEditorDesktopWorkspace;
