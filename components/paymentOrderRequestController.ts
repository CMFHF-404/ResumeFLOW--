import { getOrderRefreshPageDepth } from './tokenQuotaOrderUtils';

export type PaymentOrderLoadOptions = {
  append?: boolean;
  replayLoadedDepth?: boolean;
};

export type PaymentOrderLoadRequest = Readonly<{
  mode: 'replace' | 'append';
  generation: number;
  cursor: string | null;
  replayPageDepth: number;
  abortController: AbortController;
}>;

export type PaymentOrderActionRequest = Readonly<{
  generation: number;
  abortController: AbortController;
}>;

export type PaymentOrderRequestController = {
  beginLoad(
    options: Required<PaymentOrderLoadOptions>,
    pageSize: number,
  ): PaymentOrderLoadRequest | null;
  isLoadCurrent(request: PaymentOrderLoadRequest): boolean;
  finishLoad(request: PaymentOrderLoadRequest): 'replace' | 'append' | null;
  invalidateLoads(): void;
  recordLoadedCount(count: number): void;
  recordNextCursor(cursor: string | null): void;
  beginAction(): PaymentOrderActionRequest | null;
  isActionCurrent(request: PaymentOrderActionRequest): boolean;
  finishAction(request: PaymentOrderActionRequest): boolean;
  invalidateAction(): void;
};

class DefaultPaymentOrderRequestController implements PaymentOrderRequestController {
  private ordersCursor: string | null = null;
  private loadedOrderCount = 0;
  private ordersRequestGeneration = 0;
  private ordersLoadRequestGeneration: number | null = null;
  private ordersLoadMoreRequestGeneration: number | null = null;
  private readonly ordersAbortControllers = new Set<AbortController>();
  private orderActionInFlight = false;
  private orderActionGeneration = 0;
  private orderActionAbortController: AbortController | null = null;

  beginLoad(
    options: Required<PaymentOrderLoadOptions>,
    pageSize: number,
  ): PaymentOrderLoadRequest | null {
    if (this.orderActionInFlight) return null;

    const append = Boolean(options.append);
    const cursor = append ? this.ordersCursor : null;
    if (append && !cursor) return null;
    if (this.ordersLoadRequestGeneration !== null || this.ordersLoadMoreRequestGeneration !== null) {
      return null;
    }

    const generation = append
      ? this.ordersRequestGeneration
      : this.ordersRequestGeneration + 1;
    if (!append) this.ordersRequestGeneration = generation;
    if (append) this.ordersLoadMoreRequestGeneration = generation;
    else this.ordersLoadRequestGeneration = generation;

    const abortController = new AbortController();
    this.ordersAbortControllers.add(abortController);
    return {
      mode: append ? 'append' : 'replace',
      generation,
      cursor,
      replayPageDepth: options.replayLoadedDepth
        ? getOrderRefreshPageDepth(this.loadedOrderCount, pageSize)
        : 1,
      abortController,
    };
  }

  isLoadCurrent(request: PaymentOrderLoadRequest): boolean {
    return request.generation === this.ordersRequestGeneration;
  }

  finishLoad(request: PaymentOrderLoadRequest): 'replace' | 'append' | null {
    this.ordersAbortControllers.delete(request.abortController);
    if (
      request.mode === 'append'
      && this.ordersLoadMoreRequestGeneration === request.generation
    ) {
      this.ordersLoadMoreRequestGeneration = null;
      return 'append';
    }
    if (
      request.mode === 'replace'
      && this.ordersLoadRequestGeneration === request.generation
    ) {
      this.ordersLoadRequestGeneration = null;
      return 'replace';
    }
    return null;
  }

  invalidateLoads(): void {
    this.ordersRequestGeneration += 1;
    this.ordersAbortControllers.forEach((controller) => controller.abort());
    this.ordersAbortControllers.clear();
    this.ordersLoadRequestGeneration = null;
    this.ordersLoadMoreRequestGeneration = null;
  }

  recordLoadedCount(count: number): void {
    this.loadedOrderCount = count;
  }

  recordNextCursor(cursor: string | null): void {
    this.ordersCursor = cursor;
  }

  beginAction(): PaymentOrderActionRequest | null {
    if (this.orderActionInFlight) return null;
    this.orderActionInFlight = true;
    const generation = this.orderActionGeneration + 1;
    this.orderActionGeneration = generation;
    this.orderActionAbortController?.abort();
    const abortController = new AbortController();
    this.orderActionAbortController = abortController;
    this.invalidateLoads();
    return { generation, abortController };
  }

  isActionCurrent(request: PaymentOrderActionRequest): boolean {
    return this.orderActionInFlight && this.orderActionGeneration === request.generation;
  }

  finishAction(request: PaymentOrderActionRequest): boolean {
    if (!this.isActionCurrent(request)) return false;
    this.orderActionInFlight = false;
    this.orderActionAbortController = null;
    return true;
  }

  invalidateAction(): void {
    this.orderActionGeneration += 1;
    this.orderActionAbortController?.abort();
    this.orderActionAbortController = null;
    this.orderActionInFlight = false;
  }
}

export const createPaymentOrderRequestController = (): PaymentOrderRequestController => (
  new DefaultPaymentOrderRequestController()
);
