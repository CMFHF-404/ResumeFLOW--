import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JDAnalysisResult, JDCoreCapability } from '../../../services/aiService';

export const SUMMARY_CLAMP_STYLE: React.CSSProperties = {
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: 4,
    overflow: 'hidden',
};

const ANALYSIS_CARD_TRANSITION = 'cubic-bezier(0.22, 1, 0.36, 1)';
const MOBILE_POLISH_CARD_OPEN_DURATION_MS = 420;
const MOBILE_POLISH_CARD_CLOSE_DURATION_MS = 240;

const normalizeMobileDisplayText = (value: unknown) => (
    typeof value === 'string'
        ? value.replace(/[\u200B-\u200D\uFEFF]/g, '').trim()
        : ''
);

const getMobileArray = <T,>(value: unknown): T[] => (Array.isArray(value) ? value as T[] : []);

export const getMobileCapabilityFollowUpQuestion = (analysisResult: JDAnalysisResult | null) => (
    getMobileArray<JDCoreCapability>(analysisResult?.capabilityAnalysis?.coreCapabilities)
        .flatMap((item) => (
            item && typeof item === 'object'
                ? getMobileArray<unknown>(item.followUpQuestions)
                : []
        ))
        .map(normalizeMobileDisplayText)
        .find(Boolean) ?? ''
);

type MobileAnalysisCardMotionOptions = {
    showJdInput: boolean;
    isAnalysisCollapsed: boolean;
    batchPolishToolbar?: React.ReactNode;
    onCloseBatchPolishToolbar?: () => void;
};

export const useMobileAnalysisCardMotion = ({
    showJdInput,
    isAnalysisCollapsed,
    batchPolishToolbar,
    onCloseBatchPolishToolbar,
}: MobileAnalysisCardMotionOptions) => {
    const [analysisCardHeight, setAnalysisCardHeight] = useState<number | null>(null);
    const [isBatchPolishCardOpen, setIsBatchPolishCardOpen] = useState(false);
    const [analysisFlipCardHeight, setAnalysisFlipCardHeight] = useState<number | null>(null);
    const analysisCardContentRef = useRef<HTMLDivElement | null>(null);
    const summaryCardRef = useRef<HTMLDivElement | null>(null);
    const batchPolishCardRef = useRef<HTMLDivElement | null>(null);
    const batchPolishCloseTimerRef = useRef<number | null>(null);

    const isBatchPolishCardVisible = Boolean(batchPolishToolbar) && isBatchPolishCardOpen;
    const analysisFlipDurationMs = isBatchPolishCardVisible
        ? MOBILE_POLISH_CARD_OPEN_DURATION_MS
        : MOBILE_POLISH_CARD_CLOSE_DURATION_MS;

    const updateAnalysisFlipCardHeight = useCallback(() => {
        if (showJdInput) {
            setAnalysisFlipCardHeight(null);
            return;
        }
        const activeCard = isBatchPolishCardVisible ? batchPolishCardRef.current : summaryCardRef.current;
        const nextHeight = activeCard?.scrollHeight ?? null;
        setAnalysisFlipCardHeight(nextHeight);
    }, [isBatchPolishCardVisible, showJdInput]);

    useEffect(() => {
        if (batchPolishToolbar) {
            const frameId = window.requestAnimationFrame(() => {
                setIsBatchPolishCardOpen(true);
            });
            return () => window.cancelAnimationFrame(frameId);
        }
        setIsBatchPolishCardOpen(false);
        if (batchPolishCloseTimerRef.current !== null) {
            window.clearTimeout(batchPolishCloseTimerRef.current);
            batchPolishCloseTimerRef.current = null;
        }
        return undefined;
    }, [batchPolishToolbar]);

    useEffect(() => () => {
        if (batchPolishCloseTimerRef.current !== null) {
            window.clearTimeout(batchPolishCloseTimerRef.current);
        }
    }, []);

    useEffect(() => {
        updateAnalysisFlipCardHeight();
    }, [updateAnalysisFlipCardHeight]);

    useEffect(() => {
        const element = analysisCardContentRef.current;
        if (!element) {
            return;
        }

        const updateHeight = () => {
            setAnalysisCardHeight(element.scrollHeight);
        };

        updateHeight();

        if (typeof ResizeObserver === 'undefined') {
            window.addEventListener('resize', updateHeight);
            return () => {
                window.removeEventListener('resize', updateHeight);
            };
        }

        const observer = new ResizeObserver(() => {
            updateHeight();
        });

        observer.observe(element);
        return () => {
            observer.disconnect();
        };
    }, [showJdInput]);

    useEffect(() => {
        if (showJdInput) {
            return;
        }

        const updateHeight = () => {
            updateAnalysisFlipCardHeight();
        };

        updateHeight();

        if (typeof ResizeObserver === 'undefined') {
            window.addEventListener('resize', updateHeight);
            return () => {
                window.removeEventListener('resize', updateHeight);
            };
        }

        const observer = new ResizeObserver(() => {
            updateHeight();
        });

        if (summaryCardRef.current) {
            observer.observe(summaryCardRef.current);
        }
        if (batchPolishCardRef.current) {
            observer.observe(batchPolishCardRef.current);
        }

        return () => {
            observer.disconnect();
        };
    }, [batchPolishToolbar, showJdInput, updateAnalysisFlipCardHeight]);

    const analysisCardMotionStyle = useMemo<React.CSSProperties>(() => ({
        maxHeight: isAnalysisCollapsed ? 0 : (analysisCardHeight ? `${analysisCardHeight}px` : undefined),
        opacity: isAnalysisCollapsed ? 0 : 1,
        transform: `translateY(${isAnalysisCollapsed ? '-18px' : '0px'})`,
        transition: `max-height 320ms ${ANALYSIS_CARD_TRANSITION}, opacity 220ms ease, transform 320ms ${ANALYSIS_CARD_TRANSITION}`,
    }), [analysisCardHeight, isAnalysisCollapsed]);

    const handleCloseBatchPolishCard = useCallback(() => {
        const summaryHeight = summaryCardRef.current?.scrollHeight ?? null;
        setAnalysisFlipCardHeight(summaryHeight);
        setIsBatchPolishCardOpen(false);
        if (batchPolishCloseTimerRef.current !== null) {
            window.clearTimeout(batchPolishCloseTimerRef.current);
        }
        batchPolishCloseTimerRef.current = window.setTimeout(() => {
            onCloseBatchPolishToolbar?.();
            batchPolishCloseTimerRef.current = null;
        }, MOBILE_POLISH_CARD_CLOSE_DURATION_MS + 20);
    }, [onCloseBatchPolishToolbar]);

    return {
        analysisCardContentRef,
        summaryCardRef,
        batchPolishCardRef,
        isBatchPolishCardVisible,
        analysisFlipDurationMs,
        analysisFlipCardHeight,
        analysisCardMotionStyle,
        handleCloseBatchPolishCard,
    };
};
