import type React from 'react';

export type DropPosition = 'before' | 'after';

export type DragTarget = {
    id: string;
    position: DropPosition;
};

type DragRect = Pick<DOMRect, 'top' | 'right' | 'bottom' | 'left' | 'width' | 'height'>;

export type DragAxis = 'vertical' | 'horizontal';

const HORIZONTAL_ROW_OVERLAP_RATIO = 0.5;
const MIN_HORIZONTAL_CENTER_DISTANCE_PX = 1;

export const resolveDragAxisFromRects = (rects: DragRect[]): DragAxis => {
    for (let index = 0; index < rects.length; index += 1) {
        const rect = rects[index];
        for (let candidateIndex = index + 1; candidateIndex < rects.length; candidateIndex += 1) {
            const candidateRect = rects[candidateIndex];
            const verticalOverlap = Math.min(rect.bottom, candidateRect.bottom)
                - Math.max(rect.top, candidateRect.top);
            const minimumHeight = Math.min(rect.height, candidateRect.height);
            const horizontalCenterDistance = Math.abs(
                (rect.left + (rect.width / 2))
                - (candidateRect.left + (candidateRect.width / 2))
            );

            if (
                minimumHeight > 0
                && verticalOverlap >= minimumHeight * HORIZONTAL_ROW_OVERLAP_RATIO
                && horizontalCenterDistance > MIN_HORIZONTAL_CENTER_DISTANCE_PX
            ) {
                return 'horizontal';
            }
        }
    }

    return 'vertical';
};

export const resolveDragPosition = (
    rect: DragRect,
    clientY: number,
    clientX: number | undefined,
    axis: DragAxis
): DropPosition => {
    if (axis === 'horizontal' && typeof clientX === 'number' && Number.isFinite(clientX)) {
        return clientX < rect.left + (rect.width / 2) ? 'before' : 'after';
    }

    return clientY < rect.top + (rect.height / 2) ? 'before' : 'after';
};

const resolveClosestDragElement = (
    target: EventTarget | null,
    container: HTMLElement,
    dataAttr: string
) => {
    // event.target 可能是 SVGElement/path 或 Text 节点；这里统一转换成 Element 再做 closest 命中。
    const resolvedTarget =
        target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
    if (!resolvedTarget) {
        return null;
    }

    const closest = resolvedTarget.closest(`[${dataAttr}]`);
    if (!(closest instanceof HTMLElement)) {
        return null;
    }
    return container.contains(closest) ? closest : null;
};

const resolveNearestDragCandidate = (
    candidates: Array<{ el: HTMLElement; id: string }>,
    clientY: number,
    clientX: number | undefined,
    axis: DragAxis
) => {
    let best = candidates[0];
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const candidate of candidates) {
        const rect = candidate.el.getBoundingClientRect();
        const distance = axis === 'horizontal' && typeof clientX === 'number'
            ? Math.hypot(
                clientX < rect.left
                    ? rect.left - clientX
                    : clientX > rect.right
                        ? clientX - rect.right
                        : 0,
                clientY < rect.top
                    ? rect.top - clientY
                    : clientY > rect.bottom
                        ? clientY - rect.bottom
                        : 0
            )
            : Math.abs(clientY - (rect.top + (rect.height / 2)));
        if (distance < bestDistance) {
            best = candidate;
            bestDistance = distance;
        }
    }

    return best;
};

export const resolveDragTarget = (
    container: HTMLElement,
    clientY: number,
    dataAttr: string,
    excludedId: string | null,
    eventTarget: EventTarget | null,
    clientX?: number
): DragTarget | null => {
    const elements = Array.from(container.querySelectorAll<HTMLElement>(`[${dataAttr}]`));
    const candidates = elements
        .map((el) => ({ el, id: el.getAttribute(dataAttr) }))
        .filter((item): item is { el: HTMLElement; id: string } => !!item.id && item.id !== excludedId);

    if (candidates.length === 0) {
        return null;
    }

    const axis = typeof clientX === 'number' && Number.isFinite(clientX)
        ? resolveDragAxisFromRects(elements.map((element) => element.getBoundingClientRect()))
        : 'vertical';

    const hoveredEl = resolveClosestDragElement(eventTarget, container, dataAttr);
    const hoveredId = hoveredEl?.getAttribute(dataAttr) ?? null;
    if (excludedId !== null && hoveredId === excludedId) {
        return null;
    }
    const picked =
        hoveredEl && hoveredId
            ? { el: hoveredEl, id: hoveredId }
            : resolveNearestDragCandidate(candidates, clientY, clientX, axis);

    const rect = picked.el.getBoundingClientRect();
    return {
        id: picked.id,
        position: resolveDragPosition(rect, clientY, clientX, axis),
    };
};

const resolveInsertIndex = (
    draggedIndex: number,
    targetIndex: number,
    position: DropPosition
) => {
    const targetIndexAfterRemoval = draggedIndex < targetIndex ? targetIndex - 1 : targetIndex;
    return position === 'after' ? targetIndexAfterRemoval + 1 : targetIndexAfterRemoval;
};

export const moveItemWithDropPosition = <T,>(
    items: T[],
    draggedIndex: number,
    targetIndex: number,
    position: DropPosition
) => {
    if (draggedIndex === targetIndex) {
        return items;
    }

    const insertIndex = resolveInsertIndex(draggedIndex, targetIndex, position);
    if (insertIndex === draggedIndex) {
        return items;
    }

    const nextItems = [...items];
    const [dragged] = nextItems.splice(draggedIndex, 1);

    nextItems.splice(insertIndex, 0, dragged);
    return nextItems;
};

export type SortableDragStartHandler = (event: React.DragEvent, itemKey: string) => void;
