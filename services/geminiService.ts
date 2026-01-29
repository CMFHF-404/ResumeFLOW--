import { aiService } from './aiService';

const buildAnalysisFallback = (summary: string) => {
  return JSON.stringify({
    matchPercentage: 0,
    missingKeywords: [],
    summary,
  });
};

export const analyzeJobDescription = async (jdText: string, resumeText: string): Promise<string> => {
  try {
    const result = await aiService.analyzeJD(jdText, resumeText);
    return JSON.stringify(result);
  } catch (error) {
    console.error("AI Analysis Error:", error);
    return buildAnalysisFallback("Analysis failed.");
  }
};

export const polishExperience = async (company: string, role: string, rawText: string): Promise<string> => {
  try {
    const response = await aiService.polishExperience({
      content: {
        company,
        role,
        rawText,
      },
    });
    return JSON.stringify(response ?? {});
  } catch (error) {
    console.error("AI Polish Error:", error);
    return "{}";
  }
}
