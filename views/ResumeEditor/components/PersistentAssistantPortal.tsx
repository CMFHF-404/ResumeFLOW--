import React, { useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/** Move the DOM host between layouts without remounting the assistant session. */
export default function PersistentAssistantPortal({ container, children }: {
    container: HTMLElement | null;
    children: React.ReactNode;
}) {
    const [host] = useState(() => {
        const element = document.createElement('div');
        element.className = 'h-full min-h-0 w-full';
        return element;
    });
    useLayoutEffect(() => {
        container?.appendChild(host);
        return () => { host.remove(); };
    }, [container, host]);
    return createPortal(children, host);
}
