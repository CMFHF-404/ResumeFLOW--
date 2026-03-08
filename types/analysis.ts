export type JDAnalysisItemSignatures = {
  experiences: Record<string, string>;
  certifications: Record<string, string>;
  skills: Record<string, string>;
};

export type MatchTrend = "up" | "same" | "down";

export type JDAnalysisContext = {
  jdInputSignature: string;
  experienceSignature: string;
  itemSignatures: JDAnalysisItemSignatures;
  experienceText?: string;
};

export type MatchScoreEntry = {
  id: string;
  score: number;
  reason?: string;
  trend?: MatchTrend;
};
