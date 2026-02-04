export type JDAnalysisItemSignatures = {
  experiences: Record<string, string>;
  certifications: Record<string, string>;
  skills: Record<string, string>;
};

export type JDAnalysisContext = {
  jdTextSignature: string;
  experienceSignature: string;
  itemSignatures: JDAnalysisItemSignatures;
};

export type MatchScoreEntry = {
  id: string;
  score: number;
  reason?: string;
};
