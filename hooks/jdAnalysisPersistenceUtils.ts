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
  jdInputSignature: string;
  jdText: string;
  experienceText: string;
  inputMode: "text" | "attachment";
  attachmentName?: string;
  attachmentExtractedText?: string;
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

export const buildResumeJDAnalysisPayload = (
  payload: AnalysisStatePayload,
  updatedAt: string = new Date().toISOString()
): ResumeJDAnalysis => ({
  jdText: payload.jdText,
  jdInputSignature: payload.jdInputSignature,
  experienceSignature: payload.experienceSignature,
  result: payload.result,
  itemSignatures: payload.itemSignatures,
  experienceText: payload.experienceText,
  inputMode: payload.inputMode,
  attachmentName: payload.attachmentName,
  attachmentExtractedText: payload.attachmentExtractedText,
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
