import {
  type AnalyzeJDParams,
  type AnalyzeJDWithAttachmentParams,
  type AnalyzeStreamEvent,
  type JDAnalysisResult,
  type JDAnalyzeProgressNode,
} from "../services/aiService";
import type {
  CertificationView,
  ResumeExperienceView,
  SkillGroupView,
} from "../types/resume";
import type {
  JDAnalysisContext,
  JDAnalysisItemSignatures,
} from "../types/analysis";
import { buildAnalyzePayload, canonicalStringify, splitAttachmentDerivedJdText } from "./jdAnalysisSignatureUtils";
import { buildPrevResultPayload, type MatchUpdateMode } from "./jdAnalysisMatchUtils";

export type JDAnalyzeProgressHandler = (node: JDAnalyzeProgressNode) => void;
export type JDAnalyzeStreamHandler = (event: AnalyzeStreamEvent) => void;

export type JDAnalyzeRequestSnapshot = {
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

export type JDAnalysisRequestService = {
  analyzeJD: (
    params: AnalyzeJDParams,
    onEvent?: (event: AnalyzeStreamEvent) => void
  ) => Promise<JDAnalysisResult>;
  analyzeJDWithAttachment: (
    params: AnalyzeJDWithAttachmentParams,
    onEvent?: (event: AnalyzeStreamEvent) => void
  ) => Promise<JDAnalysisResult>;
};

type RunJDAnalysisRequestParams = {
  snapshot: JDAnalyzeRequestSnapshot;
  mode: MatchUpdateMode;
  analysisContext: JDAnalysisContext | null;
  analysisResult: JDAnalysisResult | null;
  onProgress?: JDAnalyzeProgressHandler;
  onEvent?: JDAnalyzeStreamHandler;
  service: JDAnalysisRequestService;
};

export type RunJDAnalysisRequestResult = {
  result: JDAnalysisResult;
  currentFile: File | null;
  attachmentSupplementalJdText: string;
  extractedAttachmentText: string;
  shouldPersistAttachmentAsText: boolean;
  resumeText: string;
  prevExperienceText?: string;
  prevResultPayload?: AnalyzeJDParams["prevResult"];
  shouldUsePrev: boolean;
};

const reportStreamEvent = (
  event: AnalyzeStreamEvent,
  onProgress?: JDAnalyzeProgressHandler,
  onEvent?: JDAnalyzeStreamHandler
) => {
  if (event.type === "progress") {
    onProgress?.(event.node);
  }
  onEvent?.(event);
};

export const runJDAnalysisRequest = async ({
  snapshot,
  mode,
  analysisContext,
  analysisResult,
  onProgress,
  onEvent,
  service,
}: RunJDAnalysisRequestParams): Promise<RunJDAnalysisRequestResult> => {
  const payload = buildAnalyzePayload(
    snapshot.experiences,
    snapshot.certifications,
    snapshot.skillGroups
  );
  const resumeText = canonicalStringify(payload);
  const prevExperienceText =
    mode === "partial" ? analysisContext?.experienceText : undefined;
  const prevResultPayload =
    mode === "partial" ? buildPrevResultPayload(analysisResult) : undefined;
  const shouldUsePrev =
    mode === "partial" && Boolean(prevExperienceText) && Boolean(prevResultPayload);
  const currentFile = snapshot.jdFile;
  const { supplementalText: attachmentSupplementalJdText } =
    splitAttachmentDerivedJdText(
      snapshot.jdText,
      snapshot.attachmentExtractedText
    );
  const handleEvent = (event: AnalyzeStreamEvent) => {
    reportStreamEvent(event, onProgress, onEvent);
  };
  const result = currentFile
    ? await service.analyzeJDWithAttachment({
      file: currentFile,
      jdText: attachmentSupplementalJdText || undefined,
      resumeText,
      experienceText: snapshot.experienceText,
      prevResult: shouldUsePrev ? prevResultPayload : undefined,
      prevExperienceText: shouldUsePrev ? prevExperienceText : undefined,
    }, handleEvent)
    : await service.analyzeJD({
      text: snapshot.jdText,
      resumeText,
      prevResult: shouldUsePrev ? prevResultPayload : undefined,
      experienceText: snapshot.experienceText,
      prevExperienceText: shouldUsePrev ? prevExperienceText : undefined,
    }, handleEvent);
  const extractedAttachmentText = currentFile
    ? result.extractedJdText?.trim() ?? ""
    : "";
  const shouldPersistAttachmentAsText = Boolean(
    currentFile && extractedAttachmentText
  );

  return {
    result,
    currentFile,
    attachmentSupplementalJdText,
    extractedAttachmentText,
    shouldPersistAttachmentAsText,
    resumeText,
    prevExperienceText,
    prevResultPayload,
    shouldUsePrev,
  };
};
