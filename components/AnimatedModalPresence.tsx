import React from 'react';
import { useExitContent } from '../hooks/useUiMotion';

/** Retain only the last rendered view for an inert exit, not the request lifecycle. */
export default function AnimatedModalPresence({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) {
  const content = useExitContent(isOpen ? children : null);
  if (!content) return null;
  return <div aria-hidden={!isOpen || undefined} inert={!isOpen ? true : undefined} data-modal-motion={isOpen ? 'enter' : 'exit'} className={`fixed inset-0 z-[80] ${isOpen ? 'rf-overlay-enter' : 'pointer-events-none rf-overlay-exit'}`}>
    {content}
  </div>;
}
