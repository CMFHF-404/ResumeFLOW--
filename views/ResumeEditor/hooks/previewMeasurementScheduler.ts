import type { ResumePrintLayoutMeasurement } from '../../../types/resume';

type PreviewMeasurementCollector<T> = (
    isCancelled: () => boolean
) => Promise<T | null>;

type PreviewMeasurementSchedulerOptions<T> = {
    collect: PreviewMeasurementCollector<T>;
    commit: (measurement: T | null) => void;
    onError?: (error: unknown) => void;
    requestFrame: (callback: () => void) => number;
    cancelFrame: (frameId: number) => void;
};

export type PreviewMeasurementScheduler = {
    schedule: () => void;
    cancel: () => void;
};

/**
 * Coalesces layout-change notifications while keeping measurement single-flight.
 * A newer notification invalidates an older async collector and requests at most
 * one trailing pass with the latest DOM state.
 */
export const createPreviewMeasurementScheduler = <T>({
    collect,
    commit,
    onError,
    requestFrame,
    cancelFrame,
}: PreviewMeasurementSchedulerOptions<T>): PreviewMeasurementScheduler => {
    let cancelled = false;
    let frameId: number | null = null;
    let measurementInFlight = false;
    let rerunRequested = false;
    let requestedVersion = 0;

    const runMeasurement = async () => {
        frameId = null;
        if (cancelled || measurementInFlight) {
            return;
        }

        measurementInFlight = true;
        try {
            do {
                rerunRequested = false;
                const runVersion = requestedVersion;
                const isStale = () => cancelled || runVersion !== requestedVersion;
                try {
                    const measurement = await collect(isStale);
                    if (!isStale()) {
                        commit(measurement);
                    }
                } catch (error) {
                    if (!cancelled) {
                        onError?.(error);
                    }
                }
            } while (!cancelled && rerunRequested);
        } finally {
            measurementInFlight = false;
        }
    };

    const schedule = () => {
        if (cancelled) {
            return;
        }

        requestedVersion += 1;
        if (measurementInFlight) {
            rerunRequested = true;
            return;
        }
        if (frameId !== null) {
            return;
        }

        frameId = requestFrame(() => {
            void runMeasurement();
        });
    };

    const cancel = () => {
        if (cancelled) {
            return;
        }
        cancelled = true;
        requestedVersion += 1;
        rerunRequested = false;
        if (frameId !== null) {
            cancelFrame(frameId);
            frameId = null;
        }
    };

    return { schedule, cancel };
};

export const arePreviewMeasurementsEquivalent = (
    current: ResumePrintLayoutMeasurement | null,
    next: ResumePrintLayoutMeasurement | null
) => {
    if (current === next) {
        return true;
    }
    if (!current || !next || current.fits !== next.fits) {
        return false;
    }

    const currentSectionIds = current.overflowingSectionIds;
    const nextSectionIds = next.overflowingSectionIds;
    return currentSectionIds.length === nextSectionIds.length
        && currentSectionIds.every((sectionId, index) => sectionId === nextSectionIds[index]);
};
