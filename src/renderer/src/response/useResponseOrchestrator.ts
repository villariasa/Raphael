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
  /** True from reply arrival until the voice timeline starts (translation +
   *  synthesis in flight) — keeps the thinking visual alive meanwhile. */
  isPreparingVoice: boolean;
  ttsNotice: string | null;
  transcriptText: string | null;
}

export interface HandleOptions {
  /** When false, build the voice-synced timeline but never play the audio
   *  (the floating window animates while the main window owns the sound). */
  playAudio?: boolean;
}

export interface Orchestrator extends OrchestratorState {
  handle: (
    r: SystemResponse,
    voiceOverride?: import('../../../shared/ipc').VoiceOption,
    options?: HandleOptions
  ) => Promise<void>;
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
  const [isPreparingVoice, setIsPreparingVoice] = useState(false);
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
    setIsPreparingVoice(false);
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

  /** Single wall-clock reveal of the English message (no audio). Used when
   *  voice is off or synthesis failed — one animation, never two. */
  function startTextOnlyReveal(r: SystemResponse) {
    if (currentIdRef.current !== r.responseId) return;
    const duration = estimateReadMs(r.spokenScript) / 1000;
    const textTimeline = VoiceTimelineProvider.buildTimeline({
      responseId: r.responseId,
      responseType: r.responseType,
      label: r.systemLabel,
      message: r.message,
      spokenScript: r.spokenScript,
      audioDuration: duration,
      accent: r.accent,
      accent2: r.accent2
    });
    textTimeline.transcriptText = r.message;

    setIsPreparingVoice(false);
    setTimeline(textTimeline);
    setIsActive(true);
    setCurrentTimeSec(0);
    markTextOnlyReveal(duration * 1000);
    startAnimationLoop(textTimeline);
  }

  async function handle(
    r: SystemResponse,
    voiceOverride?: import('../../../shared/ipc').VoiceOption,
    options?: HandleOptions
  ) {
    interrupt();

    currentIdRef.current = r.responseId;
    setTranscriptText(r.message);
    setTtsNotice(null);

    // No voice → single text reveal immediately.
    if (!r.voice.enabled || typeof window.raphael?.speak !== 'function') {
      startTextOnlyReveal(r);
      return;
    }

    // Voice enabled → wait for synthesis and run ONE timeline built from the
    // actual spoken text (Japanese when the Japanese voice is selected), so
    // the answer never animates twice (English first, Japanese second).
    setIsPreparingVoice(true);
    try {
      await resumeAudioContext();
      const result: SpeakResult = await window.raphael.speak(r.spokenScript, voiceOverride);
      if (currentIdRef.current !== r.responseId) return;

      if (result && result.ok) {
        const audioBuffer = await decodeAudioBytes(result.audioBase64);
        if (currentIdRef.current !== r.responseId) return;
        if (!audioBuffer) {
          setTtsNotice('VOICE SYSTEM UNAVAILABLE');
          startTextOnlyReveal(r);
          return;
        }

        const displayText = result.japaneseText || r.message;
        const spokenScript = result.spokenText || r.spokenScript;

        const voiceTimeline = VoiceTimelineProvider.buildTimeline({
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
        // Subtitle follows the voice: what you read is what is being said.
        voiceTimeline.transcriptText = displayText;

        setIsPreparingVoice(false);
        setTimeline(voiceTimeline);
        setIsActive(true);
        setCurrentTimeSec(0);
        if (options?.playAudio === false) {
          // Animate in sync with the (externally playing) audio duration.
          markTextOnlyReveal(audioBuffer.duration * 1000);
        } else {
          setIsSpeaking(true);
          playDecodedBuffer(audioBuffer, () => {
            setIsSpeaking(false);
          });
        }
        startAnimationLoop(voiceTimeline);
      } else {
        setTtsNotice('VOICE SYSTEM UNAVAILABLE');
        startTextOnlyReveal(r);
      }
    } catch (err) {
      console.warn('[useResponseOrchestrator] TTS synthesis error:', err);
      if (currentIdRef.current === r.responseId) {
        setTtsNotice('VOICE SYSTEM UNAVAILABLE');
        startTextOnlyReveal(r);
      }
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
    isPreparingVoice,
    ttsNotice,
    transcriptText,
    handle,
    interrupt
  };
}
