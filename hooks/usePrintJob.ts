import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

export type PrintJobOptions = {
  title: string;
  content: ReactNode;
  forceLightMode?: boolean;
};

type PrintJobState = PrintJobOptions & {
  id: number;
};

const DEFAULT_FORCE_LIGHT_MODE = true;
const PRINT_FALLBACK_TIMEOUT_MS = 20_000;
const PRINT_LAYOUT_STABILIZE_DELAY_MS = 120;
const PRINT_WINDOW_MESSAGE_CHANNEL = 'rf-print-job';
const MOBILE_PRINT_MEDIA_QUERY = '(max-width: 1023px)';

type PrintFallbackCleanup = () => void;
type IsolatedPrintPhase = 'reserved' | 'active';

const createPrintFallbackTimer = (onTimeout: () => void): PrintFallbackCleanup => {
  const timeoutId = window.setTimeout(onTimeout, PRINT_FALLBACK_TIMEOUT_MS);
  return () => window.clearTimeout(timeoutId);
};

const subscribePrintMediaExit = (onExit: () => void): PrintFallbackCleanup => {
  if (typeof window.matchMedia !== 'function') {
    return () => {};
  }
  const mediaQuery = window.matchMedia('print');
  let hasEnteredPrint = mediaQuery.matches;

  const handleChange = (event: MediaQueryListEvent | MediaQueryList) => {
    const matches = event.matches;
    if (matches) {
      hasEnteredPrint = true;
      return;
    }
    if (hasEnteredPrint) {
      onExit();
    }
  };

  if ('addEventListener' in mediaQuery) {
    mediaQuery.addEventListener('change', handleChange as EventListener);
    return () => mediaQuery.removeEventListener('change', handleChange as EventListener);
  }

  const legacyMediaQuery = mediaQuery as MediaQueryList & {
    addListener?: (listener: (event: MediaQueryList) => void) => void;
    removeListener?: (listener: (event: MediaQueryList) => void) => void;
  };
  legacyMediaQuery.addListener?.(handleChange as (event: MediaQueryList) => void);
  return () => legacyMediaQuery.removeListener?.(handleChange as (event: MediaQueryList) => void);
};

const waitForNextFrame = () => new Promise<void>((resolve) => {
  requestAnimationFrame(() => resolve());
});

const waitForDelay = (delayMs: number) => new Promise<void>((resolve) => {
  window.setTimeout(resolve, delayMs);
});

const waitForFontsReady = async () => {
  const fonts = (document as Document & { fonts?: { ready?: Promise<void> } }).fonts;
  if (fonts?.ready) {
    await fonts.ready;
  }
};

const escapeHtml = (value: string) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const escapeInlineScriptContent = (value: string) => value.replace(/<\/script/giu, '<\\/script');

const shouldUseIsolatedPrintWindow = () => {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return false;
  }

  const userAgent = navigator.userAgent || '';
  const isMobileUserAgent = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(userAgent);
  const hasTouchPoints = navigator.maxTouchPoints > 0;
  const hasCoarsePointer = typeof window.matchMedia === 'function'
    ? window.matchMedia('(pointer: coarse)').matches || window.matchMedia('(any-pointer: coarse)').matches
    : false;
  const isNarrowViewport = typeof window.matchMedia === 'function'
    ? window.matchMedia(MOBILE_PRINT_MEDIA_QUERY).matches
    : window.innerWidth < 1024;

  return isMobileUserAgent || ((hasTouchPoints || hasCoarsePointer) && isNarrowViewport);
};

const buildStylesheetTag = (link: HTMLLinkElement) => {
  const href = link.href;
  if (!href) {
    return '';
  }

  const media = link.media ? ` media="${escapeHtml(link.media)}"` : '';
  const crossOrigin = link.crossOrigin ? ` crossorigin="${escapeHtml(link.crossOrigin)}"` : '';
  const referrerPolicy = link.referrerPolicy ? ` referrerpolicy="${escapeHtml(link.referrerPolicy)}"` : '';

  return `<link rel="stylesheet" href="${escapeHtml(href)}"${media}${crossOrigin}${referrerPolicy}>`;
};

const buildScriptTag = (script: HTMLScriptElement) => {
  if (script.src) {
    const src = script.src;
    if (!src) {
      return '';
    }

    const type = script.type ? ` type="${escapeHtml(script.type)}"` : '';
    const asyncAttribute = script.async ? ' async' : '';
    const deferAttribute = script.defer ? ' defer' : '';
    const crossOrigin = script.crossOrigin ? ` crossorigin="${escapeHtml(script.crossOrigin)}"` : '';
    const referrerPolicy = script.referrerPolicy ? ` referrerpolicy="${escapeHtml(script.referrerPolicy)}"` : '';

    return `<script${type} src="${escapeHtml(src)}"${asyncAttribute}${deferAttribute}${crossOrigin}${referrerPolicy}></script>`;
  }

  const content = script.textContent;
  if (!content) {
    return '';
  }

  const type = script.type ? ` type="${escapeHtml(script.type)}"` : '';
  return `<script${type}>${escapeInlineScriptContent(content)}</script>`;
};

const collectPrintDocumentStyles = () => {
  if (typeof document === 'undefined') {
    return '';
  }

  return Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))
    .map((node) => {
      if (node instanceof HTMLStyleElement) {
        return node.outerHTML;
      }
      if (node instanceof HTMLLinkElement) {
        return buildStylesheetTag(node);
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
};

const collectPrintDocumentTailwindRuntime = () => {
  if (typeof document === 'undefined') {
    return {
      configMarkup: '',
      runtimeMarkup: '',
    };
  }

  const scripts = Array.from(document.querySelectorAll('head script'));
  const configScript = scripts.find((script) => !script.src && script.textContent?.includes('tailwind.config'));
  const runtimeScript = scripts.find((script) => script.src.includes('cdn.tailwindcss.com'));

  return {
    configMarkup: configScript ? buildScriptTag(configScript) : '',
    runtimeMarkup: runtimeScript ? buildScriptTag(runtimeScript) : '',
  };
};

const buildIsolatedPrintWindowHtml = ({
  title,
  bodyMarkup,
  stylesMarkup,
  tailwindConfigMarkup,
  tailwindRuntimeMarkup,
  jobId,
}: {
  title: string;
  bodyMarkup: string;
  stylesMarkup: string;
  tailwindConfigMarkup: string;
  tailwindRuntimeMarkup: string;
  jobId: number;
}) => {
  const escapedTitle = escapeHtml(title);

  return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapedTitle}</title>
    ${stylesMarkup}
    <style>
      :root {
        color-scheme: light;
      }

      html,
      body {
        margin: 0;
        background: #fff !important;
      }

      body {
        min-height: 100vh;
        color: #111827;
      }

      .rf-print-preview,
      .rf-print-preview-shell,
      .rf-print-preview main,
      .rf-print-preview-shell main {
        background: #fff !important;
        overflow: visible !important;
      }

      .rf-print-preview-shell,
      .rf-print-preview main,
      .rf-print-preview-shell main {
        padding: 0 !important;
      }

      .rf-print-preview main,
      .rf-print-preview-shell main {
        display: block !important;
        min-height: auto !important;
      }

      .rf-print-preview main > div,
      .rf-print-preview main > div > div,
      .rf-print-preview-shell main > div,
      .rf-print-preview-shell main > div > div {
        display: block !important;
        width: auto !important;
        min-height: auto !important;
        overflow: visible !important;
      }

      @page {
        size: A4;
        margin: 0;
      }
    </style>
  </head>
  <body>
    ${bodyMarkup}
    ${tailwindConfigMarkup}
    ${tailwindRuntimeMarkup}
    <script>
      (() => {
        const channel = ${JSON.stringify(PRINT_WINDOW_MESSAGE_CHANNEL)};
        const jobId = ${jobId};
        const notify = (type, detail) => {
          try {
            if (window.opener && !window.opener.closed) {
              window.opener.postMessage({ channel, jobId, type, detail }, '*');
            }
          } catch (error) {
          }
        };

        const waitForNextFrame = () => new Promise((resolve) => {
          requestAnimationFrame(() => resolve());
        });

        const refreshTailwind = async () => {
          const tailwindApi = window.tailwind;
          if (tailwindApi && typeof tailwindApi.refresh === 'function') {
            await Promise.resolve(tailwindApi.refresh());
          }
        };

        const run = async () => {
          try {
            await refreshTailwind();
            if (document.fonts && document.fonts.ready) {
              await document.fonts.ready;
            }
            await waitForNextFrame();
            await waitForNextFrame();
            notify('ready');
            window.focus();
            window.print();
          } catch (error) {
            notify('error', error instanceof Error ? error.message : String(error));
          }
        };

        window.addEventListener('afterprint', () => {
          notify('afterprint');
          setTimeout(() => {
            try {
              window.close();
            } catch (error) {
            }
          }, 0);
        });

        window.addEventListener('pagehide', () => {
          notify('pagehide');
        });

        if (document.readyState === 'complete') {
          run();
        } else {
          window.addEventListener('load', run, { once: true });
        }
      })();
    </script>
  </body>
</html>`;
};

const buildIsolatedPrintWindowLoadingHtml = (title: string) => `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(title)}</title>
    <style>
      html,
      body {
        margin: 0;
        min-height: 100vh;
        background: #fff;
        color: #111827;
        font-family: "Noto Sans SC", "Inter", sans-serif;
      }

      body {
        display: grid;
        place-items: center;
      }

      .rf-print-loading {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
        color: #4b5563;
        font-size: 14px;
      }

      .rf-print-loading::before {
        content: "";
        width: 28px;
        height: 28px;
        border-radius: 9999px;
        border: 3px solid #d1d5db;
        border-top-color: #0f766e;
        animation: rf-spin 0.8s linear infinite;
      }

      @keyframes rf-spin {
        to {
          transform: rotate(360deg);
        }
      }
    </style>
  </head>
  <body>
    <div class="rf-print-loading">正在准备导出...</div>
  </body>
</html>`;

export const usePrintJob = () => {
  const [job, setJob] = useState<PrintJobState | null>(null);
  const [isPrinting, setIsPrinting] = useState(false);
  const jobCounterRef = useRef(0);
  const originalTitleRef = useRef<string | null>(null);
  const hadDarkModeRef = useRef<boolean>(false);
  const isolatedPrintWindowRef = useRef<Window | null>(null);
  const isolatedPrintJobIdRef = useRef<number | null>(null);
  const isolatedPrintPhaseRef = useRef<IsolatedPrintPhase | null>(null);
  const isolatedPrintPollRef = useRef<number | null>(null);
  const isolatedPrintFallbackRef = useRef<PrintFallbackCleanup | null>(null);

  const finalizeIsolatedPrint = useCallback(() => {
    isolatedPrintFallbackRef.current?.();
    isolatedPrintFallbackRef.current = null;

    if (isolatedPrintPollRef.current !== null) {
      window.clearInterval(isolatedPrintPollRef.current);
      isolatedPrintPollRef.current = null;
    }

    const isolatedWindow = isolatedPrintWindowRef.current;
    if (isolatedWindow && !isolatedWindow.closed) {
      try {
        isolatedWindow.close();
      } catch (error) {
      }
    }

    isolatedPrintWindowRef.current = null;
    isolatedPrintJobIdRef.current = null;
    isolatedPrintPhaseRef.current = null;
    setIsPrinting(false);
  }, []);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const payload = event.data;
      if (
        !payload
        || payload.channel !== PRINT_WINDOW_MESSAGE_CHANNEL
        || payload.jobId !== isolatedPrintJobIdRef.current
        || event.source !== isolatedPrintWindowRef.current
      ) {
        return;
      }

      if (payload.type === 'afterprint' || payload.type === 'pagehide' || payload.type === 'error') {
        finalizeIsolatedPrint();
      }
    };

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [finalizeIsolatedPrint]);

  useEffect(() => () => {
    finalizeIsolatedPrint();
  }, [finalizeIsolatedPrint]);

  const getActiveIsolatedPrintSession = useCallback(() => {
    const printWindow = isolatedPrintWindowRef.current;
    const jobId = isolatedPrintJobIdRef.current;
    if (!printWindow || printWindow.closed || jobId === null) {
      return null;
    }
    return {
      printWindow,
      jobId,
    };
  }, []);

  const initializeIsolatedPrintWindow = useCallback((printWindow: Window, title: string) => {
    const nextId = jobCounterRef.current + 1;
    jobCounterRef.current = nextId;

    isolatedPrintWindowRef.current = printWindow;
    isolatedPrintJobIdRef.current = nextId;
    isolatedPrintPhaseRef.current = 'reserved';
    setIsPrinting(true);

    if (isolatedPrintPollRef.current !== null) {
      window.clearInterval(isolatedPrintPollRef.current);
    }
    isolatedPrintPollRef.current = window.setInterval(() => {
      const currentWindow = isolatedPrintWindowRef.current;
      if (!currentWindow || currentWindow.closed) {
        finalizeIsolatedPrint();
      }
    }, 500);

    try {
      printWindow.document.open();
      printWindow.document.write(buildIsolatedPrintWindowLoadingHtml(title));
      printWindow.document.close();
    } catch (error) {
    }

    return nextId;
  }, [finalizeIsolatedPrint]);

  const openIsolatedPrintWindow = useCallback((title: string) => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      return null;
    }

    const jobId = initializeIsolatedPrintWindow(printWindow, title);
    return {
      printWindow,
      jobId,
    };
  }, [initializeIsolatedPrintWindow]);

  const preparePrint = useCallback((title: string) => {
    if (isPrinting || !shouldUseIsolatedPrintWindow()) {
      return null;
    }

    const session = openIsolatedPrintWindow(title);
    if (!session) {
      return null;
    }

    return () => {
      if (
        isolatedPrintPhaseRef.current === 'reserved'
        && isolatedPrintJobIdRef.current === session.jobId
      ) {
        finalizeIsolatedPrint();
      }
    };
  }, [finalizeIsolatedPrint, isPrinting, openIsolatedPrintWindow]);

  const startIsolatedPrint = useCallback((options: PrintJobOptions) => {
    const session = getActiveIsolatedPrintSession() ?? openIsolatedPrintWindow(options.title);
    if (!session) {
      return false;
    }

    const { printWindow, jobId } = session;
    isolatedPrintPhaseRef.current = 'active';
    isolatedPrintFallbackRef.current?.();
    isolatedPrintFallbackRef.current = createPrintFallbackTimer(finalizeIsolatedPrint);

    void import('react-dom/server')
      .then(({ renderToStaticMarkup }) => {
        if (
          isolatedPrintWindowRef.current !== printWindow
          || isolatedPrintJobIdRef.current !== jobId
          || printWindow.closed
        ) {
          return;
        }

        const markup = renderToStaticMarkup(options.content);
        const stylesMarkup = collectPrintDocumentStyles();
        const { configMarkup, runtimeMarkup } = collectPrintDocumentTailwindRuntime();
        const html = buildIsolatedPrintWindowHtml({
          title: options.title,
          bodyMarkup: markup,
          stylesMarkup,
          tailwindConfigMarkup: configMarkup,
          tailwindRuntimeMarkup: runtimeMarkup,
          jobId,
        });

        if (
          isolatedPrintWindowRef.current !== printWindow
          || isolatedPrintJobIdRef.current !== jobId
          || printWindow.closed
        ) {
          return;
        }

        printWindow.document.open();
        printWindow.document.write(html);
        printWindow.document.close();
      })
      .catch(() => {
        try {
          printWindow.document.open();
          printWindow.document.write(`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>${escapeHtml(options.title)}</title></head><body style="font-family: sans-serif; padding: 24px;">导出准备失败，请返回重试。</body></html>`);
          printWindow.document.close();
        } catch (error) {
        }
        finalizeIsolatedPrint();
      });

    return true;
  }, [finalizeIsolatedPrint, getActiveIsolatedPrintSession, openIsolatedPrintWindow]);

  const startPrint = useCallback((options: PrintJobOptions) => {
    const preparedIsolatedPrint = isolatedPrintPhaseRef.current === 'reserved'
      ? getActiveIsolatedPrintSession()
      : null;

    if (!preparedIsolatedPrint && isPrinting) {
      return;
    }
    if (!options.content) {
      return;
    }

    if (preparedIsolatedPrint || shouldUseIsolatedPrintWindow()) {
      const started = startIsolatedPrint({
        ...options,
        forceLightMode: options.forceLightMode ?? DEFAULT_FORCE_LIGHT_MODE,
      });
      if (started) {
        return;
      }
    }

    const nextId = jobCounterRef.current + 1;
    jobCounterRef.current = nextId;
    setJob({
      ...options,
      forceLightMode: options.forceLightMode ?? DEFAULT_FORCE_LIGHT_MODE,
      id: nextId,
    });
  }, [getActiveIsolatedPrintSession, isPrinting, startIsolatedPrint]);

  useEffect(() => {
    if (!job) {
      return;
    }
    let isCancelled = false;
    let hasFinalized = false;
    let stopFallbackTimer: PrintFallbackCleanup | null = null;
    let stopPrintMediaListener: PrintFallbackCleanup | null = null;

    const restoreDocumentState = () => {
      if (originalTitleRef.current !== null) {
        document.title = originalTitleRef.current;
        originalTitleRef.current = null;
      }
      if (job.forceLightMode && hadDarkModeRef.current) {
        document.documentElement.classList.add('dark');
        hadDarkModeRef.current = false;
      }
    };

    const finalize = () => {
      restoreDocumentState();
      setIsPrinting(false);
      setJob(null);
    };

    const clearFallbacks = () => {
      stopFallbackTimer?.();
      stopFallbackTimer = null;
      stopPrintMediaListener?.();
      stopPrintMediaListener = null;
    };

    const finalizeOnce = () => {
      if (hasFinalized || isCancelled) {
        return;
      }
      hasFinalized = true;
      clearFallbacks();
      finalize();
    };

    const handleAfterPrint = () => {
      finalizeOnce();
    };

    // 等待 DOM 与字体稳定，避免打印时排版抖动。
    const run = async () => {
      setIsPrinting(true);
      originalTitleRef.current = document.title;
      if (job.title) {
        document.title = job.title;
      }
      if (job.forceLightMode) {
        const hasDark = document.documentElement.classList.contains('dark');
        hadDarkModeRef.current = hasDark;
        if (hasDark) {
          document.documentElement.classList.remove('dark');
        }
      }

      await waitForNextFrame();
      await waitForFontsReady();
      await waitForNextFrame();
      await waitForDelay(PRINT_LAYOUT_STABILIZE_DELAY_MS);

      if (isCancelled) {
        return;
      }

      // 某些浏览器不会触发 afterprint，这里增加媒体监听与超时兜底，避免卡死。
      stopPrintMediaListener = subscribePrintMediaExit(finalizeOnce);
      stopFallbackTimer = createPrintFallbackTimer(finalizeOnce);
      window.print();
    };

    window.addEventListener('afterprint', handleAfterPrint);
    run();

    return () => {
      isCancelled = true;
      window.removeEventListener('afterprint', handleAfterPrint);
      clearFallbacks();
      restoreDocumentState();
    };
  }, [job]);

  return {
    printContent: job?.content ?? null,
    isPrinting,
    preparePrint,
    startPrint,
  };
};

