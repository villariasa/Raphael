import { useEffect, useRef, useState } from 'react';
import type { SpeakResult } from '../../../shared/ipc';
import { ResponseTimeline, SystemResponse } from './types';
import { VoiceTimelineProvider } from './voiceTimelineProvider';
import {
  decodeAudioBytes,
  getSpeechElapsedSec,
  markSpeechEnd,
  markTextOnlyReveal,
  playDecodedBuffer,
  resumeAudioContext,
  stopSpeech
} from '../visualizer/useAudioReactive';

export interface OrchestratorState {
  timeline: ResponseTimeline | null;
  currentTimeSec: number;
  isSpeaking: boolean;
  isActive: boolean;
  ttsNotice: string | null;
  transcriptText: string | null;
}

export interface Orchestrator extends OrchestratorState {
  handle: (r: SystemResponse, voiceOverride?: import('../../../shared/ipc').VoiceOption) => Promise<void>;
  interrupt: () => void;
}

function estimateReadMs(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(2200, Math.min(12000, words * 320));
}

/**
 * RaphaelResponseOrchestrator
 * The core orchestration engine:
 * 1. Coordinates full spoken script (Japanese when ja-JP-female is selected)
 * 2. Generates TTS audio & receives word/sentence timestamps
 * 3. Builds word-synchronized ResponseTimeline (Japanese text animation with English subtitle)
 * 4. Animates every word/phrase across all 7 visual layers synchronized with voice
 * 5. Animation continues for the ENTIRE duration of speech
 * 6. Handles instant interruption cleanly
 */
export function useResponseOrchestrator(): Orchestrator {
  const [timeline, setTimeline] = useState<ResponseTimeline | null>(null);
  const [currentTimeSec, setCurrentTimeSec] = useState(0);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const [ttsNotice, setTtsNotice] = useState<string | null>(null);
  const [transcriptText, setTranscriptText] = useState<string | null>(null);

  const currentIdRef = useRef<string>('');
  const rafRef = useRef<number | null>(null);
  const timelineRef = useRef<ResponseTimeline | null>(null);
  timelineRef.current = timeline;

  function interrupt() {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    stopSpeech();
    markSpeechEnd();
    currentIdRef.current = '';
    setIsSpeaking(false);
    setIsActive(false);
    setCurrentTimeSec(0);
    setTimeline(null);
  }

  function startAnimationLoop(targetTimeline: ResponseTimeline, onFinished?: () => void) {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    const checkFrame = () => {
      const { elapsed, playing } = getSpeechElapsedSec();
      setCurrentTimeSec(elapsed);

      // Animation continues until BOTH audio playback is done AND all timeline segments complete
      if (!playing && elapsed >= targetTimeline.totalDuration) {
        // Natural completion
        setTimeout(() => {
          setIsSpeaking(false);
          setIsActive(false);
          onFinished?.();
        }, 400);
        return;
      }

      rafRef.current = requestAnimationFrame(checkFrame);
    };

    rafRef.current = requestAnimationFrame(checkFrame);
  }

  async function handle(r: SystemResponse, voiceOverride?: import('../../../shared/ipc').VoiceOption) {
    interrupt();

    currentIdRef.current = r.responseId;
    setTranscriptText(r.message);
    setTtsNotice(null);

    // 1. Immediately build and start visual response timeline (0ms UI latency)
    const initialDuration = estimateReadMs(r.spokenScript) / 1000;
    const initialTimeline = VoiceTimelineProvider.buildTimeline({
      responseId: r.responseId,
      responseType: r.responseType,
      label: r.systemLabel,
      message: r.message,
      spokenScript: r.spokenScript,
      audioDuration: initialDuration,
      accent: r.accent,
      accent2: r.accent2
    });
    initialTimeline.transcriptText = r.message;

    setTimeline(initialTimeline);
    setIsActive(true);
    setCurrentTimeSec(0);
    markTextOnlyReveal(initialDuration * 1000);
    startAnimationLoop(initialTimeline);

    // 2. Synthesize voice in parallel without blocking the UI response
    if (r.voice.enabled && typeof window.raphael?.speak === 'function') {
      resumeAudioContext()
        .then(() => window.raphael.speak(r.spokenScript, voiceOverride))
        .then(async (result: SpeakResult) => {
          if (currentIdRef.current !== r.responseId) return;

          if (result && result.ok) {
            const audioBuffer = await decodeAudioBytes(result.audioBase64);
            if (currentIdRef.current !== r.responseId || !audioBuffer) return;

            const displayText = result.japaneseText || r.message;
            const spokenScript = result.spokenText || r.spokenScript;

            const refinedTimeline = VoiceTimelineProvider.buildTimeline({
              responseId: r.responseId,
              responseType: r.responseType,
              label: r.systemLabel,
              message: displayText,
              spokenScript,
              audioDuration: audioBuffer.duration,
              rawTimestamps: result.timestamps,
              accent: r.accent,
              accent2: r.accent2
            });
            refinedTimeline.transcriptText = r.message;

            setTimeline(refinedTimeline);
            setIsSpeaking(true);
            playDecodedBuffer(audioBuffer, () => {
              setIsSpeaking(false);
            });
            startAnimationLoop(refinedTimeline);
          } else {
            setTtsNotice('VOICE SYSTEM UNAVAILABLE');
          }
        })
        .catch((err) => {
          console.warn('[useResponseOrchestrator] TTS synthesis error:', err);
          if (currentIdRef.current === r.responseId) {
            setTtsNotice('VOICE SYSTEM UNAVAILABLE');
          }
        });
    }
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      stopSpeech();
    };
  }, []);

  return {
    timeline,
    currentTimeSec,
    isSpeaking,
    isActive,
    ttsNotice,
    transcriptText,
    handle,
    interrupt
  };
}
