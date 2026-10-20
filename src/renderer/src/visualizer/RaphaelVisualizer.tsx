import { useEffect, useRef, useState } from 'react';
import { drawFrame, makeParticles, FrameParticle } from './drawFrame';
import { AudioBands, DEFAULT_TUNABLES, QualityTier, RaphaelState, SILENT_AUDIO, VisualizerTunables } from './types';

export interface VisualizerDebugStats {
  fps: number;
  audio: AudioBands;
  state: RaphaelState;
  particleCount: number;
  resolution: string;
  quality: QualityTier;
}

interface Props {
  state: RaphaelState;
  audio?: AudioBands;
  tunables?: VisualizerTunables;
  /** force a quality tier instead of auto-adapting (debug mode) */
  forceQuality?: QualityTier | null;
  /** timestamp (ms, Date.now()) of the most recent COMPLETED transition */
  completedAt?: number | null;
  onStats?: (stats: VisualizerDebugStats) => void;
  className?: string;
}

const PARTICLE_COUNTS: Record<QualityTier, number> = { high: 220, medium: 110, low: 45 };

export function RaphaelVisualizer({
  state,
  audio = SILENT_AUDIO,
  tunables = DEFAULT_TUNABLES,
  forceQuality = null,
  completedAt = null,
  onStats,
  className
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const particlesRef = useRef<FrameParticle[]>([]);
  const [quality, setQuality] = useState<QualityTier>('high');
  const qualityRef = useRef(quality);
  qualityRef.current = forceQuality ?? quality;

  // Keep the latest props in refs so the rAF loop (started once) always
  // reads current values without re-subscribing every render.
  const stateRef = useRef(state);
  stateRef.current = state;
  const audioRef = useRef(audio);
  audioRef.current = audio;
  const tunablesRef = useRef(tunables);
  tunablesRef.current = tunables;
  const completedAtRef = useRef(completedAt);
  completedAtRef.current = completedAt;

  useEffect(() => {
    particlesRef.current = makeParticles(PARTICLE_COUNTS[qualityRef.current]);
  }, [quality, forceQuality]);

  // Resize handling: keep canvas backing store matched to CSS size * DPR.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  // Main render loop.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let startTime: number | null = null;
    let lastFpsSample = 0;
    let frames = 0;
    let fps = 60;
    let lowFrameStreak = 0;

    const loop = (now: number) => {
      if (startTime === null) startTime = now;
      const tSec = (now - startTime) / 1000;

      frames++;
      if (now - lastFpsSample > 500) {
        fps = (frames * 1000) / (now - lastFpsSample);
        frames = 0;
        lastFpsSample = now;

        // Adaptive quality (§12): only auto-downgrade/upgrade when not
        // pinned by the debug panel.
        if (forceQuality === null) {
          if (fps < 45) lowFrameStreak++;
          else lowFrameStreak = 0;
          if (lowFrameStreak >= 3 && qualityRef.current !== 'low') {
            setQuality((q) => (q === 'high' ? 'medium' : 'low'));
            lowFrameStreak = 0;
          }
        }
      }

      const completedAgeMs = completedAtRef.current ? now - completedAtRef.current : null;
      const completionPulseAge = completedAgeMs !== null && completedAgeMs < 1200 ? completedAgeMs / 1000 : null;

      drawFrame({
        ctx,
        width: canvas.width,
        height: canvas.height,
        tSec,
        state: stateRef.current,
        audio: audioRef.current,
        tunables: tunablesRef.current,
        quality: qualityRef.current,
        particles: particlesRef.current,
        completionPulseAge
      });

      onStats?.({
        fps: Math.round(fps),
        audio: audioRef.current,
        state: stateRef.current,
        particleCount: particlesRef.current.length,
        resolution: `${canvas.width}x${canvas.height}`,
        quality: qualityRef.current
      });

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forceQuality]);

  return <canvas ref={canvasRef} className={className} style={{ width: '100%', height: '100%', display: 'block' }} />;
}
