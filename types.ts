export interface ScriptScene {
  id: number;
  visualDescription: string;
  narration: string;
  durationEstimate: number; // in seconds
}

export interface GeneratedAsset {
  sceneId: number;
  imageUrl?: string; // Base64 data URI
  audioUrl?: string; // Blob URL or Base64 data URI
  audioBuffer?: AudioBuffer;
  imageElement?: HTMLImageElement;
  status: 'pending' | 'loading' | 'completed' | 'error';
}

export interface VideoState {
  isPlaying: boolean;
  isRecording: boolean;
  currentTime: number;
  totalDuration: number;
}

export interface AppState {
  step: 'prompt' | 'script' | 'assets' | 'editor';
  prompt: string;
  artStyle: string;
  voice: string;
  scenes: ScriptScene[];
  assets: Record<number, GeneratedAsset>;
  backgroundMusic: File | null;
  backgroundMusicBuffer: AudioBuffer | null;
}