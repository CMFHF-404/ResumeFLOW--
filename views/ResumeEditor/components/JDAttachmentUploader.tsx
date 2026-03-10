/**
 * JDAttachmentUploader
 *
 * 职责：提供 JD 附件的上传交互（拖拽 / 点击选择），
 * 不持有 AI 分析状态，仅负责文件选取和预览展示。
 *
 * 支持格式：JPG / PNG / WEBP（图像）、PDF / DOCX（文档）。
 * 图像展示缩略图预览，文档展示文件名 + 类型图标。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FileText, Image as ImageIcon, Paperclip, X } from 'lucide-react';

// ── 文件类型校验 ──────────────────────────────────────────────────

const ACCEPTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ACCEPTED_DOC_TYPES = new Set([
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);
const ACCEPTED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.pdf', '.docx']);
const MAX_IMAGE_DIMENSION = 1600;
const IMAGE_OUTPUT_TYPE = 'image/jpeg';
const IMAGE_OUTPUT_QUALITY = 0.82;

const resolveFileExtension = (filename: string): string =>
    '.' + filename.split('.').pop()?.toLowerCase();

const isAcceptedFile = (file: File): boolean => {
    if (ACCEPTED_IMAGE_TYPES.has(file.type) || ACCEPTED_DOC_TYPES.has(file.type)) {
        return true;
    }
    // 兼容 MIME 缺失时依赖扩展名
    return ACCEPTED_EXTENSIONS.has(resolveFileExtension(file.name));
};

const isImageFile = (file: File): boolean =>
    ACCEPTED_IMAGE_TYPES.has(file.type) ||
    ['.jpg', '.jpeg', '.png', '.webp'].includes(resolveFileExtension(file.name));

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
    if (!isImageFile(file)) {
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

        // JPEG 输出前先铺白底，避免透明 PNG/WebP 出现黑底。
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

// ── 类型定义 ──────────────────────────────────────────────────────

type JDAttachmentUploaderProps = {
    /** 当前已选文件，由父组件管理 */
    file: File | null;
    /** 用户选取或清除文件时的回调 */
    onFileChange: (file: File | null) => void;
    /** 是否禁用（分析进行中时禁用） */
    disabled?: boolean;
};

// ── 子组件：文件预览 ──────────────────────────────────────────────

type FilePreviewProps = {
    file: File;
    previewUrl: string | null;
    onClear: () => void;
    disabled?: boolean;
};

const FilePreview: React.FC<FilePreviewProps> = ({ file, previewUrl, onClear, disabled }) => {
    const isImage = isImageFile(file);

    return (
        <div className="flex items-center gap-2 rounded-lg border border-border-light dark:border-border-dark bg-white dark:bg-gray-900 px-3 py-2 shadow-sm">
            {isImage && previewUrl ? (
                <img
                    src={previewUrl}
                    alt="JD 预览"
                    className="h-8 w-8 rounded object-cover shrink-0"
                />
            ) : (
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-gray-100 dark:bg-gray-800">
                    {isImage
                        ? <ImageIcon className="h-4 w-4 text-gray-400" />
                        : <FileText className="h-4 w-4 text-gray-400" />}
                </div>
            )}
            <span className="flex-1 truncate text-xs text-gray-600 dark:text-gray-300">
                {file.name}
            </span>
            <button
                type="button"
                onClick={onClear}
                disabled={disabled}
                aria-label="移除附件"
                className="shrink-0 rounded p-0.5 text-gray-400 transition-colors hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:text-gray-200"
            >
                <X className="h-3.5 w-3.5" />
            </button>
        </div>
    );
};

// ── 子组件：上传拖拽区 ────────────────────────────────────────────

type DropZoneProps = {
    isDragOver: boolean;
    disabled?: boolean;
    onDragOver: (e: React.DragEvent) => void;
    onDragLeave: () => void;
    onDrop: (e: React.DragEvent) => void;
    onClick: () => void;
};

const DropZone: React.FC<DropZoneProps> = ({
    isDragOver,
    disabled,
    onDragOver,
    onDragLeave,
    onDrop,
    onClick,
}) => (
    <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label="上传 JD 附件"
        onClick={onClick}
        onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                onClick();
            }
        }}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={[
            'flex cursor-pointer select-none items-center gap-2 rounded-lg border px-3 py-2 text-xs transition-colors',
            isDragOver
                ? 'border-primary/60 bg-primary/5 text-primary'
                : 'border-dashed border-border-light dark:border-border-dark text-gray-400 hover:border-gray-300 hover:text-gray-500 dark:hover:border-gray-600 dark:hover:text-gray-300',
            disabled ? 'pointer-events-none opacity-50' : '',
        ].join(' ')}
    >
        <Paperclip className="h-3.5 w-3.5 shrink-0" />
        <span>上传 JD 附件（图片 / PDF / DOCX）</span>
    </div>
);

// ── 主组件 ────────────────────────────────────────────────────────

const JDAttachmentUploader: React.FC<JDAttachmentUploaderProps> = ({
    file,
    onFileChange,
    disabled,
}) => {
    const inputRef = useRef<HTMLInputElement>(null);
    const fileSelectionVersionRef = useRef(0);
    const [isDragOver, setIsDragOver] = useState(false);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);

    useEffect(() => {
        if (!file) {
            setPreviewUrl((prev) => {
                if (prev) {
                    URL.revokeObjectURL(prev);
                }
                return null;
            });
            if (inputRef.current) {
                inputRef.current.value = '';
            }
            return;
        }

        if (!isImageFile(file)) {
            setPreviewUrl((prev) => {
                if (prev) {
                    URL.revokeObjectURL(prev);
                }
                return null;
            });
            return;
        }

        const nextPreviewUrl = URL.createObjectURL(file);
        setPreviewUrl((prev) => {
            if (prev) {
                URL.revokeObjectURL(prev);
            }
            return nextPreviewUrl;
        });

        return () => {
            URL.revokeObjectURL(nextPreviewUrl);
        };
    }, [file]);

    /** 选取文件后的统一处理：校验类型，并对图片做轻量压缩。 */
    const handleFileSelect = useCallback(async (selected: File) => {
        if (!isAcceptedFile(selected)) {
            return;
        }
        const requestVersion = fileSelectionVersionRef.current + 1;
        fileSelectionVersionRef.current = requestVersion;
        const normalizedFile = await normalizeImageForJDAnalysis(selected);
        if (fileSelectionVersionRef.current !== requestVersion) {
            return;
        }
        onFileChange(normalizedFile);
    }, [onFileChange]);

    const handleClear = useCallback(() => {
        fileSelectionVersionRef.current += 1;
        if (inputRef.current) {
            inputRef.current.value = '';
        }
        onFileChange(null);
    }, [onFileChange]);

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        if (!disabled) {
            setIsDragOver(true);
        }
    }, [disabled]);

    const handleDragLeave = useCallback(() => {
        setIsDragOver(false);
    }, []);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragOver(false);
        if (disabled) {
            return;
        }
        const dropped = e.dataTransfer.files[0];
        if (dropped) {
            void handleFileSelect(dropped);
        }
    }, [disabled, handleFileSelect]);

    const handleClick = useCallback(() => {
        if (!disabled) {
            inputRef.current?.click();
        }
    }, [disabled]);

    const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const selected = e.target.files?.[0];
        if (selected) {
            void handleFileSelect(selected);
        }
    }, [handleFileSelect]);

    return (
        <div className="space-y-2">
            {file ? (
                <FilePreview
                    file={file}
                    previewUrl={previewUrl}
                    onClear={handleClear}
                    disabled={disabled}
                />
            ) : (
                <DropZone
                    isDragOver={isDragOver}
                    disabled={disabled}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={handleClick}
                />
            )}
            <p className="text-[11px] leading-5 text-gray-400 dark:text-gray-500">
                图片附件会在上传前自动压缩，减少 JD 分析超时的概率。
            </p>
            <input
                ref={inputRef}
                type="file"
                accept=".jpg,.jpeg,.png,.webp,.pdf,.docx"
                className="hidden"
                disabled={disabled}
                onChange={handleInputChange}
            />
        </div>
    );
};

export default JDAttachmentUploader;


