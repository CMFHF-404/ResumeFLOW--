import React from 'react';
import ResumePreview, { type ResumePreviewProps } from './ResumePreview';
import ResumeEditorLayoutAdjustPanel from './ResumeEditorLayoutAdjustPanel';

type ResumeEditorPreviewStageProps = {
    layoutAdjustProps: React.ComponentProps<typeof ResumeEditorLayoutAdjustPanel>;
    previewProps: ResumePreviewProps;
};

const ResumeEditorPreviewStage: React.FC<ResumeEditorPreviewStageProps> = ({
    layoutAdjustProps,
    previewProps,
}) => (
    <div className="flex flex-1 flex-col min-w-0 overflow-visible pb-20 md:min-h-0 md:overflow-hidden md:pb-0">
        <ResumeEditorLayoutAdjustPanel {...layoutAdjustProps} />
        <ResumePreview {...previewProps} />
    </div>
);

export default ResumeEditorPreviewStage;
