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
import { buildEmptyDiff } from "./jdAnalysisDiffUtils";

const usesCurrentResumeScoreContract = (result: JDAnalysisResult | null) => (
  result?.resumeEvaluation?.evaluationVersion === "resume_flow_v1"
);

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
    mode === "partial" || mode === "quality"
      ? mergeAnalysisResult(
        previousResult,
        incomingResult,
        mode === "quality" ? buildEmptyDiff() : stableDiff
      )
      : {
        ...incomingResult,
        // Lightweight JD responses intentionally omit the deep report.
        resumeEvaluation:
          incomingResult.resumeEvaluation ?? previousResult?.resumeEvaluation,
      };
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
  const scoreContractChanged = Boolean(previousResult)
    && usesCurrentResumeScoreContract(previousResult)
      !== usesCurrentResumeScoreContract(nextResult);
  const scoreCompatibleResult = scoreContractChanged
    ? { ...stabilizedResult, matchTrend: undefined }
    : stabilizedResult;
  const finalResult =
    mode === "partial"
      ? stripTrendsByDiff(scoreCompatibleResult, stableDiff)
      : scoreCompatibleResult;

  return {
    nextResult,
    finalResult,
    resetTrendBase,
  };
};
