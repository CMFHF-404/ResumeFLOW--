import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { waitForNextFrame } from '../snapshotUtils';

const MOBILE_EDITOR_DRAWER_ANIMATION_MS = 320;

type UseMobileEditorDrawerOptions = {
    mobileDrawerOpenRequest: number;
    onMobileDrawerOpenRequestConsumed?: () => void;
    scrollContainerRef: RefObject<HTMLDivElement>;
    setSidebarTab: (tab: 'profile' | 'experience') => void;
};

export const useMobileEditorDrawer = ({
    mobileDrawerOpenRequest,
    onMobileDrawerOpenRequestConsumed,
    scrollContainerRef,
    setSidebarTab,
}: UseMobileEditorDrawerOptions) => {
    const [isOpen, setIsOpen] = useState(false);
    const [isVisible, setIsVisible] = useState(false);
    const timerRef = useRef<number | null>(null);

    const clearDrawerTimer = useCallback(() => {
        if (timerRef.current !== null) {
            window.clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    }, []);

    const open = useCallback(() => {
        clearDrawerTimer();
        setIsOpen(true);
        waitForNextFrame(() => {
            setIsVisible(true);
        });
    }, [clearDrawerTimer]);

    const dismissImmediately = useCallback(() => {
        clearDrawerTimer();
        setIsVisible(false);
        setIsOpen(false);
    }, [clearDrawerTimer]);

    const close = useCallback(() => {
        setIsVisible(false);
        clearDrawerTimer();
        timerRef.current = window.setTimeout(() => {
            setIsOpen(false);
            timerRef.current = null;
        }, MOBILE_EDITOR_DRAWER_ANIMATION_MS);
    }, [clearDrawerTimer]);

    useEffect(() => {
        if (mobileDrawerOpenRequest <= 0 || typeof window === 'undefined') {
            return;
        }
        onMobileDrawerOpenRequestConsumed?.();
        if (window.innerWidth >= 768) {
            return;
        }
        setSidebarTab('experience');
        open();
    }, [mobileDrawerOpenRequest, onMobileDrawerOpenRequestConsumed, open, setSidebarTab]);

    useEffect(() => {
        if (!isOpen) {
            return;
        }
        const scrollContainer = scrollContainerRef.current;
        const { overflow } = document.body.style;
        document.body.style.overflow = 'hidden';
        const previousContainerOverflow = scrollContainer?.style.overflow ?? '';
        if (scrollContainer) {
            scrollContainer.style.overflow = 'hidden';
        }
        return () => {
            document.body.style.overflow = overflow;
            if (scrollContainer) {
                scrollContainer.style.overflow = previousContainerOverflow;
            }
        };
    }, [isOpen, scrollContainerRef]);

    useEffect(() => {
        if (!isOpen || typeof window === 'undefined') {
            return;
        }
        const handleResize = () => {
            if (window.innerWidth >= 768) {
                dismissImmediately();
            }
        };
        window.addEventListener('resize', handleResize);
        return () => {
            window.removeEventListener('resize', handleResize);
        };
    }, [dismissImmediately, isOpen]);

    useEffect(() => {
        return () => {
            clearDrawerTimer();
        };
    }, [clearDrawerTimer]);

    return {
        isOpen,
        isVisible,
        open,
        close,
        dismissImmediately,
    };
};
