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
  buildJDTextSignature,
  clampMatchScore,
  diffJDItemSignatures,
  sortExperienceItemsForMatch,
} from "../utils/resumeHelpers";
import type {
  JDAnalysisContext,
  JDAnalysisItemSignatures,
  MatchScoreEntry,
} from "../types/analysis";
import type {
  CertificationView,
  ResumeExperienceView,
  SkillGroupView,
  SkillItemView,
} from "../types/resume";

const DEFAULT_JD_TEXT = "";

const buildExperienceAnalyzeEntry = (item: ResumeExperienceView) => ({
  id: item.id,
  title: item.title,
  org: item.company,
  start_date: item.startDate,
  end_date: item.endDate,
  star: item.star,
});

const buildCertificationAnalyzeEntry = (cert: CertificationView) => ({
  id: cert.id,
  name: cert.name,
  issuer: cert.issuer,
  issue_date: cert.date,
});

const buildSkillAnalyzeEntry = (group: SkillGroupView, skill: SkillItemView) => ({
  id: skill.id,
  name: skill.name,
  category: group.name,
});

const buildSkillAnalyzePayload = (groups: SkillGroupView[]) => {
  return groups.flatMap((group) =>
    group.skills.map((skill) => buildSkillAnalyzeEntry(group, skill))
  );
};

const buildAnalyzePayload = (
  experiences: ResumeExperienceView[],
  certifications: CertificationView[],
  skillGroups: SkillGroupView[]
) => ({
  experiences: experiences.map(buildExperienceAnalyzeEntry),
  certifications: certifications.map(buildCertificationAnalyzeEntry),
  skills: buildSkillAnalyzePayload(skillGroups),
});

const sortById = <T extends { id: string }>(items: T[]) => {
  return [...items].sort((a, b) => a.id.localeCompare(b.id));
};

const buildAnalyzeSignature = (
  experiences: ResumeExperienceView[],
  certifications: CertificationView[],
  skillGroups: SkillGroupView[]
) => {
  const payload = buildAnalyzePayload(experiences, certifications, skillGroups);
  return JSON.stringify({
    experiences: sortById(payload.experiences),
    certifications: sortById(payload.certifications),
    skills: sortById(payload.skills),
  });
};

const buildSignatureMap = <T extends { id: string }>(items: T[]) => {
  const map: Record<string, string> = {};
  items.forEach((item) => {
    map[item.id] = JSON.stringify(item);
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
  const experienceEntries = experiences.map(buildExperienceAnalyzeEntry);
  const certificationEntries = certifications.map(buildCertificationAnalyzeEntry);
  const skillEntries = buildSkillAnalyzePayload(skillGroups);
  return {
    experiences: buildSignatureMap(experienceEntries),
    certifications: buildSignatureMap(certificationEntries),
    skills: buildSignatureMap(skillEntries),
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

const buildMatchReasonMap = (matches?: MatchScoreEntry[]) => {
  const map = new Map<string, string>();
  (matches || []).forEach((match) => {
    if (match.reason) {
      map.set(match.id, match.reason);
    }
  });
  return map;
};

type UseJDAnalysisOptions = {
  resumeId: string | null;
  experienceItems: ResumeExperienceView[];
  setExperienceItems: Dispatch<SetStateAction<ResumeExperienceView[]>>;
  certifications: CertificationView[];
  skillGroups: SkillGroupView[];
  isLoadingExperiences: boolean;
};

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
  skillMatchScores: Map<string, number>;
  setSkillMatchScores: Dispatch<SetStateAction<Map<string, number>>>;
  handleAnalyze: () => Promise<void>;
};

export const useJDAnalysis = ({
  resumeId,
  experienceItems,
  setExperienceItems,
  certifications,
  skillGroups,
  isLoadingExperiences,
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
  const [skillMatchScores, setSkillMatchScores] = useState<
    Map<string, number>
  >(new Map());
  const hasLoadedJdCacheRef = useRef(false);

  const experienceSignature = useMemo(
    () => buildAnalyzeSignature(experienceItems, certifications, skillGroups),
    [certifications, experienceItems, skillGroups]
  );
  const jdTextSignature = useMemo(
    () => buildJDTextSignature(jdText),
    [jdText]
  );

  const applyExperienceMatchScores = useCallback(
    (matches?: MatchScoreEntry[]) => {
      const matchScores = buildMatchScoreMap(matches);
      const matchReasons = buildMatchReasonMap(matches);
      setExperienceItems((prev) => {
        const next = prev.map((item) => ({
          ...item,
          matchScore: matchScores.has(item.id)
            ? matchScores.get(item.id)
            : undefined,
          matchReason: matchReasons.get(item.id),
        }));
        return sortExperienceItemsForMatch(next);
      });
    },
    [setExperienceItems]
  );

  const applyCertificationMatchScores = useCallback((matches?: MatchScoreEntry[]) => {
    setCertificationMatchScores(buildMatchScoreMap(matches));
  }, []);

  const applySkillMatchScores = useCallback((matches?: MatchScoreEntry[]) => {
    setSkillMatchScores(buildMatchScoreMap(matches));
  }, []);

  const markStaleMatches = useCallback(
    (diff: ReturnType<typeof diffJDItemSignatures>) => {
      if (diff.experiences.size > 0) {
        setExperienceItems((prev) => {
          const next = prev.map((item) =>
            diff.experiences.has(item.id)
              ? { ...item, matchScore: undefined, matchReason: undefined }
              : item
          );
          return sortExperienceItemsForMatch(next);
        });
        setStaleExperienceIds((prev) => {
          const next = new Set(prev);
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
      }
      if (diff.skills.size > 0) {
        setSkillMatchScores((prev) => {
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
      applyExperienceMatchScores();
      applyCertificationMatchScores();
      applySkillMatchScores();
      if (options?.resetJdText) {
        setJdText(DEFAULT_JD_TEXT);
      }
      if (options?.clearCache && resumeId) {
        clearJDAnalysisCache(resumeId);
      }
    },
    [
      applyCertificationMatchScores,
      applyExperienceMatchScores,
      applySkillMatchScores,
      resumeId,
    ]
  );

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
      setJdText(cached.jdText);
      setAnalysisResult(cached.result);
      setAnalysisContext({
        jdTextSignature: buildJDTextSignature(cached.jdText),
        experienceSignature: cached.experienceSignature,
        itemSignatures: cachedSignatures,
      });
      applyExperienceMatchScores(cached.result.experienceMatches);
      applyCertificationMatchScores(cached.result.certificationMatches);
      applySkillMatchScores(cached.result.skillMatches);
      setIsJDCollapsed(true);
      setStaleExperienceIds(new Set());
    }
    hasLoadedJdCacheRef.current = true;
  }, [
    applyCertificationMatchScores,
    applyExperienceMatchScores,
    applySkillMatchScores,
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
    const nextSignatures = buildJDItemSignatures(
      experienceItems,
      certifications,
      skillGroups
    );
    const diff = diffJDItemSignatures(
      analysisContext.itemSignatures,
      nextSignatures
    );
    if (
      diff.experiences.size > 0 ||
      diff.certifications.size > 0 ||
      diff.skills.size > 0
    ) {
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

  useEffect(() => {
    if (!analysisContext || !resumeId) {
      return;
    }
    if (analysisContext.jdTextSignature !== jdTextSignature) {
      resetJDAnalysisState({ clearCache: true });
    }
  }, [analysisContext, jdTextSignature, resetJDAnalysisState, resumeId]);

  const handleAnalyze = useCallback(async () => {
    setIsAnalyzing(true);
    try {
      const payload = buildAnalyzePayload(
        experienceItems,
        certifications,
        skillGroups
      );
      const result = await aiService.analyzeJD(jdText, JSON.stringify(payload));
      const itemSignatures = buildJDItemSignatures(
        experienceItems,
        certifications,
        skillGroups
      );
      applyExperienceMatchScores(result.experienceMatches);
      applyCertificationMatchScores(result.certificationMatches);
      applySkillMatchScores(result.skillMatches);
      setAnalysisResult(result);
      setAnalysisContext({
        jdTextSignature,
        experienceSignature,
        itemSignatures,
      });
      if (resumeId) {
        saveJDAnalysisCache(resumeId, {
          jdText,
          experienceSignature,
          result,
          itemSignatures,
        });
      }
      setStaleExperienceIds(new Set());
      setIsJDCollapsed(true);
    } catch (error) {
      console.error("Failed to analyze JD", error);
    } finally {
      setIsAnalyzing(false);
    }
  }, [
    applyCertificationMatchScores,
    applyExperienceMatchScores,
    applySkillMatchScores,
    certifications,
    experienceItems,
    experienceSignature,
    jdText,
    jdTextSignature,
    resumeId,
    skillGroups,
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
    skillMatchScores,
    setSkillMatchScores,
    handleAnalyze,
  };
};
