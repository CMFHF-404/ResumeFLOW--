import type {
  AnalyzeStreamEvent,
  JDAnalysisResult,
  JDAnalyzeProgressNode,
} from "../services/aiService";
import type {
  JDAnalysisContext,
  JDAnalysisItemSignatures,
} from "../types/analysis";
import { trackJDAnalysisComplete, trackJDAnalysisStart } from "../utils/analyticsTracker";
import {
  buildEmptyDiff,
  hasDiff,
  type JDItemDiff,
} from "./jdAnalysisDiffUtils";
import type { MatchUpdateMode } from "./jdAnalysisMatchUtils";
import {
  resolvePersistedAttachmentFields,
  type AnalysisStatePayload,
} from "./jdAnalysisPersistenceUtils";
import {
  runJDAnalysisRequest,
  type JDAnalysisRequestService,
  type JDAnalyzeRequestSnapshot,
  type RunJDAnalysisRequestResult,
} from "./jdAnalysisRequestRunner";
import {
  assembleJDAnalysisResult,
  resolveStableAnalysisDiff,
} from "./jdAnalysisResultAssemblyUtils";

export type JDAnalyzeOutcome =
  | { status: "success"; result: JDAnalysisResult }
  | { status: "no_change" }
  | { status: "missing_attachment" }
  | { status: "aborted" }
  | { status: "error" };

export type JDAnalyzeProgressHandler = (node: JDAnalyzeProgressNode) => void;
export type JDAnalyzeStreamHandler = (event: AnalyzeStreamEvent) => void;

export type JDAnalysisExecutionParams = {
  mode?: MatchUpdateMode;
  diff?: JDItemDiff;
  resumeId: string | null;
  authUserKey?: string | null;
  analysisContext: JDAnalysisContext | null;
  analysisResult: JDAnalysisResult | null;
  service: JDAnalysisRequestService;
  buildAnalyzeSnapshot: () => JDAnalyzeRequestSnapshot;
  recordPostAnalyzeDiff: (
    startSignatures: JDAnalysisItemSignatures,
    latestSignatures: JDAnalysisItemSignatures
  ) => JDItemDiff;
  updateAnalyzeDiffState: (
    mode: MatchUpdateMode,
    diff: JDItemDiff,
    changedDuringAnalyze: JDItemDiff
  ) => void;
  updateAnalysisState: (payload: AnalysisStatePayload) => void;
  applyMatchScoresForResult: (
    result: JDAnalysisResult,
    mode: MatchUpdateMode,
    diff: JDItemDiff
  ) => void;
  promoteAttachmentToText: (jdText: string) => void;
  clearFullAnalysisDiffState: () => void;
  setIsAnalyzing: (value: boolean) => void;
  setIsJDCollapsed: (value: boolean) => void;
  setDebugInfo: (value: any) => void;
  onProgress?: JDAnalyzeProgressHandler;
  onEvent?: JDAnalyzeStreamHandler;
  requestRunner?: typeof runJDAnalysisRequest;
  trackStart?: typeof trackJDAnalysisStart;
  trackComplete?: typeof trackJDAnalysisComplete;
  now?: () => number;
  logError?: (...args: unknown[]) => void;
  signal?: AbortSignal;
};

const isAbortError = (error: unknown) => (
  typeof error === "object"
  && error !== null
  && "name" in error
  && (error as { name?: unknown }).name === "AbortError"
);

export const runJDAnalysisExecution = async ({
  mode = "full",
  diff = buildEmptyDiff(),
  resumeId,
  authUserKey,
  analysisContext,
  analysisResult,
  service,
  buildAnalyzeSnapshot,
  recordPostAnalyzeDiff,
  updateAnalyzeDiffState,
  updateAnalysisState,
  applyMatchScoresForResult,
  promoteAttachmentToText,
  clearFullAnalysisDiffState,
  setIsAnalyzing,
  setIsJDCollapsed,
  setDebugInfo,
  onProgress,
  onEvent,
  requestRunner = runJDAnalysisRequest,
  trackStart = trackJDAnalysisStart,
  trackComplete = trackJDAnalysisComplete,
  now = Date.now,
  logError = console.error,
  signal,
}: JDAnalysisExecutionParams): Promise<JDAnalyzeOutcome> => {
  if (mode === "partial" && !hasDiff(diff)) {
    return { status: "no_change" };
  }
  if (mode === "full") {
    clearFullAnalysisDiffState();
  }

  const startedAt = now();
  if (mode === "full") {
    trackStart({ resumeId });
  }
  setIsAnalyzing(true);
  try {
    onProgress?.("prepare_context");
    const startSnapshot = buildAnalyzeSnapshot();
    onProgress?.("request_ai");
    const requestResult: RunJDAnalysisRequestResult = await requestRunner({
      snapshot: startSnapshot,
      mode,
      analysisContext,
      analysisResult,
      onProgress,
      onEvent,
      service,
      signal,
    });
    const latestSnapshot = buildAnalyzeSnapshot();
    const changedDuringAnalyze = recordPostAnalyzeDiff(
      startSnapshot.itemSignatures,
      latestSnapshot.itemSignatures
    );
    const stableDiff = resolveStableAnalysisDiff(
      mode,
      diff,
      changedDuringAnalyze
    );
    if (mode === "partial" && !hasDiff(stableDiff)) {
      updateAnalyzeDiffState(mode, diff, changedDuringAnalyze);
      return { status: "no_change" };
    }

    onProgress?.("merge_result");
    const { finalResult } = assembleJDAnalysisResult({
      mode,
      analysisContext,
      previousResult: analysisResult,
      incomingResult: requestResult.result,
      stableDiff,
      currentJdInputSignature: startSnapshot.jdInputSignature,
    });
    onProgress?.("apply_score");
    applyMatchScoresForResult(finalResult, mode, stableDiff);

    const persistedAttachmentFields = resolvePersistedAttachmentFields({
      snapshot: startSnapshot,
      hasCurrentFile: Boolean(requestResult.currentFile),
      attachmentSupplementalJdText: requestResult.attachmentSupplementalJdText,
      extractedAttachmentText: requestResult.extractedAttachmentText,
      shouldPersistAttachmentAsText: requestResult.shouldPersistAttachmentAsText,
    });
    if (requestResult.shouldPersistAttachmentAsText) {
      promoteAttachmentToText(persistedAttachmentFields.jdText);
    }

    onProgress?.("persist_result");
    updateAnalysisState({
      result: finalResult,
      itemSignatures: startSnapshot.itemSignatures,
      experienceSignature: startSnapshot.experienceSignature,
      jdInputSignature: persistedAttachmentFields.jdInputSignature,
      jdText: persistedAttachmentFields.jdText,
      experienceText: startSnapshot.experienceText,
      inputMode: persistedAttachmentFields.inputMode,
      attachmentName: persistedAttachmentFields.attachmentName,
      attachmentExtractedText: persistedAttachmentFields.attachmentExtractedText,
    });
    updateAnalyzeDiffState(mode, diff, changedDuringAnalyze);
    if (mode === "full") {
      setIsJDCollapsed(true);
    }
    setDebugInfo(null);
    if (mode === "full") {
      trackComplete({
        resumeId,
        matchScore: finalResult.matchPercentage,
        durationMs: now() - startedAt,
      }, authUserKey);
    }
    return { status: "success", result: finalResult };
  } catch (error) {
    if (isAbortError(error)) {
      return { status: "aborted" };
    }
    logError("Failed to analyze JD", error);
    return { status: "error" };
  } finally {
    setIsAnalyzing(false);
  }
};
