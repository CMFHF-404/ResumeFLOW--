import type React from 'react';

export type DropPosition = 'before' | 'after';

export type DragTarget = {
    id: string;
    position: DropPosition;
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
    clientY: number
) => {
    let best = candidates[0];
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const candidate of candidates) {
        const rect = candidate.el.getBoundingClientRect();
        const midpoint = rect.top + rect.height / 2;
        const distance = Math.abs(clientY - midpoint);
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
    eventTarget: EventTarget | null
): DragTarget | null => {
    const elements = Array.from(container.querySelectorAll<HTMLElement>(`[${dataAttr}]`));
    const candidates = elements
        .map((el) => ({ el, id: el.getAttribute(dataAttr) }))
        .filter((item): item is { el: HTMLElement; id: string } => !!item.id && item.id !== excludedId);

    if (candidates.length === 0) {
        return null;
    }

    const hoveredEl = resolveClosestDragElement(eventTarget, container, dataAttr);
    const hoveredId = hoveredEl?.getAttribute(dataAttr) ?? null;
    const picked =
        hoveredEl && hoveredId && hoveredId !== excludedId
            ? { el: hoveredEl, id: hoveredId }
            : resolveNearestDragCandidate(candidates, clientY);

    const rect = picked.el.getBoundingClientRect();
    const midpoint = rect.top + rect.height / 2;
    return { id: picked.id, position: clientY < midpoint ? 'before' : 'after' };
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

