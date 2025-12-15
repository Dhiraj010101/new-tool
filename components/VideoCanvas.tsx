import React, { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import { ScriptScene, GeneratedAsset } from '../types';

interface VideoCanvasProps {
  scenes: ScriptScene[];
  assets: Record<number, GeneratedAsset>;
  bgMusicBuffer: AudioBuffer | null;
  width: number;
  height: number;
  onPlaybackEnd: () => void;
  onProgress: (time: number, duration: number, sceneIndex: number) => void;
}

export interface VideoCanvasHandle {
  play: () => void;
  pause: () => void;
  record: () => void;
  stopRecording: () => void;
}

const VideoCanvas = forwardRef<VideoCanvasHandle, VideoCanvasProps>(({ 
  scenes, 
  assets, 
  bgMusicBuffer, 
  width, 
  height,
  onPlaybackEnd,
  onProgress
}, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const destinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  
  // Animation state
  const requestRef = useRef<number>();
  const startTimeRef = useRef<number>(0);
  const pauseTimeRef = useRef<number>(0);
  const isPlayingRef = useRef<boolean>(false);
  const isRecordingRef = useRef<boolean>(false); 
  
  // Audio nodes for cleanup
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  
  // Calculate timeline
  const getTimeline = () => {
    let cursor = 0;
    return scenes.map(scene => {
      const asset = assets[scene.id];
      const duration = asset?.audioBuffer?.duration || scene.durationEstimate;
      const start = cursor;
      cursor += duration;
      return { ...scene, start, duration, end: cursor };
    });
  };

  const totalDuration = getTimeline()[getTimeline().length - 1]?.end || 0;

  // Validate that all assets needed for the timeline are ready
  const validateAssets = (): boolean => {
    const timeline = getTimeline();
    for (const scene of timeline) {
        const asset = assets[scene.id];
        // Check if asset exists, has an image element, and that image is fully loaded
        if (!asset || !asset.imageElement || !asset.imageElement.complete || asset.imageElement.naturalWidth === 0) {
            return false;
        }
    }
    return true;
  };

  // Prioritize WebM for better browser compatibility in MediaRecorder
  const getSupportedMimeType = () => {
    const types = [
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
      'video/mp4',
    ];
    return types.find(type => MediaRecorder.isTypeSupported(type));
  };

  useEffect(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      destinationRef.current = audioContextRef.current.createMediaStreamDestination();
    }
    
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      stopAudio();
      audioContextRef.current?.close();
    };
  }, []);

  const stopAudio = () => {
    activeSourcesRef.current.forEach(node => {
      try { node.stop(); } catch(e) {}
      try { node.disconnect(); } catch(e) {}
    });
    activeSourcesRef.current = [];
  };

  const scheduleAudio = (startOffset: number) => {
    if (!audioContextRef.current || !destinationRef.current) return;
    const ctx = audioContextRef.current;
    const timeline = getTimeline();

    // 1. Background Music
    if (bgMusicBuffer) {
      const bgSource = ctx.createBufferSource();
      bgSource.buffer = bgMusicBuffer;
      bgSource.loop = true;
      const bgGain = ctx.createGain();
      bgGain.gain.value = 0.15;
      bgSource.connect(bgGain);
      
      // Connect to speakers AND recording destination
      bgGain.connect(ctx.destination);
      bgGain.connect(destinationRef.current);
      
      bgSource.start(0, startOffset % bgMusicBuffer.duration);
      activeSourcesRef.current.push(bgSource);
    }

    // 2. Voiceovers
    timeline.forEach(item => {
      const asset = assets[item.id];
      if (asset?.audioBuffer) {
        const delay = item.start - startOffset;
        
        if (delay >= 0) {
          const source = ctx.createBufferSource();
          source.buffer = asset.audioBuffer;
          source.connect(ctx.destination);
          source.connect(destinationRef.current!);
          source.start(ctx.currentTime + delay);
          activeSourcesRef.current.push(source);
        } else if (item.end > startOffset) {
           const offset = startOffset - item.start;
           const source = ctx.createBufferSource();
           source.buffer = asset.audioBuffer;
           source.connect(ctx.destination);
           source.connect(destinationRef.current!);
           source.start(0, offset); 
           activeSourcesRef.current.push(source);
        }
      }
    });
  };

  const drawFrame = () => {
    if (!isPlayingRef.current) return;
    
    const elapsed = (Date.now() - startTimeRef.current) / 1000;
    const timeline = getTimeline();
    
    // Find current scene index for analysis/feedback
    const clampedTime = Math.min(elapsed, totalDuration - 0.001);
    let currentIdx = timeline.findIndex(t => clampedTime >= t.start && clampedTime < t.end);
    if (currentIdx === -1 && timeline.length > 0) {
        currentIdx = timeline.length - 1;
    }

    if (elapsed >= totalDuration) {
      // Force strict final frame render
      renderCanvas(totalDuration - 0.001);

      // Handle Stop / Tail
      if (isRecordingRef.current) {
        // Extended Post-roll: Wait 1 full second to ensure the end is captured cleanly
        setTimeout(() => {
            handleStop();
            onPlaybackEnd();
        }, 1000); 
      } else {
        handleStop();
        onPlaybackEnd();
      }
      return;
    }

    onProgress(elapsed, totalDuration, currentIdx);
    renderCanvas(elapsed);
    requestRef.current = requestAnimationFrame(drawFrame);
  };

  const renderCanvas = (time: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Background
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);

    const timeline = getTimeline();
    if (timeline.length === 0) return;
    
    const clampedTime = Math.min(time, totalDuration - 0.001);
    let currentIdx = timeline.findIndex(t => clampedTime >= t.start && clampedTime < t.end);
    
    if (currentIdx === -1) {
        currentIdx = timeline.length - 1;
    }

    const currentScene = timeline[currentIdx];
    const asset = assets[currentScene.id];

    // Ken Burns / Zoom Effect
    const progress = (clampedTime - currentScene.start) / currentScene.duration;
    
    if (asset?.imageElement && asset.imageElement.complete) {
      const scale = 1.0 + (progress * 0.15);
      const w = width * scale;
      const h = height * scale;
      const x = (width - w) / 2;
      const y = (height - h) / 2;
      
      ctx.globalAlpha = 1;
      ctx.drawImage(asset.imageElement, x, y, w, h);
    } else {
        // Fallback for missing/loading assets during playback
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = '#fff';
        ctx.font = '24px Inter';
        ctx.textAlign = 'center';
        ctx.fillText(`Generating Scene ${currentScene.id}...`, width/2, height/2);
    }

    // Vignette Overlay
    const gradient = ctx.createRadialGradient(width/2, height/2, width/3, width/2, height/2, width);
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(1, 'rgba(0,0,0,0.6)');
    ctx.globalAlpha = 1;
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    // Crossfade Transition
    const transitionDuration = 1.0;
    if (currentScene.end - clampedTime < transitionDuration && currentIdx < timeline.length - 1) {
      const nextScene = timeline[currentIdx + 1];
      const nextAsset = assets[nextScene.id];
      if (nextAsset?.imageElement && nextAsset.imageElement.complete) {
        const transProgress = 1 - ((currentScene.end - clampedTime) / transitionDuration);
        ctx.globalAlpha = transProgress;
        ctx.drawImage(nextAsset.imageElement, 0, 0, width, height);
      }
    }
  };

  const handleStop = () => {
    isPlayingRef.current = false;
    stopAudio();
    if (requestRef.current) cancelAnimationFrame(requestRef.current);
    
    if (isRecordingRef.current && mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
        isRecordingRef.current = false;
    }
  };

  useImperativeHandle(ref, () => ({
    play: () => {
      if (isPlayingRef.current) return;
      if (audioContextRef.current?.state === 'suspended') {
        audioContextRef.current.resume();
      }
      
      isPlayingRef.current = true;
      startTimeRef.current = Date.now() - (pauseTimeRef.current * 1000);
      scheduleAudio(pauseTimeRef.current);
      requestRef.current = requestAnimationFrame(drawFrame);
    },
    pause: () => {
      isPlayingRef.current = false;
      stopAudio();
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      pauseTimeRef.current = (Date.now() - startTimeRef.current) / 1000;
    },
    record: async () => {
        handleStop(); // Stop any existing playback
        
        if (totalDuration === 0) {
            alert("Timeline is empty.");
            onPlaybackEnd();
            return;
        }

        // 1. Strict Asset Validation
        if (!validateAssets()) {
             alert("Some scenes are still generating. Please wait for all images to load before exporting.");
             onPlaybackEnd();
             return;
        }

        // 2. Ensure Audio Context is active
        if (audioContextRef.current?.state === 'suspended') {
            await audioContextRef.current.resume();
        }

        chunksRef.current = [];
        const canvas = canvasRef.current;
        const dest = destinationRef.current;
        
        if (!canvas || !dest) {
            console.error("Resources not initialized");
            onPlaybackEnd();
            return;
        }

        // 3. Setup Stream & Recorder
        // Capture at 30fps constant
        const stream = canvas.captureStream(30);
        
        const audioTracks = dest.stream.getAudioTracks();
        if (audioTracks.length > 0) {
            stream.addTrack(audioTracks[0]);
        }

        const mimeType = getSupportedMimeType();
        if (!mimeType) {
            alert("Browser does not support video recording formats.");
            onPlaybackEnd();
            return;
        }

        try {
            // Use 15 Mbps for High Quality Output
            const recorder = new MediaRecorder(stream, { 
                mimeType,
                videoBitsPerSecond: 15000000 
            });

            recorder.ondataavailable = (e) => {
                if (e.data && e.data.size > 0) {
                    chunksRef.current.push(e.data);
                }
            };

            recorder.onstop = () => {
                const blob = new Blob(chunksRef.current, { type: mimeType });
                if (blob.size === 0) {
                    console.error("Empty recording");
                    return;
                }
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.style.display = 'none';
                a.href = url;
                const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
                a.download = `gemini-director-export-${Date.now()}.${ext}`;
                document.body.appendChild(a);
                a.click();
                setTimeout(() => {
                    document.body.removeChild(a);
                    window.URL.revokeObjectURL(url);
                }, 100);
            };

            mediaRecorderRef.current = recorder;
            isRecordingRef.current = true;
            recorder.start();

            // 4. Start Sequence with Buffers
            
            // Render Frame 0 immediately (Pre-roll start)
            renderCanvas(0);

            // Wait 800ms (Extended Pre-roll) to ensure recorder initialization and start stability
            setTimeout(() => {
                if (!isRecordingRef.current) return;
                
                isPlayingRef.current = true;
                startTimeRef.current = Date.now();
                pauseTimeRef.current = 0;
                
                scheduleAudio(0);
                requestRef.current = requestAnimationFrame(drawFrame);
            }, 800);

        } catch (err) {
            console.error("Recording error:", err);
            alert("Failed to start recording.");
            onPlaybackEnd();
        }
    },
    stopRecording: () => {
        handleStop();
    }
  }));

  // Initial Render
  useEffect(() => {
    if (!isPlayingRef.current && assets[scenes[0]?.id]?.imageElement) {
        renderCanvas(0);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenes, assets]);

  return (
    <div className="relative rounded-lg overflow-hidden shadow-2xl bg-black border border-zinc-800 flex justify-center items-center">
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="block h-auto max-w-full max-h-[70vh] object-contain"
      />
    </div>
  );
});

export default VideoCanvas;