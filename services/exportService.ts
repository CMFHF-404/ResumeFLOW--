import axios from 'axios';
import apiClient from './apiClient';
import type { ResumePdfRenderSnapshot } from '../types/resume';
import type { ExperienceBankPdfRenderSnapshot } from '../types/experienceBankExport';

type ResumeRenderSnapshotResponse = {
  snapshot: ResumePdfRenderSnapshot;
};

type ExperienceBankRenderSnapshotResponse = {
  snapshot: ExperienceBankPdfRenderSnapshot;
};

const FALLBACK_EXPORT_ERROR_MESSAGE = 'PDF 导出失败，请稍后重试。';
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

export const exportService = {
  async exportResumePdf(
    snapshot: ResumePdfRenderSnapshot,
    fileName?: string
  ): Promise<Blob> {
    try {
      const body = stringifyAsciiSafeJson({ snapshot, fileName });
      const response = await apiClient.post<Blob>(
        '/exports/resume-pdf',
        body,
        {
          responseType: 'blob',
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
          },
        }
      );
      return response.data;
    } catch (error) {
      await normalizeAxiosError(error, FALLBACK_EXPORT_ERROR_MESSAGE);
    }
  },

  async getRenderSnapshot(
    exportId: string,
    token: string
  ): Promise<ResumeRenderSnapshotResponse> {
    try {
      const response = await apiClient.get<ResumeRenderSnapshotResponse>(
        `/exports/render-snapshots/${encodeURIComponent(exportId)}`,
        { params: { token } }
      );
      return response.data;
    } catch (error) {
      await normalizeAxiosError(error, FALLBACK_SNAPSHOT_ERROR_MESSAGE);
    }
  },

  async exportExperienceBankPdf(
    snapshot: ExperienceBankPdfRenderSnapshot,
    fileName?: string
  ): Promise<Blob> {
    try {
      const body = stringifyAsciiSafeJson({ snapshot, fileName });
      const response = await apiClient.post<Blob>(
        '/exports/experience-bank-pdf',
        body,
        {
          responseType: 'blob',
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
          },
        }
      );
      return response.data;
    } catch (error) {
      await normalizeAxiosError(error, FALLBACK_EXPORT_ERROR_MESSAGE);
    }
  },

  async getExperienceBankRenderSnapshot(
    exportId: string,
    token: string
  ): Promise<ExperienceBankRenderSnapshotResponse> {
    try {
      const response = await apiClient.get<ExperienceBankRenderSnapshotResponse>(
        `/exports/experience-bank-render-snapshots/${encodeURIComponent(exportId)}`,
        { params: { token } }
      );
      return response.data;
    } catch (error) {
      await normalizeAxiosError(error, FALLBACK_SNAPSHOT_ERROR_MESSAGE);
    }
  },
};
