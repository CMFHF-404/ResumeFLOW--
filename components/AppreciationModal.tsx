import React from 'react';
import { X } from 'lucide-react';

interface AppreciationModalProps {
  isOpen: boolean;
  onClose: () => void;
  returnFocusElement?: HTMLElement | null;
}

const AppreciationModal: React.FC<AppreciationModalProps> = ({ isOpen, onClose, returnFocusElement }) => {
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const closeButtonRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    if (!isOpen) {
      return;
    }

    const fallbackFocusElement = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const focusTarget = returnFocusElement ?? fallbackFocusElement;
    const focusableSelector = [
      'button',
      '[href]',
      'input',
      'select',
      'textarea',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',');

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }

      if (event.key !== 'Tab') {
        return;
      }

      const dialog = dialogRef.current;
      if (!dialog) {
        return;
      }

      const focusableElements = Array.from(
        dialog.querySelectorAll<HTMLElement>(focusableSelector)
      ).filter((element) => !element.hasAttribute('disabled'));

      if (!focusableElements.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
        return;
      }

      if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    window.setTimeout(() => closeButtonRef.current?.focus(), 0);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (focusTarget?.isConnected) {
        focusTarget.focus();
      }
    };
  }, [isOpen, onClose, returnFocusElement]);

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/60 px-4 py-6 backdrop-blur-sm"
      onMouseDown={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="appreciation-title"
    >
      <div
        ref={dialogRef}
        className="relative w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-surface-dark"
        onMouseDown={(event) => event.stopPropagation()}
        tabIndex={-1}
      >
        <button
          ref={closeButtonRef}
          className="absolute right-3 top-3 z-10 rounded-full bg-white/90 p-2 text-slate-500 shadow-sm transition hover:bg-white hover:text-slate-900 dark:bg-slate-900/85 dark:text-slate-300 dark:hover:text-white"
          onClick={onClose}
          type="button"
          aria-label="关闭赞赏窗口"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="bg-gradient-to-b from-amber-50 to-white px-5 pb-5 pt-6 dark:from-amber-950/30 dark:to-surface-dark">
          <h2 id="appreciation-title" className="text-center text-lg font-semibold text-amber-700 dark:text-amber-300">
            赞赏作者
          </h2>
          <p className="mt-1 text-center text-sm text-slate-500 dark:text-slate-400">
            感谢你的支持
          </p>
          <div className="mt-5 overflow-hidden rounded-xl border border-amber-100 bg-white p-2 shadow-sm dark:border-amber-900/40 dark:bg-slate-950/40">
            <img
              className="block h-auto w-full"
              src="/appreciation-qr.jpg"
              alt="CMFHF 的赞赏码"
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default AppreciationModal;
