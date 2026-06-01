import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { JDAnalysisResult } from '../../../services/aiService';
import { UNTITLED_RESUME_TITLE } from '../../../constants/resumeConstants';
import { DEFAULT_MATCH_SCORE_FILTER } from '../constants';
import {
    normalizeResumeTitle,
    resolveAutoResumeName,
} from '../autoNameUtils';

type MatchScoreFilterSource = 'manual' | 'auto';

type UseResumeEditorJdPanelStateParams = {
    resumeId: string | null;
    analysisResult: JDAnalysisResult | null;
    isOutdated: boolean;
    jdText: string;
    resumeName: string;
    setJdText: Dispatch<SetStateAction<string>>;
    setIsJDCollapsed: Dispatch<SetStateAction<boolean>>;
    applyResumeNameUpdate: (nextName: string, options?: { silent?: boolean }) => Promise<void>;
};

export const useResumeEditorJdPanelState = ({
    resumeId,
    analysisResult,
    isOutdated,
    jdText,
    resumeName,
    setJdText,
    setIsJDCollapsed,
    applyResumeNameUpdate,
}: UseResumeEditorJdPanelStateParams) => {
    const [matchScoreFilter, setMatchScoreFilter] = useState(DEFAULT_MATCH_SCORE_FILTER);
    const [matchScoreFilterSource, setMatchScoreFilterSource] = useState<MatchScoreFilterSource>('manual');
    const previousMatchScoreFilterResumeIdRef = useRef<string | null>(null);

    const handleToggleJdCollapse = useCallback(() => {
        setIsJDCollapsed((prev) => !prev);
    }, [setIsJDCollapsed]);

    const resetAutoDerivedMatchScoreFilter = useCallback(() => {
        setMatchScoreFilter(DEFAULT_MATCH_SCORE_FILTER);
        setMatchScoreFilterSource('manual');
    }, []);

    const handleMatchScoreFilterChange = useCallback((value: number) => {
        setMatchScoreFilter(value);
        setMatchScoreFilterSource('manual');
    }, []);

    const handleJdTextChange = useCallback(
        (value: string) => {
            const nextJdText = value.trim();
            const currentAutoName = resolveAutoResumeName(analysisResult, jdText);
            setJdText(value);
            if (
                nextJdText === ''
                && currentAutoName
                && normalizeResumeTitle(resumeName) === currentAutoName
            ) {
                void applyResumeNameUpdate(UNTITLED_RESUME_TITLE, { silent: true });
            }
        },
        [analysisResult, applyResumeNameUpdate, jdText, resumeName, setJdText]
    );

    const showDebugInfo = useMemo(
        () => import.meta.env.DEV && localStorage.getItem('jdDebug') === '1',
        []
    );

    useEffect(() => {
        if (previousMatchScoreFilterResumeIdRef.current === resumeId) {
            return;
        }
        previousMatchScoreFilterResumeIdRef.current = resumeId;
        if (matchScoreFilterSource !== 'auto') {
            return;
        }
        resetAutoDerivedMatchScoreFilter();
    }, [matchScoreFilterSource, resetAutoDerivedMatchScoreFilter, resumeId]);

    useEffect(() => {
        if (matchScoreFilterSource !== 'auto' || (analysisResult && !isOutdated)) {
            return;
        }
        resetAutoDerivedMatchScoreFilter();
    }, [analysisResult, isOutdated, matchScoreFilterSource, resetAutoDerivedMatchScoreFilter]);

    return {
        matchScoreFilter,
        setMatchScoreFilter,
        setMatchScoreFilterSource,
        handleToggleJdCollapse,
        handleMatchScoreFilterChange,
        handleJdTextChange,
        showDebugInfo,
    };
};
