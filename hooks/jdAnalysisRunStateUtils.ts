import type { JDAnalysisResult } from "../services/aiService";
import type {
  JDAnalysisContext,
  JDAnalysisItemSignatures,
} from "../types/analysis";
import { diffJDItemSignatures } from "../utils/resumeHelpers";
import {
  buildEmptyDiff,
  cloneDiff,
  hasDiff,
  mergeDiffs,
  subtractDiff,
  type JDItemDiff,
} from "./jdAnalysisDiffUtils";
import type { MatchUpdateMode } from "./jdAnalysisMatchUtils";

export type JDAnalyzePlan =
  | {
    action: "skip";
    status: "no_change";
    shouldClearNeedsReanalysis: boolean;
    shouldClearPendingDiff: boolean;
  }
  | { action: "missing_attachment"; status: "missing_attachment" }
  | { action: "run"; mode: MatchUpdateMode; diff?: JDItemDiff };

export const buildDiffFromAnalysisContext = (
  context: JDAnalysisContext | null,
  signatures: JDAnalysisItemSignatures
) => {
  if (!context) {
    return buildEmptyDiff();
  }
  return diffJDItemSignatures(context.itemSignatures, signatures);
};

export const resolveJDAnalyzePlan = ({
  analysisResult,
  analysisContext,
  snapshotItemSignatures,
  snapshotJdInputSignature,
  pendingDiff,
  needsReanalysis,
  hasMissingAttachmentContext,
}: {
  analysisResult: JDAnalysisResult | null;
  analysisContext: JDAnalysisContext | null;
  snapshotItemSignatures: JDAnalysisItemSignatures;
  snapshotJdInputSignature: string;
  pendingDiff: JDItemDiff;
  needsReanalysis: boolean;
  hasMissingAttachmentContext: boolean;
}): JDAnalyzePlan => {
  const contextDiff = buildDiffFromAnalysisContext(
    analysisContext,
    snapshotItemSignatures
  );
  const diffSnapshot = analysisContext
    ? mergeDiffs(pendingDiff, contextDiff)
    : cloneDiff(pendingDiff);
  const hasPendingDiff = hasDiff(diffSnapshot);
  const hasJdInputChanged =
    analysisContext?.jdInputSignature !== snapshotJdInputSignature;
  const hasPrevExperienceText =
    analysisContext?.experienceText !== undefined;
  const shouldSkipAnalyze =
    Boolean(analysisResult)
    && Boolean(analysisContext)
    && !hasPendingDiff
    && !hasJdInputChanged;

  if (shouldSkipAnalyze) {
    return {
      action: "skip",
      status: "no_change",
      shouldClearNeedsReanalysis: needsReanalysis,
      shouldClearPendingDiff: Boolean(analysisContext) && hasDiff(pendingDiff),
    };
  }
  if (hasMissingAttachmentContext) {
    return { action: "missing_attachment", status: "missing_attachment" };
  }
  if (
    analysisResult
    && analysisContext
    && hasPendingDiff
    && !hasJdInputChanged
    && hasPrevExperienceText
  ) {
    return {
      action: "run",
      mode: "partial",
      diff: diffSnapshot,
    };
  }
  return {
    action: "run",
    mode: "full",
  };
};

export const resolveAnalyzeDiffStateUpdate = ({
  mode,
  diff,
  changedDuringAnalyze,
  pendingDiff,
}: {
  mode: MatchUpdateMode;
  diff: JDItemDiff;
  changedDuringAnalyze: JDItemDiff;
  pendingDiff: JDItemDiff;
}) => {
  if (mode === "partial") {
    const stableDiff = subtractDiff(diff, changedDuringAnalyze);
    const nextPendingDiff = subtractDiff(pendingDiff, stableDiff);
    return {
      stableDiff,
      experienceIdsToClear: stableDiff.experiences,
      pendingDiffToClear: stableDiff,
      shouldMarkPendingDiffStale: false,
      shouldReplaceStale: false,
      needsReanalysis: hasDiff(nextPendingDiff),
    };
  }
  const hasPendingDiff = hasDiff(pendingDiff);
  return {
    stableDiff: diff,
    experienceIdsToClear: new Set<string>(),
    pendingDiffToClear: buildEmptyDiff(),
    shouldMarkPendingDiffStale: hasPendingDiff,
    shouldReplaceStale: hasPendingDiff,
    needsReanalysis: hasPendingDiff,
  };
};
