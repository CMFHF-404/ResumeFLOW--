import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

export function useExitContent<T>(content: T | null, duration = 160): T | null {
  const [retained, setRetained] = useState<T | null>(content);
  useEffect(() => {
    if (content !== null) { setRetained(() => content); return; }
    const delay = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : duration;
    const timer = window.setTimeout(() => setRetained(null), delay);
    return () => window.clearTimeout(timer);
  }, [content, duration]);
  return content ?? retained;
}

/** Animate the dialog box itself; leave content unscaled and its layout intrinsic. */
export function useAnimatedDialogSize(ref: RefObject<HTMLElement | null>, enabled: boolean) {
  const previous = useRef<{ width: number; height: number } | null>(null);
  const animation = useRef<Animation | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!enabled || !element) { animation.current?.cancel(); previous.current = null; return; }
    const current = { width: element.offsetWidth, height: element.offsetHeight };
    const wasRunning = animation.current?.playState === 'running';
    animation.current?.cancel();
    const target = { width: element.offsetWidth, height: element.offsetHeight };
    const from = wasRunning ? current : previous.current;
    previous.current = { width: target.width, height: target.height };
    if (!from || window.matchMedia('(prefers-reduced-motion: reduce)').matches || typeof element.animate !== 'function') return;
    if (Math.abs(from.width - target.width) < 1 && Math.abs(from.height - target.height) < 1) return;
    animation.current = element.animate([
      { width: `${from.width}px`, height: `${from.height}px` },
      { width: `${target.width}px`, height: `${target.height}px` },
    ], { duration: 240, easing: 'cubic-bezier(.22,1,.36,1)' });
  });
  useEffect(() => () => animation.current?.cancel(), []);
}
