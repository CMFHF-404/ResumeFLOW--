const QUOTA_PURCHASE_REQUIRED_EVENT = 'app:quota-purchase-required';

export const DEFAULT_QUOTA_PURCHASE_MESSAGE = 'AI 额度已用完，请购买套餐或兑换卡密后继续使用。';

export type QuotaPurchaseRequiredPayload = {
  message?: string;
};

export const readQuotaPurchaseMessage = (payload: unknown): string => {
  if (!payload || typeof payload !== 'object') {
    return DEFAULT_QUOTA_PURCHASE_MESSAGE;
  }

  const detail = (payload as { detail?: unknown }).detail;
  if (typeof detail === 'string' && detail.trim()) {
    return detail.trim();
  }
  if (detail && typeof detail === 'object') {
    const message = (detail as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) {
      return message.trim();
    }
  }

  return DEFAULT_QUOTA_PURCHASE_MESSAGE;
};

export const dispatchQuotaPurchaseRequired = (message?: string) => {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<QuotaPurchaseRequiredPayload>(QUOTA_PURCHASE_REQUIRED_EVENT, {
      detail: {
        message: message?.trim() || DEFAULT_QUOTA_PURCHASE_MESSAGE,
      },
    })
  );
};

export const subscribeQuotaPurchaseRequired = (
  handler: (payload: QuotaPurchaseRequiredPayload) => void
) => {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  const listener = (event: Event) => {
    const customEvent = event as CustomEvent<QuotaPurchaseRequiredPayload>;
    handler(customEvent.detail || {});
  };

  window.addEventListener(QUOTA_PURCHASE_REQUIRED_EVENT, listener as EventListener);

  return () => {
    window.removeEventListener(QUOTA_PURCHASE_REQUIRED_EVENT, listener as EventListener);
  };
};
