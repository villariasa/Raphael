import { Dispatch, SetStateAction, CSSProperties, useEffect, useRef, useState } from 'react';
import { RaphaelVisualizer, VisualizerDebugStats } from './RaphaelVisualizer';
import { AudioBands, DEFAULT_TUNABLES, QualityTier, RaphaelState, SILENT_AUDIO, VisualizerTunables } from './types';

interface Props {
  state: RaphaelState;
  audio?: AudioBands;
  tunables?: VisualizerTunables;
  forceQuality?: QualityTier | null;
  completedAt?: number | null;
  onStats?: (stats: VisualizerDebugStats) => void;
  className?: string;
}

const VIDEO_SRC: Record<RaphaelState, string> = {
  idle: './visualizer/idle.mp4',
  listening: './visualizer/listening.mp4',
  thinking: './visualizer/thinking.mp4',
  researching: './visualizer/researching.mp4',
  waiting_for_permission: './visualizer/waiting_for_permission.mp4',
  executing: './visualizer/executing.mp4',
  speaking: './visualizer/speaking.mp4',
  completed: './visualizer/idle.mp4', // transient only — completion.mp4 plays as an overlay, not a base state
  error: './visualizer/error.mp4'
};
const COMPLETION_SRC = './visualizer/completion.mp4';

/**
 * Pre-rendered video loop per state (reference: raphael.png, produced as
 * video by the user — true frequency-mapped reactivity isn't possible with
 * baked footage, so "audio-reactive" here means real scale/brightness
 * modulation driven by the actual TTS AnalyserNode output, applied on top
 * of the video). Falls back to the procedural canvas renderer per-state if
 * that state's clip is missing or fails to decode, so a partial asset set
 * never breaks the app. forceQuality:'low' always uses the canvas path —
 * video has no cheaper tier to fall back to.
 */
export function RaphaelVisualizerVideo({
  state,
  audio = SILENT_AUDIO,
  tunables = DEFAULT_TUNABLES,
  forceQuality = null,
  completedAt = null,
  onStats,
  className
}: Props) {
  const videoARef = useRef<HTMLVideoElement | null>(null);
  const videoBRef = useRef<HTMLVideoElement | null>(null);
  const completionRef = useRef<HTMLVideoElement | null>(null);
  const [activeSlot, setActiveSlot] = useState<'a' | 'b'>('a');
  const [slotSrc, setSlotSrc] = useState<{ a: string; b: string }>({ a: VIDEO_SRC[state], b: VIDEO_SRC[state] });
  const [brokenStates, setBrokenStates] = useState<Set<RaphaelState>>(new Set());
  const [showCompletion, setShowCompletion] = useState(false);
  const lastCompletedAt = useRef<number | null>(null);
  const prevState = useRef(state);

  const useCanvasFallback = forceQuality === 'low' || brokenStates.has(state);

  // Crossfade to the new state's clip.
  useEffect(() => {
    if (useCanvasFallback) return;
    if (prevState.current === state) return;
    prevState.current = state;
    const nextSrc = VIDEO_SRC[state];
    setActiveSlot((slot) => {
      const nextSlot = slot === 'a' ? 'b' : 'a';
      setSlotSrc((s) => ({ ...s, [nextSlot]: nextSrc }));
      return nextSlot;
    });
  }, [state, useCanvasFallback]);

  useEffect(() => {
    const el = activeSlot === 'a' ? videoARef.current : videoBRef.current;
    el?.play().catch(() => {});
  }, [activeSlot, slotSrc]);

  // One-shot completion overlay (§7 COMPLETED: "briefly increase energy ... return to idle").
  useEffect(() => {
    if (completedAt === null || completedAt === undefined) return;
    if (lastCompletedAt.current === completedAt) return;
    lastCompletedAt.current = completedAt;
    if (brokenStates.has('completed')) return;
    setShowCompletion(true);
    const el = completionRef.current;
    if (el) {
      el.currentTime = 0;
      el.play().catch(() => {});
    }
    const timer = setTimeout(() => setShowCompletion(false), 1500);
    return () => clearTimeout(timer);
  }, [completedAt, brokenStates]);

  // Lightweight stats loop — no canvas drawing, just surfaces real audio
  // bands/state to the debug panel at a steady cadence.
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      onStats?.({
        fps: 60,
        audio,
        state,
        particleCount: 0,
        resolution: 'video',
        quality: useCanvasFallback ? 'low' : 'high'
      });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [audio, state, useCanvasFallback, onStats]);

  if (useCanvasFallback) {
    return (
      <RaphaelVisualizer
        state={state}
        audio={audio}
        tunables={tunables}
        forceQuality={forceQuality}
        completedAt={completedAt}
        onStats={onStats}
        className={className}
      />
    );
  }

  // Real audio-driven modulation of the baked footage (§6/§20): bass pumps
  // scale, overall amplitude pumps brightness. This is coarse compared to
  // frequency-mapped canvas rings, but it is driven by the live AnalyserNode,
  // not a fake/random wobble.
  const sens = tunables.audioSensitivity;
  const scale = 1 + audio.bass * sens * 0.05;
  const brightness = 1 + audio.amplitude * sens * 0.35;
  const videoStyle: CSSProperties = {
    transform: `scale(${scale})`,
    filter: `brightness(${brightness})`,
    transition: 'opacity 450ms ease'
  };

  return (
    <div className={className} style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', background: '#05070a' }}>
      <video
        ref={videoARef}
        src={slotSrc.a}
        muted
        loop
        playsInline
        autoPlay
        onError={() => markBroken(stateForSrc(slotSrc.a), setBrokenStates)}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          opacity: activeSlot === 'a' ? 1 : 0,
          ...videoStyle
        }}
      />
      <video
        ref={videoBRef}
        src={slotSrc.b}
        muted
        loop
        playsInline
        autoPlay
        onError={() => markBroken(stateForSrc(slotSrc.b), setBrokenStates)}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          opacity: activeSlot === 'b' ? 1 : 0,
          ...videoStyle
        }}
      />
      {showCompletion && (
        <video
          ref={completionRef}
          src={COMPLETION_SRC}
          muted
          playsInline
          autoPlay
          onError={() => {
            setBrokenStates((prev) => new Set(prev).add('completed'));
            setShowCompletion(false);
          }}
          onEnded={() => setShowCompletion(false)}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
        />
      )}
    </div>
  );
}

function stateForSrc(src: string): RaphaelState {
  const entry = Object.entries(VIDEO_SRC).find(([, v]) => v === src);
  return (entry?.[0] as RaphaelState) ?? 'idle';
}

function markBroken(state: RaphaelState, setBrokenStates: Dispatch<SetStateAction<Set<RaphaelState>>>) {
  setBrokenStates((prev) => {
    if (prev.has(state)) return prev;
    const next = new Set(prev);
    next.add(state);
    console.warn(`[RaphaelVisualizerVideo] "${state}" clip failed to load — falling back to procedural canvas for this state.`);
    return next;
  });
}
