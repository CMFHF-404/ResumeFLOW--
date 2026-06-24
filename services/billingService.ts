import apiClient, { getAuthCacheKey } from './apiClient';

export interface TokenQuotaSummary {
  user_id: string;
  token_limit: number;
  remaining_tokens: number;
  used_tokens: number;
  remaining_percent: number;
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

export interface TokenPurchaseOption {
  id: string;
  label: string;
  tokens: number;
  price_label: string;
  is_placeholder: boolean;
  description?: string;
}

export interface TokenPurchaseResponse {
  summary: TokenQuotaSummary;
  purchase: {
    id: string;
    option_id: string;
    label: string;
    tokens: number;
    status: string;
    before_remaining_tokens: number;
    after_remaining_tokens: number;
    before_token_limit: number;
    after_token_limit: number;
    created_at: string;
  };
}

const BILLING_CACHE_TTL_MS = 10_000;

let quotaSummaryCache: { ownerKey: string; data: TokenQuotaSummary; fetchedAt: number } | null = null;
let quotaSummaryInFlight: Promise<TokenQuotaSummary> | null = null;

const isSummaryFresh = (now: number) => {
  return quotaSummaryCache !== null && now - quotaSummaryCache.fetchedAt < BILLING_CACHE_TTL_MS;
};

export const clearBillingCache = () => {
  quotaSummaryCache = null;
  quotaSummaryInFlight = null;
};

const ensureBillingCacheOwner = async () => {
  const ownerKey = await getAuthCacheKey();
  if (quotaSummaryCache && quotaSummaryCache.ownerKey !== ownerKey) {
    clearBillingCache();
  }
  return ownerKey;
};

export const billingService = {
  async getSummary(options?: { force?: boolean }): Promise<TokenQuotaSummary> {
    const ownerKey = await ensureBillingCacheOwner();
    const now = Date.now();
    if (!options?.force && isSummaryFresh(now) && quotaSummaryCache) {
      return quotaSummaryCache.data;
    }
    if (!options?.force && quotaSummaryInFlight) {
      return quotaSummaryInFlight;
    }

    const request = apiClient
      .get<TokenQuotaSummary>('/api/billing/summary')
      .then((response) => {
        quotaSummaryCache = { ownerKey, data: response.data, fetchedAt: Date.now() };
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

  async getUsage(limit = 50): Promise<TokenUsageListResponse> {
    const response = await apiClient.get<TokenUsageListResponse>('/api/billing/usage', {
      params: { limit },
    });
    return response.data;
  },

  async getPurchaseOptions(): Promise<TokenPurchaseOption[]> {
    const response = await apiClient.get<TokenPurchaseOption[]>('/api/billing/purchases/options');
    return response.data;
  },

  async createPlaceholderPurchase(optionId: string): Promise<TokenPurchaseResponse> {
    const response = await apiClient.post<TokenPurchaseResponse>('/api/billing/purchases', {
      option_id: optionId,
    });
    const ownerKey = await getAuthCacheKey();
    quotaSummaryCache = { ownerKey, data: response.data.summary, fetchedAt: Date.now() };
    return response.data;
  },

  clearBillingCache,
};
