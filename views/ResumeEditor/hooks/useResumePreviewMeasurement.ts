import { useCallback, useEffect, useMemo, useState, type RefObject } from 'react';
import type { ResumePrintLayoutMeasurement } from '../../../types/resume';
import { measureResumeLayout } from '../snapshotUtils';

type UseResumePreviewMeasurementParams = {
    pageRef: RefObject<HTMLDivElement | null>;
    contentRef: RefObject<HTMLDivElement | null>;
    waitForPreviewUpdate: (frames?: number) => Promise<void>;
    measurementDeps: readonly unknown[];
};

export const useResumePreviewMeasurement = ({
    pageRef,
    contentRef,
    waitForPreviewUpdate,
    measurementDeps,
}: UseResumePreviewMeasurementParams) => {
    const [previewPrintMeasurement, setPreviewPrintMeasurement] = useState<ResumePrintLayoutMeasurement | null>(null);

    const collectPreviewMeasurement = useCallback(async (): Promise<ResumePrintLayoutMeasurement | null> => {
        await waitForPreviewUpdate(2);
        if (typeof document !== 'undefined' && document.fonts?.ready) {
            await document.fonts.ready;
            await waitForPreviewUpdate(1);
        }

        return measureResumeLayout(pageRef.current, contentRef.current);
    }, [contentRef, pageRef, waitForPreviewUpdate]);

    useEffect(() => {
        let cancelled = false;
        void collectPreviewMeasurement().then((measurement) => {
            if (cancelled) {
                return;
            }
            setPreviewPrintMeasurement(measurement);
        });

        return () => {
            cancelled = true;
        };
    }, [collectPreviewMeasurement, ...measurementDeps]);

    useEffect(() => {
        const pageElement = pageRef.current;
        const contentElement = contentRef.current;
        if (!pageElement || !contentElement || typeof window === 'undefined') {
            return undefined;
        }

        let cancelled = false;
        let frameId: number | null = null;
        const pendingImageListeners = new Set<HTMLImageElement>();
        const detachImageListeners = () => {
            pendingImageListeners.forEach((image) => {
                image.removeEventListener('load', scheduleMeasurement);
                image.removeEventListener('error', scheduleMeasurement);
            });
            pendingImageListeners.clear();
        };
        const refreshPendingImages = () => {
            detachImageListeners();
            contentElement.querySelectorAll('img').forEach((image) => {
                if (image.complete) {
                    return;
                }
                image.addEventListener('load', scheduleMeasurement);
                image.addEventListener('error', scheduleMeasurement);
                pendingImageListeners.add(image);
            });
        };
        const runMeasurement = () => {
            frameId = null;
            void collectPreviewMeasurement().then((measurement) => {
                if (cancelled) {
                    return;
                }
                setPreviewPrintMeasurement(measurement);
            });
        };
        function scheduleMeasurement() {
            if (cancelled || frameId !== null) {
                return;
            }
            frameId = window.requestAnimationFrame(runMeasurement);
        }

        refreshPendingImages();
        scheduleMeasurement();

        if (typeof ResizeObserver === 'undefined') {
            window.addEventListener('resize', scheduleMeasurement);
            return () => {
                cancelled = true;
                detachImageListeners();
                window.removeEventListener('resize', scheduleMeasurement);
                if (frameId !== null) {
                    window.cancelAnimationFrame(frameId);
                }
            };
        }

        const observer = new ResizeObserver(() => {
            refreshPendingImages();
            scheduleMeasurement();
        });
        observer.observe(pageElement);
        observer.observe(contentElement);

        return () => {
            cancelled = true;
            detachImageListeners();
            observer.disconnect();
            if (frameId !== null) {
                window.cancelAnimationFrame(frameId);
            }
        };
    }, [collectPreviewMeasurement, contentRef, pageRef]);

    const overflowingSectionIds = useMemo(
        () => new Set(previewPrintMeasurement?.overflowingSectionIds ?? []),
        [previewPrintMeasurement]
    );

    return {
        isPreviewOverflowing: previewPrintMeasurement?.fits === false,
        overflowingSectionIds,
    };
};
