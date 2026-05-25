import type { AssistantDraftCard } from '../../services/aiService';

const clipLogText = (value: unknown, limit = 240) => {
  if (typeof value !== 'string') {
    return value;
  }
  return value.length > limit ? `${value.slice(0, limit)}...` : value;
};

const readErrorDetail = (payload: unknown): string | null => {
  if (typeof payload === 'string' && payload.trim()) {
    return payload.trim();
  }
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const record = payload as { detail?: unknown; message?: unknown; error?: unknown };
  const detail = record.detail ?? record.message ?? record.error;
  if (typeof detail === 'string' && detail.trim()) {
    return detail.trim();
  }
  if (Array.isArray(detail) || (detail && typeof detail === 'object')) {
    try {
      return JSON.stringify(detail);
    } catch {
      return String(detail);
    }
  }
  return null;
};

export const extractApplyErrorDetails = (applyError: unknown) => {
  const maybeError = applyError as {
    message?: unknown;
    code?: unknown;
    response?: { status?: number; data?: unknown };
    config?: { method?: string; url?: string };
  };
  const status = maybeError.response?.status;
  const detail = readErrorDetail(maybeError.response?.data);
  const message = typeof maybeError.message === 'string' ? maybeError.message : null;
  const userMessage = detail || (status ? `HTTP ${status}` : null) || message || '未知错误';
  return {
    userMessage,
    status,
    detail: clipLogText(detail),
    message: clipLogText(message),
    code: typeof maybeError.code === 'string' ? maybeError.code : undefined,
    method: maybeError.config?.method,
    url: maybeError.config?.url,
    responseData: maybeError.response?.data,
  };
};

export const summarizeDraftForLog = (card: AssistantDraftCard) => {
  if (card.type !== 'experience') {
    return {
      type: card.type,
      status: card.status,
      hasSummary: Boolean(card.summary?.trim()),
    };
  }
  return {
    type: card.type,
    status: card.status,
    hasSummary: Boolean(card.summary?.trim()),
    category: card.data.category,
    hasTargetMasterId: Boolean(card.data.targetMasterId?.trim()),
    hasOrg: Boolean(card.data.org.trim()),
    hasTitle: Boolean(card.data.title.trim()),
    hasStartDate: Boolean(card.data.startDate.trim()),
    hasEndDate: Boolean(card.data.endDate.trim()),
    isCurrent: card.data.isCurrent,
  };
};
