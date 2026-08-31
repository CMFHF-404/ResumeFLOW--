import { useCallback, useEffect, useMemo, useState, type RefObject } from 'react';
import type { ResumePrintLayoutMeasurement } from '../../../types/resume';
import { measureResumeLayout } from '../snapshotUtils';
import {
    arePreviewMeasurementsEquivalent,
    createPreviewMeasurementScheduler,
} from './previewMeasurementScheduler';

type UseResumePreviewMeasurementParams = {
    enabled: boolean;
    pageRef: RefObject<HTMLDivElement | null>;
    contentRef: RefObject<HTMLDivElement | null>;
    waitForPreviewUpdate: (frames?: number) => Promise<void>;
    measurementDeps: readonly unknown[];
};

export const useResumePreviewMeasurement = ({
    enabled,
    pageRef,
    contentRef,
    waitForPreviewUpdate,
    measurementDeps,
}: UseResumePreviewMeasurementParams) => {
    const [previewPrintMeasurement, setPreviewPrintMeasurement] = useState<ResumePrintLayoutMeasurement | null>(null);

    const collectPreviewMeasurement = useCallback(async (
        isCancelled: () => boolean = () => false
    ): Promise<ResumePrintLayoutMeasurement | null> => {
        await waitForPreviewUpdate(2);
        if (isCancelled()) {
            return null;
        }
        if (typeof document !== 'undefined' && document.fonts?.ready) {
            await document.fonts.ready;
            if (isCancelled()) {
                return null;
            }
            await waitForPreviewUpdate(1);
        }

        if (isCancelled()) {
            return null;
        }

        return measureResumeLayout(pageRef.current, contentRef.current);
    }, [contentRef, pageRef, waitForPreviewUpdate]);

    useEffect(() => {
        if (!enabled) {
            setPreviewPrintMeasurement(null);
            return undefined;
        }
        const pageElement = pageRef.current;
        const contentElement = contentRef.current;
        if (!pageElement || !contentElement || typeof window === 'undefined') {
            return undefined;
        }
        const pendingImageListeners = new Set<HTMLImageElement>();
        const commitMeasurement = (measurement: ResumePrintLayoutMeasurement | null) => {
            setPreviewPrintMeasurement((current) => (
                arePreviewMeasurementsEquivalent(current, measurement) ? current : measurement
            ));
        };
        const scheduler = createPreviewMeasurementScheduler({
            collect: collectPreviewMeasurement,
            commit: commitMeasurement,
            onError: (error) => {
                console.warn('[ResumeEditor] 预览布局测量失败', error);
            },
            requestFrame: (callback) => window.requestAnimationFrame(callback),
            cancelFrame: (frameId) => window.cancelAnimationFrame(frameId),
        });
        const detachImageListeners = () => {
            pendingImageListeners.forEach((image) => {
                image.removeEventListener('load', scheduler.schedule);
                image.removeEventListener('error', scheduler.schedule);
            });
            pendingImageListeners.clear();
        };
        const refreshPendingImages = () => {
            detachImageListeners();
            contentElement.querySelectorAll('img').forEach((image) => {
                if (image.complete) {
                    return;
                }
                image.addEventListener('load', scheduler.schedule);
                image.addEventListener('error', scheduler.schedule);
                pendingImageListeners.add(image);
            });
        };

        refreshPendingImages();
        scheduler.schedule();

        if (typeof ResizeObserver === 'undefined') {
            window.addEventListener('resize', scheduler.schedule);
            return () => {
                detachImageListeners();
                window.removeEventListener('resize', scheduler.schedule);
                scheduler.cancel();
            };
        }

        const observer = new ResizeObserver(() => {
            refreshPendingImages();
            scheduler.schedule();
        });
        observer.observe(pageElement);
        observer.observe(contentElement);

        return () => {
            detachImageListeners();
            observer.disconnect();
            scheduler.cancel();
        };
    }, [collectPreviewMeasurement, contentRef, enabled, pageRef, ...measurementDeps]);

    const overflowingSectionIds = useMemo(
        () => new Set(previewPrintMeasurement?.overflowingSectionIds ?? []),
        [previewPrintMeasurement]
    );

    return {
        isPreviewOverflowing: previewPrintMeasurement?.fits === false,
        overflowingSectionIds,
    };
};
