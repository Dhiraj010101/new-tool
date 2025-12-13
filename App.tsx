import React, { useState, useRef, useEffect } from 'react';
import { Play, Pause, Download, Video, Loader2, Music, Wand2, Plus, Film, ChevronRight, Palette, RefreshCw, Upload, Mic, Image as ImageIcon } from 'lucide-react';
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

function App() {
  const [state, setState] = useState<AppState>({
    step: 'prompt',
    prompt: '',
    artStyle: 'Cinematic',
    scenes: [],
    assets: {},
    backgroundMusic: null,
    backgroundMusicBuffer: null,
  });

  const [isLoading, setIsLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState('');
  const [playbackProgress, setPlaybackProgress] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  
  const videoRef = useRef<VideoCanvasHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sceneFileInputRefs = useRef<Record<number, HTMLInputElement | null>>({});

  // Load Image and Audio helper
  const loadAssets = async (scenes: ScriptScene[]) => {
    setIsLoading(true);
    const newAssets = { ...state.assets };
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();

    try {
      for (const scene of scenes) {
        // Skip if already generated
        if (newAssets[scene.id]?.status === 'completed') continue;

        setLoadingStatus(`Generating visuals for Scene ${scene.id}...`);
        
        // Parallel generation for speed within a scene
        const [imgBase64, audioBase64] = await Promise.all([
           generateSceneImage(scene.visualDescription, state.artStyle),
           generateNarration(scene.narration)
        ]);

        // Load Image Element
        const img = new Image();
        img.src = imgBase64;
        await new Promise((resolve) => { img.onload = resolve; });

        // Decode Audio
        const audioBuffer = await decodeAudioData(audioBase64, audioContext);

        newAssets[scene.id] = {
          sceneId: scene.id,
          imageUrl: imgBase64,
          audioUrl: `data:audio/mp3;base64,${audioBase64}`, // Approximation for URL
          audioBuffer: audioBuffer,
          imageElement: img,
          status: 'completed'
        };

        // Update state incrementally so user sees progress
        setState(prev => ({ ...prev, assets: { ...newAssets } }));
      }
    } catch (e) {
      console.error(e);
      alert("Error generating assets. Please try again.");
    } finally {
      setIsLoading(false);
      setLoadingStatus('');
      audioContext.close();
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
      alert('Failed to generate script. Check console.');
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

    setLoadingStatus(`Regenerating visual for Scene ${sceneId}...`);
    setIsLoading(true);

    try {
      const imgBase64 = await generateSceneImage(scene.visualDescription, state.artStyle);
      const img = new Image();
      img.src = imgBase64;
      await new Promise((resolve) => { img.onload = resolve; });

      setState(prev => ({
        ...prev,
        assets: {
          ...prev.assets,
          [sceneId]: {
            ...prev.assets[sceneId],
            imageUrl: imgBase64,
            imageElement: img,
          }
        }
      }));
    } catch (e) {
      alert("Failed to regenerate image");
    } finally {
      setIsLoading(false);
      setLoadingStatus('');
    }
  };

  const handleRegenerateAudio = async (sceneId: number) => {
    const scene = state.scenes.find(s => s.id === sceneId);
    if (!scene) return;

    setLoadingStatus(`Regenerating audio for Scene ${sceneId}...`);
    setIsLoading(true);
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();

    try {
      const audioBase64 = await generateNarration(scene.narration);
      const audioBuffer = await decodeAudioData(audioBase64, audioContext);

      setState(prev => ({
        ...prev,
        assets: {
          ...prev.assets,
          [sceneId]: {
            ...prev.assets[sceneId],
            audioUrl: `data:audio/mp3;base64,${audioBase64}`,
            audioBuffer: audioBuffer,
          }
        }
      }));
    } catch (e) {
      alert("Failed to regenerate audio");
    } finally {
      setIsLoading(false);
      setLoadingStatus('');
      audioContext.close();
    }
  };

  const handleSceneImageUpload = (sceneId: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const result = event.target?.result as string;
        const img = new Image();
        img.src = result;
        img.onload = () => {
          setState(prev => ({
            ...prev,
            assets: {
              ...prev.assets,
              [sceneId]: {
                ...prev.assets[sceneId],
                imageUrl: result,
                imageElement: img,
              }
            }
          }));
        };
      };
      reader.readAsDataURL(file);
    }
  };

  const handleMusicUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const arrayBuffer = await file.arrayBuffer();
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      setState(prev => ({ 
        ...prev, 
        backgroundMusic: file,
        backgroundMusicBuffer: audioBuffer
      }));
      audioContext.close();
    }
  };

  const togglePlay = () => {
    if (isPlaying) {
      videoRef.current?.pause();
    } else {
      videoRef.current?.play();
    }
    setIsPlaying(!isPlaying);
  };

  const handleDownload = () => {
    // Start recording from beginning
    if (confirm("Recording will play the video from start to finish. Please wait for it to complete.")) {
        videoRef.current?.record();
        setIsPlaying(true);
    }
  };

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100 flex flex-col">
      {/* Header */}
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
        
        {/* Step 1: Prompt Input */}
        {state.step === 'prompt' && (
          <div className="w-full max-w-2xl text-center space-y-8 animate-in fade-in slide-in-from-bottom-8 duration-700">
            <div className="space-y-4">
              <h1 className="text-5xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-b from-white to-zinc-400">
                Turn your stories into video.
              </h1>
              <p className="text-xl text-zinc-400">
                AI-powered scriptwriting, image generation, voiceovers, and editing.
              </p>
            </div>
            
            <div className="relative group">
              <div className="absolute -inset-0.5 bg-gradient-to-r from-blue-500 to-purple-600 rounded-xl blur opacity-30 group-hover:opacity-75 transition duration-500"></div>
              <div className="relative bg-zinc-900 rounded-xl p-2 flex gap-2">
                <textarea
                  className="w-full bg-transparent border-none focus:ring-0 text-lg p-4 min-h-[120px] resize-none placeholder-zinc-500 text-white"
                  placeholder="Describe your story idea... (e.g., A cyberpunk detective investigating a neon city in 2077)"
                  value={state.prompt}
                  onChange={(e) => setState(prev => ({...prev, prompt: e.target.value}))}
                />
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-center gap-2 text-sm font-medium text-zinc-400 mb-2">
                <Palette className="w-4 h-4" />
                <span>Choose Visual Style</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                {ART_STYLES.map((style) => (
                  <button
                    key={style.id}
                    onClick={() => setState(prev => ({...prev, artStyle: style.id}))}
                    className={`
                      flex items-center justify-center gap-2 px-4 py-3 rounded-lg border transition-all
                      ${state.artStyle === style.id 
                        ? 'bg-blue-600/20 border-blue-500 text-white ring-1 ring-blue-500' 
                        : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'}
                    `}
                  >
                    <span>{style.icon}</span>
                    <span>{style.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={handleGenerateScript}
              disabled={!state.prompt || isLoading}
              className="bg-white text-black px-8 py-4 rounded-full font-semibold text-lg hover:bg-zinc-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 mx-auto mt-6"
            >
              {isLoading ? <Loader2 className="animate-spin" /> : <Wand2 className="w-5 h-5" />}
              Generate Script
            </button>
          </div>
        )}

        {/* Step 2: Script Review */}
        {state.step === 'script' && (
          <div className="w-full max-w-4xl space-y-6 animate-in fade-in zoom-in-95 duration-500">
            <div className="flex justify-between items-center">
              <div className="space-y-1">
                <h2 className="text-2xl font-bold">Review Script</h2>
                <div className="flex items-center gap-2 text-sm text-zinc-400">
                   <span className="px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-xs">
                     {ART_STYLES.find(s => s.id === state.artStyle)?.icon} {state.artStyle}
                   </span>
                   <span>style selected</span>
                </div>
              </div>
              <button 
                onClick={handleGenerateAssets}
                disabled={isLoading}
                className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-lg font-medium flex items-center gap-2 transition-colors"
              >
                {isLoading ? <Loader2 className="animate-spin w-4 h-4" /> : <Film className="w-4 h-4" />}
                Generate Video
              </button>
            </div>

            <div className="grid gap-4">
              {state.scenes.map((scene) => (
                <div key={scene.id} className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 hover:border-zinc-700 transition-colors">
                  <div className="flex items-start gap-4">
                    <div className="bg-zinc-800 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0">
                      {scene.id}
                    </div>
                    <div className="space-y-3 flex-1">
                      <div>
                        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Visual</span>
                        <p className="text-zinc-300 mt-1">{scene.visualDescription}</p>
                      </div>
                      <div className="pt-2 border-t border-zinc-800/50">
                        <span className="text-xs font-semibold uppercase tracking-wider text-blue-400">Narration</span>
                        <p className="text-zinc-100 font-medium mt-1">"{scene.narration}"</p>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Loading Overlay */}
        {isLoading && state.step !== 'prompt' && (
            <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[60] flex flex-col items-center justify-center p-4">
                <Loader2 className="w-12 h-12 text-blue-500 animate-spin mb-4" />
                <h3 className="text-2xl font-bold text-white mb-2">{loadingStatus}</h3>
                <p className="text-zinc-400">This may take a minute. AI is creating your assets.</p>
            </div>
        )}

        {/* Step 3: Editor & Preview */}
        {state.step === 'editor' && (
          <div className="w-full max-w-6xl grid grid-cols-1 lg:grid-cols-3 gap-8 animate-in fade-in duration-700">
            
            {/* Main Player Area */}
            <div className="lg:col-span-2 space-y-4">
                <div className="flex justify-center bg-black/50 rounded-xl p-4 border border-zinc-800/50">
                    <VideoCanvas 
                        ref={videoRef}
                        scenes={state.scenes}
                        assets={state.assets}
                        bgMusicBuffer={state.backgroundMusicBuffer}
                        width={720}
                        height={1280}
                        onProgress={(curr, total) => setPlaybackProgress((curr/total) * 100)}
                        onPlaybackEnd={() => setIsPlaying(false)}
                    />
                </div>

                {/* Controls */}
                <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800 flex flex-col gap-4">
                    {/* Progress Bar */}
                    <div className="w-full bg-zinc-800 h-1.5 rounded-full overflow-hidden">
                        <div 
                            className="bg-blue-500 h-full transition-all duration-100 ease-linear"
                            style={{ width: `${playbackProgress}%` }}
                        />
                    </div>
                    
                    <div className="flex justify-between items-center">
                        <div className="flex gap-2">
                            <button 
                                onClick={togglePlay}
                                className="w-10 h-10 flex items-center justify-center rounded-full bg-white text-black hover:bg-zinc-200 transition-colors"
                            >
                                {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
                            </button>
                        </div>
                        
                        <button 
                            onClick={handleDownload}
                            className="flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                        >
                            <Download className="w-4 h-4" />
                            Export Video
                        </button>
                    </div>
                </div>
            </div>

            {/* Sidebar Assets */}
            <div className="space-y-6">
                <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-5">
                    <h3 className="font-semibold mb-4 flex items-center gap-2">
                        <Music className="w-4 h-4 text-blue-400" />
                        Background Music
                    </h3>
                    <input 
                        type="file" 
                        ref={fileInputRef}
                        accept="audio/*" 
                        onChange={handleMusicUpload}
                        className="hidden"
                    />
                    <button 
                        onClick={() => fileInputRef.current?.click()}
                        className="w-full border border-dashed border-zinc-700 rounded-lg p-4 text-zinc-400 hover:text-white hover:border-zinc-500 transition-colors text-sm flex flex-col items-center gap-2"
                    >
                        {state.backgroundMusic ? (
                             <span className="text-blue-400 font-medium">{state.backgroundMusic.name}</span>
                        ) : (
                            <>
                                <Plus className="w-5 h-5" />
                                <span>Upload Audio File</span>
                            </>
                        )}
                    </button>
                </div>

                <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-5 max-h-[500px] overflow-y-auto">
                    <h3 className="font-semibold mb-4 text-sm text-zinc-400 uppercase tracking-wider">Generated Scenes</h3>
                    <div className="space-y-3">
                        {state.scenes.map(scene => (
                            <div key={scene.id} className="group flex flex-col gap-2 p-3 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-zinc-600 transition-colors">
                                <div className="flex gap-3 items-start">
                                    <div className="relative w-12 h-20 bg-zinc-800 rounded overflow-hidden shrink-0 group/image">
                                        {state.assets[scene.id]?.imageUrl && (
                                            <img 
                                                src={state.assets[scene.id].imageUrl} 
                                                className="w-full h-full object-cover" 
                                                alt={`Scene ${scene.id}`} 
                                            />
                                        )}
                                        {/* Hidden File Input for this scene */}
                                        <input 
                                            type="file" 
                                            ref={el => sceneFileInputRefs.current[scene.id] = el}
                                            accept="image/*"
                                            className="hidden"
                                            onChange={(e) => handleSceneImageUpload(scene.id, e)}
                                        />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex justify-between items-center mb-1">
                                            <p className="text-xs text-zinc-500 font-semibold">SCENE {scene.id}</p>
                                        </div>
                                        <p className="text-xs text-zinc-300 line-clamp-3 leading-relaxed">"{scene.narration}"</p>
                                    </div>
                                </div>
                                
                                {/* Tools */}
                                <div className="flex gap-2 mt-1 pt-2 border-t border-zinc-800/50">
                                    <button 
                                        onClick={() => handleRegenerateImage(scene.id)}
                                        title="Regenerate Image"
                                        className="p-1.5 rounded hover:bg-zinc-800 text-zinc-500 hover:text-blue-400 transition-colors"
                                    >
                                        <RefreshCw className="w-3.5 h-3.5" />
                                    </button>
                                    <button 
                                        onClick={() => sceneFileInputRefs.current[scene.id]?.click()}
                                        title="Upload Custom Image"
                                        className="p-1.5 rounded hover:bg-zinc-800 text-zinc-500 hover:text-green-400 transition-colors"
                                    >
                                        <Upload className="w-3.5 h-3.5" />
                                    </button>
                                    <button 
                                        onClick={() => handleRegenerateAudio(scene.id)}
                                        title="Regenerate Voiceover"
                                        className="p-1.5 rounded hover:bg-zinc-800 text-zinc-500 hover:text-purple-400 transition-colors ml-auto"
                                    >
                                        <Mic className="w-3.5 h-3.5" />
                                    </button>
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