import { AudioBands, QualityTier, RaphaelState, VisualizerTunables, GLYPH_RING_WORDS } from './types';

interface StateMotion {
  energy: number;
  ringSpeed: number;
  outerSpeed: number;
  rayBoost: number;
  particleSpeed: number;
  pulseAmplitude: number;
  pulseSpeed: number;
  tint: 'gold' | 'amber' | 'red';
  scanning: boolean;
  flicker: boolean;
}

const STATE_MOTION: Record<RaphaelState, StateMotion> = {
  idle: { energy: 0.5, ringSpeed: 0.02, outerSpeed: 0.01, rayBoost: 0.6, particleSpeed: 0.25, pulseAmplitude: 0.025, pulseSpeed: 0.18, tint: 'gold', scanning: false, flicker: false },
  listening: { energy: 0.65, ringSpeed: 0.035, outerSpeed: 0.018, rayBoost: 0.8, particleSpeed: 0.35, pulseAmplitude: 0.04, pulseSpeed: 0.3, tint: 'gold', scanning: false, flicker: false },
  thinking: { energy: 0.6, ringSpeed: 0.025, outerSpeed: 0.012, rayBoost: 0.7, particleSpeed: 0.3, pulseAmplitude: 0.03, pulseSpeed: 0.22, tint: 'amber', scanning: true, flicker: false },
  researching: { energy: 0.75, ringSpeed: 0.06, outerSpeed: 0.03, rayBoost: 0.85, particleSpeed: 0.5, pulseAmplitude: 0.035, pulseSpeed: 0.35, tint: 'amber', scanning: false, flicker: true },
  waiting_for_permission: { energy: 0.45, ringSpeed: 0.015, outerSpeed: 0.008, rayBoost: 0.4, particleSpeed: 0.2, pulseAmplitude: 0.05, pulseSpeed: 0.15, tint: 'amber', scanning: false, flicker: false },
  executing: { energy: 0.85, ringSpeed: 0.07, outerSpeed: 0.035, rayBoost: 1.0, particleSpeed: 0.7, pulseAmplitude: 0.04, pulseSpeed: 0.45, tint: 'gold', scanning: false, flicker: false },
  speaking: { energy: 0.8, ringSpeed: 0.04, outerSpeed: 0.02, rayBoost: 0.9, particleSpeed: 0.5, pulseAmplitude: 0.04, pulseSpeed: 0.35, tint: 'gold', scanning: false, flicker: false },
  completed: { energy: 0.75, ringSpeed: 0.03, outerSpeed: 0.015, rayBoost: 0.75, particleSpeed: 0.4, pulseAmplitude: 0.03, pulseSpeed: 0.25, tint: 'gold', scanning: false, flicker: false },
  error: { energy: 0.5, ringSpeed: 0.01, outerSpeed: 0.005, rayBoost: 0.4, particleSpeed: 0.2, pulseAmplitude: 0.04, pulseSpeed: 0.2, tint: 'red', scanning: false, flicker: false }
};

const TINTS = {
  gold: {
    coreHot: '#ffffff',
    coreHalo: '#ffdc8a',
    coronaInner: 'rgba(255, 196, 77, 0.85)',
    coronaMid: 'rgba(255, 154, 34, 0.45)',
    coronaOuter: 'rgba(255, 130, 20, 0)',
    polyStroke: '#ffffff',
    polyGlow: 'rgba(255, 255, 255, 0.9)',
    glyphText: '#ffa83b',
    glyphGlow: '#f59e0b',
    ringLine: 'rgba(235, 165, 60, 0.28)',
    spokeLine: 'rgba(235, 165, 60, 0.14)',
    starParticle: '#ffdca3'
  },
  amber: {
    coreHot: '#ffffff',
    coreHalo: '#ffcf7a',
    coronaInner: 'rgba(255, 175, 55, 0.85)',
    coronaMid: 'rgba(240, 130, 30, 0.45)',
    coronaOuter: 'rgba(240, 100, 15, 0)',
    polyStroke: '#ffffff',
    polyGlow: 'rgba(255, 255, 255, 0.9)',
    glyphText: '#ff982b',
    glyphGlow: '#e67e17',
    ringLine: 'rgba(225, 145, 45, 0.28)',
    spokeLine: 'rgba(225, 145, 45, 0.14)',
    starParticle: '#ffc98a'
  },
  red: {
    coreHot: '#ffffff',
    coreHalo: '#ff9e8a',
    coronaInner: 'rgba(245, 90, 70, 0.85)',
    coronaMid: 'rgba(215, 45, 50, 0.45)',
    coronaOuter: 'rgba(180, 25, 30, 0)',
    polyStroke: '#ffdede',
    polyGlow: 'rgba(255, 120, 120, 0.9)',
    glyphText: '#ff6b5e',
    glyphGlow: '#e5484d',
    ringLine: 'rgba(215, 75, 75, 0.28)',
    spokeLine: 'rgba(215, 75, 75, 0.14)',
    starParticle: '#ff9b8a'
  }
};

export interface FrameParticle {
  angle: number;
  radiusFrac: number;
  speed: number;
  size: number;
  twinkle: number;
}

export function makeParticles(count: number): FrameParticle[] {
  return Array.from({ length: count }, () => ({
    angle: Math.random() * Math.PI * 2,
    radiusFrac: 0.15 + Math.random() * 0.85,
    speed: 0.02 + Math.random() * 0.08,
    size: 0.7 + Math.random() * 1.5,
    twinkle: Math.random() * Math.PI * 2
  }));
}

/** 8-sided faceted crystal polygon offsets extracted from reference: raphael.png */
const FACET_OFFSETS = [
  { angle: -Math.PI * 0.5, rFactor: 1.05 },      // top
  { angle: -Math.PI * 0.28, rFactor: 1.16 },     // top-right
  { angle: -Math.PI * 0.04, rFactor: 0.92 },     // right
  { angle: Math.PI * 0.18, rFactor: 1.04 },      // bottom-right
  { angle: Math.PI * 0.5, rFactor: 1.22 },       // bottom apex (distinctive sharp point)
  { angle: Math.PI * 0.73, rFactor: 0.95 },      // bottom-left
  { angle: Math.PI, rFactor: 1.15 },             // left apex (distinctive sharp point)
  { angle: -Math.PI * 0.76, rFactor: 1.06 }      // top-left
];

function safeR(r: number, fallback = 1): number {
  return Number.isFinite(r) && r > 0.001 ? r : fallback;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Draw circular word ring following the circumference path cleanly.
 * Matches the orientation and spacing of glyphs in raphael.png.
 */
function drawWordRing(
  ctx: CanvasRenderingContext2D,
  words: string[],
  radius: number,
  rotation: number,
  fontPx: number,
  color: string,
  alpha: number
) {
  const safeRadius = safeR(radius, 50);
  const wordCount = words.length;
  const anglePerSlot = (Math.PI * 2) / wordCount;
  const charAngle = (fontPx * 0.65) / safeRadius;

  ctx.save();
  ctx.font = `600 ${fontPx}px "Segoe UI", "Inter", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.globalAlpha = clamp01(alpha);

  for (let w = 0; w < wordCount; w++) {
    const word = words[w];
    const centerAngle = rotation + w * anglePerSlot;
    const startOffset = -((word.length - 1) / 2) * charAngle;

    for (let c = 0; c < word.length; c++) {
      const ch = word[c];
      if (ch === ' ') continue;
      const a = centerAngle + startOffset + c * charAngle;
      ctx.save();
      ctx.rotate(a);
      ctx.translate(0, -safeRadius);
      // Tangent to the circle arc
      ctx.fillText(ch, 0, 0);
      ctx.restore();
    }
  }
  ctx.restore();
}

export interface DrawParams {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  tSec: number;
  state: RaphaelState;
  audio: AudioBands;
  tunables: VisualizerTunables;
  quality: QualityTier;
  particles: FrameParticle[];
  /** seconds since the last COMPLETED transition, or null if none pending */
  completionPulseAge: number | null;
}

export function drawFrame(p: DrawParams): void {
  const { ctx, width, height, tSec, state, audio, tunables, quality, particles, completionPulseAge } = p;
  if (!width || !height || width <= 0 || height <= 0) return;

  const motion = STATE_MOTION[state] || STATE_MOTION.idle;
  const tint = TINTS[motion.tint] || TINTS.gold;
  const cx = width / 2;
  const cy = height / 2;
  const maxR = safeR(Math.min(width, height) / 2, 100);

  // Bulletproof state protection: guarantee clean source-over and identity transform on entry and exit
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1.0;

  try {
    // 1. Pristine Cosmic Void Background
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#020305';
    ctx.fillRect(0, 0, width, height);

    // Subtle radial depth gradient in the center
    const bgGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR * 1.3);
    bgGrad.addColorStop(0, '#090d14');
    bgGrad.addColorStop(0.5, '#05070a');
    bgGrad.addColorStop(1, '#020305');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);

    // 2. Star Dust Particles (Twinkling cosmic specks)
    ctx.save();
    ctx.translate(cx, cy);
    const audioTwinkle = (audio.treble || 0) * tunables.audioSensitivity * 0.4;
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const drift = tSec * p.speed * motion.particleSpeed;
      const angle = p.angle + drift;
      const r = p.radiusFrac * maxR * 1.2;
      const x = Math.cos(angle) * r;
      const y = Math.sin(angle) * r;
      const twinkle = 0.4 + 0.6 * Math.sin(tSec * 2.5 + p.twinkle + audioTwinkle);
      const size = Math.max(0.4, p.size * tunables.particleDensity * (0.8 + twinkle * 0.4));
      ctx.globalAlpha = clamp01(0.12 + twinkle * 0.45);
      ctx.fillStyle = r < maxR * 0.5 ? tint.starParticle : '#dce8f5';
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // 3. Delicate Concentric Compass / Orbit Rings
    ctx.save();
    ctx.translate(cx, cy);
    const ringRadii = [
      maxR * 0.33, // inner orbit
      maxR * 0.46, // mid-inner orbit
      maxR * 0.60, // glyph track
      maxR * 0.76, // outer orbit
      maxR * 0.90  // outermost boundary
    ];

    for (let i = 0; i < ringRadii.length; i++) {
      const r = ringRadii[i];
      const isGlyphRing = i === 2;
      ctx.strokeStyle = isGlyphRing ? tint.ringLine : 'rgba(235, 165, 60, 0.16)';
      ctx.lineWidth = isGlyphRing ? 1.2 : 0.8;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();

      // Tick marks on the orbits (hud instrument ticks matching raphael.png)
      if (quality !== 'low' && (i === 1 || i === 2 || i === 3)) {
        const tickCount = i === 2 ? 36 : 24;
        const tickLen = 3.5;
        ctx.strokeStyle = 'rgba(235, 165, 60, 0.22)';
        ctx.lineWidth = 0.8;
        for (let t = 0; t < tickCount; t++) {
          const a = (t / tickCount) * Math.PI * 2;
          const x0 = Math.cos(a) * (r - tickLen * 0.5);
          const y0 = Math.sin(a) * (r - tickLen * 0.5);
          const x1 = Math.cos(a) * (r + tickLen * 0.5);
          const y1 = Math.sin(a) * (r + tickLen * 0.5);
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
          ctx.stroke();
        }
      }
    }

    // Radial compass spoke lines (subtle axes crossing through center)
    const spokeCount = 12;
    ctx.strokeStyle = tint.spokeLine;
    ctx.lineWidth = 0.8;
    for (let s = 0; s < spokeCount; s++) {
      const a = (s / spokeCount) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * (maxR * 0.28), Math.sin(a) * (maxR * 0.28));
      ctx.lineTo(Math.cos(a) * (maxR * 0.92), Math.sin(a) * (maxR * 0.92));
      ctx.stroke();
    }
    ctx.restore();

    // 4. Amber/Gold Glyph Word Ring (Reference: raphael.png)
    const glyphRingR = maxR * 0.60;
    const ringRotation = tSec * motion.ringSpeed * tunables.rotationSpeed;
    const flickerAlpha = motion.flicker ? 0.6 + 0.4 * Math.sin(tSec * 10) : 1.0;
    ctx.save();
    ctx.translate(cx, cy);
    drawWordRing(
      ctx,
      GLYPH_RING_WORDS,
      glyphRingR,
      ringRotation,
      Math.max(10, Math.round(maxR * 0.034)),
      tint.glyphText,
      0.9 * tunables.ringIntensity * flickerAlpha
    );

    // Thinking state: elegant scanning sweep arc
    if (motion.scanning) {
      const sweepAngle = tSec * 1.5;
      const scanGrad = ctx.createConicGradient(sweepAngle, 0, 0);
      scanGrad.addColorStop(0, 'rgba(255, 168, 59, 0)');
      scanGrad.addColorStop(0.04, 'rgba(255, 168, 59, 0.28)');
      scanGrad.addColorStop(0.08, 'rgba(255, 168, 59, 0)');
      scanGrad.addColorStop(1, 'rgba(255, 168, 59, 0)');
      ctx.fillStyle = scanGrad;
      ctx.beginPath();
      ctx.arc(0, 0, maxR * 0.76, 0, Math.PI * 2);
      ctx.arc(0, 0, maxR * 0.33, 0, Math.PI * 2, true);
      ctx.fill('evenodd');
    }
    ctx.restore();

    // 5. Center Core & Faceted Geometric Polygon
    const bassPulse = (audio.bass || 0) * tunables.audioSensitivity * 0.15;
    const voicePulse = (audio.amplitude || 0) * tunables.audioSensitivity * 0.12;
    const breathPulse = Math.sin(tSec * Math.PI * 2 * motion.pulseSpeed) * motion.pulseAmplitude;

    // Completion pulse: a gentle, beautiful golden expansion (NO WHITE FLASH!)
    const completionFactor = completionPulseAge !== null && completionPulseAge >= 0 && completionPulseAge < 1.0
      ? Math.max(0, 1 - completionPulseAge) * 0.25
      : 0;

    const polyBaseR = safeR(maxR * 0.22 * (1 + breathPulse + bassPulse * 0.5 + completionFactor * 0.3) * tunables.coreIntensity, 20);

    ctx.save();
    ctx.translate(cx, cy);

    // A. Warm Golden Halo Corona behind the star
    const coronaR = safeR(polyBaseR * 1.6 * (1 + voicePulse * 0.8), 30);
    const coronaGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, coronaR);
    coronaGrad.addColorStop(0, tint.coronaInner);
    coronaGrad.addColorStop(0.35, tint.coronaMid);
    coronaGrad.addColorStop(0.8, 'rgba(255, 140, 20, 0.08)');
    coronaGrad.addColorStop(1, tint.coronaOuter);
    ctx.fillStyle = coronaGrad;
    ctx.beginPath();
    ctx.arc(0, 0, coronaR, 0, Math.PI * 2);
    ctx.fill();

    // B. Sharp Star Flare Needles / Spikes (Piercing outward from the core through the polygon)
    const flareIntensity = clamp01(motion.energy * (0.8 + voicePulse * 1.5 + completionFactor * 0.5));
    const flareRHoriz = safeR(polyBaseR * (1.75 + voicePulse * 0.6), 25);
    const flareRVert = safeR(polyBaseR * (1.45 + voicePulse * 0.4), 20);
    const flareRDiag = safeR(polyBaseR * (1.25 + voicePulse * 0.3), 18);

    // Helper to draw tapered sharp needle spike
    const drawSpike = (angle: number, length: number, halfWidth: number) => {
      ctx.save();
      ctx.rotate(angle);
      const spikeGrad = ctx.createLinearGradient(0, 0, length, 0);
      spikeGrad.addColorStop(0, '#ffffff');
      spikeGrad.addColorStop(0.25, 'rgba(255, 230, 170, 0.85)');
      spikeGrad.addColorStop(0.7, 'rgba(255, 170, 50, 0.35)');
      spikeGrad.addColorStop(1, 'rgba(255, 150, 20, 0)');

      ctx.fillStyle = spikeGrad;
      ctx.globalAlpha = flareIntensity;
      ctx.beginPath();
      ctx.moveTo(0, -halfWidth);
      ctx.lineTo(length, 0);
      ctx.lineTo(0, halfWidth);
      ctx.closePath();
      ctx.fill();

      // Mirror spike in opposite direction
      const backGrad = ctx.createLinearGradient(0, 0, -length, 0);
      backGrad.addColorStop(0, '#ffffff');
      backGrad.addColorStop(0.25, 'rgba(255, 230, 170, 0.85)');
      backGrad.addColorStop(0.7, 'rgba(255, 170, 50, 0.35)');
      backGrad.addColorStop(1, 'rgba(255, 150, 20, 0)');
      ctx.fillStyle = backGrad;
      ctx.beginPath();
      ctx.moveTo(0, -halfWidth);
      ctx.lineTo(-length, 0);
      ctx.lineTo(0, halfWidth);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    };

    // Horizontal prominent needle spike (0 deg)
    drawSpike(0, flareRHoriz, 2.8);
    // Vertical prominent needle spike (90 deg)
    drawSpike(Math.PI / 2, flareRVert, 2.4);
    // Diagonal cross spikes (45 deg and 135 deg)
    drawSpike(Math.PI / 4, flareRDiag, 1.8);
    drawSpike((Math.PI * 3) / 4, flareRDiag, 1.8);

    // C. Central Brilliant White Star Hotspot
    const starHotR = safeR(polyBaseR * 0.36 * (1 + bassPulse * 0.4), 8);
    const starGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, starHotR);
    starGrad.addColorStop(0, '#ffffff');
    starGrad.addColorStop(0.4, '#ffffff');
    starGrad.addColorStop(0.75, tint.coreHalo);
    starGrad.addColorStop(1, 'rgba(255, 200, 80, 0)');
    ctx.fillStyle = starGrad;
    ctx.beginPath();
    ctx.arc(0, 0, starHotR, 0, Math.PI * 2);
    ctx.fill();

    // D. The Distinctive 8-Sided Faceted Geometric White Polygon (Octagonal Crystal Shield)
    // Reference: raphael.png - Crisp, straight geometric segments with soft outer glow
    ctx.beginPath();
    for (let f = 0; f < FACET_OFFSETS.length; f++) {
      const facet = FACET_OFFSETS[f];
      const r = polyBaseR * facet.rFactor;
      const x = Math.cos(facet.angle) * r;
      const y = Math.sin(facet.angle) * r;
      if (f === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();

    // Soft outer glow for the polygon
    ctx.save();
    ctx.strokeStyle = tint.polyGlow;
    ctx.lineWidth = 5.5;
    ctx.globalAlpha = 0.4;
    ctx.lineJoin = 'miter';
    ctx.miterLimit = 4;
    ctx.stroke();
    ctx.restore();

    // Solid brilliant crisp white stroke
    ctx.save();
    ctx.strokeStyle = tint.polyStroke;
    ctx.lineWidth = 3.2;
    ctx.lineJoin = 'miter';
    ctx.miterLimit = 4;
    ctx.globalAlpha = 1.0;
    ctx.stroke();
    ctx.restore();

    ctx.restore();

    // 6. Gentle Completion Ripple Ring (Elegant golden ripple, NO full screen flash)
    if (completionPulseAge !== null && completionPulseAge >= 0 && completionPulseAge < 1.1) {
      const wave = completionPulseAge / 1.1;
      const rippleR = safeR(polyBaseR * (1.1 + wave * 2.8), 20);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.strokeStyle = `rgba(255, 215, 120, ${(1 - wave) * 0.45})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, rippleR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // 7. Waiting-for-permission pulse
    if (state === 'waiting_for_permission') {
      const wave = (tSec * 0.4) % 1;
      const warnR = safeR(polyBaseR * (1.2 + wave * 1.5), 20);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.strokeStyle = `rgba(255, 180, 50, ${(1 - wave) * 0.5})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, warnR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  } finally {
    // Guarantees that any transforms, alphas, or composite operations are reset
    ctx.restore();
  }
}
