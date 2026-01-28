
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
  
  // Initialize with 0 to satisfy TS "Expected 1 arguments" and allow using as number (requestID)
  const requestRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);
  const pauseTimeRef = useRef<number>(0);
  const isPlayingRef = useRef<boolean>(false);
  const isRecordingRef = useRef<boolean>(false); 
  
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  
  const getTimeline = () => {
    let cursor = 0;
    return scenes.map(scene => {
      const duration = scene.durationEstimate;
      const start = cursor;
      cursor += duration;
      return { ...scene, start, duration, end: cursor };
    });
  };

  const totalDuration = getTimeline()[getTimeline().length - 1]?.end || 0;

  const validateAssets = (): boolean => {
    const timeline = getTimeline();
    for (const scene of timeline) {
        const asset = assets[scene.id];
        if (!asset || !asset.imageElement || !asset.imageElement.complete || asset.imageElement.naturalWidth === 0) {
            return false;
        }
    }
    return true;
  };

  const getSupportedMimeType = () => {
    const types = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
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
          // CRITICAL: Stop the audio at the exact end of the scene to prevent overlapping
          source.stop(ctx.currentTime + item.end - startOffset);
          activeSourcesRef.current.push(source);
        } else if (item.end > startOffset) {
           const offset = startOffset - item.start;
           const source = ctx.createBufferSource();
           source.buffer = asset.audioBuffer;
           source.connect(ctx.destination);
           source.connect(destinationRef.current!);
           source.start(0, offset); 
           // CRITICAL: Stop the audio at the exact end of the scene
           source.stop(ctx.currentTime + (item.end - startOffset));
           activeSourcesRef.current.push(source);
        }
      }
    });
  };

  const drawFrame = () => {
    if (!isPlayingRef.current) return;
    const elapsed = (Date.now() - startTimeRef.current) / 1000;
    const timeline = getTimeline();
    const clampedTime = Math.min(elapsed, totalDuration - 0.001);
    
    if (elapsed >= totalDuration) {
      renderCanvas(totalDuration - 0.001);
      if (isRecordingRef.current) {
        setTimeout(() => { handleStop(); onPlaybackEnd(); }, 1000); 
      } else {
        handleStop();
        onPlaybackEnd();
      }
      return;
    }

    let currentIdx = timeline.findIndex(t => clampedTime >= t.start && clampedTime < t.end);
    if (currentIdx === -1 && timeline.length > 0) currentIdx = timeline.length - 1;

    onProgress(elapsed, totalDuration, currentIdx);
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
    if (timeline.length === 0) return;
    
    const clampedTime = Math.min(time, totalDuration - 0.001);
    let currentIdx = timeline.findIndex(t => clampedTime >= t.start && clampedTime < t.end);
    if (currentIdx === -1) currentIdx = timeline.length - 1;

    const currentScene = timeline[currentIdx];
    const asset = assets[currentScene.id];
    const progress = (clampedTime - currentScene.start) / currentScene.duration;

    if (asset?.imageElement && asset.imageElement.complete) {
      const baseScale = 1.0 + (progress * 0.15);
      drawScene(ctx, asset.imageElement, baseScale, 0, 0, 1);
    }

    const transDur = 0.8;
    if (currentScene.end - clampedTime < transDur && currentIdx < timeline.length - 1) {
      const nextScene = timeline[currentIdx + 1];
      const nextAsset = assets[nextScene.id];
      if (nextAsset?.imageElement && nextAsset.imageElement.complete) {
        const tProgress = 1 - ((currentScene.end - clampedTime) / transDur);
        const type = currentScene.transitionType || 'fade';
        
        ctx.save();
        switch(type) {
          case 'slide':
            const offsetX = width * (1 - tProgress);
            drawScene(ctx, nextAsset.imageElement, 1.0, offsetX, 0, 1);
            break;
          case 'zoom':
            const zoomScale = 0.8 + (tProgress * 0.2);
            drawScene(ctx, nextAsset.imageElement, zoomScale, 0, 0, tProgress);
            break;
          case 'blur':
            ctx.filter = `blur(${(1 - tProgress) * 20}px)`;
            drawScene(ctx, nextAsset.imageElement, 1.0, 0, 0, tProgress);
            break;
          case 'dissolve':
            ctx.globalCompositeOperation = 'source-over';
            drawScene(ctx, nextAsset.imageElement, 1.0, 0, 0, tProgress);
            break;
          default: // fade
            drawScene(ctx, nextAsset.imageElement, 1.0, 0, 0, tProgress);
        }
        ctx.restore();
      }
    }

    const gradient = ctx.createRadialGradient(width/2, height/2, width/3, width/2, height/2, width);
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    
    if (currentScene.isHook && time < 5) {
       ctx.fillStyle = 'rgba(59, 130, 246, 0.5)';
       ctx.fillRect(0, height - 10, width * (1 - time/5), 10);
    }
  };

  const drawScene = (ctx: CanvasRenderingContext2D, img: HTMLImageElement, scale: number, xOff: number, yOff: number, alpha: number) => {
    ctx.globalAlpha = alpha;
    const w = width * scale;
    const h = height * scale;
    const x = (width - w) / 2 + xOff;
    const y = (height - h) / 2 + yOff;
    ctx.drawImage(img, x, y, w, h);
  };

  const handleStop = () => {
    isPlayingRef.current = false;
    stopAudio();
    if (requestRef.current) cancelAnimationFrame(requestRef.current);
    if (isRecordingRef.current && mediaRecorderRef.current?.state !== 'inactive') {
        mediaRecorderRef.current.stop();
        isRecordingRef.current = false;
    }
  };

  useImperativeHandle(ref, () => ({
    play: () => {
      if (isPlayingRef.current) return;
      if (audioContextRef.current?.state === 'suspended') audioContextRef.current.resume();
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
        handleStop(); 
        if (totalDuration === 0) { alert("Timeline empty."); onPlaybackEnd(); return; }
        if (!validateAssets()) { alert("Wait for all assets."); onPlaybackEnd(); return; }
        if (audioContextRef.current?.state === 'suspended') await audioContextRef.current.resume();
        chunksRef.current = [];
        const canvas = canvasRef.current!;
        const dest = destinationRef.current!;
        const stream = canvas.captureStream(30);
        const audioTracks = dest.stream.getAudioTracks();
        if (audioTracks.length > 0) stream.addTrack(audioTracks[0]);
        const mimeType = getSupportedMimeType()!;
        try {
            const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 15000000 });
            recorder.ondataavailable = e => e.data.size > 0 && chunksRef.current.push(e.data);
            recorder.onstop = () => {
                const blob = new Blob(chunksRef.current, { type: mimeType });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `cinematic-story-${Date.now()}.${mimeType.includes('mp4') ? 'mp4' : 'webm'}`;
                a.click();
            };
            mediaRecorderRef.current = recorder;
            isRecordingRef.current = true;
            recorder.start();
            renderCanvas(0);
            setTimeout(() => {
                isPlayingRef.current = true;
                startTimeRef.current = Date.now();
                pauseTimeRef.current = 0;
                scheduleAudio(0);
                requestRef.current = requestAnimationFrame(drawFrame);
            }, 800);
        } catch (err) { onPlaybackEnd(); }
    },
    stopRecording: () => handleStop()
  }));

  return (
    <div className="relative rounded-lg overflow-hidden shadow-2xl bg-black border border-zinc-800 flex justify-center items-center">
      <canvas ref={canvasRef} width={width} height={height} className="block h-auto max-w-full max-h-[70vh] object-contain" />
    </div>
  );
});

export default VideoCanvas;
