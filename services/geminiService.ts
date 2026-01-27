
import { GoogleGenAI, Type, Modality } from "@google/genai";
import { ScriptScene } from "../types";

// Always use the direct reference to process.env.API_KEY for initialization as per guidelines.
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// Helper for delays
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Retry wrapper for API calls
async function withRetry<T>(operation: () => Promise<T>, retries = 12, delayMs = 3000, context = ""): Promise<T> {
  try {
    return await operation();
  } catch (error: any) {
    const errorStr = (error?.message || '') + JSON.stringify(error || {});
    
    // Check for Rate Limits (429) OR Internal Server Errors (500, 502, 503, 504)
    const isTransientError = 
      errorStr.includes('429') || 
      errorStr.includes('quota') || 
      errorStr.includes('RESOURCE_EXHAUSTED') ||
      errorStr.includes('500') ||
      errorStr.includes('502') ||
      errorStr.includes('503') ||
      errorStr.includes('504') ||
      errorStr.includes('INTERNAL') ||
      (error.status >= 500 && error.status <= 504) ||
      (error.status === 429);
    
    if (isTransientError && retries > 0) {
      console.warn(`[${context}] Transient error encountered (${error.status || 'Internal'}). Retrying in ${delayMs}ms... (${retries} retries left)`);
      await wait(delayMs);
      // Exponential backoff
      return withRetry(operation, retries - 1, delayMs * 1.5, context);
    }
    
    console.error(`[${context}] Fatal error after retries:`, error);
    throw error;
  }
}

export const generateScript = async (prompt: string): Promise<ScriptScene[]> => {
  return withRetry(async () => {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-pro-preview",
        contents: `Create a cinematic, highly engaging video script for: "${prompt}". 
        The script must be long and detailed, broken down into 15 to 22 distinct scenes. 
        
        CRITICAL REQUIREMENTS:
        1. THE HOOK: The first scene (0-5 seconds) MUST contain a "Strong Hook" (isHook: true).
        2. STORYTELLING: Follow a complex narrative arc.
        3. DIVERSITY: Assign a unique 'transitionType' for every scene.
        
        For each scene, provide:
        - 'visualDescription': A cinematic art-director prompt.
        - 'narration': Story-driven text. (max 20 words).
        - 'durationEstimate': 3-6 seconds.
        - 'transitionType': Choose from ['fade', 'slide', 'zoom', 'blur', 'dissolve'].
        - 'isHook': True only for the first scene.`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.INTEGER },
                visualDescription: { type: Type.STRING },
                narration: { type: Type.STRING },
                durationEstimate: { type: Type.NUMBER },
                transitionType: { type: Type.STRING },
                isHook: { type: Type.BOOLEAN },
              },
              required: ["id", "visualDescription", "narration", "durationEstimate", "transitionType"],
            },
          },
        },
      });

      // Directly use .text property to access the response body
      if (response.text) {
        return JSON.parse(response.text) as ScriptScene[];
      }
      throw new Error("No script generated");
    } catch (error) {
      throw error;
    }
  }, 5, 5000, "Generate Script");
};

export const generateSceneImage = async (visualDescription: string, style: string): Promise<string> => {
  return withRetry(async () => {
    try {
      const prompt = `Act as a world-class cinematic art director. Generate a visually stunning image in ${style} style. Scene: ${visualDescription}. Lighting: Cinematic. 8k, photorealistic, no text.`;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
          parts: [{ text: prompt }],
        },
        config: {
          imageConfig: { aspectRatio: "9:16" }
        }
      });

      if (!response.candidates?.[0]) throw new Error("No response candidates.");
      const parts = response.candidates[0].content?.parts || [];
      for (const part of parts) {
        // Iterate through all parts to find the image part as per guidelines
        if (part.inlineData?.data) {
          const mimeType = part.inlineData.mimeType || 'image/png';
          return `data:${mimeType};base64,${part.inlineData.data}`;
        }
      }
      throw new Error("No image data.");
    } catch (error) {
      throw error;
    }
  }, 10, 5000, "Generate Image"); 
};

export const generateNarration = async (text: string, voiceId: string = 'Fenrir'): Promise<string> => {
  return withRetry(async () => {
    try {
      if (!text || text.trim().length === 0) throw new Error("Empty text.");

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: text.trim() }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { 
              prebuiltVoiceConfig: { voiceName: voiceId } 
            },
          },
        },
      });

      const candidate = response.candidates?.[0];
      if (!candidate) throw new Error("No candidate.");
      
      const parts = candidate.content?.parts || [];
      for (const part of parts) {
        if (part.inlineData?.data) {
          return part.inlineData.data;
        }
      }

      throw new Error("No audio data.");
    } catch (error) {
      throw error;
    }
  }, 12, 4000, "Generate TTS");
};

export const decodeAudioData = async (base64Data: string, context: AudioContext): Promise<AudioBuffer> => {
  const binaryString = atob(base64Data);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
  const sampleRate = 24000;
  const dataLen = len % 2 === 0 ? len : len - 1;
  // Manual raw PCM decoding logic
  const dataInt16 = new Int16Array(bytes.buffer, 0, dataLen / 2);
  const audioBuffer = context.createBuffer(1, dataInt16.length, sampleRate);
  const channelData = audioBuffer.getChannelData(0);
  for (let i = 0; i < dataInt16.length; i++) channelData[i] = dataInt16[i] / 32768.0;
  return audioBuffer;
};
