import axios from 'axios';
import apiClient from './apiClient';
import type { ResumePdfRenderSnapshot } from '../types/resume';

type RenderSnapshotResponse = {
  snapshot: ResumePdfRenderSnapshot;
};

const FALLBACK_EXPORT_ERROR_MESSAGE = 'PDF 导出失败，请稍后重试。';
const FALLBACK_SNAPSHOT_ERROR_MESSAGE = '导出快照加载失败，请重新发起导出。';

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
      if (typeof parsed.detail === 'string' && parsed.detail.trim()) {
        return parsed.detail.trim();
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
    if (typeof record.detail === 'string' && record.detail.trim()) {
      return record.detail.trim();
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
      const response = await apiClient.post<Blob>(
        '/exports/resume-pdf',
        { snapshot, fileName },
        { responseType: 'blob' }
      );
      return response.data;
    } catch (error) {
      await normalizeAxiosError(error, FALLBACK_EXPORT_ERROR_MESSAGE);
    }
  },

  async getRenderSnapshot(
    exportId: string,
    token: string
  ): Promise<RenderSnapshotResponse> {
    try {
      const response = await apiClient.get<RenderSnapshotResponse>(
        `/exports/render-snapshots/${encodeURIComponent(exportId)}`,
        { params: { token } }
      );
      return response.data;
    } catch (error) {
      await normalizeAxiosError(error, FALLBACK_SNAPSHOT_ERROR_MESSAGE);
    }
  },
};
