import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  aiService,
  JDAnalysisResult,
} from "../services/aiService";
import { devLog } from "../services/devLogger";
import {
  buildJDAnalysisPersistenceFingerprint,
  clearJDAnalysisCache,
  loadJDAnalysisCache,
  normalizeJDAnalysisPersistence,
  saveJDAnalysisCache,
  selectPreferredPersistedJDAnalysis,
} from "../views/jdAnalysisStorage";
import {
  diffJDItemSignatures,
  sortExperienceItemsForMatch,
} from "../utils/resumeHelpers";
import { extractThoughtHeadline } from "../utils/aiThought";
import { JD_ANALYSIS_PROGRESS_NODE_TITLES } from "../views/ResumeEditor/constants";
import type {
  JDAnalysisContext,
  JDAnalysisItemSignatures,
  MatchTrend,
} from "../types/analysis";
import type {
  CertificationView,
  ResumeJDAnalysis,
  ResumeExperienceView,
  SkillGroupView,
} from "../types/resume";
import {
  buildEmptyDiff,
  clearDiffTargets,
  hasDiff,
  mergeDiffInto,
  type JDItemDiff,
} from "./jdAnalysisDiffUtils";
import { type MatchUpdateMode } from "./jdAnalysisMatchUtils";
import {
  arePersistedJDAnalysisEqual,
  buildAnalyzeSignature,
  buildEmptyJDItemSignatures,
  buildExperienceTextSnapshot,
  buildJDInputSignature,
  buildJDItemSignatures,
} from "./jdAnalysisSignatureUtils";
import {
  type JDAnalyzeRequestSnapshot,
} from "./jdAnalysisRequestRunner";
import {
  buildResumeJDAnalysisPayload,
  normalizePersistedAnalysisForState,
  type AnalysisStatePayload,
} from "./jdAnalysisPersistenceUtils";
import {
  resolveAnalyzeDiffStateUpdate,
  resolveJDAnalyzePlan,
} from "./jdAnalysisRunStateUtils";
import { useJDAnalysisMatchState } from "./useJDAnalysisMatchState";
import {
  runJDAnalysisExecution,
  type JDAnalyzeOutcome,
  type JDAnalyzeProgressHandler,
  type JDAnalyzeStreamHandler,
} from "./useJDAnalysisExecution";
import { appendJDThinkingText } from "./jdAnalysisThinkingText";

const DEFAULT_JD_TEXT = "";
type UseJDAnalysisOptions = {
  resumeId: string | null;
  persistedJDAnalysis?: ResumeJDAnalysis | null;
  onPersistedJDAnalysisChange?: (
    value: ResumeJDAnalysis | null | undefined
  ) => void;
  experienceItems: ResumeExperienceView[];
  setExperienceItems: Dispatch<SetStateAction<ResumeExperienceView[]>>;
  certifications: CertificationView[];
  skillGroups: SkillGroupView[];
  isLoadingResume: boolean;
  isLoadingExperiences: boolean;
  authUserKey?: string | null;
};

type HandleAnalyzeOptions = {
  onProgress?: JDAnalyzeProgressHandler;
  onEvent?: JDAnalyzeStreamHandler;
};

type UseJDAnalysisResult = {
  jdText: string;
  setJdText: Dispatch<SetStateAction<string>>;
  /** 当前已选的 JD 附件（图像或 PDF/DOCX），null 表示文本输入模式 */
  jdFile: File | null;
  setJdFile: Dispatch<SetStateAction<File | null>>;
  analysisResult: JDAnalysisResult | null;
  isAnalyzing: boolean;
  isJDCollapsed: boolean;
  setIsJDCollapsed: Dispatch<SetStateAction<boolean>>;
  staleExperienceIds: Set<string>;
  certificationMatchScores: Map<string, number>;
  setCertificationMatchScores: Dispatch<SetStateAction<Map<string, number>>>;
  certificationMatchTrends: Map<string, MatchTrend>;
  setCertificationMatchTrends: Dispatch<SetStateAction<Map<string, MatchTrend>>>;
  skillMatchScores: Map<string, number>;
  setSkillMatchScores: Dispatch<SetStateAction<Map<string, number>>>;
  skillMatchTrends: Map<string, MatchTrend>;
  setSkillMatchTrends: Dispatch<SetStateAction<Map<string, MatchTrend>>>;
  handleAnalyze: (options?: HandleAnalyzeOptions) => Promise<JDAnalyzeOutcome>;
  hasMissingAttachmentContext: boolean;
  persistedJDAnalysis: ResumeJDAnalysis | null | undefined;
  debugInfo?: any;
  isOutdated: boolean;
  thinkingText: string;
  handleStopAnalysis: () => void;
};

export const useJDAnalysis = ({
  resumeId,
  persistedJDAnalysis: persistedJDAnalysisConfig,
  onPersistedJDAnalysisChange,
  experienceItems,
  setExperienceItems,
  certifications,
  skillGroups,
  isLoadingResume,
  isLoadingExperiences,
  authUserKey,
}: UseJDAnalysisOptions): UseJDAnalysisResult => {
  const [jdText, setJdText] = useState(DEFAULT_JD_TEXT);
  const [jdFile, setJdFile] = useState<File | null>(null);
  const jdFileRef = useRef<File | null>(null);
  const [attachmentExtractedText, setAttachmentExtractedText] = useState<string | null>(null);
  const [restoredAttachmentContext, setRestoredAttachmentContext] = useState<{
    jdText: string;
    jdInputSignature: string;
  } | null>(null);
  const [analysisResult, setAnalysisResult] = useState<JDAnalysisResult | null>(
    null
  );
  const [persistedJDAnalysis, setPersistedJDAnalysis] =
    useState<ResumeJDAnalysis | null | undefined>(undefined);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [thinkingText, setThinkingText] = useState("");
  const abortControllerRef = useRef<AbortController | null>(null);
  const analysisRunIdRef = useRef(0);
  const activeAnalysisRunIdRef = useRef(0);
  const [isJDCollapsed, setIsJDCollapsed] = useState(false);
  const [analysisContext, setAnalysisContext] =
    useState<JDAnalysisContext | null>(null);
  const [debugInfo, setDebugInfo] = useState<any>(null);
  const [needsReanalysis, setNeedsReanalysis] = useState(false);
  const hasLoadedJdCacheRef = useRef(false);
  const pendingDiffRef = useRef<JDItemDiff>(buildEmptyDiff());
  const experienceItemsRef = useRef(experienceItems);
  const certificationsRef = useRef(certifications);
  const skillGroupsRef = useRef(skillGroups);
  const jdTextRef = useRef(jdText);
  const {
    staleExperienceIds,
    resetStaleExperienceIds,
    certificationMatchScores,
    setCertificationMatchScores,
    certificationMatchTrends,
    setCertificationMatchTrends,
    skillMatchScores,
    setSkillMatchScores,
    skillMatchTrends,
    setSkillMatchTrends,
    applyExperienceMatchScores,
    applyExperienceMatchTrends,
    applyCertificationMatchScores,
    applyCertificationMatchTrends,
    applySkillMatchScores,
    applySkillMatchTrends,
    applyMatchScoresForResult,
    markStaleMatches,
    clearStaleExperienceIds,
  } = useJDAnalysisMatchState({
    setExperienceItems,
    skillGroupsRef,
  });

  useEffect(() => {
    jdFileRef.current = jdFile;
  }, [jdFile]);


  useEffect(() => {
    experienceItemsRef.current = experienceItems;
  }, [experienceItems]);

  useEffect(() => {
    certificationsRef.current = certifications;
  }, [certifications]);

  useEffect(() => {
    skillGroupsRef.current = skillGroups;
  }, [skillGroups]);

  useEffect(() => {
    jdTextRef.current = jdText;
  }, [jdText]);

  useEffect(() => {
    onPersistedJDAnalysisChange?.(persistedJDAnalysis);
  }, [onPersistedJDAnalysisChange, persistedJDAnalysis]);

  const experienceSignature = useMemo(
    () => buildAnalyzeSignature(experienceItems, certifications, skillGroups),
    [certifications, experienceItems, skillGroups]
  );
  const liveJdInputSignature = useMemo(
    () => buildJDInputSignature(jdText, jdFile),
    [jdFile, jdText]
  );
  const jdInputSignature = useMemo(() => {
    if (
      !jdFile &&
      restoredAttachmentContext &&
      restoredAttachmentContext.jdText === jdText
    ) {
      return restoredAttachmentContext.jdInputSignature;
    }
    return liveJdInputSignature;
  }, [jdFile, jdText, liveJdInputSignature, restoredAttachmentContext]);

  const isOutdated = useMemo(() => {
    if (!analysisResult || !analysisContext) {
      return true;
    }
    return (
      analysisContext.jdInputSignature !== jdInputSignature || needsReanalysis
    );
  }, [analysisContext, analysisResult, jdInputSignature, needsReanalysis]);
  const hasMissingAttachmentContext = Boolean(restoredAttachmentContext && !jdFile);

  const applyPersistedAnalysisState = useCallback(
    (payload: ResumeJDAnalysis) => {
      const normalizedPayload = normalizePersistedAnalysisForState(
        payload,
        buildEmptyJDItemSignatures()
      );

      setJdText(normalizedPayload.jdText);
      setAttachmentExtractedText(normalizedPayload.attachmentExtractedText ?? null);
      setAnalysisResult(normalizedPayload.result);
      setPersistedJDAnalysis(normalizedPayload);
      setAnalysisContext({
        jdInputSignature: normalizedPayload.jdInputSignature,
        experienceSignature: normalizedPayload.experienceSignature,
        itemSignatures: normalizedPayload.itemSignatures,
        experienceText: normalizedPayload.experienceText,
      });
      setRestoredAttachmentContext(
        normalizedPayload.inputMode === "attachment"
          ? {
            jdText: normalizedPayload.jdText,
            jdInputSignature: normalizedPayload.jdInputSignature,
          }
          : null
      );

      const skillMatches = normalizedPayload.result.skillMatches ?? [];
      applyExperienceMatchScores(normalizedPayload.result.experienceMatches);
      applyExperienceMatchTrends(normalizedPayload.result.experienceMatches);
      applyCertificationMatchScores(normalizedPayload.result.certificationMatches);
      applyCertificationMatchTrends(normalizedPayload.result.certificationMatches);
      applySkillMatchScores(skillMatches);
      applySkillMatchTrends(skillMatches);
      setIsJDCollapsed(true);
      resetStaleExperienceIds();
      setNeedsReanalysis(false);
      setDebugInfo(null);
      pendingDiffRef.current = buildEmptyDiff();

      return normalizedPayload;
    },
    [
      applyCertificationMatchScores,
      applyCertificationMatchTrends,
      applyExperienceMatchScores,
      applyExperienceMatchTrends,
      applySkillMatchScores,
      applySkillMatchTrends,
      resetStaleExperienceIds,
    ]
  );

  const resetJDAnalysisState = useCallback(
    (options?: {
      resetJdText?: boolean;
      resetJdFile?: boolean;
      clearCache?: boolean;
      resetPersistedJDAnalysis?: boolean;
    }) => {
      setAnalysisResult(null);
      if (options?.resetPersistedJDAnalysis) {
        setPersistedJDAnalysis(undefined);
      }
      setAnalysisContext(null);
      setIsJDCollapsed(false);
      resetStaleExperienceIds();
      setNeedsReanalysis(false);
      setDebugInfo(null);
      pendingDiffRef.current = buildEmptyDiff();
      applyExperienceMatchScores();
      applyExperienceMatchTrends();
      applyCertificationMatchScores();
      applyCertificationMatchTrends();
      applySkillMatchScores();
      applySkillMatchTrends();
      if (options?.resetJdText) {
        setJdText(DEFAULT_JD_TEXT);
        setAttachmentExtractedText(null);
      }
      if (options?.resetJdFile) {
        setJdFile(null);
        setRestoredAttachmentContext(null);
        setAttachmentExtractedText(null);
      }
      if (options?.clearCache && resumeId) {
        clearJDAnalysisCache(resumeId);
      }
    },
    [
      applyCertificationMatchScores,
      applyCertificationMatchTrends,
      applyExperienceMatchScores,
      applyExperienceMatchTrends,
      applySkillMatchScores,
      applySkillMatchTrends,
      resetStaleExperienceIds,
      resumeId,
    ]
  );

  useEffect(() => {
    if (!analysisContext || !resumeId) {
      return;
    }
    if (analysisContext.jdInputSignature !== jdInputSignature) {
      if (restoredAttachmentContext) {
        setRestoredAttachmentContext(null);
      }
      resetJDAnalysisState({ clearCache: true });
    }
  }, [
    analysisContext,
    jdInputSignature,
    resetJDAnalysisState,
    restoredAttachmentContext,
    resumeId,
  ]);

  useEffect(() => {
    return () => {
      activeAnalysisRunIdRef.current = 0;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  useEffect(() => {
    if (!resumeId) {
      return;
    }
    hasLoadedJdCacheRef.current = false;
    resetJDAnalysisState({
      resetJdText: true,
      resetJdFile: true,
      clearCache: false,
      resetPersistedJDAnalysis: true,
    });
  }, [resetJDAnalysisState, resumeId]);

  useEffect(() => {
    if (
      !resumeId
      || isLoadingResume
      || isLoadingExperiences
      || hasLoadedJdCacheRef.current
    ) {
      return;
    }
    const cached = loadJDAnalysisCache(resumeId);
    const backendPersisted = normalizeJDAnalysisPersistence(
      persistedJDAnalysisConfig
    );
    const preferredPersistedState = selectPreferredPersistedJDAnalysis(
      backendPersisted,
      cached
    );

    if (preferredPersistedState) {
      const normalizedPersisted = applyPersistedAnalysisState(
        preferredPersistedState.payload
      );
      saveJDAnalysisCache(resumeId, normalizedPersisted, {
        pendingSync: preferredPersistedState.shouldKeepLocalPendingSync,
        basePersistedFingerprint:
          preferredPersistedState.basePersistedFingerprint,
      });
    } else if (cached && !cached.pendingSync) {
      clearJDAnalysisCache(resumeId);
      setPersistedJDAnalysis(null);
    } else {
      setPersistedJDAnalysis(null);
    }
    hasLoadedJdCacheRef.current = true;
  }, [
    isLoadingExperiences,
    isLoadingResume,
    applyPersistedAnalysisState,
    persistedJDAnalysisConfig,
    resumeId,
  ]);

  useEffect(() => {
    if (!resumeId || !persistedJDAnalysis) {
      return;
    }
    const backendPersisted = normalizeJDAnalysisPersistence(
      persistedJDAnalysisConfig
    );
    if (!backendPersisted) {
      return;
    }
    if (!arePersistedJDAnalysisEqual(backendPersisted, persistedJDAnalysis)) {
      return;
    }
    saveJDAnalysisCache(resumeId, backendPersisted, {
      pendingSync: false,
      basePersistedFingerprint:
        buildJDAnalysisPersistenceFingerprint(backendPersisted),
    });
  }, [persistedJDAnalysis, persistedJDAnalysisConfig, resumeId]);

  useEffect(() => {
    if (!restoredAttachmentContext) {
      return;
    }
    if (!jdFile) {
      return;
    }
    setRestoredAttachmentContext(null);
  }, [jdFile, restoredAttachmentContext]);

  useEffect(() => {
    if (!analysisContext || !resumeId) {
      return;
    }
    if (analysisContext.experienceSignature === experienceSignature) {
      return;
    }
    devLog('[JD Debug] Signature Mismatch!', {
      oldSig: analysisContext.experienceSignature,
      newSig: experienceSignature
    });
    const nextSignatures = buildJDItemSignatures(
      experienceItems,
      certifications,
      skillGroups
    );
    const diff = diffJDItemSignatures(
      analysisContext.itemSignatures,
      nextSignatures
    );
    devLog('[JD Debug] Diff:', diff);
    if (
      diff.experiences.size > 0 ||
      diff.certifications.size > 0 ||
      diff.skills.size > 0
    ) {
      devLog('[JD Debug] Marking Stale!');
      setDebugInfo({
        diff,
        diffDetails: {
          items: Array.from(diff.experiences).map(id => ({
            id,
            prev: analysisContext.itemSignatures?.experiences?.[id] ?? null,
            next: nextSignatures.experiences?.[id] ?? null
          }))
        }
      });
      mergeDiffInto(pendingDiffRef.current, diff);
      setNeedsReanalysis(true);
      markStaleMatches(diff);
    }
    setAnalysisContext((prev) =>
      prev
        ? {
          ...prev,
          experienceSignature,
          itemSignatures: nextSignatures,
        }
        : prev
    );
  }, [
    analysisContext,
    certifications,
    experienceItems,
    experienceSignature,
    markStaleMatches,
    resumeId,
    skillGroups,
  ]);



  type AnalyzeOptions = {
    mode?: MatchUpdateMode;
    diff?: JDItemDiff;
  };

  const updateAnalysisState = useCallback(
    ({
      result,
      itemSignatures,
      experienceSignature: nextExperienceSignature,
      jdInputSignature: nextJdInputSignature,
      jdText: nextJdText,
      experienceText: nextExperienceText,
      inputMode,
      attachmentName,
      attachmentExtractedText,
    }: AnalysisStatePayload) => {
      const currentBackendPersisted = normalizeJDAnalysisPersistence(
        persistedJDAnalysisConfig
      );
      const nextPersistedJDAnalysis = buildResumeJDAnalysisPayload({
        result,
        itemSignatures,
        experienceSignature: nextExperienceSignature,
        jdInputSignature: nextJdInputSignature,
        jdText: nextJdText,
        experienceText: nextExperienceText,
        inputMode,
        attachmentName,
        attachmentExtractedText,
      });
      setAnalysisResult(result);
      setAttachmentExtractedText(attachmentExtractedText ?? null);
      setPersistedJDAnalysis(nextPersistedJDAnalysis);
      setAnalysisContext({
        jdInputSignature: nextJdInputSignature,
        experienceSignature: nextExperienceSignature,
        itemSignatures,
        experienceText: nextExperienceText,
      });
      if (resumeId) {
        saveJDAnalysisCache(resumeId, nextPersistedJDAnalysis, {
          pendingSync: true,
          basePersistedFingerprint:
            buildJDAnalysisPersistenceFingerprint(currentBackendPersisted),
        });
      }
    },
    [persistedJDAnalysisConfig, resumeId]
  );

  const getAnalysisSnapshot = useCallback(() => {
    return {
      experiences: experienceItemsRef.current,
      certifications: certificationsRef.current,
      skillGroups: skillGroupsRef.current,
      jdText: jdTextRef.current,
      jdFile: jdFileRef.current,
      attachmentExtractedText,
    };
  }, [attachmentExtractedText]);

  const buildAnalyzeSnapshot = useCallback((): JDAnalyzeRequestSnapshot => {
    const snapshot = getAnalysisSnapshot();
    const inputMode = snapshot.jdFile ? "attachment" : "text";
    return {
      ...snapshot,
      itemSignatures: buildJDItemSignatures(
        snapshot.experiences,
        snapshot.certifications,
        snapshot.skillGroups
      ),
      experienceSignature: buildAnalyzeSignature(
        snapshot.experiences,
        snapshot.certifications,
        snapshot.skillGroups
      ),
      jdInputSignature: buildJDInputSignature(snapshot.jdText, snapshot.jdFile),
      experienceText: buildExperienceTextSnapshot(snapshot.experiences),
      inputMode,
      attachmentName: snapshot.jdFile?.name,
      attachmentExtractedText: snapshot.attachmentExtractedText,
    };
  }, [getAnalysisSnapshot]);

  const recordPostAnalyzeDiff = useCallback(
    (
      startSignatures: JDAnalysisItemSignatures,
      latestSignatures: JDAnalysisItemSignatures
    ) => {
      const changedDuringAnalyze = diffJDItemSignatures(
        startSignatures,
        latestSignatures
      );
      if (hasDiff(changedDuringAnalyze)) {
        mergeDiffInto(pendingDiffRef.current, changedDuringAnalyze);
        markStaleMatches(changedDuringAnalyze);
      }
      return changedDuringAnalyze;
    },
    [markStaleMatches]
  );

  const updateAnalyzeDiffState = useCallback(
    (
      mode: MatchUpdateMode,
      diff: JDItemDiff,
      changedDuringAnalyze: JDItemDiff
    ) => {
      const stateUpdate = resolveAnalyzeDiffStateUpdate({
        mode,
        diff,
        changedDuringAnalyze,
        pendingDiff: pendingDiffRef.current,
      });
      if (stateUpdate.experienceIdsToClear.size > 0) {
        clearStaleExperienceIds(stateUpdate.experienceIdsToClear);
      }
      if (hasDiff(stateUpdate.pendingDiffToClear)) {
        clearDiffTargets(pendingDiffRef.current, stateUpdate.pendingDiffToClear);
      }
      setNeedsReanalysis(stateUpdate.needsReanalysis);
      if (stateUpdate.shouldMarkPendingDiffStale) {
        markStaleMatches(pendingDiffRef.current, { replaceStale: true });
      }
      if (mode === "full" && !stateUpdate.needsReanalysis) {
        resetStaleExperienceIds();
      }
    },
    [clearStaleExperienceIds, markStaleMatches, resetStaleExperienceIds]
  );

  const clearFullAnalysisDiffState = useCallback(() => {
    pendingDiffRef.current = buildEmptyDiff();
    setNeedsReanalysis(false);
  }, []);

  const promoteAttachmentToText = useCallback((nextJdText: string) => {
    jdTextRef.current = nextJdText;
    jdFileRef.current = null;
    setJdText(nextJdText);
    setJdFile(null);
    setRestoredAttachmentContext(null);
  }, []);

  const handleStopAnalysis = useCallback(() => {
    activeAnalysisRunIdRef.current = 0;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsAnalyzing(false);
    setThinkingText("");
  }, []);

  const runAnalyze = useCallback(
    async (
      options?: AnalyzeOptions & {
        onProgress?: JDAnalyzeProgressHandler;
        onEvent?: JDAnalyzeStreamHandler;
      }
    ): Promise<JDAnalyzeOutcome> => {
      const runId = analysisRunIdRef.current + 1;
      analysisRunIdRef.current = runId;
      activeAnalysisRunIdRef.current = runId;
      const controller = new AbortController();
      abortControllerRef.current = controller;
      setThinkingText("");
      let hasThoughtTitle = false;
      const setIsAnalyzingForRun = (value: boolean) => {
        if (activeAnalysisRunIdRef.current !== runId) {
          return;
        }
        setIsAnalyzing(value);
        if (!value) {
          activeAnalysisRunIdRef.current = 0;
          if (abortControllerRef.current === controller) {
            abortControllerRef.current = null;
          }
          setThinkingText("");
        }
      };
      const outcome = await runJDAnalysisExecution({
        mode: options?.mode,
        diff: options?.diff,
        resumeId,
        authUserKey,
        analysisContext,
        analysisResult,
        service: aiService,
        buildAnalyzeSnapshot,
        recordPostAnalyzeDiff,
        updateAnalyzeDiffState,
        updateAnalysisState,
        applyMatchScoresForResult,
        promoteAttachmentToText,
        clearFullAnalysisDiffState,
        setIsAnalyzing: setIsAnalyzingForRun,
        setIsJDCollapsed,
        setDebugInfo,
        onProgress: options?.onProgress,
        onEvent: (event) => {
          if (activeAnalysisRunIdRef.current !== runId) {
            return;
          }
          if (event.type === "thought_reset") {
            hasThoughtTitle = false;
            setThinkingText("");
            options?.onEvent?.(event);
            return;
          }
          if (event.type === "thought") {
            const title = extractThoughtHeadline(event.summary) || event.summary;
            if (title) {
              hasThoughtTitle = true;
              setThinkingText((current) => appendJDThinkingText(current, title));
            }
            options?.onEvent?.(event);
            return;
          }
          if (event.type === "progress" && !hasThoughtTitle) {
            const progressTitle = JD_ANALYSIS_PROGRESS_NODE_TITLES[event.node];
            if (progressTitle) {
              setThinkingText(progressTitle);
            }
          }
          options?.onEvent?.(event);
        },
        signal: controller.signal,
      });
      return outcome;
    },
    [
      analysisContext,
      analysisResult,
      applyMatchScoresForResult,
      buildAnalyzeSnapshot,
      clearFullAnalysisDiffState,
      recordPostAnalyzeDiff,
      promoteAttachmentToText,
      resumeId,
      updateAnalyzeDiffState,
      updateAnalysisState,
      authUserKey,
    ]
  );

  const handleAnalyze = useCallback(async (options?: HandleAnalyzeOptions): Promise<JDAnalyzeOutcome> => {
    const snapshot = buildAnalyzeSnapshot();
    const plan = resolveJDAnalyzePlan({
      analysisResult,
      analysisContext,
      snapshotItemSignatures: snapshot.itemSignatures,
      snapshotJdInputSignature: snapshot.jdInputSignature,
      pendingDiff: pendingDiffRef.current,
      needsReanalysis,
      hasMissingAttachmentContext: Boolean(restoredAttachmentContext && !snapshot.jdFile),
    });

    if (plan.action === "skip") {
      if (plan.shouldClearNeedsReanalysis) {
        setNeedsReanalysis(false);
      }
      if (plan.shouldClearPendingDiff) {
        pendingDiffRef.current = buildEmptyDiff();
      }
      return { status: "no_change" };
    }
    if (plan.action === "missing_attachment") {
      return { status: "missing_attachment" };
    }
    return runAnalyze({
      mode: plan.mode,
      diff: plan.diff,
      onProgress: options?.onProgress,
      onEvent: options?.onEvent,
    });
  }, [
    analysisContext,
    analysisResult,
    buildAnalyzeSnapshot,
    needsReanalysis,
    restoredAttachmentContext,
    runAnalyze,
  ]);

  return {
    jdText,
    setJdText,
    jdFile,
    setJdFile,
    analysisResult,
    isAnalyzing,
    isJDCollapsed,
    setIsJDCollapsed,
    staleExperienceIds,
    certificationMatchScores,
    setCertificationMatchScores,
    certificationMatchTrends,
    setCertificationMatchTrends,
    skillMatchScores,
    setSkillMatchScores,
    skillMatchTrends,
    setSkillMatchTrends,
    handleAnalyze,
    hasMissingAttachmentContext,
    persistedJDAnalysis,
    debugInfo,
    isOutdated,
    thinkingText,
    handleStopAnalysis,
  };
};
