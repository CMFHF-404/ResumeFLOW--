import { downloadBlobFile } from './downloadBlobFile';
import { getApiBaseUrl } from '../services/apiClient';

const FALLBACK_DOWNLOAD_ERROR_MESSAGE = 'PDF 下载失败，请稍后重试。';

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

const readDownloadErrorMessage = async (response: Response): Promise<string> => {
  const contentType = response.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    try {
      const payload = await response.json() as {
        detail?: unknown;
        error?: { message?: unknown };
      };
      const detailMessage = extractDetailMessage(payload.detail);
      if (detailMessage) {
        return detailMessage;
      }
      if (typeof payload.error?.message === 'string' && payload.error.message.trim()) {
        return payload.error.message.trim();
      }
    } catch {
      return FALLBACK_DOWNLOAD_ERROR_MESSAGE;
    }
  }

  try {
    const text = await response.text();
    if (text.trim()) {
      return text.trim();
    }
  } catch {
    return FALLBACK_DOWNLOAD_ERROR_MESSAGE;
  }

  return FALLBACK_DOWNLOAD_ERROR_MESSAGE;
};

const decodeFileName = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const resolveDownloadFileName = (
  contentDisposition: string | null,
  fallbackFileName?: string
) => {
  if (contentDisposition) {
    const utf8Match = contentDisposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
    if (utf8Match?.[1]) {
      return decodeFileName(utf8Match[1]);
    }

    const quotedMatch = contentDisposition.match(/filename\s*=\s*"([^"]+)"/i);
    if (quotedMatch?.[1]) {
      return quotedMatch[1];
    }

    const plainMatch = contentDisposition.match(/filename\s*=\s*([^;]+)/i);
    if (plainMatch?.[1]) {
      return plainMatch[1].trim();
    }
  }

  return fallbackFileName || 'resume-export.pdf';
};

const joinUrl = (base: string, path: string) => (
  `${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`
);

const parseUrl = (value: string): URL | null => {
  try {
    return new URL(value);
  } catch {
    return null;
  }
};

const resolveDownloadRequestUrl = (url: string) => {
  const parsedUrl = parseUrl(url);
  const requestPath = parsedUrl ? `${parsedUrl.pathname}${parsedUrl.search}` : url;
  const apiBaseUrl = getApiBaseUrl().trim();

  if (!apiBaseUrl) {
    return parsedUrl ? url : requestPath;
  }

  return joinUrl(apiBaseUrl, requestPath);
};

export const downloadUrlFile = async (
  url: string,
  fallbackFileName?: string
): Promise<void> => {
  const response = await fetch(resolveDownloadRequestUrl(url), { method: 'GET' });

  if (!response.ok) {
    throw new Error(await readDownloadErrorMessage(response));
  }

  const fileName = resolveDownloadFileName(
    response.headers.get('Content-Disposition'),
    fallbackFileName
  );
  const blob = await response.blob();
  downloadBlobFile(blob, fileName);
};
