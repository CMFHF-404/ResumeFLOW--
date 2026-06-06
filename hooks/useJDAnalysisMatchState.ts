import {
  useCallback,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { JDAnalysisResult } from "../services/aiService";
import type { MatchScoreEntry, MatchTrend } from "../types/analysis";
import type {
  ResumeExperienceView,
  SkillGroupView,
} from "../types/resume";
import type { JDItemDiff } from "./jdAnalysisDiffUtils";
import {
  buildMatchScoreMap,
  buildMatchTrendMap,
  type MatchApplyOptions,
  type MatchUpdateMode,
} from "./jdAnalysisMatchUtils";
import {
  applyExperienceScoreUpdate,
  applyExperienceTrendUpdate,
  applyScoreMapUpdateValue,
  applyTrendMapUpdateValue,
  buildSkillScoreUpdateMap,
  buildStaleMapTargets,
  clearMapTargets,
  clearStaleExperienceMatches,
  updateStaleExperienceIds,
} from "./jdAnalysisMatchUpdateUtils";

type UseJDAnalysisMatchStateOptions = {
  setExperienceItems: Dispatch<SetStateAction<ResumeExperienceView[]>>;
  skillGroupsRef: MutableRefObject<SkillGroupView[]>;
};

export const useJDAnalysisMatchState = ({
  setExperienceItems,
  skillGroupsRef,
}: UseJDAnalysisMatchStateOptions) => {
  const [staleExperienceIds, setStaleExperienceIds] = useState<Set<string>>(
    new Set()
  );
  const [certificationMatchScores, setCertificationMatchScores] = useState<
    Map<string, number>
  >(new Map());
  const [certificationMatchTrends, setCertificationMatchTrends] = useState<
    Map<string, MatchTrend>
  >(new Map());
  const [skillMatchScores, setSkillMatchScores] = useState<
    Map<string, number>
  >(new Map());
  const [skillMatchTrends, setSkillMatchTrends] = useState<
    Map<string, MatchTrend>
  >(new Map());

  const applyExperienceMatchScores = useCallback(
    (matches?: MatchScoreEntry[], options?: MatchApplyOptions) => {
      setExperienceItems((prev) => applyExperienceScoreUpdate(prev, matches, options));
    },
    [setExperienceItems]
  );

  const applyExperienceMatchTrends = useCallback(
    (matches?: MatchScoreEntry[], options?: MatchApplyOptions) => {
      setExperienceItems((prev) => applyExperienceTrendUpdate(prev, matches, options));
    },
    [setExperienceItems]
  );

  const applyCertificationMatchScores = useCallback(
    (matches?: MatchScoreEntry[], options?: MatchApplyOptions) => {
      const matchScores = buildMatchScoreMap(matches);
      setCertificationMatchScores((prev) =>
        applyScoreMapUpdateValue(prev, matchScores, options)
      );
    },
    []
  );

  const applyCertificationMatchTrends = useCallback(
    (matches?: MatchScoreEntry[], options?: MatchApplyOptions) => {
      const matchTrends = buildMatchTrendMap(matches);
      setCertificationMatchTrends((prev) =>
        applyTrendMapUpdateValue(prev, matchTrends, options)
      );
    },
    []
  );

  const applySkillMatchScores = useCallback(
    (matches?: MatchScoreEntry[], options?: MatchApplyOptions) => {
      const matchScores = buildSkillScoreUpdateMap(matches, skillGroupsRef.current, options);
      if (!matchScores) {
        return;
      }
      setSkillMatchScores((prev) => applyScoreMapUpdateValue(prev, matchScores, options));
    },
    [skillGroupsRef]
  );

  const applySkillMatchTrends = useCallback(
    (matches?: MatchScoreEntry[], options?: MatchApplyOptions) => {
      const matchTrends = buildMatchTrendMap(matches);
      setSkillMatchTrends((prev) =>
        applyTrendMapUpdateValue(prev, matchTrends, options)
      );
    },
    []
  );

  const markStaleMatches = useCallback(
    (diff: JDItemDiff, options?: { replaceStale?: boolean }) => {
      if (diff.experiences.size > 0) {
        setExperienceItems((prev) => clearStaleExperienceMatches(prev, diff.experiences));
        setStaleExperienceIds((prev) => updateStaleExperienceIds(prev, diff.experiences, options));
      }
      const staleTargets = buildStaleMapTargets(diff);
      if (staleTargets.certificationIds.size > 0) {
        setCertificationMatchScores((prev) => clearMapTargets(prev, staleTargets.certificationIds));
        setCertificationMatchTrends((prev) => clearMapTargets(prev, staleTargets.certificationIds));
      }
      if (staleTargets.skillIds.size > 0) {
        setSkillMatchScores((prev) => clearMapTargets(prev, staleTargets.skillIds));
        setSkillMatchTrends((prev) => clearMapTargets(prev, staleTargets.skillIds));
      }
    },
    [setExperienceItems]
  );

  const clearStaleExperienceIds = useCallback((targetIds: Set<string>) => {
    if (targetIds.size === 0) {
      return;
    }
    setStaleExperienceIds((prev) => {
      const next = new Set(prev);
      targetIds.forEach((id) => next.delete(id));
      return next;
    });
  }, []);

  const resetStaleExperienceIds = useCallback(() => {
    setStaleExperienceIds(new Set());
  }, []);

  const applyMatchScoresForResult = useCallback(
    (result: JDAnalysisResult, mode: MatchUpdateMode, diff: JDItemDiff) => {
      const skillMatches = result.skillMatches ?? [];
      if (mode === "partial") {
        applyExperienceMatchScores(result.experienceMatches, {
          mode: "partial",
          targetIds: diff.experiences,
        });
        applyExperienceMatchTrends(result.experienceMatches, {
          mode: "partial",
          targetIds: diff.experiences,
        });
        applyCertificationMatchScores(result.certificationMatches, {
          mode: "partial",
          targetIds: diff.certifications,
        });
        applyCertificationMatchTrends(result.certificationMatches, {
          mode: "partial",
          targetIds: diff.certifications,
        });
        applySkillMatchScores(skillMatches, {
          mode: "partial",
          targetIds: diff.skills,
        });
        applySkillMatchTrends(skillMatches, {
          mode: "partial",
          targetIds: diff.skills,
        });
      } else {
        applyExperienceMatchScores(result.experienceMatches);
        applyCertificationMatchScores(result.certificationMatches);
        applySkillMatchScores(skillMatches);
        applyExperienceMatchTrends(result.experienceMatches);
        applyCertificationMatchTrends(result.certificationMatches);
        applySkillMatchTrends(skillMatches);
      }
    },
    [
      applyCertificationMatchScores,
      applyCertificationMatchTrends,
      applyExperienceMatchScores,
      applyExperienceMatchTrends,
      applySkillMatchScores,
      applySkillMatchTrends,
    ]
  );

  return {
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
    markStaleMatches,
    clearStaleExperienceIds,
  };
};
