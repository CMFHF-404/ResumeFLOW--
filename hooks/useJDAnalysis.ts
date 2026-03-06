import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { aiService, JDAnalysisResult } from "../services/aiService";
import {
  clearJDAnalysisCache,
  loadJDAnalysisCache,
  saveJDAnalysisCache,
} from "../views/jdAnalysisStorage";
import {
  buildExperienceAnalyzeEntry,
  buildResumeAISnapshot,
  buildJDTextSignature,
  clampMatchScore,
  diffJDItemSignatures,
  sortExperienceItemsForMatch,
} from "../utils/resumeHelpers";
import { trackJDAnalysisComplete, trackJDAnalysisStart } from "../utils/analyticsTracker";
import type {
  JDAnalysisContext,
  JDAnalysisItemSignatures,
  MatchScoreEntry,
  MatchTrend,
} from "../types/analysis";
import type {
  CertificationView,
  ResumeExperienceView,
  SkillGroupView,
  SkillItemView,
} from "../types/resume";

const DEFAULT_JD_TEXT = "";
const DEFAULT_SKILL_MATCH_SCORE = 0;

type MatchUpdateMode = "full" | "partial";

type MatchApplyOptions = {
  mode?: MatchUpdateMode;
  targetIds?: Set<string>;
};

type JDItemDiff = ReturnType<typeof diffJDItemSignatures>;

const buildEmptyDiff = (): JDItemDiff => ({
  experiences: new Set(),
  certifications: new Set(),
  skills: new Set(),
});

const cloneDiff = (diff: JDItemDiff): JDItemDiff => ({
  experiences: new Set(diff.experiences),
  certifications: new Set(diff.certifications),
  skills: new Set(diff.skills),
});

const hasDiff = (diff: JDItemDiff) =>
  diff.experiences.size > 0 ||
  diff.certifications.size > 0 ||
  diff.skills.size > 0;

const mergeDiffInto = (target: JDItemDiff, incoming: JDItemDiff) => {
  incoming.experiences.forEach((id) => target.experiences.add(id));
  incoming.certifications.forEach((id) => target.certifications.add(id));
  incoming.skills.forEach((id) => target.skills.add(id));
};

const clearDiffTargets = (target: JDItemDiff, toClear: JDItemDiff) => {
  toClear.experiences.forEach((id) => target.experiences.delete(id));
  toClear.certifications.forEach((id) => target.certifications.delete(id));
  toClear.skills.forEach((id) => target.skills.delete(id));
};

const subtractDiff = (source: JDItemDiff, toRemove: JDItemDiff): JDItemDiff => ({
  experiences: new Set(
    [...source.experiences].filter((id) => !toRemove.experiences.has(id))
  ),
  certifications: new Set(
    [...source.certifications].filter((id) => !toRemove.certifications.has(id))
  ),
  skills: new Set([...source.skills].filter((id) => !toRemove.skills.has(id))),
});

const mergeDiffs = (...diffs: JDItemDiff[]) => {
  const merged = buildEmptyDiff();
  diffs.forEach((diff) => mergeDiffInto(merged, diff));
  return merged;
};

const canonicalStringify = (obj: unknown): string => {
  const stringifyValue = (value: unknown): string | undefined => {
    if (value === undefined) {
      return undefined;
    }
    if (value === null || typeof value !== "object") {
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
      const items = value.map((item) => stringifyValue(item) ?? "null");
      return `[${items.join(",")}]`;
    }
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const entries: string[] = [];
    keys.forEach((key) => {
      const serialized = stringifyValue(record[key]);
      if (serialized !== undefined) {
        entries.push(`${JSON.stringify(key)}:${serialized}`);
      }
    });
    return `{${entries.join(",")}}`;
  };

  return stringifyValue(obj) ?? "null";
};

const buildExperienceAnalyzePayload = (experiences: ResumeExperienceView[]) => ({
  experiences: experiences.map(buildExperienceAnalyzeEntry),
});

const buildAnalyzePayload = (
  experiences: ResumeExperienceView[],
  certifications: CertificationView[],
  skillGroups: SkillGroupView[]
) => buildResumeAISnapshot(experiences, certifications, skillGroups);

const sortById = <T extends { id: string }>(items: T[]) => {
  return [...items].sort((a, b) => a.id.localeCompare(b.id));
};

const buildExperienceTextSnapshot = (experiences: ResumeExperienceView[]) => {
  const payload = buildExperienceAnalyzePayload(experiences);
  return canonicalStringify({ experiences: sortById(payload.experiences) });
};

const buildAnalyzeSignature = (
  experiences: ResumeExperienceView[],
  certifications: CertificationView[],
  skillGroups: SkillGroupView[]
) => {
  const payload = buildAnalyzePayload(experiences, certifications, skillGroups);
  return canonicalStringify({
    experiences: sortById(payload.experiences),
    certifications: sortById(payload.certifications),
    skills: sortById(payload.skills),
  });
};

const buildSignatureMap = <T extends { id: string }>(items: T[]) => {
  const map: Record<string, string> = {};
  items.forEach((item) => {
    map[item.id] = canonicalStringify(item);
  });
  return map;
};

const buildEmptyJDItemSignatures = (): JDAnalysisItemSignatures => ({
  experiences: {},
  certifications: {},
  skills: {},
});

const buildJDItemSignatures = (
  experiences: ResumeExperienceView[],
  certifications: CertificationView[],
  skillGroups: SkillGroupView[]
): JDAnalysisItemSignatures => {
  const snapshot = buildResumeAISnapshot(experiences, certifications, skillGroups);
  return {
    experiences: buildSignatureMap(snapshot.experiences),
    certifications: buildSignatureMap(snapshot.certifications),
    skills: buildSignatureMap(snapshot.skills),
  };
};

const buildMatchScoreMap = (matches?: MatchScoreEntry[]) => {
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
const fillMissingSkillScores = (
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

const buildMatchReasonMap = (matches?: MatchScoreEntry[]) => {
  const map = new Map<string, string>();
  (matches || []).forEach((match) => {
    if (match.reason) {
      map.set(match.id, match.reason);
    }
  });
  return map;
};

const buildMatchTrendMap = (matches?: MatchScoreEntry[]) => {
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

const shouldResetTrendBase = (
  mode: MatchUpdateMode,
  context: JDAnalysisContext | null,
  currentJdSignature: string
) => {
  if (mode !== "full") {
    return false;
  }
  if (!context) {
    return true;
  }
  return context.jdTextSignature !== currentJdSignature;
};

const buildPrevResultPayload = (result: JDAnalysisResult | null) => {
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
const mergeAnalysisResult = (
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

const stabilizeAnalysisResult = (
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

const stripTrendsByDiff = (result: JDAnalysisResult, diff: JDItemDiff) => {
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

const applyScoreMapUpdate = (
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

const applyTrendMapUpdate = (
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

type UseJDAnalysisOptions = {
  resumeId: string | null;
  experienceItems: ResumeExperienceView[];
  setExperienceItems: Dispatch<SetStateAction<ResumeExperienceView[]>>;
  certifications: CertificationView[];
  skillGroups: SkillGroupView[];
  isLoadingExperiences: boolean;
  authUserKey?: string | null;
};

type JDAnalyzeOutcome =
  | { status: "success"; result: JDAnalysisResult }
  | { status: "no_change" }
  | { status: "error" };

type UseJDAnalysisResult = {
  jdText: string;
  setJdText: Dispatch<SetStateAction<string>>;
  analysisResult: JDAnalysisResult | null;
  isAnalyzing: boolean;
  isJDCollapsed: boolean;
  setIsJDCollapsed: Dispatch<SetStateAction<boolean>>;
  staleExperienceIds: Set<string>;
  certificationMatchScores: Map<string, number>;
  setCertificationMatchScores: Dispatch<SetStateAction<Map<string, number>>>;
  certificationMatchTrends: Map<string, MatchTrend>;
  setCertificationMatchTrends: Dispatch<SetStateAction<Map<string, MatchTrend>>>;
  skillMatchScores: Map<string, number>;
  setSkillMatchScores: Dispatch<SetStateAction<Map<string, number>>>;
  skillMatchTrends: Map<string, MatchTrend>;
  setSkillMatchTrends: Dispatch<SetStateAction<Map<string, MatchTrend>>>;
  handleAnalyze: () => Promise<JDAnalyzeOutcome>;
  debugInfo?: any;
  isOutdated: boolean;
};

export const useJDAnalysis = ({
  resumeId,
  experienceItems,
  setExperienceItems,
  certifications,
  skillGroups,
  isLoadingExperiences,
  authUserKey,
}: UseJDAnalysisOptions): UseJDAnalysisResult => {
  const [jdText, setJdText] = useState(DEFAULT_JD_TEXT);
  const [analysisResult, setAnalysisResult] = useState<JDAnalysisResult | null>(
    null
  );
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isJDCollapsed, setIsJDCollapsed] = useState(false);
  const [analysisContext, setAnalysisContext] =
    useState<JDAnalysisContext | null>(null);
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
  const [debugInfo, setDebugInfo] = useState<any>(null);
  const [needsReanalysis, setNeedsReanalysis] = useState(false);
  const hasLoadedJdCacheRef = useRef(false);
  const pendingDiffRef = useRef<JDItemDiff>(buildEmptyDiff());
  const experienceItemsRef = useRef(experienceItems);
  const certificationsRef = useRef(certifications);
  const skillGroupsRef = useRef(skillGroups);
  const jdTextRef = useRef(jdText);

  useEffect(() => {
    experienceItemsRef.current = experienceItems;
  }, [experienceItems]);

  useEffect(() => {
    certificationsRef.current = certifications;
  }, [certifications]);

  useEffect(() => {
    skillGroupsRef.current = skillGroups;
  }, [skillGroups]);

  useEffect(() => {
    jdTextRef.current = jdText;
  }, [jdText]);

  const experienceSignature = useMemo(
    () => buildAnalyzeSignature(experienceItems, certifications, skillGroups),
    [certifications, experienceItems, skillGroups]
  );
  const jdTextSignature = useMemo(
    () => buildJDTextSignature(jdText),
    [jdText]
  );

  const isOutdated = useMemo(() => {
    if (!analysisResult || !analysisContext) {
      return true;
    }
    return (
      analysisContext.jdTextSignature !== jdTextSignature || needsReanalysis
    );
  }, [analysisContext, analysisResult, jdTextSignature, needsReanalysis]);

  const applyExperienceMatchScores = useCallback(
    (matches?: MatchScoreEntry[], options?: MatchApplyOptions) => {
      const matchScores = buildMatchScoreMap(matches);
      const matchReasons = buildMatchReasonMap(matches);
      const mode = options?.mode ?? "full";
      const targetIds = options?.targetIds;
      if (mode === "partial" && (!targetIds || targetIds.size === 0)) {
        return;
      }
      setExperienceItems((prev) => {
        const next = prev.map((item) => {
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
        return next;
      });
    },
    [setExperienceItems]
  );

  const applyExperienceMatchTrends = useCallback(
    (matches?: MatchScoreEntry[], options?: MatchApplyOptions) => {
      const matchTrends = buildMatchTrendMap(matches);
      const mode = options?.mode ?? "full";
      const targetIds = options?.targetIds;
      if (mode === "partial" && (!targetIds || targetIds.size === 0)) {
        return;
      }
      setExperienceItems((prev) => {
        const next = prev.map((item) => {
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
        return next;
      });
    },
    [setExperienceItems]
  );

  const applyCertificationMatchScores = useCallback(
    (matches?: MatchScoreEntry[], options?: MatchApplyOptions) => {
      applyScoreMapUpdate(
        setCertificationMatchScores,
        buildMatchScoreMap(matches),
        options
      );
    },
    [setCertificationMatchScores]
  );

  const applyCertificationMatchTrends = useCallback(
    (matches?: MatchScoreEntry[], options?: MatchApplyOptions) => {
      applyTrendMapUpdate(
        setCertificationMatchTrends,
        buildMatchTrendMap(matches),
        options
      );
    },
    [setCertificationMatchTrends]
  );

  const applySkillMatchScores = useCallback(
    (matches?: MatchScoreEntry[], options?: MatchApplyOptions) => {
      if (options?.mode === "partial" && matches === undefined) {
        return;
      }
      const matchScores = buildMatchScoreMap(matches);
      if (matches !== undefined) {
        fillMissingSkillScores(matchScores, skillGroupsRef.current);
      }
      applyScoreMapUpdate(setSkillMatchScores, matchScores, options);
    },
    [setSkillMatchScores]
  );

  const applySkillMatchTrends = useCallback(
    (matches?: MatchScoreEntry[], options?: MatchApplyOptions) => {
      applyTrendMapUpdate(
        setSkillMatchTrends,
        buildMatchTrendMap(matches),
        options
      );
    },
    [setSkillMatchTrends]
  );

  const markStaleMatches = useCallback(
    (diff: JDItemDiff, options?: { replaceStale?: boolean }) => {
      if (diff.experiences.size > 0) {
        setExperienceItems((prev) => {
          const next = prev.map((item) =>
            diff.experiences.has(item.id)
              ? { ...item, matchScore: undefined, matchReason: undefined, matchTrend: undefined }
              : item
          );
          return next;
        });
        setStaleExperienceIds((prev) => {
          const next = options?.replaceStale ? new Set<string>() : new Set(prev);
          diff.experiences.forEach((id) => next.add(id));
          return next;
        });
      }
      if (diff.certifications.size > 0) {
        setCertificationMatchScores((prev) => {
          const next = new Map(prev);
          diff.certifications.forEach((id) => next.delete(id));
          return next;
        });
        setCertificationMatchTrends((prev) => {
          const next = new Map(prev);
          diff.certifications.forEach((id) => next.delete(id));
          return next;
        });
      }
      if (diff.skills.size > 0) {
        setSkillMatchScores((prev) => {
          const next = new Map(prev);
          diff.skills.forEach((id) => next.delete(id));
          return next;
        });
        setSkillMatchTrends((prev) => {
          const next = new Map(prev);
          diff.skills.forEach((id) => next.delete(id));
          return next;
        });
      }
    },
    [setExperienceItems]
  );

  const resetJDAnalysisState = useCallback(
    (options?: { resetJdText?: boolean; clearCache?: boolean }) => {
      setAnalysisResult(null);
      setAnalysisContext(null);
      setIsJDCollapsed(false);
      setStaleExperienceIds(new Set());
      setNeedsReanalysis(false);
      setDebugInfo(null);
      pendingDiffRef.current = buildEmptyDiff();
      applyExperienceMatchScores();
      applyExperienceMatchTrends();
      applyCertificationMatchScores();
      applyCertificationMatchTrends();
      applySkillMatchScores();
      applySkillMatchTrends();
      if (options?.resetJdText) {
        setJdText(DEFAULT_JD_TEXT);
      }
      if (options?.clearCache && resumeId) {
        clearJDAnalysisCache(resumeId);
      }
    },
    [
      applyCertificationMatchScores,
      applyCertificationMatchTrends,
      applyExperienceMatchScores,
      applyExperienceMatchTrends,
      applySkillMatchScores,
      applySkillMatchTrends,
      resumeId,
    ]
  );

  useEffect(() => {
    if (!analysisContext || !resumeId) {
      return;
    }
    if (analysisContext.jdTextSignature !== jdTextSignature) {
      resetJDAnalysisState({ clearCache: true });
    }
  }, [analysisContext, jdTextSignature, resetJDAnalysisState, resumeId]);

  useEffect(() => {
    if (!resumeId) {
      return;
    }
    hasLoadedJdCacheRef.current = false;
    resetJDAnalysisState({ resetJdText: true, clearCache: false });
  }, [resetJDAnalysisState, resumeId]);

  useEffect(() => {
    if (!resumeId || isLoadingExperiences || hasLoadedJdCacheRef.current) {
      return;
    }
    const cached = loadJDAnalysisCache(resumeId);
    if (cached) {
      const cachedSignatures =
        cached.itemSignatures ?? buildEmptyJDItemSignatures();
      // 确保缓存的签名数据完整有效
      const validatedSignatures = {
        experiences: cachedSignatures.experiences || {},
        certifications: cachedSignatures.certifications || {},
        skills: cachedSignatures.skills || {},
      };
      setJdText(cached.jdText);
      setAnalysisResult(cached.result);
      setAnalysisContext({
        jdTextSignature: buildJDTextSignature(cached.jdText),
        experienceSignature: cached.experienceSignature,
        itemSignatures: validatedSignatures,
        experienceText: cached.experienceText,
      });
      const cachedSkillMatches = cached.result.skillMatches ?? [];
      applyExperienceMatchScores(cached.result.experienceMatches);
      applyExperienceMatchTrends(cached.result.experienceMatches);
      applyCertificationMatchScores(cached.result.certificationMatches);
      applyCertificationMatchTrends(cached.result.certificationMatches);
      applySkillMatchScores(cachedSkillMatches);
      applySkillMatchTrends(cachedSkillMatches);
      setIsJDCollapsed(true);
      setStaleExperienceIds(new Set());
      setNeedsReanalysis(false);
      setDebugInfo(null);
      pendingDiffRef.current = buildEmptyDiff();
    }
    hasLoadedJdCacheRef.current = true;
  }, [
    applyCertificationMatchScores,
    applyCertificationMatchTrends,
    applyExperienceMatchScores,
    applyExperienceMatchTrends,
    applySkillMatchScores,
    applySkillMatchTrends,
    isLoadingExperiences,
    resumeId,
  ]);

  useEffect(() => {
    if (!analysisContext || !resumeId) {
      return;
    }
    if (analysisContext.experienceSignature === experienceSignature) {
      return;
    }
    console.log('[JD Debug] Signature Mismatch!', {
      oldSig: analysisContext.experienceSignature,
      newSig: experienceSignature
    });
    const nextSignatures = buildJDItemSignatures(
      experienceItems,
      certifications,
      skillGroups
    );
    const diff = diffJDItemSignatures(
      analysisContext.itemSignatures,
      nextSignatures
    );
    console.log('[JD Debug] Diff:', diff);
    if (
      diff.experiences.size > 0 ||
      diff.certifications.size > 0 ||
      diff.skills.size > 0
    ) {
      console.log('[JD Debug] Marking Stale!');
      setDebugInfo({
        diff,
        diffDetails: {
          items: Array.from(diff.experiences).map(id => ({
            id,
            prev: analysisContext.itemSignatures?.experiences?.[id] ?? null,
            next: nextSignatures.experiences?.[id] ?? null
          }))
        }
      });
      mergeDiffInto(pendingDiffRef.current, diff);
      setNeedsReanalysis(true);
      markStaleMatches(diff);
    }
    setAnalysisContext((prev) =>
      prev
        ? {
          ...prev,
          experienceSignature,
          itemSignatures: nextSignatures,
        }
        : prev
    );
  }, [
    analysisContext,
    certifications,
    experienceItems,
    experienceSignature,
    markStaleMatches,
    resumeId,
    skillGroups,
  ]);



  type AnalyzeOptions = {
    mode?: MatchUpdateMode;
    diff?: JDItemDiff;
  };

  type AnalysisStatePayload = {
    result: JDAnalysisResult;
    itemSignatures: JDAnalysisItemSignatures;
    experienceSignature: string;
    jdTextSignature: string;
    jdText: string;
    experienceText: string;
  };

  type AnalyzeSnapshot = {
    experiences: ResumeExperienceView[];
    certifications: CertificationView[];
    skillGroups: SkillGroupView[];
    jdText: string;
    itemSignatures: JDAnalysisItemSignatures;
    experienceSignature: string;
    jdTextSignature: string;
    experienceText: string;
  };

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

  const updateAnalysisState = useCallback(
    ({
      result,
      itemSignatures,
      experienceSignature: nextExperienceSignature,
      jdTextSignature: nextJdTextSignature,
      jdText: nextJdText,
      experienceText: nextExperienceText,
    }: AnalysisStatePayload) => {
      setAnalysisResult(result);
      setAnalysisContext({
        jdTextSignature: nextJdTextSignature,
        experienceSignature: nextExperienceSignature,
        itemSignatures,
        experienceText: nextExperienceText,
      });
      if (resumeId) {
        saveJDAnalysisCache(resumeId, {
          jdText: nextJdText,
          experienceSignature: nextExperienceSignature,
          result,
          itemSignatures,
          experienceText: nextExperienceText,
        });
      }
    },
    [resumeId]
  );

  const getAnalysisSnapshot = useCallback(() => {
    return {
      experiences: experienceItemsRef.current,
      certifications: certificationsRef.current,
      skillGroups: skillGroupsRef.current,
      jdText: jdTextRef.current,
    };
  }, []);

  const buildAnalyzeSnapshot = useCallback((): AnalyzeSnapshot => {
    const snapshot = getAnalysisSnapshot();
    return {
      ...snapshot,
      itemSignatures: buildJDItemSignatures(
        snapshot.experiences,
        snapshot.certifications,
        snapshot.skillGroups
      ),
      experienceSignature: buildAnalyzeSignature(
        snapshot.experiences,
        snapshot.certifications,
        snapshot.skillGroups
      ),
      jdTextSignature: buildJDTextSignature(snapshot.jdText),
      experienceText: buildExperienceTextSnapshot(snapshot.experiences),
    };
  }, [getAnalysisSnapshot]);

  const recordPostAnalyzeDiff = useCallback(
    (
      startSignatures: JDAnalysisItemSignatures,
      latestSignatures: JDAnalysisItemSignatures
    ) => {
      const changedDuringAnalyze = diffJDItemSignatures(
        startSignatures,
        latestSignatures
      );
      if (hasDiff(changedDuringAnalyze)) {
        mergeDiffInto(pendingDiffRef.current, changedDuringAnalyze);
        markStaleMatches(changedDuringAnalyze);
      }
      return changedDuringAnalyze;
    },
    [markStaleMatches]
  );

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

  const updateAnalyzeDiffState = useCallback(
    (
      mode: MatchUpdateMode,
      diff: JDItemDiff,
      changedDuringAnalyze: JDItemDiff
    ) => {
      if (mode === "partial") {
        const stableDiff = subtractDiff(diff, changedDuringAnalyze);
        clearStaleExperienceIds(stableDiff.experiences);
        clearDiffTargets(pendingDiffRef.current, stableDiff);
        setNeedsReanalysis(hasDiff(pendingDiffRef.current));
        return;
      }
      if (hasDiff(pendingDiffRef.current)) {
        markStaleMatches(pendingDiffRef.current, { replaceStale: true });
        setNeedsReanalysis(true);
      } else {
        setStaleExperienceIds(new Set());
        setNeedsReanalysis(false);
      }
    },
    [clearStaleExperienceIds, markStaleMatches]
  );

  const buildDiffFromContext = useCallback(
    (context: JDAnalysisContext | null, signatures: JDAnalysisItemSignatures) => {
      if (!context) {
        return buildEmptyDiff();
      }
      return diffJDItemSignatures(context.itemSignatures, signatures);
    },
    []
  );

  const runAnalyze = useCallback(
    async (options?: AnalyzeOptions): Promise<JDAnalyzeOutcome> => {
      const mode = options?.mode ?? "full";
      const diff = options?.diff ?? buildEmptyDiff();
      if (mode === "partial" && !hasDiff(diff)) {
        return { status: "no_change" };
      }
      if (mode === "full") {
        pendingDiffRef.current = buildEmptyDiff();
        setNeedsReanalysis(false);
      }
      const startedAt = Date.now();
      if (mode === "full") {
        trackJDAnalysisStart({ resumeId });
      }
      setIsAnalyzing(true);
      try {
        const startSnapshot = buildAnalyzeSnapshot();
        const payload = buildAnalyzePayload(
          startSnapshot.experiences,
          startSnapshot.certifications,
          startSnapshot.skillGroups
        );
        const resumeText = canonicalStringify(payload);
        const prevExperienceText =
          mode === "partial" ? analysisContext?.experienceText : undefined;
        const prevResultPayload =
          mode === "partial" ? buildPrevResultPayload(analysisResult) : undefined;
        const shouldUsePrev =
          mode === "partial" && Boolean(prevExperienceText) && Boolean(prevResultPayload);
        const result = await aiService.analyzeJD({
          text: startSnapshot.jdText,
          resumeText,
          prevResult: shouldUsePrev ? prevResultPayload : undefined,
          experienceText: startSnapshot.experienceText,
          prevExperienceText: shouldUsePrev ? prevExperienceText : undefined,
        });
        const latestSnapshot = buildAnalyzeSnapshot();
        const changedDuringAnalyze = recordPostAnalyzeDiff(
          startSnapshot.itemSignatures,
          latestSnapshot.itemSignatures
        );
        const stableDiff =
          mode === "partial" ? subtractDiff(diff, changedDuringAnalyze) : diff;
        if (mode === "partial" && !hasDiff(stableDiff)) {
          updateAnalyzeDiffState(mode, diff, changedDuringAnalyze);
          return { status: "no_change" };
        }
        const nextResult =
          mode === "partial"
            ? mergeAnalysisResult(analysisResult, result, stableDiff)
            : result;
        const resetTrendBase = shouldResetTrendBase(
          mode,
          analysisContext,
          startSnapshot.jdTextSignature
        );
        const trendBaseResult = resetTrendBase ? null : analysisResult;
        const stabilizedResult = stabilizeAnalysisResult(
          trendBaseResult,
          nextResult
        );
        const finalResult =
          mode === "partial"
            ? stripTrendsByDiff(stabilizedResult, stableDiff)
            : stabilizedResult;
        applyMatchScoresForResult(finalResult, mode, stableDiff);
        updateAnalysisState({
          result: finalResult,
          itemSignatures: startSnapshot.itemSignatures,
          experienceSignature: startSnapshot.experienceSignature,
          jdTextSignature: startSnapshot.jdTextSignature,
          jdText: startSnapshot.jdText,
          experienceText: startSnapshot.experienceText,
        });
        updateAnalyzeDiffState(mode, diff, changedDuringAnalyze);
        if (mode === "full") {
          setIsJDCollapsed(true);
        }
        setDebugInfo(null);
        if (mode === "full") {
          trackJDAnalysisComplete({
            resumeId,
            matchScore: finalResult.matchPercentage,
            durationMs: Date.now() - startedAt,
          }, authUserKey);
        }
        return { status: "success", result: finalResult };
      } catch (error) {
        console.error("Failed to analyze JD", error);
        return { status: "error" };
      } finally {
        setIsAnalyzing(false);
      }
    },
    [
      analysisContext,
      analysisResult,
      applyMatchScoresForResult,
      buildAnalyzeSnapshot,
      recordPostAnalyzeDiff,
      updateAnalyzeDiffState,
      updateAnalysisState,
      authUserKey,
    ]
  );

  const handleAnalyze = useCallback(async () => {
    const snapshot = buildAnalyzeSnapshot();
    const contextDiff = buildDiffFromContext(
      analysisContext,
      snapshot.itemSignatures
    );
    const diffSnapshot = analysisContext
      ? mergeDiffs(pendingDiffRef.current, contextDiff)
      : cloneDiff(pendingDiffRef.current);
    const hasPendingDiff = hasDiff(diffSnapshot);
    const hasJdTextChanged =
      analysisContext?.jdTextSignature !== snapshot.jdTextSignature;
    const hasPrevExperienceText =
      analysisContext?.experienceText !== undefined;
    const shouldSkipAnalyze =
      Boolean(analysisResult)
      && Boolean(analysisContext)
      && !hasPendingDiff
      && !hasJdTextChanged;

    if (shouldSkipAnalyze) {
      if (needsReanalysis) {
        setNeedsReanalysis(false);
      }
      if (analysisContext && hasDiff(pendingDiffRef.current)) {
        pendingDiffRef.current = buildEmptyDiff();
      }
      return { status: "no_change" };
    }
    if (
      analysisResult &&
      analysisContext &&
      hasPendingDiff &&
      !hasJdTextChanged &&
      hasPrevExperienceText
    ) {
      return runAnalyze({ mode: "partial", diff: diffSnapshot });
    }
    return runAnalyze({ mode: "full" });
  }, [
    analysisContext,
    analysisResult,
    buildAnalyzeSnapshot,
    buildDiffFromContext,
    needsReanalysis,
    runAnalyze,
  ]);

  return {
    jdText,
    setJdText,
    analysisResult,
    isAnalyzing,
    isJDCollapsed,
    setIsJDCollapsed,
    staleExperienceIds,
    certificationMatchScores,
    setCertificationMatchScores,
    certificationMatchTrends,
    setCertificationMatchTrends,
    skillMatchScores,
    setSkillMatchScores,
    skillMatchTrends,
    setSkillMatchTrends,
    handleAnalyze,
    debugInfo,
    isOutdated,
  };
};
