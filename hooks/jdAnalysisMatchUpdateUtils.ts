import type { MatchScoreEntry, MatchTrend } from "../types/analysis";
import type { ResumeExperienceView, SkillGroupView } from "../types/resume";
import { buildMatchReasonMap, buildMatchScoreMap, buildMatchTrendMap, fillMissingSkillScores, type MatchApplyOptions } from "./jdAnalysisMatchUtils";
import type { JDItemDiff } from "./jdAnalysisDiffUtils";

const shouldSkipPartialUpdate = (options?: MatchApplyOptions) =>
  options?.mode === "partial" && (!options.targetIds || options.targetIds.size === 0);

export const applyExperienceScoreUpdate = (
  items: ResumeExperienceView[],
  matches?: MatchScoreEntry[],
  options?: MatchApplyOptions
) => {
  if (shouldSkipPartialUpdate(options)) {
    return items;
  }
  const matchScores = buildMatchScoreMap(matches);
  const matchReasons = buildMatchReasonMap(matches);
  const mode = options?.mode ?? "full";
  const targetIds = options?.targetIds;
  return items.map((item) => {
    if (mode === "partial" && !targetIds?.has(item.id)) {
      return item;
    }
    const hasScore = matchScores.has(item.id);
    return {
      ...item,
      matchScore: hasScore ? matchScores.get(item.id) : undefined,
      matchReason: hasScore ? matchReasons.get(item.id) : undefined,
    };
  });
};

export const applyExperienceTrendUpdate = (
  items: ResumeExperienceView[],
  matches?: MatchScoreEntry[],
  options?: MatchApplyOptions
) => {
  if (shouldSkipPartialUpdate(options)) {
    return items;
  }
  const matchTrends = buildMatchTrendMap(matches);
  const mode = options?.mode ?? "full";
  const targetIds = options?.targetIds;
  return items.map((item) => {
    if (mode === "partial" && !targetIds?.has(item.id)) {
      return item;
    }
    const nextTrend = matchTrends.get(item.id);
    if (nextTrend === item.matchTrend) {
      return item;
    }
    if (nextTrend !== undefined) {
      return { ...item, matchTrend: nextTrend };
    }
    if (item.matchTrend === undefined) {
      return item;
    }
    return { ...item, matchTrend: undefined };
  });
};

export const applyScoreMapUpdateValue = (
  prev: Map<string, number>,
  scores: Map<string, number>,
  options?: MatchApplyOptions
) => {
  const mode = options?.mode ?? "full";
  const targetIds = options?.targetIds;
  if (mode === "partial") {
    if (!targetIds || targetIds.size === 0) {
      return prev;
    }
    const next = new Map(prev);
    targetIds.forEach((id) => {
      if (scores.has(id)) {
        next.set(id, scores.get(id)!);
      } else {
        next.delete(id);
      }
    });
    return next;
  }
  return new Map(scores);
};

export const applyTrendMapUpdateValue = (
  prev: Map<string, MatchTrend>,
  trends: Map<string, MatchTrend>,
  options?: MatchApplyOptions
) => {
  const mode = options?.mode ?? "full";
  const targetIds = options?.targetIds;
  if (mode === "partial") {
    if (!targetIds || targetIds.size === 0) {
      return prev;
    }
    const next = new Map(prev);
    targetIds.forEach((id) => {
      if (trends.has(id)) {
        next.set(id, trends.get(id)!);
      } else {
        next.delete(id);
      }
    });
    return next;
  }
  return new Map(trends);
};

export const buildSkillScoreUpdateMap = (
  matches: MatchScoreEntry[] | undefined,
  skillGroups: SkillGroupView[],
  options?: MatchApplyOptions
) => {
  if (options?.mode === "partial" && matches === undefined) {
    return null;
  }
  const matchScores = buildMatchScoreMap(matches);
  if (matches !== undefined) {
    fillMissingSkillScores(matchScores, skillGroups);
  }
  return matchScores;
};

export const clearStaleExperienceMatches = (
  items: ResumeExperienceView[],
  staleIds: Set<string>
) => {
  if (staleIds.size === 0) {
    return items;
  }
  return items.map((item) =>
    staleIds.has(item.id)
      ? { ...item, matchScore: undefined, matchReason: undefined, matchTrend: undefined }
      : item
  );
};

export const updateStaleExperienceIds = (
  prev: Set<string>,
  staleIds: Set<string>,
  options?: { replaceStale?: boolean }
) => {
  const next = options?.replaceStale ? new Set<string>() : new Set(prev);
  staleIds.forEach((id) => next.add(id));
  return next;
};

export const clearMapTargets = <T>(
  prev: Map<string, T>,
  targetIds: Set<string>
) => {
  if (targetIds.size === 0) {
    return prev;
  }
  const next = new Map(prev);
  targetIds.forEach((id) => next.delete(id));
  return next;
};

export const buildStaleMapTargets = (diff: JDItemDiff) => ({
  certificationIds: diff.certifications,
  skillIds: diff.skills,
});
