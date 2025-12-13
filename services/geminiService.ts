import { GoogleGenAI, Type, Modality } from "@google/genai";
import { ScriptScene } from "../types";

const apiKey = process.env.API_KEY || '';
const ai = new GoogleGenAI({ apiKey });

export const generateScript = async (prompt: string): Promise<ScriptScene[]> => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `Create a video script based on this story prompt: "${prompt}". 
      Break it down into 3 to 6 key scenes. 
      For each scene, provide a detailed 'visualDescription' optimized for an AI image generator (photorealistic, cinematic), 
      and a 'narration' script for a voiceover artist. 
      Estimate duration in seconds (usually 5-10s based on word count).`,
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
};

export const generateSceneImage = async (visualDescription: string, style: string): Promise<string> => {
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

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        return `data:image/png;base64,${part.inlineData.data}`;
      }
    }
    throw new Error("No image data found in response");
  } catch (error) {
    console.error("Image generation failed:", error);
    throw error;
  }
};

export const generateNarration = async (text: string): Promise<string> => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Fenrir' }, // Deep, cinematic voice
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
};

// Helper to decode base64 audio to AudioBuffer
export const decodeAudioData = async (base64Data: string, context: AudioContext): Promise<AudioBuffer> => {
  const binaryString = atob(base64Data);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return await context.decodeAudioData(bytes.buffer);
};