import { useEffect, useRef, useState } from 'react';
import { AudioBands, SILENT_AUDIO } from './types';

/**
 * Real audio analysis (§6): wraps a single <audio> element with a Web Audio
 * AnalyserNode and extracts band energies from its actual FFT output on
 * every animation frame. No synthetic/random data — if nothing is playing,
 * every band reports 0.
 */
export function useAudioReactive(audioEl: HTMLAudioElement | null, sensitivity: number): AudioBands {
  const [bands, setBands] = useState<AudioBands>(SILENT_AUDIO);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const rafRef = useRef<number | null>(null);
  const sensitivityRef = useRef(sensitivity);
  sensitivityRef.current = sensitivity;

  useEffect(() => {
    if (!audioEl) return;

    let ctx: AudioContext | null = null;
    let source: MediaElementAudioSourceNode | null = null;
    let cancelled = false;

    try {
      ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      source = ctx.createMediaElementSource(audioEl);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.75;
      source.connect(analyser);
      analyser.connect(ctx.destination);
      analyserRef.current = analyser;
      dataRef.current = new Uint8Array(analyser.frequencyBinCount);
    } catch {
      // Element already has a source node attached elsewhere, or Web Audio
      // is unavailable. Bands stay silent rather than faking motion.
      return;
    }

    const tick = () => {
      if (cancelled) return;
      const analyser = analyserRef.current;
      const data = dataRef.current;
      if (analyser && data) {
        analyser.getByteFrequencyData(data);
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
      analyserRef.current?.disconnect();
      source?.disconnect();
      ctx?.close().catch(() => {});
      analyserRef.current = null;
      setBands(SILENT_AUDIO);
    };
  }, [audioEl]);

  return bands;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
