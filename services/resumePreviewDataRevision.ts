type ResumePreviewDataRevisionListener = () => void;

let resumePreviewDataRevision = 0;
const listeners = new Set<ResumePreviewDataRevisionListener>();

export const getResumePreviewDataRevision = () => resumePreviewDataRevision;

export const bumpResumePreviewDataRevision = () => {
    resumePreviewDataRevision += 1;
    listeners.forEach((listener) => listener());
    return resumePreviewDataRevision;
};

export const subscribeResumePreviewDataRevision = (
    listener: ResumePreviewDataRevisionListener
) => {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
};
