import { useEffect, useRef, useState } from 'react';

interface Opts {
  /** fired once per detected utterance with a 16 kHz mono WAV (base64) */
  onUtterance: (wavBase64: string) => void;
  onError?: (msg: string) => void;
  onListeningChange?: (listening: boolean) => void;
  /** return true to ignore the mic right now (e.g. while Raphael is speaking — barge-in mute) */
  getBlocked?: () => boolean;
}

// Energy-VAD tuning. Endpoint detection delay is the main perceived-latency
// lever (see docs/VOICE_INPUT_ARCHITECTURE.md §7) — kept tight here.
const SPEECH_RMS = 0.016;
const END_SILENCE_MS = 650;
const MIN_SPEECH_MS = 300;
const MAX_UTTERANCE_MS = 15000;

/**
 * Microphone capture + energy-based voice-activity detection, producing one
 * 16 kHz mono WAV per utterance. Runs entirely in the renderer; the WAV goes
 * to main → the SenseVoice sidecar. Fully optional — if the mic is denied or
 * unavailable, this just reports an error and the app keeps working on typed
 * input.
 */
export function useVoiceInput(opts: Opts) {
  const [listening, setListening] = useState(false);
  const [level, setLevel] = useState(0);

  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const procRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const zeroGainRef = useRef<GainNode | null>(null);

  // recording state kept in refs so the audio callback stays cheap
  const chunksRef = useRef<Float32Array[]>([]);
  const inSpeechRef = useRef(false);
  const speechMsRef = useRef(0);
  const silenceMsRef = useRef(0);
  const sampleRateRef = useRef(48000);

  const cbRef = useRef(opts);
  cbRef.current = opts;

  const finalize = () => {
    const chunks = chunksRef.current;
    chunksRef.current = [];
    const hadSpeech = speechMsRef.current >= MIN_SPEECH_MS;
    inSpeechRef.current = false;
    speechMsRef.current = 0;
    silenceMsRef.current = 0;
    if (!hadSpeech || chunks.length === 0) return;

    const merged = mergeChunks(chunks);
    const down = downsampleTo16k(merged, sampleRateRef.current);
    const wav = encodeWav16(down, 16000);
    const b64 = arrayBufferToBase64(wav);
    cbRef.current.onUtterance(b64);
  };

  const stop = () => {
    try {
      procRef.current?.disconnect();
      sourceRef.current?.disconnect();
      zeroGainRef.current?.disconnect();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      ctxRef.current?.close().catch(() => {});
    } catch {
      /* ignore */
    }
    procRef.current = null;
    sourceRef.current = null;
    zeroGainRef.current = null;
    streamRef.current = null;
    ctxRef.current = null;
    chunksRef.current = [];
    inSpeechRef.current = false;
    speechMsRef.current = 0;
    silenceMsRef.current = 0;
    setLevel(0);
    if (listening) {
      setListening(false);
      cbRef.current.onListeningChange?.(false);
    }
  };

  const start = async () => {
    if (listening) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
      streamRef.current = stream;
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      ctxRef.current = ctx;
      sampleRateRef.current = ctx.sampleRate;

      const source = ctx.createMediaStreamSource(stream);
      const proc = ctx.createScriptProcessor(4096, 1, 1);
      const zeroGain = ctx.createGain();
      zeroGain.gain.value = 0; // keep the graph pulling without echoing the mic to the speakers
      sourceRef.current = source;
      procRef.current = proc;
      zeroGainRef.current = zeroGain;

      const frameMs = (4096 / ctx.sampleRate) * 1000;

      proc.onaudioprocess = (e) => {
        if (cbRef.current.getBlocked?.()) return; // barge-in mute while speaking
        const input = e.inputBuffer.getChannelData(0);
        let sum = 0;
        for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
        const rms = Math.sqrt(sum / input.length);
        setLevel(Math.min(1, rms * 8));

        const voiced = rms > SPEECH_RMS;
        if (voiced) {
          if (!inSpeechRef.current) inSpeechRef.current = true;
          speechMsRef.current += frameMs;
          silenceMsRef.current = 0;
          chunksRef.current.push(new Float32Array(input));
        } else if (inSpeechRef.current) {
          silenceMsRef.current += frameMs;
          chunksRef.current.push(new Float32Array(input)); // keep trailing silence for natural endpoint
          if (silenceMsRef.current >= END_SILENCE_MS) finalize();
        }

        if (speechMsRef.current >= MAX_UTTERANCE_MS) finalize();
      };

      source.connect(proc);
      proc.connect(zeroGain);
      zeroGain.connect(ctx.destination);

      setListening(true);
      cbRef.current.onListeningChange?.(true);
    } catch (err: any) {
      cbRef.current.onError?.(err?.message ?? 'Microphone access failed.');
      stop();
    }
  };

  const toggle = () => {
    if (listening) stop();
    else start();
  };

  // Cleanup on unmount.
  useEffect(() => () => stop(), []);

  return { listening, level, start, stop, toggle };
}

// --- audio helpers ----------------------------------------------------

function mergeChunks(chunks: Float32Array[]): Float32Array {
  let len = 0;
  for (const c of chunks) len += c.length;
  const out = new Float32Array(len);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

function downsampleTo16k(samples: Float32Array, inRate: number): Float32Array {
  const outRate = 16000;
  if (inRate === outRate) return samples;
  const ratio = inRate / outRate;
  const outLen = Math.floor(samples.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    // average the source window to avoid aliasing
    const start = Math.floor(i * ratio);
    const end = Math.min(samples.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += samples[j];
    out[i] = end > start ? sum / (end - start) : samples[start] || 0;
  }
  return out;
}

function encodeWav16(samples: Float32Array, rate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  let off = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    off += 2;
  }
  return buffer;
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(binary);
}
