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
  type JDAnalysisResult,
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
import { resolveThoughtDisplayEvent } from "../utils/aiThought";
import { createJDAttachmentSelectionController } from "../utils/jdAttachment";
import { JD_ANALYSIS_PROGRESS_NODE_TITLES } from "../views/ResumeEditor/constants";
import type {
  JDAnalysisContext,
  JDAnalysisItemSignatures,
  MatchTrend,
} from "../types/analysis";
import type {
  CertificationView,
  EducationView,
  ResumeEditorProfile,
  ResumeJDAnalysis,
  ResumeExperienceView,
  SkillGroupView,
} from "../types/resume";
import type { ResumeEvaluation } from "../types/ai";
import type { ResumeEvaluationSnapshot } from "../utils/resumeEvaluationSnapshot";
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
  buildAnalyzePayload,
  buildEmptyJDItemSignatures,
  buildExperienceTextSnapshot,
  buildJDInputSignature,
  buildJDItemSignatures,
  buildMatchCandidateSignature,
  canonicalStringify,
  type ResumeEvaluationInputContext,
} from "./jdAnalysisSignatureUtils";
import {
  type JDAnalyzeRequestSnapshot,
} from "./jdAnalysisRequestRunner";
import {
  buildResumeJDAnalysisPayload,
  normalizePersistedAnalysisForState,
  resolveHydratedAnalysisCandidate,
  resolveHydratedEvaluationSignature,
  mergeAuthoritativeStaleFlags,
  shouldKeepPendingLocalSnapshot,
  type AnalysisStatePayload,
} from "./jdAnalysisPersistenceUtils";
import {
  resolveAnalyzeDiffStateUpdate,
  resolveJDAnalysisOutdated,
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
  profile: ResumeEditorProfile;
  personalSummary: string;
  hasPersonalSummaryOverride: boolean;
  isSummaryVisible: boolean;
  targetRole: string;
  educations: EducationView[];
  selectedExperienceIds: ReadonlySet<string>;
  selectedEducationIds: ReadonlySet<string>;
  selectedCertificationIds: ReadonlySet<string>;
  selectedSkillIds: ReadonlySet<string>;
  sectionOrder: readonly string[];
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
  selectJdFile: (file: File) => Promise<void>;
  clearJdFile: () => void;
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
  isEvaluationOutdated: boolean;
  evaluationSnapshot: ResumeEvaluationSnapshot;
  evaluationSignature: string;
  persistResumeEvaluation: (
    evaluation: ResumeEvaluation,
    requestEvaluationSignature: string
  ) => boolean;
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
  profile,
  personalSummary,
  hasPersonalSummaryOverride,
  isSummaryVisible,
  targetRole,
  educations,
  selectedExperienceIds,
  selectedEducationIds,
  selectedCertificationIds,
  selectedSkillIds,
  sectionOrder,
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
  const analysisResultRef = useRef<JDAnalysisResult | null>(null);
  const [persistedJDAnalysis, setPersistedJDAnalysis] =
    useState<ResumeJDAnalysis | null | undefined>(undefined);
  const persistedJDAnalysisRef = useRef<ResumeJDAnalysis | null | undefined>(undefined);
  const persistedJDAnalysisConfigRef = useRef(persistedJDAnalysisConfig);
  const evaluationSignatureRef = useRef("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [thinkingText, setThinkingText] = useState("");
  const abortControllerRef = useRef<AbortController | null>(null);
  const analysisRunIdRef = useRef(0);
  const activeAnalysisRunIdRef = useRef(0);
  const activeResumeIdRef = useRef(resumeId);
  const previousResumeIdRef = useRef(resumeId);
  const analyzeRequestRef = useRef<Promise<JDAnalyzeOutcome> | null>(null);
  activeResumeIdRef.current = resumeId;
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
  const evaluationInput = useMemo<ResumeEvaluationInputContext>(() => ({
    profile,
    personalSummary,
    hasPersonalSummaryOverride,
    isSummaryVisible,
    targetRole,
    educations,
    selectedExperienceIds,
    selectedEducationIds,
    selectedCertificationIds,
    selectedSkillIds,
    sectionOrder,
  }), [
    educations,
    hasPersonalSummaryOverride,
    isSummaryVisible,
    personalSummary,
    profile,
    selectedCertificationIds,
    selectedEducationIds,
    selectedExperienceIds,
    selectedSkillIds,
    sectionOrder,
    targetRole,
  ]);
  const evaluationInputRef = useRef(evaluationInput);
  evaluationInputRef.current = evaluationInput;
  const evaluationSnapshot = useMemo(
    () => buildAnalyzePayload(
      experienceItems,
      certifications,
      skillGroups,
      evaluationInput
    ),
    [certifications, evaluationInput, experienceItems, skillGroups]
  );
  const commitJdFile = useCallback((file: File | null) => {
    jdFileRef.current = file;
    setJdFile(file);
  }, []);
  const jdAttachmentSelection = useMemo(
    () => createJDAttachmentSelectionController(commitJdFile),
    [commitJdFile]
  );
  const {
    selectFile: selectJdFile,
    clearFile: clearJdFile,
    invalidatePending: invalidatePendingJdFileSelection,
    waitForPendingSelection: waitForPendingJdFileSelection,
  } = jdAttachmentSelection;
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
    () => buildMatchCandidateSignature(experienceItems, certifications, skillGroups),
    [certifications, experienceItems, skillGroups]
  );
  const targetRoleSignature = useMemo(
    () => canonicalStringify({ targetRole: targetRole.trim() }),
    [targetRole]
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
  const evaluationSignature = useMemo(() => canonicalStringify({
    jdInputSignature,
    resume: evaluationSnapshot,
  }), [evaluationSnapshot, jdInputSignature]);
  evaluationSignatureRef.current = evaluationSignature;
  analysisResultRef.current = analysisResult;
  persistedJDAnalysisRef.current = persistedJDAnalysis;
  persistedJDAnalysisConfigRef.current = persistedJDAnalysisConfig;

  const isOutdated = useMemo(() => resolveJDAnalysisOutdated({
    analysisResult,
    analysisContext,
    jdInputSignature,
    needsReanalysis,
    persistedIsOutdated: persistedJDAnalysis?.isOutdated,
  }), [analysisContext, analysisResult, jdInputSignature, needsReanalysis, persistedJDAnalysis?.isOutdated]);
  const isEvaluationOutdated = useMemo(() => (
    analysisResult?.resumeEvaluation?.evaluationVersion !== "resume_flow_v1"
    || analysisContext?.evaluationSignature !== evaluationSignature
    || persistedJDAnalysis?.evaluationIsOutdated === true
  ), [analysisContext?.evaluationSignature, analysisResult?.resumeEvaluation?.evaluationVersion, evaluationSignature, persistedJDAnalysis?.evaluationIsOutdated]);
  const hasMissingAttachmentContext = Boolean(restoredAttachmentContext && !jdFile);

  useEffect(() => {
    if (
      !resumeId
      || !persistedJDAnalysis
      || (
        persistedJDAnalysis.isOutdated === isOutdated
        && persistedJDAnalysis.evaluationIsOutdated === isEvaluationOutdated
      )
    ) {
      return;
    }
    const nextPersistedJDAnalysis: ResumeJDAnalysis = {
      ...persistedJDAnalysis,
      isOutdated,
      evaluationIsOutdated: isEvaluationOutdated,
    };
    const backendPersisted = normalizeJDAnalysisPersistence(
      persistedJDAnalysisConfig
    );
    persistedJDAnalysisRef.current = nextPersistedJDAnalysis;
    setPersistedJDAnalysis(nextPersistedJDAnalysis);
    saveJDAnalysisCache(resumeId, nextPersistedJDAnalysis, {
      pendingSync: true,
      basePersistedFingerprint:
        buildJDAnalysisPersistenceFingerprint(backendPersisted),
    });
  }, [
    isEvaluationOutdated,
    isOutdated,
    persistedJDAnalysis,
    persistedJDAnalysisConfig,
    resumeId,
  ]);

  const applyPersistedAnalysisState = useCallback(
    (payload: ResumeJDAnalysis) => {
      const normalizedPayload = normalizePersistedAnalysisForState(
        payload,
        buildEmptyJDItemSignatures()
      );

      setJdText(normalizedPayload.jdText);
      setAttachmentExtractedText(normalizedPayload.attachmentExtractedText ?? null);
      setAnalysisResult(normalizedPayload.result);
      analysisResultRef.current = normalizedPayload.result;
      setPersistedJDAnalysis(normalizedPayload);
      persistedJDAnalysisRef.current = normalizedPayload;
      const hydratedEvaluationSignature = resolveHydratedEvaluationSignature(
        normalizedPayload,
        evaluationSignatureRef.current
      );
      const hydratedAnalysisCandidate = resolveHydratedAnalysisCandidate(
        normalizedPayload,
        experienceSignature,
        buildJDItemSignatures(experienceItems, certifications, skillGroups)
      );
      setAnalysisContext({
        jdInputSignature: normalizedPayload.jdInputSignature,
        targetRoleSignature: normalizedPayload.targetRoleSignature,
        experienceSignature: hydratedAnalysisCandidate.experienceSignature,
        evaluationSignature: hydratedEvaluationSignature,
        itemSignatures: hydratedAnalysisCandidate.itemSignatures,
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

      const hasEvaluationWithoutJd =
        normalizedPayload.result.resumeEvaluation?.jdMatch === null;
      if (hasEvaluationWithoutJd) {
        applyExperienceMatchScores();
        applyExperienceMatchTrends();
        applyCertificationMatchScores();
        applyCertificationMatchTrends();
        applySkillMatchScores();
        applySkillMatchTrends();
      } else {
        const skillMatches = normalizedPayload.result.skillMatches ?? [];
        applyExperienceMatchScores(normalizedPayload.result.experienceMatches);
        applyExperienceMatchTrends(normalizedPayload.result.experienceMatches);
        applyCertificationMatchScores(normalizedPayload.result.certificationMatches);
        applyCertificationMatchTrends(normalizedPayload.result.certificationMatches);
        applySkillMatchScores(skillMatches);
        applySkillMatchTrends(skillMatches);
      }
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
      certifications,
      experienceItems,
      experienceSignature,
      resetStaleExperienceIds,
      skillGroups,
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
        clearJdFile();
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
      clearJdFile,
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
      applyExperienceMatchScores();
      applyExperienceMatchTrends();
      applyCertificationMatchScores();
      applyCertificationMatchTrends();
      applySkillMatchScores();
      applySkillMatchTrends();
      resetStaleExperienceIds();
      setNeedsReanalysis(true);
    }
  }, [
    analysisContext,
    applyCertificationMatchScores,
    applyCertificationMatchTrends,
    applyExperienceMatchScores,
    applyExperienceMatchTrends,
    applySkillMatchScores,
    applySkillMatchTrends,
    jdInputSignature,
    resetStaleExperienceIds,
    restoredAttachmentContext,
    resumeId,
  ]);

  useEffect(() => {
    if (previousResumeIdRef.current === resumeId) {
      return;
    }
    previousResumeIdRef.current = resumeId;
    invalidatePendingJdFileSelection();
    activeAnalysisRunIdRef.current = 0;
    analyzeRequestRef.current = null;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsAnalyzing(false);
    setThinkingText("");
  }, [invalidatePendingJdFileSelection, resumeId]);

  useEffect(() => {
    return () => {
      invalidatePendingJdFileSelection();
      activeAnalysisRunIdRef.current = 0;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [invalidatePendingJdFileSelection]);

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
      const localCache = loadJDAnalysisCache(resumeId);
      const backendPersistedFingerprint =
        buildJDAnalysisPersistenceFingerprint(backendPersisted);
      const staleMerged = mergeAuthoritativeStaleFlags(
        persistedJDAnalysis,
        backendPersisted,
        {
          localPendingSync: shouldKeepPendingLocalSnapshot({
            pendingSync: localCache?.pendingSync === true,
            basePersistedFingerprint:
              localCache?.basePersistedFingerprint ?? null,
            backendPersistedFingerprint,
          }),
        }
      );
      if (staleMerged) {
        persistedJDAnalysisRef.current = staleMerged;
        setPersistedJDAnalysis(staleMerged);
        saveJDAnalysisCache(resumeId, staleMerged, {
          pendingSync: false,
          basePersistedFingerprint: backendPersistedFingerprint,
        });
      }
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
      evaluationSignature: nextEvaluationSignature,
      targetRoleSignature: nextTargetRoleSignature,
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
      const previousEvaluationSignature = analysisContext?.evaluationSignature
        ?? persistedJDAnalysis?.evaluationSignature;
      const mergedResult = result.resumeEvaluation || !analysisResultRef.current?.resumeEvaluation
        ? result
        : { ...result, resumeEvaluation: analysisResultRef.current.resumeEvaluation };
      const nextPersistedJDAnalysis = buildResumeJDAnalysisPayload({
        result: mergedResult,
        itemSignatures,
        experienceSignature: nextExperienceSignature,
        evaluationSignature: result.resumeEvaluation
          ? nextEvaluationSignature
          : previousEvaluationSignature,
        targetRoleSignature: nextTargetRoleSignature,
        jdInputSignature: nextJdInputSignature,
        jdText: nextJdText,
        experienceText: nextExperienceText,
        inputMode,
        attachmentName,
        attachmentExtractedText,
        evaluationIsOutdated: result.resumeEvaluation
          ? false
          : (persistedJDAnalysis?.evaluationIsOutdated ?? true),
      });
      analysisResultRef.current = mergedResult;
      persistedJDAnalysisRef.current = nextPersistedJDAnalysis;
      setAnalysisResult(mergedResult);
      setAttachmentExtractedText(attachmentExtractedText ?? null);
      setPersistedJDAnalysis(nextPersistedJDAnalysis);
      setAnalysisContext({
        jdInputSignature: nextJdInputSignature,
        targetRoleSignature: nextTargetRoleSignature,
        experienceSignature: nextExperienceSignature,
        evaluationSignature: result.resumeEvaluation
          ? (nextEvaluationSignature ?? nextExperienceSignature)
          : previousEvaluationSignature,
        itemSignatures,
        experienceText: nextExperienceText,
      });
      if (result.resumeEvaluation?.jdMatch === null) {
        applyExperienceMatchScores();
        applyExperienceMatchTrends();
        applyCertificationMatchScores();
        applyCertificationMatchTrends();
        applySkillMatchScores();
        applySkillMatchTrends();
        resetStaleExperienceIds();
      }
      if (resumeId) {
        saveJDAnalysisCache(resumeId, nextPersistedJDAnalysis, {
          pendingSync: true,
          basePersistedFingerprint:
            buildJDAnalysisPersistenceFingerprint(currentBackendPersisted),
        });
      }
    },
    [
      applyCertificationMatchScores,
      applyCertificationMatchTrends,
      applyExperienceMatchScores,
      applyExperienceMatchTrends,
      applySkillMatchScores,
      applySkillMatchTrends,
      persistedJDAnalysisConfig,
      analysisContext?.evaluationSignature,
      persistedJDAnalysis?.evaluationSignature,
      resetStaleExperienceIds,
      resumeId,
    ]
  );

  const persistResumeEvaluation = useCallback((
    evaluation: ResumeEvaluation,
    requestEvaluationSignature: string
  ) => {
    if (requestEvaluationSignature !== evaluationSignatureRef.current) {
      return false;
    }
    const currentResult = analysisResultRef.current;
    const currentConfig = persistedJDAnalysisConfigRef.current;
    const currentPersisted = persistedJDAnalysisRef.current
      ?? normalizeJDAnalysisPersistence(currentConfig);
    if (!currentResult || !currentPersisted) {
      return false;
    }
    const backendPersisted = normalizeJDAnalysisPersistence(currentConfig);
    const nextPersistedJDAnalysis: ResumeJDAnalysis = {
      ...currentPersisted,
      result: { ...currentResult, resumeEvaluation: evaluation },
      evaluationSignature: requestEvaluationSignature,
      targetRoleSignature,
      evaluationIsOutdated: false,
      updatedAt: new Date().toISOString(),
    };
    analysisResultRef.current = nextPersistedJDAnalysis.result;
    persistedJDAnalysisRef.current = nextPersistedJDAnalysis;
    setAnalysisResult(nextPersistedJDAnalysis.result);
    setPersistedJDAnalysis(nextPersistedJDAnalysis);
    setAnalysisContext((current) => current
      ? {
        ...current,
        evaluationSignature: requestEvaluationSignature,
        targetRoleSignature,
      }
      : current
    );
    if (resumeId) {
      saveJDAnalysisCache(resumeId, nextPersistedJDAnalysis, {
        pendingSync: true,
        basePersistedFingerprint:
          buildJDAnalysisPersistenceFingerprint(backendPersisted),
      });
    }
    return true;
  }, [resumeId, targetRoleSignature]);

  const getAnalysisSnapshot = useCallback(() => {
    const analysisPayload = buildAnalyzePayload(
      experienceItemsRef.current,
      certificationsRef.current,
      skillGroupsRef.current,
      evaluationInputRef.current
    );
    return {
      experiences: experienceItemsRef.current,
      certifications: certificationsRef.current,
      skillGroups: skillGroupsRef.current,
      jdText: jdTextRef.current,
      jdFile: jdFileRef.current,
      attachmentExtractedText,
      analysisPayload,
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
      experienceSignature: buildMatchCandidateSignature(
        snapshot.experiences,
        snapshot.certifications,
        snapshot.skillGroups
      ),
      evaluationSignature: canonicalStringify({
        jdInputSignature: buildJDInputSignature(snapshot.jdText, snapshot.jdFile),
        resume: snapshot.analysisPayload,
      }),
      targetRoleSignature: canonicalStringify({
        targetRole: evaluationInputRef.current.targetRole?.trim() ?? "",
      }),
      analysisPayload: snapshot.analysisPayload,
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
    setJdText(nextJdText);
    clearJdFile();
    setRestoredAttachmentContext(null);
  }, [clearJdFile]);

  const handleStopAnalysis = useCallback(() => {
    activeAnalysisRunIdRef.current = 0;
    analyzeRequestRef.current = null;
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
          const resolution = resolveThoughtDisplayEvent(event, {
            includeProgress: true,
            progressTitleByNode: JD_ANALYSIS_PROGRESS_NODE_TITLES,
          });
          if (resolution && resolution.kind === "reset") {
            hasThoughtTitle = false;
            setThinkingText("");
            options?.onEvent?.(event);
            return;
          }
          if (resolution && resolution.kind === "model_thought") {
            hasThoughtTitle = true;
            setThinkingText((current) => appendJDThinkingText(current, resolution.text));
            options?.onEvent?.(event);
            return;
          }
          if (resolution && resolution.kind === "status" && !hasThoughtTitle) {
            setThinkingText(resolution.text);
          }
          options?.onEvent?.(event);
        },
        signal: controller.signal,
        shouldContinue: () => (
          activeAnalysisRunIdRef.current === runId
          && activeResumeIdRef.current === resumeId
        ),
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

  const handleAnalyze = useCallback((options?: HandleAnalyzeOptions): Promise<JDAnalyzeOutcome> => {
    if (analyzeRequestRef.current) {
      return analyzeRequestRef.current;
    }
    const request = (async (): Promise<JDAnalyzeOutcome> => {
      const hasPreparedSelection = await waitForPendingJdFileSelection();
      if (!hasPreparedSelection) {
        return { status: "aborted" };
      }
      const snapshot = buildAnalyzeSnapshot();
      const plan = resolveJDAnalyzePlan({
        analysisResult,
        analysisContext,
        snapshotItemSignatures: snapshot.itemSignatures,
        snapshotJdInputSignature: snapshot.jdInputSignature,
        snapshotEvaluationSignature: snapshot.evaluationSignature,
        pendingDiff: pendingDiffRef.current,
        needsReanalysis,
        persistedIsOutdated: persistedJDAnalysis?.isOutdated,
        hasMissingAttachmentContext: Boolean(restoredAttachmentContext && !snapshot.jdFile),
        hasJdContext: Boolean(snapshot.jdFile || snapshot.jdText.trim()),
      });

      if (plan.action === "skip") {
        if (analysisResult) {
          applyMatchScoresForResult(analysisResult, "full", buildEmptyDiff());
        }
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
    })();
    analyzeRequestRef.current = request;
    const clearAnalyzeRequest = () => {
      if (analyzeRequestRef.current === request) {
        analyzeRequestRef.current = null;
      }
    };
    void request.then(clearAnalyzeRequest, clearAnalyzeRequest);
    return request;
  }, [
    analysisContext,
    analysisResult,
    applyMatchScoresForResult,
    buildAnalyzeSnapshot,
    needsReanalysis,
    persistedJDAnalysis?.isOutdated,
    restoredAttachmentContext,
    runAnalyze,
    waitForPendingJdFileSelection,
  ]);

  return {
    jdText,
    setJdText,
    jdFile,
    selectJdFile,
    clearJdFile,
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
    isEvaluationOutdated,
    evaluationSnapshot,
    evaluationSignature,
    persistResumeEvaluation,
    thinkingText,
    handleStopAnalysis,
  };
};
