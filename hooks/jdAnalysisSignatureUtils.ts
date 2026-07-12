import type { JDAnalysisItemSignatures } from "../types/analysis";
import type {
  CertificationView,
  ResumeJDAnalysis,
  ResumeExperienceView,
  SkillGroupView,
} from "../types/resume";
import {
  buildExperienceAnalyzeEntry,
  buildJDTextSignature,
  buildResumeAISnapshot,
} from "../utils/resumeHelpers";
import { canonicalStringify } from "../utils/canonicalStringify";

export { canonicalStringify } from "../utils/canonicalStringify";

export const JD_ATTACHMENT_SUPPLEMENT_PREFIX = "\n\n补充 JD 说明：\n";

const buildExperienceAnalyzePayload = (experiences: ResumeExperienceView[]) => ({
  experiences: experiences.map(buildExperienceAnalyzeEntry),
});

export const buildAnalyzePayload = (
  experiences: ResumeExperienceView[],
  certifications: CertificationView[],
  skillGroups: SkillGroupView[]
) => buildResumeAISnapshot(experiences, certifications, skillGroups);

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
  skillGroups: SkillGroupView[]
) => {
  const payload = buildAnalyzePayload(experiences, certifications, skillGroups);
  return canonicalStringify({
    experiences: sortById(payload.experiences),
    certifications: sortById(payload.certifications),
    skills: sortById(payload.skills),
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
