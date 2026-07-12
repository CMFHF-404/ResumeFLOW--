import type { MatchScoreEntry, MatchTrend } from "./analysis";

export interface JDAnalysisResult {
  matchPercentage: number;
  matchTrend?: MatchTrend;
  jobKeywords: string[];
  missingKeywords: string[];
  jobTitle?: string;
  company?: string;
  summary: string;
  extractedJdText?: string;
  jdInterpretation?: JDInterpretation;
  capabilityAnalysis?: JDCapabilityAnalysis;
  experienceMatches?: MatchScoreEntry[];
  certificationMatches?: MatchScoreEntry[];
  skillMatches?: MatchScoreEntry[];
}

export interface JDCoreCapability {
  id: string;
  name: string;
  weight: number;
  jdEvidence: string;
  resumeEvidenceLevel: 0 | 1 | 2 | 3 | 4;
  resumeEvidenceSummary: string;
  risk: 'none' | 'weak_evidence' | 'keyword_only' | 'missing' | 'mispositioned';
  likelyUnwritten?: boolean;
  followUpQuestions: string[];
}

export interface ExperienceEvidenceDiagnosis {
  experienceId: string;
  currentPositioning: string;
  targetRolePositioning: string;
  provenCapabilities: string[];
  weakCapabilities: string[];
  unsupportedClaims: string[];
  missingButAskableEvidence: Array<{
    capability: string;
    question: string;
    exampleAnswerHint: string;
  }>;
  recommendedRewriteMode: 'rewrite_now' | 'ask_before_rewrite' | 'not_recommended_for_this_role';
}

export interface JDCapabilityAnalysis {
  roleFamily: string;
  coreCapabilities: JDCoreCapability[];
  overallEvidenceCompleteness: number;
  scoreConfidence: 'high' | 'medium' | 'low';
  scoreWarnings: string[];
  experienceDiagnoses: ExperienceEvidenceDiagnosis[];
}

export interface JDInterpretation {
  roleFamily: string;
  normalizedTitle: string;
  seniority: string;
  businessDomain?: string;
  roleIntent: string;
  coreResponsibilities: Array<{
    label: string;
    evidence: string;
    weight: 'high' | 'medium' | 'low';
  }>;
  mustHave: Array<{
    label: string;
    type: 'skill' | 'experience' | 'domain' | 'education' | 'tool' | 'other';
    evidence: string;
  }>;
  niceToHave: Array<{
    label: string;
    evidence: string;
  }>;
  hardFilters: Array<{
    label: string;
    evidence: string;
  }>;
  sameTypeJobStrategy: {
    recommendedTitles: Array<{
      title: string;
      reason: string;
      confidence: number;
    }>;
    searchQueries: Array<{
      label: string;
      query: string;
      includeKeywords: string[];
      excludeKeywords: string[];
    }>;
    avoidTitles: Array<{
      title: string;
      reason: string;
    }>;
  };
}

export type RawJDAnalysisResult = JDAnalysisResult & {
  extracted_jd_text?: unknown;
  jd_interpretation?: unknown;
  capability_analysis?: unknown;
};

export type PolishMode = 'default' | 'campus_recruitment' | 'highlight' | 'smart_complete' | 'shorten' | 'expand' | 'custom' | 'assistant';

export type AssistantDraftCardType = 'experience' | 'certification' | 'skill_group';

export interface AssistantExperienceDraft {
  category: 'work' | 'project' | 'education';
  org: string;
  title: string;
  startDate: string;
  endDate: string;
  isCurrent?: boolean;
  targetMasterId?: string | null;
  star: {
    s: string;
    t: string;
    a: string;
    r: string;
  };
}

export interface AssistantCertificationDraft {
  name: string;
  issuer: string;
  issueDate: string;
  expiryDate: string;
  credentialId: string;
  credentialUrl: string;
  description: string;
}

export interface AssistantSkillDraftGroup {
  category: string;
  skills: Array<{
    name: string;
    targetUserSkillId?: string | null;
  }>;
}

export type AssistantDraftCard =
  | {
    type: 'experience';
    status: 'draft_ready';
    summary?: string;
    data: AssistantExperienceDraft;
  }
  | {
    type: 'certification';
    status: 'draft_ready';
    summary?: string;
    data: AssistantCertificationDraft;
  }
  | {
    type: 'skill_group';
    status: 'draft_ready';
    summary?: string;
    data: AssistantSkillDraftGroup;
  };
