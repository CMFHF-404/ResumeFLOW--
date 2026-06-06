import type { JDAnalysisResult } from "../services/aiService";
import type { JDAnalysisContext } from "../types/analysis";
import {
  mergeAnalysisResult,
  shouldResetTrendBase,
  stabilizeAnalysisResult,
  stripTrendsByDiff,
  type MatchUpdateMode,
} from "./jdAnalysisMatchUtils";
import { subtractDiff, type JDItemDiff } from "./jdAnalysisDiffUtils";

export const resolveStableAnalysisDiff = (
  mode: MatchUpdateMode,
  diff: JDItemDiff,
  changedDuringAnalyze: JDItemDiff
) => (mode === "partial" ? subtractDiff(diff, changedDuringAnalyze) : diff);

export const assembleJDAnalysisResult = ({
  mode,
  analysisContext,
  previousResult,
  incomingResult,
  stableDiff,
  currentJdInputSignature,
}: {
  mode: MatchUpdateMode;
  analysisContext: JDAnalysisContext | null;
  previousResult: JDAnalysisResult | null;
  incomingResult: JDAnalysisResult;
  stableDiff: JDItemDiff;
  currentJdInputSignature: string;
}) => {
  const nextResult =
    mode === "partial"
      ? mergeAnalysisResult(previousResult, incomingResult, stableDiff)
      : incomingResult;
  const resetTrendBase = shouldResetTrendBase(
    mode,
    analysisContext,
    currentJdInputSignature
  );
  const trendBaseResult = resetTrendBase ? null : previousResult;
  const stabilizedResult = stabilizeAnalysisResult(
    trendBaseResult,
    nextResult
  );
  const finalResult =
    mode === "partial"
      ? stripTrendsByDiff(stabilizedResult, stableDiff)
      : stabilizedResult;

  return {
    nextResult,
    finalResult,
    resetTrendBase,
  };
};
