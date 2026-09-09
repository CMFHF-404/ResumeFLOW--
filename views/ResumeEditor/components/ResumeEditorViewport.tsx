import React from 'react';

type ResumeEditorViewportProps = React.PropsWithChildren<{
    scrollContainerRef: React.Ref<HTMLDivElement>;
    onKeyDownCapture?: React.KeyboardEventHandler<HTMLDivElement>;
    busy?: boolean;
    workbench: React.ReactNode;
}>;

const ResumeEditorViewport: React.FC<ResumeEditorViewportProps> = ({
    scrollContainerRef, onKeyDownCapture, busy, workbench, children,
}) => (
    <div onKeyDownCapture={onKeyDownCapture} className="rf-editor-viewport relative flex h-full min-h-0 min-w-0 flex-1 flex-col">
        <div
            ref={scrollContainerRef}
            data-rf-mobile-editor-scroll-root
            className="relative flex min-h-0 w-full flex-1 flex-col overflow-y-auto [scrollbar-gutter:stable] bg-background-light dark:bg-background-dark md:h-full md:overflow-hidden"
            aria-busy={busy}
        >
            {children}
        </div>
        {workbench}
    </div>
);

export default ResumeEditorViewport;
