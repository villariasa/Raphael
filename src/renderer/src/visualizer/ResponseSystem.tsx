import { useEffect, useRef, useState } from 'react';
import './responseSystem.css';
import { GLYPH_COLOR } from './responseClass';
import { ResponseTimeline, WordTimelineSegment } from '../response/types';

interface Props {
  timeline: ResponseTimeline | null;
  currentTimeSec: number;
  isPlaying: boolean;
  active: boolean;
  onDone?: () => void;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  alpha: number;
}

interface Shockwave {
  x: number;
  y: number;
  r: number;
  maxR: number;
  alpha: number;
  color: string;
}

export function ResponseSystem({
  timeline,
  currentTimeSec,
  isPlaying,
  active,
  onDone
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const shockwavesRef = useRef<Shockwave[]>([]);
  const lastActiveWordIdRef = useRef<string>('');
  const lastSentenceIndexRef = useRef<number>(-1);
  const [sentenceTransition, setSentenceTransition] = useState<string>('');

  const accent = timeline?.accent ?? '#49c7b4';
  const accent2 = timeline?.accent2 ?? '#3f7fd6';
  const label = timeline?.label ?? {
    kanji: '報告',
    romanized: 'HŌKOKU',
    english: 'REPORT',
    spokenIntro: 'Hōkoku. Report.',
    spokenJapanese: 'Hōkoku',
    spokenEnglish: 'Report'
  };

  const isClassificationPhase =
    active &&
    timeline &&
    currentTimeSec < timeline.classificationTiming.end;

  const isResponsePhase =
    active &&
    timeline &&
    currentTimeSec >= timeline.classificationTiming.end;

  // Find active sentence and active word
  let currentSentenceIndex = 0;
  let activeWord: WordTimelineSegment | null = null;
  let wordsInCurrentSentence: WordTimelineSegment[] = [];

  if (timeline && isResponsePhase) {
    for (let i = 0; i < timeline.sentences.length; i++) {
      const s = timeline.sentences[i];
      if (currentTimeSec >= s.start && currentTimeSec <= s.end + 0.3) {
        currentSentenceIndex = i;
        break;
      }
      if (currentTimeSec > s.end) {
        currentSentenceIndex = Math.min(timeline.sentences.length - 1, i);
      }
    }

    wordsInCurrentSentence = timeline.segments.filter(
      (w) => w.sentenceIndex === currentSentenceIndex
    );

    for (const w of wordsInCurrentSentence) {
      if (currentTimeSec >= w.start && currentTimeSec <= w.end + 0.15) {
        activeWord = w;
        break;
      }
    }
  }

  // Handle sentence transition triggering
  useEffect(() => {
    if (isResponsePhase && currentSentenceIndex !== lastSentenceIndexRef.current) {
      if (lastSentenceIndexRef.current !== -1 && timeline) {
        const prevSent = timeline.sentences[lastSentenceIndexRef.current];
        const trans = prevSent?.transition ?? 'transition-dissolve';
        setSentenceTransition(`transition-${trans}`);
        const timer = setTimeout(() => setSentenceTransition(''), 400);
        return () => clearTimeout(timer);
      }
      lastSentenceIndexRef.current = currentSentenceIndex;
    }
    return undefined;
  }, [currentSentenceIndex, isResponsePhase, timeline]);

  // Trigger shockwave on important words
  useEffect(() => {
    if (activeWord && activeWord.id !== lastActiveWordIdRef.current) {
      lastActiveWordIdRef.current = activeWord.id;
      if (activeWord.isKeyword || activeWord.importance >= 0.85) {
        const canvas = canvasRef.current;
        if (canvas) {
          shockwavesRef.current.push({
            x: canvas.width / 2,
            y: canvas.height / 2,
            r: 20,
            maxR: Math.min(canvas.width, canvas.height) * 0.45,
            alpha: 0.8,
            color: activeWord.emphasisType === 'critical' ? accent : accent2
          });
        }
      }
    }
  }, [activeWord, accent, accent2]);

  // Canvas visual rendering (Layers 1 & 2: Background & Geometry)
  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const w = () => canvas.width;
    const h = () => canvas.height;
    const rand = (min: number, max: number) => min + Math.random() * (max - min);

    const particles: Particle[] = Array.from({ length: 65 }, () => ({
      x: rand(0, w()),
      y: rand(0, h()),
      vx: rand(-0.35, 0.35) * dpr,
      vy: rand(-0.35, 0.35) * dpr,
      r: rand(0.8, 2.2) * dpr,
      alpha: rand(0.3, 0.75)
    }));

    let raf = 0;
    let angle = 0;

    const draw = () => {
      const W = w();
      const H = h();
      const cx = W / 2;
      const cy = H / 2;
      const maxR = Math.min(W, H) / 2;

      // Layer 1: Background Gradient
      const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR * 1.3);
      bg.addColorStop(0, '#0a121d');
      bg.addColorStop(0.55, '#050912');
      bg.addColorStop(1, '#020409');
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // Layer 2: Geometry (HUD Rings & Radar Scanning)
      ctx.globalCompositeOperation = 'lighter';
      angle += 0.003;

      // Radar sweep
      const sweepLen = maxR * 0.9;
      const sweepGrad = ctx.createLinearGradient(
        cx,
        cy,
        cx + Math.cos(angle) * sweepLen,
        cy + Math.sin(angle) * sweepLen
      );
      sweepGrad.addColorStop(0, hexA(accent, 0.3));
      sweepGrad.addColorStop(0.6, hexA(accent, 0.1));
      sweepGrad.addColorStop(1, hexA(accent, 0));
      ctx.strokeStyle = sweepGrad;
      ctx.lineWidth = 1.2 * dpr;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(angle) * sweepLen, cy + Math.sin(angle) * sweepLen);
      ctx.stroke();

      // Tactical concentric rings
      const ringRadii = [maxR * 0.35, maxR * 0.6, maxR * 0.85];
      for (let ri = 0; ri < ringRadii.length; ri++) {
        const r = ringRadii[ri];
        ctx.strokeStyle = hexA(ri === 1 ? accent : accent2, 0.16);
        ctx.lineWidth = 1 * dpr;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();

        // Ticks on outer ring
        if (ri === 2) {
          const tickCount = 48;
          for (let ti = 0; ti < tickCount; ti++) {
            const ta = (ti / tickCount) * Math.PI * 2 + angle * 0.5;
            const tlen = ti % 4 === 0 ? 9 * dpr : 4 * dpr;
            const tx1 = cx + Math.cos(ta) * (r - tlen);
            const ty1 = cy + Math.sin(ta) * (r - tlen);
            const tx2 = cx + Math.cos(ta) * r;
            const ty2 = cy + Math.sin(ta) * r;
            ctx.strokeStyle = hexA('#ffffff', ti % 4 === 0 ? 0.35 : 0.15);
            ctx.beginPath();
            ctx.moveTo(tx1, ty1);
            ctx.lineTo(tx2, ty2);
            ctx.stroke();
          }
        }
      }

      // Draw and update Shockwaves
      for (let i = shockwavesRef.current.length - 1; i >= 0; i--) {
        const sw = shockwavesRef.current[i];
        sw.r += 6 * dpr;
        sw.alpha -= 0.025;
        if (sw.alpha <= 0 || sw.r >= sw.maxR) {
          shockwavesRef.current.splice(i, 1);
        } else {
          ctx.strokeStyle = hexA(sw.color, sw.alpha);
          ctx.lineWidth = 2.5 * dpr;
          ctx.beginPath();
          ctx.arc(sw.x, sw.y, sw.r, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // Ambient Floating Particles
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0) p.x = W;
        if (p.x > W) p.x = 0;
        if (p.y < 0) p.y = H;
        if (p.y > H) p.y = 0;

        ctx.fillStyle = hexA('#d2ecff', p.alpha);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [active, accent, accent2]);

  if (!active || !timeline) return null;

  const rootStyle = {
    ['--rsx-glyph' as string]: GLYPH_COLOR,
    ['--rsx-accent' as string]: accent,
    ['--rsx-accent2' as string]: accent2
  } as React.CSSProperties;

  return (
    <div className="rsx-root" style={rootStyle} aria-hidden="true">
      <canvas ref={canvasRef} className="rsx-canvas" />

      {/* Layer 6: HUD Context Readout */}
      <div className="rsx-hud-header rsx-mono">
        <div className="rsx-hud-tag">
          <span className="rsx-hud-pulse" />
          <span>RAPHAEL SYSTEM // SYNCHRONIZED</span>
        </div>
        <div className="rsx-hud-tag">
          <span>CLASSIFICATION: [ {label.kanji} // {label.romanized} ]</span>
        </div>
        {timeline.sentences.length > 1 && isResponsePhase && (
          <div className="rsx-hud-sentence-counter">
            PHRASE {currentSentenceIndex + 1} OF {timeline.sentences.length}
          </div>
        )}
      </div>

      {/* Layer 3: Animated Classification Phase */}
      {isClassificationPhase && (
        <div className="rsx-classification-container">
          <div className="rsx-kanji-wrap">
            {Array.from(label.kanji).map((char, idx) => (
              <span
                key={idx}
                className="rsx-kanji-char rsx-glyphfont"
                style={{
                  animationDelay: `${idx * 0.15}s`
                }}
              >
                {char}
              </span>
            ))}
          </div>
          <div className="rsx-classification-romaji rsx-serif">
            {label.romanized}
          </div>
          <div className="rsx-classification-english rsx-serif">
            {label.english}
          </div>
          <div className="rsx-speech-indicator rsx-mono">
            {currentTimeSec >= timeline.classificationTiming.voiceJapaneseStart &&
            currentTimeSec <= timeline.classificationTiming.voiceJapaneseEnd ? (
              <span>VOICE: "{label.spokenJapanese}"</span>
            ) : currentTimeSec >= timeline.classificationTiming.voiceEnglishStart &&
              currentTimeSec <= timeline.classificationTiming.voiceEnglishEnd ? (
              <span>VOICE: "{label.spokenEnglish}"</span>
            ) : (
              <span>SYNCHRONIZING AUDIO...</span>
            )}
          </div>
        </div>
      )}

      {/* Layers 4 & 5: Spoken Response Word/Phrase Formations */}
      {isResponsePhase && (
        <div className="rsx-response-stage">
          <div className={`rsx-sentence-container ${sentenceTransition}`}>
            {wordsInCurrentSentence.map((word) => {
              const isWordPending = currentTimeSec < word.start;
              const isWordActive =
                currentTimeSec >= word.start && currentTimeSec <= word.end + 0.15;
              const isWordPast = currentTimeSec > word.end + 0.15;

              const statusClass = isWordActive
                ? 'active'
                : isWordPast
                ? 'past'
                : 'pending';

              return (
                <div
                  key={word.id}
                  className={`rsx-word-box formation-${word.formation} emphasis-${word.emphasisType} ${statusClass}`}
                >
                  <span className="rsx-word-text">{word.text}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* English Subtitle Bar (The only English when animating Japanese text) */}
      {isResponsePhase && timeline.transcriptText && (
        <div className="rsx-hud-subtitle rsx-serif">
          <span className="rsx-hud-subtitle-tag rsx-mono">SUBTITLE //</span>
          <span>{timeline.transcriptText}</span>
        </div>
      )}
    </div>
  );
}

function hexA(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16) || 0;
  const g = parseInt(h.substring(2, 4), 16) || 0;
  const b = parseInt(h.substring(4, 6), 16) || 0;
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
}
