import { downloadBlobFile } from './downloadBlobFile';
import {
  getApiBaseUrl,
  getAuthCacheKey,
  getAuthorizationHeader,
} from '../services/apiClient';

const FALLBACK_DOWNLOAD_ERROR_MESSAGE = 'PDF 下载失败，请稍后重试。';
const AUTH_CONTEXT_CHANGED_MESSAGE = 'Authentication context changed during export';

const assertDownloadAuthContext = async (expectedAuthCacheKey?: string) => {
  if (expectedAuthCacheKey && await getAuthCacheKey() !== expectedAuthCacheKey) {
    throw new Error(AUTH_CONTEXT_CHANGED_MESSAGE);
  }
};

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

const hasSingleLegacyDownloadToken = (value: string) => {
  try {
    const parsedUrl = new URL(value, 'https://resumeflow.invalid');
    const tokens = parsedUrl.searchParams.getAll('token');
    return tokens.length === 1 && Boolean(tokens[0].trim());
  } catch {
    return false;
  }
};

const resolveDownloadRequestUrl = (url: string) => {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url, 'https://resumeflow.invalid');
  } catch {
    throw new Error('PDF 下载地址无效，请重新发起导出。');
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('PDF 下载地址无效，请重新发起导出。');
  }

  // Always discard an absolute URL's supplied origin. Export download paths are
  // API-local capabilities; forwarding Logto credentials to an arbitrary host is
  // never valid, even if a malformed backend response contains that host.
  const requestPath = `${parsedUrl.pathname}${parsedUrl.search}`;
  const apiBaseUrl = getApiBaseUrl().trim();

  if (!apiBaseUrl) {
    return requestPath;
  }

  return joinUrl(apiBaseUrl, requestPath);
};

export const downloadUrlFile = async (
  url: string,
  fallbackFileName?: string,
  expectedAuthCacheKey?: string,
): Promise<void> => {
  await assertDownloadAuthContext(expectedAuthCacheKey);
  const isLegacySignedDownload = hasSingleLegacyDownloadToken(url);
  const headers = new Headers();
  if (!isLegacySignedDownload) {
    const authorization = await getAuthorizationHeader(expectedAuthCacheKey);
    if (!authorization) {
      throw new Error('登录状态已失效，请重新登录后再下载。');
    }
    headers.set('Authorization', authorization);
  }
  await assertDownloadAuthContext(expectedAuthCacheKey);
  if (fallbackFileName && !isLegacySignedDownload) {
    headers.set('X-ResumeFlow-File-Name', encodeURIComponent(fallbackFileName));
  }
  const response = await fetch(resolveDownloadRequestUrl(url), {
    method: 'GET',
    headers,
    cache: 'no-store',
  });

  await assertDownloadAuthContext(expectedAuthCacheKey);

  if (!response.ok) {
    throw new Error(await readDownloadErrorMessage(response));
  }

  const fileName = resolveDownloadFileName(
    response.headers.get('Content-Disposition'),
    fallbackFileName
  );
  const blob = await response.blob();
  await assertDownloadAuthContext(expectedAuthCacheKey);
  downloadBlobFile(blob, fileName);
};
