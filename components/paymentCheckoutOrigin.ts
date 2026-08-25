export const PAYMENT_CHECKOUT_ORIGIN_MISMATCH_MESSAGE =
  '支付收银台地址与当前部署配置不一致，已阻止跳转。请联系管理员检查支付配置。';

export class PaymentCheckoutOriginMismatchError extends Error {
  constructor() {
    super(PAYMENT_CHECKOUT_ORIGIN_MISMATCH_MESSAGE);
    this.name = 'PaymentCheckoutOriginMismatchError';
  }
}

export const assertPaymentCheckoutOrigin = (
  action: string,
  configuredOrigin: string,
): void => {
  try {
    const actionUrl = new URL(action);
    const expectedUrl = new URL(configuredOrigin);
    if (
      expectedUrl.protocol === 'https:'
      && expectedUrl.origin === configuredOrigin
      && actionUrl.protocol === 'https:'
      && !actionUrl.username
      && !actionUrl.password
      && actionUrl.origin === expectedUrl.origin
    ) {
      return;
    }
  } catch {
    // Fall through to the single fail-closed error below.
  }
  throw new PaymentCheckoutOriginMismatchError();
};
