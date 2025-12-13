import { GoogleGenAI, Type, Modality } from "@google/genai";
import { ScriptScene } from "../types";

const apiKey = process.env.API_KEY || '';
const ai = new GoogleGenAI({ apiKey });

// Helper for delays
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Retry wrapper for API calls
async function withRetry<T>(operation: () => Promise<T>, retries = 10, delayMs = 5000, context = ""): Promise<T> {
  try {
    return await operation();
  } catch (error: any) {
    const errorStr = JSON.stringify(error) + (error.message || '');
    const isRateLimit = errorStr.includes('429') || 
                        errorStr.includes('quota') || 
                        errorStr.includes('RESOURCE_EXHAUSTED') ||
                        (error.status === 429);
    
    if (isRateLimit && retries > 0) {
      console.warn(`[${context}] Rate limit hit. Retrying in ${delayMs}ms... (${retries} retries left)`);
      await wait(delayMs);
      return withRetry(operation, retries - 1, delayMs * 2, context);
    }
    throw error;
  }
}

export const generateScript = async (prompt: string): Promise<ScriptScene[]> => {
  return withRetry(async () => {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: `Create a video script based on this story prompt: "${prompt}". 
        Break it down into 7 to 12 distinct scenes. 
        Ensure the pacing is engaging and dynamic to attract and retain viewer attention.
        For each scene, provide a detailed 'visualDescription' optimized for an AI image generator (photorealistic, cinematic, safe for work, avoid violence/gore), 
        and a 'narration' script for a voiceover artist. 
        Estimate duration in seconds (usually 4-8s per scene).`,
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
              },
              required: ["id", "visualDescription", "narration", "durationEstimate"],
            },
          },
        },
      });

      if (response.text) {
        return JSON.parse(response.text) as ScriptScene[];
      }
      throw new Error("No script generated");
    } catch (error) {
      console.error("Script generation failed:", error);
      throw error;
    }
  }, 5, 5000, "Generate Script");
};

export const generateSceneImage = async (visualDescription: string, style: string): Promise<string> => {
  return withRetry(async () => {
    try {
      // Construct prompt with style instruction
      const prompt = `${style} style. High quality, detailed, 8k resolution. ${visualDescription}`;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
          parts: [
            {
              text: prompt,
            },
          ],
        },
        config: {
          // No responseMimeType for image generation on this model
          imageConfig: {
            aspectRatio: "9:16", 
          }
        }
      });

      // Iterate through all parts to find the image
      const parts = response.candidates?.[0]?.content?.parts || [];
      for (const part of parts) {
        if (part.inlineData && part.inlineData.data) {
          const mimeType = part.inlineData.mimeType || 'image/png';
          return `data:${mimeType};base64,${part.inlineData.data}`;
        }
      }

      // If no image found, check for text refusal/explanation
      const textPart = parts.find(p => p.text)?.text;
      if (textPart) {
          throw new Error(`Image generation failed/refused: ${textPart}`);
      }

      // Check if candidates exist at all
      if (!response.candidates || response.candidates.length === 0) {
          throw new Error("No response candidates returned from API.");
      }

      throw new Error("No image data found in response (Safety filter likely triggered)");
    } catch (error) {
      console.error("Image generation failed:", error);
      throw error;
    }
  }, 10, 8000, "Generate Image"); 
};

export const generateNarration = async (text: string, voiceName: string = 'Fenrir'): Promise<string> => {
  return withRetry(async () => {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName }, 
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Audio) {
        return base64Audio;
      }
      throw new Error("No audio data generated");
    } catch (error) {
      console.error("TTS generation failed:", error);
      throw error;
    }
  }, 10, 5000, "Generate TTS");
};

// Helper to decode base64 audio to AudioBuffer
export const decodeAudioData = async (base64Data: string, context: AudioContext): Promise<AudioBuffer> => {
  const binaryString = atob(base64Data);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  
  // Gemini TTS returns raw PCM (16-bit signed integer, 24kHz, mono)
  const sampleRate = 24000;
  
  // Ensure we have an even number of bytes for Int16Array
  const dataLen = len % 2 === 0 ? len : len - 1;
  const dataInt16 = new Int16Array(bytes.buffer, 0, dataLen / 2);
  
  const audioBuffer = context.createBuffer(1, dataInt16.length, sampleRate);
  const channelData = audioBuffer.getChannelData(0);
  
  // Normalize Int16 to Float32 [-1.0, 1.0]
  for (let i = 0; i < dataInt16.length; i++) {
    channelData[i] = dataInt16[i] / 32768.0;
  }
  
  return audioBuffer;
};