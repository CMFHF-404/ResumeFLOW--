import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';

export const ASSISTANT_SIDEBAR_MIN_WIDTH = 390;
export const getAssistantSidebarMaxWidth = (containerWidth: number) => Math.max(ASSISTANT_SIDEBAR_MIN_WIDTH, containerWidth - 360);
export const clampAssistantSidebarWidth = (width: number, containerWidth: number) => Math.min(getAssistantSidebarMaxWidth(containerWidth), Math.max(ASSISTANT_SIDEBAR_MIN_WIDTH, width));

export function useAssistantSidebarResize() {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; x: number; width: number } | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [preferredWidth, setPreferredWidth] = useState(ASSISTANT_SIDEBAR_MIN_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const width = clampAssistantSidebarWidth(preferredWidth, containerWidth);
  const maxWidth = getAssistantSidebarMaxWidth(containerWidth);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const measure = () => setContainerWidth(container.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, width };
    setIsResizing(true);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setPreferredWidth(clampAssistantSidebarWidth(drag.width + drag.x - event.clientX, containerWidth));
  };
  const stopResize = () => { dragRef.current = null; setIsResizing(false); };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = event.key === 'ArrowLeft' ? width + 20
      : event.key === 'ArrowRight' ? width - 20
      : event.key === 'Home' ? ASSISTANT_SIDEBAR_MIN_WIDTH
      : event.key === 'End' ? maxWidth : null;
    if (next === null) return;
    event.preventDefault();
    setPreferredWidth(clampAssistantSidebarWidth(next, containerWidth));
  };
  return { containerRef, width, maxWidth, isResizing, onPointerDown, onPointerMove, stopResize, onKeyDown };
}
