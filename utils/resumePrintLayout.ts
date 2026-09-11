import type { ResumePrintLayoutMeasurement } from '../types/resume';
import {
  A4_HEIGHT_PX, A4_WIDTH_PX, fitsSinglePageBounds,
  SINGLE_PAGE_SAFETY_INSET_PX, SINGLE_PAGE_MEASUREMENT_EPSILON_PX,
} from './resumePageGeometry';

const number = (value: string) => Number.parseFloat(value) || 0;
const visible = (element: Element) => {
  const style = window.getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden'
    && style.opacity !== '0' && element.getClientRects().length > 0;
};

// Start at semantic flow boxes, never at stretched column/background containers.
// Include descendants extending outside their parent and actual flow margins.
const flowBottom = (element: Element, origin: number, scale: number): number => {
  if (!visible(element) || element.getAttribute('aria-hidden') === 'true') return 0;
  const style = window.getComputedStyle(element);
  let bottom = (element.getBoundingClientRect().bottom - origin) / scale + number(style.marginBottom);
  for (const child of element.children) bottom = Math.max(bottom, flowBottom(child, origin, scale));
  return bottom;
};

export const measureResumePrintLayout = (
  pageElement: HTMLElement, contentRoot: HTMLElement,
  safetyInsetPx = SINGLE_PAGE_SAFETY_INSET_PX,
): ResumePrintLayoutMeasurement => {
  const rect = pageElement.getBoundingClientRect();
  // Undo uniform editor zoom using width; capacity never follows root height.
  const scale = rect.width / A4_WIDTH_PX;
  const style = window.getComputedStyle(pageElement);
  const printableTop = number(style.paddingTop);
  const printableBottom = A4_HEIGHT_PX - number(style.paddingBottom);
  const sections = [...contentRoot.querySelectorAll<HTMLElement>('[data-rf-section-id]')];
  const roots = [...contentRoot.querySelectorAll<HTMLElement>('#basic-info, [data-rf-section-id], [data-rf-print-flow]')];
  const bottomOf = (element: HTMLElement) => {
    let bottom = flowBottom(element, rect.top, scale);
    const column = element.closest('.rf-template-sidebar, .rf-template-main');
    if (column) bottom += number(window.getComputedStyle(column).paddingBottom);
    return bottom;
  };
  const contentBottom = Math.max(printableTop, ...roots.map(bottomOf));
  const fits = (bottom: number) => fitsSinglePageBounds({
    capacityBottomPx: printableBottom, flowBottomPx: bottom, safetyInsetPx,
    measurementEpsilonPx: SINGLE_PAGE_MEASUREMENT_EPSILON_PX,
  });
  return {
    fits: scale > 0 && Number.isFinite(scale) && fits(contentBottom),
    overflowPx: Math.max(0, contentBottom - printableBottom + safetyInsetPx),
    printableTop, printableBottom, contentBottom,
    overflowingSectionIds: sections.filter(el => visible(el) && !fits(bottomOf(el)))
      .map(el => el.dataset.rfSectionId || '').filter(Boolean),
  };
};
