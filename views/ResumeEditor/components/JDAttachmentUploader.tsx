import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FileText, Image as ImageIcon, Paperclip, X } from 'lucide-react';

import {
    JD_ATTACHMENT_ACCEPT,
    isJDAttachmentImageFile,
} from '../../../utils/jdAttachment';

export {
    JD_ATTACHMENT_ACCEPT,
    isAcceptedJDAttachmentFile,
    isJDAttachmentImageFile,
    prepareJDAttachmentFile,
} from '../../../utils/jdAttachment';

type JDAttachmentUploaderProps = {
    file: File | null;
    onFileSelect: (file: File) => Promise<void>;
    disabled?: boolean;
};

type JDAttachmentPreviewProps = {
    file: File;
    onClear: () => void;
    disabled?: boolean;
};

export const JDAttachmentPreview: React.FC<JDAttachmentPreviewProps> = ({
    file,
    onClear,
    disabled,
}) => {
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const isImage = isJDAttachmentImageFile(file);

    useEffect(() => {
        if (!isImage) {
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
    }, [file, isImage]);

    return (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-100 bg-emerald-50/70 px-3 py-2 text-xs shadow-sm dark:border-emerald-800/40 dark:bg-emerald-900/10">
            {isImage && previewUrl ? (
                <img
                    src={previewUrl}
                    alt="JD 附件预览"
                    className="h-8 w-8 shrink-0 rounded object-cover"
                />
            ) : (
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-white/80 dark:bg-gray-900/70">
                    {isImage
                        ? <ImageIcon className="h-4 w-4 text-emerald-600/70" />
                        : <FileText className="h-4 w-4 text-emerald-600/70" />}
                </div>
            )}
            <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-emerald-900 dark:text-emerald-100">{file.name}</p>
                <p className="text-[11px] text-emerald-700/80 dark:text-emerald-300/70">已作为 JD 附件，分析后会自动转成可持久化文本</p>
            </div>
            <button
                type="button"
                onClick={onClear}
                disabled={disabled}
                aria-label="移除附件"
                className="shrink-0 rounded-md p-1 text-emerald-700/70 transition-colors hover:bg-emerald-100 hover:text-emerald-900 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-emerald-900/40 dark:hover:text-emerald-100"
            >
                <X className="h-3.5 w-3.5" />
            </button>
        </div>
    );
};

const JDAttachmentUploader: React.FC<JDAttachmentUploaderProps> = ({
    file,
    onFileSelect,
    disabled,
}) => {
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!file && inputRef.current) {
            inputRef.current.value = '';
        }
    }, [file]);

    const handleClick = useCallback(() => {
        if (!disabled) {
            inputRef.current?.click();
        }
    }, [disabled]);

    const handleInputChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        const selected = event.target.files?.[0];
        event.target.value = '';
        if (selected) {
            void onFileSelect(selected);
        }
    }, [onFileSelect]);

    return (
        <>
            <button
                type="button"
                onClick={handleClick}
                disabled={disabled}
                aria-label="上传 JD 附件"
                className={[
                    'inline-flex h-8 w-8 items-center justify-center rounded-md border transition-colors',
                    file
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/50 dark:bg-emerald-900/20 dark:text-emerald-300'
                        : 'border-gray-200 bg-white text-gray-500 hover:border-emerald-200 hover:text-emerald-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:border-emerald-700/50 dark:hover:text-emerald-300',
                    disabled ? 'cursor-not-allowed opacity-60' : '',
                ].join(' ')}
            >
                <Paperclip className="h-3.5 w-3.5" />
            </button>
            <input
                ref={inputRef}
                type="file"
                accept={JD_ATTACHMENT_ACCEPT}
                className="hidden"
                disabled={disabled}
                onChange={handleInputChange}
            />
        </>
    );
};

export default JDAttachmentUploader;
