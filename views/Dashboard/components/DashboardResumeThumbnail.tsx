import React, { useEffect, useMemo, useRef } from 'react';
import { Eye, FileText } from 'lucide-react';
import type { Resume } from '../../../types';
import { resolveResumeDisplayTitle } from '../../../constants/resumeConstants';
import ResumePreview from '../../ResumeEditor/components/ResumePreview';
import { buildDashboardResumePreviewProps } from '../resumePreviewState';
import type { DashboardResumePreviewEntry } from '../dashboardResumePreviewCache';

type DashboardResumeThumbnailProps = {
    resume: Resume;
    variant: 'grid';
    entry: DashboardResumePreviewEntry;
    isBatchEditMode: boolean;
    onEnsurePreview: (resume: Resume) => void;
    onPreview: (event: React.MouseEvent) => void;
    className?: string;
};

const MiniResumeFallback: React.FC<{
    status: DashboardResumePreviewEntry['status'];
}> = ({ status }) => {
    const lineClass = 'h-1 rounded-sm bg-gray-200 dark:bg-gray-700';
    const titleClass = 'h-2.5 w-1/3 rounded-sm bg-gray-300 dark:bg-gray-600';

    return (
        <div className="flex h-full w-full flex-col gap-2 bg-white p-3 shadow-sm dark:bg-gray-800">
            <div className={titleClass} />
            <div className={`${lineClass} w-full`} />
            <div className={`${lineClass} w-5/6`} />
            <div className={`${lineClass} w-full`} />
            <div className="mt-3 h-2 w-1/4 rounded-sm bg-gray-300 dark:bg-gray-600" />
            <div className="space-y-1">
                <div className={`${lineClass} w-full`} />
                <div className={`${lineClass} w-11/12`} />
                <div className={`${lineClass} w-4/5`} />
            </div>
            {status === 'error' ? (
                <div className="mt-auto flex items-center gap-1 text-[10px] font-semibold text-gray-400">
                    <FileText className="h-3 w-3" />
                    预览暂不可用
                </div>
            ) : null}
        </div>
    );
};

const DashboardResumeThumbnail: React.FC<DashboardResumeThumbnailProps> = ({
    resume,
    entry,
    isBatchEditMode,
    onEnsurePreview,
    onPreview,
    className = '',
}) => {
    const rootRef = useRef<HTMLDivElement | null>(null);
    const previewRef = useRef<HTMLDivElement | null>(null);
    const previewContentRef = useRef<HTMLDivElement | null>(null);
    const previewScope = 'dashboard-card';
    const isReady = entry.status === 'ready' && Boolean(entry.snapshot);
    const dataAttr = { 'data-dashboard-resume-thumbnail-grid': resume.id };

    useEffect(() => {
        const node = rootRef.current;
        if (!node) {
            return undefined;
        }
        if (entry.status === 'ready' || entry.status === 'loading') {
            return undefined;
        }
        if (typeof IntersectionObserver === 'undefined') {
            onEnsurePreview(resume);
            return undefined;
        }
        const observer = new IntersectionObserver((items) => {
            if (items.some((item) => item.isIntersecting)) {
                onEnsurePreview(resume);
                observer.disconnect();
            }
        }, {
            root: null,
            rootMargin: '180px',
            threshold: 0.01,
        });
        observer.observe(node);
        return () => observer.disconnect();
    }, [entry.status, onEnsurePreview, resume]);

    const previewProps = useMemo(() => {
        if (!entry.snapshot) {
            return null;
        }
        return buildDashboardResumePreviewProps(
            entry.snapshot.state,
            previewRef,
            previewContentRef,
            {
                previewScope,
                resumeDisplayTitle: resolveResumeDisplayTitle(resume.name),
            }
        );
    }, [entry.snapshot, previewScope, resume.name]);

    const rootClassName = `relative h-full w-full overflow-hidden bg-gray-100 dark:bg-gray-900 ${className}`.trim();

    return (
        <div
            ref={rootRef}
            data-dashboard-resume-thumbnail="true"
            className={rootClassName}
            {...dataAttr}
        >
            <div className="h-full w-full overflow-hidden">
                {isReady && previewProps ? (
                    <div className="dashboard-preview-fade-in pointer-events-none h-full w-full overflow-hidden bg-white transition-transform duration-500 group-hover:scale-[1.015]">
                        <ResumePreview {...previewProps} />
                    </div>
                ) : (
                    <MiniResumeFallback status={entry.status} />
                )}
            </div>
            {!isBatchEditMode ? (
                <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-gray-900/5 opacity-0 transition-opacity duration-100 ease-out will-change-opacity group-hover:opacity-100 dark:bg-gray-900/25">
                    <button
                        className="pointer-events-auto flex items-center gap-2 rounded-full bg-white/90 px-4 py-2 text-sm font-semibold text-gray-900 shadow-xl shadow-slate-900/15 ring-1 ring-white/70 backdrop-blur-md transition-[box-shadow,transform] duration-150 hover:-translate-y-0.5 hover:shadow-2xl dark:bg-gray-900/80 dark:text-white dark:ring-gray-700/70"
                        onClick={onPreview}
                        type="button"
                    >
                        <Eye className="h-4 w-4" />
                        预览
                    </button>
                </div>
            ) : null}
        </div>
    );
};

export default DashboardResumeThumbnail;
