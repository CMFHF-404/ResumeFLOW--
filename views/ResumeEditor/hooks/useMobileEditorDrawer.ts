import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { waitForNextFrame } from '../snapshotUtils';

const MOBILE_EDITOR_DRAWER_ANIMATION_MS = 320;

export type MobileWorkbenchPage = 'information' | 'analysis' | 'assistant';

type UseMobileEditorDrawerOptions = {
    ownerKey?: string;
    mobileDrawerOpenRequest: number;
    onMobileDrawerOpenRequestConsumed?: () => void;
    scrollContainerRef: RefObject<HTMLDivElement>;
    setSidebarTab: (tab: 'profile' | 'experience') => void;
};

export const useMobileEditorDrawer = ({
    ownerKey,
    mobileDrawerOpenRequest,
    onMobileDrawerOpenRequestConsumed,
    scrollContainerRef,
    setSidebarTab,
}: UseMobileEditorDrawerOptions) => {
    const [stateOwnerKey, setStateOwnerKey] = useState(ownerKey);
    const isOwnerMatched = stateOwnerKey === ownerKey;
    const [page, setPage] = useState<MobileWorkbenchPage>('information');
    const [reportTab, setReportTab] = useState<'jd' | 'resume'>('jd');
    const [hasOpened, setHasOpened] = useState(false);
    const [hasOpenedAssistant, setHasOpenedAssistant] = useState(false);
    const [isOpen, setIsOpen] = useState(false);
    const [isVisible, setIsVisible] = useState(false);
    const timerRef = useRef<number | null>(null);
    const cancelOpenFrameRef = useRef<(() => void) | null>(null);

    const clearDrawerTimer = useCallback(() => {
        if (timerRef.current !== null) {
            window.clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    }, []);

    const clearOpenFrame = useCallback(() => {
        cancelOpenFrameRef.current?.();
        cancelOpenFrameRef.current = null;
    }, []);

    const open = useCallback((target?: MobileWorkbenchPage) => {
        if (target) setPage(target);
        if (target === 'assistant') setHasOpenedAssistant(true);
        setHasOpened(true);
        clearDrawerTimer();
        clearOpenFrame();
        setIsOpen(true);
        cancelOpenFrameRef.current = waitForNextFrame(() => {
            cancelOpenFrameRef.current = null;
            setIsVisible(true);
        });
    }, [clearDrawerTimer, clearOpenFrame]);

    const dismissImmediately = useCallback(() => {
        clearDrawerTimer();
        clearOpenFrame();
        setIsVisible(false);
        setIsOpen(false);
    }, [clearDrawerTimer, clearOpenFrame]);

    const close = useCallback(() => {
        clearOpenFrame();
        setIsVisible(false);
        clearDrawerTimer();
        timerRef.current = window.setTimeout(() => {
            setIsOpen(false);
            timerRef.current = null;
        }, MOBILE_EDITOR_DRAWER_ANIMATION_MS);
    }, [clearDrawerTimer, clearOpenFrame]);

    useEffect(() => {
        dismissImmediately();
        setStateOwnerKey(ownerKey);
        setPage('information');
        setReportTab('jd');
        setHasOpened(false);
        setHasOpenedAssistant(false);
    }, [ownerKey, dismissImmediately]);

    useEffect(() => {
        if (mobileDrawerOpenRequest <= 0 || typeof window === 'undefined') {
            return;
        }
        onMobileDrawerOpenRequestConsumed?.();
        if (window.innerWidth >= 768) {
            return;
        }
        setSidebarTab('experience');
        open('information');
    }, [mobileDrawerOpenRequest, onMobileDrawerOpenRequestConsumed, open, setSidebarTab]);

    useEffect(() => {
        if (!isOpen) {
            return;
        }
        const scrollContainer = scrollContainerRef.current;
        const previousContainerOverflow = scrollContainer?.style.overflow ?? '';
        if (scrollContainer) {
            scrollContainer.style.overflow = 'hidden';
        }
        return () => {
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
            clearOpenFrame();
        };
    }, [clearDrawerTimer, clearOpenFrame]);

    return {
        page: isOwnerMatched ? page : 'information' as const,
        reportTab: isOwnerMatched ? reportTab : 'jd' as const,
        setReportTab,
        hasOpened: isOwnerMatched && hasOpened,
        hasOpenedAssistant: isOwnerMatched && hasOpenedAssistant,
        isOpen: isOwnerMatched && isOpen,
        isVisible: isOwnerMatched && isVisible,
        open,
        close,
        dismissImmediately,
    };
};
