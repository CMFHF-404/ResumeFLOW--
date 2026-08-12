import type { PaymentOrder } from '../services/billingService';

export type UnsettledPaymentOrderConflict = {
  code:
    | 'payment_order_unsettled'
    | 'payment_order_reconciliation_required'
    | 'payment_order_catalog_changed'
    | 'payment_order_not_payable'
    | 'payment_order_state_changed'
    | 'payment_catalog_changed';
  orderId: string | null;
  latestOrder: PaymentOrder | null;
};

export const paymentOrderConflictMessage = (conflict: UnsettledPaymentOrderConflict): string => {
  switch (conflict.code) {
    case 'payment_order_reconciliation_required':
      return '订单需要人工对账，请联系支持后再继续购买。';
    case 'payment_order_catalog_changed':
      return '套餐信息已更新，请联系客服确认原订单。';
    case 'payment_order_not_payable':
      return '订单状态已变化，无法继续打开收银台。';
    case 'payment_order_state_changed':
      return '订单状态已变化，已刷新购买上下文。请确认后再次点击购买。';
    case 'payment_catalog_changed':
      return '套餐价格/权益已更新，请确认后再次点击购买。';
    default:
      return '已有未结算订单，请先继续或查询。';
  }
};

export const requiresRepeatPurchaseAcknowledgement = (
  paymentStateToken: string,
  latestOrder: Pick<PaymentOrder, 'status'> | null,
  acknowledgedPaymentStateToken: string | null,
): boolean => (
  (latestOrder?.status === 'paid' || latestOrder?.status === 'fulfilled')
  && acknowledgedPaymentStateToken !== paymentStateToken
);

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null
);

export const resolveUnsettledPaymentOrderConflict = (
  error: unknown,
): UnsettledPaymentOrderConflict | null => {
  if (!isRecord(error) || !isRecord(error.response) || error.response.status !== 409) return null;
  const responseData = error.response.data;
  if (!isRecord(responseData) || !isRecord(responseData.detail)) return null;
  const { code, order_id: rawOrderId, latest_order: rawLatestOrder } = responseData.detail;
  if (
    code !== 'payment_order_unsettled'
    && code !== 'payment_order_reconciliation_required'
    && code !== 'payment_order_catalog_changed'
    && code !== 'payment_order_not_payable'
    && code !== 'payment_order_state_changed'
    && code !== 'payment_catalog_changed'
  ) return null;
  const orderId = typeof rawOrderId === 'string' ? rawOrderId.trim() : '';
  const latestOrder = isRecord(rawLatestOrder) && typeof rawLatestOrder.id === 'string'
    ? rawLatestOrder as unknown as PaymentOrder
    : null;
  return {
    code,
    orderId: orderId || latestOrder?.id || null,
    latestOrder,
  };
};

export const getOrCreatePurchaseIdempotencyKey = (
  keysBySku: Map<string, string>,
  sku: string,
  createKey: () => string,
): string => {
  const existingKey = keysBySku.get(sku);
  if (existingKey) return existingKey;
  const nextKey = createKey();
  keysBySku.set(sku, nextKey);
  return nextKey;
};

const FINAL_PAYMENT_ORDER_STATUSES = new Set<PaymentOrder['status']>([
  'fulfilled',
  'failed',
]);

export const clearMatchingTerminalPurchaseAttempt = (
  keysBySku: Map<string, string>,
  orderIdsBySku: Map<string, string>,
  order: Pick<PaymentOrder, 'id' | 'sku' | 'status'>,
): boolean => {
  if (!FINAL_PAYMENT_ORDER_STATUSES.has(order.status)) return false;
  if (orderIdsBySku.get(order.sku) !== order.id) return false;
  orderIdsBySku.delete(order.sku);
  keysBySku.delete(order.sku);
  return true;
};

export const appendPaymentOrderPage = (
  current: PaymentOrder[],
  page: PaymentOrder[],
): PaymentOrder[] => {
  const existingIds = new Set(current.map((order) => order.id));
  return [
    ...current,
    ...page.filter((order) => !existingIds.has(order.id)),
  ];
};

export const getOrderRefreshPageDepth = (loadedOrderCount: number, pageSize: number): number => {
  if (!Number.isFinite(loadedOrderCount) || !Number.isFinite(pageSize) || pageSize <= 0) return 1;
  return Math.max(1, Math.ceil(Math.max(loadedOrderCount, 0) / pageSize));
};

export const coordinatePaymentOrdersAndContextRefresh = async (
  loadOrders: () => Promise<boolean>,
  refreshPurchaseContext: () => Promise<unknown>,
  isCurrent: () => boolean = () => true,
): Promise<void> => {
  // Start the context request immediately so order-history failure cannot block
  // purchases. If history succeeds, reconcile once more after both initial
  // snapshots settle so its expiry/status transitions cannot leave a stale
  // context token or latest-order snapshot behind.
  const initialContextRequest = refreshPurchaseContext();
  const [ordersResult] = await Promise.allSettled([
    loadOrders(),
    initialContextRequest,
  ]);
  if (ordersResult.status === 'fulfilled' && ordersResult.value && isCurrent()) {
    await refreshPurchaseContext();
  }
};
