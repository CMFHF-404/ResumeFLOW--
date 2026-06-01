import React from 'react';
import type { DropPosition } from '../../../../utils/dragSort';

export type SectionDragHandler = (event: React.DragEvent, sectionId: string) => void;
export type ItemDragHandler = (event: React.DragEvent, itemId: string) => void;
export type DragHoverHandler = (targetId: string, position: DropPosition) => void;
export type DragDropHandler = (event: React.DragEvent) => void;
export type TouchDragStartHandler = (id: string) => void;
export type TouchDragMode = 'section' | 'item';
export type TouchDragSession = {
    touchId: number;
    mode: TouchDragMode;
    sourceId: string;
    container: HTMLElement | null;
    sourceElement: HTMLElement | null;
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
    sourceRectLeft: number;
    sourceRectTop: number;
    activated: boolean;
    timerId: number | null;
};
export type TouchFeedbackState = {
    mode: TouchDragMode;
    sourceId: string;
    phase: 'pressing' | 'dragging';
} | null;
export type TouchDragPreviewState = {
    sourceId: string;
    width: number;
    height: number;
    html: string;
};

export const TOUCH_LONG_PRESS_DELAY_MS = 260;
export const TOUCH_DRAG_CANCEL_DISTANCE_PX = 14;
export const TOUCH_AUTOSCROLL_EDGE_PX = 88;
export const TOUCH_AUTOSCROLL_MAX_STEP_PX = 18;
export const TOUCH_DRAG_PREVIEW_LIFT_PX = 10;

export const DATA_ITEM_ID_ATTR = 'data-rf-item-id';
export const DATA_ITEM_CONTAINER_ATTR = 'data-rf-item-container';
export const DATA_ITEM_SURFACE_ATTR = 'data-rf-item-surface';
export const DATA_SECTION_ID_ATTR = 'data-rf-section-id';
export const DATA_SECTION_SURFACE_ATTR = 'data-rf-section-surface';

export const isScrollableOverflow = (overflowValue: string) => (
    overflowValue === 'auto'
    || overflowValue === 'scroll'
    || overflowValue === 'overlay'
);

export const findNearestScrollableAncestor = (element: HTMLElement | null) => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
        return null;
    }

    let current = element?.parentElement ?? null;
    while (current) {
        const computedStyle = window.getComputedStyle(current);
        if (
            isScrollableOverflow(computedStyle.overflowY)
            && current.scrollHeight > current.clientHeight
        ) {
            return current;
        }
        current = current.parentElement;
    }

    return document.scrollingElement instanceof HTMLElement ? document.scrollingElement : null;
};

export const resolveElementVerticalPadding = (element: HTMLElement) => {
    const computedStyle = window.getComputedStyle(element);
    const paddingTop = Number.parseFloat(computedStyle.paddingTop);
    const paddingBottom = Number.parseFloat(computedStyle.paddingBottom);

    return (Number.isFinite(paddingTop) ? paddingTop : 0)
        + (Number.isFinite(paddingBottom) ? paddingBottom : 0);
};
