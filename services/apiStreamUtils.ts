import { getApiBaseUrl } from './apiClient';

export const parseNdjsonLines = (chunk: string) => chunk.split('\n').map((line) => line.trim()).filter(Boolean);

export const parseNdjsonChunk = (chunk: string, flush = false) => {
  const segments = chunk.split('\n');
  const remainder = flush ? '' : segments.pop() ?? '';
  const lines = segments.map((line) => line.trim()).filter(Boolean);
  return { lines, remainder };
};

export const resolveApiUrl = (path: string) => {
  const base = getApiBaseUrl();
  if (!base) {
    return path;
  }
  const normalizedBase = base.endsWith('/') ? base.slice(0, -1) : base;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
};
