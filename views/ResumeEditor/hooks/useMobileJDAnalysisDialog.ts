import { useCallback, useEffect, useRef, useState } from 'react';

export const MOBILE_ANALYSIS_MEDIA_QUERY = '(max-width: 767px)';

type UseMobileJDAnalysisDialogOptions = {
    isOpen: boolean;
    onClose: () => void;
};

export const useMobileJDAnalysisDialog = ({
    isOpen,
    onClose,
}: UseMobileJDAnalysisDialogOptions) => {
    const [isMobileAnalysisViewport, setIsMobileAnalysisViewport] = useState(() => (
        typeof window !== 'undefined'
        && window.matchMedia(MOBILE_ANALYSIS_MEDIA_QUERY).matches
    ));
    const mobileAnalysisDialogRef = useRef<HTMLDivElement>(null);
    const mobileAnalysisReturnFocusRef = useRef<HTMLElement | null>(null);

    const captureReturnFocus = useCallback(() => {
        mobileAnalysisReturnFocusRef.current = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
    }, []);

    useEffect(() => {
        const mediaQuery = window.matchMedia(MOBILE_ANALYSIS_MEDIA_QUERY);
        const syncViewport = () => setIsMobileAnalysisViewport(mediaQuery.matches);
        syncViewport();
        mediaQuery.addEventListener('change', syncViewport);
        return () => mediaQuery.removeEventListener('change', syncViewport);
    }, []);

    useEffect(() => {
        if (!isOpen || !isMobileAnalysisViewport) {
            return;
        }
        const dialog = mobileAnalysisDialogRef.current;
        if (!dialog) {
            return;
        }
        const focusableSelector = [
            'button:not([disabled])',
            '[href]',
            'input:not([disabled])',
            'select:not([disabled])',
            'textarea:not([disabled])',
            '[tabindex]:not([tabindex="-1"])',
        ].join(',');
        const siblings = Array.from(dialog.parentElement?.children ?? [])
            .filter((element): element is HTMLElement => (
                element instanceof HTMLElement && element !== dialog
            ));
        const siblingStates = siblings.map((element) => ({
            element,
            inert: element.inert,
            ariaHidden: element.getAttribute('aria-hidden'),
        }));
        siblingStates.forEach(({ element }) => {
            element.inert = true;
            element.setAttribute('aria-hidden', 'true');
        });
        const previousBodyOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        const focusDialog = () => {
            const firstFocusable = dialog.querySelector<HTMLElement>(focusableSelector);
            (firstFocusable ?? dialog).focus();
        };
        const handleDialogKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                onClose();
                return;
            }
            if (event.key !== 'Tab') {
                return;
            }
            const focusableElements = Array.from(
                dialog.querySelectorAll<HTMLElement>(focusableSelector)
            );
            if (!focusableElements.length) {
                event.preventDefault();
                dialog.focus();
                return;
            }
            const firstFocusable = focusableElements[0];
            const lastFocusable = focusableElements[focusableElements.length - 1];
            if (event.shiftKey && document.activeElement === firstFocusable) {
                event.preventDefault();
                lastFocusable.focus();
            } else if (!event.shiftKey && document.activeElement === lastFocusable) {
                event.preventDefault();
                firstFocusable.focus();
            }
        };

        document.addEventListener('keydown', handleDialogKeyDown);
        const focusTimer = window.setTimeout(focusDialog, 0);
        return () => {
            window.clearTimeout(focusTimer);
            document.removeEventListener('keydown', handleDialogKeyDown);
            document.body.style.overflow = previousBodyOverflow;
            siblingStates.forEach(({ element, inert, ariaHidden }) => {
                element.inert = inert;
                if (ariaHidden === null) {
                    element.removeAttribute('aria-hidden');
                } else {
                    element.setAttribute('aria-hidden', ariaHidden);
                }
            });
            const returnFocusElement = mobileAnalysisReturnFocusRef.current;
            if (
                window.matchMedia(MOBILE_ANALYSIS_MEDIA_QUERY).matches
                && returnFocusElement?.isConnected
                && returnFocusElement.getClientRects().length > 0
            ) {
                returnFocusElement.focus();
            }
        };
    }, [isMobileAnalysisViewport, isOpen, onClose]);

    return {
        captureReturnFocus,
        isMobileAnalysisViewport,
        mobileAnalysisDialogRef,
    };
};
