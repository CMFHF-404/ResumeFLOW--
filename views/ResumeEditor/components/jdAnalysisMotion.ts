import { useLayoutEffect, useRef, useState } from 'react';

const JD_ANALYSIS_STATUS_EXIT_MS = 180;

type JDAnalysisMotionPhase = 'idle' | 'enter' | 'exit';

export const useJDAnalysisMotion = (isAnalyzing: boolean) => {
    const [phase, setPhase] = useState<JDAnalysisMotionPhase>(isAnalyzing ? 'enter' : 'idle');
    const previousIsAnalyzingRef = useRef(isAnalyzing);

    useLayoutEffect(() => {
        const wasAnalyzing = previousIsAnalyzingRef.current;
        previousIsAnalyzingRef.current = isAnalyzing;

        if (isAnalyzing) {
            setPhase('enter');
            return undefined;
        }

        if (!wasAnalyzing) {
            setPhase('idle');
            return undefined;
        }

        setPhase('exit');
        const timer = window.setTimeout(() => {
            setPhase('idle');
        }, JD_ANALYSIS_STATUS_EXIT_MS);
        return () => window.clearTimeout(timer);
    }, [isAnalyzing]);

    const visiblePhase: JDAnalysisMotionPhase = isAnalyzing && phase === 'idle' ? 'enter' : phase;

    return {
        idleControlsMotionClass: 'jd-analysis-controls-return',
        isStatusExiting: visiblePhase === 'exit',
        shouldRenderStatus: visiblePhase !== 'idle',
        statusMotionClass: visiblePhase === 'exit'
            ? 'jd-analysis-status-motion jd-analysis-status-exit'
            : 'jd-analysis-status-motion jd-analysis-status-enter',
    };
};
