import axios, { type AxiosResponse } from 'axios';
import apiClient, { getAuthCacheKey } from './apiClient';
import type { ResumePdfRenderSnapshot } from '../types/resume';
import type { ExperienceBankPdfRenderSnapshot } from '../types/experienceBankExport';

type ResumeRenderSnapshotResponse = {
  snapshot: ResumePdfRenderSnapshot;
};

type ExperienceBankRenderSnapshotResponse = {
  snapshot: ExperienceBankPdfRenderSnapshot;
};

type ExportDownloadLinkResponse = {
  downloadUrl: string;
  fileName: string;
};

export type ExportAuthOptions = {
  expectedAuthCacheKey?: string;
};

export class ExportAuthContextChangedError extends Error {
  constructor() {
    super('Authentication context changed during export');
    this.name = 'ExportAuthContextChangedError';
  }
}

const FALLBACK_EXPORT_ERROR_MESSAGE = 'PDF 导出准备失败，请稍后重试。';
const FALLBACK_SNAPSHOT_ERROR_MESSAGE = '导出快照加载失败，请重新发起导出。';

const toUnicodeEscape = (value: number) => `\\u${value.toString(16).padStart(4, '0')}`;

const escapeNonAsciiChar = (char: string) => {
  const codePoint = char.codePointAt(0);
  if (codePoint === undefined) {
    return char;
  }

  if (codePoint <= 0xffff) {
    return toUnicodeEscape(codePoint);
  }

  const normalized = codePoint - 0x10000;
  const highSurrogate = 0xd800 + (normalized >> 10);
  const lowSurrogate = 0xdc00 + (normalized & 0x3ff);
  return `${toUnicodeEscape(highSurrogate)}${toUnicodeEscape(lowSurrogate)}`;
};

const stringifyAsciiSafeJson = (value: unknown) => (
  JSON.stringify(value).replace(/[^\u0000-\u007f]/g, (char) => escapeNonAsciiChar(char))
);

const extractDetailMessage = (detail: unknown): string | null => {
  if (typeof detail === 'string' && detail.trim()) {
    return detail.trim();
  }

  if (!detail || typeof detail !== 'object') {
    return null;
  }

  const record = detail as { message?: unknown };
  if (typeof record.message === 'string' && record.message.trim()) {
    return record.message.trim();
  }

  return null;
};

const parseErrorPayload = async (payload: unknown): Promise<string | null> => {
  if (!payload) {
    return null;
  }

  if (payload instanceof Blob) {
    const text = await payload.text();
    if (!text.trim()) {
      return null;
    }
    try {
      const parsed = JSON.parse(text) as { detail?: unknown; error?: { message?: unknown } };
      const detailMessage = extractDetailMessage(parsed.detail);
      if (detailMessage) {
        return detailMessage;
      }
      if (typeof parsed.error?.message === 'string' && parsed.error.message.trim()) {
        return parsed.error.message.trim();
      }
      return text.trim();
    } catch (error) {
      return text.trim();
    }
  }

  if (typeof payload === 'string' && payload.trim()) {
    return payload.trim();
  }

  if (typeof payload === 'object') {
    const record = payload as { detail?: unknown; error?: { message?: unknown } };
    const detailMessage = extractDetailMessage(record.detail);
    if (detailMessage) {
      return detailMessage;
    }
    if (typeof record.error?.message === 'string' && record.error.message.trim()) {
      return record.error.message.trim();
    }
  }

  return null;
};

const normalizeAxiosError = async (
  error: unknown,
  fallbackMessage: string
): Promise<never> => {
  if (!axios.isAxiosError(error)) {
    if (error instanceof Error && error.message) {
      throw error;
    }
    throw new Error(fallbackMessage);
  }

  const parsedMessage = await parseErrorPayload(error.response?.data);
  throw new Error(parsedMessage || error.message || fallbackMessage);
};

const assertExportAuthContext = async (expectedAuthCacheKey?: string) => {
  if (expectedAuthCacheKey && await getAuthCacheKey() !== expectedAuthCacheKey) {
    throw new ExportAuthContextChangedError();
  }
};

const getRenderSnapshotResponse = async <T>(
  path: string,
  token?: string,
  options?: ExportAuthOptions,
) => {
  await assertExportAuthContext(options?.expectedAuthCacheKey);
  let response: AxiosResponse<T>;
  if (token) {
    // Explicit legacy callers retain the original query-token contract. Use a
    // bare Axios request so apiClient's Logto interceptor cannot add a second,
    // conflicting Authorization credential.
    response = await axios.get<T>(path, {
      baseURL: apiClient.defaults.baseURL,
      params: { token },
    });
  } else {
    response = await apiClient.get<T>(path, options?.expectedAuthCacheKey
      ? { expectedAuthCacheKey: options.expectedAuthCacheKey }
      : undefined);
  }
  await assertExportAuthContext(options?.expectedAuthCacheKey);
  return response;
};

export const exportService = {
  async createResumePdfDownloadLink(
    snapshot: ResumePdfRenderSnapshot,
    fileName?: string,
    options?: ExportAuthOptions,
  ): Promise<ExportDownloadLinkResponse> {
    try {
      await assertExportAuthContext(options?.expectedAuthCacheKey);
      const body = stringifyAsciiSafeJson({ snapshot, fileName });
      const response = await apiClient.post<ExportDownloadLinkResponse>(
        '/exports/resume-pdf-link',
        body,
        {
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'X-ResumeFlow-Export-Mode': 'authenticated-v2',
          },
          ...(options?.expectedAuthCacheKey
            ? { expectedAuthCacheKey: options.expectedAuthCacheKey }
            : {}),
        }
      );
      await assertExportAuthContext(options?.expectedAuthCacheKey);
      return response.data;
    } catch (error) {
      await normalizeAxiosError(error, FALLBACK_EXPORT_ERROR_MESSAGE);
    }
  },

  async getRenderSnapshot(
    exportId: string,
    token?: string,
    options?: ExportAuthOptions,
  ): Promise<ResumeRenderSnapshotResponse> {
    try {
      const response = await getRenderSnapshotResponse<ResumeRenderSnapshotResponse>(
        `/exports/render-snapshots/${encodeURIComponent(exportId)}`,
        token,
        options,
      );
      return response.data;
    } catch (error) {
      await normalizeAxiosError(error, FALLBACK_SNAPSHOT_ERROR_MESSAGE);
    }
  },

  async createExperienceBankPdfDownloadLink(
    snapshot: ExperienceBankPdfRenderSnapshot,
    fileName?: string,
    options?: ExportAuthOptions,
  ): Promise<ExportDownloadLinkResponse> {
    try {
      await assertExportAuthContext(options?.expectedAuthCacheKey);
      const body = stringifyAsciiSafeJson({ snapshot, fileName });
      const response = await apiClient.post<ExportDownloadLinkResponse>(
        '/exports/experience-bank-pdf-link',
        body,
        {
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'X-ResumeFlow-Export-Mode': 'authenticated-v2',
          },
          ...(options?.expectedAuthCacheKey
            ? { expectedAuthCacheKey: options.expectedAuthCacheKey }
            : {}),
        }
      );
      await assertExportAuthContext(options?.expectedAuthCacheKey);
      return response.data;
    } catch (error) {
      await normalizeAxiosError(error, FALLBACK_EXPORT_ERROR_MESSAGE);
    }
  },

  async getExperienceBankRenderSnapshot(
    exportId: string,
    token?: string,
    options?: ExportAuthOptions,
  ): Promise<ExperienceBankRenderSnapshotResponse> {
    try {
      const response = await getRenderSnapshotResponse<ExperienceBankRenderSnapshotResponse>(
        `/exports/experience-bank-render-snapshots/${encodeURIComponent(exportId)}`,
        token,
        options,
      );
      return response.data;
    } catch (error) {
      await normalizeAxiosError(error, FALLBACK_SNAPSHOT_ERROR_MESSAGE);
    }
  },
};
