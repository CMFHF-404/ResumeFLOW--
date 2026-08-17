import React from 'react';
import {
  billingService,
  type PaymentOrder,
} from '../services/billingService';
import {
  createPaymentOrderRequestController,
  type PaymentOrderActionRequest,
  type PaymentOrderLoadOptions,
  type PaymentOrderRequestController,
} from './paymentOrderRequestController';
import { runPaymentOrderListLoad } from './paymentOrderListLoader';
import { appendPaymentOrderPage } from './tokenQuotaOrderUtils';

const PAYMENT_ORDER_PAGE_SIZE = 20;

export type UsePaymentOrdersControllerResult = {
  orders: PaymentOrder[];
  ordersHasMore: boolean;
  isLoadingOrders: boolean;
  isLoadingMoreOrders: boolean;
  ordersError: string;
  orderActionId: string | null;
  ordersNow: number;
  loadOrders(options?: PaymentOrderLoadOptions): Promise<boolean>;
  invalidateOrderLoadRequests(): void;
  rememberOrderForCheckoutRecovery(order: PaymentOrder): void;
  setOrdersError(message: string): void;
  touchOrdersNow(): void;
  markOrderAction(orderId: string): void;
  beginOrderAction(): PaymentOrderActionRequest | null;
  isOrderActionCurrent(request: PaymentOrderActionRequest): boolean;
  finishOrderAction(request: PaymentOrderActionRequest): void;
  invalidateOrderAction(): void;
};

export const usePaymentOrdersController = (
  onOrderObserved: (order: PaymentOrder) => void,
): UsePaymentOrdersControllerResult => {
  const controllerRef = React.useRef<PaymentOrderRequestController | null>(null);
  if (controllerRef.current === null) {
    controllerRef.current = createPaymentOrderRequestController();
  }
  const controller = controllerRef.current;
  const onOrderObservedRef = React.useRef(onOrderObserved);
  onOrderObservedRef.current = onOrderObserved;

  const [orders, setOrders] = React.useState<PaymentOrder[]>([]);
  const [ordersHasMore, setOrdersHasMore] = React.useState(false);
  const [isLoadingOrders, setIsLoadingOrders] = React.useState(false);
  const [isLoadingMoreOrders, setIsLoadingMoreOrders] = React.useState(false);
  const [ordersError, setOrdersError] = React.useState('');
  const [orderActionId, setOrderActionId] = React.useState<string | null>(null);
  const [ordersNow, setOrdersNow] = React.useState(() => Date.now());

  const invalidateOrderLoadRequests = React.useCallback(() => {
    controller.invalidateLoads();
    setIsLoadingOrders(false);
    setIsLoadingMoreOrders(false);
  }, [controller]);

  const rememberOrderForCheckoutRecovery = React.useCallback((nextOrder: PaymentOrder) => {
    onOrderObservedRef.current(nextOrder);
    setOrders((current) => {
      const exists = current.some((order) => order.id === nextOrder.id);
      const next = exists
        ? current.map((order) => order.id === nextOrder.id ? { ...order, ...nextOrder } : order)
        : [nextOrder, ...current];
      if (!exists) controller.recordLoadedCount(next.length);
      return next;
    });
  }, [controller]);

  const loadOrders = React.useCallback(async (
    options?: PaymentOrderLoadOptions,
  ): Promise<boolean> => runPaymentOrderListLoad({
    controller,
    options,
    pageSize: PAYMENT_ORDER_PAGE_SIZE,
    fetchPage: (limit, cursor, signal) => billingService.listPaymentOrders(
      limit,
      cursor,
      { signal },
    ),
    onStart: (mode) => {
      mode === 'append' ? setIsLoadingMoreOrders(true) : setIsLoadingOrders(true);
    },
    onOrderObserved: (order) => onOrderObservedRef.current(order),
    onSuccess: ({ mode, items, response }) => {
      setOrdersError('');
      if (mode === 'append') {
        setOrders((current) => {
          const next = appendPaymentOrderPage(current, items);
          controller.recordLoadedCount(next.length);
          return next;
        });
      } else {
        controller.recordLoadedCount(items.length);
        setOrders(items);
      }
      controller.recordNextCursor(response.next_cursor);
      setOrdersHasMore(response.has_more);
      setOrdersNow(Date.now());
    },
    onError: (error) => {
      console.warn('Failed to load payment orders', error);
      setOrdersError('订单加载失败，请稍后重试。');
    },
    onFinish: (finishedMode) => {
      if (finishedMode === 'append') {
        setIsLoadingMoreOrders(false);
      } else if (finishedMode === 'replace') {
        setIsLoadingOrders(false);
      }
    },
  }), [controller]);

  const beginOrderAction = React.useCallback(() => {
    const request = controller.beginAction();
    if (request !== null) {
      setIsLoadingOrders(false);
      setIsLoadingMoreOrders(false);
    }
    return request;
  }, [controller]);

  const isOrderActionCurrent = React.useCallback(
    (request: PaymentOrderActionRequest) => controller.isActionCurrent(request),
    [controller],
  );

  const finishOrderAction = React.useCallback((request: PaymentOrderActionRequest) => {
    if (controller.finishAction(request)) {
      setOrderActionId(null);
    }
  }, [controller]);

  const invalidateOrderAction = React.useCallback(() => {
    controller.invalidateAction();
    setOrderActionId(null);
  }, [controller]);

  const touchOrdersNow = React.useCallback(() => {
    setOrdersNow(Date.now());
  }, []);

  const markOrderAction = React.useCallback((orderId: string) => {
    setOrderActionId(orderId);
  }, []);

  return {
    orders,
    ordersHasMore,
    isLoadingOrders,
    isLoadingMoreOrders,
    ordersError,
    orderActionId,
    ordersNow,
    loadOrders,
    invalidateOrderLoadRequests,
    rememberOrderForCheckoutRecovery,
    setOrdersError,
    touchOrdersNow,
    markOrderAction,
    beginOrderAction,
    isOrderActionCurrent,
    finishOrderAction,
    invalidateOrderAction,
  };
};
