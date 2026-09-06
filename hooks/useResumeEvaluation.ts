import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAuthOwnerOperationGuard } from "./useAuthOwnerOperationGuard";
import { isAuthContextChangedError } from "../services/apiClient";
import { aiService, type AnalyzeStreamEvent, type JDAnalysisResult } from "../services/aiService";
import type { ResumeEvaluation } from "../types/ai";
import type { ResumeEvaluationSnapshot } from "../utils/resumeEvaluationSnapshot";
import { canonicalStringify } from "./jdAnalysisSignatureUtils";
import { resolveThoughtDisplayEvent } from "../utils/aiThought";
import { JD_ANALYSIS_PROGRESS_NODE_TITLES } from "../constants/jdAnalysis";
import { appendJDThinkingText } from "./jdAnalysisThinkingText";

export type ResumeEvaluationOutcome =
  | { status: "success"; evaluation: ResumeEvaluation }
  | { status: "aborted" }
  | { status: "error" };

type UseResumeEvaluationOptions = {
  authUserKey: string | null;
  resumeId: string | null;
  /** Canonical full JD text; attachment textarea supplements are not sufficient. */
  jdText: string;
  jdAvailable: boolean;
  jdMatchPercentage: number | undefined;
  isJdAnalysisInputCurrent: boolean;
  hasMissingJdContext: boolean;
  hasPendingJdFileSelection: () => boolean;
  hasJdAnalysisPersistenceConflict: boolean;
  canPersistCurrentJDAnalysis?: () => boolean;
  jdAnalysisResult: JDAnalysisResult | null;
  isEvaluationOutdated: boolean;
  snapshot: ResumeEvaluationSnapshot;
  evaluationSignature: string;
  persistEvaluation: (
    evaluation: ResumeEvaluation,
    requestEvaluationSignature: string,
    requestJDResultIdentity: string,
    requestJDMatchPercentage: number | undefined
  ) => boolean;
};

export const buildJDResultIdentity = (result: JDAnalysisResult | null) => {
  if (!result) return canonicalStringify(null);
  const { resumeEvaluation: _evaluation, ...jdResult } = result;
  return canonicalStringify(jdResult);
};

export const buildEvaluationSignature = ({
  jdInputSignature,
  resume,
  jdAnalysisResult,
  jdAvailable,
}: {
  jdInputSignature: string;
  resume: ResumeEvaluationSnapshot;
  jdAnalysisResult: JDAnalysisResult | null;
  jdAvailable: boolean;
}) => canonicalStringify({
  jdInputSignature,
  resume,
  jdAvailable,
  jdResultIdentity: jdAvailable
    ? buildJDResultIdentity(jdAnalysisResult)
    : buildJDResultIdentity(null),
  jdMatchPercentage:
    jdAvailable
    && typeof jdAnalysisResult?.matchPercentage === "number"
    && Number.isFinite(jdAnalysisResult.matchPercentage)
      ? jdAnalysisResult.matchPercentage
      : null,
});

export const rebindEvaluationSignature = (
  signature: string,
  jdAnalysisResult: JDAnalysisResult
) => {
  try {
    const parsed = JSON.parse(signature) as {
      jdInputSignature?: unknown;
      resume?: unknown;
      jdAvailable?: unknown;
    };
    if (
      typeof parsed.jdInputSignature === "string"
      && parsed.resume
      && typeof parsed.resume === "object"
    ) {
      return buildEvaluationSignature({
        jdInputSignature: parsed.jdInputSignature,
        resume: parsed.resume as ResumeEvaluationSnapshot,
        jdAnalysisResult,
        jdAvailable: parsed.jdAvailable === true,
      });
    }
  } catch {
    // A locally produced signature is JSON. Fail closed if legacy data reaches here.
  }
  return canonicalStringify({
    legacyEvaluationSignature: signature,
    jdResultIdentity: buildJDResultIdentity(jdAnalysisResult),
    jdMatchPercentage: jdAnalysisResult.matchPercentage,
  });
};

export const reconcileJDResultEvaluation = (
  currentResult: JDAnalysisResult | null,
  nextResult: JDAnalysisResult
) => {
  const { resumeEvaluation: _incomingEvaluation, ...nextJDResult } = nextResult;
  const jdResultChanged = Boolean(currentResult)
    && buildJDResultIdentity(currentResult) !== buildJDResultIdentity(nextResult);
  const retainedEvaluation = !jdResultChanged
    ? currentResult?.resumeEvaluation
    : undefined;
  return {
    jdResultChanged,
    result: (retainedEvaluation
      ? { ...nextJDResult, resumeEvaluation: retainedEvaluation }
      : nextJDResult) as JDAnalysisResult,
  };
};

const isAbortError = (error: unknown) => (
  typeof error === "object" && error !== null && "name" in error
  && (error as { name?: unknown }).name === "AbortError"
);

const RESUME_EVALUATION_PUBLIC_ERROR_MESSAGE = "本次六维报告未保存，请重试。";
const RESUME_EVALUATION_RETAINED_ERROR_MESSAGE =
  "本次六维报告未保存，已保留上一份可信报告，请重试。";
const RESUME_EVALUATION_MISSING_ATTACHMENT_MESSAGE =
  "当前 JD 附件正文不可用，请重新上传并完成 JD 分析后再生成六维报告。";
const RESUME_EVALUATION_MISSING_MATCH_MESSAGE =
  "当前 JD 匹配结果不可用，请先重新完成 JD 分析。";
const RESUME_EVALUATION_PENDING_ATTACHMENT_MESSAGE =
  "JD 附件仍在处理中，请稍候后重试。";
const RESUME_EVALUATION_PERSISTENCE_CONFLICT_MESSAGE =
  "检测到未处理的 JD 分析缓存冲突，请先选择恢复本地分析或舍弃本地副本。";

export const isCurrentTrustedEvaluation = (
  jdAnalysisResult: JDAnalysisResult | null,
  isEvaluationOutdated: boolean
) => Boolean(
  jdAnalysisResult?.resumeEvaluation && isEvaluationOutdated === false
);

export const resolveResumeEvaluationOutdated = ({
  evaluationVersion,
  boundEvaluationSignature,
  currentEvaluationSignature,
  persistedEvaluationIsOutdated,
  hasMissingAttachmentText,
}: {
  evaluationVersion?: string;
  boundEvaluationSignature?: string;
  currentEvaluationSignature: string;
  persistedEvaluationIsOutdated?: boolean;
  hasMissingAttachmentText: boolean;
}) => (
  evaluationVersion !== "resume_flow_v1"
  || boundEvaluationSignature !== currentEvaluationSignature
  || persistedEvaluationIsOutdated === true
  || hasMissingAttachmentText
);

/**
 * The expensive six-dimension request intentionally owns a separate run id
 * and AbortController. It can never cancel, replace, or invalidate JD fit.
 */
export const useResumeEvaluation = ({
  authUserKey,
  resumeId,
  jdText,
  jdAvailable,
  jdMatchPercentage,
  isJdAnalysisInputCurrent,
  hasMissingJdContext,
  hasPendingJdFileSelection,
  hasJdAnalysisPersistenceConflict,
  canPersistCurrentJDAnalysis = () => true,
  jdAnalysisResult,
  isEvaluationOutdated,
  snapshot,
  evaluationSignature,
  persistEvaluation,
}: UseResumeEvaluationOptions) => {
  const ownerGuard = useAuthOwnerOperationGuard(authUserKey);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [thinkingText, setThinkingText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const runIdRef = useRef(0);
  const jdResultIdentity = buildJDResultIdentity(jdAnalysisResult);
  const jdResultIdentityRef = useRef(jdResultIdentity);
  jdResultIdentityRef.current = jdResultIdentity;
  const latestInputsRef = useRef({
    jdText,
    jdAvailable,
    jdMatchPercentage,
    isJdAnalysisInputCurrent,
    hasMissingJdContext,
    hasPendingJdFileSelection,
    hasJdAnalysisPersistenceConflict,
    canPersistCurrentJDAnalysis,
    jdResultIdentity,
    snapshot,
    evaluationSignature,
    persistEvaluation,
  });
  latestInputsRef.current = {
    jdText,
    jdAvailable,
    jdMatchPercentage,
    isJdAnalysisInputCurrent,
    hasMissingJdContext,
    hasPendingJdFileSelection,
    hasJdAnalysisPersistenceConflict,
    canPersistCurrentJDAnalysis,
    jdResultIdentity,
    snapshot,
    evaluationSignature,
    persistEvaluation,
  };
  const activeResumeIdRef = useRef(resumeId);
  const hasTrustedEvaluationRef = useRef(false);
  const trustedEvaluationIdentityRef = useRef({ authUserKey, resumeId });

  useLayoutEffect(() => {
    const identityChanged = (
      trustedEvaluationIdentityRef.current.authUserKey !== authUserKey
      || trustedEvaluationIdentityRef.current.resumeId !== resumeId
    );
    trustedEvaluationIdentityRef.current = { authUserKey, resumeId };
    activeResumeIdRef.current = resumeId;
    hasTrustedEvaluationRef.current = (
      !identityChanged
      && isCurrentTrustedEvaluation(jdAnalysisResult, isEvaluationOutdated)
    );
  }, [authUserKey, isEvaluationOutdated, jdAnalysisResult, resumeId]);

  const stopEvaluation = useCallback(() => {
    runIdRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
    setIsEvaluating(false);
    setThinkingText("");
  }, []);

  useEffect(() => stopEvaluation, [stopEvaluation]);
  useLayoutEffect(() => {
    stopEvaluation();
    setError(null);
  }, [authUserKey, resumeId, stopEvaluation]);
  useEffect(() => {
    // A deep request is valid only for the exact JD + full-resume snapshot
    // it started with. Abort immediately when that signature changes.
    stopEvaluation();
  }, [evaluationSignature, hasJdAnalysisPersistenceConflict, jdResultIdentity, stopEvaluation]);

  const generateEvaluation = useCallback(async (): Promise<ResumeEvaluationOutcome> => {
    if (controllerRef.current) {
      return { status: "aborted" };
    }
    const requestInputs = latestInputsRef.current;
    if (
      requestInputs.hasJdAnalysisPersistenceConflict
      || !requestInputs.canPersistCurrentJDAnalysis()
    ) {
      setError(RESUME_EVALUATION_PERSISTENCE_CONFLICT_MESSAGE);
      return { status: "error" };
    }
    if (requestInputs.hasPendingJdFileSelection()) {
      setError(RESUME_EVALUATION_PENDING_ATTACHMENT_MESSAGE);
      return { status: "error" };
    }
    if (requestInputs.hasMissingJdContext) {
      setError(RESUME_EVALUATION_MISSING_ATTACHMENT_MESSAGE);
      return { status: "error" };
    }
    if (!requestInputs.isJdAnalysisInputCurrent) {
      setError(RESUME_EVALUATION_MISSING_MATCH_MESSAGE);
      return { status: "error" };
    }
    const requestJDMatchPercentage = requestInputs.jdAvailable
      && typeof requestInputs.jdMatchPercentage === "number"
      && Number.isFinite(requestInputs.jdMatchPercentage)
      && requestInputs.jdMatchPercentage >= 0
      && requestInputs.jdMatchPercentage <= 100
        ? requestInputs.jdMatchPercentage
        : undefined;
    if (
      requestInputs.jdAvailable
      && (!requestInputs.jdText.trim() || requestJDMatchPercentage === undefined)
    ) {
      setError(RESUME_EVALUATION_MISSING_MATCH_MESSAGE);
      return { status: "error" };
    }
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    const controller = new AbortController();
    const requestEvaluationSignature = requestInputs.evaluationSignature;
    const requestJDResultIdentity = requestInputs.jdResultIdentity;
    const requestJDText = requestInputs.jdText;
    const requestJDWasAvailable = requestInputs.jdAvailable;
    const requestSnapshot = requestInputs.snapshot;
    controllerRef.current = controller;
    setError(null);
    setThinkingText("");
    setIsEvaluating(true);
    let hasThoughtTitle = false;
    let operation: Awaited<ReturnType<typeof ownerGuard.beginOperation>> | null = null;
    const isCurrent = () => (
      runIdRef.current === runId
      && activeResumeIdRef.current === resumeId
      && jdResultIdentityRef.current === requestJDResultIdentity
      && Boolean(operation && ownerGuard.isOperationCurrent(operation))
    );
    const validateLiveInputs = (): ResumeEvaluationOutcome | null => {
      const latest = latestInputsRef.current;
      if (
        latest.hasJdAnalysisPersistenceConflict
        || !latest.canPersistCurrentJDAnalysis()
      ) {
        setError(RESUME_EVALUATION_PERSISTENCE_CONFLICT_MESSAGE);
        return { status: "error" };
      }
      if (
        latest.evaluationSignature !== requestEvaluationSignature
        || latest.jdResultIdentity !== requestJDResultIdentity
        || latest.jdText !== requestJDText
        || latest.jdAvailable !== requestJDWasAvailable
        || latest.hasPendingJdFileSelection()
        || latest.hasMissingJdContext
        || !latest.isJdAnalysisInputCurrent
      ) {
        return { status: "aborted" };
      }
      return null;
    };
    const onEvent = (event: AnalyzeStreamEvent) => {
      if (!isCurrent()) return;
      const resolution = resolveThoughtDisplayEvent(event, {
        includeProgress: true,
        progressTitleByNode: JD_ANALYSIS_PROGRESS_NODE_TITLES,
      });
      if (resolution?.kind === "reset") {
        hasThoughtTitle = false;
        setThinkingText("");
      } else if (resolution?.kind === "model_thought") {
        hasThoughtTitle = true;
        setThinkingText((current) => appendJDThinkingText(current, resolution.text));
      } else if (resolution?.kind === "status" && !hasThoughtTitle) {
        setThinkingText(resolution.text);
      }
    };
    try {
      operation = await ownerGuard.beginOperation();
      if (runIdRef.current !== runId) {
        return { status: "aborted" };
      }
      const preProviderFailure = validateLiveInputs();
      if (preProviderFailure) {
        return preProviderFailure;
      }
      const evaluation = await aiService.evaluateResume({
        text: requestJDText,
        resumeText: canonicalStringify(requestSnapshot),
        ...(requestJDMatchPercentage !== undefined
          ? { jdMatchPercentage: requestJDMatchPercentage }
          : {}),
      }, onEvent, controller.signal, {
        expectedAuthCacheKey: operation.expectedAuthCacheKey,
      });
      await ownerGuard.assertOperationCurrent(operation);
      if (!isCurrent()) return { status: "aborted" };
      const postProviderFailure = validateLiveInputs();
      if (postProviderFailure) {
        return postProviderFailure;
      }
      if (evaluation.jdMatch !== (requestJDMatchPercentage ?? null)) {
        return { status: "aborted" };
      }
      if (!latestInputsRef.current.persistEvaluation(
        evaluation,
        requestEvaluationSignature,
        requestJDResultIdentity,
        requestJDMatchPercentage
      )) {
        return { status: "aborted" };
      }
      return { status: "success", evaluation };
    } catch (cause) {
      if (isAbortError(cause) || isAuthContextChangedError(cause)) {
        return { status: "aborted" };
      }
      if (isCurrent()) {
        setError(
          hasTrustedEvaluationRef.current
            ? RESUME_EVALUATION_RETAINED_ERROR_MESSAGE
            : RESUME_EVALUATION_PUBLIC_ERROR_MESSAGE
        );
      }
      return { status: "error" };
    } finally {
      if (isCurrent()) {
        controllerRef.current = null;
        setIsEvaluating(false);
        setThinkingText("");
      }
    }
  }, [
    ownerGuard,
    resumeId,
  ]);

  return {
    isEvaluating,
    thinkingText,
    evaluationError: error,
    generateEvaluation,
    stopEvaluation,
  };
};
