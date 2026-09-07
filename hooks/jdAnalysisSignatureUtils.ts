import type { JDAnalysisItemSignatures } from "../types/analysis";
import type {
  CertificationView,
  EducationView,
  ResumeEditorProfile,
  ResumeJDAnalysis,
  ResumeExperienceView,
  SkillGroupView,
} from "../types/resume";
import {
  buildExperienceAnalyzeEntry,
  buildJDTextSignature,
  buildResumeAISnapshot,
} from "../utils/resumeHelpers";
import {
  buildResumeEvaluationSnapshot,
  type ResumeEvaluationSnapshot,
} from "../utils/resumeEvaluationSnapshot";
import { canonicalStringify } from "../utils/canonicalStringify";

export { canonicalStringify } from "../utils/canonicalStringify";

export const JD_ATTACHMENT_SUPPLEMENT_PREFIX = "\n\n补充 JD 说明：\n";

const buildExperienceAnalyzePayload = (experiences: ResumeExperienceView[]) => ({
  experiences: experiences.map(buildExperienceAnalyzeEntry),
});

export type ResumeEvaluationInputContext = {
  profile?: ResumeEditorProfile;
  personalSummary?: string;
  hasPersonalSummaryOverride?: boolean;
  isSummaryVisible?: boolean;
  targetRole?: string;
  educations?: EducationView[];
  selectedExperienceIds?: ReadonlySet<string>;
  selectedEducationIds?: ReadonlySet<string>;
  selectedCertificationIds?: ReadonlySet<string>;
  selectedSkillIds?: ReadonlySet<string>;
  sectionOrder?: readonly string[];
};

const EMPTY_PROFILE: ResumeEditorProfile = {
  name: "",
  email: "",
  phone: "",
  location: "",
  linkedin: "",
  summary: "",
  avatarDataUrl: "",
};

const allIds = <T extends { id: string }>(items: T[]) => new Set(items.map((item) => item.id));

export const buildAnalyzePayload = (
  experiences: ResumeExperienceView[],
  certifications: CertificationView[],
  skillGroups: SkillGroupView[],
  context: ResumeEvaluationInputContext = {}
): ResumeEvaluationSnapshot => buildResumeEvaluationSnapshot({
  profile: context.profile ?? EMPTY_PROFILE,
  personalSummary: context.personalSummary ?? "",
  hasPersonalSummaryOverride: context.hasPersonalSummaryOverride ?? false,
  isSummaryVisible: context.isSummaryVisible ?? true,
  targetRole: context.targetRole ?? "",
  experiences,
  selectedExperienceIds: context.selectedExperienceIds ?? allIds(experiences),
  educations: context.educations ?? [],
  selectedEducationIds:
    context.selectedEducationIds ?? allIds(context.educations ?? []),
  certifications,
  selectedCertificationIds:
    context.selectedCertificationIds ?? allIds(certifications),
  skillGroups,
  selectedSkillIds: context.selectedSkillIds ?? new Set(
    skillGroups.flatMap((group) => group.skills.map((skill) => skill.id))
  ),
  sectionOrder: context.sectionOrder,
});

const sortById = <T extends { id: string }>(items: T[]) => {
  return [...items].sort((a, b) => a.id.localeCompare(b.id));
};

export const buildExperienceTextSnapshot = (experiences: ResumeExperienceView[]) => {
  const payload = buildExperienceAnalyzePayload(experiences);
  return canonicalStringify({ experiences: sortById(payload.experiences) });
};

export const buildAnalyzeSignature = (
  experiences: ResumeExperienceView[],
  certifications: CertificationView[],
  skillGroups: SkillGroupView[],
  context: ResumeEvaluationInputContext = {}
) => {
  const payload = buildAnalyzePayload(experiences, certifications, skillGroups, context);
  return canonicalStringify(payload);
};

/**
 * Independent JD-match candidates deliberately exclude profile, education and
 * selection state. This keeps the existing per-item stale/diff semantics
 * separate from the full-resume evaluation signature.
 */
export const buildMatchCandidateSignature = (
  experiences: ResumeExperienceView[],
  certifications: CertificationView[],
  skillGroups: SkillGroupView[]
) => {
  const snapshot = buildResumeAISnapshot(experiences, certifications, skillGroups);
  return canonicalStringify({
    experiences: sortById(snapshot.experiences),
    certifications: sortById(snapshot.certifications),
    skills: sortById(snapshot.skills),
  });
};

export type JDAttachmentDescriptor = Pick<File, "name" | "size" | "lastModified" | "type">;

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

export const buildPersistedJDInputSignature = (
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

export const buildJDInputSignature = (
  jdText: string,
  file: JDAttachmentDescriptor | null
) => canonicalStringify({
  inputMode: file ? "attachment" : "text",
  textSignature: buildJDTextSignature(jdText),
  attachmentSignature: buildAttachmentSignature(file),
});

export const arePersistedJDAnalysisEqual = (
  backend: ResumeJDAnalysis | null,
  local: ResumeJDAnalysis | null
) => {
  if (!backend || !local) {
    return backend === local;
  }
  return canonicalStringify(backend) === canonicalStringify(local);
};

export const splitAttachmentDerivedJdText = (
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

export const resolveReplacementJDAttachmentText = (
  jdText: string,
  previousAttachmentExtractedText?: string | null
) => splitAttachmentDerivedJdText(
  jdText,
  previousAttachmentExtractedText
).supplementalText;

export type RestoredJDAttachmentContext = {
  jdText: string;
  jdInputSignature: string;
  attachmentName?: string;
  attachmentExtractedText?: string | null;
};

export type JDAttachmentReplacementState = {
  jdText: string;
  attachmentExtractedText: string | null;
  restoredAttachmentContext: RestoredJDAttachmentContext | null;
};

export type JDAttachmentReplacement = JDAttachmentReplacementState & {
  backup: JDAttachmentReplacementState;
};

/**
 * Keep the exact prior attachment provenance while a replacement file is
 * selected but has not yet produced a persisted analysis.
 */
export const beginJDAttachmentReplacement = (
  state: JDAttachmentReplacementState
): JDAttachmentReplacement => ({
  jdText: resolveReplacementJDAttachmentText(
    state.jdText,
    state.attachmentExtractedText
  ),
  attachmentExtractedText: null,
  restoredAttachmentContext: state.restoredAttachmentContext,
  backup: {
    jdText: state.jdText,
    attachmentExtractedText: state.attachmentExtractedText,
    restoredAttachmentContext: state.restoredAttachmentContext,
  },
});

export const restoreJDAttachmentReplacement = (
  backup: JDAttachmentReplacementState,
  currentJdText?: string
): JDAttachmentReplacementState => {
  const initialReplacementText = resolveReplacementJDAttachmentText(
    backup.jdText,
    backup.attachmentExtractedText
  );
  // Removing a file restores its provenance, but does not undo later typing.
  const hasTextEdits = currentJdText !== undefined
    && currentJdText !== initialReplacementText;
  return {
    jdText: hasTextEdits ? currentJdText : backup.jdText,
    attachmentExtractedText: backup.attachmentExtractedText,
    restoredAttachmentContext: backup.restoredAttachmentContext,
  };
};

export type ResumeEvaluationJDContext = {
  /** Exact JD text sent to the text-only six-dimension endpoint. */
  text: string;
  jdAvailable: boolean;
  jdMatchPercentage: number | undefined;
  /** Attachment mode cannot be evaluated safely until its body is extracted. */
  hasMissingAttachmentText: boolean;
};

/**
 * Resolve the canonical JD input for the text-only six-dimension endpoint.
 *
 * Attachment textarea content is supplemental context, not the attachment
 * body.  Never reinterpret it as a complete JD when extraction is missing.
 */
export const resolveResumeEvaluationJDContext = ({
  jdText,
  inputMode,
  attachmentExtractedText,
  matchPercentage,
}: {
  jdText: string;
  inputMode: "text" | "attachment";
  attachmentExtractedText?: string | null;
  matchPercentage?: unknown;
}): ResumeEvaluationJDContext => {
  let text = jdText;
  let hasMissingAttachmentText = false;

  if (inputMode === "attachment") {
    const extractedText = attachmentExtractedText?.trim() ?? "";
    if (!extractedText) {
      text = "";
      hasMissingAttachmentText = true;
    } else {
      const { supplementalText } = splitAttachmentDerivedJdText(
        jdText,
        extractedText
      );
      const normalizedSupplement = supplementalText.trim();
      text = normalizedSupplement
        ? `${extractedText}${JD_ATTACHMENT_SUPPLEMENT_PREFIX}${normalizedSupplement}`
        : extractedText;
    }
  }

  const jdAvailable = !hasMissingAttachmentText && Boolean(text.trim());
  const jdMatchPercentage = (
    jdAvailable
    && typeof matchPercentage === "number"
    && Number.isFinite(matchPercentage)
    && matchPercentage >= 0
    && matchPercentage <= 100
  ) ? matchPercentage : undefined;

  return {
    text,
    jdAvailable,
    jdMatchPercentage,
    hasMissingAttachmentText,
  };
};

const buildSignatureMap = <T extends { id: string }>(items: T[]) => {
  const map: Record<string, string> = {};
  items.forEach((item) => {
    map[item.id] = canonicalStringify(item);
  });
  return map;
};

export const buildEmptyJDItemSignatures = (): JDAnalysisItemSignatures => ({
  experiences: {},
  certifications: {},
  skills: {},
});

export const buildJDItemSignatures = (
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
