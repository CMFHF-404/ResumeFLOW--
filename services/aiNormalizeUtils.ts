import type {
    JDCapabilityAnalysis,
    JDAnalysisResult,
    JDInterpretation,
    RawJDAnalysisResult,
} from '../types/ai';

export type { RawJDAnalysisResult } from '../types/ai';

export const normalizeJDAnalysisResult = (result: RawJDAnalysisResult): JDAnalysisResult => {
    const extractedJdText = typeof result.extractedJdText === 'string'
        ? result.extractedJdText
        : typeof result.extracted_jd_text === 'string'
            ? result.extracted_jd_text
            : undefined;
    const jdInterpretation = result.jdInterpretation && typeof result.jdInterpretation === 'object'
        ? result.jdInterpretation
        : result.jd_interpretation && typeof result.jd_interpretation === 'object'
            ? (result.jd_interpretation as JDInterpretation)
            : undefined;
    const capabilityAnalysis = result.capabilityAnalysis && typeof result.capabilityAnalysis === 'object'
        ? result.capabilityAnalysis
        : result.capability_analysis && typeof result.capability_analysis === 'object'
            ? (result.capability_analysis as JDCapabilityAnalysis)
            : undefined;
    return {
        ...result,
        ...(extractedJdText ? { extractedJdText } : {}),
        ...(jdInterpretation ? { jdInterpretation } : {}),
        ...(capabilityAnalysis ? { capabilityAnalysis } : {}),
    };
};
