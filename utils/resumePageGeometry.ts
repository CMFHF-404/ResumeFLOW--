export const A4_HEIGHT_PX = 297 * 96 / 25.4;
export const A4_WIDTH_PX = 210 * 96 / 25.4;
export const SINGLE_PAGE_SAFETY_INSET_PX = 2;
export const SINGLE_PAGE_MEASUREMENT_EPSILON_PX = 0.1;
export type SinglePageBounds = {
  capacityBottomPx: number;
  flowBottomPx: number;
  safetyInsetPx: number;
  measurementEpsilonPx: number;
};
export function fitsSinglePageBounds(bounds: SinglePageBounds): boolean {
  const {capacityBottomPx, flowBottomPx, safetyInsetPx, measurementEpsilonPx} = bounds;
  return Object.values(bounds).every(Number.isFinite)
    && safetyInsetPx >= 0 && measurementEpsilonPx >= 0
    && measurementEpsilonPx <= safetyInsetPx
    && flowBottomPx <= capacityBottomPx - safetyInsetPx + measurementEpsilonPx;
}
