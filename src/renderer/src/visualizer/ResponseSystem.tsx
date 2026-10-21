import { useEffect, useRef, useState } from 'react';
import './responseSystem.css';
import { CLASS_INFO, GLYPH_COLOR, ResponseClass } from './responseClass';

interface Props {
  /** bump to play a fresh sequence; 0 = idle (nothing shown) */
  trigger: number;
  responseClass: ResponseClass;
  /**
   * 'quick' — a brief classification flash (~1s) for instant/trivial replies.
   * 'full'  — the complete sequence (~2.4s) when real processing/action happened.
   */
  mode?: 'quick' | 'full';
  /** fires when the overlay begins fading out, so the real answer can reveal */
  onRevealStart?: () => void;
  onDone?: () => void;
}

type Phase = 'idle' | 'activation' | 'classification' | 'processing' | 'fading';

interface Particle { x: number; y: number; vx: number; vy: number; r: number; }
interface Fragment { x: number; y: number; ang: number; vang: number; size: number; vx: number; vy: number; }

const prefersReduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

interface Durations { act: number; cls: number; proc: number; fade: number; }

function durationsFor(mode: 'quick' | 'full'): Durations {
  if (prefersReduced) return { act: 100, cls: 240, proc: 140, fade: 160 };
  if (mode === 'quick') return { act: 150, cls: 430, proc: 170, fade: 300 };
  return { act: 480, cls: 640, proc: 820, fade: 500 };
}

export function ResponseSystem({ trigger, responseClass, mode = 'full', onRevealStart, onDone }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [glitch, setGlitch] = useState(false);

  const info = CLASS_INFO[responseClass] ?? CLASS_INFO.hokoku;

  // Durations depend on mode; read via a ref so the trigger/canvas effects
  // always use the mode set for the current play without re-subscribing.
  const dRef = useRef<Durations>(durationsFor(mode));
  dRef.current = durationsFor(mode);

  // Drive the whole sequence off `trigger`.
  useEffect(() => {
    if (!trigger) return;
    const D = dRef.current;
    let alive = true;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const at = (ms: number, fn: () => void) => timers.push(setTimeout(() => alive && fn(), ms));

    setPhase('activation');
    setGlitch(false);
    at(D.act, () => setPhase('classification'));
    at(D.act + Math.min(180, D.cls * 0.3), () => setGlitch(true));
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

  // Energy field canvas — procedural (particles, rays, rings, fragments,
  // chromatic aberration), intensity ramps across the phases.
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

    const particles: Particle[] = Array.from({ length: 70 }, () => ({
      x: rand(0, w()), y: rand(0, h()), vx: rand(-0.2, 0.2), vy: rand(-0.2, 0.2), r: rand(0.4, 1.8) * dpr
    }));
    const fragments: Fragment[] = Array.from({ length: 14 }, () => ({
      x: rand(0, w()), y: rand(0, h()), ang: rand(0, Math.PI * 2), vang: rand(-0.02, 0.02),
      size: rand(5, 16) * dpr, vx: rand(-0.3, 0.3), vy: rand(-0.3, 0.3)
    }));

    const start = performance.now();
    let raf = 0;

    const phaseAt = (t: number): { k: number } => {
      // k = overall energy intensity 0..1
      const D = dRef.current;
      if (t < D.act) return { k: 0.15 + 0.2 * (t / D.act) };
      if (t < D.act + D.cls) return { k: 0.4 };
      if (t < D.act + D.cls + D.proc) {
        const p = (t - D.act - D.cls) / D.proc;
        const eased = 1 - Math.pow(1 - p, 3);
        return { k: 0.45 + 0.55 * eased };
      }
      return { k: 1 };
    };

    const draw = (now: number) => {
      const t = now - start;
      const { k } = phaseAt(t);
      const W = w(), H = h();
      const cx = W / 2, cy = H / 2;
      const maxR = Math.min(W, H) / 2;

      // deep navy ground
      const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR * 1.3);
      bg.addColorStop(0, '#0a1017');
      bg.addColorStop(0.55, '#050810');
      bg.addColorStop(1, '#02040a');
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      ctx.globalCompositeOperation = 'lighter';

      // radial rays
      const rayCount = 40;
      const rot = t * 0.00008;
      for (let i = 0; i < rayCount; i++) {
        const a = (i / rayCount) * Math.PI * 2 + rot;
        const vari = 0.6 + 0.4 * Math.sin(i * 12.9898 + t * 0.002);
        const len = maxR * (0.2 + 0.85 * k) * vari;
        const grad = ctx.createLinearGradient(cx, cy, cx + Math.cos(a) * len, cy + Math.sin(a) * len);
        grad.addColorStop(0, hexA('#ffffff', 0.18 * k));
        grad.addColorStop(0.2, hexA(info.accent, 0.12 * k));
        grad.addColorStop(1, hexA(info.accent, 0));
        ctx.strokeStyle = grad;
        ctx.lineWidth = dpr * (0.6 + k);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
        ctx.stroke();
      }

      // expanding rings with chromatic aberration
      for (let ri = 0; ri < 2; ri++) {
        const pulse = ((t * 0.00035 + ri * 0.5) % 1);
        const r = maxR * (0.2 + ri * 0.18 + pulse * 0.5 * k);
        const alpha = (0.28 - pulse * 0.22) * (0.4 + k);
        strokeRingChromatic(ctx, cx, cy, r, info.accent, alpha, dpr);
      }

      // particles (accelerate radially with k)
      for (const p of particles) {
        const dx = p.x - cx, dy = p.y - cy;
        const burst = k * 0.6;
        p.x += p.vx * dpr + (dx / (maxR + 1)) * burst * dpr;
        p.y += p.vy * dpr + (dy / (maxR + 1)) * burst * dpr;
        if (p.x < 0) p.x = W; if (p.x > W) p.x = 0;
        if (p.y < 0) p.y = H; if (p.y > H) p.y = 0;
        ctx.fillStyle = hexA('#cfe8ff', 0.25 + 0.5 * k);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }

      // translucent drifting squares / fragments
      ctx.lineWidth = dpr;
      for (const f of fragments) {
        f.x += f.vx * dpr * (0.5 + k); f.y += f.vy * dpr * (0.5 + k); f.ang += f.vang;
        if (f.x < -40) f.x = W + 40; if (f.x > W + 40) f.x = -40;
        if (f.y < -40) f.y = H + 40; if (f.y > H + 40) f.y = -40;
        ctx.save();
        ctx.translate(f.x, f.y);
        ctx.rotate(f.ang);
        ctx.strokeStyle = hexA(info.accent2, 0.1 + 0.22 * k);
        ctx.fillStyle = hexA(info.accent2, 0.03 + 0.05 * k);
        ctx.beginPath();
        ctx.rect(-f.size / 2, -f.size / 2, f.size, f.size);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [phase === 'idle', info.accent, info.accent2]);

  if (phase === 'idle') return null;

  const classActive = phase === 'classification' || phase === 'processing' || phase === 'fading';
  const rootStyle = {
    ['--rsx-glyph' as string]: GLYPH_COLOR,
    ['--rsx-accent' as string]: info.accent
  } as React.CSSProperties;

  return (
    <div ref={rootRef} className={`rsx-root${phase === 'fading' ? ' fading' : ''}`} style={rootStyle} aria-hidden="true">
      <canvas ref={canvasRef} className="rsx-canvas" />
      {classActive && (
        <>
          <div className={`rsx-class enter${glitch ? ' glitch' : ''}`}>
            <div className="rsx-diamond">
              <span className="rsx-kanji">{info.kanji}</span>
              <span className="rsx-sweep" />
            </div>
            <span className="rsx-romaji">{info.romaji}</span>
            <span className="rsx-english">{info.english}</span>
          </div>
          {phase === 'processing' && <div className="rsx-vertical">処理中</div>}
        </>
      )}
    </div>
  );
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
