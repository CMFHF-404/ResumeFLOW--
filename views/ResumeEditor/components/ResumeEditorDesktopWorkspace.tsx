import React from 'react';
import { SIDEBAR_WIDTH_CLASS } from '../constants';
import EditorSidebar, { type EditorSidebarProps } from './EditorSidebar';
import ResumeEditorLayoutAdjustPanel from './ResumeEditorLayoutAdjustPanel';
import ResumeEditorPreviewStage from './ResumeEditorPreviewStage';
import type { ResumePreviewProps } from './ResumePreview';

type ResumeEditorDesktopWorkspaceProps = {
    sidebarProps: Omit<EditorSidebarProps, 'layoutMode' | 'showJDPanel'>;
    layoutAdjustProps: React.ComponentProps<typeof ResumeEditorLayoutAdjustPanel>;
    previewProps: ResumePreviewProps;
};

const ResumeEditorDesktopWorkspace: React.FC<ResumeEditorDesktopWorkspaceProps> = ({
    sidebarProps,
    layoutAdjustProps,
    previewProps,
}) => (
    <div className="flex flex-1 flex-col overflow-visible md:min-h-0 md:overflow-hidden md:flex-row">
        <div className={`hidden md:flex md:h-full md:min-h-0 md:shrink-0 md:overflow-hidden ${SIDEBAR_WIDTH_CLASS}`}>
            <EditorSidebar {...sidebarProps} />
        </div>
        <ResumeEditorPreviewStage
            layoutAdjustProps={layoutAdjustProps}
            previewProps={previewProps}
        />
    </div>
);

export default ResumeEditorDesktopWorkspace;
