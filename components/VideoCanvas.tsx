import React, { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react';
import { ScriptScene, GeneratedAsset } from '../types';

interface VideoCanvasProps {
  scenes: ScriptScene[];
  assets: Record<number, GeneratedAsset>;
  bgMusicBuffer: AudioBuffer | null;
  width: number;
  height: number;
  onPlaybackEnd: () => void;
  onProgress: (time: number, duration: number) => void;
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
  
  // Audio nodes for cleanup
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  
  // Calculate timeline
  const getTimeline = () => {
    let cursor = 0;
    return scenes.map(scene => {
      const asset = assets[scene.id];
      // Use audio duration if available, else estimate
      const duration = asset?.audioBuffer?.duration || scene.durationEstimate;
      const start = cursor;
      cursor += duration;
      return { ...scene, start, duration, end: cursor };
    });
  };

  const totalDuration = getTimeline()[getTimeline().length - 1]?.end || 0;

  // Helper to find supported mime type
  const getSupportedMimeType = () => {
    const types = [
      'video/mp4',
      'video/mp4;codecs=avc1',
      'video/webm;codecs=h264',
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm'
    ];
    return types.find(type => MediaRecorder.isTypeSupported(type));
  };

  useEffect(() => {
    // Initialize AudioContext
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
      bgGain.connect(ctx.destination); // For hearing it
      bgGain.connect(destinationRef.current); // For recording it
      bgSource.start(0, startOffset % bgMusicBuffer.duration);
      activeSourcesRef.current.push(bgSource);
    }

    // 2. Voiceovers
    timeline.forEach(item => {
      const asset = assets[item.id];
      if (asset?.audioBuffer) {
        // Calculate when this clip should start relative to NOW
        // item.start is absolute timeline time.
        // startOffset is where we are starting playback from.
        const delay = item.start - startOffset;
        
        if (delay >= 0) {
          // Schedule in future
          const source = ctx.createBufferSource();
          source.buffer = asset.audioBuffer;
          source.connect(ctx.destination);
          source.connect(destinationRef.current!);
          source.start(ctx.currentTime + delay);
          activeSourcesRef.current.push(source);
        } else if (item.end > startOffset) {
           // Should be playing right now (started in past)
           const offset = startOffset - item.start;
           const source = ctx.createBufferSource();
           source.buffer = asset.audioBuffer;
           source.connect(ctx.destination);
           source.connect(destinationRef.current!);
           source.start(0, offset); // play remaining
           activeSourcesRef.current.push(source);
        }
      }
    });
  };

  const drawFrame = (timestamp: number) => {
    if (!isPlayingRef.current) return;
    
    // Calculate elapsed time
    const elapsed = (Date.now() - startTimeRef.current) / 1000;
    
    if (elapsed >= totalDuration) {
      handleStop();
      onPlaybackEnd();
      return;
    }

    onProgress(elapsed, totalDuration);
    renderCanvas(elapsed);
    requestRef.current = requestAnimationFrame(drawFrame);
  };

  const renderCanvas = (time: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);

    const timeline = getTimeline();
    
    // Find current scene and maybe next scene for transition
    const currentIdx = timeline.findIndex(t => time >= t.start && time < t.end);
    if (currentIdx === -1) return;

    const currentScene = timeline[currentIdx];
    const asset = assets[currentScene.id];

    // Ken Burns Effect Math
    // Scale from 1.0 to 1.15 over the duration
    const progress = (time - currentScene.start) / currentScene.duration;
    
    // Draw Current
    if (asset?.imageElement) {
      const scale = 1.0 + (progress * 0.15); // Zoom in
      
      const w = width * scale;
      const h = height * scale;
      const x = (width - w) / 2;
      const y = (height - h) / 2;
      
      ctx.globalAlpha = 1;
      ctx.drawImage(asset.imageElement, x, y, w, h);
    } else {
        // Fallback or loading text
        ctx.fillStyle = '#333';
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = '#fff';
        ctx.font = '20px Inter';
        ctx.fillText(`Scene ${currentScene.id}: Generating visuals...`, 20, 50);
    }

    // VFX: Vignette
    const gradient = ctx.createRadialGradient(width/2, height/2, width/3, width/2, height/2, width);
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(1, 'rgba(0,0,0,0.6)');
    ctx.globalAlpha = 1;
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    // Transitions (Crossfade)
    const transitionDuration = 1.0;
    if (currentScene.end - time < transitionDuration && currentIdx < timeline.length - 1) {
      const nextScene = timeline[currentIdx + 1];
      const nextAsset = assets[nextScene.id];
      if (nextAsset?.imageElement) {
        const transProgress = 1 - ((currentScene.end - time) / transitionDuration);
        ctx.globalAlpha = transProgress;
        ctx.drawImage(nextAsset.imageElement, 0, 0, width, height);
      }
    }
  };

  const handleStop = () => {
    isPlayingRef.current = false;
    stopAudio();
    if (requestRef.current) cancelAnimationFrame(requestRef.current);
    
    // Stop recording if active
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
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
      // Capture current progress
      pauseTimeRef.current = (Date.now() - startTimeRef.current) / 1000;
    },
    record: async () => {
        // Ensure clean state
        handleStop();
        
        // Ensure Audio Context is ready
        if (audioContextRef.current?.state === 'suspended') {
            await audioContextRef.current.resume();
        }

        chunksRef.current = [];
        const canvas = canvasRef.current;
        const dest = destinationRef.current;
        
        if (!canvas || !dest) {
            console.error("Canvas or Audio Destination not initialized");
            return;
        }

        // Capture canvas stream at 30 FPS
        const stream = canvas.captureStream(30);
        
        // Add Audio Track
        // Important: Dest stream must have tracks.
        const audioTracks = dest.stream.getAudioTracks();
        if (audioTracks.length > 0) {
            stream.addTrack(audioTracks[0]);
        } else {
            console.warn("No audio tracks found in destination stream");
        }

        const mimeType = getSupportedMimeType();
        if (!mimeType) {
            alert("Video download is not supported in this browser.");
            return;
        }

        try {
            // High bitrate for quality
            const recorder = new MediaRecorder(stream, { 
                mimeType,
                videoBitsPerSecond: 5000000 // 5Mbps
            });

            recorder.ondataavailable = (e) => {
                if (e.data && e.data.size > 0) {
                    chunksRef.current.push(e.data);
                }
            };

            recorder.onstop = () => {
                const blob = new Blob(chunksRef.current, { type: mimeType });
                if (blob.size === 0) {
                    alert("Recording failed: Empty video file. Please try again.");
                    return;
                }
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
                a.download = `gemini-story-${Date.now()}.${ext}`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                setTimeout(() => URL.revokeObjectURL(url), 100);
            };

            mediaRecorderRef.current = recorder;
            
            // Start recording with timeslice to ensure data available events fire regularly
            recorder.start(100); 

            // Start Playback from 0 for recording
            isPlayingRef.current = true;
            startTimeRef.current = Date.now();
            pauseTimeRef.current = 0;
            scheduleAudio(0);
            requestRef.current = requestAnimationFrame(drawFrame);

        } catch (err) {
            console.error("Recording error:", err);
            alert(`Failed to start video recording: ${(err as Error).message}`);
        }
    },
    stopRecording: () => {
        handleStop();
    }
  }));

  // Initial Render (Static)
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