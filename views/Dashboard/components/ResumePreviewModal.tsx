import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { resolveResumeDisplayTitle } from '../../../constants/resumeConstants';
import ResumePreview, { type ResumePreviewProps } from '../../ResumeEditor/components/ResumePreview';
import {
    DASHBOARD_RESUME_PREVIEW_ERROR_TEXT,
    DASHBOARD_RESUME_PREVIEW_LOADING_TEXT,
    buildDashboardResumePreviewProps,
    loadDashboardResumePreviewSnapshot,
    type DashboardResumePreviewSnapshot,
} from '../resumePreviewState';

export type ResumePreviewModalProps = {
    isOpen: boolean;
    resumeId: string | null;
    resumeName?: string;
    onClose: () => void;
};

const DEFAULT_TITLE = '简历预览';

const buildPreviewTitle = (resumeName?: string) => {
    return resumeName ? `${DEFAULT_TITLE} - ${resumeName}` : DEFAULT_TITLE;
};

const useResumePreviewState = (isOpen: boolean, resumeId: string | null) => {
    const [previewSnapshot, setPreviewSnapshot] = useState<DashboardResumePreviewSnapshot | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!isOpen || !resumeId) {
            setPreviewSnapshot(null);
            setIsLoading(false);
            setError(null);
            return;
        }
        let cancelled = false;
        const currentResumeId = resumeId;
        const loadPreview = async () => {
            setIsLoading(true);
            setError(null);
            setPreviewSnapshot(null);
            try {
                const snapshot = await loadDashboardResumePreviewSnapshot(currentResumeId);
                if (cancelled) {
                    return;
                }
                setPreviewSnapshot(snapshot);
            } catch (err) {
                console.error('[ResumePreviewModal] 加载预览失败:', err);
                if (!cancelled) {
                    setError(DASHBOARD_RESUME_PREVIEW_ERROR_TEXT);
                }
            } finally {
                if (!cancelled) {
                    setIsLoading(false);
                }
            }
        };
        loadPreview();
        return () => {
            cancelled = true;
        };
    }, [isOpen, resumeId]);

    return { previewSnapshot, isLoading, error };
};

type PreviewShellProps = {
    title: string;
    onClose: () => void;
    children: React.ReactNode;
};

type PreviewBodyProps = {
    isLoading: boolean;
    error: string | null;
    previewProps: ResumePreviewProps | null;
};

const PreviewShell: React.FC<PreviewShellProps> = ({ title, onClose, children }) => (
    <div
        className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
        onClick={onClose}
    >
        <div
            className="bg-white dark:bg-surface-dark rounded-2xl shadow-2xl w-[92vw] max-w-6xl h-[88vh] flex flex-col overflow-hidden"
            onClick={(event) => event.stopPropagation()}
        >
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white truncate">{title}</h3>
                <button
                    onClick={onClose}
                    className="p-2 rounded-full text-gray-500 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-white dark:hover:bg-gray-700 transition-colors"
                    type="button"
                >
                    <X className="w-5 h-5" />
                </button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto bg-gray-100 dark:bg-gray-900/50">
                {children}
            </div>
        </div>
    </div>
);

const PreviewBody: React.FC<PreviewBodyProps> = ({ isLoading, error, previewProps }) => {
    if (isLoading) {
        return (
            <div className="h-full flex items-center justify-center text-sm text-gray-500">
                {DASHBOARD_RESUME_PREVIEW_LOADING_TEXT}
            </div>
        );
    }
    if (error) {
        return (
            <div className="h-full flex items-center justify-center text-sm text-red-500">
                {error}
            </div>
        );
    }
    if (previewProps) {
        return <ResumePreview {...previewProps} />;
    }
    return (
        <div className="h-full flex items-center justify-center text-sm text-gray-500">
            {DASHBOARD_RESUME_PREVIEW_LOADING_TEXT}
        </div>
    );
};

const ResumePreviewModal: React.FC<ResumePreviewModalProps> = ({
    isOpen,
    resumeId,
    resumeName,
    onClose,
}) => {
    const { previewSnapshot, isLoading, error } = useResumePreviewState(isOpen, resumeId);
    const previewState =
        previewSnapshot && resumeId && previewSnapshot.resumeId === resumeId
            ? previewSnapshot.state
            : null;
    const previewRef = useRef<HTMLDivElement | null>(null);
    const previewContentRef = useRef<HTMLDivElement | null>(null);
    const previewProps = previewState
        ? buildDashboardResumePreviewProps(
            previewState,
            previewRef,
            previewContentRef,
            {
                previewScope: 'dashboard-modal',
                resumeDisplayTitle: resolveResumeDisplayTitle(resumeName),
            }
        )
        : null;

    if (!isOpen) {
        return null;
    }

    const title = buildPreviewTitle(resumeName);

    return (
        <PreviewShell title={title} onClose={onClose}>
            <PreviewBody isLoading={isLoading} error={error} previewProps={previewProps} />
        </PreviewShell>
    );
};

export default ResumePreviewModal;
