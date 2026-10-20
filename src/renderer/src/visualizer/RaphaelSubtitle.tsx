import { useEffect, useRef, useState } from 'react';
import { getSpeechProgress } from './useAudioReactive';
import { buildTokens, visibleSubtitle, SubtitleToken } from './subtitle';

interface Props {
  /** The utterance currently being spoken, or null when nothing is. */
  text: string | null;
  /** Increments on every new speak() call so a fresh/interrupting utterance resets instantly. */
  nonce: number;
  className?: string;
}

type Phase = 'idle' | 'playing' | 'holding' | 'fading';

const HOLD_MS_FINISHED = 1300;
const HOLD_MS_INTERRUPTED = 400;
const FADE_MS = 550;

/**
 * Live, voice-synced subtitle (anime/assistant style). Reveals words in step
 * with the ACTUAL TTS playback clock (not a fixed typing speed), keeps only a
 * rolling ~1–2 line window, stops instantly on interruption, and holds then
 * fades on a natural finish.
 */
export function RaphaelSubtitle({ text, nonce, className }: Props) {
  const [display, setDisplay] = useState('');
  const [opacity, setOpacity] = useState(0);

  const tokensRef = useRef<SubtitleToken[]>([]);
  const phaseRef = useRef<Phase>('idle');
  const phaseStart = useRef(0);
  const holdMs = useRef(HOLD_MS_FINISHED);
  const lastProgress = useRef(0);

  // New utterance (or interruption-by-null) resets the subtitle immediately.
  useEffect(() => {
    tokensRef.current = text ? buildTokens(text) : [];
    lastProgress.current = 0;
    if (text) {
      phaseRef.current = 'playing';
      setDisplay('');
      setOpacity(1);
    } else {
      phaseRef.current = 'idle';
      setDisplay('');
      setOpacity(0);
    }
  }, [text, nonce]);

  // Single rAF loop reads the real playback clock each frame.
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const { progress, playing } = getSpeechProgress();
      const phase = phaseRef.current;

      if (phase === 'playing') {
        if (playing) {
          lastProgress.current = progress;
          const vis = visibleSubtitle(tokensRef.current, progress);
          setDisplay((prev) => (prev === vis ? prev : vis));
          setOpacity(1);
        } else {
          // Speech just stopped — natural finish vs. interruption.
          const finished = lastProgress.current >= 0.97;
          const finalProgress = finished ? 1 : lastProgress.current;
          setDisplay(visibleSubtitle(tokensRef.current, finalProgress));
          holdMs.current = finished ? HOLD_MS_FINISHED : HOLD_MS_INTERRUPTED;
          phaseRef.current = 'holding';
          phaseStart.current = performance.now();
        }
      } else if (phase === 'holding') {
        if (performance.now() - phaseStart.current > holdMs.current) {
          phaseRef.current = 'fading';
          phaseStart.current = performance.now();
        }
      } else if (phase === 'fading') {
        const t = (performance.now() - phaseStart.current) / FADE_MS;
        if (t >= 1) {
          setOpacity(0);
          setDisplay('');
          phaseRef.current = 'idle';
        } else {
          setOpacity(1 - t);
        }
      }

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  if (!display) return null;

  return (
    <div
      className={className}
      style={{
        opacity,
        transition: 'opacity 120ms linear',
        maxWidth: '82%',
        textAlign: 'center',
        fontSize: 'clamp(15px, 2.1vw, 22px)',
        lineHeight: 1.4,
        fontWeight: 500,
        letterSpacing: '0.01em',
        color: '#ffffff',
        textShadow: '0 0 10px rgba(0,0,0,0.85), 0 1px 3px rgba(0,0,0,0.9), 0 0 22px rgba(255, 210, 140, 0.25)',
        pointerEvents: 'none'
      }}
    >
      {display}
    </div>
  );
}
