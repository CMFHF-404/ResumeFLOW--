import React from 'react';
import { exportService } from '../services/exportService';
import type { ResumePdfRenderSnapshot } from '../types/resume';
import ResumePdfDocument from './ResumeEditor/components/ResumePdfDocument';

const waitForNextFrame = () => new Promise<void>((resolve) => {
  if (typeof window === 'undefined') {
    resolve();
    return;
  }
  window.requestAnimationFrame(() => resolve());
});

const CSS_BACKGROUND_URL_PATTERN = /url\((?:"([^"]+)"|'([^']+)'|([^)'"\s]+))\)/g;

const waitForImageElement = async (image: HTMLImageElement) => {
  if (!image.complete) {
    await new Promise<void>((resolve) => {
      const finish = () => {
        image.removeEventListener('load', finish);
        image.removeEventListener('error', finish);
        resolve();
      };
      image.addEventListener('load', finish, { once: true });
      image.addEventListener('error', finish, { once: true });
      if (image.complete) {
        finish();
      }
    });
  }

  if (typeof image.decode === 'function') {
    await image.decode().catch(() => undefined);
  }
};

const collectBackgroundImageUrls = (root: HTMLElement) => {
  const urls = new Set<string>();
  const elements = [root, ...root.querySelectorAll<HTMLElement>('*')];

  elements.forEach((element) => {
    const backgroundImage = window.getComputedStyle(element).backgroundImage;
    for (const match of backgroundImage.matchAll(CSS_BACKGROUND_URL_PATTERN)) {
      const url = (match[1] ?? match[2] ?? match[3] ?? '').trim();
      if (url) {
        urls.add(url);
      }
    }
  });

  return [...urls];
};

const waitForExportAssets = async (root: HTMLElement) => {
  const inlineImages = [...root.querySelectorAll<HTMLImageElement>('img')];
  const backgroundImages = collectBackgroundImageUrls(root).map((url) => {
    const image = new Image();
    image.src = url;
    return image;
  });

  await Promise.all([...inlineImages, ...backgroundImages].map(waitForImageElement));
};

const setExportReadyState = (isReady: boolean) => {
  if (typeof document === 'undefined') {
    return;
  }
  document.body.dataset.rfExportReady = isReady ? 'true' : 'false';
};

const clearExportErrorState = () => {
  if (typeof document === 'undefined') {
    return;
  }
  delete document.body.dataset.rfExportError;
};

const setExportErrorState = (message: string) => {
  if (typeof document === 'undefined') {
    return;
  }
  document.body.dataset.rfExportError = message;
  document.body.dataset.rfExportReady = 'false';
};

const buildInitialExportState = () => {
  if (typeof window === 'undefined') {
    return { exportId: '', token: '' };
  }
  const query = new URLSearchParams(window.location.search);
  return {
    exportId: query.get('exportId') || '',
    token: query.get('token') || '',
  };
};

const ResumePdfExportPage: React.FC = () => {
  const [{ exportId, token }] = React.useState(buildInitialExportState);
  const [snapshot, setSnapshot] = React.useState<ResumePdfRenderSnapshot | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const previewRef = React.useRef<HTMLDivElement | null>(null);
  const previewContentRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (typeof document === 'undefined') {
      return undefined;
    }

    document.documentElement.classList.remove('dark');
    document.documentElement.style.colorScheme = 'light';
    document.body.dataset.rfExportPage = 'true';
    document.body.style.background = '#ffffff';
    setExportReadyState(false);
    clearExportErrorState();

    return () => {
      delete document.body.dataset.rfExportPage;
      delete document.body.dataset.rfExportReady;
      delete document.body.dataset.rfExportError;
      document.documentElement.style.colorScheme = '';
      document.body.style.background = '';
    };
  }, []);

  React.useEffect(() => {
    let cancelled = false;

    const loadSnapshot = async () => {
      if (!exportId || !token) {
        const nextError = '缺少导出参数，请重新发起导出。';
        if (!cancelled) {
          setError(nextError);
          setSnapshot(null);
          setIsLoading(false);
          setExportErrorState(nextError);
        }
        return;
      }

      setIsLoading(true);
      setExportReadyState(false);
      clearExportErrorState();

      try {
        const response = await exportService.getRenderSnapshot(exportId, token);
        if (cancelled) {
          return;
        }
        setSnapshot(response.snapshot);
        setError(null);
        clearExportErrorState();
      } catch (loadError) {
        const nextError = loadError instanceof Error
          ? loadError.message
          : '导出快照加载失败，请重新发起导出。';
        if (cancelled) {
          return;
        }
        setSnapshot(null);
        setError(nextError);
        setExportErrorState(nextError);
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadSnapshot();

    return () => {
      cancelled = true;
    };
  }, [exportId, token]);

  React.useEffect(() => {
    if (!snapshot || isLoading || error || !previewContentRef.current) {
      return undefined;
    }

    let cancelled = false;

    const markReady = async () => {
      try {
        await waitForNextFrame();
        await waitForNextFrame();
        if (!previewRef.current || !previewContentRef.current) {
          throw new Error('导出页面排版初始化失败。');
        }
        await Promise.all([
          document.fonts?.ready,
          waitForExportAssets(previewRef.current),
        ]);
        await waitForNextFrame();
        if (cancelled) {
          return;
        }
        document.title = `${snapshot.resumeName} PDF Export`;
        clearExportErrorState();
        setExportReadyState(true);
      } catch (readyError) {
        if (cancelled) {
          return;
        }
        const nextError = readyError instanceof Error
          ? readyError.message
          : '导出页面排版初始化失败。';
        setError(nextError);
        setExportErrorState(nextError);
      }
    };

    setExportReadyState(false);
    void markReady();

    return () => {
      cancelled = true;
      setExportReadyState(false);
    };
  }, [error, isLoading, snapshot]);

  if (error) {
    return (
      <main
        className="min-h-screen bg-white px-6 py-10 text-gray-900"
        data-rf-export-root="true"
      >
        <div className="mx-auto max-w-xl rounded-2xl border border-red-200 bg-red-50 px-6 py-5 text-sm text-red-700">
          {error}
        </div>
      </main>
    );
  }

  return (
    <main className="bg-white text-gray-900" data-rf-export-root="true">
      {isLoading || !snapshot ? (
        <div className="flex min-h-screen items-center justify-center text-sm text-gray-500">
          正在准备 PDF 导出...
        </div>
      ) : (
        <ResumePdfDocument
          snapshot={snapshot}
          previewRef={previewRef}
          previewContentRef={previewContentRef}
        />
      )}
    </main>
  );
};

export default ResumePdfExportPage;
