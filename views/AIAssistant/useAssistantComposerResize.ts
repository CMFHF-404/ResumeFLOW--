import { useCallback, useEffect, useRef, useState } from 'react';
import { computeComposerReservedHeight } from './layoutUtils';

export const useAssistantComposerResize = () => {
  const [composerReservedHeight, setComposerReservedHeight] = useState(160);
  const messageViewportRef = useRef<HTMLDivElement | null>(null);
  const composerContainerRef = useRef<HTMLDivElement | null>(null);
  const composerHeightRef = useRef<number | null>(null);

  const scrollToBottom = useCallback(() => {
    if (!messageViewportRef.current) {
      return;
    }
    messageViewportRef.current.scrollTop = messageViewportRef.current.scrollHeight;
  }, []);

  useEffect(() => {
    const composer = composerContainerRef.current;
    const viewport = messageViewportRef.current;
    if (!composer || !viewport) {
      return;
    }

    const syncComposerResize = () => {
      const previousHeight = composerHeightRef.current;
      const nextHeight = composer.offsetHeight;
      composerHeightRef.current = nextHeight;
      const nextReservedHeight = computeComposerReservedHeight(nextHeight);
      setComposerReservedHeight((current) => (current === nextReservedHeight ? current : nextReservedHeight));

      if (previousHeight === null || nextHeight === previousHeight) {
        return;
      }

      const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
      const growthAllowance = Math.max(24, nextHeight - previousHeight + 24);
      if (distanceFromBottom <= growthAllowance) {
        requestAnimationFrame(() => {
          scrollToBottom();
        });
      }
    };

    syncComposerResize();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', syncComposerResize);
      return () => window.removeEventListener('resize', syncComposerResize);
    }

    const observer = new ResizeObserver(() => {
      syncComposerResize();
    });
    observer.observe(composer);
    window.addEventListener('resize', syncComposerResize);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', syncComposerResize);
    };
  }, [scrollToBottom]);

  return {
    messageViewportRef,
    composerContainerRef,
    composerReservedHeight,
    scrollToBottom,
  };
};
