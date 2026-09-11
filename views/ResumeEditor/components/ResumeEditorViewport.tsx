import React from 'react';

type ResumeEditorViewportProps = React.PropsWithChildren<{
    scrollContainerRef: React.Ref<HTMLDivElement>;
    onKeyDownCapture?: React.KeyboardEventHandler<HTMLDivElement>;
    busy?: boolean;
    workbench: React.ReactNode;
    templateToolbar?: React.ReactNode;
    templateStrip?: React.ReactNode;
}>;

const ResumeEditorViewport: React.FC<ResumeEditorViewportProps> = ({
    scrollContainerRef, onKeyDownCapture, busy, workbench, templateToolbar, templateStrip, children,
}) => (
    <div role="main" aria-label="简历工厂" data-template-selection={templateStrip ? 'true' : undefined} onKeyDownCapture={onKeyDownCapture} className="rf-editor-viewport relative flex h-full min-h-0 min-w-0 flex-1 flex-col">
        {templateToolbar}
        <div
            ref={scrollContainerRef}
            data-rf-mobile-editor-scroll-root
            className="relative flex min-h-0 w-full flex-1 flex-col overflow-y-auto [scrollbar-gutter:stable] bg-background-light dark:bg-background-dark md:h-full md:overflow-hidden"
            aria-busy={busy}
        >
            {children}
        </div>
        {templateStrip || workbench}
    </div>
);

export default ResumeEditorViewport;
