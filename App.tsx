
import React, { useState, useRef, useEffect } from 'react';
import { Play, Pause, Download, Video, Loader2, Music, Wand2, Plus, Film, ChevronRight, Palette, RefreshCw, Upload, Mic, Image as ImageIcon, Clock, AlertCircle, Settings2, Sparkles } from 'lucide-react';
import { generateScript, generateSceneImage, generateNarration, decodeAudioData } from './services/geminiService';
import VideoCanvas, { VideoCanvasHandle } from './components/VideoCanvas';
import { ScriptScene, GeneratedAsset, AppState } from './types';

const ART_STYLES = [
  { id: 'Cinematic', label: 'Cinematic', icon: '🎬' },
  { id: 'Photorealistic', label: 'Realism', icon: '📸' },
  { id: 'Anime', label: 'Anime', icon: '🎌' },
  { id: 'Cyberpunk', label: 'Cyberpunk', icon: '🤖' },
  { id: 'Watercolor', label: 'Watercolor', icon: '🎨' },
  { id: 'Vintage', label: 'Vintage', icon: '🎞️' },
  { id: '3D Render', label: '3D Render', icon: '🧊' },
  { id: 'Oil Painting', label: 'Oil Painting', icon: '🖼️' },
];

const VOICE_ACTORS = [
    { id: 'Fenrir', label: 'Fenrir (Deep & Cinematic)', gender: 'Male' },
    { id: 'Kore', label: 'Kore (Calm & Narrative)', gender: 'Female' },
    { id: 'Puck', label: 'Puck (Energetic & Sharp)', gender: 'Male' },
    { id: 'Zephyr', label: 'Zephyr (Balanced & Clear)', gender: 'Female' },
    { id: 'Charon', label: 'Charon (Gravelly & Mature)', gender: 'Male' },
];

const TRANSITION_TYPES = ['fade', 'slide', 'zoom', 'blur', 'dissolve'] as const;

const createAmbientMusicBuffer = (ctx: AudioContext, duration: number = 60): AudioBuffer => {
    const sampleRate = ctx.sampleRate;
    const buffer = ctx.createBuffer(2, sampleRate * duration, sampleRate);
    const channelL = buffer.getChannelData(0);
    const channelR = buffer.getChannelData(1);
    
    const freqs = [110, 164.8, 196, 220, 329.6]; 
    
    for (let i = 0; i < buffer.length; i++) {
        const t = i / sampleRate;
        let sample = 0;
        freqs.forEach((f, idx) => {
             const amp = 0.05 * Math.sin(t * (0.1 + idx * 0.05)); 
             sample += Math.sin(t * f * 2 * Math.PI) * (0.05 + amp);
        });
        
        let envelope = 1;
        if (t < 2) envelope = t / 2;
        if (t > duration - 2) envelope = (duration - t) / 2;

        channelL[i] = sample * envelope;
        channelR[i] = sample * envelope * 0.95; 
    }
    return buffer;
};

function App() {
  const [state, setState] = useState<AppState>({
    step: 'prompt',
    prompt: '',
    artStyle: 'Cinematic',
    voice: 'Fenrir',
    scenes: [],
    assets: {},
    backgroundMusic: null,
    backgroundMusicBuffer: null,
  });

  const [isLoading, setIsLoading] = useState(false); 
  const [loadingStatus, setLoadingStatus] = useState('');
  const [playbackProgress, setPlaybackProgress] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [currentSceneIndex, setCurrentSceneIndex] = useState(0);
  
  const videoRef = useRef<VideoCanvasHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
        if (isExporting) {
            e.preventDefault();
            e.returnValue = ''; 
            return ''; 
        }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isExporting]);

  const generateAmbientMusic = () => {
    try {
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const buffer = createAmbientMusicBuffer(ctx, 120); 
        setState(prev => ({ 
            ...prev, 
            backgroundMusic: new File([], "Auto-Generated Ambient.mp3"),
            backgroundMusicBuffer: buffer 
        }));
        ctx.close();
    } catch (e) {
        console.error("Failed to generate ambient music", e);
    }
  };

  const loadAssets = async (scenesToLoad: ScriptScene[]) => {
    setIsLoading(true);
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();

    if (!state.backgroundMusicBuffer) {
        setLoadingStatus('Composing background music...');
        const buffer = createAmbientMusicBuffer(audioContext, 120);
        setState(prev => ({ 
            ...prev, 
            backgroundMusic: new File([], "Auto-Generated Cinematic Drone"),
            backgroundMusicBuffer: buffer 
        }));
    }

    const processScene = async (sceneId: number, assets: Record<number, GeneratedAsset>) => {
        const scene = state.scenes.find(s => s.id === sceneId);
        if (!scene) return;
        if (assets[scene.id]?.status === 'completed') return assets[scene.id];

        setLoadingStatus(`Creating Scene ${scene.id}...`);
        
        assets[scene.id] = { sceneId: scene.id, status: 'loading' };
        setState(prev => ({ ...prev, assets: { ...assets } }));

        try {
            const imgBase64 = await generateSceneImage(scene.visualDescription, state.artStyle);
            await new Promise(resolve => setTimeout(resolve, 1000));
            const audioBase64 = await generateNarration(scene.narration, state.voice);

            const img = new Image();
            img.src = imgBase64;
            await new Promise((resolve, reject) => { 
                img.onload = resolve; 
                img.onerror = () => reject(new Error("Image Load Failed"));
            });

            const audioBuffer = await decodeAudioData(audioBase64, audioContext);

            // CRITICAL: Update scene duration to match the narration audio perfectly
            // This ensures no overlapping and that every word is heard clearly.
            // We add a tiny buffer (0.2s) for natural pacing.
            const narrationDuration = audioBuffer.duration + 0.2;
            
            setState(prev => ({
              ...prev,
              scenes: prev.scenes.map(s => s.id === sceneId ? { ...s, durationEstimate: Math.max(s.durationEstimate, narrationDuration) } : s)
            }));

            const completedAsset: GeneratedAsset = {
              sceneId: scene.id,
              imageUrl: imgBase64,
              audioUrl: `data:audio/mp3;base64,${audioBase64}`,
              audioBuffer: audioBuffer,
              imageElement: img,
              status: 'completed'
            };
            
            assets[scene.id] = completedAsset;
            setState(prev => ({ ...prev, assets: { ...assets } }));
            return completedAsset;
        } catch (err) {
            console.error(`Asset failed for Scene ${scene.id}:`, err);
            assets[scene.id] = { sceneId: scene.id, status: 'error' };
            setState(prev => ({ ...prev, assets: { ...assets } }));
            throw err;
        }
    };

    try {
      const currentAssets = { ...state.assets };
      for (const s of scenesToLoad) {
          if (!currentAssets[s.id]) currentAssets[s.id] = { sceneId: s.id, status: 'pending' };
      }
      setState(prev => ({ ...prev, assets: { ...currentAssets } }));

      for (let i = 0; i < scenesToLoad.length; i++) {
        const scene = scenesToLoad[i];
        try {
            await processScene(scene.id, currentAssets);
            if (i < scenesToLoad.length - 1) await new Promise(resolve => setTimeout(resolve, 3000));
        } catch (e) {
            console.warn(`Retrying failed scene ${scene.id}...`);
            await new Promise(resolve => setTimeout(resolve, 5000));
            try {
                await processScene(scene.id, currentAssets);
            } catch (innerE) {
                console.error(`Scene ${scene.id} failed after local retry.`);
            }
        }
      }
    } finally {
      setIsLoading(false);
      setLoadingStatus('');
      if (audioContext.state !== 'closed') audioContext.close();
    }
  };

  const handleGenerateScript = async () => {
    if (!state.prompt) return;
    setIsLoading(true);
    setLoadingStatus('Writing script with Gemini AI...');
    try {
      const scenes = await generateScript(state.prompt);
      setState(prev => ({ ...prev, scenes, step: 'script' }));
    } catch (e) {
      alert('Failed to generate script. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleGenerateAssets = async () => {
    setState(prev => ({ ...prev, step: 'assets' }));
    await loadAssets(state.scenes);
    setState(prev => ({ ...prev, step: 'editor' }));
  };

  const handleRegenerateImage = async (sceneId: number) => {
    const scene = state.scenes.find(s => s.id === sceneId);
    if (!scene) return;
    setState(prev => ({ ...prev, assets: { ...prev.assets, [sceneId]: { ...prev.assets[sceneId], status: 'loading' } } }));
    try {
      const imgBase64 = await generateSceneImage(scene.visualDescription, state.artStyle);
      const img = new Image();
      img.src = imgBase64;
      await new Promise((resolve, reject) => { 
        img.onload = resolve; 
        img.onerror = () => reject(new Error("Image Load Failed"));
      });
      setState(prev => ({ ...prev, assets: { ...prev.assets, [sceneId]: { ...prev.assets[sceneId], imageUrl: imgBase64, imageElement: img, status: 'completed' } } }));
    } catch (e) {
      alert(`Image Error: ${e}`);
      setState(prev => ({ ...prev, assets: { ...prev.assets, [sceneId]: { ...prev.assets[sceneId], status: 'error' } } }));
    }
  };

  const handleRegenerateAudio = async (sceneId: number) => {
    const scene = state.scenes.find(s => s.id === sceneId);
    if (!scene) return;
    setState(prev => ({ ...prev, assets: { ...prev.assets, [sceneId]: { ...prev.assets[sceneId], status: 'loading' } } }));
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    try {
      const audioBase64 = await generateNarration(scene.narration, state.voice);
      const audioBuffer = await decodeAudioData(audioBase64, audioContext);
      
      // Update duration
      const narrationDuration = audioBuffer.duration + 0.2;
      setState(prev => ({
        ...prev,
        scenes: prev.scenes.map(s => s.id === sceneId ? { ...s, durationEstimate: Math.max(s.durationEstimate, narrationDuration) } : s),
        assets: { ...prev.assets, [sceneId]: { ...prev.assets[sceneId], audioUrl: `data:audio/mp3;base64,${audioBase64}`, audioBuffer: audioBuffer, status: 'completed' } }
      }));
    } catch (e) {
      alert(`Audio Error: ${e}`);
      setState(prev => ({ ...prev, assets: { ...prev.assets, [sceneId]: { ...prev.assets[sceneId], status: 'error' } } }));
    } finally {
      audioContext.close();
    }
  };

  const handleUpdateTransition = (sceneId: number, type: ScriptScene['transitionType']) => {
    setState(prev => ({
      ...prev,
      scenes: prev.scenes.map(s => s.id === sceneId ? { ...s, transitionType: type } : s)
    }));
  };

  const handleUpdateVisualDescription = (sceneId: number, description: string) => {
    setState(prev => ({
      ...prev,
      scenes: prev.scenes.map(s => s.id === sceneId ? { ...s, visualDescription: description } : s)
    }));
  };

  const handleMusicUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const arrayBuffer = await file.arrayBuffer();
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      setState(prev => ({ ...prev, backgroundMusic: file, backgroundMusicBuffer: audioBuffer }));
      audioContext.close();
    }
  };

  const togglePlay = () => {
    if (isPlaying) videoRef.current?.pause();
    else videoRef.current?.play();
    setIsPlaying(!isPlaying);
  };

  const handleDownload = () => {
    setIsExporting(true);
    setTimeout(() => {
        videoRef.current?.record();
        setIsPlaying(true);
    }, 100);
  };

  const onPlaybackEnd = () => {
      setIsPlaying(false);
      setIsExporting(false);
  };

  const activeScene = state.scenes[currentSceneIndex];
  const hasErrors = (Object.values(state.assets) as GeneratedAsset[]).some(a => a.status === 'error');

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100 flex flex-col">
      <header className="border-b border-zinc-800 bg-[#09090b]/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-gradient-to-tr from-blue-500 to-purple-500 p-2 rounded-lg">
                <Video className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-xl tracking-tight">Gemini<span className="text-blue-400">Director</span></span>
          </div>
          <div className="flex items-center gap-4 text-sm text-zinc-400">
            <span className={state.step === 'prompt' ? 'text-blue-400' : ''}>1. Prompt</span>
            <ChevronRight className="w-4 h-4" />
            <span className={state.step === 'script' ? 'text-blue-400' : ''}>2. Script</span>
            <ChevronRight className="w-4 h-4" />
            <span className={state.step === 'assets' || state.step === 'editor' ? 'text-blue-400' : ''}>3. Create</span>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full p-6 flex flex-col items-center justify-center">
        {state.step === 'prompt' && (
          <div className="w-full max-w-2xl text-center space-y-8 animate-in fade-in slide-in-from-bottom-8 duration-700">
            <div className="space-y-4">
              <h1 className="text-5xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-b from-white to-zinc-400">
                Turn your stories into video.
              </h1>
              <p className="text-xl text-zinc-400">AI-powered scriptwriting, imaging, and narration.</p>
            </div>
            <div className="relative group">
              <div className="absolute -inset-0.5 bg-gradient-to-r from-blue-500 to-purple-600 rounded-xl blur opacity-30 group-hover:opacity-75 transition duration-500"></div>
              <div className="relative bg-zinc-900 rounded-xl p-2 flex gap-2">
                <textarea
                  className="w-full bg-transparent border-none focus:ring-0 text-lg p-4 min-h-[120px] resize-none placeholder-zinc-500 text-white"
                  placeholder="Describe your story idea..."
                  value={state.prompt}
                  onChange={(e) => setState(prev => ({...prev, prompt: e.target.value}))}
                />
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-center gap-2 text-sm font-medium text-zinc-400 mb-2">
                <Palette className="w-4 h-4" /><span>Choose Visual Style</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                {ART_STYLES.map((style) => (
                  <button key={style.id} onClick={() => setState(prev => ({...prev, artStyle: style.id}))}
                    className={`flex items-center justify-center gap-2 px-4 py-3 rounded-lg border transition-all ${state.artStyle === style.id ? 'bg-blue-600/20 border-blue-500 text-white ring-1 ring-blue-500' : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-600'}`}>
                    <span>{style.icon}</span><span>{style.label}</span>
                  </button>
                ))}
              </div>
            </div>
            <button onClick={handleGenerateScript} disabled={!state.prompt || isLoading}
              className="bg-white text-black px-8 py-4 rounded-full font-semibold text-lg hover:bg-zinc-200 transition-colors disabled:opacity-50 flex items-center gap-2 mx-auto mt-6">
              {isLoading ? <Loader2 className="animate-spin" /> : <Wand2 className="w-5 h-5" />}Generate Script
            </button>
          </div>
        )}

        {state.step === 'script' && (
          <div className="w-full max-w-4xl space-y-6 animate-in fade-in zoom-in-95 duration-500">
            <div className="flex justify-between items-center bg-zinc-900/80 p-6 rounded-2xl border border-zinc-800">
              <div className="space-y-1">
                <h2 className="text-2xl font-bold">Review Script</h2>
                <div className="flex items-center gap-2 text-sm text-zinc-400">
                   <span className="px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-xs flex items-center gap-1">
                     {ART_STYLES.find(s => s.id === state.artStyle)?.icon} {state.artStyle}
                   </span>
                </div>
              </div>
              <div className="flex items-center gap-4">
                  <div className="flex flex-col items-end gap-1">
                      <span className="text-xs text-zinc-400 uppercase tracking-wider font-semibold">Narrator Voice</span>
                      <div className="relative">
                          <select value={state.voice} onChange={(e) => setState(prev => ({...prev, voice: e.target.value}))}
                            className="bg-zinc-950 border border-zinc-700 text-white text-sm rounded-lg block w-48 p-2.5 appearance-none cursor-pointer">
                            {VOICE_ACTORS.map(voice => <option key={voice.id} value={voice.id}>{voice.label}</option>)}
                          </select>
                          <Mic className="absolute right-3 top-2.5 w-4 h-4 text-zinc-400 pointer-events-none" />
                      </div>
                  </div>
                  <button onClick={handleGenerateAssets} disabled={isLoading}
                    className="h-11 bg-blue-600 hover:bg-blue-500 text-white px-6 rounded-lg font-medium flex items-center gap-2 transition-colors">
                    {isLoading ? <Loader2 className="animate-spin w-4 h-4" /> : <Film className="w-4 h-4" />}Generate Video
                  </button>
              </div>
            </div>
            <div className="grid gap-4">
              {state.scenes.map((scene) => (
                <div key={scene.id} className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
                  <div className="flex items-start gap-4">
                    <div className="bg-zinc-800 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0">{scene.id}</div>
                    <div className="space-y-3 flex-1">
                      <div><span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Visual</span><p className="text-zinc-300 mt-1">{scene.visualDescription}</p></div>
                      <div className="pt-2 border-t border-zinc-800/50"><span className="text-xs font-semibold uppercase tracking-wider text-blue-400">Narration</span><p className="text-zinc-100 font-medium mt-1">"{scene.narration}"</p></div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {isLoading && state.step !== 'prompt' && (
            <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[60] flex flex-col items-center justify-center p-4">
                <Loader2 className="w-12 h-12 text-blue-500 animate-spin mb-4" />
                <h3 className="text-2xl font-bold text-white mb-2">{loadingStatus}</h3>
                <p className="text-zinc-400">Automated retry logic is active to bypass server fluctuations...</p>
            </div>
        )}

        {state.step === 'editor' && (
          <div className="w-full max-w-6xl grid grid-cols-1 lg:grid-cols-3 gap-8 animate-in fade-in duration-700">
            <div className="lg:col-span-2 space-y-4">
                <div className="flex justify-center bg-black/50 rounded-xl p-4 border border-zinc-800/50 relative">
                    <VideoCanvas ref={videoRef} scenes={state.scenes} assets={state.assets} bgMusicBuffer={state.backgroundMusicBuffer} width={720} height={1280}
                        onProgress={(curr, total, sceneIdx) => { setPlaybackProgress((curr/total) * 100); setCurrentSceneIndex(sceneIdx); }}
                        onPlaybackEnd={onPlaybackEnd} />
                    {isExporting && (
                        <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center backdrop-blur-sm rounded-xl z-20">
                            <Loader2 className="w-12 h-12 text-blue-500 animate-spin mb-4" />
                            <div className="bg-black/90 px-8 py-6 rounded-2xl border border-blue-500/30 flex flex-col items-center max-w-md text-center">
                                <span className="text-white font-bold text-xl mb-1">Analyzing & Exporting</span>
                                <span className="text-blue-400 font-mono tracking-wider text-sm mb-3 uppercase">Scene {currentSceneIndex + 1} of {state.scenes.length}</span>
                            </div>
                        </div>
                    )}
                </div>
                <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800 flex flex-col gap-4">
                    <div className="w-full bg-zinc-800 h-1.5 rounded-full overflow-hidden">
                        <div className="bg-blue-500 h-full transition-all duration-100 ease-linear" style={{ width: `${playbackProgress}%` }} />
                    </div>
                    <div className="flex justify-between items-center">
                        <button onClick={togglePlay} disabled={isExporting} className="w-10 h-10 flex items-center justify-center rounded-full bg-white text-black">
                            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
                        </button>
                        <button onClick={handleDownload} disabled={isExporting || hasErrors} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
                            {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                            <span>{isExporting ? 'Exporting...' : 'Export Video'}</span>
                        </button>
                    </div>
                </div>
            </div>

            <div className="space-y-4 flex flex-col min-h-0">
                {hasErrors && (
                    <div className="bg-red-500/10 border border-red-500/50 p-4 rounded-xl flex items-center gap-3">
                        <AlertCircle className="text-red-500 w-5 h-5 shrink-0" />
                        <div className="flex-1">
                            <p className="text-xs font-bold text-red-400">Some scenes failed.</p>
                            <button onClick={() => loadAssets(state.scenes)} className="text-[10px] text-red-500 underline hover:text-red-400">Retry missing assets</button>
                        </div>
                    </div>
                )}

                {activeScene && (
                    <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-4 shadow-lg animate-in fade-in slide-in-from-right-4 space-y-4">
                        <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                            <Settings2 className="w-3 h-3" /> Scene {activeScene.id} Editor
                        </h3>
                        
                        <div>
                            <label className="text-[10px] text-zinc-400 uppercase font-bold block mb-1.5">Visual Description</label>
                            <textarea 
                                value={activeScene.visualDescription}
                                onChange={(e) => handleUpdateVisualDescription(activeScene.id, e.target.value)}
                                className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-xs text-zinc-200 focus:ring-1 focus:ring-blue-500 outline-none transition-colors hover:border-zinc-700 min-h-[80px] resize-none"
                                placeholder="Edit the visual details for this scene..."
                            />
                            <button 
                                onClick={() => handleRegenerateImage(activeScene.id)}
                                disabled={state.assets[activeScene.id]?.status === 'loading'}
                                className="mt-2 w-full flex items-center justify-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-white px-3 py-2 rounded text-[10px] font-bold uppercase tracking-wider transition-all disabled:opacity-50"
                            >
                                {state.assets[activeScene.id]?.status === 'loading' ? (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                    <Sparkles className="w-3 h-3 text-blue-400" />
                                )}
                                Regenerate Image
                            </button>
                        </div>

                        <div>
                            <label className="text-[10px] text-zinc-400 uppercase font-bold block mb-1.5">Transition to Next</label>
                            <select 
                                value={activeScene.transitionType || 'fade'}
                                onChange={(e) => handleUpdateTransition(activeScene.id, e.target.value as any)}
                                className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-xs text-white focus:ring-1 focus:ring-blue-500 outline-none transition-colors hover:border-zinc-700"
                            >
                                {TRANSITION_TYPES.map(t => (
                                    <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                )}

                <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4">
                    <h3 className="font-semibold text-xs mb-3 flex items-center justify-between text-zinc-400 uppercase tracking-wider">
                        <div className="flex items-center gap-2"><Music className="w-3.5 h-3.5" /><span>Audio Track</span></div>
                        <button onClick={generateAmbientMusic} className="text-[9px] text-blue-500 hover:text-blue-400 flex items-center gap-1 font-bold"><Wand2 className="w-2.5 h-2.5" /> AUTO-GEN</button>
                    </h3>
                    <input type="file" ref={fileInputRef} accept="audio/*" onChange={handleMusicUpload} className="hidden" />
                    <button onClick={() => fileInputRef.current?.click()} className="w-full border border-dashed border-zinc-800 rounded-lg p-3 text-zinc-400 text-xs flex items-center justify-center gap-2 bg-zinc-950/50">
                        {state.backgroundMusic ? <span className="truncate">{state.backgroundMusic.name}</span> : <><Plus className="w-4 h-4" /><span>Upload BG Music</span></>}
                    </button>
                </div>
                <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4 flex-1 overflow-hidden flex flex-col min-h-0">
                    <h3 className="font-semibold mb-3 text-xs text-zinc-400 uppercase tracking-wider">Project Timeline</h3>
                    <div className="space-y-2 overflow-y-auto pr-1 flex-1">
                        {state.scenes.map((scene, idx) => (
                            <div key={scene.id} className={`group flex gap-3 p-2 rounded border transition-all cursor-pointer ${idx === currentSceneIndex ? 'bg-blue-600/10 border-blue-500/50 ring-1' : 'bg-zinc-950/50 border-zinc-900'}`} onClick={() => setCurrentSceneIndex(idx)}>
                                <div className="relative w-12 h-16 bg-zinc-800 rounded overflow-hidden shrink-0">
                                    {state.assets[scene.id]?.imageUrl ? <img src={state.assets[scene.id].imageUrl} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center bg-zinc-900">{state.assets[scene.id]?.status === 'loading' ? <Loader2 className="w-4 h-4 animate-spin text-zinc-600" /> : <ImageIcon className="w-4 h-4 text-zinc-700" />}</div>}
                                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1">
                                         <button onClick={(e) => { e.stopPropagation(); handleRegenerateImage(scene.id); }} className="p-1 bg-white/10 rounded"><RefreshCw className="w-3 h-3" /></button>
                                         <button onClick={(e) => { e.stopPropagation(); handleRegenerateAudio(scene.id); }} className="p-1 bg-white/10 rounded"><Mic className="w-3 h-3" /></button>
                                    </div>
                                </div>
                                <div className="min-w-0 flex-1 py-1">
                                    <div className="flex justify-between items-center mb-0.5">
                                        <p className={`text-[10px] font-bold ${idx === currentSceneIndex ? 'text-blue-400' : 'text-zinc-500'}`}>SCENE {scene.id}</p>
                                        <div className="flex items-center gap-1 text-[9px] font-mono text-zinc-600"><Clock className="w-2.5 h-2.5" />{scene.durationEstimate.toFixed(1)}s</div>
                                    </div>
                                    <p className="text-[10px] text-zinc-400 line-clamp-2 leading-tight">"{scene.narration}"</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
