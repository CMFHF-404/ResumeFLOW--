import React from 'react';
import { CreditCard, WalletCards, X } from 'lucide-react';
import { DEFAULT_QUOTA_PURCHASE_MESSAGE } from '../services/quotaPurchasePrompt';

type QuotaPurchasePromptProps = {
  message?: string;
  onOpenPurchase: () => void;
  onDismiss: () => void;
};

const QuotaPurchasePrompt: React.FC<QuotaPurchasePromptProps> = ({
  message,
  onOpenPurchase,
  onDismiss,
}) => {
  return (
    <div className="pointer-events-none fixed inset-x-3 top-3 z-[90] flex justify-center sm:inset-x-6 sm:top-5">
      <div
        role="alert"
        aria-live="assertive"
        className="pointer-events-auto flex w-full max-w-xl flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-white/95 p-3 shadow-xl shadow-amber-950/10 backdrop-blur sm:flex-nowrap dark:border-amber-500/30 dark:bg-gray-950/95"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
          <WalletCards className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-extrabold text-gray-900 dark:text-white">AI 额度不足</p>
          <p className="mt-0.5 text-[11px] font-medium leading-4 text-gray-600 dark:text-gray-300">
            {message?.trim() || DEFAULT_QUOTA_PURCHASE_MESSAGE}
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenPurchase}
          className="order-last inline-flex min-h-9 w-full shrink-0 items-center justify-center gap-1.5 rounded-lg bg-amber-500 px-3 text-xs font-extrabold text-white transition hover:bg-amber-600 focus:outline-none focus:ring-2 focus:ring-amber-300 focus:ring-offset-2 sm:order-none sm:w-auto dark:hover:bg-amber-400 dark:focus:ring-offset-gray-950"
        >
          <CreditCard className="h-3.5 w-3.5" aria-hidden="true" />
          购买套餐
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-300 dark:hover:bg-gray-800 dark:hover:text-gray-200"
          aria-label="关闭额度不足提示"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
};

export default QuotaPurchasePrompt;
