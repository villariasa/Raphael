import { useEffect, useRef, useState } from 'react';
import './responseSystem.css';
import { GLYPH_COLOR } from './responseClass';
import { SystemResponse } from '../response/types';
import { timingFor, FormationTiming } from '../response/formationEngine';

interface Props {
  /** bump to play a fresh sequence; 0 = idle (nothing shown) */
  trigger: number;
  response: SystemResponse | null;
  /** fires when the overlay begins fading out, so the real answer can reveal */
  onRevealStart?: () => void;
  onDone?: () => void;
}

type Phase = 'idle' | 'activation' | 'classification' | 'processing' | 'fading';

interface Particle { x: number; y: number; vx: number; vy: number; r: number; }
interface Fragment { x: number; y: number; ang: number; vang: number; size: number; vx: number; vy: number; }

const prefersReduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const ENERGY_BY_INTENSITY = { low: 0.6, medium: 0.82, high: 1 } as const;

export function ResponseSystem({ trigger, response, onRevealStart, onDone }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [glitch, setGlitch] = useState(false);

  const intensity = response?.animation.intensity ?? 'medium';
  const formation = response?.animation.formation ?? 'stacked';
  const accent = response?.accent ?? '#49c7b4';
  const accent2 = response?.accent2 ?? '#3f7fd6';
  const label = response?.systemLabel ?? { kanji: '報告', romanized: 'HŌKOKU', english: 'REPORT' };
  const energyMax = ENERGY_BY_INTENSITY[intensity];

  const dRef = useRef<FormationTiming>(timingFor(intensity, prefersReduced));
  dRef.current = timingFor(intensity, prefersReduced);
  const energyRef = useRef(energyMax);
  energyRef.current = energyMax;
  const accentRef = useRef({ a: accent, b: accent2 });
  accentRef.current = { a: accent, b: accent2 };

  // Timeline, driven off `trigger`.
  useEffect(() => {
    if (!trigger) return;
    const D = dRef.current;
    let alive = true;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const at = (ms: number, fn: () => void) => timers.push(setTimeout(() => alive && fn(), ms));

    setPhase('activation');
    setGlitch(false);
    at(D.act, () => setPhase('classification'));
    at(D.act + Math.min(170, D.cls * 0.3), () => setGlitch(true));
    at(D.act + D.cls * 0.8, () => setGlitch(false));
    at(D.act + D.cls, () => setPhase('processing'));
    at(D.act + D.cls + D.proc, () => {
      setPhase('fading');
      onRevealStart?.();
    });
    at(D.act + D.cls + D.proc + D.fade, () => {
      setPhase('idle');
      onDone?.();
    });
    return () => {
      alive = false;
      timers.forEach(clearTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);

  // Energy field (shared across formations).
  useEffect(() => {
    if (phase === 'idle') return;
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
    const rand = (a: number, b: number) => a + Math.random() * (b - a);
    const particles: Particle[] = Array.from({ length: 70 }, () => ({ x: rand(0, w()), y: rand(0, h()), vx: rand(-0.2, 0.2), vy: rand(-0.2, 0.2), r: rand(0.4, 1.8) * dpr }));
    const fragments: Fragment[] = Array.from({ length: 14 }, () => ({ x: rand(0, w()), y: rand(0, h()), ang: rand(0, Math.PI * 2), vang: rand(-0.02, 0.02), size: rand(5, 16) * dpr, vx: rand(-0.3, 0.3), vy: rand(-0.3, 0.3) }));

    const start = performance.now();
    let raf = 0;
    const phaseAt = (t: number): number => {
      const D = dRef.current;
      const cap = energyRef.current;
      if (t < D.act) return cap * (0.25 + 0.25 * (t / D.act));
      if (t < D.act + D.cls) return cap * 0.55;
      if (t < D.act + D.cls + D.proc) {
        const p = (t - D.act - D.cls) / D.proc;
        return cap * (0.6 + 0.4 * (1 - Math.pow(1 - p, 3)));
      }
      return cap;
    };

    const draw = (now: number) => {
      const t = now - start;
      const k = phaseAt(t);
      const { a: acc, b: acc2 } = accentRef.current;
      const W = w(), H = h(), cx = W / 2, cy = H / 2, maxR = Math.min(W, H) / 2;

      const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR * 1.3);
      bg.addColorStop(0, '#0a1017'); bg.addColorStop(0.55, '#050810'); bg.addColorStop(1, '#02040a');
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';

      const rayCount = 40;
      const rot = t * 0.00008;
      for (let i = 0; i < rayCount; i++) {
        const a = (i / rayCount) * Math.PI * 2 + rot;
        const vari = 0.6 + 0.4 * Math.sin(i * 12.9898 + t * 0.002);
        const len = maxR * (0.2 + 0.85 * k) * vari;
        const grad = ctx.createLinearGradient(cx, cy, cx + Math.cos(a) * len, cy + Math.sin(a) * len);
        grad.addColorStop(0, hexA('#ffffff', 0.18 * k));
        grad.addColorStop(0.2, hexA(acc, 0.12 * k));
        grad.addColorStop(1, hexA(acc, 0));
        ctx.strokeStyle = grad; ctx.lineWidth = dpr * (0.6 + k);
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len); ctx.stroke();
      }
      for (let ri = 0; ri < 2; ri++) {
        const pulse = ((t * 0.00035 + ri * 0.5) % 1);
        const r = maxR * (0.2 + ri * 0.18 + pulse * 0.5 * k);
        strokeRingChromatic(ctx, cx, cy, r, acc, (0.28 - pulse * 0.22) * (0.4 + k), dpr);
      }
      for (const p of particles) {
        const dx = p.x - cx, dy = p.y - cy, burst = k * 0.6;
        p.x += p.vx * dpr + (dx / (maxR + 1)) * burst * dpr;
        p.y += p.vy * dpr + (dy / (maxR + 1)) * burst * dpr;
        if (p.x < 0) p.x = W; if (p.x > W) p.x = 0; if (p.y < 0) p.y = H; if (p.y > H) p.y = 0;
        ctx.fillStyle = hexA('#cfe8ff', 0.25 + 0.5 * k);
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.lineWidth = dpr;
      for (const f of fragments) {
        f.x += f.vx * dpr * (0.5 + k); f.y += f.vy * dpr * (0.5 + k); f.ang += f.vang;
        if (f.x < -40) f.x = W + 40; if (f.x > W + 40) f.x = -40; if (f.y < -40) f.y = H + 40; if (f.y > H + 40) f.y = -40;
        ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(f.ang);
        ctx.strokeStyle = hexA(acc2, 0.1 + 0.22 * k); ctx.fillStyle = hexA(acc2, 0.03 + 0.05 * k);
        ctx.beginPath(); ctx.rect(-f.size / 2, -f.size / 2, f.size, f.size); ctx.fill(); ctx.stroke(); ctx.restore();
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [phase === 'idle']);

  if (phase === 'idle') return null;

  const showLabel = phase === 'classification' || phase === 'processing' || phase === 'fading';
  const rootStyle = { ['--rsx-glyph' as string]: GLYPH_COLOR, ['--rsx-accent' as string]: accent } as React.CSSProperties;

  return (
    <div className={`rsx-root${phase === 'fading' ? ' fading' : ''}`} style={rootStyle} aria-hidden="true">
      <canvas ref={canvasRef} className="rsx-canvas" />
      {showLabel && (
        <Formation formation={formation} label={label} glitch={glitch} />
      )}
      {phase === 'processing' && <div className="rsx-vlabel rsx-glyphfont">処理中</div>}
    </div>
  );
}

// --- formation renderers ----------------------------------------------

function Formation({ formation, label, glitch }: { formation: string; label: { kanji: string; romanized: string; english: string }; glitch: boolean }) {
  const chars = Array.from(label.kanji);
  const enter = `rsx-layer rsx-enter${glitch ? ' rsx-glitch' : ''}`;
  const kanji = (extra?: (i: number) => React.CSSProperties) =>
    chars.map((c, i) => (
      <span key={i} className="rsx-kanji-char rsx-glyphfont" style={{ ['--d' as string]: `${i * 0.12}s`, ...(extra?.(i) ?? {}) }}>
        {c}
      </span>
    ));

  switch (formation) {
    case 'horizontal':
      return (
        <div className={`${enter} rsx-horizontal`}>
          <div className="rsx-row">{kanji()}</div>
          <div className="rsx-rule" />
          <span className="rsx-romaji rsx-serif">{label.romanized}</span>
          <span className="rsx-english rsx-serif">{label.english}</span>
        </div>
      );
    case 'vertical':
      return (
        <div className={`${enter} rsx-vertical`}>
          <div className="rsx-col">{kanji()}</div>
          <span className="rsx-romaji rsx-serif">{label.romanized}</span>
          <span className="rsx-english rsx-serif">{label.english}</span>
        </div>
      );
    case 'radial': {
      const letters = Array.from(label.romanized.replace(/\s+/g, ''));
      const radius = 118;
      return (
        <div className={`${enter} rsx-radial`}>
          {letters.map((ch, i) => {
            const ang = (i / letters.length) * Math.PI * 2 - Math.PI / 2;
            const x = Math.cos(ang) * radius;
            const y = Math.sin(ang) * radius;
            return (
              <span
                key={i}
                className="rsx-ring-letter"
                style={{ transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`, ['--d' as string]: `${0.1 + i * 0.05}s` }}
              >
                {ch}
              </span>
            );
          })}
          <div className="rsx-center">
            <div style={{ display: 'flex' }}>{kanji()}</div>
            <span className="rsx-english rsx-serif">{label.english}</span>
          </div>
        </div>
      );
    }
    case 'assembly':
      return (
        <div className={`${enter} rsx-assembly`}>
          <div className="rsx-row">
            {kanji((i) => ({
              ['--fx' as string]: `${(i % 2 === 0 ? -1 : 1) * (50 + i * 18)}px`,
              ['--fy' as string]: `${(i % 2 === 0 ? -1 : 1) * 36}px`,
              ['--d' as string]: `${i * 0.1}s`
            }))}
          </div>
          <span className="rsx-romaji rsx-serif">{label.romanized}</span>
          <span className="rsx-english rsx-serif">{label.english}</span>
        </div>
      );
    case 'stacked':
    default:
      return (
        <div className={`${enter} rsx-stacked`}>
          <div className="rsx-diamond">
            <div style={{ display: 'flex' }}>{kanji()}</div>
            <span className="rsx-sweep" />
          </div>
          <span className="rsx-romaji rsx-serif">{label.romanized}</span>
          <span className="rsx-english rsx-serif">{label.english}</span>
        </div>
      );
  }
}

function hexA(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
}

function strokeRingChromatic(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, accent: string, alpha: number, dpr: number) {
  const off = 1.4 * dpr;
  ctx.lineWidth = dpr;
  ctx.strokeStyle = `rgba(229, 102, 77, ${alpha * 0.5})`;
  ctx.beginPath(); ctx.arc(cx + off, cy, r, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = `rgba(74, 199, 180, ${alpha * 0.5})`;
  ctx.beginPath(); ctx.arc(cx - off, cy, r, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = hexA(accent, alpha);
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
}
