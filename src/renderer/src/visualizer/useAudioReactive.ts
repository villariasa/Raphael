import { useEffect, useRef, useState } from 'react';
import { AudioBands, SILENT_AUDIO } from './types';

let sharedAudioContext: AudioContext | null = null;
let sharedAnalyser: AnalyserNode | null = null;
let currentBufferSource: AudioBufferSourceNode | null = null;

/**
 * Real playback clock for the subtitle system. `start`/`endsAt` are in the
 * AudioContext's own time base (seconds) when driven by Web Audio — the
 * same clock the audio samples play on — so subtitle progress tracks the
 * actual voice, not a fixed typing speed. `wallStart` is a fallback for the
 * rare <audio>-element path. `playing` flips false the instant speech ends
 * or is interrupted, so the subtitle stops at exactly that point.
 */
let speechClock: {
  base: 'ctx' | 'wall';
  start: number;
  duration: number;
  playing: boolean;
} | null = null;

function nowInBase(base: 'ctx' | 'wall'): number {
  if (base === 'ctx' && sharedAudioContext) return sharedAudioContext.currentTime;
  return performance.now() / 1000;
}

/** Called by the playback paths when real speech audio begins. */
export function markSpeechStart(durationSec: number, base: 'ctx' | 'wall'): void {
  speechClock = { base, start: nowInBase(base), duration: durationSec, playing: true };
}

/** Called the instant speech ends naturally or is interrupted. */
export function markSpeechEnd(): void {
  if (speechClock) speechClock.playing = false;
}

export interface SpeechProgress {
  /** 0..1 fraction of the current utterance that has played */
  progress: number;
  playing: boolean;
}

/** Read the live playback position. Drives subtitle reveal each frame. */
export function getSpeechProgress(): SpeechProgress {
  if (!speechClock) return { progress: 0, playing: false };
  if (!speechClock.playing) return { progress: 1, playing: false };
  if (speechClock.duration <= 0) return { progress: 0, playing: true };
  const elapsed = nowInBase(speechClock.base) - speechClock.start;
  const progress = Math.min(1, Math.max(0, elapsed / speechClock.duration));
  return { progress, playing: true };
}

export function getSharedAudioGraph(): { ctx: AudioContext; analyser: AnalyserNode } | null {
  if (typeof window === 'undefined') return null;
  try {
    if (!sharedAudioContext) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return null;
      sharedAudioContext = new AudioCtx();
      sharedAnalyser = sharedAudioContext.createAnalyser();
      sharedAnalyser.fftSize = 256;
      sharedAnalyser.smoothingTimeConstant = 0.75;
      sharedAnalyser.connect(sharedAudioContext.destination);
    }
    return { ctx: sharedAudioContext, analyser: sharedAnalyser! };
  } catch (err) {
    console.warn('[useAudioReactive] Failed to create shared AudioContext:', err);
    return null;
  }
}

export async function resumeAudioContext(): Promise<void> {
  const graph = getSharedAudioGraph();
  if (graph && graph.ctx.state === 'suspended') {
    try {
      await graph.ctx.resume();
    } catch {}
  }
}

/**
 * Play synthesized speech WAV directly through the Web Audio graph.
 * Ensures the AudioContext is running, connects to the analyser (driving
 * the visualizer in real time), and outputs crystal-clear sound to the speakers.
 */
export async function playSpeechWav(base64: string, onEnded?: () => void): Promise<boolean> {
  try {
    const graph = getSharedAudioGraph();
    if (!graph) return false;

    if (graph.ctx.state === 'suspended') {
      await graph.ctx.resume();
    }

    if (currentBufferSource) {
      try {
        currentBufferSource.stop();
        currentBufferSource.disconnect();
      } catch {}
      currentBufferSource = null;
    }

    // Convert base64 to ArrayBuffer
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    const audioBuffer = await graph.ctx.decodeAudioData(bytes.buffer.slice(0));
    const sourceNode = graph.ctx.createBufferSource();
    sourceNode.buffer = audioBuffer;
    sourceNode.connect(graph.analyser);
    currentBufferSource = sourceNode;

    sourceNode.onended = () => {
      if (currentBufferSource === sourceNode) {
        currentBufferSource = null;
        markSpeechEnd();
      }
      onEnded?.();
    };

    sourceNode.start(0);
    // Drive subtitles off the real decoded duration on the audio clock.
    markSpeechStart(audioBuffer.duration, 'ctx');
    return true;
  } catch (err) {
    console.warn('[playSpeechWav] Direct Web Audio playback failed:', err);
    return false;
  }
}

export function stopSpeech(): void {
  // Interruption: stop the subtitle at exactly this point, immediately.
  markSpeechEnd();
  if (currentBufferSource) {
    try {
      currentBufferSource.stop();
      currentBufferSource.disconnect();
    } catch {}
    currentBufferSource = null;
  }
}

const audioGraphCache = new WeakMap<HTMLAudioElement, { source: MediaElementAudioSourceNode }>();

/**
 * Real-time audio analysis extracting frequency band energies from the Web Audio AnalyserNode.
 */
export function useAudioReactive(audioEl: HTMLAudioElement | null, sensitivity: number): AudioBands {
  const [bands, setBands] = useState<AudioBands>(SILENT_AUDIO);
  const rafRef = useRef<number | null>(null);
  const sensitivityRef = useRef(sensitivity);
  sensitivityRef.current = sensitivity;

  useEffect(() => {
    const graph = getSharedAudioGraph();
    if (!graph) return;

    // Also connect the HTML audio element if provided
    if (audioEl && !audioGraphCache.has(audioEl)) {
      try {
        const source = graph.ctx.createMediaElementSource(audioEl);
        source.connect(graph.analyser);
        audioGraphCache.set(audioEl, { source });
      } catch {
        // Element already connected or unavailable
      }
    }

    let cancelled = false;
    const data = new Uint8Array(graph.analyser.frequencyBinCount);

    const tick = () => {
      if (cancelled) return;
      if (graph.analyser) {
        graph.analyser.getByteFrequencyData(data);
        const sens = sensitivityRef.current;
        const band = (fromFrac: number, toFrac: number) => {
          const from = Math.floor(data.length * fromFrac);
          const to = Math.max(from + 1, Math.floor(data.length * toFrac));
          let sum = 0;
          for (let i = from; i < to; i++) sum += data[i];
          return clamp01((sum / (to - from) / 255) * sens);
        };
        const next: AudioBands = {
          bass: band(0, 0.1),
          lowMid: band(0.1, 0.25),
          mid: band(0.25, 0.5),
          highMid: band(0.5, 0.75),
          treble: band(0.75, 1),
          amplitude: band(0, 1)
        };
        setBands(next);
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      setBands(SILENT_AUDIO);
    };
  }, [audioEl]);

  return bands;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
