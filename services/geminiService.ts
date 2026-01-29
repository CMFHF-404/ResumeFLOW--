import { GoogleGenAI } from "@google/genai";

const apiKey = process.env.API_KEY || '';
const ai = new GoogleGenAI({ apiKey });

export const analyzeJobDescription = async (jdText: string, resumeText: string): Promise<string> => {
  if (!apiKey) return "API Key not configured.";
  
  try {
    const prompt = `
      You are an expert ATS (Applicant Tracking System) analyzer.
      
      Job Description:
      ${jdText}
      
      Resume Content:
      ${resumeText}
      
      Task:
      1. Calculate a match percentage (0-100).
      2. Identify 3 missing keywords from the resume that are crucial in the JD.
      3. Provide a 1-sentence summary of why the match is high or low.
      
      Return ONLY a JSON object with this structure:
      {
        "matchPercentage": number,
        "missingKeywords": string[],
        "summary": string
      }
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: {
        responseMimeType: "application/json"
      }
    });

    return response.text || "{}";
  } catch (error) {
    console.error("Gemini Analysis Error:", error);
    return JSON.stringify({ matchPercentage: 0, missingKeywords: [], summary: "Analysis failed." });
  }
};

export const polishExperience = async (company: string, role: string, rawText: string): Promise<string> => {
   if (!apiKey) return "API Key not configured.";

   try {
    const prompt = `
      You are a professional resume writer.
      
      Context:
      Role: ${role} at ${company}
      Draft input: ${rawText}
      
      Task:
      Rewrite the draft input using the STAR (Situation, Task, Action, Result) method.
      Make it concise, professional, and impact-oriented.
      
      Return ONLY a JSON object:
      {
        "s": "Situation...",
        "t": "Task...",
        "a": "Action...",
        "r": "Result..."
      }
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: {
        responseMimeType: "application/json"
      }
    });
    return response.text || "{}";
   } catch (error) {
     console.error("Gemini Polish Error:", error);
     return "{}";
   }
}
