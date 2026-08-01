import React from 'react';
import { RESUME_TEMPLATE_DEFINITIONS } from '../constants/resumeTemplates';
import ResumePdfDocument from './ResumeEditor/components/ResumePdfDocument';
import { buildResumeTemplatePreviewSnapshot } from './resumeTemplatePreviewFixture';

const CSS_BACKGROUND_URL_PATTERN = /url\((?:"([^"]+)"|'([^']+)'|([^)'"\s]+))\)/g;
const OVERFLOW_TOLERANCE_PX = 2;

const waitForNextFrame = () => new Promise<void>((resolve) => {
  window.requestAnimationFrame(() => resolve());
});

const waitForImage = async (image: HTMLImageElement) => {
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
  if (!image.naturalWidth || !image.naturalHeight) {
    throw new Error(`模板预览资源加载失败：${image.currentSrc || image.src}`);
  }
};

const waitForPreviewAssets = async (root: HTMLElement) => {
  const inlineImages = [...root.querySelectorAll<HTMLImageElement>('img')];
  const backgroundUrls = new Set<string>();
  [root, ...root.querySelectorAll<HTMLElement>('*')].forEach((element) => {
    const backgroundImage = window.getComputedStyle(element).backgroundImage;
    for (const match of backgroundImage.matchAll(CSS_BACKGROUND_URL_PATTERN)) {
      const url = (match[1] ?? match[2] ?? match[3] ?? '').trim();
      if (url) {
        backgroundUrls.add(url);
      }
    }
  });
  const backgroundImages = [...backgroundUrls].map((url) => {
    const image = new Image();
    image.src = url;
    return image;
  });
  await Promise.all([...inlineImages, ...backgroundImages].map(waitForImage));
};

const readRequestedTemplate = () => {
  const requestedId = new URLSearchParams(window.location.search).get('templateId');
  return RESUME_TEMPLATE_DEFINITIONS.find((template) => template.id === requestedId) ?? null;
};

const ResumeTemplatePreviewDevPage: React.FC = () => {
  const [template] = React.useState(readRequestedTemplate);
  const previewRef = React.useRef<HTMLDivElement | null>(null);
  const previewContentRef = React.useRef<HTMLDivElement | null>(null);
  const snapshot = React.useMemo(
    () => template ? buildResumeTemplatePreviewSnapshot(template.id) : null,
    [template]
  );

  React.useEffect(() => {
    document.documentElement.classList.remove('dark');
    document.documentElement.style.colorScheme = 'light';
    document.body.style.background = '#ffffff';
    document.body.dataset.rfTemplatePreviewReady = 'false';
    delete document.body.dataset.rfTemplatePreviewError;
    delete document.body.dataset.rfTemplatePreviewOverflowPx;

    return () => {
      document.documentElement.style.colorScheme = '';
      document.body.style.background = '';
      delete document.body.dataset.rfTemplatePreviewReady;
      delete document.body.dataset.rfTemplatePreviewError;
      delete document.body.dataset.rfTemplatePreviewOverflowPx;
    };
  }, []);

  React.useEffect(() => {
    let cancelled = false;

    const markReady = async () => {
      try {
        if (!template || !snapshot) {
          throw new Error('未知模板 ID，无法生成预览图。');
        }
        await waitForNextFrame();
        await waitForNextFrame();
        if (!previewRef.current || !previewContentRef.current) {
          throw new Error('模板预览排版初始化失败。');
        }
        await Promise.all([
          document.fonts?.ready,
          waitForPreviewAssets(previewRef.current),
        ]);
        await waitForNextFrame();
        if (cancelled) {
          return;
        }

        const pageRect = previewRef.current.getBoundingClientRect();
        const contentRect = previewContentRef.current.getBoundingClientRect();
        const overflowPx = Math.max(
          0,
          previewRef.current.scrollHeight - previewRef.current.clientHeight,
          contentRect.bottom - pageRect.bottom
        );
        document.body.dataset.rfTemplatePreviewOverflowPx = overflowPx.toFixed(2);
        if (overflowPx > OVERFLOW_TOLERANCE_PX) {
          throw new Error(`${template.id} 的固定预览数据超出 A4 ${overflowPx.toFixed(2)}px。`);
        }

        document.title = `${template.name}模板预览`;
        document.body.dataset.rfTemplatePreviewReady = 'true';
      } catch (readyError) {
        if (cancelled) {
          return;
        }
        document.body.dataset.rfTemplatePreviewReady = 'false';
        document.body.dataset.rfTemplatePreviewError = readyError instanceof Error
          ? readyError.message
          : '模板预览生成失败。';
      }
    };

    void markReady();
    return () => {
      cancelled = true;
    };
  }, [snapshot, template]);

  if (!snapshot || !template) {
    return <main className="p-6 text-sm text-red-700">未知模板 ID，无法生成预览图。</main>;
  }

  return (
    <main className="min-h-screen bg-white" data-rf-template-preview-page="true">
      <ResumePdfDocument
        snapshot={snapshot}
        previewRef={previewRef}
        previewContentRef={previewContentRef}
        className="rf-template-preview-dev-shell"
      />
    </main>
  );
};

export default ResumeTemplatePreviewDevPage;
