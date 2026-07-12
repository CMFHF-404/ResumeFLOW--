const CARD_EDGE_BASE_CLASS = 'card-edge-motion';
const CARD_EDGE_EXPAND_CLASS = 'card-edge-expand';
const CARD_EDGE_COLLAPSE_CLASS = 'card-edge-collapse';

export const resolveCardMotionClass = (isCollapsing: boolean) => {
  return isCollapsing
    ? `${CARD_EDGE_BASE_CLASS} ${CARD_EDGE_COLLAPSE_CLASS}`
    : `${CARD_EDGE_BASE_CLASS} ${CARD_EDGE_EXPAND_CLASS}`;
};
