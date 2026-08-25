import apiClient, {
  assertAuthCacheKey,
  captureAuthCacheKey,
  type AuthOwnerOptions,
} from './apiClient';

export interface TokenQuotaSummary {
  user_id: string;
  token_limit: number;
  remaining_tokens: number;
  used_tokens: number;
  remaining_percent: number;
  is_unlimited: boolean;
  unlimited_expires_at?: string | null;
  unlimited_plan_name?: string | null;
  last_purchase_tokens?: number;
  last_purchase_at?: string | null;
  updated_at?: string | null;
}

export interface TokenUsageEvent {
  id: string;
  entrypoint: string;
  request_label: string;
  provider: string;
  model: string;
  status: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface TokenUsageAggregate {
  key: string;
  total_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
  count: number;
}

export interface TokenUsageListResponse {
  events: TokenUsageEvent[];
  usage_by_day: TokenUsageAggregate[];
  usage_by_entrypoint: TokenUsageAggregate[];
}

export interface TokenRedemptionResponse {
  tokens: number;
  package_name: string;
  summary: TokenQuotaSummary;
}

export type BillingProductCategory = 'tokens' | 'unlimited';

export interface BillingProduct {
  sku: string;
  name: string;
  description: string;
  amount_fen: number;
  currency: string;
  category: BillingProductCategory;
  token_amount?: number | null;
  unlimited_duration_days?: number | null;
}

export interface BillingProductsResponse {
  payments_enabled: boolean;
  catalog_version: string;
  products: BillingProduct[];
}

export type PaymentOrderStatus = 'pending' | 'paid' | 'fulfilled' | 'failed' | 'expired' | 'cancelled';
export type PaymentBenefitType = 'tokens' | 'unlimited_time';

export interface PaymentOrder {
  id: string;
  state_version: number;
  status: PaymentOrderStatus;
  sku: string;
  product_name?: string | null;
  amount_fen: number;
  currency: string;
  created_at: string;
  expires_at?: string | null;
  paid_at?: string | null;
  fulfilled_at?: string | null;
  cancelled_at?: string | null;
  benefit_type?: PaymentBenefitType | null;
  token_amount?: number | null;
  unlimited_duration_days?: number | null;
  description?: string | null;
  provider_trade_no?: string | null;
  summary?: TokenQuotaSummary | null;
  failure_reason?: string | null;
}

export interface PaymentCheckoutForm {
  order: PaymentOrder;
  action: string;
  method: 'POST';
  fields: Record<string, string>;
}

export interface PaymentOrderListResponse {
  items: PaymentOrder[];
  next_cursor: string | null;
  has_more: boolean;
}

export interface PaymentPurchaseContext {
  payment_state_token: string;
  latest_order: PaymentOrder | null;
}

type PaymentRequestOptions = AuthOwnerOptions & {
  signal?: AbortSignal;
};

const PAYMENT_REQUEST_TIMEOUT_MS = 15_000;

const BILLING_CACHE_TTL_MS = 10_000;

let quotaSummaryCache: { ownerKey: string; data: TokenQuotaSummary; fetchedAt: number } | null = null;
let quotaSummaryInFlight: Promise<TokenQuotaSummary> | null = null;
let quotaSummaryCacheOwnerKey: string | null = null;
let quotaSummaryCacheGeneration = 0;

const isSummaryFresh = (now: number) => {
  return quotaSummaryCache !== null && now - quotaSummaryCache.fetchedAt < BILLING_CACHE_TTL_MS;
};

export const clearBillingCache = () => {
  quotaSummaryCacheGeneration += 1;
  quotaSummaryCacheOwnerKey = null;
  quotaSummaryCache = null;
  quotaSummaryInFlight = null;
};

const ensureBillingCacheOwner = async (expectedAuthCacheKey?: string) => {
  const ownerKey = await captureAuthCacheKey(expectedAuthCacheKey);
  if (
    (quotaSummaryCacheOwnerKey !== null && quotaSummaryCacheOwnerKey !== ownerKey)
    || (quotaSummaryCache !== null && quotaSummaryCache.ownerKey !== ownerKey)
  ) {
    clearBillingCache();
  }
  quotaSummaryCacheOwnerKey = ownerKey;
  return ownerKey;
};

export const billingService = {
  async getProducts(options?: PaymentRequestOptions): Promise<BillingProductsResponse> {
    const response = await apiClient.get<BillingProductsResponse>('/api/billing/products', {
      signal: options?.signal,
      timeout: PAYMENT_REQUEST_TIMEOUT_MS,
      expectedAuthCacheKey: options?.expectedAuthCacheKey,
    });
    return response.data;
  },

  async getSummary(options?: PaymentRequestOptions & { force?: boolean }): Promise<TokenQuotaSummary> {
    const ownerKey = await ensureBillingCacheOwner(options?.expectedAuthCacheKey);
    const now = Date.now();
    if (!options?.force && isSummaryFresh(now) && quotaSummaryCache) {
      return quotaSummaryCache.data;
    }
    if (!options?.force && quotaSummaryInFlight) {
      return quotaSummaryInFlight;
    }

    const requestCacheGeneration = quotaSummaryCacheGeneration + 1;
    quotaSummaryCacheGeneration = requestCacheGeneration;
    const request = apiClient
      .get<TokenQuotaSummary>('/api/billing/summary', {
        signal: options?.signal,
        timeout: PAYMENT_REQUEST_TIMEOUT_MS,
        expectedAuthCacheKey: ownerKey,
      })
      .then(async (response) => {
        await assertAuthCacheKey(ownerKey);
        if (
          quotaSummaryCacheGeneration === requestCacheGeneration
          && quotaSummaryCacheOwnerKey === ownerKey
        ) {
          quotaSummaryCache = { ownerKey, data: response.data, fetchedAt: Date.now() };
        }
        return response.data;
      });
    quotaSummaryInFlight = request;
    try {
      return await request;
    } finally {
      if (quotaSummaryInFlight === request) {
        quotaSummaryInFlight = null;
      }
    }
  },

  async getUsage(limit = 50, options?: PaymentRequestOptions): Promise<TokenUsageListResponse> {
    const response = await apiClient.get<TokenUsageListResponse>('/api/billing/usage', {
      params: { limit },
      signal: options?.signal,
      timeout: PAYMENT_REQUEST_TIMEOUT_MS,
      expectedAuthCacheKey: options?.expectedAuthCacheKey,
    });
    return response.data;
  },

  async redeemCode(code: string, options?: PaymentRequestOptions): Promise<TokenRedemptionResponse> {
    const ownerKey = await captureAuthCacheKey(options?.expectedAuthCacheKey);
    const response = await apiClient.post<TokenRedemptionResponse>(
      '/api/billing/redemptions',
      { code },
      {
        expectedAuthCacheKey: ownerKey,
        signal: options?.signal,
        timeout: PAYMENT_REQUEST_TIMEOUT_MS,
      },
    );
    await assertAuthCacheKey(ownerKey);
    clearBillingCache();
    quotaSummaryCacheOwnerKey = ownerKey;
    quotaSummaryCache = { ownerKey, data: response.data.summary, fetchedAt: Date.now() };
    return response.data;
  },

  async createPaymentOrder(
    sku: string,
    idempotencyKey: string,
    expectedPaymentStateToken: string,
    expectedCatalogVersion: string,
    options?: PaymentRequestOptions,
  ): Promise<PaymentOrder> {
    const response = await apiClient.post<PaymentOrder>(
      '/api/billing/payment-orders',
      {
        sku,
        expected_payment_state_token: expectedPaymentStateToken,
        expected_catalog_version: expectedCatalogVersion,
      },
      {
        headers: { 'Idempotency-Key': idempotencyKey },
        signal: options?.signal,
        timeout: PAYMENT_REQUEST_TIMEOUT_MS,
        expectedAuthCacheKey: options?.expectedAuthCacheKey,
      },
    );
    return response.data;
  },

  async getPaymentCheckout(orderId: string, options?: PaymentRequestOptions): Promise<PaymentCheckoutForm> {
    const encodedOrderId = encodeURIComponent(orderId);
    const response = await apiClient.post<PaymentCheckoutForm>(
      `/api/billing/payment-orders/${encodedOrderId}/checkout`,
      undefined,
      {
        signal: options?.signal,
        timeout: PAYMENT_REQUEST_TIMEOUT_MS,
        expectedAuthCacheKey: options?.expectedAuthCacheKey,
      },
    );
    return response.data;
  },

  async getPaymentPurchaseContext(options?: PaymentRequestOptions): Promise<PaymentPurchaseContext> {
    const response = await apiClient.get<PaymentPurchaseContext>(
      '/api/billing/payment-orders/purchase-context',
      {
        signal: options?.signal,
        timeout: PAYMENT_REQUEST_TIMEOUT_MS,
        expectedAuthCacheKey: options?.expectedAuthCacheKey,
      },
    );
    return response.data;
  },

  async getPaymentOrder(orderId: string, options?: PaymentRequestOptions): Promise<PaymentOrder> {
    const encodedOrderId = encodeURIComponent(orderId);
    const response = await apiClient.get<PaymentOrder>(
      `/api/billing/payment-orders/${encodedOrderId}`,
      {
        signal: options?.signal,
        timeout: PAYMENT_REQUEST_TIMEOUT_MS,
        expectedAuthCacheKey: options?.expectedAuthCacheKey,
      },
    );
    return response.data;
  },

  async listPaymentOrders(limit = 20, cursor?: string | null, options?: PaymentRequestOptions): Promise<PaymentOrderListResponse> {
    const response = await apiClient.get<PaymentOrderListResponse>('/api/billing/payment-orders', {
      params: { limit, ...(cursor ? { cursor } : {}) },
      signal: options?.signal,
      timeout: PAYMENT_REQUEST_TIMEOUT_MS,
      expectedAuthCacheKey: options?.expectedAuthCacheKey,
    });
    return response.data;
  },

  async cancelPaymentOrder(orderId: string, options?: PaymentRequestOptions): Promise<PaymentOrder> {
    const encodedOrderId = encodeURIComponent(orderId);
    const response = await apiClient.post<PaymentOrder>(
      `/api/billing/payment-orders/${encodedOrderId}/cancel`,
      undefined,
      {
        signal: options?.signal,
        timeout: PAYMENT_REQUEST_TIMEOUT_MS,
        expectedAuthCacheKey: options?.expectedAuthCacheKey,
      },
    );
    return response.data;
  },

  async syncPaymentOrder(orderId: string, options?: PaymentRequestOptions): Promise<PaymentOrder> {
    const encodedOrderId = encodeURIComponent(orderId);
    const response = await apiClient.post<PaymentOrder>(
      `/api/billing/payment-orders/${encodedOrderId}/sync`,
      undefined,
      {
        signal: options?.signal,
        timeout: PAYMENT_REQUEST_TIMEOUT_MS,
        expectedAuthCacheKey: options?.expectedAuthCacheKey,
      },
    );
    return response.data;
  },

  clearBillingCache,
};
