import React, { useEffect, useState } from 'react';

export type RenameResumeDialogProps = {
    isOpen: boolean;
    initialName: string;
    isSaving?: boolean;
    onConfirm: (nextName: string) => void | Promise<void>;
    onCancel: () => void;
};

const DIALOG_TITLE = '重命名简历';
const NAME_PLACEHOLDER = '请输入简历名称';
const EMPTY_NAME_ERROR = '简历名称不能为空';

const trimName = (value: string) => value.trim();

const RenameResumeDialog: React.FC<RenameResumeDialogProps> = ({
    isOpen,
    initialName,
    isSaving = false,
    onConfirm,
    onCancel,
}) => {
    const [name, setName] = useState(initialName);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!isOpen) {
            return;
        }
        setName(initialName);
        setError(null);
    }, [initialName, isOpen]);

    if (!isOpen) {
        return null;
    }

    const handleChange = (value: string) => {
        setName(value);
        if (error) {
            setError(null);
        }
    };

    const handleConfirm = () => {
        const trimmed = trimName(name);
        if (!trimmed) {
            setError(EMPTY_NAME_ERROR);
            return;
        }
        onConfirm(trimmed);
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-surface-dark rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl animate-in zoom-in-95 duration-200">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">{DIALOG_TITLE}</h3>
                <div className="space-y-2">
                    <input
                        value={name}
                        onChange={(event) => handleChange(event.target.value)}
                        placeholder={NAME_PLACEHOLDER}
                        className="w-full px-4 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-primary/40"
                    />
                    {error ? (
                        <p className="text-xs text-red-600">{error}</p>
                    ) : null}
                </div>
                <div className="flex items-center justify-end gap-3 mt-6">
                    <button
                        onClick={onCancel}
                        disabled={isSaving}
                        className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-60"
                        type="button"
                    >
                        取消
                    </button>
                    <button
                        onClick={handleConfirm}
                        disabled={isSaving}
                        className="px-4 py-2 text-sm font-medium text-white bg-primary hover:bg-primary-dark rounded-lg transition-colors shadow-lg shadow-primary/30 disabled:opacity-60"
                        type="button"
                    >
                        {isSaving ? '保存中...' : '保存'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default RenameResumeDialog;
