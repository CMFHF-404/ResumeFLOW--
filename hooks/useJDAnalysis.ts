import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  aiService,
  JDAnalysisResult,
  type AnalyzeStreamEvent,
  type JDAnalyzeProgressNode as AIJDAnalyzeProgressNode,
} from "../services/aiService";
import {
  buildJDAnalysisPersistenceFingerprint,
  clearJDAnalysisCache,
  loadJDAnalysisCache,
  normalizeJDAnalysisPersistence,
  saveJDAnalysisCache,
  selectPreferredPersistedJDAnalysis,
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
  ResumeJDAnalysis,
  ResumeExperienceView,
  SkillGroupView,
  SkillItemView,
} from "../types/resume";

const DEFAULT_JD_TEXT = "";
const DEFAULT_SKILL_MATCH_SCORE = 0;
const JD_ATTACHMENT_SUPPLEMENT_PREFIX = "\n\n补充 JD 说明：\n";

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

type JDAttachmentDescriptor = Pick<File, "name" | "size" | "lastModified" | "type">;

const buildAttachmentSignature = (file: JDAttachmentDescriptor | null) => {
  if (!file) {
    return null;
  }
  return canonicalStringify({
    name: file.name,
    size: file.size,
    lastModified: file.lastModified,
    type: file.type,
  });
};

const buildPersistedJDInputSignature = (
  jdText: string,
  inputMode?: "text" | "attachment",
  attachmentName?: string
) => {
  const textSignature = buildJDTextSignature(jdText);
  if (inputMode === "attachment") {
    return canonicalStringify({
      inputMode,
      textSignature,
      attachmentSignature: attachmentName ?? "__missing_attachment__",
    });
  }
  return canonicalStringify({
    inputMode: "text",
    textSignature,
    attachmentSignature: null,
  });
};

const buildJDInputSignature = (
  jdText: string,
  file: JDAttachmentDescriptor | null
) => canonicalStringify({
  inputMode: file ? "attachment" : "text",
  textSignature: buildJDTextSignature(jdText),
  attachmentSignature: buildAttachmentSignature(file),
});

const arePersistedJDAnalysisEqual = (
  backend: ResumeJDAnalysis | null,
  local: ResumeJDAnalysis | null
) => {
  if (!backend || !local) {
    return backend === local;
  }
  return canonicalStringify(backend) === canonicalStringify(local);
};

const splitAttachmentDerivedJdText = (
  jdText: string,
  extractedText?: string | null
) => {
  const normalizedExtractedText = extractedText?.trim();
  if (!normalizedExtractedText) {
    return {
      supplementalText: jdText,
    };
  }
  if (jdText === normalizedExtractedText) {
    return {
      supplementalText: "",
    };
  }
  const prefixedText = `${normalizedExtractedText}${JD_ATTACHMENT_SUPPLEMENT_PREFIX}`;
  if (jdText.startsWith(prefixedText)) {
    return {
      supplementalText: jdText.slice(prefixedText.length),
    };
  }
  return {
    supplementalText: jdText,
  };
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
  persistedJDAnalysis?: ResumeJDAnalysis | null;
  onPersistedJDAnalysisChange?: (
    value: ResumeJDAnalysis | null | undefined
  ) => void;
  experienceItems: ResumeExperienceView[];
  setExperienceItems: Dispatch<SetStateAction<ResumeExperienceView[]>>;
  certifications: CertificationView[];
  skillGroups: SkillGroupView[];
  isLoadingResume: boolean;
  isLoadingExperiences: boolean;
  authUserKey?: string | null;
};

type JDAnalyzeOutcome =
  | { status: "success"; result: JDAnalysisResult }
  | { status: "no_change" }
  | { status: "missing_attachment" }
  | { status: "error" };

export type JDAnalyzeProgressNode = AIJDAnalyzeProgressNode;

type JDAnalyzeProgressHandler = (node: JDAnalyzeProgressNode) => void;
type JDAnalyzeStreamHandler = (event: AnalyzeStreamEvent) => void;

type HandleAnalyzeOptions = {
  onProgress?: JDAnalyzeProgressHandler;
  onEvent?: JDAnalyzeStreamHandler;
};

type UseJDAnalysisResult = {
  jdText: string;
  setJdText: Dispatch<SetStateAction<string>>;
  /** 当前已选的 JD 附件（图像或 PDF/DOCX），null 表示文本输入模式 */
  jdFile: File | null;
  setJdFile: Dispatch<SetStateAction<File | null>>;
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
  handleAnalyze: (options?: HandleAnalyzeOptions) => Promise<JDAnalyzeOutcome>;
  hasMissingAttachmentContext: boolean;
  persistedJDAnalysis: ResumeJDAnalysis | null | undefined;
  debugInfo?: any;
  isOutdated: boolean;
};

export const useJDAnalysis = ({
  resumeId,
  persistedJDAnalysis: persistedJDAnalysisConfig,
  onPersistedJDAnalysisChange,
  experienceItems,
  setExperienceItems,
  certifications,
  skillGroups,
  isLoadingResume,
  isLoadingExperiences,
  authUserKey,
}: UseJDAnalysisOptions): UseJDAnalysisResult => {
  const [jdText, setJdText] = useState(DEFAULT_JD_TEXT);
  const [jdFile, setJdFile] = useState<File | null>(null);
  const jdFileRef = useRef<File | null>(null);
  const [attachmentExtractedText, setAttachmentExtractedText] = useState<string | null>(null);
  const [restoredAttachmentContext, setRestoredAttachmentContext] = useState<{
    jdText: string;
    jdInputSignature: string;
  } | null>(null);
  const [analysisResult, setAnalysisResult] = useState<JDAnalysisResult | null>(
    null
  );
  const [persistedJDAnalysis, setPersistedJDAnalysis] =
    useState<ResumeJDAnalysis | null | undefined>(undefined);
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
    jdFileRef.current = jdFile;
  }, [jdFile]);


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

  useEffect(() => {
    onPersistedJDAnalysisChange?.(persistedJDAnalysis);
  }, [onPersistedJDAnalysisChange, persistedJDAnalysis]);

  const experienceSignature = useMemo(
    () => buildAnalyzeSignature(experienceItems, certifications, skillGroups),
    [certifications, experienceItems, skillGroups]
  );
  const liveJdInputSignature = useMemo(
    () => buildJDInputSignature(jdText, jdFile),
    [jdFile, jdText]
  );
  const jdInputSignature = useMemo(() => {
    if (
      !jdFile &&
      restoredAttachmentContext &&
      restoredAttachmentContext.jdText === jdText
    ) {
      return restoredAttachmentContext.jdInputSignature;
    }
    return liveJdInputSignature;
  }, [jdFile, jdText, liveJdInputSignature, restoredAttachmentContext]);

  const isOutdated = useMemo(() => {
    if (!analysisResult || !analysisContext) {
      return true;
    }
    return (
      analysisContext.jdInputSignature !== jdInputSignature || needsReanalysis
    );
  }, [analysisContext, analysisResult, jdInputSignature, needsReanalysis]);
  const hasMissingAttachmentContext = Boolean(restoredAttachmentContext && !jdFile);

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

  const applyPersistedAnalysisState = useCallback(
    (payload: ResumeJDAnalysis) => {
      const validatedSignatures = payload.itemSignatures ?? buildEmptyJDItemSignatures();
      const persistedJdInputSignature =
        payload.jdInputSignature
        || buildPersistedJDInputSignature(
          payload.jdText,
          payload.inputMode,
          payload.attachmentName
        );
      const normalizedPayload: ResumeJDAnalysis = {
        ...payload,
        jdInputSignature: persistedJdInputSignature,
        itemSignatures: {
          experiences: validatedSignatures.experiences || {},
          certifications: validatedSignatures.certifications || {},
          skills: validatedSignatures.skills || {},
        },
      };

      setJdText(normalizedPayload.jdText);
      setAttachmentExtractedText(normalizedPayload.attachmentExtractedText ?? null);
      setAnalysisResult(normalizedPayload.result);
      setPersistedJDAnalysis(normalizedPayload);
      setAnalysisContext({
        jdInputSignature: normalizedPayload.jdInputSignature,
        experienceSignature: normalizedPayload.experienceSignature,
        itemSignatures: normalizedPayload.itemSignatures,
        experienceText: normalizedPayload.experienceText,
      });
      setRestoredAttachmentContext(
        normalizedPayload.inputMode === "attachment"
          ? {
            jdText: normalizedPayload.jdText,
            jdInputSignature: normalizedPayload.jdInputSignature,
          }
          : null
      );

      const skillMatches = normalizedPayload.result.skillMatches ?? [];
      applyExperienceMatchScores(normalizedPayload.result.experienceMatches);
      applyExperienceMatchTrends(normalizedPayload.result.experienceMatches);
      applyCertificationMatchScores(normalizedPayload.result.certificationMatches);
      applyCertificationMatchTrends(normalizedPayload.result.certificationMatches);
      applySkillMatchScores(skillMatches);
      applySkillMatchTrends(skillMatches);
      setIsJDCollapsed(true);
      setStaleExperienceIds(new Set());
      setNeedsReanalysis(false);
      setDebugInfo(null);
      pendingDiffRef.current = buildEmptyDiff();

      return normalizedPayload;
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
    (options?: {
      resetJdText?: boolean;
      resetJdFile?: boolean;
      clearCache?: boolean;
      resetPersistedJDAnalysis?: boolean;
    }) => {
      setAnalysisResult(null);
      if (options?.resetPersistedJDAnalysis) {
        setPersistedJDAnalysis(undefined);
      }
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
        setAttachmentExtractedText(null);
      }
      if (options?.resetJdFile) {
        setJdFile(null);
        setRestoredAttachmentContext(null);
        setAttachmentExtractedText(null);
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
    if (analysisContext.jdInputSignature !== jdInputSignature) {
      if (restoredAttachmentContext) {
        setRestoredAttachmentContext(null);
      }
      resetJDAnalysisState({ clearCache: true });
    }
  }, [
    analysisContext,
    jdInputSignature,
    resetJDAnalysisState,
    restoredAttachmentContext,
    resumeId,
  ]);

  useEffect(() => {
    if (!resumeId) {
      return;
    }
    hasLoadedJdCacheRef.current = false;
    resetJDAnalysisState({
      resetJdText: true,
      resetJdFile: true,
      clearCache: false,
      resetPersistedJDAnalysis: true,
    });
  }, [resetJDAnalysisState, resumeId]);

  useEffect(() => {
    if (
      !resumeId
      || isLoadingResume
      || isLoadingExperiences
      || hasLoadedJdCacheRef.current
    ) {
      return;
    }
    const cached = loadJDAnalysisCache(resumeId);
    const backendPersisted = normalizeJDAnalysisPersistence(
      persistedJDAnalysisConfig
    );
    const preferredPersistedState = selectPreferredPersistedJDAnalysis(
      backendPersisted,
      cached
    );

    if (preferredPersistedState) {
      const normalizedPersisted = applyPersistedAnalysisState(
        preferredPersistedState.payload
      );
      saveJDAnalysisCache(resumeId, normalizedPersisted, {
        pendingSync: preferredPersistedState.shouldKeepLocalPendingSync,
        basePersistedFingerprint:
          preferredPersistedState.basePersistedFingerprint,
      });
    } else if (cached && !cached.pendingSync) {
      clearJDAnalysisCache(resumeId);
      setPersistedJDAnalysis(null);
    } else {
      setPersistedJDAnalysis(null);
    }
    hasLoadedJdCacheRef.current = true;
  }, [
    isLoadingExperiences,
    isLoadingResume,
    applyPersistedAnalysisState,
    persistedJDAnalysisConfig,
    resumeId,
  ]);

  useEffect(() => {
    if (!resumeId || !persistedJDAnalysis) {
      return;
    }
    const backendPersisted = normalizeJDAnalysisPersistence(
      persistedJDAnalysisConfig
    );
    if (!backendPersisted) {
      return;
    }
    if (!arePersistedJDAnalysisEqual(backendPersisted, persistedJDAnalysis)) {
      return;
    }
    saveJDAnalysisCache(resumeId, backendPersisted, {
      pendingSync: false,
      basePersistedFingerprint:
        buildJDAnalysisPersistenceFingerprint(backendPersisted),
    });
  }, [persistedJDAnalysis, persistedJDAnalysisConfig, resumeId]);

  useEffect(() => {
    if (!restoredAttachmentContext) {
      return;
    }
    if (!jdFile) {
      return;
    }
    setRestoredAttachmentContext(null);
  }, [jdFile, restoredAttachmentContext]);

  useEffect(() => {
    if (!analysisContext || !resumeId) {
      return;
    }
    if (analysisContext.experienceSignature === experienceSignature) {
      return;
    }
    if (import.meta.env.DEV) {
      console.log('[JD Debug] Signature Mismatch!', {
        oldSig: analysisContext.experienceSignature,
        newSig: experienceSignature
      });
    }
    const nextSignatures = buildJDItemSignatures(
      experienceItems,
      certifications,
      skillGroups
    );
    const diff = diffJDItemSignatures(
      analysisContext.itemSignatures,
      nextSignatures
    );
    if (import.meta.env.DEV) {
      console.log('[JD Debug] Diff:', diff);
    }
    if (
      diff.experiences.size > 0 ||
      diff.certifications.size > 0 ||
      diff.skills.size > 0
    ) {
      if (import.meta.env.DEV) {
        console.log('[JD Debug] Marking Stale!');
      }
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
    jdInputSignature: string;
    jdText: string;
    experienceText: string;
    inputMode: "text" | "attachment";
    attachmentName?: string;
    attachmentExtractedText?: string;
  };

  type AnalyzeSnapshot = {
    experiences: ResumeExperienceView[];
    certifications: CertificationView[];
    skillGroups: SkillGroupView[];
    jdText: string;
    jdFile: File | null;
    attachmentExtractedText: string | null;
    itemSignatures: JDAnalysisItemSignatures;
    experienceSignature: string;
    jdInputSignature: string;
    experienceText: string;
    inputMode: "text" | "attachment";
    attachmentName?: string;
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
      jdInputSignature: nextJdInputSignature,
      jdText: nextJdText,
      experienceText: nextExperienceText,
      inputMode,
      attachmentName,
      attachmentExtractedText,
    }: AnalysisStatePayload) => {
      const currentBackendPersisted = normalizeJDAnalysisPersistence(
        persistedJDAnalysisConfig
      );
      const nextPersistedJDAnalysis: ResumeJDAnalysis = {
        jdText: nextJdText,
        jdInputSignature: nextJdInputSignature,
        experienceSignature: nextExperienceSignature,
        result,
        itemSignatures,
        experienceText: nextExperienceText,
        inputMode,
        attachmentName,
        attachmentExtractedText,
        updatedAt: new Date().toISOString(),
      };
      setAnalysisResult(result);
      setAttachmentExtractedText(attachmentExtractedText ?? null);
      setPersistedJDAnalysis(nextPersistedJDAnalysis);
      setAnalysisContext({
        jdInputSignature: nextJdInputSignature,
        experienceSignature: nextExperienceSignature,
        itemSignatures,
        experienceText: nextExperienceText,
      });
      if (resumeId) {
        saveJDAnalysisCache(resumeId, nextPersistedJDAnalysis, {
          pendingSync: true,
          basePersistedFingerprint:
            buildJDAnalysisPersistenceFingerprint(currentBackendPersisted),
        });
      }
    },
    [persistedJDAnalysisConfig, resumeId]
  );

  const getAnalysisSnapshot = useCallback(() => {
    return {
      experiences: experienceItemsRef.current,
      certifications: certificationsRef.current,
      skillGroups: skillGroupsRef.current,
      jdText: jdTextRef.current,
      jdFile: jdFileRef.current,
      attachmentExtractedText,
    };
  }, [attachmentExtractedText]);

  const buildAnalyzeSnapshot = useCallback((): AnalyzeSnapshot => {
    const snapshot = getAnalysisSnapshot();
    const inputMode = snapshot.jdFile ? "attachment" : "text";
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
      jdInputSignature: buildJDInputSignature(snapshot.jdText, snapshot.jdFile),
      experienceText: buildExperienceTextSnapshot(snapshot.experiences),
      inputMode,
      attachmentName: snapshot.jdFile?.name,
      attachmentExtractedText: snapshot.attachmentExtractedText,
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
    async (
      options?: AnalyzeOptions & {
        onProgress?: JDAnalyzeProgressHandler;
        onEvent?: JDAnalyzeStreamHandler;
      }
    ): Promise<JDAnalyzeOutcome> => {
      const reportProgress = options?.onProgress;
      const reportEvent = options?.onEvent;
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
        reportProgress?.("prepare_context");
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
        reportProgress?.("request_ai");
        // 附件优先：有文件时使用附件路径（vision 或文档文本提取）
        const currentFile = startSnapshot.jdFile;
        const { supplementalText: attachmentSupplementalJdText } =
          splitAttachmentDerivedJdText(
            startSnapshot.jdText,
            startSnapshot.attachmentExtractedText
          );
        const result = currentFile
          ? await aiService.analyzeJDWithAttachment({
            file: currentFile,
            jdText: attachmentSupplementalJdText || undefined,
            resumeText,
            experienceText: startSnapshot.experienceText,
            prevResult: shouldUsePrev ? prevResultPayload : undefined,
            prevExperienceText: shouldUsePrev ? prevExperienceText : undefined,
          }, (event) => {
            if (event.type === "progress") {
              reportProgress?.(event.node);
            }
            reportEvent?.(event);
          })
          : await aiService.analyzeJD({
            text: startSnapshot.jdText,
            resumeText,
            prevResult: shouldUsePrev ? prevResultPayload : undefined,
            experienceText: startSnapshot.experienceText,
            prevExperienceText: shouldUsePrev ? prevExperienceText : undefined,
          }, (event) => {
            if (event.type === "progress") {
              reportProgress?.(event.node);
            }
            reportEvent?.(event);
          });
        const extractedAttachmentText = currentFile
          ? result.extractedJdText?.trim() ?? ""
          : "";
        const shouldPersistAttachmentAsText = Boolean(
          currentFile && extractedAttachmentText
        );
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
        reportProgress?.("merge_result");
        const nextResult =
          mode === "partial"
            ? mergeAnalysisResult(analysisResult, result, stableDiff)
            : result;
        const resetTrendBase = shouldResetTrendBase(
          mode,
          analysisContext,
          startSnapshot.jdInputSignature
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
        reportProgress?.("apply_score");
        applyMatchScoresForResult(finalResult, mode, stableDiff);
        const supplementalJdText = currentFile
          ? attachmentSupplementalJdText.trim()
          : startSnapshot.jdText.trim();
        const persistedJdText = shouldPersistAttachmentAsText
          ? supplementalJdText
            ? `${extractedAttachmentText}${JD_ATTACHMENT_SUPPLEMENT_PREFIX}${supplementalJdText}`
            : extractedAttachmentText
          : startSnapshot.jdText;
        const persistedInputMode = shouldPersistAttachmentAsText
          ? "text"
          : startSnapshot.inputMode;
        const persistedAttachmentName = shouldPersistAttachmentAsText
          ? undefined
          : startSnapshot.attachmentName;
        const persistedAttachmentExtractedText = shouldPersistAttachmentAsText
          ? extractedAttachmentText
          : startSnapshot.inputMode === "text"
            ? startSnapshot.attachmentExtractedText ?? undefined
            : undefined;
        const persistedJdInputSignature = shouldPersistAttachmentAsText
          ? buildJDInputSignature(persistedJdText, null)
          : startSnapshot.jdInputSignature;
        if (shouldPersistAttachmentAsText) {
          jdTextRef.current = persistedJdText;
          jdFileRef.current = null;
          setJdText(persistedJdText);
          setJdFile(null);
          setRestoredAttachmentContext(null);
        }
        reportProgress?.("persist_result");
        updateAnalysisState({
          result: finalResult,
          itemSignatures: startSnapshot.itemSignatures,
          experienceSignature: startSnapshot.experienceSignature,
          jdInputSignature: persistedJdInputSignature,
          jdText: persistedJdText,
          experienceText: startSnapshot.experienceText,
          inputMode: persistedInputMode,
          attachmentName: persistedAttachmentName,
          attachmentExtractedText: persistedAttachmentExtractedText,
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

  const handleAnalyze = useCallback(async (options?: HandleAnalyzeOptions): Promise<JDAnalyzeOutcome> => {
    const snapshot = buildAnalyzeSnapshot();
    const contextDiff = buildDiffFromContext(
      analysisContext,
      snapshot.itemSignatures
    );
    const diffSnapshot = analysisContext
      ? mergeDiffs(pendingDiffRef.current, contextDiff)
      : cloneDiff(pendingDiffRef.current);
    const hasPendingDiff = hasDiff(diffSnapshot);
    const hasJdInputChanged =
      analysisContext?.jdInputSignature !== snapshot.jdInputSignature;
    const hasPrevExperienceText =
      analysisContext?.experienceText !== undefined;
    const shouldSkipAnalyze =
      Boolean(analysisResult)
      && Boolean(analysisContext)
      && !hasPendingDiff
      && !hasJdInputChanged;

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
      !snapshot.jdFile &&
      restoredAttachmentContext
    ) {
      return { status: "missing_attachment" };
    }
    if (
      analysisResult &&
      analysisContext &&
      hasPendingDiff &&
      !hasJdInputChanged &&
      hasPrevExperienceText
    ) {
      return runAnalyze({
        mode: "partial",
        diff: diffSnapshot,
        onProgress: options?.onProgress,
        onEvent: options?.onEvent,
      });
    }
    return runAnalyze({
      mode: "full",
      onProgress: options?.onProgress,
      onEvent: options?.onEvent,
    });
  }, [
    analysisContext,
    analysisResult,
    buildAnalyzeSnapshot,
    buildDiffFromContext,
    needsReanalysis,
    restoredAttachmentContext,
    runAnalyze,
  ]);

  return {
    jdText,
    setJdText,
    jdFile,
    setJdFile,
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
    hasMissingAttachmentContext,
    persistedJDAnalysis,
    debugInfo,
    isOutdated,
  };
};




