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
    onClear: () => void;
    disabled?: boolean;
};

const JDAttachmentUploader: React.FC<JDAttachmentUploaderProps> = ({
    file,
    onFileSelect,
    onClear,
    disabled,
}) => {
    const inputRef = useRef<HTMLInputElement>(null);
    const [preview, setPreview] = useState<{ file: File; url: string } | null>(null);

    useEffect(() => {
        if (!file || !isJDAttachmentImageFile(file)) {
            setPreview(null);
            return;
        }
        const url = URL.createObjectURL(file);
        setPreview({ file, url });
        return () => URL.revokeObjectURL(url);
    }, [file]);

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
        <span className="relative inline-flex shrink-0">
            <button
                type="button"
                onClick={handleClick}
                disabled={disabled}
                aria-label={file ? `替换 JD 附件：${file.name}` : '上传 JD 附件'}
                title={file ? file.name : '上传 JD 附件'}
                className={[
                    'inline-flex h-8 w-8 items-center justify-center rounded-md border transition-colors',
                    file
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/50 dark:bg-emerald-900/20 dark:text-emerald-300'
                        : 'border-gray-200 bg-white text-gray-500 hover:border-emerald-200 hover:text-emerald-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:border-emerald-700/50 dark:hover:text-emerald-300',
                    disabled ? 'cursor-not-allowed opacity-60' : '',
                ].join(' ')}
            >
                {file ? (isJDAttachmentImageFile(file)
                    ? preview?.file === file
                        ? <img src={preview.url} alt="JD 附件预览" className="h-full w-full rounded-[5px] object-contain" />
                        : <ImageIcon aria-hidden="true" className="h-4 w-4" />
                    : <FileText aria-hidden="true" className="h-4 w-4" />)
                    : <Paperclip aria-hidden="true" className="h-3.5 w-3.5" />}
            </button>
            {file && <button
                type="button"
                onClick={onClear}
                disabled={disabled}
                aria-label="移除附件"
                title="移除附件"
                className="absolute -right-1.5 -top-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full border border-emerald-200 bg-white text-emerald-700 shadow-sm hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-emerald-700 dark:bg-gray-900 dark:text-emerald-300"
            >
                <X aria-hidden="true" className="h-3 w-3" />
            </button>}
            <input aria-label="上传附件"
                ref={inputRef}
                type="file"
                accept={JD_ATTACHMENT_ACCEPT}
                className="hidden"
                disabled={disabled}
                onChange={handleInputChange}
            />
        </span>
    );
};

export default JDAttachmentUploader;
