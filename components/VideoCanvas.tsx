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

  useEffect(() => {
    // Initialize AudioContext
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      destinationRef.current = audioContextRef.current.createMediaStreamDestination();
    }
    
    return () => {
      cancelAnimationFrame(requestRef.current!);
      stopAudio();
      audioContextRef.current?.close();
    };
  }, []);

  const stopAudio = () => {
    activeSourcesRef.current.forEach(node => {
      try { node.stop(); } catch(e) {}
    });
    activeSourcesRef.current = [];
  };

  const playAudioForTime = (currentTime: number, timeline: any[]) => {
    if (!audioContextRef.current || !destinationRef.current) return;
    const ctx = audioContextRef.current;

    // Background Music (Looping)
    if (bgMusicBuffer) {
      const bgSource = ctx.createBufferSource();
      bgSource.buffer = bgMusicBuffer;
      bgSource.loop = true;
      const bgGain = ctx.createGain();
      bgGain.gain.value = 0.15; // Low volume for background
      bgSource.connect(bgGain);
      bgGain.connect(ctx.destination); // For hearing
      bgGain.connect(destinationRef.current); // For recording
      
      // Start slightly in the past to account for offset if scrubbing (simplified for now: just start)
      // For accurate seeking, we'd need more complex logic. 
      // Since this is a "Preview/Render" mainly, we start from 0 or resume.
      // For this simplified version, we restart music on play.
      bgSource.start(0, currentTime % bgMusicBuffer.duration);
      activeSourcesRef.current.push(bgSource);
    }

    // Voiceovers
    timeline.forEach(item => {
      const asset = assets[item.id];
      if (asset?.audioBuffer) {
        if (item.start <= currentTime && item.end > currentTime) {
          // Should be playing
          // But handling strict sync in a loop is hard. 
          // Instead, we schedule ALL audio relative to ctx.currentTime when Play is clicked.
        }
      }
    });
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
      bgGain.connect(ctx.destination);
      bgGain.connect(destinationRef.current);
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
      // Pan slightly: center stays roughly center but we crop differently
      // Simplified: Draw image larger than canvas and center it
      
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

    // VFX: Film Grain Overlay (Simulated with noise)
    // For performance, maybe just a static semi-transparent overlay or nothing
    // Let's add a Vignette
    const gradient = ctx.createRadialGradient(width/2, height/2, width/3, width/2, height/2, width);
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(1, 'rgba(0,0,0,0.6)');
    ctx.globalAlpha = 1;
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    // Transitions (Crossfade)
    // Check if we are near the end of the scene (last 1 second) and there is a next scene
    const transitionDuration = 1.0;
    if (currentScene.end - time < transitionDuration && currentIdx < timeline.length - 1) {
      const nextScene = timeline[currentIdx + 1];
      const nextAsset = assets[nextScene.id];
      if (nextAsset?.imageElement) {
        const transProgress = 1 - ((currentScene.end - time) / transitionDuration);
        ctx.globalAlpha = transProgress;
        // Draw next scene (static start for now, or could pre-animate)
        ctx.drawImage(nextAsset.imageElement, 0, 0, width, height);
      }
    }
  };

  const handleStop = () => {
    isPlayingRef.current = false;
    stopAudio();
    if (requestRef.current) cancelAnimationFrame(requestRef.current);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
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
    record: () => {
        // Reset and play from start for clean recording
        isPlayingRef.current = false;
        stopAudio();
        if (requestRef.current) cancelAnimationFrame(requestRef.current);
        
        chunksRef.current = [];
        const canvas = canvasRef.current;
        const ctx = audioContextRef.current;
        const dest = destinationRef.current;
        
        if (!canvas || !ctx || !dest) return;

        const stream = canvas.captureStream(30); // 30 FPS
        // Add audio track
        const audioTrack = dest.stream.getAudioTracks()[0];
        if (audioTrack) stream.addTrack(audioTrack);

        const recorder = new MediaRecorder(stream, {
            mimeType: 'video/webm;codecs=vp9'
        });

        recorder.ondataavailable = (e) => {
            if (e.data.size > 0) chunksRef.current.push(e.data);
        };

        recorder.onstop = () => {
            const blob = new Blob(chunksRef.current, { type: 'video/webm' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'gemini-story.webm';
            a.click();
            URL.revokeObjectURL(url);
        };

        mediaRecorderRef.current = recorder;
        recorder.start();

        // Start Playback from 0
        isPlayingRef.current = true;
        startTimeRef.current = Date.now();
        pauseTimeRef.current = 0;
        scheduleAudio(0);
        requestRef.current = requestAnimationFrame(drawFrame);
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