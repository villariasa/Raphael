import { useRef, useState } from 'react';
import type { SpeakResult } from '../../../shared/ipc';
import { SystemResponse } from './types';
import {
  playSpeechWav,
  resumeAudioContext,
  stopSpeech,
  markSpeechStart,
  markSpeechEnd,
  markTextOnlyReveal
} from '../visualizer/useAudioReactive';

export interface OrchestratorState {
  /** bump → ResponseSystem plays; 0 = idle */
  responseTrigger: number;
  response: SystemResponse | null;
  /** live spoken/revealing text for the subtitle overlay */
  subtitleText: string | null;
  subtitleNonce: number;
  isSpeaking: boolean;
}

export interface Orchestrator extends OrchestratorState {
  /** The one entry point (§14): coordinate animation + voice + text for a response. */
  handle: (r: SystemResponse) => void;
  /** Stop everything in-flight immediately (§15/§16 interruption). */
  interrupt: () => void;
  /** passed to <ResponseSystem onRevealStart> — voice + text begin as the animation reveals. */
  onRevealStart: () => void;
}

function estimateReadMs(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1400, Math.min(9000, words * 300));
}

/**
 * RaphaelResponseOrchestrator (§14) — the heart of the response engine. One
 * place coordinates the animation, the voice, and the progressive text reveal
 * for EVERY response, with real interruption. Voice is pre-synthesized while
 * the animation plays (filling latency) and begins at the reveal, so the
 * three layers stay synchronized.
 */
export function useResponseOrchestrator(audioEl: HTMLAudioElement | null): Orchestrator {
  const [responseTrigger, setResponseTrigger] = useState(0);
  const [response, setResponse] = useState<SystemResponse | null>(null);
  const [subtitleText, setSubtitleText] = useState<string | null>(null);
  const [subtitleNonce, setSubtitleNonce] = useState(0);
  const [isSpeaking, setIsSpeaking] = useState(false);

  const triggerRef = useRef(0);
  const nonceRef = useRef(0);
  const responseRef = useRef<SystemResponse | null>(null);
  const currentIdRef = useRef<string>('');
  const revealedRef = useRef<string>(''); // responseId already revealed (guards double reveal)
  const synthRef = useRef<{ id: string; promise: Promise<SpeakResult | undefined> } | null>(null);
  // Shared with the visualizer's useAudioReactive so the fallback <audio>
  // path also feeds the analyser.
  const audioElRef = useRef<HTMLAudioElement | null>(audioEl);
  audioElRef.current = audioEl;

  function startSubtitle(text: string) {
    nonceRef.current += 1;
    setSubtitleNonce(nonceRef.current);
    setSubtitleText(text);
  }

  function interrupt() {
    stopSpeech();
    markSpeechEnd();
    setIsSpeaking(false);
    setSubtitleText(null);
    synthRef.current = null;
  }

  async function reveal(r: SystemResponse) {
    if (revealedRef.current === r.responseId) return; // already revealed
    if (currentIdRef.current !== r.responseId) return; // superseded by a newer response
    revealedRef.current = r.responseId;

    if (r.voice.enabled && typeof window.raphael?.speak === 'function') {
      const synth = synthRef.current;
      let result: SpeakResult | undefined;
      if (synth && synth.id === r.responseId) result = await synth.promise;
      // bail if we were interrupted while awaiting synthesis
      if (currentIdRef.current !== r.responseId) return;
      if (result && result.ok) {
        startSubtitle(r.message);
        setIsSpeaking(true);
        const played = await playSpeechWav(result.audioBase64, () => setIsSpeaking(false));
        if (!played && audioElRef.current) {
          const el = audioElRef.current;
          el.src = `data:${result.mime};base64,${result.audioBase64}`;
          el.volume = 1.0;
          el.muted = false;
          el.onloadedmetadata = () => {
            if (isFinite(el.duration) && el.duration > 0) markSpeechStart(el.duration, 'wall');
          };
          el.onended = () => { setIsSpeaking(false); markSpeechEnd(); };
          el.onerror = () => { setIsSpeaking(false); markSpeechEnd(); };
          await el.play().catch(() => setIsSpeaking(false));
        }
        return;
      }
    }

    // Voice disabled or synthesis failed → still reveal the text progressively.
    startSubtitle(r.message);
    markTextOnlyReveal(estimateReadMs(r.message));
  }

  function handle(r: SystemResponse) {
    interrupt();
    currentIdRef.current = r.responseId;
    responseRef.current = r;
    setResponse(r);

    // Pre-synthesize the voice now so it's ready by the time the animation
    // reaches its reveal — the animation fills the synthesis latency.
    if (r.voice.enabled && typeof window.raphael?.speak === 'function') {
      const id = r.responseId;
      const promise = resumeAudioContext()
        .then(() => window.raphael.speak(r.voice.text))
        .catch(() => undefined);
      synthRef.current = { id, promise };
    }

    if (r.animation.enabled) {
      triggerRef.current += 1;
      setResponseTrigger(triggerRef.current);
      // reveal() is invoked by <ResponseSystem onRevealStart>.
    } else {
      // No animation → reveal immediately.
      reveal(r);
    }
  }

  function onRevealStart() {
    const r = responseRef.current;
    if (r) reveal(r);
  }

  return {
    responseTrigger,
    response,
    subtitleText,
    subtitleNonce,
    isSpeaking,
    handle,
    interrupt,
    onRevealStart
  };
}
