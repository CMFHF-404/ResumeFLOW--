import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useAuthOwnerOperationGuard } from "./useAuthOwnerOperationGuard";
import { isAuthContextChangedError } from "../services/apiClient";
import {
  aiService,
  type JDAnalysisResult,
} from "../services/aiService";
import { devLog } from "../services/devLogger";
import {
  clearJDAnalysisCache,
  loadJDAnalysisCache,
  normalizeJDAnalysisPersistence,
  resolveLocalJDAnalysisWriteBase,
  saveJDAnalysisCache,
  selectPreferredPersistedJDAnalysis,
} from "../services/jdAnalysisStorage";
import { diffJDItemSignatures } from "../utils/resumeHelpers";
import { resolveThoughtDisplayEvent } from "../utils/aiThought";
import { createJDAttachmentSelectionController } from "../utils/jdAttachment";
import { JD_ANALYSIS_PROGRESS_NODE_TITLES } from "../constants/jdAnalysis";
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
  const ownerGuard = useAuthOwnerOperationGuard(authUserKey ?? null);
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
  const analysisIdentity = useMemo(() => canonicalStringify({
    owner: authUserKey ?? null,
    resumeId: resumeId ?? null,
  }), [authUserKey, resumeId]);
  const [analysisStateIdentity, setAnalysisStateIdentity] = useState(analysisIdentity);
  const activeAnalysisIdentityRef = useRef(analysisIdentity);
  const analyzeRequestRef = useRef<Promise<JDAnalyzeOutcome> | null>(null);
  const [isJDCollapsed, setIsJDCollapsed] = useState(false);
  const [analysisContext, setAnalysisContext] =
    useState<JDAnalysisContext | null>(null);
  const analysisContextRef = useRef<JDAnalysisContext | null>(null);
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

  useLayoutEffect(() => {
    activeResumeIdRef.current = resumeId;
    activeAnalysisIdentityRef.current = analysisIdentity;
    evaluationInputRef.current = evaluationInput;
  }, [analysisIdentity, evaluationInput, resumeId]);
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
    resetAllMatchState,
    markStaleMatches,
    clearStaleExperienceIds,
  } = useJDAnalysisMatchState({
    setExperienceItems,
    skillGroupsRef,
  });

  const invalidateAnalysisRun = useCallback((options: { clearUi?: boolean } = {}) => {
    activeAnalysisRunIdRef.current = 0;
    analyzeRequestRef.current = null;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (options.clearUi !== false) {
      setIsAnalyzing(false);
      setThinkingText("");
    }
  }, []);

  useLayoutEffect(() => {
    jdFileRef.current = jdFile;
  }, [jdFile]);


  useLayoutEffect(() => {
    experienceItemsRef.current = experienceItems;
  }, [experienceItems]);

  useLayoutEffect(() => {
    certificationsRef.current = certifications;
  }, [certifications]);

  useLayoutEffect(() => {
    skillGroupsRef.current = skillGroups;
  }, [skillGroups]);

  useLayoutEffect(() => {
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
  useLayoutEffect(() => {
    evaluationSignatureRef.current = evaluationSignature;
    analysisResultRef.current = analysisResult;
    analysisContextRef.current = analysisContext;
    persistedJDAnalysisRef.current = persistedJDAnalysis;
    persistedJDAnalysisConfigRef.current = persistedJDAnalysisConfig;
  }, [
    analysisContext,
    analysisResult,
    evaluationSignature,
    persistedJDAnalysis,
    persistedJDAnalysisConfig,
  ]);

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
  const isAnalysisStateCurrent = analysisStateIdentity === analysisIdentity;

  const resolveLocalAnalysisWriteBase = useCallback((
    currentPersisted: ResumeJDAnalysis | null | undefined,
  ): string | null | undefined => {
    if (
      !isAnalysisStateCurrent
      || activeAnalysisIdentityRef.current !== analysisIdentity
    ) {
      return undefined;
    }
    const backendPersisted = normalizeJDAnalysisPersistence(
      persistedJDAnalysisConfigRef.current
    );
    return resolveLocalJDAnalysisWriteBase(
      backendPersisted,
      resumeId ? loadJDAnalysisCache(authUserKey, resumeId) : null,
      currentPersisted,
    );
  }, [analysisIdentity, authUserKey, isAnalysisStateCurrent, resumeId]);

  const canApplyAnalysisResult = useCallback(() => (
    resolveLocalAnalysisWriteBase(persistedJDAnalysisRef.current) !== undefined
  ), [resolveLocalAnalysisWriteBase]);

  useEffect(() => {
    if (
      !resumeId
      || !isAnalysisStateCurrent
      || !persistedJDAnalysis
      || (
        persistedJDAnalysis.isOutdated === isOutdated
        && persistedJDAnalysis.evaluationIsOutdated === isEvaluationOutdated
      )
    ) {
      return;
    }
    const basePersistedFingerprint = resolveLocalAnalysisWriteBase(
      persistedJDAnalysis
    );
    if (basePersistedFingerprint === undefined) {
      return;
    }
    const nextPersistedJDAnalysis: ResumeJDAnalysis = {
      ...persistedJDAnalysis,
      isOutdated,
      evaluationIsOutdated: isEvaluationOutdated,
    };
    persistedJDAnalysisRef.current = nextPersistedJDAnalysis;
    setPersistedJDAnalysis(nextPersistedJDAnalysis);
    saveJDAnalysisCache(authUserKey, resumeId, nextPersistedJDAnalysis, {
      pendingSync: true,
      basePersistedFingerprint,
    });
  }, [
    authUserKey,
    isEvaluationOutdated,
    isAnalysisStateCurrent,
    isOutdated,
    persistedJDAnalysis,
    persistedJDAnalysisConfig,
    resolveLocalAnalysisWriteBase,
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
      const nextAnalysisContext: JDAnalysisContext = {
        jdInputSignature: normalizedPayload.jdInputSignature,
        targetRoleSignature: normalizedPayload.targetRoleSignature,
        experienceSignature: hydratedAnalysisCandidate.experienceSignature,
        evaluationSignature: hydratedEvaluationSignature,
        itemSignatures: hydratedAnalysisCandidate.itemSignatures,
        experienceText: normalizedPayload.experienceText,
      };
      analysisContextRef.current = nextAnalysisContext;
      setAnalysisContext(nextAnalysisContext);
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
        resetAllMatchState();
      } else {
        const skillMatches = normalizedPayload.result.skillMatches ?? [];
        applyExperienceMatchScores(normalizedPayload.result.experienceMatches);
        applyExperienceMatchTrends(normalizedPayload.result.experienceMatches);
        applyCertificationMatchScores(normalizedPayload.result.certificationMatches);
        applyCertificationMatchTrends(normalizedPayload.result.certificationMatches);
        applySkillMatchScores(skillMatches);
        applySkillMatchTrends(skillMatches);
        resetStaleExperienceIds();
      }
      setIsJDCollapsed(true);
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
      resetAllMatchState,
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
      analysisResultRef.current = null;
      setAnalysisResult(null);
      if (options?.resetPersistedJDAnalysis) {
        persistedJDAnalysisRef.current = undefined;
        setPersistedJDAnalysis(undefined);
      }
      analysisContextRef.current = null;
      setAnalysisContext(null);
      setIsJDCollapsed(false);
      setNeedsReanalysis(false);
      setDebugInfo(null);
      pendingDiffRef.current = buildEmptyDiff();
      resetAllMatchState();
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
        clearJDAnalysisCache(authUserKey, resumeId);
      }
    },
    [
      clearJdFile,
      authUserKey,
      resetAllMatchState,
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
      resetAllMatchState();
      setNeedsReanalysis(true);
    }
  }, [
    analysisContext,
    jdInputSignature,
    resetAllMatchState,
    restoredAttachmentContext,
    resumeId,
  ]);

  useEffect(() => {
    return () => {
      invalidatePendingJdFileSelection();
      invalidateAnalysisRun({ clearUi: false });
    };
  }, [invalidateAnalysisRun, invalidatePendingJdFileSelection]);

  useEffect(() => {
    if (isAnalysisStateCurrent) {
      return;
    }
    hasLoadedJdCacheRef.current = false;
    invalidatePendingJdFileSelection();
    invalidateAnalysisRun();
    resetJDAnalysisState({
      resetJdText: true,
      resetJdFile: true,
      clearCache: false,
      resetPersistedJDAnalysis: true,
    });
    setAnalysisStateIdentity(analysisIdentity);
  }, [
    analysisIdentity,
    invalidateAnalysisRun,
    invalidatePendingJdFileSelection,
    isAnalysisStateCurrent,
    resetJDAnalysisState,
  ]);

  useEffect(() => {
    if (
      !resumeId
      || !isAnalysisStateCurrent
      || isLoadingResume
      || isLoadingExperiences
      || hasLoadedJdCacheRef.current
    ) {
      return;
    }
    const cached = loadJDAnalysisCache(authUserKey, resumeId);
    const backendPersisted = normalizeJDAnalysisPersistence(
      persistedJDAnalysisConfig
    );
    const preferredPersistedState = selectPreferredPersistedJDAnalysis(
      backendPersisted,
      cached
    );

    if (preferredPersistedState.payload) {
      const normalizedPersisted = applyPersistedAnalysisState(
        preferredPersistedState.payload
      );
      saveJDAnalysisCache(authUserKey, resumeId, normalizedPersisted, {
        pendingSync: preferredPersistedState.shouldKeepLocalPendingSync,
        basePersistedFingerprint:
          preferredPersistedState.basePersistedFingerprint,
      });
    } else if (cached && !cached.pendingSync) {
      clearJDAnalysisCache(authUserKey, resumeId);
      setPersistedJDAnalysis(null);
    } else {
      setPersistedJDAnalysis(null);
    }
    hasLoadedJdCacheRef.current = true;
  }, [
    authUserKey,
    isLoadingExperiences,
    isLoadingResume,
    isAnalysisStateCurrent,
    applyPersistedAnalysisState,
    persistedJDAnalysisConfig,
    resumeId,
  ]);

  useEffect(() => {
    if (
      !resumeId
      || !isAnalysisStateCurrent
      || !hasLoadedJdCacheRef.current
    ) {
      return;
    }
    const backendPersisted = normalizeJDAnalysisPersistence(
      persistedJDAnalysisConfig
    );
    const reconciliation = selectPreferredPersistedJDAnalysis(
      backendPersisted,
      loadJDAnalysisCache(authUserKey, resumeId)
    );
    if (reconciliation.kind === "keep_pending_local") {
      return;
    }
    if (reconciliation.payload === null) {
      if (persistedJDAnalysis !== null) {
        invalidateAnalysisRun();
        resetJDAnalysisState();
        persistedJDAnalysisRef.current = null;
        setPersistedJDAnalysis(null);
      }
      clearJDAnalysisCache(authUserKey, resumeId);
      return;
    }
    let reconciledPayload = normalizePersistedAnalysisForState(
      reconciliation.payload,
      buildEmptyJDItemSignatures()
    );
    if (!arePersistedJDAnalysisEqual(reconciledPayload, persistedJDAnalysis)) {
      invalidateAnalysisRun();
      reconciledPayload = applyPersistedAnalysisState(reconciliation.payload);
    }
    saveJDAnalysisCache(authUserKey, resumeId, reconciledPayload, {
      pendingSync: false,
      basePersistedFingerprint: reconciliation.basePersistedFingerprint,
    });
  }, [
    applyPersistedAnalysisState,
    authUserKey,
    invalidateAnalysisRun,
    isAnalysisStateCurrent,
    persistedJDAnalysis,
    persistedJDAnalysisConfig,
    resetJDAnalysisState,
    resumeId,
  ]);

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
    setAnalysisContext((prev) => {
      const nextContext = prev
        ? {
          ...prev,
          experienceSignature,
          itemSignatures: nextSignatures,
        }
        : prev;
      analysisContextRef.current = nextContext;
      return nextContext;
    });
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
      const basePersistedFingerprint = resolveLocalAnalysisWriteBase(
        persistedJDAnalysisRef.current
      );
      if (basePersistedFingerprint === undefined) {
        return;
      }
      const currentPersisted = persistedJDAnalysisRef.current;
      const previousEvaluationSignature = analysisContextRef.current?.evaluationSignature
        ?? currentPersisted?.evaluationSignature;
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
          : (currentPersisted?.evaluationIsOutdated ?? true),
      });
      const nextAnalysisContext: JDAnalysisContext = {
        jdInputSignature: nextJdInputSignature,
        targetRoleSignature: nextTargetRoleSignature,
        experienceSignature: nextExperienceSignature,
        evaluationSignature: result.resumeEvaluation
          ? (nextEvaluationSignature ?? nextExperienceSignature)
          : previousEvaluationSignature,
        itemSignatures,
        experienceText: nextExperienceText,
      };
      analysisResultRef.current = mergedResult;
      persistedJDAnalysisRef.current = nextPersistedJDAnalysis;
      analysisContextRef.current = nextAnalysisContext;
      setAnalysisResult(mergedResult);
      setAttachmentExtractedText(attachmentExtractedText ?? null);
      setPersistedJDAnalysis(nextPersistedJDAnalysis);
      setAnalysisContext(nextAnalysisContext);
      if (result.resumeEvaluation?.jdMatch === null) {
        resetAllMatchState();
      }
      if (resumeId) {
        saveJDAnalysisCache(authUserKey, resumeId, nextPersistedJDAnalysis, {
          pendingSync: true,
          basePersistedFingerprint,
        });
      }
    },
    [
      authUserKey,
      resetAllMatchState,
      resolveLocalAnalysisWriteBase,
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
    const basePersistedFingerprint = resolveLocalAnalysisWriteBase(
      currentPersisted
    );
    if (basePersistedFingerprint === undefined) {
      return false;
    }
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
    setAnalysisContext((current) => {
      const nextContext = current
        ? {
          ...current,
          evaluationSignature: requestEvaluationSignature,
          targetRoleSignature,
        }
        : current;
      analysisContextRef.current = nextContext;
      return nextContext;
    });
    if (resumeId) {
      saveJDAnalysisCache(authUserKey, resumeId, nextPersistedJDAnalysis, {
        pendingSync: true,
        basePersistedFingerprint,
      });
    }
    return true;
  }, [authUserKey, resolveLocalAnalysisWriteBase, resumeId, targetRoleSignature]);

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
    invalidateAnalysisRun();
  }, [invalidateAnalysisRun]);

  const runAnalyze = useCallback(
    async (
      options?: AnalyzeOptions & {
        onProgress?: JDAnalyzeProgressHandler;
        onEvent?: JDAnalyzeStreamHandler;
      }
    ): Promise<JDAnalyzeOutcome> => {
      let ownerOperation: Awaited<ReturnType<typeof ownerGuard.beginOperation>>;
      try {
        ownerOperation = await ownerGuard.beginOperation();
      } catch (error) {
        if (!isAuthContextChangedError(error)) {
          console.error("Failed to capture JD analysis owner", error);
        }
        return { status: "aborted" };
      }
      const runId = analysisRunIdRef.current + 1;
      analysisRunIdRef.current = runId;
      activeAnalysisRunIdRef.current = runId;
      const controller = new AbortController();
      abortControllerRef.current = controller;
      setThinkingText("");
      let hasThoughtTitle = false;
      const setIsAnalyzingForRun = (value: boolean) => {
        if (
          activeAnalysisRunIdRef.current !== runId
          || activeAnalysisIdentityRef.current !== analysisIdentity
          || !ownerGuard.isOperationCurrent(ownerOperation)
        ) {
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
          if (
            activeAnalysisRunIdRef.current !== runId
            || activeAnalysisIdentityRef.current !== analysisIdentity
            || !ownerGuard.isOperationCurrent(ownerOperation)
          ) {
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
        expectedAuthCacheKey: ownerOperation.expectedAuthCacheKey,
        shouldContinue: () => (
          activeAnalysisRunIdRef.current === runId
          && activeResumeIdRef.current === resumeId
          && activeAnalysisIdentityRef.current === analysisIdentity
          && ownerGuard.isOperationCurrent(ownerOperation)
        ),
        canApplyAnalysisResult,
      });
      return outcome;
    },
    [
      analysisContext,
      analysisIdentity,
      analysisResult,
      applyMatchScoresForResult,
      buildAnalyzeSnapshot,
      canApplyAnalysisResult,
      clearFullAnalysisDiffState,
      recordPostAnalyzeDiff,
      promoteAttachmentToText,
      resumeId,
      updateAnalyzeDiffState,
      updateAnalysisState,
      authUserKey,
      ownerGuard,
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
