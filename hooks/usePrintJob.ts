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

type PrintFallbackCleanup = () => void;

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

export const usePrintJob = () => {
  const [job, setJob] = useState<PrintJobState | null>(null);
  const [isPrinting, setIsPrinting] = useState(false);
  const jobCounterRef = useRef(0);
  const originalTitleRef = useRef<string | null>(null);
  const hadDarkModeRef = useRef<boolean>(false);

  const startPrint = useCallback((options: PrintJobOptions) => {
    if (isPrinting) {
      return;
    }
    if (!options.content) {
      return;
    }
    const nextId = jobCounterRef.current + 1;
    jobCounterRef.current = nextId;
    setJob({
      ...options,
      forceLightMode: options.forceLightMode ?? DEFAULT_FORCE_LIGHT_MODE,
      id: nextId,
    });
  }, [isPrinting]);

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
    startPrint,
  };
};

