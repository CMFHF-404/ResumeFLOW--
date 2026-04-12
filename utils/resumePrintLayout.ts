import type { ResumePrintLayoutMeasurement } from '../types/resume';

const DEFAULT_OVERFLOW_TOLERANCE_PX = 2;
const MIN_VISIBLE_RECT_PX = 0.5;

const resolveMarginBottom = (element: HTMLElement) => {
  const marginBottom = Number.parseFloat(window.getComputedStyle(element).marginBottom);
  return Number.isFinite(marginBottom) ? marginBottom : 0;
};

const isElementVisiblyRendered = (element: HTMLElement) => {
  const style = window.getComputedStyle(element);
  if (
    style.display === 'none'
    || style.visibility === 'hidden'
    || Number.parseFloat(style.opacity || '1') === 0
  ) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  return rect.width > MIN_VISIBLE_RECT_PX || rect.height > MIN_VISIBLE_RECT_PX;
};

const findDeepestVisibleContentBottom = (root: HTMLElement): number | null => {
  let maxBottom = isElementVisiblyRendered(root)
    ? root.getBoundingClientRect().bottom
    : null;

  const childElements = Array.from(root.children) as HTMLElement[];
  childElements.forEach((child) => {
    const childBottom = findDeepestVisibleContentBottom(child);
    if (childBottom !== null) {
      maxBottom = maxBottom === null ? childBottom : Math.max(maxBottom, childBottom);
    }
  });

  return maxBottom;
};

const findDeepestVisibleDirectChildBottom = (root: HTMLElement): number | null => {
  let maxBottom: number | null = null;
  const childElements = Array.from(root.children) as HTMLElement[];

  childElements.forEach((child) => {
    if (!isElementVisiblyRendered(child)) {
      return;
    }

    const childBottom = child.getBoundingClientRect().bottom + resolveMarginBottom(child);
    maxBottom = maxBottom === null ? childBottom : Math.max(maxBottom, childBottom);
  });

  return maxBottom;
};

export const measureResumePrintLayout = (
  pageElement: HTMLElement,
  contentRoot: HTMLElement,
  tolerancePx = DEFAULT_OVERFLOW_TOLERANCE_PX
): ResumePrintLayoutMeasurement => {
  const pageRect = pageElement.getBoundingClientRect();
  const pageStyle = window.getComputedStyle(pageElement);
  const paddingTop = Number.parseFloat(pageStyle.paddingTop);
  const paddingBottom = Number.parseFloat(pageStyle.paddingBottom);
  const printableTop = pageRect.top + (Number.isFinite(paddingTop) ? paddingTop : 0);
  const printableBottom = pageRect.bottom - (Number.isFinite(paddingBottom) ? paddingBottom : 0);
  const deepestContentBottom = findDeepestVisibleContentBottom(contentRoot) ?? printableTop;
  const directChildBottom = findDeepestVisibleDirectChildBottom(contentRoot) ?? printableTop;
  const contentBottom = Math.max(deepestContentBottom, directChildBottom);
  const overflowPx = Math.max(0, contentBottom - printableBottom);

  return {
    fits: overflowPx <= tolerancePx,
    overflowPx,
    printableTop,
    printableBottom,
    contentBottom,
  };
};
