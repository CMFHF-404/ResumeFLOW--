import React from 'react';

type ConfirmDialogProps = {
  isOpen: boolean;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  isConfirming?: boolean;
  tone?: 'danger' | 'primary';
};

const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  description,
  confirmLabel = '删除',
  cancelLabel = '取消',
  onConfirm,
  onCancel,
  isConfirming = false,
  tone = 'danger',
}) => {
  if (!isOpen) {
    return null;
  }

  const confirmButtonClass = tone === 'primary'
    ? 'bg-primary hover:bg-primary-dark shadow-lg shadow-primary/25'
    : 'bg-red-600 hover:bg-red-700 shadow-lg shadow-red-500/30';

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-surface-dark rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl animate-in zoom-in-95 duration-200">
        <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">{title}</h3>
        <div className="text-gray-600 dark:text-gray-400 mb-6">{description}</div>
        <div className="flex items-center justify-end gap-3">
          <button
            onClick={onCancel}
            disabled={isConfirming}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            type="button"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={isConfirming}
            className={`px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${confirmButtonClass}`}
            type="button"
          >
            {isConfirming ? '处理中...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDialog;
