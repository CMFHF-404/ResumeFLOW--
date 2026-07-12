const ACCEPTED_IMAGE_TYPES: ReadonlySet<string> = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ACCEPTED_DOC_TYPES = new Set([
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);
const ACCEPTED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.pdf', '.docx']);
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];
const MAX_IMAGE_DIMENSION = 1600;
const IMAGE_OUTPUT_TYPE = 'image/jpeg';
const IMAGE_OUTPUT_QUALITY = 0.82;

export const JD_ATTACHMENT_ACCEPT = '.jpg,.jpeg,.png,.webp,.pdf,.docx';

const resolveFileExtension = (filename: string): string =>
    '.' + (filename.split('.').pop()?.toLowerCase() ?? '');

export const isAcceptedJDAttachmentFile = (file: File): boolean => {
    if (ACCEPTED_IMAGE_TYPES.has(file.type) || ACCEPTED_DOC_TYPES.has(file.type)) {
        return true;
    }
    return ACCEPTED_EXTENSIONS.has(resolveFileExtension(file.name));
};

export const isJDAttachmentImageFile = (file: File): boolean =>
    ACCEPTED_IMAGE_TYPES.has(file.type)
    || IMAGE_EXTENSIONS.includes(resolveFileExtension(file.name));

const replaceImageExtension = (filename: string, nextExtension: string) => {
    const index = filename.lastIndexOf('.');
    if (index < 0) {
        return `${filename}${nextExtension}`;
    }
    return `${filename.slice(0, index)}${nextExtension}`;
};

const canvasToBlob = (
    canvas: HTMLCanvasElement,
    type: string,
    quality?: number
): Promise<Blob> => new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
        if (!blob) {
            reject(new Error('Failed to create compressed image blob.'));
            return;
        }
        resolve(blob);
    }, type, quality);
});

const loadImageElement = (file: File): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
        URL.revokeObjectURL(objectUrl);
        resolve(image);
    };

    image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('Failed to load image.'));
    };

    image.src = objectUrl;
});

const normalizeImageForJDAnalysis = async (file: File): Promise<File> => {
    if (!isJDAttachmentImageFile(file)) {
        return file;
    }

    try {
        const image = await loadImageElement(file);
        const longestSide = Math.max(image.naturalWidth, image.naturalHeight);
        const scale = longestSide > MAX_IMAGE_DIMENSION
            ? MAX_IMAGE_DIMENSION / longestSide
            : 1;
        const targetWidth = Math.max(1, Math.round(image.naturalWidth * scale));
        const targetHeight = Math.max(1, Math.round(image.naturalHeight * scale));
        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;

        const context = canvas.getContext('2d');
        if (!context) {
            return file;
        }

        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, targetWidth, targetHeight);
        context.drawImage(image, 0, 0, targetWidth, targetHeight);

        const blob = await canvasToBlob(canvas, IMAGE_OUTPUT_TYPE, IMAGE_OUTPUT_QUALITY);
        if (blob.size >= file.size) {
            return file;
        }

        return new File([blob], replaceImageExtension(file.name, '.jpg'), {
            type: IMAGE_OUTPUT_TYPE,
            lastModified: file.lastModified,
        });
    } catch (error) {
        console.warn('[JDAttachmentUploader] Failed to normalize image attachment.', error);
        return file;
    }
};

export const prepareJDAttachmentFile = async (file: File): Promise<File | null> => {
    if (!isAcceptedJDAttachmentFile(file)) {
        return null;
    }
    return normalizeImageForJDAnalysis(file);
};

type JDAttachmentFileChangeHandler = (file: File | null) => void;
type JDAttachmentFilePreparer = (file: File) => Promise<File | null>;

export type JDAttachmentSelectionController = {
    selectFile: (file: File) => Promise<void>;
    clearFile: () => void;
    invalidatePending: () => void;
    waitForPendingSelection: () => Promise<boolean>;
};

export const createJDAttachmentSelectionController = (
    onFileChange: JDAttachmentFileChangeHandler,
    prepareFile: JDAttachmentFilePreparer = prepareJDAttachmentFile
): JDAttachmentSelectionController => {
    let selectionVersion = 0;
    type PendingResolution = 'completed' | 'superseded' | 'invalidated';
    let pendingSelection: {
        promise: Promise<PendingResolution>;
        resolve: (resolution: PendingResolution) => void;
    } | null = null;

    const releasePendingSelection = (resolution: PendingResolution) => {
        const pending = pendingSelection;
        pendingSelection = null;
        pending?.resolve(resolution);
    };

    const invalidatePending = () => {
        selectionVersion += 1;
        releasePendingSelection('invalidated');
    };

    return {
        async selectFile(file) {
            const requestVersion = selectionVersion + 1;
            selectionVersion = requestVersion;
            releasePendingSelection('superseded');
            let resolvePendingSelection: (resolution: PendingResolution) => void = () => undefined;
            const pendingPromise = new Promise<PendingResolution>((resolve) => {
                resolvePendingSelection = resolve;
            });
            const requestPendingSelection = {
                promise: pendingPromise,
                resolve: resolvePendingSelection,
            };
            pendingSelection = requestPendingSelection;
            let resolution: PendingResolution = 'invalidated';
            try {
                const preparedFile = await prepareFile(file);
                if (selectionVersion !== requestVersion || !preparedFile) {
                    return;
                }
                onFileChange(preparedFile);
                resolution = 'completed';
            } finally {
                if (pendingSelection === requestPendingSelection) {
                    pendingSelection = null;
                    requestPendingSelection.resolve(resolution);
                } else {
                    requestPendingSelection.resolve('superseded');
                }
            }
        },
        clearFile() {
            invalidatePending();
            onFileChange(null);
        },
        invalidatePending,
        async waitForPendingSelection() {
            while (pendingSelection) {
                const resolution = await pendingSelection.promise;
                if (!pendingSelection && resolution === 'invalidated') {
                    return false;
                }
            }
            return true;
        },
    };
};
