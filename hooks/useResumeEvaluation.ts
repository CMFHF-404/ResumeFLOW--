import { useCallback, useEffect, useRef, useState } from "react";
import { aiService, type AnalyzeStreamEvent, type JDAnalysisResult } from "../services/aiService";
import type { ResumeEvaluation } from "../types/ai";
import type { ResumeEvaluationSnapshot } from "../utils/resumeEvaluationSnapshot";
import { canonicalStringify } from "./jdAnalysisSignatureUtils";
import { resolveThoughtDisplayEvent } from "../utils/aiThought";
import { JD_ANALYSIS_PROGRESS_NODE_TITLES } from "../views/ResumeEditor/constants";
import { appendJDThinkingText } from "./jdAnalysisThinkingText";

export type ResumeEvaluationOutcome =
  | { status: "success"; evaluation: ResumeEvaluation }
  | { status: "aborted" }
  | { status: "error" };

type UseResumeEvaluationOptions = {
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
  resumeId,
  jdText,
  jdAnalysisResult,
  snapshot,
  evaluationSignature,
  persistEvaluation,
}: UseResumeEvaluationOptions) => {
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [thinkingText, setThinkingText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const runIdRef = useRef(0);
  const activeResumeIdRef = useRef(resumeId);
  activeResumeIdRef.current = resumeId;

  const stopEvaluation = useCallback(() => {
    runIdRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
    setIsEvaluating(false);
    setThinkingText("");
  }, []);

  useEffect(() => stopEvaluation, [stopEvaluation]);
  useEffect(() => {
    stopEvaluation();
    setError(null);
  }, [resumeId, stopEvaluation]);
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
    const isCurrent = () => (
      runIdRef.current === runId && activeResumeIdRef.current === resumeId
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
      const evaluation = await aiService.evaluateResume({
        text: jdText,
        resumeText: canonicalStringify(snapshot),
        ...(typeof jdAnalysisResult?.matchPercentage === "number"
          ? { jdMatchPercentage: jdAnalysisResult.matchPercentage }
          : {}),
      }, onEvent, controller.signal);
      if (!isCurrent()) return { status: "aborted" };
      if (!persistEvaluation(evaluation, requestEvaluationSignature)) {
        return { status: "aborted" };
      }
      return { status: "success", evaluation };
    } catch (cause) {
      if (isAbortError(cause)) return { status: "aborted" };
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
  }, [evaluationSignature, jdAnalysisResult?.matchPercentage, jdText, persistEvaluation, resumeId, snapshot]);

  return {
    isEvaluating,
    thinkingText,
    evaluationError: error,
    generateEvaluation,
    stopEvaluation,
  };
};
