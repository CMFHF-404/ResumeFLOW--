import type { MatchScoreEntry, MatchTrend } from "./analysis";

export const RESUME_EVALUATION_VERSION = "resume_flow_v1" as const;
export const GUIDANCE_AUDIT_EVALUATION_VERSION = "guidance_audit_v1" as const;
export const RESUME_SCORING_VERSION = "coverage_consensus_v4" as const;

export const RESUME_EVALUATION_DIMENSIONS = [
  "逻辑清晰",
  "STAR应用",
  "内容可读",
  "内容完整",
  "专业表达",
  "成果量化",
] as const;

export type ResumeEvaluationDimensionName =
  (typeof RESUME_EVALUATION_DIMENSIONS)[number];

export type ResumeEvaluationSubscore = {
  name: string;
  maxScore: number;
  score: number;
  evidenceIds: string[];
};

export type ResumeEvaluationDimension = {
  dimension: ResumeEvaluationDimensionName;
  score: number;
  level: string;
  subscores: ResumeEvaluationSubscore[];
  strengths: string[];
  issues: string[];
  improvementQuestions: string[];
};

export type ResumeEvaluationEvidence = {
  evidenceId: string;
  sourceText: string;
  location: string;
  factId: string;
  verificationStatus: string;
  supportedDimensions: ResumeEvaluationDimensionName[];
};

export type ResumeEvaluationIssue = {
  issueId: string;
  description: string;
  primaryDimension: ResumeEvaluationDimensionName;
  relatedDimensions: ResumeEvaluationDimensionName[];
  evidenceIds: string[];
  severity: "high" | "medium" | "low";
  pointsNotEarned: number;
};

export type ResumeEvaluationMissingInformation = {
  field: string;
  reason: string;
  question: string;
  potentialDimension: ResumeEvaluationDimensionName | "";
  potentialScoreGain: number;
};

export type ResumeEvaluationRiskFlag = {
  type:
    | "unverified_fact"
    | "inferred_fact"
    | "exaggerated_claim"
    | "conflicting_date"
    | "duplicated_content";
  description: string;
  evidenceIds: string[];
};

export type ResumeEvaluationTopPriority = {
  priority: number;
  issueId: string;
  action: string;
  expectedScoreGain: number;
};

/** Historical numeric report. It remains readable but cannot start a new optimization. */
export type LegacyResumeEvaluation = {
  evaluationVersion: typeof RESUME_EVALUATION_VERSION;
  scoringVersion?: string;
  evaluationScope: "full_resume";
  targetRole: string;
  overallScore: number;
  overallLevel: string;
  evaluationConfidence: number;
  scoreCalculation: {
    dimensionSum: number;
    rawAverage: number;
    roundingRule: "round_half_up";
    finalScore: number;
  };
  dimensions: ResumeEvaluationDimension[];
  evidence: ResumeEvaluationEvidence[];
  issues: ResumeEvaluationIssue[];
  jdMatch: number | null;
  missingInformation: ResumeEvaluationMissingInformation[];
  riskFlags: ResumeEvaluationRiskFlag[];
  topPriorities: ResumeEvaluationTopPriority[];
};

export type ResumeGuidanceBand =
  | "strong"
  | "adequate"
  | "needs_attention"
  | "insufficient_evidence";

export type ResumeGuidanceDimension = {
  dimension: ResumeEvaluationDimensionName;
  status: ResumeGuidanceBand;
  strengths: string[];
  issues: string[];
  actions: string[];
};

export type ResumeGuidanceAction = {
  taskId: string;
  issueId: string;
  dimension: ResumeEvaluationDimensionName;
  fieldPath: string;
  description: string;
  action: string;
};

export type ResumeGuidanceRiskFlag = {
  taskId: string;
  type: string;
  description: string;
};

export type ResumeGuidanceAuditReceipt = {
  receiptId: string;
  inputHash: string;
  tasksHash: string;
  judgmentsHash: string;
  rubricHash: string;
  schemaHash: string;
  auditVersion: "guidance_task_audit_v1";
};

/** Public, non-numeric guidance report produced by one judgment plus one audit. */
export type GuidanceAuditEvaluation = {
  evaluationVersion: typeof GUIDANCE_AUDIT_EVALUATION_VERSION;
  evaluationScope: "full_resume";
  targetRole: string;
  overallBand: ResumeGuidanceBand;
  confidence: "high" | "medium" | "low";
  dimensionGuidance: ResumeGuidanceDimension[];
  topPriorities: ResumeGuidanceAction[];
  safeCleanup: ResumeGuidanceAction[];
  informationNeeded: ResumeGuidanceAction[];
  riskFlags: ResumeGuidanceRiskFlag[];
  auditReceipt: ResumeGuidanceAuditReceipt;
  /** JD fit stays its own numeric product contract. */
  jdMatch: number | null;
};

export type ResumeScoreSuggestion = {
  suggestionId: string; moduleType: string; moduleId: string; fieldPath: string;
  dimension?: ResumeEvaluationDimensionName | '个人贡献' | '成果证据'; problem: string; direction: string; label: string; editable: boolean;
  targetId?: string; dimensionId?: string; severity?: 'high' | 'medium' | 'low';
  evidenceState?: 'stated' | 'not_demonstrated' | 'conflicting' | 'role_reference';
  sourceRefs?: string[]; jdSourceRefs?: string[]; impact?: string; action?: 'retain' | 'move_forward' | 'compress' | 'delete' | 'rewrite' | 'ask' | 'verify'; needsFacts?: boolean;
  diagnosticId?: string; primaryCriterionId?: string; handling?: 'organize' | 'ask_user' | 'manual_review';
  factGaps?: {gapId: string; kind?: string; question: string; reason: string; sourceRefs: string[]}[];
  strategySteps?: string[];
  recommendationKind?: 'fix' | 'enhance';
  skillAction?: 'reorder'|'regroup'|'clarify_existing'|'add_tool'|'change_proficiency'|null;
  evidenceSpanIds?: string[];
  objectId?: string; operationId?: string | null; relatedObjectIds?: string[];
  skillFocus?: 'usage'|'methods'|'proficiency'|'category';
  executionBlockReason?: {code:string;message:string};
  strategyType?: string;
  selectedItems?: string[];
  candidateText?: string | null;
  candidateSourceRef?: string | null;
  operations?: {kind:string;moduleId:string;fieldPath:string;selectedItems:string[]}[];
  executionRequirements?: string[];
  availableItems?: {id:string;text?:string}[];
};
export type LegacyResumeScoreEvaluation = {
  evaluationVersion: 'resume_score_v2'; scoringVersion: 'single_pass_v1'; evaluationScope: 'full_resume';
  overallScore: number; summary: string;
  dimensions: { dimension: ResumeEvaluationDimensionName; score: number; comment: string }[];
  suggestions: ResumeScoreSuggestion[]; jdMatch: number | null;
};
export type CareerStage = 'unspecified' | 'graduate' | 'junior';
export type ExpressionAction={status:'retain'|'adjust'|'not_applicable';reason:string;spanIds:string[]};
export type EvidenceCriterion = { criterionId: string; label: string; level: number; reason?: string; sourceRefs?: string[]; jdSourceRefs?: string[];
  anchorId?: string; anchorText?: string; unmetConditions?: {conditionId: string; label: string; reason: string}[];
  gapExplanation?: string; diagnosticIds?: string[] };
export type EvidenceResumeScoreEvaluation = Omit<LegacyResumeScoreEvaluation, 'evaluationVersion' | 'scoringVersion' | 'dimensions'> & {
  evidenceSpans?: {spanId:string;sourceRef:string;start:number;end:number;text:string}[];
  expressionPlan?: {moduleId:string; retain:ExpressionAction;compress:ExpressionAction;lead:ExpressionAction;readingOrder:string[];diagnosticIds:string[]}[];
  metricReview?: {moduleId:string;aspects:{aspect:string;status:'stated'|'explain'|'confirm'|'not_applicable';reason:string;spanIds:string[];diagnosticIds:string[]}[]}[];
  evaluationVersion: 'resume_score_v3' | 'resume_score_v4'; scoringVersion: 'evidence_rubric_v1' | 'evidence_rubric_v2';
  overallLevel: string; focusRationale: string; contextNotice: string;
  focusObjectIds?: string[]; reportStatus?: 'complete'|'partial'; unavailableSuggestionCount?: number;
  objectCatalog?: {objectId:string;kind:string;moduleId:string;label:string;sourceRef:string}[];
  assessmentContext: {targetRole: string; careerStage: CareerStage; mode: 'general' | 'role_reference' | 'jd'; assessmentAsOf: string;
    inputCapabilities: {structuredText: true; pageImages: false; layoutMeasurements: false}};
  dimensions: {dimensionId: string; dimension: string; weight: number; score: number; comment: string; criteria: EvidenceCriterion[]; sourceRefs?: string[]; jdSourceRefs?: string[]}[];
  reviewCoverage: {area: string; status: 'findings' | 'clear' | 'not_applicable'; reason: string}[];
  reviewInventory?: {checkId: string; topic: string; label: string; scopeRefs: string[]}[];
  reviewChecks?: {checkId: string; topic: string; label: string; scopeRefs: string[]; sourceRefs: string[]; diagnosticIds: string[]; status: 'findings' | 'clear' | 'not_applicable'; reason: string}[];
  strengths: {text: string; reason: string; sourceRefs: string[]; jdSourceRefs?: string[]}[];
  requirements: {requirement: string; reason: string; status: 'demonstrated' | 'weak' | 'not_demonstrated' | 'unknown'; sourceRefs: string[]; jdSourceRefs: string[]}[];
  sources: {sourceId: string; path: string; text: string; kind: 'text' | 'scope'}[];
  scoreCalculation: {dimensions: {dimensionId: string; levelSum: number; weight: number; rawScore: number}[]; rawTotal: number;
    roundingRule: 'round_half_up'; finalScore: number; calibrationStatus: 'pending_human_validation'};
  metadata: {promptVersion: string; rubricVersion: string; guideVersion: string; inputHash: string;
    responseSchemaVersion?: string; responseSchemaHash?: string; factQuestionVersion?: string;
    model: string; provider: string; transport: string; reasoning: Record<string, unknown>};
};
export type ResumeScoreEvaluation = LegacyResumeScoreEvaluation | EvidenceResumeScoreEvaluation;
export type ResumeEvaluation = LegacyResumeEvaluation | GuidanceAuditEvaluation | ResumeScoreEvaluation;

export const isGuidanceAuditEvaluation = (
  evaluation: ResumeEvaluation | null | undefined,
): evaluation is GuidanceAuditEvaluation => (
  evaluation?.evaluationVersion === GUIDANCE_AUDIT_EVALUATION_VERSION
);

export interface JDAnalysisResult {
  /** 六维简历质量总分。旧数据缺少 resumeEvaluation 时仅作历史值处理。 */
  matchPercentage: number;
  matchTrend?: MatchTrend;
  resumeEvaluation?: ResumeEvaluation;
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
  resume_evaluation?: unknown;
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
