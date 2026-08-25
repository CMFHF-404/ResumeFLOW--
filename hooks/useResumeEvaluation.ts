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
  jdText: string;
  jdAnalysisResult: JDAnalysisResult | null;
  snapshot: ResumeEvaluationSnapshot;
  evaluationSignature: string;
  persistEvaluation: (
    evaluation: ResumeEvaluation,
    requestEvaluationSignature: string
  ) => boolean;
};

const isAbortError = (error: unknown) => (
  typeof error === "object" && error !== null && "name" in error
  && (error as { name?: unknown }).name === "AbortError"
);

/**
 * The expensive six-dimension request intentionally owns a separate run id
 * and AbortController. It can never cancel, replace, or invalidate JD fit.
 */
export const useResumeEvaluation = ({
  authUserKey,
  resumeId,
  jdText,
  jdAnalysisResult,
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
  const activeResumeIdRef = useRef(resumeId);

  useLayoutEffect(() => {
    activeResumeIdRef.current = resumeId;
  }, [resumeId]);

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
  }, [evaluationSignature, stopEvaluation]);

  const generateEvaluation = useCallback(async (): Promise<ResumeEvaluationOutcome> => {
    if (controllerRef.current) {
      return { status: "aborted" };
    }
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    const controller = new AbortController();
    const requestEvaluationSignature = evaluationSignature;
    controllerRef.current = controller;
    setError(null);
    setThinkingText("");
    setIsEvaluating(true);
    let hasThoughtTitle = false;
    let operation: Awaited<ReturnType<typeof ownerGuard.beginOperation>> | null = null;
    const isCurrent = () => (
      runIdRef.current === runId
      && activeResumeIdRef.current === resumeId
      && Boolean(operation && ownerGuard.isOperationCurrent(operation))
    );
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
      const evaluation = await aiService.evaluateResume({
        text: jdText,
        resumeText: canonicalStringify(snapshot),
        ...(typeof jdAnalysisResult?.matchPercentage === "number"
          ? { jdMatchPercentage: jdAnalysisResult.matchPercentage }
          : {}),
      }, onEvent, controller.signal, {
        expectedAuthCacheKey: operation.expectedAuthCacheKey,
      });
      await ownerGuard.assertOperationCurrent(operation);
      if (!isCurrent()) return { status: "aborted" };
      if (!persistEvaluation(evaluation, requestEvaluationSignature)) {
        return { status: "aborted" };
      }
      return { status: "success", evaluation };
    } catch (cause) {
      if (isAbortError(cause) || isAuthContextChangedError(cause)) {
        return { status: "aborted" };
      }
      if (isCurrent()) {
        setError(cause instanceof Error ? cause.message : "六维报告生成失败，请重试");
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
    evaluationSignature,
    jdAnalysisResult?.matchPercentage,
    jdText,
    ownerGuard,
    persistEvaluation,
    resumeId,
    snapshot,
  ]);

  return {
    isEvaluating,
    thinkingText,
    evaluationError: error,
    generateEvaluation,
    stopEvaluation,
  };
};
