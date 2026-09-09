import React from 'react';
import { useExitContent } from '../../../hooks/useUiMotion';

/** Keep the last drawer frame visible, but inert, until its exit completes. */
export default function TemplateCustomizationPresence({ isOpen, enabled, children }: {
    isOpen: boolean;
    enabled: boolean;
    children: React.ReactNode;
}) {
    const content = useExitContent(enabled ? children : null, 220);
    if (!enabled) return children;
    if (!content || (isOpen && !children)) return null;
    return <div data-template-customization-motion={isOpen ? 'enter' : 'exit'}
        aria-hidden={!isOpen || undefined} inert={!isOpen ? true : undefined}
        className={`fixed inset-0 z-[100] ${isOpen ? '' : 'pointer-events-none'}`}>
        {content}
    </div>;
}
