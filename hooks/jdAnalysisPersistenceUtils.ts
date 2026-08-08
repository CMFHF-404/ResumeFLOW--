import type { JDAnalysisResult } from "../services/aiService";
import type { JDAnalysisItemSignatures } from "../types/analysis";
import type { ResumeJDAnalysis } from "../types/resume";
import {
  buildJDInputSignature,
  buildPersistedJDInputSignature,
  JD_ATTACHMENT_SUPPLEMENT_PREFIX,
} from "./jdAnalysisSignatureUtils";
import type { JDAnalyzeRequestSnapshot } from "./jdAnalysisRequestRunner";

export type AnalysisStatePayload = {
  result: JDAnalysisResult;
  itemSignatures: JDAnalysisItemSignatures;
  experienceSignature: string;
  evaluationSignature?: string;
  targetRoleSignature?: string;
  jdInputSignature: string;
  jdText: string;
  experienceText: string;
  inputMode: "text" | "attachment";
  attachmentName?: string;
  attachmentExtractedText?: string;
  evaluationIsOutdated?: boolean;
};

export type PersistedAttachmentFields = {
  jdText: string;
  jdInputSignature: string;
  inputMode: "text" | "attachment";
  attachmentName?: string;
  attachmentExtractedText?: string;
};

export const normalizePersistedAnalysisForState = (
  payload: ResumeJDAnalysis,
  fallbackItemSignatures: JDAnalysisItemSignatures
): ResumeJDAnalysis => {
  const validatedSignatures = payload.itemSignatures ?? fallbackItemSignatures;
  const persistedJdInputSignature =
    payload.jdInputSignature
    || buildPersistedJDInputSignature(
      payload.jdText,
      payload.inputMode,
      payload.attachmentName
    );

  return {
    ...payload,
    jdInputSignature: persistedJdInputSignature,
    itemSignatures: {
      experiences: validatedSignatures.experiences || {},
      certifications: validatedSignatures.certifications || {},
      skills: validatedSignatures.skills || {},
    },
  };
};

export const resolveHydratedEvaluationSignature = (
  payload: ResumeJDAnalysis,
  currentEvaluationSignature: string
) => (
  payload.evaluationSignatureVersion === "agent_final_snapshot_v1"
  && payload.isOutdated === false
  && payload.evaluationIsOutdated === false
    ? currentEvaluationSignature
    : payload.evaluationSignature
);

export const resolveHydratedAnalysisCandidate = (
  payload: ResumeJDAnalysis,
  currentExperienceSignature: string,
  currentItemSignatures: JDAnalysisItemSignatures
) => (
  payload.analysisSignatureVersion === "agent_final_snapshot_v1"
  && payload.isOutdated === false
    ? {
      experienceSignature: currentExperienceSignature,
      itemSignatures: currentItemSignatures,
    }
    : {
      experienceSignature: payload.experienceSignature,
      itemSignatures: payload.itemSignatures,
    }
);

export const mergeAuthoritativeStaleFlags = (
  local: ResumeJDAnalysis,
  backend: ResumeJDAnalysis
): ResumeJDAnalysis | null => {
  const nextIsOutdated = local.isOutdated === true || backend.isOutdated === true;
  const nextEvaluationIsOutdated = (
    local.evaluationIsOutdated === true
    || backend.evaluationIsOutdated === true
  );
  if (
    nextIsOutdated === (local.isOutdated === true)
    && nextEvaluationIsOutdated === (local.evaluationIsOutdated === true)
  ) {
    return null;
  }
  return {
    ...local,
    isOutdated: nextIsOutdated,
    evaluationIsOutdated: nextEvaluationIsOutdated,
  };
};

export const buildResumeJDAnalysisPayload = (
  payload: AnalysisStatePayload,
  updatedAt: string = new Date().toISOString()
): ResumeJDAnalysis => ({
  jdText: payload.jdText,
  jdInputSignature: payload.jdInputSignature,
  experienceSignature: payload.experienceSignature,
  ...(payload.evaluationSignature
    ? { evaluationSignature: payload.evaluationSignature }
    : {}),
  ...(payload.targetRoleSignature
    ? { targetRoleSignature: payload.targetRoleSignature }
    : {}),
  result: payload.result,
  itemSignatures: payload.itemSignatures,
  experienceText: payload.experienceText,
  inputMode: payload.inputMode,
  attachmentName: payload.attachmentName,
  attachmentExtractedText: payload.attachmentExtractedText,
  ...(typeof payload.evaluationIsOutdated === "boolean"
    ? { evaluationIsOutdated: payload.evaluationIsOutdated }
    : {}),
  isOutdated: false,
  updatedAt,
});

export const resolvePersistedAttachmentFields = ({
  snapshot,
  hasCurrentFile,
  attachmentSupplementalJdText,
  extractedAttachmentText,
  shouldPersistAttachmentAsText,
}: {
  snapshot: Pick<
    JDAnalyzeRequestSnapshot,
    "jdText" | "jdInputSignature" | "inputMode" | "attachmentName" | "attachmentExtractedText"
  >;
  hasCurrentFile: boolean;
  attachmentSupplementalJdText: string;
  extractedAttachmentText: string;
  shouldPersistAttachmentAsText: boolean;
}): PersistedAttachmentFields => {
  if (shouldPersistAttachmentAsText) {
    const supplementalJdText = hasCurrentFile
      ? attachmentSupplementalJdText.trim()
      : snapshot.jdText.trim();
    const jdText = supplementalJdText
      ? `${extractedAttachmentText}${JD_ATTACHMENT_SUPPLEMENT_PREFIX}${supplementalJdText}`
      : extractedAttachmentText;
    return {
      jdText,
      jdInputSignature: buildJDInputSignature(jdText, null),
      inputMode: "text",
      attachmentName: undefined,
      attachmentExtractedText: extractedAttachmentText,
    };
  }

  return {
    jdText: snapshot.jdText,
    jdInputSignature: snapshot.jdInputSignature,
    inputMode: snapshot.inputMode,
    attachmentName: snapshot.attachmentName,
    attachmentExtractedText:
      snapshot.inputMode === "text"
        ? snapshot.attachmentExtractedText ?? undefined
        : undefined,
  };
};
