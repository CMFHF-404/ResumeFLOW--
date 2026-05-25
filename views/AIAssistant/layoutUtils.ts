const COMPOSER_OVERLAY_MIN_CLEARANCE = 72;
const COMPOSER_OVERLAY_VISIBLE_OVERLAP = 36;

export const computeComposerReservedHeight = (composerHeight: number) => {
  if (!Number.isFinite(composerHeight) || composerHeight <= 0) {
    return 160;
  }
  return Math.max(composerHeight - COMPOSER_OVERLAY_VISIBLE_OVERLAP, COMPOSER_OVERLAY_MIN_CLEARANCE);
};
