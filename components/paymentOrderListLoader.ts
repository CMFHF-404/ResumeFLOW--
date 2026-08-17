import type {
  PaymentOrder,
  PaymentOrderListResponse,
} from '../services/billingService';
import {
  type PaymentOrderLoadOptions,
  type PaymentOrderRequestController,
} from './paymentOrderRequestController';
import { appendPaymentOrderPage } from './tokenQuotaOrderUtils';

type PaymentOrderListLoaderCallbacks = {
  onStart(mode: 'replace' | 'append'): void;
  onOrderObserved(order: PaymentOrder): void;
  onSuccess(result: {
    mode: 'replace' | 'append';
    items: PaymentOrder[];
    response: PaymentOrderListResponse;
  }): void;
  onError(error: unknown): void;
  onFinish(mode: 'replace' | 'append' | null): void;
};

export type RunPaymentOrderListLoadOptions = PaymentOrderListLoaderCallbacks & {
  controller: PaymentOrderRequestController;
  options?: PaymentOrderLoadOptions;
  pageSize: number;
  fetchPage: (
    limit: number,
    cursor: string | null,
    signal: AbortSignal,
  ) => Promise<PaymentOrderListResponse>;
};

export const runPaymentOrderListLoad = async ({
  controller,
  options,
  pageSize,
  fetchPage,
  onStart,
  onOrderObserved,
  onSuccess,
  onError,
  onFinish,
}: RunPaymentOrderListLoadOptions): Promise<boolean> => {
  const request = controller.beginLoad({
    append: Boolean(options?.append),
    replayLoadedDepth: Boolean(options?.replayLoadedDepth),
  }, pageSize);
  if (request === null) return false;

  const append = request.mode === 'append';
  onStart(request.mode);
  try {
    let cursor = request.cursor;
    let response = await fetchPage(
      pageSize,
      cursor,
      request.abortController.signal,
    );
    let items = response.items;
    let loadedPages = 1;
    while (
      !append
      && loadedPages < request.replayPageDepth
      && response.has_more
      && response.next_cursor
    ) {
      if (!controller.isLoadCurrent(request)) return false;
      cursor = response.next_cursor;
      response = await fetchPage(
        pageSize,
        cursor,
        request.abortController.signal,
      );
      items = appendPaymentOrderPage(items, response.items);
      loadedPages += 1;
    }
    if (!controller.isLoadCurrent(request)) return false;

    items.forEach(onOrderObserved);
    onSuccess({ mode: request.mode, items, response });
    return true;
  } catch (error) {
    if (!controller.isLoadCurrent(request) || request.abortController.signal.aborted) {
      return false;
    }
    onError(error);
    return false;
  } finally {
    onFinish(controller.finishLoad(request));
  }
};
