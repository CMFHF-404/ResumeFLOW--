export const RESUME_REPORT_TIMEOUT_MS = 120_000;

export class ResumeReportTimeoutError extends Error {
  readonly code = 'ai_runtime_timeout';
  readonly statusCode = 504;
  readonly retryable = true;
  constructor() {
    super('简历报告生成超过120秒，请重试。');
    this.name = 'ResumeReportTimeoutError';
  }
}

// Includes authorization and response parsing. Late completions cannot become a report.
export async function withResumeReportDeadline<T>(
  run: (signal: AbortSignal) => Promise<T>,
  signal?: AbortSignal,
  timeoutMs = RESUME_REPORT_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: () => void = () => {};
  const interrupted = new Promise<never>((_, reject) => {
    onAbort = () => {
      const error = new DOMException('请求已取消', 'AbortError');
      controller.abort(error);
      reject(error);
    };
    if (signal?.aborted) { onAbort(); return; }
    signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => {
      const error = new ResumeReportTimeoutError();
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([interrupted, controller.signal.aborted
      ? interrupted : run(controller.signal)]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
