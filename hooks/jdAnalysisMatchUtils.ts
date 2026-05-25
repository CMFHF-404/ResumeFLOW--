import type { Dispatch, SetStateAction } from "react";
import type { JDAnalysisResult } from "../services/aiService";
import type {
  JDAnalysisContext,
  MatchScoreEntry,
  MatchTrend,
} from "../types/analysis";
import type { SkillGroupView } from "../types/resume";
import { clampMatchScore } from "../utils/resumeHelpers";
import type { JDItemDiff } from "./jdAnalysisDiffUtils";
import { hasDiff } from "./jdAnalysisDiffUtils";

const DEFAULT_SKILL_MATCH_SCORE = 0;

export type MatchUpdateMode = "full" | "partial";

export type MatchApplyOptions = {
  mode?: MatchUpdateMode;
  targetIds?: Set<string>;
};

export const buildMatchScoreMap = (matches?: MatchScoreEntry[]) => {
  const map = new Map<string, number>();
  (matches || []).forEach((match) => {
    const score = clampMatchScore(match.score);
    if (score !== undefined) {
      map.set(match.id, score);
    }
  });
  return map;
};

// 补齐 AI 漏掉的技能匹配分，确保每个技能都有可展示的结果。
export const fillMissingSkillScores = (
  scoreMap: Map<string, number>,
  groups: SkillGroupView[]
) => {
  groups.forEach((group) => {
    group.skills.forEach((skill) => {
      if (!scoreMap.has(skill.id)) {
        scoreMap.set(skill.id, DEFAULT_SKILL_MATCH_SCORE);
      }
    });
  });
  return scoreMap;
};

export const buildMatchReasonMap = (matches?: MatchScoreEntry[]) => {
  const map = new Map<string, string>();
  (matches || []).forEach((match) => {
    if (match.reason) {
      map.set(match.id, match.reason);
    }
  });
  return map;
};

export const buildMatchTrendMap = (matches?: MatchScoreEntry[]) => {
  const map = new Map<string, MatchTrend>();
  (matches || []).forEach((match) => {
    if (match.trend) {
      map.set(match.id, match.trend);
    }
  });
  return map;
};

const buildMatchEntryMap = (matches?: MatchScoreEntry[]) => {
  const map = new Map<string, MatchScoreEntry>();
  (matches || []).forEach((match) => {
    map.set(match.id, match);
  });
  return map;
};

const normalizeScore = (value: unknown): number | undefined =>
  clampMatchScore(value);

const resolveTrend = (
  prevScore?: number,
  nextScore?: number
): MatchTrend | undefined => {
  if (typeof prevScore !== "number" || typeof nextScore !== "number") {
    return undefined;
  }
  if (nextScore > prevScore) {
    return "up";
  }
  if (nextScore < prevScore) {
    return "down";
  }
  return "same";
};

export const shouldResetTrendBase = (
  mode: MatchUpdateMode,
  context: JDAnalysisContext | null,
  currentJdInputSignature: string
) => {
  if (mode !== "full") {
    return false;
  }
  if (!context) {
    return true;
  }
  return context.jdInputSignature !== currentJdInputSignature;
};

export const buildPrevResultPayload = (result: JDAnalysisResult | null) => {
  if (!result) {
    return undefined;
  }
  const pickScores = (matches?: MatchScoreEntry[]) =>
    (matches || [])
      .map((match) => ({
        id: match.id,
        score: match.score,
      }))
      .filter((item) => typeof item.score === "number");
  return {
    matchPercentage: result.matchPercentage,
    capabilityAnalysis: result.capabilityAnalysis,
    experienceMatches: pickScores(result.experienceMatches),
    certificationMatches: pickScores(result.certificationMatches),
    skillMatches: pickScores(result.skillMatches),
  };
};

const mergeMatchEntries = (
  prev?: MatchScoreEntry[],
  next?: MatchScoreEntry[],
  targets?: Set<string>
) => {
  if (!targets || targets.size === 0) {
    return prev ?? next;
  }
  if (!prev && !next) {
    return undefined;
  }
  const merged = buildMatchEntryMap(prev);
  const incoming = buildMatchEntryMap(next);
  targets.forEach((id) => {
    if (incoming.has(id)) {
      merged.set(id, incoming.get(id)!);
    } else {
      merged.delete(id);
    }
  });
  const values = Array.from(merged.values());
  return values.length ? values : undefined;
};

// 仅更新变更项的匹配结果，避免覆盖未变更项的匹配度与理由
export const mergeAnalysisResult = (
  prev: JDAnalysisResult | null,
  next: JDAnalysisResult,
  diff: JDItemDiff
): JDAnalysisResult => {
  if (!prev) {
    return next;
  }
  return {
    ...prev,
    matchPercentage: next.matchPercentage,
    jobKeywords: next.jobKeywords,
    missingKeywords: next.missingKeywords,
    jobTitle: next.jobTitle ?? prev.jobTitle,
    company: next.company ?? prev.company,
    summary: next.summary,
    extractedJdText: next.extractedJdText ?? prev.extractedJdText,
    jdInterpretation: next.jdInterpretation ?? prev.jdInterpretation,
    capabilityAnalysis: next.capabilityAnalysis ?? prev.capabilityAnalysis,
    experienceMatches: mergeMatchEntries(
      prev.experienceMatches,
      next.experienceMatches,
      diff.experiences
    ),
    certificationMatches: mergeMatchEntries(
      prev.certificationMatches,
      next.certificationMatches,
      diff.certifications
    ),
    skillMatches: mergeMatchEntries(
      prev.skillMatches,
      next.skillMatches,
      diff.skills
    ),
  };
};

const stabilizeMatchEntries = (
  prev: MatchScoreEntry[] | undefined,
  next: MatchScoreEntry[] | undefined
) => {
  if (!next || next.length === 0) {
    return next;
  }
  const prevMap = buildMatchEntryMap(prev);
  const stabilized = next
    .map((entry): MatchScoreEntry | null => {
      const normalized = normalizeScore(entry.score);
      const prevScore = normalizeScore(prevMap.get(entry.id)?.score);
      if (typeof normalized !== "number") {
        return null;
      }
      return {
        ...entry,
        score: normalized,
        trend: resolveTrend(prevScore, normalized),
      };
    })
    .filter((entry): entry is MatchScoreEntry => entry !== null);
  return stabilized.length ? stabilized : undefined;
};

export const stabilizeAnalysisResult = (
  prev: JDAnalysisResult | null,
  next: JDAnalysisResult
) => {
  const prevOverall = normalizeScore(prev?.matchPercentage);
  const normalizedOverall =
    normalizeScore(next.matchPercentage) ?? prevOverall ?? 0;
  return {
    ...next,
    matchPercentage: normalizedOverall,
    matchTrend: resolveTrend(prevOverall, normalizedOverall),
    experienceMatches: stabilizeMatchEntries(
      prev?.experienceMatches,
      next.experienceMatches
    ),
    certificationMatches: stabilizeMatchEntries(
      prev?.certificationMatches,
      next.certificationMatches
    ),
    skillMatches: stabilizeMatchEntries(prev?.skillMatches, next.skillMatches),
  };
};

const stripMatchTrends = (
  matches: MatchScoreEntry[] | undefined,
  targets: Set<string>
) => {
  if (!matches || matches.length === 0 || targets.size === 0) {
    return matches;
  }
  let changed = false;
  const next = matches.map((entry) => {
    if (!targets.has(entry.id) || entry.trend === undefined) {
      return entry;
    }
    changed = true;
    return { ...entry, trend: undefined };
  });
  return changed ? next : matches;
};

export const stripTrendsByDiff = (result: JDAnalysisResult, diff: JDItemDiff) => {
  if (!hasDiff(diff)) {
    return result;
  }
  const nextExperienceMatches = stripMatchTrends(
    result.experienceMatches,
    diff.experiences
  );
  const nextCertificationMatches = stripMatchTrends(
    result.certificationMatches,
    diff.certifications
  );
  const nextSkillMatches = stripMatchTrends(result.skillMatches, diff.skills);
  if (
    nextExperienceMatches === result.experienceMatches
    && nextCertificationMatches === result.certificationMatches
    && nextSkillMatches === result.skillMatches
  ) {
    return result;
  }
  return {
    ...result,
    experienceMatches: nextExperienceMatches,
    certificationMatches: nextCertificationMatches,
    skillMatches: nextSkillMatches,
  };
};

export const applyScoreMapUpdate = (
  setMap: Dispatch<SetStateAction<Map<string, number>>>,
  scores: Map<string, number>,
  options?: MatchApplyOptions
) => {
  const mode = options?.mode ?? "full";
  const targetIds = options?.targetIds;
  if (mode === "partial") {
    if (!targetIds || targetIds.size === 0) {
      return;
    }
    setMap((prev) => {
      const next = new Map(prev);
      targetIds.forEach((id) => {
        if (scores.has(id)) {
          next.set(id, scores.get(id)!);
        } else {
          next.delete(id);
        }
      });
      return next;
    });
    return;
  }
  setMap(new Map(scores));
};

export const applyTrendMapUpdate = (
  setMap: Dispatch<SetStateAction<Map<string, MatchTrend>>>,
  trends: Map<string, MatchTrend>,
  options?: MatchApplyOptions
) => {
  const mode = options?.mode ?? "full";
  const targetIds = options?.targetIds;
  if (mode === "partial") {
    if (!targetIds || targetIds.size === 0) {
      return;
    }
    setMap((prev) => {
      const next = new Map(prev);
      targetIds.forEach((id) => {
        if (trends.has(id)) {
          next.set(id, trends.get(id)!);
        } else {
          next.delete(id);
        }
      });
      return next;
    });
    return;
  }
  setMap(new Map(trends));
};
