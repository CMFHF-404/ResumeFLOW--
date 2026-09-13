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
  buildJDAnalysisPersistenceFingerprint,
  loadJDAnalysisCache,
  normalizeJDAnalysisPersistence,
  resolveLocalJDAnalysisWriteBase,
  saveJDAnalysisCache,
  selectPreferredPersistedJDAnalysis,
} from "../services/jdAnalysisStorage";
import { diffJDItemSignatures } from "../utils/resumeHelpers";
import { resolveThoughtDisplayEvent } from "../utils/aiThought";
import { createJDAttachmentSelectionController } from "../utils/jdAttachment";
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
  beginJDAttachmentReplacement,
  buildAnalyzePayload,
  buildEmptyJDItemSignatures,
  buildExperienceTextSnapshot,
  buildJDInputSignature,
  buildPersistedJDInputSignature,
  buildJDItemSignatures,
  buildMatchCandidateSignature,
  canonicalStringify,
  restoreJDAttachmentReplacement,
  resolveResumeEvaluationJDContext,
  type JDAttachmentReplacementState,
  type RestoredJDAttachmentContext,
  type ResumeEvaluationInputContext,
} from "./jdAnalysisSignatureUtils";
import {
  type JDAnalyzeRequestSnapshot,
} from "./jdAnalysisRequestRunner";
import {
  buildRestoredAttachmentTextConversionPayload,
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
import {
  buildEvaluationSignature,
  buildJDResultIdentity,
  rebindEvaluationSignature,
  reconcileJDResultEvaluation,
  resolveResumeEvaluationOutdated,
} from "./useResumeEvaluation";

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
  careerStage?: import('../types/ai').CareerStage;
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
  shouldContinue?: () => boolean;
};

// LOCAL_EVALUATION_ATTESTATION_BRIDGE_START
export const stripLocalEvaluationAttestation = <T extends Record<string, unknown>>(
  payload: T
): Omit<T, "evaluationSignatureVersion"> => {
  const { evaluationSignatureVersion: _discardedAttestation, ...localPayload } = payload;
  return localPayload;
};

type PendingJDAnalysisConflict = {
  analysisIdentity: string;
  backendPayload: ResumeJDAnalysis | null;
  pendingPayload: ResumeJDAnalysis;
};
// LOCAL_EVALUATION_ATTESTATION_BRIDGE_END

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
  evaluationJdText: string;
  evaluationJdAvailable: boolean;
  evaluationJdMatchPercentage: number | undefined;
  isEvaluationJdAnalysisInputCurrent: boolean;
  hasMissingEvaluationJdContext: boolean;
  hasPendingJdFileSelection: () => boolean;
  hasPendingJDAnalysisConflict: boolean;
  canPersistCurrentJDAnalysis: () => boolean;
  restorePendingJDAnalysisRecovery: () => boolean;
  discardPendingJDAnalysisRecovery: () => boolean;
  convertRestoredAttachmentToText: (fullJdText: string) => boolean;
  persistResumeEvaluation: (
    evaluation: ResumeEvaluation,
    requestEvaluationSignature: string,
    requestJDResultIdentity: string,
    requestJDMatchPercentage: number | undefined
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
  careerStage = 'unspecified',
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
  const attachmentExtractedTextRef = useRef<string | null>(null);
  const [restoredAttachmentContext, setRestoredAttachmentContext] =
    useState<RestoredJDAttachmentContext | null>(null);
  const restoredAttachmentContextRef = useRef(restoredAttachmentContext);
  const pendingJdAttachmentReplacementRef =
    useRef<JDAttachmentReplacementState | null>(null);
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
  const [pendingJDAnalysisConflict, setPendingJDAnalysisConflict] =
    useState<PendingJDAnalysisConflict | null>(null);
  const pendingJDAnalysisConflictRef = useRef<PendingJDAnalysisConflict | null>(null);
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
    careerStage,
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
    careerStage,
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
  const publishPendingJDAnalysisConflict = useCallback((
    conflict: PendingJDAnalysisConflict | null
  ) => {
    pendingJDAnalysisConflictRef.current = conflict;
    setPendingJDAnalysisConflict(conflict);
  }, []);
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
    if (file) {
      const replacement = beginJDAttachmentReplacement({
        jdText: jdTextRef.current,
        attachmentExtractedText: attachmentExtractedTextRef.current,
        restoredAttachmentContext: restoredAttachmentContextRef.current,
      });
      if (!pendingJdAttachmentReplacementRef.current) {
        pendingJdAttachmentReplacementRef.current = replacement.backup;
      }
      jdTextRef.current = replacement.jdText;
      setJdText(replacement.jdText);
      attachmentExtractedTextRef.current = replacement.attachmentExtractedText;
      setAttachmentExtractedText(replacement.attachmentExtractedText);
      restoredAttachmentContextRef.current = replacement.restoredAttachmentContext;
      setRestoredAttachmentContext(replacement.restoredAttachmentContext);
    }
    jdFileRef.current = file;
    setJdFile(file);
  }, []);
  const jdAttachmentSelection = useMemo(
    () => createJDAttachmentSelectionController(commitJdFile),
    [commitJdFile]
  );
  const {
    selectFile: selectJdFile,
    clearFile: clearSelectedJdFile,
    invalidatePending: invalidatePendingJdFileSelection,
    waitForPendingSelection: waitForPendingJdFileSelection,
    hasPendingSelection: hasPendingJdFileSelection,
  } = jdAttachmentSelection;
  const clearJdFile = useCallback(() => {
    const replacementBackup = pendingJdAttachmentReplacementRef.current;
    pendingJdAttachmentReplacementRef.current = null;
    clearSelectedJdFile();
    if (!replacementBackup) {
      return;
    }
    const restored = restoreJDAttachmentReplacement(
      replacementBackup,
      jdTextRef.current
    );
    jdTextRef.current = restored.jdText;
    setJdText(restored.jdText);
    attachmentExtractedTextRef.current = restored.attachmentExtractedText;
    setAttachmentExtractedText(restored.attachmentExtractedText);
    restoredAttachmentContextRef.current = restored.restoredAttachmentContext;
    setRestoredAttachmentContext(restored.restoredAttachmentContext);
  }, [clearSelectedJdFile]);
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
    attachmentExtractedTextRef.current = attachmentExtractedText;
  }, [attachmentExtractedText]);

  useLayoutEffect(() => {
    restoredAttachmentContextRef.current = restoredAttachmentContext;
  }, [restoredAttachmentContext]);


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
    if (!jdFile && restoredAttachmentContext) {
      return restoredAttachmentContext.jdText === jdText
        ? restoredAttachmentContext.jdInputSignature
        : buildPersistedJDInputSignature(
          jdText,
          "attachment",
          restoredAttachmentContext.attachmentName
        );
    }
    return liveJdInputSignature;
  }, [jdFile, jdText, liveJdInputSignature, restoredAttachmentContext]);
  const isEvaluationJdAnalysisInputCurrent = Boolean(
    !pendingJDAnalysisConflict
    &&
    analysisResult
    && analysisContext?.jdInputSignature === jdInputSignature
  );
  const resumeEvaluationJDContext = useMemo(
    () => resolveResumeEvaluationJDContext({
      jdText,
      inputMode: jdFile || restoredAttachmentContext ? "attachment" : "text",
      attachmentExtractedText,
      matchPercentage: isEvaluationJdAnalysisInputCurrent
        ? analysisResult?.matchPercentage
        : undefined,
    }),
    [
      analysisResult?.matchPercentage,
      attachmentExtractedText,
      isEvaluationJdAnalysisInputCurrent,
      jdFile,
      jdText,
      restoredAttachmentContext,
    ]
  );
  const evaluationSignature = useMemo(() => buildEvaluationSignature({
    jdInputSignature,
    resume: evaluationSnapshot,
    jdAnalysisResult: analysisResult,
    jdAvailable: resumeEvaluationJDContext.jdAvailable,
  }), [analysisResult, evaluationSnapshot, jdInputSignature, resumeEvaluationJDContext.jdAvailable]);
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

  const isOutdated = useMemo(() => Boolean(pendingJDAnalysisConflict) || resolveJDAnalysisOutdated({
    analysisResult,
    analysisContext,
    jdInputSignature,
    needsReanalysis,
    persistedIsOutdated: persistedJDAnalysis?.isOutdated,
  }), [analysisContext, analysisResult, jdInputSignature, needsReanalysis, pendingJDAnalysisConflict, persistedJDAnalysis?.isOutdated]);
  const isEvaluationOutdated = useMemo(() => resolveResumeEvaluationOutdated({
    evaluationVersion: analysisResult?.resumeEvaluation?.evaluationVersion,
    boundEvaluationSignature: analysisContext?.evaluationSignature,
    currentEvaluationSignature: evaluationSignature,
    persistedEvaluationIsOutdated: persistedJDAnalysis?.evaluationIsOutdated,
    hasMissingAttachmentText:
      Boolean(pendingJDAnalysisConflict)
      || resumeEvaluationJDContext.hasMissingAttachmentText,
  }), [
    analysisContext?.evaluationSignature,
    analysisResult?.resumeEvaluation?.evaluationVersion,
    evaluationSignature,
    persistedJDAnalysis?.evaluationIsOutdated,
    pendingJDAnalysisConflict,
    resumeEvaluationJDContext.hasMissingAttachmentText,
  ]);
  const hasMissingAttachmentContext = Boolean(
    restoredAttachmentContext
    && !jdFile
    && resumeEvaluationJDContext.hasMissingAttachmentText
  );
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

  const canPersistCurrentJDAnalysis = useCallback(() => {
    if (
      pendingJDAnalysisConflictRef.current?.analysisIdentity
      === activeAnalysisIdentityRef.current
    ) {
      return false;
    }
    const currentPersisted = persistedJDAnalysisRef.current;
    if (resolveLocalAnalysisWriteBase(currentPersisted) !== undefined) {
      return true;
    }
    if (!resumeId || activeAnalysisIdentityRef.current !== analysisIdentity) {
      return false;
    }
    const backendPayload = normalizeJDAnalysisPersistence(
      persistedJDAnalysisConfigRef.current
    );
    const currentCache = loadJDAnalysisCache(authUserKey, resumeId);
    if (currentCache?.pendingSync) {
      // Recovery can clear the conflict before an old provider response arrives.
      // Retire that request now so it cannot resume against the recovered cache.
      invalidateAnalysisRun();
      publishPendingJDAnalysisConflict({
        analysisIdentity,
        backendPayload,
        pendingPayload: currentCache.payload,
      });
    }
    return false;
  }, [
    analysisIdentity,
    authUserKey,
    invalidateAnalysisRun,
    publishPendingJDAnalysisConflict,
    resolveLocalAnalysisWriteBase,
    resumeId,
  ]);

  const canApplyAnalysisResult = canPersistCurrentJDAnalysis;

  const convertRestoredAttachmentToText = useCallback((fullJdText: string) => {
    const normalizedText = fullJdText.trim();
    const currentPersisted = persistedJDAnalysisRef.current;
    if (
      !normalizedText
      || jdFileRef.current
      || !restoredAttachmentContextRef.current
      || !currentPersisted
      || !resumeId
    ) {
      return false;
    }
    const basePersistedFingerprint = resolveLocalAnalysisWriteBase(currentPersisted);
    if (basePersistedFingerprint === undefined) {
      return false;
    }
    const convertedPersisted = buildRestoredAttachmentTextConversionPayload(
      currentPersisted,
      normalizedText
    );
    invalidateAnalysisRun();
    pendingJdAttachmentReplacementRef.current = null;
    jdTextRef.current = convertedPersisted.jdText;
    setJdText(convertedPersisted.jdText);
    restoredAttachmentContextRef.current = null;
    setRestoredAttachmentContext(null);
    attachmentExtractedTextRef.current = null;
    setAttachmentExtractedText(null);
    persistedJDAnalysisRef.current = convertedPersisted;
    setPersistedJDAnalysis(convertedPersisted);
    saveJDAnalysisCache(authUserKey, resumeId, convertedPersisted, {
      pendingSync: true,
      basePersistedFingerprint,
    });
    resetAllMatchState();
    setNeedsReanalysis(true);
    return true;
  }, [
    authUserKey,
    invalidateAnalysisRun,
    resetAllMatchState,
    resolveLocalAnalysisWriteBase,
    resumeId,
  ]);

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
      pendingJdAttachmentReplacementRef.current = null;
      const normalizedPayload = normalizePersistedAnalysisForState(
        payload,
        buildEmptyJDItemSignatures()
      );

      setJdText(normalizedPayload.jdText);
      attachmentExtractedTextRef.current = normalizedPayload.attachmentExtractedText ?? null;
      setAttachmentExtractedText(attachmentExtractedTextRef.current);
      setAnalysisResult(normalizedPayload.result);
      analysisResultRef.current = normalizedPayload.result;
      setPersistedJDAnalysis(normalizedPayload);
      persistedJDAnalysisRef.current = normalizedPayload;
      const hydratedEvaluationJDContext = resolveResumeEvaluationJDContext({
        jdText: normalizedPayload.jdText,
        inputMode: normalizedPayload.inputMode,
        attachmentExtractedText: normalizedPayload.attachmentExtractedText,
        matchPercentage: normalizedPayload.result.matchPercentage,
      });
      const currentHydratedEvaluationSignature = buildEvaluationSignature({
        jdInputSignature: normalizedPayload.jdInputSignature,
        resume: evaluationSnapshot,
        jdAnalysisResult: normalizedPayload.result,
        jdAvailable: hydratedEvaluationJDContext.jdAvailable,
      });
      const hydratedEvaluationSignature = resolveHydratedEvaluationSignature(
        normalizedPayload,
        currentHydratedEvaluationSignature,
        hydratedEvaluationJDContext.hasMissingAttachmentText
      );
      evaluationSignatureRef.current = hydratedEvaluationSignature ?? "";
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
      const nextRestoredAttachmentContext = normalizedPayload.inputMode === "attachment"
        ? {
          jdText: normalizedPayload.jdText,
          jdInputSignature: normalizedPayload.jdInputSignature,
          attachmentName: normalizedPayload.attachmentName,
          attachmentExtractedText: normalizedPayload.attachmentExtractedText ?? null,
        }
        : null;
      restoredAttachmentContextRef.current = nextRestoredAttachmentContext;
      setRestoredAttachmentContext(nextRestoredAttachmentContext);

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
      evaluationSnapshot,
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
      pendingJdAttachmentReplacementRef.current = null;
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
        attachmentExtractedTextRef.current = null;
        setAttachmentExtractedText(null);
      }
      if (options?.resetJdFile) {
        clearJdFile();
        restoredAttachmentContextRef.current = null;
        setRestoredAttachmentContext(null);
        attachmentExtractedTextRef.current = null;
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

  const restorePendingJDAnalysisRecovery = useCallback(() => {
    const conflict = pendingJDAnalysisConflictRef.current;
    if (
      !conflict
      || conflict.analysisIdentity !== activeAnalysisIdentityRef.current
      || !resumeId
    ) {
      return false;
    }
    const currentCache = loadJDAnalysisCache(authUserKey, resumeId);
    if (!currentCache?.pendingSync) {
      return false;
    }
    const currentBackend = normalizeJDAnalysisPersistence(
      persistedJDAnalysisConfigRef.current
    );
    invalidateAnalysisRun();
    saveJDAnalysisCache(authUserKey, resumeId, currentCache.payload, {
      pendingSync: true,
      basePersistedFingerprint:
        buildJDAnalysisPersistenceFingerprint(currentBackend),
    });
    publishPendingJDAnalysisConflict(null);
    applyPersistedAnalysisState(currentCache.payload);
    return true;
  }, [
    applyPersistedAnalysisState,
    authUserKey,
    invalidateAnalysisRun,
    publishPendingJDAnalysisConflict,
    resumeId,
  ]);

  const discardPendingJDAnalysisRecovery = useCallback(() => {
    const conflict = pendingJDAnalysisConflictRef.current;
    if (
      !conflict
      || conflict.analysisIdentity !== activeAnalysisIdentityRef.current
      || !resumeId
    ) {
      return false;
    }
    const currentBackend = normalizeJDAnalysisPersistence(
      persistedJDAnalysisConfigRef.current
    );
    invalidateAnalysisRun();
    clearJDAnalysisCache(authUserKey, resumeId);
    publishPendingJDAnalysisConflict(null);
    if (currentBackend) {
      applyPersistedAnalysisState(currentBackend);
    } else {
      resetJDAnalysisState({
        resetJdText: true,
        resetJdFile: true,
      });
      persistedJDAnalysisRef.current = null;
      setPersistedJDAnalysis(null);
    }
    return true;
  }, [
    applyPersistedAnalysisState,
    authUserKey,
    invalidateAnalysisRun,
    publishPendingJDAnalysisConflict,
    resetJDAnalysisState,
    resumeId,
  ]);

  useEffect(() => {
    if (!analysisContext || !resumeId) {
      return;
    }
    if (analysisContext.jdInputSignature !== jdInputSignature) {
      resetAllMatchState();
      setNeedsReanalysis(true);
    }
  }, [
    analysisContext,
    jdInputSignature,
    resetAllMatchState,
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
    publishPendingJDAnalysisConflict(null);
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
    publishPendingJDAnalysisConflict,
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

    if (preferredPersistedState.kind === "pending_conflict") {
      // Preserve the recovery cache, but do not hydrate it into the editor's
      // auto-saved config when its backend base is missing or has diverged.
      devLog('[JD Debug] Pending cache diverged from the current backend; preserving recovery data.');
      publishPendingJDAnalysisConflict({
        analysisIdentity,
        backendPayload: preferredPersistedState.payload,
        pendingPayload: preferredPersistedState.pendingPayload,
      });
      hasLoadedJdCacheRef.current = true;
      return;
    }
    publishPendingJDAnalysisConflict(null);

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
    analysisIdentity,
    persistedJDAnalysisConfig,
    publishPendingJDAnalysisConflict,
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
    if (
      reconciliation.kind === "keep_pending_local"
    ) {
      if (
        !arePersistedJDAnalysisEqual(
          reconciliation.payload,
          // Earlier effects can commit local writes before React publishes
          // their state updates; the ref already represents that same commit.
          persistedJDAnalysisRef.current ?? null
        )
      ) {
        invalidateAnalysisRun();
        publishPendingJDAnalysisConflict({
          analysisIdentity,
          backendPayload: backendPersisted,
          pendingPayload: reconciliation.payload,
        });
      }
      return;
    }
    if (reconciliation.kind === "pending_conflict") {
      invalidateAnalysisRun();
      publishPendingJDAnalysisConflict({
        analysisIdentity,
        backendPayload: reconciliation.payload,
        pendingPayload: reconciliation.pendingPayload,
      });
      return;
    }
    if (
      pendingJDAnalysisConflictRef.current?.analysisIdentity
      === analysisIdentity
    ) {
      return;
    }
    publishPendingJDAnalysisConflict(null);
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
    analysisIdentity,
    authUserKey,
    invalidateAnalysisRun,
    isAnalysisStateCurrent,
    persistedJDAnalysis,
    persistedJDAnalysisConfig,
    publishPendingJDAnalysisConflict,
    resetJDAnalysisState,
    resumeId,
  ]);

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
      const currentResult = analysisResultRef.current;
      const {
        jdResultChanged,
        result: mergedResult,
      } = reconcileJDResultEvaluation(currentResult, result);
      const nextBoundEvaluationSignature = rebindEvaluationSignature(
        nextEvaluationSignature ?? nextExperienceSignature,
        mergedResult
      );
      const nextPersistedJDAnalysis = buildResumeJDAnalysisPayload({
        result: mergedResult,
        itemSignatures,
        experienceSignature: nextExperienceSignature,
        evaluationSignature: nextBoundEvaluationSignature,
        targetRoleSignature: nextTargetRoleSignature,
        jdInputSignature: nextJdInputSignature,
        jdText: nextJdText,
        experienceText: nextExperienceText,
        inputMode,
        attachmentName,
        attachmentExtractedText,
        evaluationIsOutdated: jdResultChanged
          ? true
          : (currentPersisted?.evaluationIsOutdated ?? true),
      });
      const nextAnalysisContext: JDAnalysisContext = {
        jdInputSignature: nextJdInputSignature,
        targetRoleSignature: nextTargetRoleSignature,
        experienceSignature: nextExperienceSignature,
        evaluationSignature: nextBoundEvaluationSignature,
        itemSignatures,
        experienceText: nextExperienceText,
      };
      analysisResultRef.current = mergedResult;
      pendingJdAttachmentReplacementRef.current = null;
      evaluationSignatureRef.current = nextBoundEvaluationSignature;
      persistedJDAnalysisRef.current = nextPersistedJDAnalysis;
      analysisContextRef.current = nextAnalysisContext;
      setAnalysisResult(mergedResult);
      attachmentExtractedTextRef.current = attachmentExtractedText ?? null;
      setAttachmentExtractedText(attachmentExtractedTextRef.current);
      const nextRestoredAttachmentContext: RestoredJDAttachmentContext | null =
        inputMode === "attachment"
          ? {
            jdText: nextJdText,
            jdInputSignature: nextJdInputSignature,
            attachmentName,
            attachmentExtractedText: attachmentExtractedText ?? null,
          }
          : null;
      restoredAttachmentContextRef.current = nextRestoredAttachmentContext;
      setRestoredAttachmentContext(nextRestoredAttachmentContext);
      setPersistedJDAnalysis(nextPersistedJDAnalysis);
      setAnalysisContext(nextAnalysisContext);
      if (mergedResult.resumeEvaluation?.jdMatch === null) {
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
    requestEvaluationSignature: string,
    requestJDResultIdentity: string,
    requestJDMatchPercentage: number | undefined
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
    if (!canPersistCurrentJDAnalysis()) {
      return false;
    }
    if (
      buildJDResultIdentity(currentResult) !== requestJDResultIdentity
      || (
        requestJDMatchPercentage !== undefined
        && currentResult.matchPercentage !== requestJDMatchPercentage
      )
      || evaluation.jdMatch !== (requestJDMatchPercentage ?? null)
    ) {
      return false;
    }
    const basePersistedFingerprint = resolveLocalAnalysisWriteBase(
      currentPersisted
    );
    if (basePersistedFingerprint === undefined) {
      return false;
    }
    const nextPersistedJDAnalysis: ResumeJDAnalysis = {
      ...stripLocalEvaluationAttestation(currentPersisted),
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
  }, [
    authUserKey,
    canPersistCurrentJDAnalysis,
    resolveLocalAnalysisWriteBase,
    resumeId,
    targetRoleSignature,
  ]);

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
      attachmentExtractedText: attachmentExtractedTextRef.current,
      analysisPayload,
    };
  }, []);

  const buildAnalyzeSnapshot = useCallback((): JDAnalyzeRequestSnapshot => {
    const snapshot = getAnalysisSnapshot();
    const restoredContext = restoredAttachmentContextRef.current;
    const inputMode = snapshot.jdFile || restoredContext ? "attachment" : "text";
    const snapshotJdInputSignature = snapshot.jdFile
      ? buildJDInputSignature(snapshot.jdText, snapshot.jdFile)
      : restoredContext
        ? buildPersistedJDInputSignature(
          snapshot.jdText,
          "attachment",
          restoredContext.attachmentName
        )
        : buildJDInputSignature(snapshot.jdText, null);
    const requestEvaluationJDContext = resolveResumeEvaluationJDContext({
      jdText: snapshot.jdText,
      inputMode,
      attachmentExtractedText: snapshot.attachmentExtractedText,
      matchPercentage: analysisResultRef.current?.matchPercentage,
    });
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
      evaluationSignature: buildEvaluationSignature({
        jdInputSignature: snapshotJdInputSignature,
        resume: snapshot.analysisPayload,
        jdAnalysisResult: analysisResultRef.current,
        jdAvailable: requestEvaluationJDContext.jdAvailable,
      }),
      targetRoleSignature: canonicalStringify({
        targetRole: evaluationInputRef.current.targetRole?.trim() ?? "",
      }),
      analysisPayload: snapshot.analysisPayload,
      jdInputSignature: snapshotJdInputSignature,
      experienceText: buildExperienceTextSnapshot(snapshot.experiences),
      inputMode,
      attachmentName: snapshot.jdFile?.name ?? restoredContext?.attachmentName,
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
    pendingJdAttachmentReplacementRef.current = null;
    jdTextRef.current = nextJdText;
    setJdText(nextJdText);
    clearJdFile();
    restoredAttachmentContextRef.current = null;
    setRestoredAttachmentContext(null);
  }, [clearJdFile]);

  const handleStopAnalysis = useCallback(() => {
    invalidateAnalysisRun();
  }, [invalidateAnalysisRun]);

  const runAnalyze = useCallback(
    async (
      options?: AnalyzeOptions & HandleAnalyzeOptions
    ): Promise<JDAnalyzeOutcome> => {
      if (options?.shouldContinue?.() === false) return { status: "aborted" };
      if (!canPersistCurrentJDAnalysis()) {
        return { status: "pending_conflict" };
      }
      let ownerOperation: Awaited<ReturnType<typeof ownerGuard.beginOperation>>;
      try {
        ownerOperation = await ownerGuard.beginOperation();
      } catch (error) {
        if (!isAuthContextChangedError(error)) {
          console.error("Failed to capture JD analysis owner", error);
        }
        return { status: "aborted" };
      }
      if (options?.shouldContinue?.() === false) return { status: "aborted" };
      if (!canPersistCurrentJDAnalysis()) {
        return { status: "pending_conflict" };
      }
      const runId = analysisRunIdRef.current + 1;
      analysisRunIdRef.current = runId;
      activeAnalysisRunIdRef.current = runId;
      const controller = new AbortController();
      abortControllerRef.current = controller;
      setThinkingText("");
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
          const resolution = resolveThoughtDisplayEvent(event);
          if (resolution && resolution.kind === "reset") {
            setThinkingText("");
            options?.onEvent?.(event);
            return;
          }
          if (resolution && resolution.kind === "model_thought") {
            setThinkingText((current) => appendJDThinkingText(current, resolution.text));
            options?.onEvent?.(event);
            return;
          }
          options?.onEvent?.(event);
        },
        signal: controller.signal,
        expectedAuthCacheKey: ownerOperation.expectedAuthCacheKey,
        shouldContinue: () => (
          options?.shouldContinue?.() !== false
          && activeAnalysisRunIdRef.current === runId
          && activeResumeIdRef.current === resumeId
          && activeAnalysisIdentityRef.current === analysisIdentity
          && ownerGuard.isOperationCurrent(ownerOperation)
          && !pendingJDAnalysisConflictRef.current
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
      canPersistCurrentJDAnalysis,
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
    if (options?.shouldContinue?.() === false) {
      return Promise.resolve({ status: "aborted" });
    }
    if (!canPersistCurrentJDAnalysis()) {
      return Promise.resolve({ status: "pending_conflict" });
    }
    if (analyzeRequestRef.current) {
      return analyzeRequestRef.current;
    }
    const request = (async (): Promise<JDAnalyzeOutcome> => {
      const hasPreparedSelection = await waitForPendingJdFileSelection();
      if (!hasPreparedSelection || options?.shouldContinue?.() === false) {
        return { status: "aborted" };
      }
      if (!canPersistCurrentJDAnalysis()) {
        return { status: "pending_conflict" };
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
        hasMissingAttachmentContext: Boolean(
          restoredAttachmentContextRef.current
          && !snapshot.jdFile
          && !snapshot.attachmentExtractedText?.trim()
        ),
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
        shouldContinue: options?.shouldContinue,
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
    canPersistCurrentJDAnalysis,
    needsReanalysis,
    persistedJDAnalysis?.isOutdated,
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
    evaluationJdText: resumeEvaluationJDContext.text,
    evaluationJdAvailable: resumeEvaluationJDContext.jdAvailable,
    evaluationJdMatchPercentage: resumeEvaluationJDContext.jdMatchPercentage,
    isEvaluationJdAnalysisInputCurrent,
    hasMissingEvaluationJdContext: resumeEvaluationJDContext.hasMissingAttachmentText,
    hasPendingJdFileSelection,
    hasPendingJDAnalysisConflict: Boolean(pendingJDAnalysisConflict),
    canPersistCurrentJDAnalysis,
    restorePendingJDAnalysisRecovery,
    discardPendingJDAnalysisRecovery,
    convertRestoredAttachmentToText,
    persistResumeEvaluation,
    thinkingText,
    handleStopAnalysis,
  };
};
